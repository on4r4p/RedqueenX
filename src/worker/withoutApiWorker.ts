import "dotenv/config";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { loadConfig, type AppConfig } from "../config";
import { Crawler } from "../crawler";
import { openDatabase } from "../db/database";
import { formatDiagnosticsReport, runVpnDiagnostics, type VpnDiagnosticsReport } from "../diagnostics/vpn";
import { runRssFallback as runSharedRssFallback } from "../rssFallback";
import { RedditCrawler } from "../reddit/redditCrawler";
import { crawlRedditKeywords } from "../reddit/redditTimeline";
import { CurrentSessionService, type CurrentSessionLevel } from "../admin/currentSessionService";
import { ListService } from "../admin/listService";
import { RunService, parseRunStats } from "../admin/runService";
import { SettingsService } from "../admin/settingsService";
import { RawTimelineTweetService, type RawTimelineDecisionUpdate } from "../admin/rawTimelineTweetService";
import { TimelineTweetService } from "../admin/timelineTweetService";
import { TimelineItemService } from "../admin/timelineItemService";
import { XBrowserAccountService, type XBrowserAccountRecord } from "../admin/xBrowserAccountService";
import {
  defaultManualVerificationMessage,
  defaultManualVerificationRecommendation,
  XSessionAlertService,
  type XSessionAlertType
} from "../admin/xSessionAlertService";
import { isHandleSearchKeyword, normalizeHandle, normalizeSearchText, normalizeValue } from "../text";
import type { RunRecord, RunStats, ScoringConfig, TweetCandidate } from "../types";
import {
  buildBrowserSearchQuery,
  buildBrowserSearchUrl,
  detectManualVerification,
  extractVisibleTweets,
  gotoWithTransientRetry,
  sameManualVerificationDetection,
  type ManualVerificationDetection
} from "./browserSearch";
import { shouldDisableChromiumSandbox } from "./chromiumSandbox";
import {
  hoverVisibleTweets,
  focusLocatorForTyping,
  nextMouseProfile,
  randomDelayMs,
  randomInt,
  scrollWithPacing,
  type MouseProfile,
  type HumanPacingConfig,
  typeWithPacing
} from "./humanPacing";
import { assertVpnRuntime } from "./vpnGuard";

interface WorkerArgs {
  runId?: string;
  smoke?: boolean;
  keyword?: string;
}

const SMOKE_KEYWORDS = ["hack", "sql injection", "last cve", "xss"] as const;
const manualVerificationRefreshRetryDelayMs = 10_000;

interface PageSnapshot {
  phase: "before_search" | "after_search";
  keyword: string;
  url: string;
  title: string;
  articleCount: number;
  tweetTextCount: number;
  searchInputVisible: boolean;
  fullTextLength: number;
  snapshotFile: string | null;
  bodyText: string;
}

interface BrowserSearchTimings {
  totalMs: number;
  openSearchMs: number;
  preSearchDelayMs: number;
  submitSearchMs: number;
  extractInitialMs: number;
  scrollMs: number;
}

interface BrowserKeywordSummary {
  keyword: string;
  searchQuery: string;
  searchUrl: string;
  latestModeForced: boolean;
  retweetFilterApplied: boolean;
  visibleTweets: number;
  usableTweets: number;
  acceptedTweets: number;
  rejectedTweets: number;
  scrollsPerformed: number;
  preSearchDelayMs: number;
  timings: BrowserSearchTimings;
  noResultSaved: boolean;
  prefilterReasonCounts: Record<string, number>;
  scoringReasonCounts: Record<string, number>;
  beforeSearch: PageSnapshot;
  afterSearch: PageSnapshot;
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

const throwingXClient = {
  async searchRecent(): Promise<TweetCandidate[]> {
    throw new Error("Browser worker does not use the X API search client.");
  },
  async lookupTweetsDetailed(): Promise<TweetCandidate[]> {
    throw new Error("Browser worker does not hydrate tweets through the X API.");
  },
  async countRecent(): Promise<number> {
    throw new Error("Browser worker does not count through the X API.");
  }
};

function xLoginCommand(accountId: number, config: Pick<AppConfig, "searchWithoutApiIsolation">): string {
  return config.searchWithoutApiIsolation === "docker_vpn"
    ? `docker compose run --rm --service-ports x-login --account-id ${accountId}`
    : `npm run netns:x-login -- --account-id ${accountId}`;
}

function manualVerificationRecommendation(accountId: number, config: Pick<AppConfig, "searchWithoutApiIsolation" | "xLoginNovncPort">): string {
  if (config.searchWithoutApiIsolation !== "docker_vpn") {
    return defaultManualVerificationRecommendation(accountId);
  }
  const noVncUrl = dockerNoVncUrl(config.xLoginNovncPort);
  const tunnelCommand = dockerNoVncTunnelCommand(config.xLoginNovncPort);
  return [
    "No more scraping or login will run for this X account until this alert is resolved.",
    "Log in manually from the usual IP/VPN profile used by this X account.",
    "Let the human solve CAPTCHA/2FA/challenge manually.",
    "The Docker visible login flow uses noVNC, so it works without host Wayland/X11 forwarding.",
    `If RedqueenX runs on a VPS, keep x-login running on the VPS and run this tunnel from your local PC: ${tunnelCommand}.`,
    `Then open ${noVncUrl} in your local browser.`,
    "Return here after the session is saved, then mark the alert as resolved with a note.",
    `Recommended Docker commands: docker compose run --rm --service-ports x-login --account-id ${accountId} --resolve-alert; open the noVNC URL printed by the command; press Enter in the terminal after X is visibly logged in; docker compose exec worker npm run diagnose:vpn.`
  ].join(" ");
}

function manualVerificationCommands(accountId: number, config: Pick<AppConfig, "searchWithoutApiIsolation" | "xLoginNovncPort">): string[] {
  return config.searchWithoutApiIsolation === "docker_vpn"
    ? [
        `docker compose run --rm --service-ports x-login --account-id ${accountId} --resolve-alert`,
        `noVNC URL: ${dockerNoVncUrl(config.xLoginNovncPort)}`,
        "If RedqueenX runs on a VPS, keep x-login running on the VPS and run this from your local PC:",
        dockerNoVncTunnelCommand(config.xLoginNovncPort),
        `Then open locally: ${dockerNoVncUrl(config.xLoginNovncPort)}`,
        "docker compose exec worker npm run diagnose:vpn",
        "docker compose up -d worker"
      ]
    : [
        "npm run setup:local",
        `npm run netns:x-login -- --account-id ${accountId} --resolve-alert --auto-save-on-login --hold-open-after-save`,
        "npm run netns:diagnose",
        "npm run netns:worker"
      ];
}

function dockerNoVncUrl(port: number): string {
  return `http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=scale`;
}

function dockerNoVncTunnelCommand(port: number): string {
  return `ssh -L ${port}:127.0.0.1:${port} <user>@<vps-host>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (!config.searchWithoutApiEnabled) {
    throw new Error("SEARCH_WITHOUT_API_ENABLED must be true before starting the without-API crawler worker.");
  }

  const database = openDatabase(config.databaseUrl);
  const lists = new ListService(database);
  const runs = new RunService(database);
  const settings = new SettingsService(database);
  const rawTimelineTweets = new RawTimelineTweetService(database);
  const timelineTweets = new TimelineTweetService(database);
  const timelineItems = new TimelineItemService(database);
  const accounts = new XBrowserAccountService(database);
  const alerts = new XSessionAlertService(database);
  const currentSession = new CurrentSessionService(config.currentSessionFile);

  const record = (level: CurrentSessionLevel, type: string, message: string, data: Record<string, unknown> = {}) =>
    currentSession.record(level, type, message, data).catch(() => undefined);
  let mediaCacheFetchQueue: Promise<void> = Promise.resolve();
  const queueAcceptedTweetMediaCache = (tweetId: string, mediaCount: number) => {
    if (!config.searchWithoutApiMediaCacheEnabled || mediaCount <= 0) {
      return;
    }
    mediaCacheFetchQueue = mediaCacheFetchQueue
      .catch(() => undefined)
      .then(() => runMediaCacheFetchProcess(tweetId, config, record));
  };

  let browser: Browser | null = null;
  let account: XBrowserAccountRecord | null = null;
  let run: RunRecord | null = null;
  let publicIpv4: string | null = null;

  try {
    await assertVpnRuntime(config, "Without-API crawler worker");
    const report = await runVpnDiagnostics({ includePlaywright: true, strict: true });
    console.log(formatDiagnosticsReport(report));
    await record("info", "browser.vpn.diagnostics", "Without-API VPN diagnostics completed", {
      checksPassed: report.failures.length === 0,
      failures: report.failures,
      publicIpv4: publicIpv4FromReport(report)
    });
    if (report.failures.length > 0) {
      throw new Error("VPN diagnostics failed; refusing to start the without-API crawler worker.");
    }
    publicIpv4 = publicIpv4FromReport(report);

    account = selectBrowserAccount(accounts, config.vpnConfig);
    alerts.openForAccountOrThrow(account);
    if (!account.storageStateExists || account.sessionStatus !== "valid") {
      throw new Error(`X browser session for ${account.xIdentifier} is not ready. Run ${xLoginCommand(account.id, config)}.`);
    }

    if (args.smoke && runs.current()) {
      throw new Error("Smoke test refuses to start while another run is active. Stop the current run first.");
    }
    const keywordPlan = args.smoke ? await planSmokeKeywords(args.keyword) : planBrowserKeywords(lists, config);
    run = args.runId ? runs.get(args.runId) : runs.current();
    if (!run) {
      run = runs.start(createBrowserRunStats(keywordPlan.keywords.length, config, keywordPlan.availableKeywords));
    }
    if (run.status === "paused") {
      run = runs.resume(run.id);
    }

    const existingStats = parseRunStats(run.statsJson);
    const existingKeywords = args.smoke ? [] : runs.keywords(run.id, 5_000).map((item) => item.keyword);
    const canReuseExistingPlan =
      existingKeywords.length > 0 &&
      existingStats.completedKeywords < existingKeywords.length &&
      existingStats.remainingKeywords > 0 &&
      (existingStats.completedKeywords > 0 || browserRunPlanMatchesConfig(existingStats, config));
    const keywords = canReuseExistingPlan ? existingKeywords : keywordPlan.keywords;
    if (!canReuseExistingPlan) {
      runs.replaceKeywords(run.id, keywords);
      runs.updateStats(run.id, createBrowserRunStats(keywords.length, config, keywordPlan.availableKeywords, existingStats));
    } else {
      runs.updateStats(run.id, { currentKeyword: null, nextApiResetAt: null });
    }
    await record(
      "info",
      args.smoke ? "browser.search.smoke.plan" : canReuseExistingPlan ? "browser.search.plan.resumed" : "browser.search.plan",
      args.smoke
        ? "Without-API smoke test plan prepared"
        : canReuseExistingPlan
          ? "Without-API browser search resumed from existing keyword plan"
          : "Without-API browser search plan prepared",
      {
        runId: run.id,
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        vpnProfilePath: config.vpnConfig,
        totalKeywords: keywords.length,
        completedKeywords: canReuseExistingPlan ? existingStats.completedKeywords : 0,
        remainingKeywords: canReuseExistingPlan ? existingStats.remainingKeywords : keywords.length,
        resumedExistingPlan: canReuseExistingPlan,
        availableKeywords: canReuseExistingPlan ? existingStats.availableKeywords : keywordPlan.availableKeywords,
        keywordTotal: canReuseExistingPlan ? undefined : keywordPlan.keywordTotal,
        noResultKeywords: canReuseExistingPlan ? undefined : keywordPlan.noResultKeywords,
        searchTermsUsedKeywords: canReuseExistingPlan ? undefined : keywordPlan.searchTermsUsedKeywords,
        excludedNoResultKeywords: canReuseExistingPlan ? undefined : keywordPlan.excludedNoResultKeywords,
        excludedAlreadySearchedKeywords: canReuseExistingPlan ? undefined : keywordPlan.excludedAlreadySearchedKeywords,
        sessionKeywordLimit: canReuseExistingPlan ? existingStats.sessionKeywordLimit : keywordPlan.configuredLimit,
        randomSessionKeywordLimit: canReuseExistingPlan ? existingStats.sessionKeywordLimitRandom : keywordPlan.randomized,
        randomizeKeywordOrder: canReuseExistingPlan ? existingStats.randomizeKeywordOrder : keywordPlan.orderRandomized,
        oneKeywordPerSearch: true,
        smokeTest: Boolean(args.smoke),
        smokeKeywordPool: args.smoke ? SMOKE_KEYWORDS : undefined
      }
    );
    if (!args.smoke && keywords.length === 0) {
      await record(
        "prob",
        "browser.search.no_eligible_keywords",
        "No eligible keyword remains. Active keywords are already in SearchTerms.Used or No.Result; clear one of those lists to search again.",
        {
          runId: run.id,
          totalKeywords: keywordPlan.keywordTotal,
          availableKeywords: keywordPlan.availableKeywords,
          noResultKeywords: keywordPlan.noResultKeywords,
          searchTermsUsedKeywords: keywordPlan.searchTermsUsedKeywords,
          excludedNoResultKeywords: keywordPlan.excludedNoResultKeywords,
          excludedAlreadySearchedKeywords: keywordPlan.excludedAlreadySearchedKeywords,
          sessionKeywordLimit: keywordPlan.configuredLimit
        }
      );
    }

    browser = await chromium.launch(browserLaunchOptions(config, record));
    const context = await browser.newContext({
      storageState: path.resolve(process.cwd(), account.storageStatePath),
      viewport: { width: 1366, height: 900 }
    });
    const page = await context.newPage();

    const crawler = new Crawler(
      lists,
      throwingXClient,
      () => settings.getScoringConfig(),
      (result) => {
        if (args.smoke) {
          timelineTweets.saveAcceptedFromTest(result.keyword, result.tweet, result.decision);
        } else {
          timelineTweets.saveAccepted(result.keyword, result.tweet, result.decision);
        }
        if (!args.smoke) {
          queueAcceptedTweetMediaCache(result.tweet.id, result.tweet.entities?.media?.length ?? 0);
        }
      }
    );

    await runBrowserSearchLoop({
      page,
      runId: run.id,
      keywords,
      account,
      publicIpv4,
      config,
      lists,
      runs,
      settings,
      alerts,
      record,
      crawler,
      rawTimelineTweets,
      timelineItems,
      smoke: args.smoke
    });
  } catch (error) {
    if (error instanceof ManualVerificationRequiredError && account) {
      const alert = alerts.createOpen({
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        vpnProfilePath: config.vpnConfig,
        publicIpv4: error.publicIpv4,
        alertType: error.alertType,
        message: defaultManualVerificationMessage(),
        recommendation: manualVerificationRecommendation(account.id, config),
        details: error.details
      });
      accounts.markStatus(account.id, "needs_login");
      if (run) {
        safePauseRun(runs, run.id);
      }
      await record("prob", "x.manual_verification.required", "X manual verification required; browser worker stopped", {
        alertId: alert.id,
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        vpnProfilePath: config.vpnConfig,
        publicIpv4: error.publicIpv4,
        alertType: error.alertType,
        message: alert.message,
        reason: error.reason,
        recommendation: alert.recommendation,
        details: summarizeAlertDetails(error.details),
        commands: manualVerificationCommands(account.id, config)
      });
      if (config.searchWithoutApiIsolation === "host_netns") {
        requestVpnTeardown(record, config.vpnNetnsName);
      }
      throw error;
    }
    if (run) {
      safeStopRun(runs, run.id);
      await record("prob", args.smoke ? "browser.search.smoke.failed" : "browser.search.failed", "Without-API browser worker failed; run stopped", {
        runId: run.id,
        smokeTest: Boolean(args.smoke),
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    database.close();
  }
}

function requestVpnTeardown(
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>,
  namespace: string
): void {
  const child = spawn("sudo", ["-n", "./ops/netns/teardown.sh"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  void record("prob", "vpn.teardown.requested", "VPN namespace teardown requested after X manual verification alert", {
    namespace,
    pid: child.pid,
    leakProtection: "Browser worker stopped and namespace teardown was requested with sudo -n."
  });
}

async function runBrowserSearchLoop(input: {
  page: Page;
  runId: string;
  keywords: string[];
  account: XBrowserAccountRecord;
  publicIpv4: string | null;
  config: ReturnType<typeof loadConfig>;
  lists: ListService;
  runs: RunService;
  settings: SettingsService;
  alerts: XSessionAlertService;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
  crawler: Crawler;
  rawTimelineTweets: RawTimelineTweetService;
  timelineItems: TimelineItemService;
  smoke?: boolean;
}) {
  const pacing = browserPacingConfig(input.config);
  let previousMouseProfile: MouseProfile | null = null;
  const initialStats = parseRunStats(input.runs.get(input.runId)?.statsJson ?? "{}");
  let completedKeywords = initialStats.completedKeywords;
  let acceptedTotal = Math.max(0, Math.floor(Number(initialStats.acceptedTweets) || 0));
  let rejectedTotal = Math.max(0, Math.floor(Number(initialStats.rejectedTweets) || 0));
  let searchesInWindow = 0;
  const keywordSummaries: BrowserKeywordSummary[] = [];
  let searchesBeforePause = searchesBeforePauseForKeywords(input.keywords.length - completedKeywords, input.config);

  while (completedKeywords < input.keywords.length) {
    const run = await waitUntilRunnable(input.runs, input.runId);
    if (!run) {
      await input.record("info", "browser.search.stopped", "Without-API browser search stopped", { runId: input.runId });
      return;
    }

    input.alerts.openForAccountOrThrow(input.account);
    const keyword = input.keywords[completedKeywords];
    previousMouseProfile = nextMouseProfile(previousMouseProfile, input.config.searchWithoutApiMouseProfile);
    input.runs.updateStats(input.runId, {
      currentKeyword: keyword,
      completedKeywords,
      remainingKeywords: Math.max(0, input.keywords.length - completedKeywords),
      apiCallsUsed: searchesInWindow,
      apiCallLimit: searchesBeforePause,
      apiCallsRemaining: Math.max(0, searchesBeforePause - searchesInWindow)
    });
    await input.record("info", "browser.search.keyword.started", "Searching one keyword without API", {
      runId: input.runId,
      keyword,
      position: completedKeywords + 1,
      totalKeywords: input.keywords.length,
      mouseProfile: previousMouseProfile,
      oneKeywordPerSearch: true
    });

    const scoringConfig = input.settings.getScoringConfig();
    const retweetFilterApplied = shouldApplyBrowserRetweetFilter(scoringConfig);
    let search: Awaited<ReturnType<typeof searchOneKeyword>>;
    try {
      search = await searchOneKeyword(input.page, keyword, previousMouseProfile, pacing, input.config, input.publicIpv4, {
        smoke: input.smoke,
        runId: input.runId,
        position: completedKeywords + 1,
        saveSnapshots: Boolean(input.smoke || input.config.searchWithoutApiSaveSnapshots),
        retweetFilterApplied,
        minimumRetweetsEnabled: scoringConfig.enableMinimumTweetRetweets,
        minimumTweetRetweets: scoringConfig.minimumTweetRetweets,
        record: input.record
      });
    } catch (error) {
      if (error instanceof ManualVerificationRequiredError || !isRecoverableBrowserTimeoutError(error)) {
        throw error;
      }
      completedKeywords += 1;
      searchesInWindow += 1;
      input.runs.updateStats(input.runId, {
        currentKeyword: null,
        totalKeywords: input.keywords.length,
        completedKeywords,
        remainingKeywords: Math.max(0, input.keywords.length - completedKeywords),
        apiCallsUsed: searchesInWindow,
        apiCallLimit: searchesBeforePause,
        apiCallsRemaining: Math.max(0, searchesBeforePause - searchesInWindow),
        acceptedTweets: acceptedTotal,
        rejectedTweets: rejectedTotal
      });
      await input.record("prob", "browser.search.keyword.timeout_skipped", "Browser keyword search timed out; skipping keyword and continuing", {
        runId: input.runId,
        keyword,
        position: completedKeywords,
        totalKeywords: input.keywords.length,
        error: error instanceof Error ? error.message : String(error),
        searchTermsUsedSaved: false,
        noResultSaved: false
      });
      if (completedKeywords < input.keywords.length) {
        const delayMs = randomDelayMs(
          input.config.searchWithoutApiSearchDelayMinSeconds * 1000,
          input.config.searchWithoutApiSearchDelayMaxSeconds * 1000
        );
        await interruptibleDelay(input.runs, input.runId, Math.floor(delayMs / 2));
      }
      continue;
    }
    const tweets = search.tweets;
    const rawTimelineEnabled = input.settings.getXApiConfig(input.config).rawTimelineEnabled;
    if (rawTimelineEnabled) {
      const rawSaved = input.rawTimelineTweets.saveVisible(input.runId, keyword, tweets);
      await input.record("debug", "browser.raw_timeline.saved", "Visible browser tweets saved to raw timeline", {
        runId: input.runId,
        keyword,
        visibleTweets: tweets.length,
        savedTweets: rawSaved,
        scoringIndependent: true
      });
    }
    const prefilterResults = input.crawler.explainTweetsForHydration(keyword, tweets);
    const prefilterRejected = prefilterResults.filter((result) => !result.decision.accepted);
    const selectedTweets = prefilterResults.filter((result) => result.decision.accepted).map((result) => result.tweet);
    const scored = input.crawler.scoreTweets(keyword, selectedTweets);
    if (rawTimelineEnabled) {
      const rawDecisionUpdates: RawTimelineDecisionUpdate[] = [
        ...prefilterRejected.map((result) => ({
          tweetId: result.tweet.id,
          status: "rejected" as const,
          stage: "prefilter" as const,
          score: null,
          reasons: result.decision.reasons
        })),
        ...scored.map((result) => ({
          tweetId: result.tweet.id,
          status: result.decision.accepted ? ("accepted" as const) : ("rejected" as const),
          stage: result.decision.accepted ? ("accepted" as const) : ("scoring" as const),
          score: result.decision.score,
          reasons: result.decision.reasons
        }))
      ];
      const rawDecisionsSaved = input.rawTimelineTweets.saveDecisions(input.runId, rawDecisionUpdates);
      await input.record("debug", "browser.raw_timeline.decisions_saved", "Raw timeline tweets enriched with scoring decisions", {
        runId: input.runId,
        keyword,
        decisions: rawDecisionUpdates.length,
        updatedTweets: rawDecisionsSaved
      });
    }
    const accepted = scored.filter((result) => result.decision.accepted).length;
    const scoringRejected = scored.filter((result) => !result.decision.accepted);
    const rejected = prefilterRejected.length + scoringRejected.length;
    acceptedTotal += accepted;
    rejectedTotal += rejected;
    const prefilterReasonCounts = countReasonOccurrences(prefilterRejected.flatMap((result) => result.decision.reasons));
    const scoringReasonCounts = countReasonOccurrences(scoringRejected.flatMap((result) => result.decision.reasons));
    let staleKeywordUserMoved = false;
    try {
      staleKeywordUserMoved = await maybeMoveStaleKeywordUserFromTooOldResults({
        page: input.page,
        keyword,
        visibleTweets: tweets.length,
        tooOldTweets: countReasonsByPrefix(prefilterReasonCounts, "tweet_too_old"),
        mouseProfile: previousMouseProfile,
        pacing,
        config: input.config,
        publicIpv4: input.publicIpv4,
        lists: input.lists,
        runId: input.runId,
        position: completedKeywords + 1,
        smoke: input.smoke,
        record: input.record
      });
    } catch (error) {
      if (error instanceof ManualVerificationRequiredError || !isRecoverableBrowserTimeoutError(error)) {
        throw error;
      }
      await input.record("prob", "browser.keyword_user_stale_check.timeout_skipped", "Keyword user stale check timed out; keeping keyword for now", {
        runId: input.runId,
        keyword,
        position: completedKeywords + 1,
        totalKeywords: input.keywords.length,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await input.record("debug", "browser.scoring.summary", "Browser scoring summary for keyword", {
      runId: input.runId,
      keyword,
      visibleTweets: tweets.length,
      prefilterAccepted: selectedTweets.length,
      prefilterRejected: prefilterRejected.length,
      scoringAccepted: accepted,
      scoringRejected: scoringRejected.length,
      totalRejected: rejected,
      minimumSearchResultsEnabled: scoringConfig.enableMinimumSearchResults,
      minimumSearchResults: scoringConfig.minimumSearchResults,
      prefilterReasonCounts,
      scoringReasonCounts
    });
    for (const result of prefilterRejected) {
      await input.record("debug", "tweet.prefilter_rejected", "Browser visible tweet rejected before scoring", {
        runId: input.runId,
        keyword,
        tweetId: result.tweet.id,
        author: result.tweet.user.screenName,
        createdAt: result.tweet.createdAt?.toISOString() ?? null,
        accepted: false,
        score: null,
        reasons: result.decision.reasons,
        favoriteCount: result.tweet.favoriteCount ?? 0,
        retweetCount: result.tweet.retweetCount ?? 0,
        mediaCount: result.tweet.entities?.media?.length ?? 0,
        urlCount: result.tweet.entities?.urls?.length ?? 0,
        text: result.tweet.text
      });
    }
    for (const result of scored) {
      await input.record("debug", result.decision.accepted ? "tweet.received" : "tweet.scoring_rejected", result.decision.accepted ? "Browser tweet accepted" : "Browser tweet rejected by scoring", {
        runId: input.runId,
        keyword,
        tweetId: result.tweet.id,
        author: result.tweet.user.screenName,
        createdAt: result.tweet.createdAt?.toISOString() ?? null,
        accepted: result.decision.accepted,
        score: result.decision.score,
        scoreBreakdown: result.decision.scoreBreakdown,
        reasons: result.decision.reasons,
        favoriteCount: result.tweet.favoriteCount ?? 0,
        retweetCount: result.tweet.retweetCount ?? 0,
        mediaCount: result.tweet.entities?.media?.length ?? 0,
        urlCount: result.tweet.entities?.urls?.length ?? 0,
        text: result.tweet.text
      });
    }

    const importedAt = new Date().toISOString();
    if (!input.smoke) {
      const entry = input.lists.add("search_terms_used", keyword, "runtime:browser-search", null, importedAt);
      await input.record("debug", "browser.list.search_terms_used.saved", "Keyword saved to SearchTerms.Used", {
        runId: input.runId,
        keyword,
        entryId: entry.id,
        sourceFile: entry.sourceFile
      });
    } else {
      await input.record("debug", "browser.list.search_terms_used.skipped", "Smoke test did not save keyword to SearchTerms.Used", {
        runId: input.runId,
        keyword
      });
    }
    const usableTweets = selectedTweets.length;
    const noVisibleResult =
      isBelowMinimumSearchResults(scoringConfig.enableMinimumSearchResults, tweets.length, scoringConfig.minimumSearchResults) &&
      !staleKeywordUserMoved;
    keywordSummaries.push({
      keyword,
      searchQuery: search.searchQuery,
      searchUrl: search.searchUrl,
      latestModeForced: search.latestModeForced,
      retweetFilterApplied: search.retweetFilterApplied,
      visibleTweets: tweets.length,
      usableTweets,
      acceptedTweets: accepted,
      rejectedTweets: Math.max(0, rejected),
      scrollsPerformed: search.scrollsPerformed,
      preSearchDelayMs: search.preSearchDelayMs,
      timings: search.timings,
      noResultSaved: noVisibleResult && !input.smoke,
      prefilterReasonCounts,
      scoringReasonCounts,
      beforeSearch: search.beforeSearch,
      afterSearch: search.afterSearch
    });
    if (noVisibleResult && !input.smoke) {
      const entry = input.lists.add("no_result", keyword, "runtime:browser-search", null, importedAt);
      await input.record("info", "browser.search.no_result.saved", "Keyword saved to No.Result after browser search", {
        runId: input.runId,
        keyword,
        entryId: entry.id,
        visibleTweets: tweets.length,
        usableTweets
      });
      await input.record("debug", "browser.list.no_result.saved", "Keyword saved to No.Result", {
        runId: input.runId,
        keyword,
        entryId: entry.id,
        reason: "visible_tweets_below_minimum",
        minimumSearchResults: scoringConfig.minimumSearchResults,
        visibleTweets: tweets.length,
        usableTweets
      });
    } else {
      await input.record("debug", "browser.list.no_result.skipped", "Keyword was not saved to No.Result", {
        runId: input.runId,
        keyword,
        smokeTest: Boolean(input.smoke),
        minimumSearchResultsEnabled: scoringConfig.enableMinimumSearchResults,
        minimumSearchResults: scoringConfig.minimumSearchResults,
        visibleTweets: tweets.length,
        usableTweets
      });
    }
    for (const result of scored.filter((item) => item.decision.accepted)) {
      await input.record("debug", "browser.timeline.accepted_saved", "Accepted browser tweet saved to timeline and sent lists", {
        runId: input.runId,
        keyword,
        tweetId: result.tweet.id,
        author: result.tweet.user.screenName,
        score: result.decision.score,
        source: input.smoke ? "from test" : "tweet",
        listWrites: ["tweet_sent", "text_sent", "timeline_tweets"]
      });
    }

    completedKeywords += 1;
    searchesInWindow += 1;
    input.runs.updateStats(input.runId, {
      currentKeyword: keyword,
      totalKeywords: input.keywords.length,
      completedKeywords,
      remainingKeywords: Math.max(0, input.keywords.length - completedKeywords),
      apiCallsUsed: searchesInWindow,
      apiCallLimit: searchesBeforePause,
      apiCallsRemaining: Math.max(0, searchesBeforePause - searchesInWindow),
      browserAlertAutoIgnore: input.config.searchWithoutApiAutoIgnoreAlert,
      browserAlertMaxRetries: input.config.searchWithoutApiMaxRetries,
      browserAlertAutoRestartDelaySeconds: input.config.searchWithoutApiAutoRestartDelaySeconds,
      browserAlertRetryCount: 0,
      browserAlertAutoRestartAt: null,
      browserAlertLastCompletedKeywords: completedKeywords,
      acceptedTweets: acceptedTotal,
      rejectedTweets: rejectedTotal,
      lastScore: scored[0]?.decision.score ?? null,
      lastTweetId: scored[0]?.tweet.id ?? null
    });
    await input.record("info", "browser.search.keyword.completed", "Without-API browser keyword search completed", {
      runId: input.runId,
      keyword,
      visibleTweets: tweets.length,
      usableTweets,
      acceptedTweets: accepted,
      rejectedTweets: rejected,
      noResultSaved: noVisibleResult && !input.smoke,
      smokeTest: Boolean(input.smoke),
      scrollsPerformed: search.scrollsPerformed,
      preSearchDelayMs: search.preSearchDelayMs,
      timings: search.timings,
      searchQuery: search.searchQuery,
      searchUrl: search.searchUrl,
      latestModeForced: search.latestModeForced,
      retweetFilterApplied: search.retweetFilterApplied,
      retweetFilterRule: {
        minimumRetweetsEnabled: scoringConfig.enableMinimumTweetRetweets,
        minimumTweetRetweets: scoringConfig.minimumTweetRetweets,
        appliedWhenMinimumRetweetsIsEnabledAndAboveZero: true
      },
      prefilterReasonCounts,
      scoringReasonCounts,
      snapshots: {
        before: search.beforeSearch.snapshotFile,
        after: search.afterSearch.snapshotFile
      },
      source: input.smoke ? "test" : "tweet"
    });
    await runBrowserRedditCrawl(input, [keyword]);
    if (searchesInWindow >= searchesBeforePause && completedKeywords < input.keywords.length) {
      const pauseMinutes = randomInt(input.config.searchWithoutApiPauseMinMinutes, input.config.searchWithoutApiPauseMaxMinutes);
      const nextResetAt = new Date(Date.now() + pauseMinutes * 60_000).toISOString();
      input.runs.updateStats(input.runId, { nextApiResetAt: nextResetAt });
      await input.record("info", "browser.search.pause_window", "Without-API search pacing pause started", {
        runId: input.runId,
        pauseMinutes,
        nextSearchWindow: nextResetAt
      });
      await runBrowserRssFallback(input, "browser_pause");
      await interruptibleDelay(input.runs, input.runId, pauseMinutes * 60_000);
      searchesInWindow = 0;
      searchesBeforePause = searchesBeforePauseForKeywords(input.keywords.length - completedKeywords, input.config);
      input.runs.updateStats(input.runId, {
        nextApiResetAt: null,
        apiCallsUsed: searchesInWindow,
        apiCallLimit: searchesBeforePause,
        apiCallsRemaining: searchesBeforePause
      });
      await input.record("info", "browser.search.pause_window.completed", "Without-API search pacing pause completed; run continues", {
        runId: input.runId,
        searchesBeforePause
      });
    } else if (completedKeywords < input.keywords.length) {
      const baseDelay = randomDelayMs(
        input.config.searchWithoutApiSearchDelayMinSeconds * 1000,
        input.config.searchWithoutApiSearchDelayMaxSeconds * 1000
      );
      await interruptibleDelay(input.runs, input.runId, noVisibleResult ? Math.floor(baseDelay / 2) : baseDelay);
    }
  }

  input.runs.updateStats(input.runId, { currentKeyword: null });
  await runBrowserRssFallback(input, "browser_completed");
  safeCompleteRun(input.runs, input.runId);
  await input.record("info", "browser.search.completed", "Without-API browser search run completed", {
    runId: input.runId,
    completedKeywords,
    acceptedTweets: acceptedTotal,
    rejectedTweets: rejectedTotal
  });
  console.log(
    formatBrowserRunSummary({
      runId: input.runId,
      smoke: Boolean(input.smoke),
      account: input.account.xIdentifier,
      vpnProfilePath: input.config.vpnConfig,
      publicIpv4: input.publicIpv4,
      completedKeywords,
      totalKeywords: input.keywords.length,
      acceptedTweets: acceptedTotal,
      rejectedTweets: rejectedTotal,
      keywordSummaries
    })
  );
}

async function runBrowserRssFallback(input: {
  runId: string;
  config: ReturnType<typeof loadConfig>;
  lists: ListService;
  timelineItems: TimelineItemService;
  smoke?: boolean;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
}, reason: string): Promise<void> {
  if (input.smoke) {
    await input.record("debug", "rss.fallback.skipped", "Smoke test skipped RSS fallback", {
      runId: input.runId,
      reason
    });
    return;
  }
  await runSharedRssFallback({
    runId: input.runId,
    lists: input.lists,
    timelineItems: input.timelineItems,
    feedLimit: input.config.rssFallbackFeedLimit,
    reason,
    record: input.record
  });
}

async function runBrowserRedditCrawl(input: {
  runId: string;
  config: ReturnType<typeof loadConfig>;
  timelineItems: TimelineItemService;
  smoke?: boolean;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
}, keywords: string[]): Promise<void> {
  if (input.smoke || !input.config.redditCrawlEnabled) {
    return;
  }

  try {
    const crawler = new RedditCrawler({
      enabled: input.config.redditCrawlEnabled,
      userAgent: input.config.redditCrawlUserAgent,
      subreddits: input.config.redditCrawlSubreddits,
      limitPerKeyword: input.config.redditCrawlLimitPerKeyword,
      sort: input.config.redditCrawlSort,
      timeRange: input.config.redditCrawlTimeRange,
      minScore: input.config.redditCrawlMinScore
    });

    await crawlRedditKeywords({
      runId: input.runId,
      keywords,
      crawler,
      timelineItems: input.timelineItems,
      record: input.record
    });
  } catch (error) {
    await input.record("prob", "reddit.search.failed", error instanceof Error ? error.message : "Reddit crawl failed", {
      runId: input.runId,
      keywords
    });
  }
}

function formatBrowserRunSummary(input: {
  runId: string;
  smoke: boolean;
  account: string;
  vpnProfilePath: string;
  publicIpv4: string | null;
  completedKeywords: number;
  totalKeywords: number;
  acceptedTweets: number;
  rejectedTweets: number;
  keywordSummaries: BrowserKeywordSummary[];
}): string {
  const lines = [
    "",
    input.smoke ? "Without-API smoke test: COMPLETED" : "Without-API browser search: COMPLETED",
    `Run ID: ${input.runId}`,
    `X account: ${input.account}`,
    `VPN profile: ${input.vpnProfilePath}`,
    `VPN public IPv4: ${input.publicIpv4 ?? "unknown"}`,
    `Keywords: ${input.completedKeywords}/${input.totalKeywords}`,
    `Tweets: ${input.acceptedTweets} accepted / ${input.rejectedTweets} rejected`,
    input.smoke ? "Timeline source: from test for accepted tweets only" : "Timeline source: tweet for accepted tweets",
    ""
  ];

  if (input.keywordSummaries.length > 0) {
    lines.push("Keyword results");
    for (const summary of input.keywordSummaries) {
      lines.push(
        `  - ${summary.keyword}: ${summary.visibleTweets} visible, ${summary.usableTweets} usable, ${summary.acceptedTweets} accepted, ${summary.rejectedTweets} rejected, ${summary.scrollsPerformed} scrolls, ${Math.round(summary.preSearchDelayMs / 1000)}s before searchbox, ${Math.round(summary.timings.totalMs / 1000)}s total`
      );
      lines.push(`    query: ${summary.searchQuery}`);
      lines.push(`    latest mode: ${summary.latestModeForced ? "forced" : "not forced"}`);
      lines.push(`    retweet filter: ${summary.retweetFilterApplied ? "enabled" : "disabled"}`);
      lines.push(`    search URL: ${summary.searchUrl}`);
      lines.push("");
      lines.push("  Playwright timings");
      lines.push(...formatBrowserTimings(summary.timings, "    "));
      lines.push("");
      lines.push("  Prefilter rejected reasons");
      lines.push(...formatReasonCounts(summary.prefilterReasonCounts, "    "));
      lines.push("");
      lines.push("  Scoring rejected reasons");
      lines.push(...formatReasonCounts(summary.scoringReasonCounts, "    "));
      lines.push("");
      lines.push("  Page before search");
      lines.push(...formatPageSnapshot(summary.beforeSearch, "    "));
      lines.push("");
      lines.push("  Page after search");
      lines.push(...formatPageSnapshot(summary.afterSearch, "    "));
    }
  } else {
    lines.push("Keyword results: none processed");
  }

  if (input.smoke) {
    lines.push("");
    lines.push("Smoke notes");
    lines.push("  - SearchTerms.Used was not updated.");
    lines.push("  - No.Result was not updated.");
    lines.push("  - A result with 0 visible tweets means X returned no visible tweet articles for that keyword in this session.");
    lines.push("  - Visible tweets can still be rejected before scoring; check the prefilter reason counts and Current Session tweet logs.");
    lines.push("  - Full page snapshots are saved to the snapshot files shown above.");
  }

  return lines.join("\n");
}

function formatPageSnapshot(snapshot: PageSnapshot, prefix = ""): string[] {
  return [
    `${prefix}keyword: ${snapshot.keyword}`,
    `${prefix}url: ${snapshot.url}`,
    `${prefix}title: ${snapshot.title || "(empty)"}`,
    `${prefix}article[data-testid=tweet]: ${snapshot.articleCount}`,
    `${prefix}tweetText nodes: ${snapshot.tweetTextCount}`,
    `${prefix}search input visible: ${snapshot.searchInputVisible ? "yes" : "no"}`,
    `${prefix}full body chars: ${snapshot.fullTextLength}`,
    `${prefix}full snapshot file: ${snapshot.snapshotFile ?? "(not saved)"}`,
    `${prefix}body preview:`,
    ...indentBlock(snapshot.bodyText || "(empty)", `${prefix}  `)
  ];
}

function formatBrowserTimings(timings: BrowserSearchTimings, prefix = ""): string[] {
  return [
    `${prefix}open search page: ${timings.openSearchMs}ms`,
    `${prefix}pre-search wait: ${timings.preSearchDelayMs}ms`,
    `${prefix}submit search: ${timings.submitSearchMs}ms`,
    `${prefix}extract initial tweets: ${timings.extractInitialMs}ms`,
    `${prefix}scrolling: ${timings.scrollMs}ms`,
    `${prefix}total: ${timings.totalMs}ms`
  ];
}

function formatReasonCounts(counts: Record<string, number>, prefix = ""): string[] {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return [`${prefix}(none)`];
  }
  return entries.map(([reason, count]) => `${prefix}${reason}: ${count}`);
}

function countReasonOccurrences(reasons: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function countReasonsByPrefix(counts: Record<string, number>, prefix: string): number {
  return Object.entries(counts).reduce((total, [reason, count]) => (reason === prefix || reason.startsWith(`${prefix}:`) ? total + count : total), 0);
}

async function maybeMoveStaleKeywordUserFromTooOldResults(input: {
  page: Page;
  keyword: string;
  visibleTweets: number;
  tooOldTweets: number;
  mouseProfile: MouseProfile;
  pacing: HumanPacingConfig;
  config: AppConfig;
  publicIpv4: string | null;
  lists: ListService;
  runId: string;
  position: number;
  smoke?: boolean;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
}): Promise<boolean> {
  if (input.smoke || !isHandleSearchKeyword(input.keyword) || input.visibleTweets <= 0) {
    return false;
  }
  const tooOldRatio = input.tooOldTweets / input.visibleTweets;
  if (input.tooOldTweets < 1 || tooOldRatio < 0.6) {
    return false;
  }

  const handle = normalizeHandle(input.keyword);
  if (!handle) {
    return false;
  }

  const checkKeyword = `from:${handle}`;
  await input.record("info", "browser.keyword_user_stale_check.started", "Most visible tweets for @keyword were too old; checking the user directly", {
    runId: input.runId,
    keyword: input.keyword,
    handle,
    checkKeyword,
    visibleTweets: input.visibleTweets,
    tooOldTweets: input.tooOldTweets,
    tooOldRatio,
    maxAgeDays: input.config.staleKeywordUserMaxAgeDays,
    position: input.position
  });

  const profileStatus = await checkKeywordUserProfileStatus(input.page, handle, input.runId, input.record);
  if (profileStatus.reason) {
    return moveKeywordUserToStale({
      ...input,
      keyword: input.keyword,
      handle,
      reason: profileStatus.reason,
      latestTweet: null,
      ageDays: null,
      sourceFile: "runtime:browser-search-user-profile-check",
      recordData: {
        profileUrl: profileStatus.url,
        profileTitle: profileStatus.title,
        pageText: profileStatus.pageText.slice(0, 500)
      }
    });
  }

  const check = await searchOneKeyword(input.page, checkKeyword, input.mouseProfile, input.pacing, input.config, input.publicIpv4, {
    runId: input.runId,
    position: input.position,
    saveSnapshots: input.config.searchWithoutApiSaveSnapshots,
    retweetFilterApplied: false,
    record: input.record
  });
  const pageReason = keywordUserUnavailablePageReason(check.afterSearch.bodyText);
  const latestTweets = latestTweetsForHandle(check.tweets, handle, 2);
  if (pageReason || latestTweets.length === 0) {
    const reason = pageReason ?? "no_visible_tweet_for_user";
    return moveKeywordUserToStale({
      ...input,
      keyword: input.keyword,
      handle,
      reason,
      latestTweet: null,
      ageDays: null,
      sourceFile: "runtime:browser-search-user-unavailable-check",
      recordData: {
        checkKeyword,
        visibleTweets: check.tweets.length,
        pageReason,
        pageText: check.afterSearch.bodyText.slice(0, 500)
      }
    });
  }

  if (latestTweets.length < 2 || latestTweets.some((tweet) => !tweet.createdAt)) {
    const latestTweet = latestTweets[0];
    if (latestTweet?.createdAt) {
      const ageDays = Number(Math.max(0, (Date.now() - latestTweet.createdAt.getTime()) / 86_400_000).toFixed(2));
      if (ageDays > input.config.staleKeywordUserMaxAgeDays) {
        return moveKeywordUserToStale({
          ...input,
          keyword: input.keyword,
          handle,
          reason: "latest_tweet_too_old",
          latestTweet,
          ageDays,
          sourceFile: "runtime:browser-search-too-old-check",
          recordData: {
            checkKeyword,
            latestTweetId: latestTweet.id,
            latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
            ageDays,
            directUserTweets: latestTweets.length
          }
        });
      }
    }
    await input.record("prob", "browser.keyword_user_stale_check.skipped", "Keyword user could not be confirmed stale", {
      runId: input.runId,
      keyword: input.keyword,
      handle,
      checkKeyword,
      visibleTweets: check.tweets.length,
      directUserTweets: latestTweets.length,
      reason: latestTweets.length < 2 ? "less_than_two_visible_tweets_for_user" : "latest_tweet_has_no_date"
    });
    return false;
  }

  const latestTweet = latestTweets[0];
  const secondLatestTweet = latestTweets[1];
  const latestAgeDays = Number(Math.max(0, (Date.now() - latestTweet.createdAt!.getTime()) / 86_400_000).toFixed(2));
  const secondLatestAgeDays = Number(Math.max(0, (Date.now() - secondLatestTweet.createdAt!.getTime()) / 86_400_000).toFixed(2));
  const latestTwoTweetsTooOld =
    latestAgeDays > input.config.staleKeywordUserMaxAgeDays && secondLatestAgeDays > input.config.staleKeywordUserMaxAgeDays;
  if (!latestTwoTweetsTooOld) {
    await input.record("debug", "browser.keyword_user_stale_check.kept", "Keyword user kept because the direct user search found recent activity", {
      runId: input.runId,
      keyword: input.keyword,
      handle,
      latestTweetId: latestTweet.id,
      latestTweetCreatedAt: latestTweet.createdAt!.toISOString(),
      ageDays: latestAgeDays,
      secondLatestTweetId: secondLatestTweet.id,
      secondLatestTweetCreatedAt: secondLatestTweet.createdAt!.toISOString(),
      secondLatestAgeDays,
      maxAgeDays: input.config.staleKeywordUserMaxAgeDays
    });
    return false;
  }

  return moveKeywordUserToStale({
    ...input,
    keyword: input.keyword,
    handle,
    reason: "latest_two_tweets_too_old",
    latestTweet,
    ageDays: latestAgeDays,
    sourceFile: "runtime:browser-search-too-old-check",
    recordData: {
      checkKeyword,
      latestTweetId: latestTweet.id,
      latestTweetCreatedAt: latestTweet.createdAt!.toISOString(),
      ageDays: latestAgeDays,
      secondLatestTweetId: secondLatestTweet.id,
      secondLatestTweetCreatedAt: secondLatestTweet.createdAt!.toISOString(),
      secondLatestAgeDays
    }
  });
}

async function moveKeywordUserToStale(input: {
  lists: ListService;
  keyword: string;
  handle: string;
  runId: string;
  config: AppConfig;
  reason: string;
  latestTweet: TweetCandidate | null;
  ageDays: number | null;
  sourceFile: string;
  recordData?: Record<string, unknown>;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
}): Promise<boolean> {
  const importedAt = new Date().toISOString();
  const staleEntry = input.lists.add("stale_keyword_user", input.keyword, input.sourceFile, null, importedAt);
  const deletedKeywords = input.lists.markDeleted("keyword", input.keyword);
  input.lists.markDeleted("skipped_keyword_user", input.keyword);
  await input.record("info", "browser.keyword_user_stale_check.removed", "Keyword user moved to Stale keyword users after direct activity check", {
    runId: input.runId,
    keyword: input.keyword,
    handle: input.handle,
    reason: input.reason,
    latestTweetId: input.latestTweet?.id ?? null,
    latestTweetCreatedAt: input.latestTweet?.createdAt?.toISOString() ?? null,
    ageDays: input.ageDays,
    maxAgeDays: input.config.staleKeywordUserMaxAgeDays,
    staleEntryId: staleEntry.id,
    deletedKeywords,
    ...input.recordData
  });
  return true;
}

function latestTweetsForHandle(tweets: TweetCandidate[], handle: string, limit = 2): TweetCandidate[] {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) {
    return [];
  }
  return tweets
    .filter((tweet) => normalizeHandle(tweet.user.screenName) === normalizedHandle && tweet.createdAt)
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
    .slice(0, limit);
}

async function checkKeywordUserProfileStatus(
  page: Page,
  handle: string,
  runId: string,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<{ reason: KeywordUserUnavailableReason | null; url: string; title: string; pageText: string }> {
  const profileUrl = `https://x.com/${encodeURIComponent(handle)}`;
  await gotoWithTransientRetry(page, profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }, {
    attempts: 3,
    retryDelayMs: 2_500,
    onRetry: (event) =>
      record("prob", "browser.keyword_user_profile.navigation_retry", "Transient profile navigation error; retrying", {
        runId,
        handle,
        profileUrl,
        ...event
      })
  });
  await delay(2_000);
  const pageText = await page
    .locator("body")
    .innerText({ timeout: 3_000 })
    .catch(() => "");
  const title = await page.title().catch(() => "");
  return {
    reason: keywordUserUnavailablePageReason(`${title}\n${pageText}`),
    url: page.url(),
    title,
    pageText
  };
}

type KeywordUserUnavailableReason = "protected_posts" | "user_not_found" | "account_suspended";

function keywordUserUnavailablePageReason(bodyText: string): KeywordUserUnavailableReason | null {
  if (isSuspendedAccountText(bodyText)) {
    return "account_suspended";
  }
  if (isProtectedPostsText(bodyText)) {
    return "protected_posts";
  }
  return isMissingKeywordUserText(bodyText) ? "user_not_found" : null;
}

function isProtectedPostsText(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return normalized.includes("these posts are protected") && normalized.includes("only approved followers can see");
}

function isSuspendedAccountText(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return (
    normalized.includes("account suspended") ||
    normalized.includes("account is suspended") ||
    normalized.includes("x suspends accounts") ||
    normalized.includes("twitter suspends accounts")
  );
}

function isMissingKeywordUserText(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return (
    normalized.includes("this account doesn t exist") ||
    normalized.includes("this account doesn’t exist") ||
    normalized.includes("account doesn t exist") ||
    normalized.includes("account doesn’t exist") ||
    normalized.includes("user not found") ||
    normalized.includes("try searching for another")
  );
}

function indentBlock(value: string, prefix: string): string[] {
  return value.split("\n").map((line) => `${prefix}${line}`);
}

function isRecoverableBrowserTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "TimeoutError" || /\bTimeout\b|timed out|Timeout \d+ms exceeded/i.test(message);
}

async function searchOneKeyword(
  page: Page,
  keyword: string,
  mouseProfile: MouseProfile,
  pacing: HumanPacingConfig,
  config: ReturnType<typeof loadConfig>,
  publicIpv4: string | null,
  options: {
    smoke?: boolean;
    runId?: string;
    position?: number;
    saveSnapshots?: boolean;
    retweetFilterApplied?: boolean;
    minimumRetweetsEnabled?: boolean;
    minimumTweetRetweets?: number;
    record?: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
  } = {}
): Promise<{
  tweets: TweetCandidate[];
  searchQuery: string;
  searchUrl: string;
  latestModeForced: boolean;
  retweetFilterApplied: boolean;
  scrollsPerformed: number;
  preSearchDelayMs: number;
  timings: BrowserSearchTimings;
  beforeSearch: PageSnapshot;
  afterSearch: PageSnapshot;
}> {
  const totalStartedAt = Date.now();
  let openSearchMs = 0;
  let submitSearchMs = 0;
  let extractInitialMs = 0;
  let scrollMs = 0;
  const retweetFilterApplied = Boolean(options.retweetFilterApplied);
  const searchQuery = buildBrowserSearchQuery(keyword, { includeRetweetFilter: retweetFilterApplied });
  const searchUrl = buildBrowserSearchUrl(keyword, config.searchWithoutApiStartUrl, { includeRetweetFilter: retweetFilterApplied });
  const gotoSearch = (url: string, phase: string) =>
    gotoWithTransientRetry(
      page,
      url,
      { waitUntil: "domcontentloaded", timeout: 45_000 },
      {
        attempts: 3,
        retryDelayMs: 2_500,
        onRetry: (event) =>
          options.record?.("prob", "browser.playwright.navigation_retry", "Transient browser navigation error; retrying", {
            runId: options.runId,
            keyword,
            phase,
            ...event
          })
      }
    );
  await options.record?.("debug", "browser.playwright.step", "Opening X search page", {
    runId: options.runId,
    keyword,
    step: "open_search_page",
    url: config.searchWithoutApiStartUrl || "https://x.com/search",
    latestModeForced: true,
    retweetFilterApplied,
    retweetFilterRule: {
      minimumRetweetsEnabled: Boolean(options.minimumRetweetsEnabled),
      minimumTweetRetweets: options.minimumTweetRetweets ?? 0,
      appliedWhenMinimumRetweetsIsEnabledAndAboveZero: true
    }
  });
  const openStartedAt = Date.now();
  await gotoSearch(config.searchWithoutApiStartUrl || "https://x.com/search", "open_search_page");
  await page.waitForTimeout(500);
  openSearchMs = Date.now() - openStartedAt;
  const beforeSearch = await capturePageSnapshot(page, "before_search", keyword, options.runId, options.position, Boolean(options.saveSnapshots));
  await options.record?.("debug", "browser.playwright.step", "X search page opened", {
    runId: options.runId,
    keyword,
    step: "open_search_page_completed",
    durationMs: openSearchMs,
    url: beforeSearch.url,
    title: beforeSearch.title,
    articleCount: beforeSearch.articleCount,
    tweetTextCount: beforeSearch.tweetTextCount,
    searchInputVisible: beforeSearch.searchInputVisible,
    snapshotFile: beforeSearch.snapshotFile
  });
  await assertNoManualVerification(page, {
    publicIpv4,
    runId: options.runId,
    keyword,
    phase: "before_search",
    record: options.record
  });

  const preSearchDelayMs = randomDelayMs(
    Math.max(800, pacing.keyDelayMinMs),
    Math.max(2_500, pacing.keyDelayMaxMs * 2)
  );
  await options.record?.("debug", "browser.playwright.step", "Waiting before touching the search box", {
    runId: options.runId,
    keyword,
    step: "pre_search_wait",
    delayMs: preSearchDelayMs
  });
  await page.waitForTimeout(preSearchDelayMs);

  const searchInput = page.locator('[data-testid="SearchBox_Search_Input"]').first();
  const submitStartedAt = Date.now();
  if ((await searchInput.count().catch(() => 0)) > 0 && (await searchInput.isVisible().catch(() => false))) {
    await options.record?.("debug", "browser.playwright.step", "Typing keyword into X search box", {
      runId: options.runId,
      keyword,
      step: "type_search_box",
      query: searchQuery,
      mouseProfile,
      latestModeWillBeForcedAfterSubmit: true,
      retweetFilterApplied
    });
    const focusMethod = await focusLocatorForTyping(searchInput);
    if (focusMethod !== "click") {
      await options.record?.("prob", "browser.search_input.click_fallback", "Search input click timed out; using focus fallback", {
        runId: options.runId,
        keyword,
        focusMethod
      });
    }
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await typeWithPacing(page, searchQuery, pacing);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  } else {
    await options.record?.("debug", "browser.playwright.step", "Search box not visible; using direct search URL", {
      runId: options.runId,
      keyword,
      step: "direct_search_url",
      url: searchUrl
    });
    await gotoSearch(searchUrl, "direct_search_url");
  }

  if (!isLatestSearchUrl(page.url())) {
    await options.record?.("debug", "browser.playwright.step", "Forcing X search to Latest tab", {
      runId: options.runId,
      keyword,
      step: "force_latest_search",
      previousUrl: page.url(),
      url: searchUrl,
      latestModeForced: true
    });
    await gotoSearch(searchUrl, "force_latest_search");
  }

  await page.waitForTimeout(1_200);
  submitSearchMs = Date.now() - submitStartedAt;
  await assertNoManualVerification(page, {
    publicIpv4,
    runId: options.runId,
    keyword,
    phase: "after_search",
    record: options.record
  });
  const afterSearch = await capturePageSnapshot(page, "after_search", keyword, options.runId, options.position, Boolean(options.saveSnapshots));
  await options.record?.("debug", "browser.playwright.step", "Search result page captured", {
    runId: options.runId,
    keyword,
    step: "after_search_snapshot",
    durationMs: submitSearchMs,
    url: afterSearch.url,
    title: afterSearch.title,
    articleCount: afterSearch.articleCount,
    tweetTextCount: afterSearch.tweetTextCount,
    searchInputVisible: afterSearch.searchInputVisible,
    fullTextLength: afterSearch.fullTextLength,
    snapshotFile: afterSearch.snapshotFile
  });
  const extractStartedAt = Date.now();
  let tweets = await extractVisibleTweets(page);
  extractInitialMs = Date.now() - extractStartedAt;
  await options.record?.("debug", "browser.playwright.step", "Visible tweets extracted from DOM", {
    runId: options.runId,
    keyword,
    step: "extract_visible_tweets",
    durationMs: extractInitialMs,
    visibleTweets: tweets.length,
    tweetIds: tweets.map((tweet) => tweet.id).slice(0, 20)
  });
  const targetScrolls = options.smoke ? smokeScrollBudget(tweets.length) : coherentScrollBudget(tweets.length, config);
  let stagnantScrolls = 0;
  let scrollsPerformed = 0;

  const scrollStartedAt = Date.now();
  for (let scroll = 0; scroll < targetScrolls; scroll += 1) {
    const scrollStepStartedAt = Date.now();
    const previousCount = new Set(tweets.map((tweet) => tweet.id)).size;
    await hoverVisibleTweets(page, mouseProfile, pacing);
    const scrollDelayMs = await scrollWithPacing(page, mouseProfile, pacing);
    scrollsPerformed += 1;
    await assertNoManualVerification(page, {
      publicIpv4,
      runId: options.runId,
      keyword,
      phase: "scroll",
      record: options.record
    });
    const nextTweets = await extractVisibleTweets(page);
    const merged = new Map(tweets.map((tweet) => [tweet.id, tweet]));
    for (const tweet of nextTweets) {
      merged.set(tweet.id, tweet);
    }
    tweets = Array.from(merged.values());
    if (tweets.length <= previousCount) {
      stagnantScrolls += 1;
      await options.record?.("debug", "browser.playwright.step", "Scroll did not reveal new tweets", {
        runId: options.runId,
        keyword,
        step: "scroll_result",
        scrollIndex: scroll + 1,
        durationMs: Date.now() - scrollStepStartedAt,
        previousVisibleTweets: previousCount,
        visibleTweets: tweets.length,
        newTweets: 0,
        scrollDelayMs,
        stagnantScrolls
      });
      if (stagnantScrolls >= 2) break;
    } else {
      await options.record?.("debug", "browser.playwright.step", "Scroll revealed more tweets", {
        runId: options.runId,
        keyword,
        step: "scroll_result",
        scrollIndex: scroll + 1,
        durationMs: Date.now() - scrollStepStartedAt,
        previousVisibleTweets: previousCount,
        visibleTweets: tweets.length,
        newTweets: tweets.length - previousCount,
        scrollDelayMs
      });
      stagnantScrolls = 0;
    }
  }
  scrollMs = Date.now() - scrollStartedAt;
  const timings = {
    totalMs: Date.now() - totalStartedAt,
    openSearchMs,
    preSearchDelayMs,
    submitSearchMs,
    extractInitialMs,
    scrollMs
  };
  await options.record?.("debug", "browser.playwright.step", "Keyword browser search finished", {
    runId: options.runId,
    keyword,
    step: "keyword_browser_search_finished",
    timings,
    visibleTweets: tweets.length,
    scrollsPerformed,
    searchQuery,
    searchUrl,
    latestModeForced: true,
    retweetFilterApplied
  });
  return {
    tweets,
    searchQuery,
    searchUrl,
    latestModeForced: true,
    retweetFilterApplied,
    scrollsPerformed,
    preSearchDelayMs,
    timings,
    beforeSearch,
    afterSearch
  };
}

function shouldApplyBrowserRetweetFilter(scoringConfig: ScoringConfig): boolean {
  return scoringConfig.enableMinimumTweetRetweets && scoringConfig.minimumTweetRetweets > 0;
}

function isLatestSearchUrl(value: string): boolean {
  try {
    return new URL(value).searchParams.get("f") === "live";
  } catch {
    return false;
  }
}

async function capturePageSnapshot(
  page: Page,
  phase: PageSnapshot["phase"],
  keyword: string,
  runId?: string,
  position = 0,
  saveSnapshot = true
): Promise<PageSnapshot> {
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const articleCount = await page.locator('article[data-testid="tweet"]').count().catch(() => 0);
  const tweetTextCount = await page.locator('[data-testid="tweetText"]').count().catch(() => 0);
  const searchInputVisible = await page
    .locator('[data-testid="SearchBox_Search_Input"]')
    .first()
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  const title = await page.title().catch(() => "");
  const url = page.url();
  const snapshotFile = saveSnapshot
    ? savePageSnapshot({
        runId,
        position,
        phase,
        keyword,
        url,
        title,
        articleCount,
        tweetTextCount,
        searchInputVisible,
        bodyText
      })
    : null;
  return {
    phase,
    keyword,
    url,
    title,
    articleCount,
    tweetTextCount,
    searchInputVisible,
    fullTextLength: normalizeSnapshotText(bodyText).length,
    snapshotFile,
    bodyText: truncateText(bodyText)
  };
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

function savePageSnapshot(input: {
  runId?: string;
  position: number;
  phase: PageSnapshot["phase"];
  keyword: string;
  url: string;
  title: string;
  articleCount: number;
  tweetTextCount: number;
  searchInputVisible: boolean;
  bodyText: string;
}): string | null {
  if (!input.runId) {
    return null;
  }
  try {
    const snapshotDir = path.join(process.cwd(), "runtime", "browser-search-snapshots", safePathSegment(input.runId));
    fsSync.mkdirSync(snapshotDir, { recursive: true });
    const filename = `${String(Math.max(0, input.position)).padStart(3, "0")}-${safePathSegment(input.keyword)}-${input.phase}.json`;
    const absolutePath = path.join(snapshotDir, filename);
    fsSync.writeFileSync(
      absolutePath,
      `${JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          phase: input.phase,
          keyword: input.keyword,
          url: input.url,
          title: input.title,
          articleCount: input.articleCount,
          tweetTextCount: input.tweetTextCount,
          searchInputVisible: input.searchInputVisible,
          bodyText: normalizeSnapshotText(input.bodyText)
        },
        null,
        2
      )}\n`
    );
    return `./${path.relative(process.cwd(), absolutePath)}`;
  } catch {
    return null;
  }
}

function safePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

async function assertNoManualVerification(
  page: Page,
  options: {
    publicIpv4: string | null;
    runId?: string;
    keyword?: string;
    phase?: string;
    retryDelayMs?: number;
    record?: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
  }
): Promise<void> {
  const firstDetection = await detectManualVerification(page);
  if (!firstDetection) {
    return;
  }

  const retryDelayMs = Math.max(0, options.retryDelayMs ?? manualVerificationRefreshRetryDelayMs);
  const beforeRefreshUrl = page.url();
  await options.record?.("prob", "x.manual_verification.refresh_retry.waiting", "X session alert candidate detected; refreshing once before locking account", {
    runId: options.runId,
    keyword: options.keyword,
    phase: options.phase,
    alertType: firstDetection.type,
    reason: firstDetection.reason,
    url: firstDetection.pageState.url,
    retryDelayMs,
    detectionSignals: firstDetection.signals
  });

  if (retryDelayMs > 0) {
    await delay(retryDelayMs);
  }

  const refreshStartedAt = Date.now();
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
    await options.record?.("info", "x.manual_verification.refresh_retry.cleared", "X session alert candidate cleared after one refresh", {
      runId: options.runId,
      keyword: options.keyword,
      phase: options.phase,
      firstAlertType: firstDetection.type,
      firstReason: firstDetection.reason,
      beforeRefreshUrl,
      afterRefreshUrl: page.url(),
      refreshDurationMs: Date.now() - refreshStartedAt,
      refreshError
    });
    return;
  }

  const confirmedSameAlert = sameManualVerificationDetection(firstDetection, secondDetection);
  await options.record?.("prob", "x.manual_verification.refresh_retry.confirmed", "X session alert persisted after one refresh; browser worker will stop", {
    runId: options.runId,
    keyword: options.keyword,
    phase: options.phase,
    firstAlertType: firstDetection.type,
    firstReason: firstDetection.reason,
    confirmedAlertType: secondDetection.type,
    confirmedReason: secondDetection.reason,
    confirmedSameAlert,
    beforeRefreshUrl,
    afterRefreshUrl: page.url(),
    refreshDurationMs: Date.now() - refreshStartedAt,
    refreshError
  });

  const details = await captureManualVerificationDetails(
    page,
    secondDetection.type,
    secondDetection.reason,
    secondDetection.signals,
    secondDetection.pageState
  );
  throw new ManualVerificationRequiredError(secondDetection.type, secondDetection.reason, options.publicIpv4, {
    ...details,
    refreshRetry: manualVerificationRefreshRetryDetails(
      firstDetection,
      secondDetection,
      retryDelayMs,
      beforeRefreshUrl,
      page.url(),
      Date.now() - refreshStartedAt,
      refreshError
    )
  });
}

function manualVerificationRefreshRetryDetails(
  firstDetection: ManualVerificationDetection,
  secondDetection: ManualVerificationDetection,
  retryDelayMs: number,
  beforeRefreshUrl: string,
  afterRefreshUrl: string,
  refreshDurationMs: number,
  refreshError: string | null
): Record<string, unknown> {
  return {
    attempted: true,
    retryDelayMs,
    beforeRefreshUrl,
    afterRefreshUrl,
    refreshDurationMs,
    refreshError,
    firstAlertType: firstDetection.type,
    firstReason: firstDetection.reason,
    firstDetectionSignals: firstDetection.signals,
    confirmedAlertType: secondDetection.type,
    confirmedReason: secondDetection.reason,
    confirmedDetectionSignals: secondDetection.signals,
    confirmedSameAlert: sameManualVerificationDetection(firstDetection, secondDetection)
  };
}

async function captureManualVerificationDetails(
  page: Page,
  alertType: XSessionAlertType,
  reason: string,
  detectionSignals: string[],
  detectionPageState: { articleCount: number; tweetTextCount: number; nonTweetVisibleText: string }
): Promise<Record<string, unknown>> {
  const capturedAt = new Date().toISOString();
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const html = await page.content().catch(() => "");
  const snapshotPath = saveManualVerificationSnapshot({
    alertType,
    reason,
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
    reason,
    detectionSignals,
    detectionTextSource: "page text excluding tweet articles",
    articleCount: detectionPageState.articleCount,
    tweetTextCount: detectionPageState.tweetTextCount,
    nonTweetVisibleText: truncateText(detectionPageState.nonTweetVisibleText, 4_000),
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
      )}\n`
    );
    return `./${path.relative(process.cwd(), absolutePath)}`;
  } catch {
    return null;
  }
}

function summarizeAlertDetails(details: Record<string, unknown>): Record<string, unknown> {
  return {
    capturedAt: details.capturedAt,
    url: details.url,
    title: details.title,
    reason: details.reason,
    detectionSignals: details.detectionSignals,
    detectionTextSource: details.detectionTextSource,
    articleCount: details.articleCount,
    tweetTextCount: details.tweetTextCount,
    bodyTextLength: details.bodyTextLength,
    htmlLength: details.htmlLength,
    snapshotPath: details.snapshotPath,
    refreshRetry: details.refreshRetry
  };
}

function plannedBrowserKeywords(lists: ListService): string[] {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue).filter(Boolean));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue).filter(Boolean));
  return lists.activeValues("keyword").filter((keyword) => {
    const normalized = normalizeValue(keyword);
    return normalized.length > 0 && !noResults.has(normalized) && !alreadyUsed.has(normalized);
  });
}

function planBrowserKeywords(lists: ListService, config: ReturnType<typeof loadConfig>) {
  const availability = browserKeywordAvailability(lists);
  const keywords = config.searchWithoutApiRandomizeKeywordOrder
    ? shuffleKeywords(plannedBrowserKeywords(lists))
    : plannedBrowserKeywords(lists);
  const configuredLimit = Math.max(0, Math.floor(config.searchWithoutApiSessionKeywordLimit));
  if (configuredLimit === 0 || keywords.length === 0) {
    return {
      keywords: applyUserKeywordPercent(keywords, keywords.length, config.searchWithoutApiUserKeywordPercent),
      ...availability,
      configuredLimit,
      randomized: false,
      orderRandomized: config.searchWithoutApiRandomizeKeywordOrder
    };
  }

  const effectiveLimit = plannedKeywordSelectionCount(
    keywords.length,
    configuredLimit,
    keywordBatchMultiplier(config),
    config.searchWithoutApiSessionKeywordLimitRandom
  );
  return {
    keywords: applyUserKeywordPercent(keywords, effectiveLimit, config.searchWithoutApiUserKeywordPercent),
    ...availability,
    configuredLimit,
    randomized: config.searchWithoutApiSessionKeywordLimitRandom,
    orderRandomized: config.searchWithoutApiRandomizeKeywordOrder
  };
}

function keywordBatchMultiplier(config: Pick<ReturnType<typeof loadConfig>, "runChainCount">): number {
  return Math.max(1, Math.floor(config.runChainCount ?? 0) + 1);
}

function plannedKeywordSelectionCount(available: number, configuredLimit: number, multiplier: number, randomize: boolean): number {
  const safeAvailable = Math.max(0, Math.floor(available));
  if (safeAvailable <= 0) {
    return 0;
  }
  const safeMultiplier = Math.max(1, Math.floor(multiplier));
  if (configuredLimit <= 0) {
    return safeAvailable;
  }

  const multipliedLimit = Math.max(1, Math.floor(configuredLimit)) * safeMultiplier;
  const maxKeywords = Math.min(safeAvailable, multipliedLimit);
  if (!randomize) {
    return maxKeywords;
  }

  const maxBase = Math.max(1, Math.min(Math.floor(configuredLimit), Math.ceil(safeAvailable / safeMultiplier)));
  return Math.min(safeAvailable, randomInt(1, maxBase) * safeMultiplier);
}

function applyUserKeywordPercent(keywords: string[], totalKeywords: number, configuredPercent = 100): string[] {
  const total = Math.max(0, Math.min(keywords.length, Math.floor(totalKeywords)));
  const percent = Math.max(0, Math.min(100, Math.floor(configuredPercent)));
  if (total === 0 || percent >= 100) {
    return keywords.slice(0, total);
  }

  const indexedKeywords = keywords.map((keyword, index) => ({ keyword, index }));
  const userKeywords = indexedKeywords.filter(({ keyword }) => isHandleSearchKeyword(keyword));
  const regularKeywords = indexedKeywords.filter(({ keyword }) => !isHandleSearchKeyword(keyword));
  const targetUsers = Math.floor((total * percent) / 100);
  const targetRegular = total - targetUsers;
  const selected = [...regularKeywords.slice(0, targetRegular), ...userKeywords.slice(0, targetUsers)];

  if (selected.length < total) {
    const selectedIndexes = new Set(selected.map(({ index }) => index));
    selected.push(...indexedKeywords.filter(({ index }) => !selectedIndexes.has(index)).slice(0, total - selected.length));
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .slice(0, total)
    .map(({ keyword }) => keyword);
}

async function planSmokeKeywords(cliKeyword?: string) {
  const promptedKeyword = cliKeyword?.trim() || (await promptSmokeKeyword());
  const keyword = promptedKeyword || SMOKE_KEYWORDS[randomInt(0, SMOKE_KEYWORDS.length - 1)];
  return {
    keywords: [keyword],
    availableKeywords: SMOKE_KEYWORDS.length,
    keywordTotal: SMOKE_KEYWORDS.length,
    noResultKeywords: 0,
    searchTermsUsedKeywords: 0,
    excludedNoResultKeywords: 0,
    excludedAlreadySearchedKeywords: 0,
    configuredLimit: 1,
    randomized: false,
    orderRandomized: true
  };
}

function browserKeywordAvailability(lists: ListService) {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue).filter(Boolean));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue).filter(Boolean));
  const keywords = Array.from(new Set(lists.activeValues("keyword").map((keyword) => normalizeValue(keyword)).filter(Boolean)));

  let excludedNoResultKeywords = 0;
  let excludedAlreadySearchedKeywords = 0;
  let availableKeywords = 0;
  for (const keyword of keywords) {
    if (noResults.has(keyword)) {
      excludedNoResultKeywords += 1;
      continue;
    }
    if (alreadyUsed.has(keyword)) {
      excludedAlreadySearchedKeywords += 1;
      continue;
    }
    availableKeywords += 1;
  }

  return {
    keywordTotal: keywords.length,
    noResultKeywords: noResults.size,
    searchTermsUsedKeywords: alreadyUsed.size,
    excludedNoResultKeywords,
    excludedAlreadySearchedKeywords,
    availableKeywords
  };
}

function isBelowMinimumSearchResults(enabled: boolean, resultCount: number, minimumSearchResults: number): boolean {
  return enabled && Math.max(0, Math.floor(resultCount)) < Math.max(1, Math.floor(minimumSearchResults));
}

async function promptSmokeKeyword(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const answer = await rl.question(
      `Smoke keyword [Enter = random: ${SMOKE_KEYWORDS.join(", ")}]: `
    );
    return answer.trim() || null;
  } finally {
    rl.close();
  }
}

function shuffleKeywords(keywords: string[]): string[] {
  const shuffled = [...keywords];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function createBrowserRunStats(
  totalKeywords: number,
  config: ReturnType<typeof loadConfig>,
  availableKeywords = totalKeywords,
  existingStats?: RunStats
) {
  const apiCallLimit = searchesBeforePauseForKeywords(totalKeywords, config);
  const stats: RunStats = {
    currentKeyword: null,
    totalKeywords,
    completedKeywords: 0,
    remainingKeywords: totalKeywords,
    availableKeywords,
    sessionKeywordLimit: config.searchWithoutApiSessionKeywordLimit,
    sessionKeywordLimitRandom: config.searchWithoutApiSessionKeywordLimitRandom,
    randomizeKeywordOrder: config.searchWithoutApiRandomizeKeywordOrder,
    userKeywordPercent: config.searchWithoutApiUserKeywordPercent,
    runChainTotal: 1,
    runChainIndex: 1,
    runChainRemaining: 0,
    apiCallsUsed: 0,
    apiCallLimit,
    apiCallsRemaining: apiCallLimit,
    apiWindowMinutes: config.searchWithoutApiPauseMaxMinutes,
    nextApiResetAt: null,
    browserAlertAutoIgnore: config.searchWithoutApiAutoIgnoreAlert,
    browserAlertRetryCount: existingStats?.browserAlertRetryCount ?? 0,
    browserAlertMaxRetries: config.searchWithoutApiMaxRetries,
    browserAlertAutoRestartDelaySeconds: config.searchWithoutApiAutoRestartDelaySeconds,
    browserAlertAutoRestartAt: existingStats?.browserAlertAutoRestartAt ?? null,
    browserAlertLastCompletedKeywords: existingStats?.browserAlertLastCompletedKeywords ?? null,
    acceptedTweets: 0,
    rejectedTweets: 0,
    lastScore: null,
    lastTweetId: null
  };
  return stats;
}

function normalizeRunChainKeywordBatches(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((batch): batch is unknown[] => Array.isArray(batch))
    .map((batch) => batch.map((keyword) => String(keyword).trim()).filter(Boolean))
    .filter((batch) => batch.length > 0);
}

function searchesBeforePauseForKeywords(remainingKeywords: number, config: ReturnType<typeof loadConfig>): number {
  const remaining = Math.max(0, Math.floor(remainingKeywords));
  if (remaining <= 0) {
    return 0;
  }
  const manualMin = Math.max(1, Math.floor(config.searchWithoutApiRequestsBeforePauseMin));
  return manualMin;
}

function browserRunPlanMatchesConfig(stats: RunStats, config: ReturnType<typeof loadConfig>): boolean {
  return (
    stats.sessionKeywordLimit === config.searchWithoutApiSessionKeywordLimit &&
    Boolean(stats.sessionKeywordLimitRandom) === Boolean(config.searchWithoutApiSessionKeywordLimitRandom) &&
    Boolean(stats.randomizeKeywordOrder) === Boolean(config.searchWithoutApiRandomizeKeywordOrder) &&
    Math.floor(stats.userKeywordPercent ?? 100) === Math.floor(config.searchWithoutApiUserKeywordPercent) &&
    Math.floor(stats.runChainTotal ?? 1) === 1 &&
    Math.floor(stats.runChainRemaining ?? 0) === 0
  );
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

function coherentScrollBudget(visibleTweets: number, config: ReturnType<typeof loadConfig>): number {
  const configured = randomInt(config.searchWithoutApiScrollsMin, config.searchWithoutApiScrollsMax);
  if (visibleTweets <= 0) {
    return Math.min(configured, 2);
  }
  if (visibleTweets < 4) {
    return Math.min(configured, 4);
  }
  return Math.min(configured, config.searchWithoutApiMaxScrolls);
}

function smokeScrollBudget(visibleTweets: number): number {
  if (visibleTweets <= 10) {
    return 0;
  }
  return 2;
}

async function waitUntilRunnable(runs: RunService, runId: string): Promise<RunRecord | null> {
  while (true) {
    const run = runs.get(runId);
    if (!run || run.status === "stopped" || run.status === "completed") {
      return null;
    }
    if (run.status === "running") {
      return run;
    }
    await delay(1_000);
  }
}

async function interruptibleDelay(runs: RunService, runId: string, ms: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms);
  while (Date.now() < deadline) {
    if (!(await waitUntilRunnable(runs, runId))) {
      return;
    }
    await delay(Math.min(1_000, deadline - Date.now()));
  }
}

async function runMediaCacheFetchProcess(
  tweetId: string,
  config: ReturnType<typeof loadConfig>,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<void> {
  await record("debug", "media_cache.auto_fetch.queued", "Accepted tweet media cache fetch queued", {
    tweetId,
    viaVpnNamespace: config.vpnNetnsName,
    isolation: config.searchWithoutApiIsolation
  });

  await new Promise<void>((resolve) => {
    const lifecycle = process.env.npm_lifecycle_event ?? "";
    const fetchScript = lifecycle.endsWith(":dev") ? "media-cache:fetch:dev" : "media-cache:fetch";
    const child = spawn("npm", ["run", fetchScript, "--", "--tweet-id", tweetId], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: config.databaseUrl,
        CURRENT_SESSION_FILE: config.currentSessionFile,
        REDQUEENX_DOCKER_VPN: process.env.REDQUEENX_DOCKER_VPN
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      void record("prob", "media_cache.auto_fetch.failed", error.message, { tweetId });
      resolve();
    });
    child.on("close", (code) => {
      void record(code === 0 ? "info" : "prob", code === 0 ? "media_cache.auto_fetch.completed" : "media_cache.auto_fetch.failed", code === 0 ? "Accepted tweet media cache fetch completed" : "Accepted tweet media cache fetch failed", {
        tweetId,
        code,
        stdout: lastOutputLines(stdout, 20),
        stderr: lastOutputLines(stderr, 20)
      });
      resolve();
    });
  });
}

function selectBrowserAccount(service: XBrowserAccountService, vpnProfilePath: string): XBrowserAccountRecord {
  const account = service.findByVpnProfilePath(vpnProfilePath);
  if (!account) {
    throw new Error(`No X browser account is linked to VPN profile: ${vpnProfilePath}`);
  }
  return account;
}

function browserLaunchOptions(config: ReturnType<typeof loadConfig>, record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>) {
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
  if (showLocal) {
    void record("info", "browser.display.live", "Local live browser display enabled for without-API search", { display: display.label });
  }

  const args = [
    ...display.launchArgs,
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-dev-shm-usage",
    "--disable-gpu"
  ];
  if (shouldDisableChromiumSandbox(config.playwrightDisableSandbox)) {
    args.push("--no-sandbox");
  }
  return {
    executablePath,
    headless,
    args
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

function x11SocketPath(display: string) {
  const match = display.match(/:(\d+)/);
  return match ? `/tmp/.X11-unix/X${match[1]}` : undefined;
}

function findChromiumExecutable(): string | undefined {
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].find((candidate) => fsSync.existsSync(candidate));
}

function publicIpv4FromReport(report: VpnDiagnosticsReport): string | null {
  const value = report.checks.publicIpv4?.value;
  return typeof value === "string" ? value : null;
}

function lastOutputLines(value: string, limit: number): string {
  return value
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .join("\n");
}

function parseArgs(args: string[]): WorkerArgs {
  const parsed: WorkerArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--run-id" && next) {
      parsed.runId = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length);
      continue;
    }
    if (arg === "--smoke") {
      parsed.smoke = true;
      continue;
    }
    if (arg === "--keyword" && next) {
      parsed.keyword = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--keyword=")) {
      parsed.keyword = arg.slice("--keyword=".length);
      continue;
    }
  }
  return parsed;
}

function safeStopRun(runs: RunService, runId: string): void {
  try {
    const run = runs.get(runId);
    if (run && (run.status === "running" || run.status === "paused")) {
      runs.stop(runId);
    }
  } catch {
    // The worker is already shutting down.
  }
}

function safePauseRun(runs: RunService, runId: string): void {
  try {
    const run = runs.get(runId);
    if (run?.status === "running") {
      runs.pause(runId);
    }
  } catch {
    // The worker is already shutting down.
  }
}

function safeCompleteRun(runs: RunService, runId: string): void {
  try {
    const run = runs.get(runId);
    if (run && (run.status === "running" || run.status === "paused")) {
      runs.complete(runId);
    }
  } catch {
    // The worker has already been stopped by the admin.
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(error instanceof ManualVerificationRequiredError ? 2 : 1);
  });
}
