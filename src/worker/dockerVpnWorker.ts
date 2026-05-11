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
import { normalizeValue } from "../text";
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
      const config = loadDockerAppConfig();
      await assertVpnRuntime(config, "Docker VPN worker");
      const currentRun = runs.current();
      if (currentRun?.status === "running") {
        const code = await runWithoutApiWorker(currentRun, config, record);
        if (code === 0) {
          await maybeStartNextChainedRun(currentRun.id, runs, lists, config, record);
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
  const completedRun = runs.get(completedRunId);
  if (!completedRun || completedRun.status !== "completed") {
    return;
  }
  if (runs.current()) {
    return;
  }

  const chain = nextRunChainState(parseRunStats(completedRun.statsJson));
  if (!chain) {
    return;
  }
  const keywords = plannedKeywords(lists, config);
  if (keywords.length === 0) {
    await record("info", "docker_vpn.run.chain.empty", "Sequential Docker VPN runs stopped because no eligible keywords remain", {
      previousRunId: completedRunId,
      chainIndex: chain.index,
      chainTotal: chain.total
    });
    return;
  }

  const nextRun = runs.start({
    sessionKeywordLimit: config.searchWithoutApiSessionKeywordLimit,
    sessionKeywordLimitRandom: config.searchWithoutApiSessionKeywordLimitRandom,
    randomizeKeywordOrder: config.searchWithoutApiRandomizeKeywordOrder,
    runChainTotal: chain.total,
    runChainIndex: chain.index,
    runChainRemaining: chain.remaining
  });
  await record("info", "docker_vpn.run.chain.started", "Sequential Docker VPN run queued", {
    previousRunId: completedRunId,
    runId: nextRun.id,
    plannedKeywords: keywords.length,
    chainIndex: chain.index,
    chainTotal: chain.total
  });
}

function nextRunChainState(stats: RunStats): RunChainState | null {
  const remaining = Math.max(0, Math.floor(stats.runChainRemaining ?? 0));
  if (remaining <= 0) {
    return null;
  }
  const total = Math.max(1, Math.floor(stats.runChainTotal ?? remaining + 1));
  const index = Math.max(1, Math.floor(stats.runChainIndex ?? 1)) + 1;
  return { total, index, remaining: remaining - 1 };
}

function plannedKeywords(
  lists: ListService,
  config: Pick<AppConfig, "searchWithoutApiSessionKeywordLimit" | "searchWithoutApiSessionKeywordLimitRandom" | "searchWithoutApiRandomizeKeywordOrder">
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
  return orderedKeywords.slice(0, totalKeywords);
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

function childBaseEnv(config: AppConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...readDotEnvFile(),
    DATABASE_URL: config.databaseUrl,
    CURRENT_SESSION_FILE: config.currentSessionFile,
    SEARCH_WITHOUT_API_ISOLATION: "docker_vpn",
    SEARCH_WITHOUT_API_PROFILE_DIR: config.searchWithoutApiProfileDir,
    SEARCH_WITHOUT_API_MEDIA_CACHE_DIR: config.searchWithoutApiMediaCacheDir,
    REDQUEENX_DOCKER_VPN: "true",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    PLAYWRIGHT_DISABLE_SANDBOX: process.env.PLAYWRIGHT_DISABLE_SANDBOX || "true"
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
