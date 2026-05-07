import "dotenv/config";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { loadConfig } from "../config";
import { Crawler } from "../crawler";
import { openDatabase } from "../db/database";
import { formatDiagnosticsReport, runVpnDiagnostics, type VpnDiagnosticsReport } from "../diagnostics/vpn";
import { CurrentSessionService, type CurrentSessionLevel } from "../admin/currentSessionService";
import { ListService } from "../admin/listService";
import { RunService, parseRunStats } from "../admin/runService";
import { SettingsService } from "../admin/settingsService";
import { RawTimelineTweetService, type RawTimelineDecisionUpdate } from "../admin/rawTimelineTweetService";
import { TimelineTweetService } from "../admin/timelineTweetService";
import { XBrowserAccountService, type XBrowserAccountRecord } from "../admin/xBrowserAccountService";
import {
  defaultManualVerificationMessage,
  defaultManualVerificationRecommendation,
  XSessionAlertService,
  type XSessionAlertType
} from "../admin/xSessionAlertService";
import { normalizeValue } from "../text";
import type { RunRecord, ScoringConfig, TweetCandidate } from "../types";
import { buildBrowserSearchQuery, buildBrowserSearchUrl, detectManualVerification, extractVisibleTweets } from "./browserSearch";
import {
  hoverVisibleTweets,
  nextMouseProfile,
  randomDelayMs,
  randomInt,
  scrollWithPacing,
  type MouseProfile,
  type HumanPacingConfig,
  typeWithPacing
} from "./humanPacing";
import { assertVpnNamespaceRuntime } from "./vpnGuard";

interface WorkerArgs {
  runId?: string;
  smoke?: boolean;
  keyword?: string;
}

const SMOKE_KEYWORDS = ["hack", "sql injection", "last cve", "xss"] as const;

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
  const accounts = new XBrowserAccountService(database);
  const alerts = new XSessionAlertService(database);
  const currentSession = new CurrentSessionService(config.currentSessionFile);

  const record = (level: CurrentSessionLevel, type: string, message: string, data: Record<string, unknown> = {}) =>
    currentSession.record(level, type, message, data).catch(() => undefined);

  let browser: Browser | null = null;
  let account: XBrowserAccountRecord | null = null;
  let run: RunRecord | null = null;
  let publicIpv4: string | null = null;

  try {
    await assertVpnNamespaceRuntime(config.vpnNetnsName, "Without-API crawler worker");
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
      throw new Error(`X browser session for ${account.xIdentifier} is not ready. Run npm run netns:x-login -- --account-id ${account.id}.`);
    }

    const keywordPlan = args.smoke ? await planSmokeKeywords(args.keyword) : planBrowserKeywords(lists, config);
    if (args.smoke && runs.current()) {
      throw new Error("Smoke test refuses to start while another run is active. Stop the current run first.");
    }
    run = args.runId ? runs.get(args.runId) : runs.current();
    if (!run) {
      run = runs.start(createBrowserRunStats(keywordPlan.keywords.length, config, keywordPlan.availableKeywords));
    }
    if (run.status === "paused") {
      run = runs.resume(run.id);
    }

    const keywords = keywordPlan.keywords;
    runs.replaceKeywords(run.id, keywords);
    runs.updateStats(run.id, createBrowserRunStats(keywords.length, config, keywordPlan.availableKeywords));
    await record(
      "info",
      args.smoke ? "browser.search.smoke.plan" : "browser.search.plan",
      args.smoke ? "Without-API smoke test plan prepared" : "Without-API browser search plan prepared",
      {
      runId: run.id,
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: config.vpnConfig,
      totalKeywords: keywords.length,
      availableKeywords: keywordPlan.availableKeywords,
      sessionKeywordLimit: keywordPlan.configuredLimit,
      randomSessionKeywordLimit: keywordPlan.randomized,
      randomizeKeywordOrder: keywordPlan.orderRandomized,
        oneKeywordPerSearch: true,
        smokeTest: Boolean(args.smoke),
        smokeKeywordPool: args.smoke ? SMOKE_KEYWORDS : undefined
      }
    );

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
      (result) =>
        args.smoke
          ? timelineTweets.saveAcceptedFromTest(result.keyword, result.tweet, result.decision)
          : timelineTweets.saveAccepted(result.keyword, result.tweet, result.decision)
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
        recommendation: defaultManualVerificationRecommendation(account.id),
        details: error.details
      });
      accounts.markStatus(account.id, "needs_login");
      if (run) {
        safeStopRun(runs, run.id);
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
        commands: [
          "npm run setup:local",
          `npm run netns:x-login -- --account-id ${account.id} --resolve-alert`,
          "npm run netns:diagnose",
          "npm run netns:worker"
        ]
      });
      requestVpnTeardown(record, config.vpnNetnsName);
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
  smoke?: boolean;
}) {
  const pacing = browserPacingConfig(input.config);
  let previousMouseProfile: MouseProfile | null = null;
  let completedKeywords = parseRunStats(input.runs.get(input.runId)?.statsJson ?? "{}").completedKeywords;
  let acceptedTotal = 0;
  let rejectedTotal = 0;
  let searchesInWindow = 0;
  const keywordSummaries: BrowserKeywordSummary[] = [];
  let searchesBeforePause = searchesBeforePauseForKeywords(input.keywords.length - completedKeywords);

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
    const search = await searchOneKeyword(input.page, keyword, previousMouseProfile, pacing, input.config, input.publicIpv4, {
      smoke: input.smoke,
      runId: input.runId,
      position: completedKeywords + 1,
      saveSnapshots: Boolean(input.smoke || input.config.searchWithoutApiSaveSnapshots),
      retweetFilterApplied,
      minimumRetweetsEnabled: scoringConfig.enableMinimumTweetRetweets,
      minimumTweetRetweets: scoringConfig.minimumTweetRetweets,
      record: input.record
    });
    const tweets = search.tweets;
    const rawSaved = input.rawTimelineTweets.saveVisible(input.runId, keyword, tweets);
    await input.record("debug", "browser.raw_timeline.saved", "Visible browser tweets saved to raw timeline", {
      runId: input.runId,
      keyword,
      visibleTweets: tweets.length,
      savedTweets: rawSaved,
      scoringIndependent: true
    });
    const prefilterResults = input.crawler.explainTweetsForHydration(keyword, tweets);
    const prefilterRejected = prefilterResults.filter((result) => !result.decision.accepted);
    const selectedTweets = prefilterResults.filter((result) => result.decision.accepted).map((result) => result.tweet);
    const scored = input.crawler.scoreTweets(keyword, selectedTweets);
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
    const accepted = scored.filter((result) => result.decision.accepted).length;
    const scoringRejected = scored.filter((result) => !result.decision.accepted);
    const rejected = prefilterRejected.length + scoringRejected.length;
    acceptedTotal += accepted;
    rejectedTotal += rejected;
    const prefilterReasonCounts = countReasonOccurrences(prefilterRejected.flatMap((result) => result.decision.reasons));
    const scoringReasonCounts = countReasonOccurrences(scoringRejected.flatMap((result) => result.decision.reasons));
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
    const noUsableResult = scoringConfig.enableMinimumSearchResults && usableTweets < scoringConfig.minimumSearchResults;
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
      noResultSaved: noUsableResult && !input.smoke,
      prefilterReasonCounts,
      scoringReasonCounts,
      beforeSearch: search.beforeSearch,
      afterSearch: search.afterSearch
    });
    if (noUsableResult && !input.smoke) {
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
        reason: "usable_tweets_below_minimum",
        minimumSearchResults: scoringConfig.minimumSearchResults,
        usableTweets
      });
    } else {
      await input.record("debug", "browser.list.no_result.skipped", "Keyword was not saved to No.Result", {
        runId: input.runId,
        keyword,
        smokeTest: Boolean(input.smoke),
        minimumSearchResultsEnabled: scoringConfig.enableMinimumSearchResults,
        minimumSearchResults: scoringConfig.minimumSearchResults,
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
      noResultSaved: noUsableResult && !input.smoke,
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

    if (searchesInWindow >= searchesBeforePause && completedKeywords < input.keywords.length) {
      const pauseMinutes = randomInt(input.config.searchWithoutApiPauseMinMinutes, input.config.searchWithoutApiPauseMaxMinutes);
      const nextResetAt = new Date(Date.now() + pauseMinutes * 60_000).toISOString();
      input.runs.updateStats(input.runId, { nextApiResetAt: nextResetAt });
      await input.record("info", "browser.search.pause_window", "Without-API search pacing pause started", {
        runId: input.runId,
        pauseMinutes,
        nextSearchWindow: nextResetAt
      });
      await interruptibleDelay(input.runs, input.runId, pauseMinutes * 60_000);
      searchesInWindow = 0;
      searchesBeforePause = searchesBeforePauseForKeywords(input.keywords.length - completedKeywords);
    } else if (completedKeywords < input.keywords.length) {
      const baseDelay = randomDelayMs(
        input.config.searchWithoutApiSearchDelayMinSeconds * 1000,
        input.config.searchWithoutApiSearchDelayMaxSeconds * 1000
      );
      await interruptibleDelay(input.runs, input.runId, noUsableResult ? Math.floor(baseDelay / 2) : baseDelay);
    }
  }

  input.runs.updateStats(input.runId, { currentKeyword: null });
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

function indentBlock(value: string, prefix: string): string[] {
  return value.split("\n").map((line) => `${prefix}${line}`);
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
  await page.goto(config.searchWithoutApiStartUrl || "https://x.com/search", { waitUntil: "domcontentloaded", timeout: 45_000 });
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
  await assertNoManualVerification(page, publicIpv4);

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
    await searchInput.click({ timeout: 5_000 });
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
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
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
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  await page.waitForTimeout(1_200);
  submitSearchMs = Date.now() - submitStartedAt;
  await assertNoManualVerification(page, publicIpv4);
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
    await assertNoManualVerification(page, publicIpv4);
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

async function assertNoManualVerification(page: Page, publicIpv4: string | null): Promise<void> {
  const detected = await detectManualVerification(page);
  if (detected) {
    const details = await captureManualVerificationDetails(page, detected.type, detected.reason, detected.signals);
    throw new ManualVerificationRequiredError(detected.type, detected.reason, publicIpv4, details);
  }
}

async function captureManualVerificationDetails(
  page: Page,
  alertType: XSessionAlertType,
  reason: string,
  detectionSignals: string[]
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
    bodyTextLength: details.bodyTextLength,
    htmlLength: details.htmlLength,
    snapshotPath: details.snapshotPath
  };
}

function plannedBrowserKeywords(lists: ListService): string[] {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue));
  return lists.activeValues("keyword").filter((keyword) => {
    const normalized = normalizeValue(keyword);
    return normalized.length > 0 && !noResults.has(normalized) && !alreadyUsed.has(normalized);
  });
}

function planBrowserKeywords(lists: ListService, config: ReturnType<typeof loadConfig>) {
  const keywords = config.searchWithoutApiRandomizeKeywordOrder
    ? shuffleKeywords(plannedBrowserKeywords(lists))
    : plannedBrowserKeywords(lists);
  const configuredLimit = Math.max(0, Math.floor(config.searchWithoutApiSessionKeywordLimit));
  if (configuredLimit === 0 || keywords.length === 0) {
    return {
      keywords,
      availableKeywords: keywords.length,
      configuredLimit,
      randomized: false,
      orderRandomized: config.searchWithoutApiRandomizeKeywordOrder
    };
  }

  const max = Math.min(configuredLimit, keywords.length);
  const effectiveLimit = config.searchWithoutApiSessionKeywordLimitRandom ? randomInt(1, max) : max;
  return {
    keywords: keywords.slice(0, effectiveLimit),
    availableKeywords: keywords.length,
    configuredLimit,
    randomized: config.searchWithoutApiSessionKeywordLimitRandom,
    orderRandomized: config.searchWithoutApiRandomizeKeywordOrder
  };
}

async function planSmokeKeywords(cliKeyword?: string) {
  const promptedKeyword = cliKeyword?.trim() || (await promptSmokeKeyword());
  const keyword = promptedKeyword || SMOKE_KEYWORDS[randomInt(0, SMOKE_KEYWORDS.length - 1)];
  return {
    keywords: [keyword],
    availableKeywords: SMOKE_KEYWORDS.length,
    configuredLimit: 1,
    randomized: false,
    orderRandomized: true
  };
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

function createBrowserRunStats(totalKeywords: number, config: ReturnType<typeof loadConfig>, availableKeywords = totalKeywords) {
  const apiCallLimit = searchesBeforePauseForKeywords(totalKeywords);
  return {
    currentKeyword: null,
    totalKeywords,
    completedKeywords: 0,
    remainingKeywords: totalKeywords,
    availableKeywords,
    sessionKeywordLimit: config.searchWithoutApiSessionKeywordLimit,
    sessionKeywordLimitRandom: config.searchWithoutApiSessionKeywordLimitRandom,
    randomizeKeywordOrder: config.searchWithoutApiRandomizeKeywordOrder,
    apiCallsUsed: 0,
    apiCallLimit,
    apiCallsRemaining: apiCallLimit,
    apiWindowMinutes: config.searchWithoutApiPauseMaxMinutes,
    nextApiResetAt: null,
    acceptedTweets: 0,
    rejectedTweets: 0,
    lastScore: null,
    lastTweetId: null
  };
}

function searchesBeforePauseForKeywords(remainingKeywords: number): number {
  const remaining = Math.max(0, Math.floor(remainingKeywords));
  if (remaining <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(remaining / 2));
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
  if (config.playwrightDisableSandbox && process.getuid?.() === 0) {
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
