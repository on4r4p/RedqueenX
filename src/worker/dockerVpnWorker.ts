import "dotenv/config";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";
import { loadConfig, type AppConfig } from "../config";
import { openDatabase } from "../db/database";
import { CurrentSessionService, type CurrentSessionLevel } from "../admin/currentSessionService";
import { ListService } from "../admin/listService";
import { MediaCacheJobService, type MediaCacheJobRecord } from "../admin/mediaCacheJobService";
import { parseRunStats, RunService } from "../admin/runService";
import { SettingsService } from "../admin/settingsService";
import { XBrowserAccountService } from "../admin/xBrowserAccountService";
import { XSessionAlertService } from "../admin/xSessionAlertService";
import { keywordBatchMultiplierFromRunChainCount } from "../runPlanning";
import { isHandleSearchKeyword, normalizeValue } from "../text";
import type { RunRecord, RunStats } from "../types";
import { assertVpnRuntime } from "./vpnGuard";

type RunChainState = {
  total: number;
  index: number;
  remaining: number;
};

type StaleKeywordUserPruneRequest = {
  jobId: string;
  maxAgeDays: number;
  actionDelayMinSeconds?: number;
  actionDelayMaxSeconds?: number;
  maxRetries?: number;
  startIndex?: number;
  requestedAt?: string;
  reportPath?: string;
  resumeStatePath?: string;
  requestPath: string;
  runningPath: string;
};

let shuttingDown = false;

process.once("SIGINT", () => {
  shuttingDown = true;
});
process.once("SIGTERM", () => {
  shuttingDown = true;
});

async function main() {
  const config = loadDockerAppConfig();
  if (config.searchWithoutApiIsolation !== "docker_vpn") {
    throw new Error("worker:docker-vpn requires SEARCH_WITHOUT_API_ISOLATION=docker_vpn.");
  }

  const database = openDatabase(config.databaseUrl);
  const runs = new RunService(database);
  const lists = new ListService(database);
  const settings = new SettingsService(database);
  const accounts = new XBrowserAccountService(database);
  const alerts = new XSessionAlertService(database);
  const mediaCacheJobs = new MediaCacheJobService(database);
  const currentSession = new CurrentSessionService(config.currentSessionFile);
  const record = (level: CurrentSessionLevel, type: string, message: string, data: Record<string, unknown> = {}) =>
    currentSession.record(level, type, message, data).catch(() => undefined);

  const resetJobs = mediaCacheJobs.resetStaleRunning();
  const resetPruneRequests = resetRunningStaleKeywordUserPruneRequests();
  await record("info", "docker_vpn.worker.started", "Docker VPN worker started", {
    pid: process.pid,
    resetStaleMediaJobs: resetJobs,
    resetStaleKeywordUserPruneRequests: resetPruneRequests
  });

  while (!shuttingDown) {
    try {
      const config = loadDockerRuntimeConfig(settings);
      await assertVpnRuntime(config, "Docker VPN worker");
      const currentRun = runs.current();
      if (currentRun?.status === "running") {
        const completedKeywordsAtStart = parseRunStats(currentRun.statsJson).completedKeywords;
        const code = await runWithoutApiWorker(currentRun, config, record);
        if (code === 0) {
          await maybeStartNextChainedRun(currentRun.id, runs, lists, config, record);
        } else if (code === 2) {
          await maybeRestartWithoutApiAfterAlert(
            currentRun.id,
            completedKeywordsAtStart,
            runs,
            accounts,
            alerts,
            config,
            record
          );
        }
        continue;
      }

      const didPrune = await processOneStaleKeywordUserPruneRequest(config, record);
      if (didPrune) {
        await delay(500);
        continue;
      }

      const didWork = await processOneMediaCacheJob(mediaCacheJobs, config, record);
      await delay(didWork ? 500 : 2_000);
    } catch (error) {
      await record("prob", "docker_vpn.worker.failed", error instanceof Error ? error.message : String(error));
      await delay(5_000);
    }
  }

  await record("info", "docker_vpn.worker.stopped", "Docker VPN worker stopped");
}

async function runWithoutApiWorker(
  run: RunRecord,
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<number | null> {
  await record("info", "docker_vpn.worker.run.started", "Docker VPN worker picked up a Search without API run", {
    runId: run.id
  });
  return runNpmScript("worker:without-api", ["--run-id", run.id], config, record, {
    startedType: "docker_vpn.worker.child.started",
    exitedType: "docker_vpn.worker.child.exited",
    failedType: "docker_vpn.worker.child.failed",
    data: { runId: run.id }
  });
}

async function maybeRestartWithoutApiAfterAlert(
  runId: string,
  completedKeywordsAtStart: number,
  runs: RunService,
  accounts: XBrowserAccountService,
  alerts: XSessionAlertService,
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<boolean> {
  const run = runs.get(runId);
  if (!run || run.status !== "paused") {
    return false;
  }
  const account = accounts.findByVpnProfilePath(config.vpnConfig);
  const alert = account ? alerts.openForAccount(account.id) : alerts.openAlerts()[0] ?? null;
  if (!alert) {
    return false;
  }

  await record("prob", "docker_vpn.browser.waiting_alert_resolution", "Docker VPN browser run is waiting for X session alert resolution", {
    runId,
    alertId: alert.id,
    accountId: alert.accountId,
    xIdentifier: alert.xIdentifier,
    autoIgnoreAlert: config.searchWithoutApiAutoIgnoreAlert,
    maxRetries: config.searchWithoutApiMaxRetries,
    autoRestartDelaySeconds: config.searchWithoutApiAutoRestartDelaySeconds
  });

  if (!config.searchWithoutApiAutoIgnoreAlert) {
    return false;
  }

  const stats = parseRunStats(run.statsJson);
  const lastAlertCompleted = stats.browserAlertLastCompletedKeywords ?? completedKeywordsAtStart;
  const progressedSinceLastAlert = stats.completedKeywords > lastAlertCompleted;
  const previousRetryCount = progressedSinceLastAlert ? 0 : Math.max(0, Math.floor(stats.browserAlertRetryCount ?? 0));
  const maxRetries = Math.max(0, Math.floor(config.searchWithoutApiMaxRetries ?? 0));
  if (previousRetryCount >= maxRetries) {
    runs.updateStats(runId, {
      browserAlertAutoIgnore: true,
      browserAlertRetryCount: previousRetryCount,
      browserAlertMaxRetries: maxRetries,
      browserAlertAutoRestartDelaySeconds: config.searchWithoutApiAutoRestartDelaySeconds,
      browserAlertAutoRestartAt: null,
      browserAlertLastCompletedKeywords: stats.completedKeywords
    });
    await record("prob", "docker_vpn.browser.auto_ignore_limit", "Docker VPN browser run auto-ignore limit reached", {
      runId,
      alertId: alert.id,
      retryCount: previousRetryCount,
      maxRetries
    });
    return false;
  }

  const closedAlert = alerts.ignore(alert.id);
  const readyAccount = accounts.findById(closedAlert.accountId);
  if (readyAccount?.storageStateExists) {
    accounts.markStatus(closedAlert.accountId, "valid");
  }
  const nextRetryCount = previousRetryCount + 1;
  const delayMs = dockerWithoutApiAlertRestartDelayMs(config.searchWithoutApiAutoRestartDelaySeconds);
  const restartAt = new Date(Date.now() + delayMs).toISOString();
  runs.updateStats(runId, {
    browserAlertAutoIgnore: true,
    browserAlertRetryCount: nextRetryCount,
    browserAlertMaxRetries: maxRetries,
    browserAlertAutoRestartDelaySeconds: config.searchWithoutApiAutoRestartDelaySeconds,
    browserAlertAutoRestartAt: restartAt,
    browserAlertLastCompletedKeywords: stats.completedKeywords,
    nextApiResetAt: restartAt
  });
  await record("prob", "docker_vpn.browser.alert_auto_ignored", "Docker VPN X session alert auto-ignored for Search without API", {
    runId,
    alertId: closedAlert.id,
    accountId: closedAlert.accountId,
    xIdentifier: closedAlert.xIdentifier,
    retryCount: nextRetryCount,
    maxRetries,
    autoRestartDelaySeconds: config.searchWithoutApiAutoRestartDelaySeconds
  });
  await record("info", "docker_vpn.browser.auto_restart_wait", "Docker VPN browser run waiting before restart after X session alert", {
    runId,
    alertId: closedAlert.id,
    retryCount: nextRetryCount,
    maxRetries,
    restartAt,
    delayMs
  });

  await interruptibleDockerDelay(delayMs);
  if (shuttingDown) {
    return false;
  }

  const current = runs.get(runId);
  if (!current || current.status !== "paused") {
    return false;
  }
  const currentAccount = accounts.findByVpnProfilePath(config.vpnConfig);
  if (currentAccount && alerts.openForAccount(currentAccount.id)) {
    await record("prob", "docker_vpn.browser.auto_restart_blocked", "Docker VPN browser run auto-restart blocked by another open X session alert", {
      runId,
      accountId: currentAccount.id,
      xIdentifier: currentAccount.xIdentifier
    });
    return false;
  }
  runs.updateStats(runId, {
    browserAlertAutoRestartAt: null,
    nextApiResetAt: null
  });
  const resumed = runs.resume(runId);
  await record("info", "docker_vpn.browser.auto_restarted", "Docker VPN browser run restarted after X session alert", {
    runId: resumed.id,
    alertId: closedAlert.id,
    retryCount: nextRetryCount,
    maxRetries
  });
  return true;
}

function dockerWithoutApiAlertRestartDelayMs(seconds: number): number {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return 0;
  }
  return Math.max(0, Math.floor(seconds)) * 1000;
}

async function interruptibleDockerDelay(ms: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms);
  while (!shuttingDown && Date.now() < deadline) {
    await delay(Math.min(1_000, deadline - Date.now()));
  }
}

async function processOneStaleKeywordUserPruneRequest(
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<boolean> {
  const request = claimStaleKeywordUserPruneRequest();
  if (!request) {
    return false;
  }
  await record("info", "docker_vpn.keyword_user_prune.started", "Docker VPN worker picked up stale keyword user pruning", {
    jobId: request.jobId,
    maxAgeDays: request.maxAgeDays,
    actionDelayMinSeconds: request.actionDelayMinSeconds,
    actionDelayMaxSeconds: request.actionDelayMaxSeconds,
    maxRetries: request.maxRetries,
    startIndex: request.startIndex,
    requestedAt: request.requestedAt,
    reportPath: request.reportPath,
    resumeStatePath: request.resumeStatePath
  });
  const args = ["--max-age-days", String(request.maxAgeDays), "--job-id", request.jobId];
  if (request.startIndex && request.startIndex > 1) {
    args.push("--start-index", String(request.startIndex));
  }
  if (Number.isFinite(request.actionDelayMinSeconds) && Number(request.actionDelayMinSeconds) >= 0) {
    args.push("--action-delay-min-seconds", String(request.actionDelayMinSeconds));
  }
  if (Number.isFinite(request.actionDelayMaxSeconds) && Number(request.actionDelayMaxSeconds) >= 0) {
    args.push("--action-delay-max-seconds", String(request.actionDelayMaxSeconds));
  }
  if (request.resumeStatePath) {
    args.push("--resume-state-path", request.resumeStatePath);
  }
  const code = await runNpmScript("keyword-users:prune-stale", args, config, record, {
    startedType: "docker_vpn.keyword_user_prune.child.started",
    exitedType: "docker_vpn.keyword_user_prune.child.exited",
    failedType: "docker_vpn.keyword_user_prune.child.failed",
    data: { jobId: request.jobId, maxAgeDays: request.maxAgeDays }
  });
  try {
    fsSync.unlinkSync(request.runningPath);
  } catch {
    // The request file is only a queue marker; the report file is authoritative.
  }
  await record(code === 0 ? "info" : "prob", code === 0 ? "docker_vpn.keyword_user_prune.completed" : "docker_vpn.keyword_user_prune.failed", code === 0 ? "Docker VPN stale keyword user pruning completed" : "Docker VPN stale keyword user pruning failed", {
    jobId: request.jobId,
    code,
    reportPath: request.reportPath
  });
  return true;
}

async function processOneMediaCacheJob(
  mediaCacheJobs: MediaCacheJobService,
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<boolean> {
  const job = mediaCacheJobs.claimNext();
  if (!job) {
    return false;
  }
  await record("info", "docker_vpn.media_cache.started", "Docker VPN worker picked up a media cache job", {
    jobId: job.id,
    tweetId: job.tweetId,
    source: job.source
  });
  const code = await runMediaCacheFetch(job, config, record);
  if (code === 0) {
    mediaCacheJobs.complete(job.id);
    await record("info", "docker_vpn.media_cache.completed", "Docker VPN media cache job completed", {
      jobId: job.id,
      tweetId: job.tweetId
    });
  } else {
    const message = `Media cache fetch exited with code ${code ?? "unknown"}.`;
    mediaCacheJobs.fail(job.id, message);
    await record("prob", "docker_vpn.media_cache.failed", message, {
      jobId: job.id,
      tweetId: job.tweetId
    });
  }
  return true;
}

async function runMediaCacheFetch(
  job: MediaCacheJobRecord,
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<number | null> {
  return runNpmScript("media-cache:fetch", ["--tweet-id", job.tweetId], config, record, {
    startedType: "docker_vpn.media_cache.child.started",
    exitedType: "docker_vpn.media_cache.child.exited",
    failedType: "docker_vpn.media_cache.child.failed",
    data: { jobId: job.id, tweetId: job.tweetId }
  });
}

async function runNpmScript(
  script: string,
  scriptArgs: string[],
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>,
  events: { startedType: string; exitedType: string; failedType: string; data: Record<string, unknown> }
): Promise<number | null> {
  await new Promise((resolve) => setImmediate(resolve));
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", script, "--", ...scriptArgs], {
      cwd: process.cwd(),
      env: childBaseEnv(config),
      stdio: ["ignore", "pipe", "pipe"]
    });
    void record("info", events.startedType, `${script} started`, { ...events.data, pid: child.pid });
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        void record("info", `${events.startedType}.stdout`, line.slice(0, 600), events.data);
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        void record("prob", `${events.startedType}.stderr`, line.slice(0, 600), events.data);
      }
    });
    child.on("error", (error) => {
      void record("prob", events.failedType, error.message, events.data);
      resolve(null);
    });
    child.on("exit", (code, signal) => {
      void record(code === 0 ? "info" : "prob", events.exitedType, `${script} exited`, {
        ...events.data,
        code,
        signal
      });
      resolve(code);
    });
  });
}

async function maybeStartNextChainedRun(
  completedRunId: string,
  runs: RunService,
  lists: ListService,
  config: AppConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const completedRun = await waitForCompletedRun(completedRunId, runs, record);
  if (!completedRun) {
    return;
  }
  const activeRun = runs.current();
  if (activeRun) {
    await record("prob", "docker_vpn.run.chain.skipped", "Sequential Docker VPN run was not queued because another run is active", {
      previousRunId: completedRunId,
      activeRunId: activeRun.id,
      activeRunStatus: activeRun.status
    });
    return;
  }

  const chain = nextRunChainState(parseRunStats(completedRun.statsJson), config);
  if (!chain) {
    await record("info", "docker_vpn.run.chain.completed", "Docker VPN run completed; no extra run queued", {
      previousRunId: completedRunId,
      ...runChainLogData(parseRunStats(completedRun.statsJson), config)
    });
    return;
  }
  const queuedBatch = nextRunChainKeywordBatch(parseRunStats(completedRun.statsJson));
  const keywords = queuedBatch?.keywords ?? plannedKeywords(lists, config);
  if (keywords.length === 0) {
    await record("info", "docker_vpn.run.chain.empty", "Sequential Docker VPN runs stopped because no eligible keywords remain. Clear SearchTerms.Used and/or No.Result to continue searching.", {
      previousRunId: completedRunId,
      chainIndex: chain.index,
      chainTotal: chain.total,
      ...keywordAvailabilityLogData(lists)
    });
    return;
  }

  const nextRun = runs.start(
    createDockerRunStats(
      keywords.length,
      keywordAvailabilityLogData(lists).availableKeywords,
      config,
      chain,
      queuedBatch?.remainingBatches ?? []
    )
  );
  runs.replaceKeywords(nextRun.id, keywords);
  await record("info", "docker_vpn.run.chain.started", "Sequential Docker VPN run queued", {
    previousRunId: completedRunId,
    runId: nextRun.id,
    plannedKeywords: keywords.length,
    chainIndex: chain.index,
    chainTotal: chain.total
  });
}

async function waitForCompletedRun(
  runId: string,
  runs: RunService,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
): Promise<RunRecord | null> {
  let latest = runs.get(runId);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!latest || latest.status === "completed") {
      return latest;
    }
    if (latest.status === "stopped") {
      await record("prob", "docker_vpn.run.chain.skipped", "Sequential Docker VPN run was not queued because the previous run stopped", {
        previousRunId: runId,
        previousRunStatus: latest.status
      });
      return null;
    }
    await delay(250);
    latest = runs.get(runId);
  }
  await record("prob", "docker_vpn.run.chain.skipped", "Sequential Docker VPN run was not queued because the previous run did not become completed", {
    previousRunId: runId,
    previousRunStatus: latest?.status ?? "missing"
  });
  return null;
}

function nextRunChainState(stats: RunStats, config: Pick<AppConfig, "runChainCount">): RunChainState | null {
  void stats;
  void config;
  return null;
}

function runChainLogData(stats: RunStats, config: Pick<AppConfig, "runChainCount">): Record<string, number | null> {
  void stats;
  void config;
  return {
    runChainTotal: 1,
    runChainIndex: 1,
    runChainRemaining: 0
  };
}

function runChainTotalFromAdditionalCount(config: Pick<AppConfig, "runChainCount">): number {
  return keywordBatchMultiplierFromRunChainCount(config.runChainCount);
}

function nextRunChainKeywordBatch(stats: RunStats): { keywords: string[]; remainingBatches: string[][] } | null {
  const batches = normalizeRunChainKeywordBatches(stats.runChainKeywordBatches);
  const keywords = batches[0] ?? [];
  if (keywords.length === 0) {
    return null;
  }
  return {
    keywords,
    remainingBatches: batches.slice(1)
  };
}

function createDockerRunStats(
  totalKeywords: number,
  availableKeywords: number,
  config: AppConfig,
  chain: RunChainState,
  runChainKeywordBatches: string[][]
): Partial<RunStats> {
  const apiCallLimit = searchesBeforePauseForKeywords(totalKeywords, config);
  const stats: Partial<RunStats> = {
    totalKeywords,
    completedKeywords: 0,
    remainingKeywords: totalKeywords,
    availableKeywords,
    sessionKeywordLimit: config.searchWithoutApiSessionKeywordLimit,
    sessionKeywordLimitRandom: config.searchWithoutApiSessionKeywordLimitRandom,
    randomizeKeywordOrder: config.searchWithoutApiRandomizeKeywordOrder,
    userKeywordPercent: config.searchWithoutApiUserKeywordPercent,
    runChainTotal: chain.total,
    runChainIndex: chain.index,
    runChainRemaining: chain.remaining,
    apiCallsUsed: 0,
    apiCallLimit,
    apiCallsRemaining: apiCallLimit,
    apiWindowMinutes: config.searchWithoutApiPauseMaxMinutes,
    browserAlertAutoIgnore: config.searchWithoutApiAutoIgnoreAlert,
    browserAlertRetryCount: 0,
    browserAlertMaxRetries: config.searchWithoutApiMaxRetries,
    browserAlertAutoRestartDelaySeconds: config.searchWithoutApiAutoRestartDelaySeconds,
    browserAlertAutoRestartAt: null,
    browserAlertLastCompletedKeywords: null
  };
  const normalizedBatches = normalizeRunChainKeywordBatches(runChainKeywordBatches);
  if (normalizedBatches.length > 0) {
    stats.runChainKeywordBatches = normalizedBatches;
  }
  return stats;
}

function searchesBeforePauseForKeywords(
  remainingKeywords: number,
  config: Pick<AppConfig, "searchWithoutApiRequestsBeforePauseMin">
): number {
  const remaining = Math.max(0, Math.floor(remainingKeywords));
  if (remaining <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor(config.searchWithoutApiRequestsBeforePauseMin));
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

function plannedKeywords(
  lists: ListService,
  config: Pick<
    AppConfig,
    | "searchWithoutApiSessionKeywordLimit"
    | "searchWithoutApiSessionKeywordLimitRandom"
    | "searchWithoutApiRandomizeKeywordOrder"
    | "searchWithoutApiUserKeywordPercent"
  >
): string[] {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue));
  const keywords = lists
    .activeValues("keyword")
    .filter((keyword) => {
      const normalized = normalizeValue(keyword);
      return normalized.length > 0 && !noResults.has(normalized) && !alreadyUsed.has(normalized);
    });
  const orderedKeywords = config.searchWithoutApiRandomizeKeywordOrder ? shuffleKeywordList(keywords) : keywords;
  const configuredLimit = Math.max(0, Math.floor(config.searchWithoutApiSessionKeywordLimit));
  const maxKeywords = configuredLimit > 0 ? Math.min(orderedKeywords.length, configuredLimit) : orderedKeywords.length;
  const totalKeywords = config.searchWithoutApiSessionKeywordLimitRandom && maxKeywords > 0 ? randomInt(1, maxKeywords) : maxKeywords;
  return applyUserKeywordPercent(orderedKeywords, totalKeywords, config.searchWithoutApiUserKeywordPercent);
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

function keywordAvailabilityLogData(lists: ListService) {
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
    availableKeywords,
    noResultKeywords: noResults.size,
    searchTermsUsedKeywords: alreadyUsed.size,
    excludedNoResultKeywords,
    excludedAlreadySearchedKeywords
  };
}

function shuffleKeywordList(keywords: string[]): string[] {
  const shuffled = [...keywords];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomInt(min: number, max: number): number {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  if (upper <= lower) {
    return lower;
  }
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function loadDockerAppConfig(): AppConfig {
  const dockerPathOverrides: NodeJS.ProcessEnv = {};
  for (const key of [
    "DATABASE_URL",
    "CURRENT_SESSION_FILE",
    "SEARCH_WITHOUT_API_PROFILE_DIR",
    "SEARCH_WITHOUT_API_MEDIA_CACHE_DIR",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
    "PLAYWRIGHT_DISABLE_SANDBOX"
  ]) {
    if (process.env[key]) {
      dockerPathOverrides[key] = process.env[key];
    }
  }
  return loadConfig({
    ...process.env,
    ...readDotEnvFile(),
    ...dockerPathOverrides,
    SEARCH_WITHOUT_API_ISOLATION: "docker_vpn"
  });
}

function loadDockerRuntimeConfig(settings: SettingsService): AppConfig {
  const config = loadDockerAppConfig();
  return {
    ...config,
    ...settings.getXApiConfig(config),
    searchWithoutApiIsolation: "docker_vpn"
  };
}

function childBaseEnv(config: AppConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...readDotEnvFile(),
    ...dockerRuntimeEnvValues(config),
    DATABASE_URL: config.databaseUrl,
    CURRENT_SESSION_FILE: config.currentSessionFile,
    SEARCH_WITHOUT_API_ISOLATION: "docker_vpn",
    SEARCH_WITHOUT_API_PROFILE_DIR: config.searchWithoutApiProfileDir,
    SEARCH_WITHOUT_API_MEDIA_CACHE_DIR: config.searchWithoutApiMediaCacheDir,
    REDQUEENX_DOCKER_VPN: "true",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
    PLAYWRIGHT_DISABLE_SANDBOX: process.env.PLAYWRIGHT_DISABLE_SANDBOX || "false"
  };
}

function dockerRuntimeEnvValues(config: AppConfig): NodeJS.ProcessEnv {
  return {
    X_API_ENABLED: String(config.xApiEnabled),
    SEARCH_WITHOUT_API_ENABLED: String(config.searchWithoutApiEnabled),
    SEARCH_WITHOUT_API_ISOLATION: config.searchWithoutApiIsolation,
    SEARCH_WITHOUT_API_PROFILE_DIR: config.searchWithoutApiProfileDir,
    SEARCH_WITHOUT_API_START_URL: config.searchWithoutApiStartUrl,
    SEARCH_WITHOUT_API_MAX_SCROLLS: String(config.searchWithoutApiMaxScrolls),
    SEARCH_WITHOUT_API_SCROLL_DELAY_MS: String(config.searchWithoutApiScrollDelayMs),
    SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS: String(config.searchWithoutApiScrollDelayMinMs),
    SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS: String(config.searchWithoutApiScrollDelayMaxMs),
    SEARCH_WITHOUT_API_HEADLESS: String(config.searchWithoutApiHeadless),
    SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL: String(config.searchWithoutApiShowBrowserLocal),
    SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS: String(config.searchWithoutApiKeyDelayMinMs),
    SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS: String(config.searchWithoutApiKeyDelayMaxMs),
    SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS: String(config.searchWithoutApiSearchDelayMinSeconds),
    SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS: String(config.searchWithoutApiSearchDelayMaxSeconds),
    SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT: String(config.searchWithoutApiSessionKeywordLimit),
    SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM: String(config.searchWithoutApiSessionKeywordLimitRandom),
    SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER: String(config.searchWithoutApiRandomizeKeywordOrder),
    SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT: String(config.searchWithoutApiUserKeywordPercent),
    SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT: String(config.searchWithoutApiAutoIgnoreAlert),
    SEARCH_WITHOUT_API_MAX_RETRIES: String(config.searchWithoutApiMaxRetries),
    SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS: String(config.searchWithoutApiAutoRestartDelaySeconds),
    SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN: String(config.searchWithoutApiRequestsBeforePauseMin),
    SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES: String(config.searchWithoutApiPauseMinMinutes),
    SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES: String(config.searchWithoutApiPauseMaxMinutes),
    SEARCH_WITHOUT_API_SCROLLS_MIN: String(config.searchWithoutApiScrollsMin),
    SEARCH_WITHOUT_API_SCROLLS_MAX: String(config.searchWithoutApiScrollsMax),
    SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS: String(config.searchWithoutApiTweetHoverMinSeconds),
    SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS: String(config.searchWithoutApiTweetHoverMaxSeconds),
    SEARCH_WITHOUT_API_MOUSE_PROFILE: config.searchWithoutApiMouseProfile,
    SEARCH_WITHOUT_API_SAVE_SNAPSHOTS: String(config.searchWithoutApiSaveSnapshots),
    SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED: String(config.searchWithoutApiMediaCacheEnabled),
    SEARCH_WITHOUT_API_MEDIA_CACHE_DIR: config.searchWithoutApiMediaCacheDir,
    SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS: String(config.searchWithoutApiMediaCacheTtlHours),
    SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB: String(config.searchWithoutApiMediaCacheMaxMb),
    SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB: String(config.searchWithoutApiMediaCacheMaxFileMb),
    SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS: String(config.searchWithoutApiMediaCacheFetchDelayMinMs),
    SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS: String(config.searchWithoutApiMediaCacheFetchDelayMaxMs),
    REDDIT_CRAWL_ENABLED: String(config.redditCrawlEnabled),
    REDDIT_CRAWL_USER_AGENT: config.redditCrawlUserAgent,
    REDDIT_CRAWL_SUBREDDITS: config.redditCrawlSubreddits.join(","),
    REDDIT_CRAWL_LIMIT_PER_KEYWORD: String(config.redditCrawlLimitPerKeyword),
    REDDIT_CRAWL_SORT: config.redditCrawlSort,
    REDDIT_CRAWL_TIME_RANGE: config.redditCrawlTimeRange,
    REDDIT_CRAWL_MIN_SCORE: String(config.redditCrawlMinScore),
    RUN_CHAIN_COUNT: String(config.runChainCount),
    RAW_TIMELINE_ENABLED: String(config.rawTimelineEnabled),
    VPN_CONFIG: config.vpnConfig,
    VPN_REMOTE_HOST: config.vpnRemoteHost,
    VPN_REMOTE_PORT: String(config.vpnRemotePort),
    VPN_REMOTE_PROTO: config.vpnRemoteProto,
    VPN_CHECK_HOST_IPV4_LEAK: String(config.vpnCheckHostIpv4Leak),
    VPN_CHECK_IPV6: String(config.vpnCheckIpv6),
    VPN_DIAGNOSTIC_STRICT: String(config.vpnDiagnosticStrict),
    VPN_DIAGNOSTIC_PLAYWRIGHT: String(config.vpnDiagnosticPlaywright)
  };
}

function claimStaleKeywordUserPruneRequest(): StaleKeywordUserPruneRequest | null {
  const dir = staleKeywordUserPruneRequestDir();
  let files: string[] = [];
  try {
    files = fsSync
      .readdirSync(dir)
      .filter((filename) => filename.endsWith(".json"))
      .sort();
  } catch {
    return null;
  }
  for (const filename of files) {
    const requestPath = path.join(dir, filename);
    const runningPath = requestPath.replace(/\.json$/, ".running");
    try {
      fsSync.renameSync(requestPath, runningPath);
      const parsed = JSON.parse(fsSync.readFileSync(runningPath, "utf8")) as {
        jobId?: string;
        maxAgeDays?: number;
        actionDelayMinSeconds?: number;
        actionDelayMaxSeconds?: number;
        maxRetries?: number;
        startIndex?: number;
        requestedAt?: string;
        reportPath?: string;
        resumeStatePath?: string;
      };
      if (!parsed.jobId || !Number.isFinite(Number(parsed.maxAgeDays)) || Number(parsed.maxAgeDays) <= 0) {
        fsSync.unlinkSync(runningPath);
        continue;
      }
      return {
        jobId: parsed.jobId,
        maxAgeDays: Number(parsed.maxAgeDays),
        actionDelayMinSeconds:
          Number.isFinite(Number(parsed.actionDelayMinSeconds)) && Number(parsed.actionDelayMinSeconds) >= 0
            ? Number(parsed.actionDelayMinSeconds)
            : undefined,
        actionDelayMaxSeconds:
          Number.isFinite(Number(parsed.actionDelayMaxSeconds)) && Number(parsed.actionDelayMaxSeconds) >= 0
            ? Number(parsed.actionDelayMaxSeconds)
            : undefined,
        maxRetries: Number.isFinite(Number(parsed.maxRetries)) && Number(parsed.maxRetries) >= 0 ? Number(parsed.maxRetries) : undefined,
        startIndex: Number.isFinite(Number(parsed.startIndex)) && Number(parsed.startIndex) > 0 ? Number(parsed.startIndex) : undefined,
        requestedAt: parsed.requestedAt,
        reportPath: parsed.reportPath,
        resumeStatePath: parsed.resumeStatePath,
        requestPath,
        runningPath
      };
    } catch {
      continue;
    }
  }
  return null;
}

function resetRunningStaleKeywordUserPruneRequests(): number {
  const dir = staleKeywordUserPruneRequestDir();
  let reset = 0;
  try {
    for (const filename of fsSync.readdirSync(dir)) {
      if (!filename.endsWith(".running")) continue;
      const runningPath = path.join(dir, filename);
      const requestPath = runningPath.replace(/\.running$/, ".json");
      try {
        fsSync.renameSync(runningPath, requestPath);
        reset += 1;
      } catch {
        // Keep scanning; another worker may have touched the marker.
      }
    }
  } catch {
    return 0;
  }
  return reset;
}

function staleKeywordUserPruneRequestDir(): string {
  return path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests");
}

function readDotEnvFile(): NodeJS.ProcessEnv {
  try {
    return dotenv.parse(fsSync.readFileSync(".env", "utf8"));
  } catch {
    return {};
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
