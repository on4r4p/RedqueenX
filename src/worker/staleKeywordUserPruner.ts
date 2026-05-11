import "dotenv/config";
import fsSync from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Page } from "playwright-core";
import { ApiResponseError, EApiV1ErrorCode, EApiV2ErrorCode } from "twitter-api-v2";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { formatDiagnosticsReport, runVpnDiagnostics, type VpnDiagnosticsReport } from "../diagnostics/vpn";
import { CurrentSessionService, type CurrentSessionLevel } from "../admin/currentSessionService";
import { ListService } from "../admin/listService";
import {
  defaultManualVerificationMessage,
  defaultManualVerificationRecommendation,
  XSessionAlertOpenError,
  XSessionAlertService,
  type XSessionAlertType
} from "../admin/xSessionAlertService";
import { XBrowserAccountService, type XBrowserAccountRecord } from "../admin/xBrowserAccountService";
import { isHandleSearchKeyword, normalizeHandle } from "../text";
import type { TweetCandidate } from "../types";
import { XApiClient } from "../x-client";
import {
  buildBrowserSearchUrl,
  detectManualVerification,
  extractVisibleTweets,
  sameManualVerificationDetection,
  type ManualVerificationDetection
} from "./browserSearch";
import { randomDelayMs, type HumanPacingConfig, typeWithPacing } from "./humanPacing";
import { assertVpnRuntime } from "./vpnGuard";

export type KeywordUserPruneMode = "without_api" | "x_api";

interface PrunerArgs {
  maxAgeDays: number;
  jobId: string;
  resumeStatePath: string | null;
  startIndex: number;
  mode: KeywordUserPruneMode;
}

export interface KeywordUserCandidate {
  keyword: string;
  handle: string;
  searchQuery: string;
}

export interface KeywordUserCandidatePlan {
  candidates: KeywordUserCandidate[];
  alreadyStaleCandidates: KeywordUserCandidate[];
}

export interface KeywordUserResumePlan {
  candidates: KeywordUserCandidate[];
  alreadyCheckedCandidates: KeywordUserCandidate[];
}

export interface PrunedKeywordUser {
  keyword: string;
  handle: string;
  latestTweetId: string | null;
  latestTweetCreatedAt: string | null;
  ageDays: number | null;
  reason?: string | null;
}

interface CheckedKeywordUser {
  keyword: string;
  handle: string;
  latestTweetId: string | null;
  latestTweetCreatedAt: string | null;
  ageDays: number | null;
  reason: string;
}

interface ResumeCheckedUser {
  keyword: string;
  handle: string;
  status: "remove" | "keep" | "skip" | "delete_keyword" | "already_stale";
  jobId: string;
  checkedAt: string;
}

interface PruneResumeState {
  schemaVersion: 1;
  updatedAt: string;
  checkedUsers: ResumeCheckedUser[];
}

type KeywordUserCheckResult =
  | { status: "remove"; user: PrunedKeywordUser }
  | { status: "keep"; user: CheckedKeywordUser }
  | { status: "delete_keyword"; user: CheckedKeywordUser }
  | { status: "skip"; user: CheckedKeywordUser };

export interface StaleKeywordUserPruneReport {
  jobId: string;
  mode?: KeywordUserPruneMode;
  status: "running" | "completed" | "failed" | "stopped";
  maxAgeDays: number;
  startedAt: string;
  completedAt: string | null;
  account: string | null;
  vpnProfilePath: string | null;
  publicIpv4: string | null;
  totalCandidates: number;
  processedCandidates: number;
  startIndex: number;
  skippedBeforeStartIndex: number;
  removedUsers: PrunedKeywordUser[];
  keptUsers: CheckedKeywordUser[];
  skippedUsers: CheckedKeywordUser[];
  deletedUsers?: CheckedKeywordUser[];
  error: string | null;
  blockedByAlertId?: number | null;
  blockedByAccountId?: number | null;
  blockedByXIdentifier?: string | null;
  blockedKeyword?: string | null;
}

class ManualVerificationRequiredError extends Error {
  constructor(
    readonly alertType: XSessionAlertType,
    readonly reason: string,
    readonly publicIpv4: string | null,
    readonly details: Record<string, unknown> = {}
  ) {
    super(reason);
    this.name = "ManualVerificationRequiredError";
  }
}

class StopRequestedError extends Error {
  constructor(readonly reason: string) {
    super(`Stale keyword user pruning stopped by request: ${reason}`);
    this.name = "StopRequestedError";
  }
}

export function keywordUserCandidates(keywords: string[]): KeywordUserCandidate[] {
  return planKeywordUserCandidates(keywords).candidates;
}

export function planKeywordUserCandidates(keywords: string[], staleKeywordUsers: string[] = []): KeywordUserCandidatePlan {
  const staleHandles = new Set(staleKeywordUsers.map((value) => normalizeHandle(value)).filter((value): value is string => Boolean(value)));
  const seen = new Set<string>();
  const candidates: KeywordUserCandidate[] = [];
  const alreadyStaleCandidates: KeywordUserCandidate[] = [];
  for (const rawKeyword of keywords) {
    const keyword = rawKeyword.trim();
    if (!isHandleSearchKeyword(keyword)) {
      continue;
    }
    const handle = normalizeHandle(keyword);
    if (!handle || seen.has(handle)) {
      continue;
    }
    seen.add(handle);
    const candidate = {
      keyword,
      handle,
      searchQuery: `from:${handle}`
    };
    if (staleHandles.has(handle)) {
      alreadyStaleCandidates.push(candidate);
    } else {
      candidates.push(candidate);
    }
  }
  return { candidates, alreadyStaleCandidates };
}

export function planResumeKeywordUserCandidates(
  candidates: KeywordUserCandidate[],
  checkedUsers: Array<string | { handle?: string; keyword?: string }>
): KeywordUserResumePlan {
  const checkedHandles = new Set(
    checkedUsers
      .map((user) => normalizeHandle(typeof user === "string" ? user : user.handle ?? user.keyword ?? ""))
      .filter((value): value is string => Boolean(value))
  );
  const remainingCandidates: KeywordUserCandidate[] = [];
  const alreadyCheckedCandidates: KeywordUserCandidate[] = [];
  for (const candidate of candidates) {
    if (checkedHandles.has(candidate.handle)) {
      alreadyCheckedCandidates.push(candidate);
    } else {
      remainingCandidates.push(candidate);
    }
  }
  return { candidates: remainingCandidates, alreadyCheckedCandidates };
}

export function applyKeywordUserStartIndex(candidates: KeywordUserCandidate[], startIndex: number): KeywordUserResumePlan {
  const skippedCount = Math.min(Math.max(0, Math.floor(startIndex) - 1), candidates.length);
  return {
    candidates: candidates.slice(skippedCount),
    alreadyCheckedCandidates: candidates.slice(0, skippedCount)
  };
}

export function tweetAgeDays(createdAt: Date, now = new Date()): number {
  return Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
}

export function isTweetOlderThanDays(createdAt: Date, maxAgeDays: number, now = new Date()): boolean {
  return tweetAgeDays(createdAt, now) > maxAgeDays;
}

export function isProtectedPostsText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.includes("these posts are protected") && normalized.includes("only approved followers can see");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (args.mode === "without_api" && config.searchWithoutApiIsolation === "docker_vpn" && !process.env.REDQUEENX_DOCKER_VPN) {
    throw new Error("Stale keyword user pruning must run inside the Docker VPN worker when docker_vpn isolation is selected.");
  }

  const database = openDatabase(config.databaseUrl);
  const lists = new ListService(database);
  const accounts = new XBrowserAccountService(database);
  const alerts = new XSessionAlertService(database);
  const currentSession = new CurrentSessionService(config.currentSessionFile);
  const record = (level: CurrentSessionLevel, type: string, message: string, data: Record<string, unknown> = {}) =>
    currentSession.record(level, type, message, data).catch(() => undefined);

  let account: XBrowserAccountRecord | null = null;
  let publicIpv4: string | null = null;
  let report = createInitialReport(args);

  try {
    assertStopNotRequested(args.jobId);
    const plan = planKeywordUserCandidates(lists.activeValues("keyword"), lists.activeValues("stale_keyword_user"));
    const startIndexPlan = applyKeywordUserStartIndex(plan.candidates, args.startIndex);
    const skippedBeforeStartIndex = startIndexPlan.alreadyCheckedCandidates.length;
    const resumeState = readResumeState(args.resumeStatePath);
    const resumePlan = planResumeKeywordUserCandidates(startIndexPlan.candidates, resumeState.checkedUsers);
    const candidates = resumePlan.candidates;
    report.totalCandidates = candidates.length;
    report.startIndex = args.startIndex;
    report.skippedBeforeStartIndex = skippedBeforeStartIndex;
      for (const candidate of plan.alreadyStaleCandidates) {
        const deletedKeywords = lists.markDeleted("keyword", candidate.keyword);
        const skipped = {
          keyword: candidate.keyword,
          handle: candidate.handle,
        latestTweetId: null,
        latestTweetCreatedAt: null,
          ageDays: null,
          reason: "already_in_stale_keyword_user"
        };
        report.skippedUsers.push(skipped);
        recordSkippedKeywordUser(lists, candidate, skipped.reason);
        markResumeUser(args.resumeStatePath, candidate, "already_stale", args.jobId);
        await record("info", "keyword_user_prune.already_stale_skipped", "Keyword user already in stale list; removed from Keywords without X check", {
        jobId: args.jobId,
        keyword: candidate.keyword,
        handle: candidate.handle,
        deletedKeywords,
        skippedAlreadyStaleUsers: plan.alreadyStaleCandidates.length,
        startIndex: args.startIndex,
        skippedBeforeStartIndex,
        totalCandidates: candidates.length,
        remainingUsers: candidates.length
      });
    }
    if (skippedBeforeStartIndex > 0) {
      await record("info", "keyword_user_prune.start_index_skipped", "Keyword users before the configured start index were skipped", {
        jobId: args.jobId,
        startIndex: args.startIndex,
        skippedBeforeStartIndex,
        totalCandidates: candidates.length,
        remainingUsers: candidates.length
      });
    }
    if (resumePlan.alreadyCheckedCandidates.length > 0) {
      await record("info", "keyword_user_prune.resume_skipped", "Keyword users already checked by this cleanup were skipped", {
        jobId: args.jobId,
        resumeStatePath: args.resumeStatePath,
        skippedAlreadyCheckedUsers: resumePlan.alreadyCheckedCandidates.length,
        totalCandidates: candidates.length,
        remainingUsers: candidates.length
      });
    }
    writeReport(report);
    assertStopNotRequested(args.jobId);
    await record("info", "keyword_user_prune.started", "Stale keyword user pruning started", {
      jobId: args.jobId,
      mode: args.mode,
      maxAgeDays: args.maxAgeDays,
      startIndex: args.startIndex,
      skippedBeforeStartIndex,
      totalCandidates: candidates.length,
      skippedAlreadyStaleUsers: plan.alreadyStaleCandidates.length,
      skippedAlreadyCheckedUsers: resumePlan.alreadyCheckedCandidates.length,
      resumeStatePath: args.resumeStatePath
    });

    if (args.mode === "x_api") {
      if (!config.xApiEnabled) {
        throw new Error("X API search is disabled; cannot run stale keyword user pruning in X API mode.");
      }
      if (!config.x.bearerToken) {
        throw new Error("X_BEARER_TOKEN is required for stale keyword user pruning in X API mode.");
      }
      report.account = "x_api";
      writeReport(report);
      const xClient = new XApiClient({ bearerToken: config.x.bearerToken });
      for (const candidate of candidates) {
        assertStopNotRequested(args.jobId);
        const result = await checkKeywordUserViaApi(xClient, candidate, {
          maxAgeDays: args.maxAgeDays,
          record,
          progress: {
            position: report.processedCandidates + 1,
            totalCandidates: report.totalCandidates,
            processedUsers: report.processedCandidates,
            remainingUsers: Math.max(0, report.totalCandidates - report.processedCandidates)
          }
        });
        assertStopNotRequested(args.jobId);
        await applyKeywordUserCheckOutcome(report, lists, args, candidate, result, record);
        assertStopNotRequested(args.jobId);
      }
    } else {
      await assertVpnRuntime(config, "Stale keyword user pruning worker");
      assertStopNotRequested(args.jobId);
      const diagnostics = await runVpnDiagnostics({ includePlaywright: true, strict: true });
      console.log(formatDiagnosticsReport(diagnostics));
      publicIpv4 = publicIpv4FromReport(diagnostics);
      report.publicIpv4 = publicIpv4;
      if (diagnostics.failures.length > 0) {
        throw new Error("VPN diagnostics failed; refusing to prune stale keyword users.");
      }

      account = selectBrowserAccount(accounts, config.vpnConfig);
      assertStopNotRequested(args.jobId);
      alerts.openForAccountOrThrow(account);
      if (!account.storageStateExists || account.sessionStatus !== "valid") {
        throw new Error(`X browser session for ${account.xIdentifier} is not ready.`);
      }
      report.account = account.xIdentifier;
      report.vpnProfilePath = config.vpnConfig;
      writeReport(report);

      const browser = await chromium.launch(browserLaunchOptions(config, record));
      try {
        const context = await browser.newContext({
          storageState: path.resolve(process.cwd(), account.storageStatePath),
          viewport: { width: 1366, height: 900 }
        });
        const page = await context.newPage();
        const pacing = browserPacingConfig(config);

        for (const candidate of candidates) {
          assertStopNotRequested(args.jobId);
          const result = await checkKeywordUser(page, candidate, {
            maxAgeDays: args.maxAgeDays,
            startUrl: config.searchWithoutApiStartUrl,
            pacing,
            publicIpv4,
            record,
            progress: {
              position: report.processedCandidates + 1,
              totalCandidates: report.totalCandidates,
              processedUsers: report.processedCandidates,
              remainingUsers: Math.max(0, report.totalCandidates - report.processedCandidates)
            }
          });
          assertStopNotRequested(args.jobId);
          await applyKeywordUserCheckOutcome(report, lists, args, candidate, result, record);
          assertStopNotRequested(args.jobId);
        }
      } finally {
        await browser?.close().catch(() => undefined);
      }
    }

    report.status = "completed";
    report.completedAt = new Date().toISOString();
    writeReport(report);
    await record("info", "keyword_user_prune.completed", "Stale keyword user pruning completed", {
      jobId: args.jobId,
      mode: args.mode,
      maxAgeDays: args.maxAgeDays,
      totalCandidates: report.totalCandidates,
      processedCandidates: report.processedCandidates,
      removedUsers: report.removedUsers.length,
      keptUsers: report.keptUsers.length,
      skippedUsers: report.skippedUsers.length
    });
    console.log(`REDQUEENX_STALE_KEYWORD_USER_PRUNE_REPORT ${JSON.stringify(report)}`);
  } catch (error) {
    report.status = error instanceof StopRequestedError ? "stopped" : "failed";
    report.completedAt = new Date().toISOString();
    report.error = error instanceof Error ? error.message : String(error);
    writeReport(report);
    if (error instanceof StopRequestedError) {
      await record("info", "keyword_user_prune.stopped", "Stale keyword user pruning stopped by request", {
        jobId: args.jobId,
        reason: error.reason,
        totalCandidates: report.totalCandidates,
        processedCandidates: report.processedCandidates,
        removedUsers: report.removedUsers.length,
        keptUsers: report.keptUsers.length,
        skippedUsers: report.skippedUsers.length
      });
      console.log(`REDQUEENX_STALE_KEYWORD_USER_PRUNE_REPORT ${JSON.stringify(report)}`);
      return;
    }
    if (error instanceof ManualVerificationRequiredError && account) {
      const alert = alerts.createOpen({
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        vpnProfilePath: config.vpnConfig,
        publicIpv4: error.publicIpv4,
        alertType: error.alertType,
        message: defaultManualVerificationMessage(),
        recommendation: defaultManualVerificationRecommendation(account.id),
        details: error.details
      });
      report.blockedByAlertId = alert.id;
      report.blockedByAccountId = account.id;
      report.blockedByXIdentifier = account.xIdentifier;
      report.blockedKeyword = typeof error.details.keyword === "string" ? error.details.keyword : null;
      writeReport(report);
      accounts.markStatus(account.id, "needs_login");
      await record("prob", "keyword_user_prune.manual_verification", "Stale keyword user pruning stopped by X session alert", {
        jobId: args.jobId,
        alertId: alert.id,
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        reason: error.reason,
        details: error.details
      });
    } else if (error instanceof XSessionAlertOpenError) {
      report.blockedByAlertId = error.alert.id;
      report.blockedByAccountId = error.alert.accountId;
      report.blockedByXIdentifier = error.alert.xIdentifier;
      report.blockedKeyword = null;
      writeReport(report);
      await record("prob", "keyword_user_prune.open_session_alert", "Stale keyword user pruning stopped by an already-open X session alert", {
        jobId: args.jobId,
        alertId: error.alert.id,
        accountId: error.alert.accountId,
        xIdentifier: error.alert.xIdentifier,
        alertType: error.alert.alertType
      });
    } else {
      await record("prob", "keyword_user_prune.failed", "Stale keyword user pruning failed", {
        jobId: args.jobId,
        error: report.error
      });
    }
    throw error;
  } finally {
    database.close();
  }
}

async function applyKeywordUserCheckOutcome(
  report: StaleKeywordUserPruneReport,
  lists: ListService,
  args: PrunerArgs,
  candidate: KeywordUserCandidate,
  result: KeywordUserCheckResult,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<void> {
  report.processedCandidates += 1;
  const position = report.processedCandidates;
  const remainingUsers = Math.max(0, report.totalCandidates - report.processedCandidates);
  const shouldTreatAsStaleRemoval = result.status === "remove" || (result.status === "delete_keyword" && result.user.reason === "protected_posts");
  if (shouldTreatAsStaleRemoval) {
    const removedUser: PrunedKeywordUser =
      result.status === "remove"
        ? result.user
        : {
            keyword: candidate.keyword,
            handle: candidate.handle,
            latestTweetId: null,
            latestTweetCreatedAt: null,
            ageDays: null,
            reason: result.user.reason
          };
    const importedAt = new Date().toISOString();
    const staleEntry = lists.add("stale_keyword_user", candidate.keyword, "runtime:stale-keyword-user-prune", null, importedAt);
    const deletedKeywords = lists.markDeleted("keyword", candidate.keyword);
    lists.markDeleted("skipped_keyword_user", candidate.keyword);
    report.removedUsers.push(removedUser);
    await record(
      "info",
      "keyword_user_prune.removed",
      removedUser.reason === "protected_posts"
        ? "Keyword user moved to stale because posts are protected"
        : "Keyword user removed because the latest tweet is too old",
      {
      jobId: args.jobId,
      mode: args.mode,
      keyword: candidate.keyword,
      handle: candidate.handle,
      latestTweetId: removedUser.latestTweetId,
      latestTweetCreatedAt: removedUser.latestTweetCreatedAt,
      ageDays: removedUser.ageDays,
      reason: removedUser.reason ?? null,
      maxAgeDays: args.maxAgeDays,
      staleEntryId: staleEntry.id,
      deletedKeywords,
      position,
      totalCandidates: report.totalCandidates,
      processedUsers: report.processedCandidates,
      remainingUsers
    });
  } else if (result.status === "keep") {
    lists.markDeleted("skipped_keyword_user", candidate.keyword);
    report.keptUsers.push(result.user);
  } else if (result.status === "delete_keyword") {
    const deletedKeywords = lists.markDeleted("keyword", candidate.keyword);
    lists.markDeleted("skipped_keyword_user", candidate.keyword);
    report.deletedUsers = report.deletedUsers ?? [];
    report.deletedUsers.push(result.user);
    await record("info", "keyword_user_prune.keyword_deleted", "Keyword user removed from Keywords without adding it to skipped", {
      jobId: args.jobId,
      mode: args.mode,
      keyword: candidate.keyword,
      handle: candidate.handle,
      reason: result.user.reason,
      deletedKeywords,
      position,
      totalCandidates: report.totalCandidates,
      processedUsers: report.processedCandidates,
      remainingUsers
    });
  } else {
    recordSkippedKeywordUser(lists, candidate, result.user.reason);
    report.skippedUsers.push(result.user);
  }
  markResumeUser(args.resumeStatePath, candidate, result.status, args.jobId);
  await record("info", "keyword_user_prune.progress", "Stale keyword user pruning progress updated", {
    jobId: args.jobId,
    mode: args.mode,
    keyword: candidate.keyword,
    handle: candidate.handle,
    decision: result.status,
    position,
    totalCandidates: report.totalCandidates,
    processedUsers: report.processedCandidates,
    remainingUsers,
    removedUsers: report.removedUsers.length,
    keptUsers: report.keptUsers.length,
    skippedUsers: report.skippedUsers.length,
    deletedUsers: report.deletedUsers?.length ?? 0
  });
  writeReport(report);
}

async function checkKeywordUserViaApi(
  xClient: XApiClient,
  candidate: KeywordUserCandidate,
  options: {
    maxAgeDays: number;
    record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
    progress: {
      position: number;
      totalCandidates: number;
      processedUsers: number;
      remainingUsers: number;
    };
  }
): Promise<KeywordUserCheckResult> {
  await randomActionPause("before_user_lookup", candidate, options.record, options.progress);
  await options.record("info", "keyword_user_prune.user_search", "Fetching latest tweets for keyword user through X API", {
    keyword: candidate.keyword,
    handle: candidate.handle,
    searchQuery: candidate.searchQuery,
    source: "x_api",
    ...options.progress
  });

  const userProfile = await lookupKeywordUserViaApi(xClient, candidate, options);
  if (userProfile.status !== "ok") {
    return userProfile.result;
  }

  await randomActionPause("before_latest_tweet_check", candidate, options.record, options.progress);
  const latestTweet = latestTweetFromUserTimeline(
    await readLatestTweetsFromApi(xClient, userProfile.userId, candidate, options),
    candidate.handle
  );
  await randomActionPause("after_latest_tweet_check", candidate, options.record, options.progress);

  if (!latestTweet?.createdAt) {
    const user = {
      keyword: candidate.keyword,
      handle: candidate.handle,
      latestTweetId: latestTweet?.id ?? null,
      latestTweetCreatedAt: null,
      ageDays: null,
      reason: latestTweet ? "latest_tweet_has_no_date" : "no_api_tweet_for_user"
    };
    await options.record("prob", "keyword_user_prune.user_skipped", "Keyword user could not be checked through X API", {
      ...user,
      ...options.progress
    });
    return { status: "skip", user };
  }

  const ageDays = Number(tweetAgeDays(latestTweet.createdAt).toFixed(2));
  if (isTweetOlderThanDays(latestTweet.createdAt, options.maxAgeDays)) {
    return {
      status: "remove",
      user: {
        keyword: candidate.keyword,
        handle: candidate.handle,
        latestTweetId: latestTweet.id,
        latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
        ageDays
      }
    };
  }

  const user = {
    keyword: candidate.keyword,
    handle: candidate.handle,
    latestTweetId: latestTweet.id,
    latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
    ageDays,
    reason: "latest_tweet_within_max_age"
  };
  await options.record("debug", "keyword_user_prune.user_kept", "Keyword user kept because latest API tweet is recent enough", {
    ...user,
    source: "x_api",
    ...options.progress
  });
  return { status: "keep", user };
}

async function lookupKeywordUserViaApi(
  xClient: XApiClient,
  candidate: KeywordUserCandidate,
  options: {
    record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
    progress: {
      position: number;
      totalCandidates: number;
      processedUsers: number;
      remainingUsers: number;
    };
  }
): Promise<{ status: "ok"; userId: string } | { status: "done"; result: KeywordUserCheckResult }> {
  try {
    const user = await xClient.lookupUserByUsername(candidate.handle);
    if (!user?.id) {
      const result = keywordUserDeleteResult(candidate, "user_not_found");
      await options.record("info", "keyword_user_prune.keyword_deleted", "Keyword user removed from Keywords because the X API user no longer exists", {
        keyword: candidate.keyword,
        handle: candidate.handle,
        reason: result.user.reason,
        source: "x_api",
        ...options.progress
      });
      return { status: "done", result };
    }
    if (user.protected) {
      const result = keywordUserDeleteResult(candidate, "protected_posts");
      await options.record("info", "keyword_user_prune.protected_keyword", "Keyword user posts are protected; removing keyword without adding to skipped", {
        keyword: candidate.keyword,
        handle: candidate.handle,
        reason: result.user.reason,
        source: "x_api",
        ...options.progress
      });
      return { status: "done", result };
    }
    return { status: "ok", userId: user.id };
  } catch (error) {
    if (looksLikeMissingXApiUser(error)) {
      const result = keywordUserDeleteResult(candidate, "user_not_found");
      await options.record("info", "keyword_user_prune.keyword_deleted", "Keyword user removed from Keywords because the X API user lookup returned not found", {
        keyword: candidate.keyword,
        handle: candidate.handle,
        reason: result.user.reason,
        source: "x_api",
        ...options.progress
      });
      return { status: "done", result };
    }
    throw error;
  }
}

async function readLatestTweetsFromApi(
  xClient: XApiClient,
  userId: string,
  candidate: KeywordUserCandidate,
  options: {
    record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
    progress: {
      position: number;
      totalCandidates: number;
      processedUsers: number;
      remainingUsers: number;
    };
  }
): Promise<TweetCandidate[]> {
  try {
    return await xClient.userTimeline(userId, 10, "minimal");
  } catch (error) {
    await options.record("prob", "keyword_user_prune.api_timeline.failed", "X API user timeline lookup failed", {
      keyword: candidate.keyword,
      handle: candidate.handle,
      userId,
      error: error instanceof Error ? error.message : String(error),
      source: "x_api",
      ...options.progress
    });
    throw error;
  }
}

function latestTweetFromUserTimeline(tweets: TweetCandidate[], handle: string): TweetCandidate | null {
  const normalizedHandle = normalizeHandle(handle);
  const matching = tweets
    .filter((tweet) => {
      if (!tweet.user.screenName) {
        return true;
      }
      const tweetHandle = normalizeHandle(tweet.user.screenName);
      return !tweetHandle || tweetHandle === normalizedHandle;
    })
    .filter((tweet) => tweet.createdAt)
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
  return matching[0] ?? null;
}

function keywordUserDeleteResult(
  candidate: KeywordUserCandidate,
  reason: string
): { status: "delete_keyword"; user: CheckedKeywordUser } {
  return {
    status: "delete_keyword",
    user: {
      keyword: candidate.keyword,
      handle: candidate.handle,
      latestTweetId: null,
      latestTweetCreatedAt: null,
      ageDays: null,
      reason
    }
  };
}

function looksLikeMissingXApiUser(error: unknown): boolean {
  if (!(error instanceof ApiResponseError)) {
    return false;
  }
  return (
    error.code === 404 ||
    error.hasErrorCode(EApiV1ErrorCode.NoUserMatch, EApiV1ErrorCode.UserNotFound, EApiV1ErrorCode.ResourceNotFound) ||
    error.hasErrorCode(EApiV2ErrorCode.ResourceNotFound)
  );
}

async function checkKeywordUser(
  page: Page,
  candidate: KeywordUserCandidate,
  options: {
    maxAgeDays: number;
    startUrl: string;
    pacing: HumanPacingConfig;
    publicIpv4: string | null;
    record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
    progress: {
      position: number;
      totalCandidates: number;
      processedUsers: number;
      remainingUsers: number;
    };
  }
): Promise<KeywordUserCheckResult> {
  await randomActionPause("before_user_search", candidate, options.record, options.progress);
  const searchUrl = buildBrowserSearchUrl(candidate.searchQuery, options.startUrl);
  await options.record("info", "keyword_user_prune.user_search", "Searching latest tweets for keyword user", {
    keyword: candidate.keyword,
    handle: candidate.handle,
    searchQuery: candidate.searchQuery,
    searchUrl,
    ...options.progress
  });
  await openUserSearch(page, candidate, options.startUrl, searchUrl, options.pacing);
  await assertNoManualVerification(page, {
    publicIpv4: options.publicIpv4,
    keyword: candidate.keyword,
    phase: "after_user_search",
    record: options.record
  });
  const protectedText = await protectedPostsVisibleText(page);
  if (protectedText) {
    const user = {
      keyword: candidate.keyword,
      handle: candidate.handle,
      latestTweetId: null,
      latestTweetCreatedAt: null,
      ageDays: null,
      reason: "protected_posts"
    };
    await options.record("info", "keyword_user_prune.protected_keyword", "Keyword user posts are protected; removing keyword without adding to skipped", {
      ...user,
      pageText: protectedText.slice(0, 500),
      ...options.progress
    });
    return { status: "delete_keyword", user };
  }

  await randomActionPause("before_latest_tweet_check", candidate, options.record, options.progress);
  const latestTweet = latestTweetForHandle(await extractVisibleTweetsForKeywordUser(page, candidate, options), candidate.handle);
  await randomActionPause("after_latest_tweet_check", candidate, options.record, options.progress);

  if (!latestTweet?.createdAt) {
    const user = {
      keyword: candidate.keyword,
      handle: candidate.handle,
      latestTweetId: latestTweet?.id ?? null,
      latestTweetCreatedAt: null,
      ageDays: null,
      reason: latestTweet ? "latest_tweet_has_no_date" : "no_visible_tweet_for_user"
    };
    await options.record("prob", "keyword_user_prune.user_skipped", "Keyword user could not be checked", {
      ...user,
      ...options.progress
    });
    return { status: "skip", user };
  }

  const ageDays = Number(tweetAgeDays(latestTweet.createdAt).toFixed(2));
  if (isTweetOlderThanDays(latestTweet.createdAt, options.maxAgeDays)) {
    return {
      status: "remove",
      user: {
        keyword: candidate.keyword,
        handle: candidate.handle,
        latestTweetId: latestTweet.id,
        latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
        ageDays
      }
    };
  }

  const user = {
    keyword: candidate.keyword,
    handle: candidate.handle,
    latestTweetId: latestTweet.id,
    latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
    ageDays,
    reason: "latest_tweet_within_max_age"
  };
  await options.record("debug", "keyword_user_prune.user_kept", "Keyword user kept because latest tweet is recent enough", {
    ...user,
    ...options.progress
  });
  return { status: "keep", user };
}

async function openUserSearch(
  page: Page,
  candidate: KeywordUserCandidate,
  startUrl: string,
  searchUrl: string,
  pacing: HumanPacingConfig
): Promise<void> {
  await page.goto(startUrl || "https://x.com/search", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(500);
  const searchInput = page.locator('[data-testid="SearchBox_Search_Input"]').first();
  if ((await searchInput.count().catch(() => 0)) > 0 && (await searchInput.isVisible().catch(() => false))) {
    await searchInput.click({ timeout: 5_000 });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await typeWithPacing(page, candidate.searchQuery, pacing);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  } else {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  if (!isLatestSearchUrl(page.url())) {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  await page.waitForTimeout(1_200);
}

async function randomActionPause(
  phase: string,
  candidate: KeywordUserCandidate,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>,
  progress?: { position: number; totalCandidates: number; processedUsers: number; remainingUsers: number }
): Promise<void> {
  const delayMs = randomDelayMs(1_000, 5_000);
  await record("debug", "keyword_user_prune.random_pause", "Random pause between stale keyword user actions", {
    keyword: candidate.keyword,
    handle: candidate.handle,
    phase,
    delayMs,
    ...progress
  });
  await delay(delayMs);
}

async function protectedPostsVisibleText(page: Page): Promise<string | null> {
  const text = await page
    .locator("body")
    .innerText({ timeout: 3_000 })
    .catch(() => "");
  return isProtectedPostsText(text) ? text : null;
}

function latestTweetForHandle(tweets: TweetCandidate[], handle: string): TweetCandidate | null {
  const normalizedHandle = `@${handle}`.toLowerCase();
  const matching = tweets
    .filter((tweet) => tweet.user.screenName.toLowerCase() === normalizedHandle && tweet.createdAt)
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
  return matching[0] ?? null;
}

async function extractVisibleTweetsForKeywordUser(
  page: Page,
  candidate: KeywordUserCandidate,
  options: {
    publicIpv4: string | null;
    record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
    progress: {
      position: number;
      totalCandidates: number;
      processedUsers: number;
      remainingUsers: number;
    };
  }
): Promise<TweetCandidate[]> {
  try {
    return await extractVisibleTweets(page);
  } catch (error) {
    const extractionError = error instanceof Error ? error.message : String(error);
    await options.record("prob", "keyword_user_prune.tweet_extract.failed", "Visible tweet extraction failed; checking whether X displayed an alert", {
      keyword: candidate.keyword,
      handle: candidate.handle,
      extractionError,
      ...options.progress
    });
    await assertNoManualVerification(page, {
      publicIpv4: options.publicIpv4,
      keyword: candidate.keyword,
      phase: "during_latest_tweet_check",
      previousError: extractionError,
      record: options.record
    });
    return extractVisibleTweets(page);
  }
}

async function assertNoManualVerification(
  page: Page,
  options: {
    publicIpv4: string | null;
    keyword?: string;
    phase?: string;
    previousError?: string;
    record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
  }
): Promise<void> {
  const firstDetection = await detectManualVerification(page);
  if (!firstDetection) {
    return;
  }
  const retryDelayMs = 10_000;
  const beforeRefreshUrl = page.url();
  await options.record("prob", "keyword_user_prune.manual_verification.retry", "X alert candidate detected; refreshing once before stopping stale user pruning", {
    keyword: options.keyword,
    phase: options.phase,
    alertType: firstDetection.type,
    reason: firstDetection.reason,
    previousError: options.previousError,
    url: firstDetection.pageState.url,
    retryDelayMs
  });
  await delay(retryDelayMs);
  let refreshError: string | null = null;
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error);
  }
  await page.waitForTimeout(1_200).catch(() => undefined);
  const secondDetection = await detectManualVerification(page).catch((error) => {
    refreshError = [refreshError, error instanceof Error ? error.message : String(error)].filter(Boolean).join(" | ");
    return firstDetection;
  });
  if (!secondDetection) {
    await options.record("info", "keyword_user_prune.manual_verification.cleared", "X alert candidate cleared after one refresh", {
      keyword: options.keyword,
      phase: options.phase,
      beforeRefreshUrl,
      afterRefreshUrl: page.url(),
      refreshError,
      previousError: options.previousError
    });
    return;
  }
  const details = await captureManualVerificationDetails(page, secondDetection);
  throw new ManualVerificationRequiredError(secondDetection.type, secondDetection.reason, options.publicIpv4, {
    ...details,
    keyword: options.keyword,
    phase: options.phase,
    beforeRefreshUrl,
    afterRefreshUrl: page.url(),
    refreshError,
    previousError: options.previousError,
    firstAlertType: firstDetection.type,
    firstReason: firstDetection.reason,
    confirmedAlertType: secondDetection.type,
    confirmedReason: secondDetection.reason,
    confirmedSameAlert: sameManualVerificationDetection(firstDetection, secondDetection),
    detectionSignals: secondDetection.signals,
    pageState: secondDetection.pageState,
    refreshRetry: {
      attempted: true,
      retryDelayMs,
      beforeRefreshUrl,
      afterRefreshUrl: page.url(),
      refreshError,
      firstAlertType: firstDetection.type,
      firstReason: firstDetection.reason,
      firstDetectionSignals: firstDetection.signals,
      confirmedAlertType: secondDetection.type,
      confirmedReason: secondDetection.reason,
      confirmedDetectionSignals: secondDetection.signals,
      confirmedSameAlert: sameManualVerificationDetection(firstDetection, secondDetection)
    }
  });
}

async function captureManualVerificationDetails(page: Page, detection: ManualVerificationDetection): Promise<Record<string, unknown>> {
  const capturedAt = new Date().toISOString();
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const html = await page.content().catch(() => "");
  const snapshotPath = saveManualVerificationSnapshot({
    alertType: detection.type,
    reason: detection.reason,
    capturedAt,
    url,
    title,
    bodyText,
    html
  });
  return {
    capturedAt,
    url,
    title,
    reason: detection.reason,
    detectionSignals: detection.signals,
    detectionTextSource: "page text excluding tweet articles",
    articleCount: detection.pageState.articleCount,
    tweetTextCount: detection.pageState.tweetTextCount,
    nonTweetVisibleText: truncateText(detection.pageState.nonTweetVisibleText, 4_000),
    visibleText: truncateText(bodyText, 4_000),
    htmlSnippet: truncateText(html, 4_000),
    snapshotPath,
    bodyTextLength: bodyText.length,
    htmlLength: html.length
  };
}

function saveManualVerificationSnapshot(input: {
  alertType: string;
  reason: string;
  capturedAt: string;
  url: string;
  title: string;
  bodyText: string;
  html: string;
}): string | null {
  try {
    const snapshotDir = path.join(process.cwd(), "runtime", "x-session-alert-snapshots");
    fsSync.mkdirSync(snapshotDir, { recursive: true });
    const filename = `${input.capturedAt.replace(/[:.]/g, "-")}-${safePathSegment(input.alertType)}.json`;
    const absolutePath = path.join(snapshotDir, filename);
    fsSync.writeFileSync(
      absolutePath,
      `${JSON.stringify(
        {
          ...input,
          bodyText: normalizeSnapshotText(input.bodyText)
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return `./${path.relative(process.cwd(), absolutePath)}`;
  } catch {
    return null;
  }
}

function truncateText(value: string, maxLength = 2_000): string {
  const normalized = normalizeSnapshotText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}\n...[truncated ${normalized.length - maxLength} chars]`;
}

function normalizeSnapshotText(value: string): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function createInitialReport(args: PrunerArgs): StaleKeywordUserPruneReport {
  return {
    jobId: args.jobId,
    mode: args.mode,
    status: "running",
    maxAgeDays: args.maxAgeDays,
    startedAt: new Date().toISOString(),
    completedAt: null,
    account: null,
    vpnProfilePath: null,
    publicIpv4: null,
    totalCandidates: 0,
    processedCandidates: 0,
    startIndex: args.startIndex,
    skippedBeforeStartIndex: 0,
    removedUsers: [],
    keptUsers: [],
    skippedUsers: [],
    deletedUsers: [],
    error: null
  };
}

function writeReport(report: StaleKeywordUserPruneReport): void {
  const reportPath = reportFilePath(report.jobId);
  fsSync.mkdirSync(path.dirname(reportPath), { recursive: true });
  fsSync.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function assertStopNotRequested(jobId: string): void {
  const stopPath = stopRequestFilePath(jobId);
  if (!fsSync.existsSync(stopPath)) {
    return;
  }
  let reason = "admin_stop";
  try {
    const parsed = JSON.parse(fsSync.readFileSync(stopPath, "utf8")) as { reason?: string };
    if (typeof parsed.reason === "string" && parsed.reason.trim()) {
      reason = parsed.reason.trim();
    }
  } catch {
    // A present stop file is enough to stop the job.
  }
  throw new StopRequestedError(reason);
}

function recordSkippedKeywordUser(lists: ListService, candidate: KeywordUserCandidate, reason: string): void {
  lists.markDeleted("skipped_keyword_user", candidate.keyword);
  lists.add("skipped_keyword_user", candidate.keyword, `reason:${reason}`, null, new Date().toISOString());
}

function reportFilePath(jobId: string): string {
  return path.join(process.cwd(), "runtime", `stale-keyword-user-prune-${safePathSegment(jobId)}.json`);
}

function stopRequestFilePath(jobId: string): string {
  return path.join(process.cwd(), "runtime", "stale-keyword-user-prune-stops", `${safePathSegment(jobId)}.stop`);
}

function readResumeState(resumeStatePath: string | null): PruneResumeState {
  if (!resumeStatePath) {
    return emptyResumeState();
  }
  try {
    const parsed = JSON.parse(fsSync.readFileSync(resolveResumeStatePath(resumeStatePath), "utf8")) as Partial<PruneResumeState>;
    const checkedUsers = Array.isArray(parsed.checkedUsers)
      ? parsed.checkedUsers
          .map((user) => ({
            keyword: typeof user.keyword === "string" ? user.keyword : "",
            handle: normalizeHandle(typeof user.handle === "string" ? user.handle : user.keyword) ?? "",
            status:
              user.status === "remove" ||
              user.status === "keep" ||
              user.status === "skip" ||
              user.status === "delete_keyword" ||
              user.status === "already_stale"
                ? user.status
                : "skip",
            jobId: typeof user.jobId === "string" ? user.jobId : "",
            checkedAt: typeof user.checkedAt === "string" ? user.checkedAt : new Date().toISOString()
          }))
          .filter((user) => user.handle)
      : [];
    return {
      schemaVersion: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      checkedUsers
    };
  } catch {
    return emptyResumeState();
  }
}

function markResumeUser(
  resumeStatePath: string | null,
  candidate: KeywordUserCandidate,
  status: ResumeCheckedUser["status"],
  jobId: string
): void {
  if (!resumeStatePath) {
    return;
  }
  const state = readResumeState(resumeStatePath);
  const checkedAt = new Date().toISOString();
  const existingIndex = state.checkedUsers.findIndex((user) => user.handle === candidate.handle);
  const entry = {
    keyword: candidate.keyword,
    handle: candidate.handle,
    status,
    jobId,
    checkedAt
  };
  if (existingIndex >= 0) {
    state.checkedUsers[existingIndex] = entry;
  } else {
    state.checkedUsers.push(entry);
  }
  state.updatedAt = checkedAt;
  const resolvedPath = resolveResumeStatePath(resumeStatePath);
  fsSync.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fsSync.writeFileSync(resolvedPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function emptyResumeState(): PruneResumeState {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), checkedUsers: [] };
}

function resolveResumeStatePath(resumeStatePath: string): string {
  return path.isAbsolute(resumeStatePath) ? resumeStatePath : path.resolve(process.cwd(), resumeStatePath);
}

function selectBrowserAccount(service: XBrowserAccountService, vpnProfilePath: string): XBrowserAccountRecord {
  const account = service.findByVpnProfilePath(vpnProfilePath);
  if (!account) {
    throw new Error(`No X browser account is linked to VPN profile: ${vpnProfilePath}`);
  }
  return account;
}

function browserPacingConfig(config: ReturnType<typeof loadConfig>): HumanPacingConfig {
  return {
    keyDelayMinMs: config.searchWithoutApiKeyDelayMinMs,
    keyDelayMaxMs: config.searchWithoutApiKeyDelayMaxMs,
    scrollDelayMs: config.searchWithoutApiScrollDelayMs,
    scrollDelayMinMs: config.searchWithoutApiScrollDelayMinMs,
    scrollDelayMaxMs: config.searchWithoutApiScrollDelayMaxMs,
    tweetHoverMinSeconds: config.searchWithoutApiTweetHoverMinSeconds,
    tweetHoverMaxSeconds: config.searchWithoutApiTweetHoverMaxSeconds
  };
}

function browserLaunchOptions(
  config: ReturnType<typeof loadConfig>,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
) {
  const executablePath = config.playwrightChromiumExecutablePath || findChromiumExecutable();
  if (!executablePath) {
    throw new Error("No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH in Settings.");
  }
  const display = detectGraphicalDisplay();
  const showLocal = config.searchWithoutApiShowBrowserLocal && display.available;
  const headless = showLocal ? false : true;
  if (config.searchWithoutApiShowBrowserLocal && !display.available) {
    void record("prob", "browser.display.unavailable", "Local live browser display requested but no Wayland/X11 display is available; using headless mode.", {
      reason: display.label
    });
  }
  return {
    executablePath,
    headless,
    args: [
      ...display.launchArgs,
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      ...(config.playwrightDisableSandbox && process.getuid?.() === 0 ? ["--no-sandbox"] : [])
    ]
  };
}

function detectGraphicalDisplay(): { available: boolean; label: string; launchArgs: string[] } {
  const sessionType = process.env.XDG_SESSION_TYPE?.toLowerCase();
  const waylandDisplay = process.env.WAYLAND_DISPLAY;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const waylandSocket = waylandDisplay && runtimeDir ? path.join(runtimeDir, waylandDisplay) : undefined;
  const hasWayland = Boolean(waylandSocket && fsSync.existsSync(waylandSocket));
  const x11Display = process.env.DISPLAY;
  const x11Socket = x11Display ? x11SocketPath(x11Display) : undefined;
  const hasX11 = Boolean(x11Display && (!x11Socket || fsSync.existsSync(x11Socket)));
  if (sessionType === "wayland" && hasWayland) {
    return { available: true, label: `Wayland (${waylandSocket})`, launchArgs: ["--ozone-platform=wayland", "--enable-features=UseOzonePlatform"] };
  }
  if (hasX11) {
    return { available: true, label: `X11 (${x11Display})`, launchArgs: ["--ozone-platform=x11"] };
  }
  if (hasWayland) {
    return { available: true, label: `Wayland (${waylandSocket})`, launchArgs: ["--ozone-platform=wayland", "--enable-features=UseOzonePlatform"] };
  }
  return { available: false, label: "No Wayland or X11 display detected.", launchArgs: [] };
}

function x11SocketPath(display: string): string | undefined {
  const match = display.match(/:(\d+)/);
  return match ? `/tmp/.X11-unix/X${match[1]}` : undefined;
}

function findChromiumExecutable(): string | undefined {
  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable"
  ].find((candidate) => fsSync.existsSync(candidate));
}

function publicIpv4FromReport(report: VpnDiagnosticsReport): string | null {
  const value = report.checks.publicIpv4?.value;
  return typeof value === "string" ? value : null;
}

function isLatestSearchUrl(value: string): boolean {
  try {
    return new URL(value).searchParams.get("f") === "live";
  } catch {
    return false;
  }
}

function safePathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "job"
  );
}

function parseArgs(args: string[]): PrunerArgs {
  let maxAgeDays = 90;
  let jobId = `stale-users-${Date.now()}`;
  let resumeStatePath: string | null = null;
  let startIndex = 1;
  let mode: KeywordUserPruneMode = "without_api";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--max-age-days" && next) {
      maxAgeDays = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-age-days=")) {
      maxAgeDays = Number(arg.slice("--max-age-days=".length));
      continue;
    }
    if (arg === "--job-id" && next) {
      jobId = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--job-id=")) {
      jobId = arg.slice("--job-id=".length);
      continue;
    }
    if (arg === "--resume-state-path" && next) {
      resumeStatePath = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--resume-state-path=")) {
      resumeStatePath = arg.slice("--resume-state-path=".length);
      continue;
    }
    if (arg === "--start-index" && next) {
      startIndex = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--start-index=")) {
      startIndex = Number(arg.slice("--start-index=".length));
      continue;
    }
    if (arg === "--mode" && next) {
      mode = parsePruneMode(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = parsePruneMode(arg.slice("--mode=".length));
      continue;
    }
  }
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    throw new Error("--max-age-days must be a positive number.");
  }
  if (!Number.isFinite(startIndex) || startIndex < 1) {
    throw new Error("--start-index must be a positive number.");
  }
  return { maxAgeDays, jobId, resumeStatePath, startIndex: Math.floor(startIndex), mode };
}

function parsePruneMode(value: string): KeywordUserPruneMode {
  if (value === "without_api" || value === "x_api") {
    return value;
  }
  throw new Error(`Unsupported stale keyword user prune mode: ${value}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(error instanceof ManualVerificationRequiredError || error instanceof XSessionAlertOpenError ? 2 : 1);
  });
}
