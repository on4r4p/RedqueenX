import crypto from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import type { Database } from "better-sqlite3";
import type { AppConfig } from "../config";
import { isListKind, ListService } from "./listService";
import { parseRunStats, RunService } from "./runService";
import { LegacyImporter } from "../legacy/importer";
import { executeAdminCommand } from "./commandParser";
import { verifyAdminPassword } from "./auth";
import { LegacyTimelineService } from "./legacyTimeline";
import { LIST_KINDS } from "../types";
import {
  scoringConfigSchema,
  serverAccessConfigSchema,
  SettingsService,
  xApiConfigSchema,
  type XApiRuntimeConfig
} from "./settingsService";
import { EnvService, envUpdateSchema } from "./envService";
import { CurrentSessionService, currentSessionLevels, type CurrentSessionLevel } from "./currentSessionService";
import { DatabaseAdminService } from "./databaseAdminService";
import { isServerAccessAllowed, parseAccessListInput } from "./serverAccess";
import { normalizeValue } from "../text";
import type { RunRecord, RunStats, TweetCandidate } from "../types";
import { Crawler } from "../crawler";
import { XApiClient } from "../x-client";
import { XActionClient } from "../x-actions";
import { RssClient } from "../rss-client";
import { TimelineTweetService } from "./timelineTweetService";
import { RawTimelineTweetService } from "./rawTimelineTweetService";
import { MediaCacheService, type MediaCacheConfig } from "./mediaCacheService";
import { XBudgetExceededError, XBudgetService } from "../x-budget";
import { XBrowserAccountService, type XBrowserAccountRecord } from "./xBrowserAccountService";
import { XSessionAlertService, type XSessionAlertRecord } from "./xSessionAlertService";

const execFileAsync = promisify(execFile);
const netnsHelperPath = "/usr/local/sbin/redqueenx-netns";

function hasUsableNetnsHelper(): boolean {
  try {
    const stat = fsSync.statSync(netnsHelperPath);
    return stat.isFile() && Boolean(stat.mode & 0o4000) && Boolean(stat.mode & 0o111);
  } catch {
    return false;
  }
}

const loginSchema = z.object({ password: z.string() });
const listMutationSchema = z.object({ value: z.string() });
const listUpdateSchema = z.object({ value: z.string() });
const commandSchema = z.object({ command: z.string().min(1) });
const importSchema = z.object({ dataDir: z.string().optional(), filename: z.string().optional() });
const importContentSchema = z.object({
  filename: z.string().min(1),
  kind: z.enum(LIST_KINDS),
  content: z.string()
});
const databaseTableParamSchema = z.object({ tableName: z.string().min(1) });
const databaseTableQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25)
});
const databaseExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json")
});
const databaseClearSchema = z.object({
  confirm: z.string().min(1)
});
const filesystemBrowseQuerySchema = z.object({
  path: z.string().optional(),
  mode: z.enum(["file", "directory"]).default("file"),
  extensions: z.string().max(200).optional()
});
const filesystemCopySchema = z.object({
  sourcePath: z.string().min(1),
  targetDir: z.string().min(1).default("./ops/vpn")
});
const openVpnAuthSchema = z.object({
  profilePath: z.string().min(1),
  username: z
    .string()
    .min(1)
    .max(500)
    .refine((value) => !/[\r\n]/.test(value), "OpenVPN username must stay on one line."),
  password: z
    .string()
    .min(1)
    .max(2_000)
    .refine((value) => !/[\r\n]/.test(value), "OpenVPN password must stay on one line.")
});
const xBrowserAccountSchema = z.object({
  accountId: z.number().int().positive().optional(),
  vpnProfilePath: z.string().min(1).optional(),
  vpnProfilePaths: z.array(z.string().min(1)).max(25_000).optional(),
  xIdentifier: z.string().min(1).max(120),
  replaceProfiles: z.boolean().optional()
});
const xBrowserAccountParamSchema = z.object({
  accountId: z.coerce.number().int().positive()
});
const xSessionAlertParamSchema = z.object({
  alertId: z.coerce.number().int().positive()
});
const xSessionAlertResolveSchema = z.object({
  note: z.string().trim().min(3)
});
const browserSnapshotParamSchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  filename: z.string().regex(/^[a-zA-Z0-9._-]+\.json$/)
});
const adminTestRunSchema = z.object({
  test: z.enum(["visible-x-login-vpn", "media-cache", "typecheck", "unit", "build", "without-api-smoke"])
});
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(80),
  offset: z.coerce.number().int().min(0).default(0),
  search: z
    .string()
    .max(200)
    .optional()
    .transform((value) => value?.trim() || undefined),
  includeDeleted: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
});
const booleanQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");
const xApiUpdateSchema = z.object({
  values: z.partialRecord(
    z.enum([
      "X_API_ENABLED",
      "SEARCH_WITHOUT_API_ENABLED",
      "SEARCH_WITHOUT_API_PROFILE_DIR",
      "SEARCH_WITHOUT_API_START_URL",
      "SEARCH_WITHOUT_API_MAX_SCROLLS",
      "SEARCH_WITHOUT_API_SCROLL_DELAY_MS",
      "SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS",
      "SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS",
      "SEARCH_WITHOUT_API_HEADLESS",
      "SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL",
      "SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS",
      "SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS",
      "SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS",
      "SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS",
      "SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT",
      "SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM",
      "SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER",
      "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN",
      "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MAX",
      "SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES",
      "SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES",
      "SEARCH_WITHOUT_API_SCROLLS_MIN",
      "SEARCH_WITHOUT_API_SCROLLS_MAX",
      "SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS",
      "SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS",
      "SEARCH_WITHOUT_API_MOUSE_PROFILE",
      "SEARCH_WITHOUT_API_SAVE_SNAPSHOTS",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_DIR",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS",
      "SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS",
      "X_LOGIN_SKIP_NETWORK_PRECHECK",
      "VPN_NETNS_NAME",
      "VPN_HOST_IFACE",
      "VPN_NETNS_CIDR",
      "VPN_NETNS_HOST_IP",
      "VPN_NETNS_GUEST_IP",
      "VPN_REMOTE_HOST",
      "VPN_REMOTE_PORT",
      "VPN_REMOTE_PROTO",
      "VPN_CONFIG",
      "VPN_CHECK_HOST_IPV4_LEAK",
      "VPN_CHECK_IPV6",
      "VPN_DIAGNOSTIC_STRICT",
      "VPN_DIAGNOSTIC_PLAYWRIGHT",
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
      "PLAYWRIGHT_DISABLE_SANDBOX",
      "X_SEARCH_API_CALL_LIMIT",
      "X_SEARCH_API_WINDOW_MINUTES",
      "X_API_CREDIT_USD",
      "X_API_TOTAL_CREDIT_USED_USD",
      "X_DAILY_SPEND_LIMIT_USD",
      "X_RUN_SPEND_LIMIT_USD",
      "X_MAX_SEARCHES_PER_DAY",
      "X_MAX_POSTS_READ_PER_DAY",
      "X_MAX_COUNT_CALLS_PER_DAY",
      "X_KEYWORDS_PER_QUERY",
      "X_COUNT_FIRST_MODE",
      "X_COST_POST_READ_USD",
      "X_COST_USER_READ_USD",
      "X_COST_MEDIA_READ_USD",
      "X_COST_USER_INTERACTION_USD",
      "X_COST_COUNT_CALL_USD"
    ]),
    z.string()
  )
});
const serverAccessUpdateSchema = z.object({
  whitelist: z.string().default(""),
  blacklist: z.string().default("")
});

export interface AdminApiOptions {
  database: Database;
  config: Pick<
    AppConfig,
    | "adminPassword"
    | "adminPasswordHash"
    | "sessionSecret"
    | "legacyDataDir"
    | "currentSessionFile"
    | "xApiEnabled"
    | "searchWithoutApiEnabled"
    | "searchWithoutApiProfileDir"
    | "searchWithoutApiStartUrl"
    | "searchWithoutApiMaxScrolls"
    | "searchWithoutApiScrollDelayMs"
    | "searchWithoutApiScrollDelayMinMs"
    | "searchWithoutApiScrollDelayMaxMs"
    | "searchWithoutApiHeadless"
    | "searchWithoutApiShowBrowserLocal"
    | "searchWithoutApiKeyDelayMinMs"
    | "searchWithoutApiKeyDelayMaxMs"
    | "searchWithoutApiSearchDelayMinSeconds"
    | "searchWithoutApiSearchDelayMaxSeconds"
    | "searchWithoutApiSessionKeywordLimit"
    | "searchWithoutApiSessionKeywordLimitRandom"
    | "searchWithoutApiRandomizeKeywordOrder"
    | "searchWithoutApiRequestsBeforePauseMin"
    | "searchWithoutApiRequestsBeforePauseMax"
    | "searchWithoutApiPauseMinMinutes"
    | "searchWithoutApiPauseMaxMinutes"
    | "searchWithoutApiScrollsMin"
    | "searchWithoutApiScrollsMax"
    | "searchWithoutApiTweetHoverMinSeconds"
    | "searchWithoutApiTweetHoverMaxSeconds"
    | "searchWithoutApiMouseProfile"
    | "searchWithoutApiSaveSnapshots"
    | "searchWithoutApiMediaCacheEnabled"
    | "searchWithoutApiMediaCacheDir"
    | "searchWithoutApiMediaCacheTtlHours"
    | "searchWithoutApiMediaCacheMaxMb"
    | "searchWithoutApiMediaCacheMaxFileMb"
    | "searchWithoutApiMediaCacheFetchDelayMinMs"
    | "searchWithoutApiMediaCacheFetchDelayMaxMs"
    | "xLoginSkipNetworkPrecheck"
    | "vpnNetnsName"
    | "vpnHostIface"
    | "vpnNetnsCidr"
    | "vpnNetnsHostIp"
    | "vpnNetnsGuestIp"
    | "vpnRemoteHost"
    | "vpnRemotePort"
    | "vpnRemoteProto"
    | "vpnConfig"
    | "vpnCheckHostIpv4Leak"
    | "vpnCheckIpv6"
    | "vpnDiagnosticStrict"
    | "vpnDiagnosticPlaywright"
    | "playwrightChromiumExecutablePath"
    | "playwrightDisableSandbox"
    | "xSearchApiCallLimit"
    | "xSearchApiWindowMinutes"
    | "xApiCreditUsd"
    | "xApiTotalCreditUsedUsd"
    | "xDailySpendLimitUsd"
    | "xRunSpendLimitUsd"
    | "xMaxSearchesPerDay"
    | "xMaxPostsReadPerDay"
    | "xMaxCountCallsPerDay"
    | "xKeywordsPerQuery"
    | "xCountFirstMode"
    | "xCostPostReadUsd"
    | "xCostUserReadUsd"
    | "xCostMediaReadUsd"
    | "xCostUserInteractionUsd"
    | "xCostCountCallUsd"
    | "rssFallbackFeedLimit"
    | "enableXWrite"
    | "x"
  >;
  envPath?: string;
  restartSignalPath?: string;
  restartDelayMs?: number;
  currentSessionFilePath?: string;
  logger?: boolean;
}

export function createAdminApi(options: AdminApiOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
  const lists = new ListService(options.database);
  const runs = new RunService(options.database);
  const importer = new LegacyImporter(options.database);
  const timeline = new LegacyTimelineService(options.database);
  const timelineTweets = new TimelineTweetService(options.database);
  const rawTimelineTweets = new RawTimelineTweetService(options.database);
  const settings = new SettingsService(options.database);
  const env = new EnvService(options.envPath);
  const databaseAdmin = new DatabaseAdminService(options.database);
  const xBrowserAccounts = new XBrowserAccountService(options.database);
  const xSessionAlerts = new XSessionAlertService(options.database);
  const currentSession = new CurrentSessionService(options.currentSessionFilePath ?? options.config.currentSessionFile);
  const xBudget = new XBudgetService(options.database, () => getXApiConfig());
  const sessions = new Set<string>();
  const requestStartTimes = new WeakMap<object, number>();
  const hostname = os.hostname();
  let activeCrawlerRunId: string | null = null;
  let activeWithoutApiWorker: ChildProcess | null = null;
  let activeWithoutApiWorkerRunId: string | null = null;
  const activeXAlertLoginProcesses = new Map<number, ChildProcess>();
  const apiResumeTimers = new Map<string, NodeJS.Timeout>();
  const frontendRoot = findFrontendRoot();
  const pageRoot = path.join(frontendRoot, "pages");
  const assetRoot = path.join(frontendRoot, "assets");

  app.register(cookie, {
    secret: options.config.sessionSecret
  });
  app.register(fastifyStatic, {
    root: assetRoot,
    prefix: "/assets/",
    decorateReply: true
  });
  void recordSession("info", "server.started", "Admin API started", { pid: process.pid });

  app.addHook("onRequest", async (request, reply) => {
    requestStartTimes.set(request, performance.now());
    const accessDecision = isServerAccessAllowed(settings.getServerAccessConfig(), request.ip);
    if (!accessDecision.allowed) {
      await recordSession("prob", "server_access.denied", "HTTP request blocked by RedqueenX access policy", {
        ip: accessDecision.ip ?? request.ip,
        reason: accessDecision.reason,
        method: request.method,
        path: safePath(request.url)
      });
      return reply.code(403).send({ error: "Forbidden by RedqueenX access policy" });
    }
    if (!shouldLogRequest(request.url)) {
      return;
    }
    await recordSession("debug", "pino.log", "incoming request", {
      level: 30,
      time: Date.now(),
      pid: process.pid,
      hostname,
      reqId: request.id,
      req: {
        method: request.method,
        url: request.url,
        host: request.headers.host,
        remoteAddress: request.ip,
        remotePort: request.socket.remotePort
      },
      msg: "incoming request"
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!shouldLogRequest(request.url)) {
      return;
    }
    const startedAt = requestStartTimes.get(request) ?? performance.now();
    const responseTime = performance.now() - startedAt;
    await recordSession(reply.statusCode >= 400 ? "prob" : "debug", "pino.log", "request completed", {
      level: pinoLevelFromStatus(reply.statusCode),
      time: Date.now(),
      pid: process.pid,
      hostname,
      reqId: request.id,
      res: {
        statusCode: reply.statusCode
      },
      responseTime,
      msg: "request completed"
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const httpError = error as Error & { statusCode?: number };
    void recordSession("prob", "http.error", httpError.message, {
      method: request.method,
      path: safePath(request.url),
      statusCode: httpError.statusCode ?? 500
    });
    reply.send(error);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin") || request.url === "/admin/login") {
      return;
    }

    const sessionId = request.cookies.redqueen_session;
    if (!sessionId || !sessions.has(sessionId)) {
      if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
        return reply.redirect("/admin/login");
      }
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/", async (_request, reply) => {
    reply.redirect("/timeline");
  });

  app.get("/timeline", async (_request, reply) => {
    return sendFrontendPage(reply, pageRoot, "timeline.html");
  });

  app.get("/raw-timeline", async (_request, reply) => {
    return sendFrontendPage(reply, pageRoot, "raw-timeline.html");
  });

  app.get("/timeline/data", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(200).default(40) }).parse(request.query);
    const xApiConfig = getXApiConfig();
    const mediaCacheService = getMediaCache();
    await mediaCacheService.prune().catch(() => undefined);
    return {
      items: timeline.latest(query.limit).map((item) => mediaCacheService.decorateTimelineItem(item)),
      actionsEnabled: Boolean(options.config.enableXWrite && xApiConfig.xApiEnabled && !xApiConfig.searchWithoutApiEnabled)
    };
  });

  app.get("/raw-timeline/data", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(300).default(80) }).parse(request.query);
    return {
      items: rawTimelineTweets.latest(query.limit)
    };
  });

  app.get("/media-cache/:cacheId", async (request, reply) => {
    const cacheId = z.object({ cacheId: z.string().regex(/^[a-f0-9]{32}$/) }).parse(request.params).cacheId;
    const entry = getMediaCache().getServeableEntry(cacheId);
    if (!entry) {
      reply.code(404).send({ error: "Media cache entry is missing, expired, or unavailable." });
      return;
    }
    reply.header("cache-control", "private, max-age=300");
    reply.type(entry.contentType ?? "application/octet-stream");
    return reply.send(fsSync.createReadStream(entry.localPath));
  });

  app.post("/admin/tweets/:tweetId/media-cache/reload", async (request, reply) => {
    const tweetId = getTweetIdParam(request.params);
    const xApiConfig = getXApiConfig();
    if (!xApiConfig.searchWithoutApiMediaCacheEnabled) {
      reply.code(403).send({ error: "Media cache download is disabled in Search without Api settings." });
      return;
    }
    const tweet = timelineTweets.find(tweetId);
    if (!tweet) {
      reply.code(404).send({ error: "Tweet not found in timeline_tweets." });
      return;
    }
    const sourceCount = getMediaCache().sourcesForTimelineItem(tweet).length;
    if (sourceCount === 0) {
      return { ok: true, sourceCount: 0, item: getMediaCache().decorateTimelineItem(tweet) };
    }

    await recordSession("info", "media_cache.reload.requested", "Timeline media cache reload requested from admin", {
      tweetId,
      sourceCount,
      viaVpnNamespace: xApiConfig.vpnNetnsName
    });

    try {
      const { stdout, stderr } = await execFileAsync("npm", ["run", "netns:media-cache:fetch", "--", "--tweet-id", tweetId], {
        cwd: process.cwd(),
        timeout: 5 * 60 * 1000,
        env: { ...process.env, VPN_NETNS_AUTOSTART: "true" },
        maxBuffer: 1024 * 1024
      });
      await recordSession("info", "media_cache.reload.completed", "Timeline media cache reload completed", {
        tweetId,
        stdout: lastOutputLines(stdout, 20),
        stderr: lastOutputLines(stderr, 20)
      });
      const updatedTweet = timelineTweets.find(tweetId);
      return { ok: true, sourceCount, item: updatedTweet ? getMediaCache().decorateTimelineItem(updatedTweet) : null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reload media through VPN.";
      await recordSession("prob", "media_cache.reload.failed", message, { tweetId });
      reply.code(502).send({ error: message });
    }
  });

  app.post("/admin/tweets/:tweetId/like", async (request, reply) => {
    const tweetId = getTweetIdParam(request.params);
    if (!options.config.enableXWrite) {
      reply.code(403).send({ error: "X write access is disabled. Set ENABLE_X_WRITE=true after configuring write tokens." });
      return;
    }
    if (getXApiConfig().searchWithoutApiEnabled || !getXApiConfig().xApiEnabled) {
      reply.code(403).send({ error: "X API write actions are unavailable while Search without API mode is active." });
      return;
    }
    try {
      const runId = runs.current()?.id;
      xBudget.assertCanSpend({ userInteractions: 1, userReads: 1 }, runId);
      await createXActionClient(options.config.x).like(tweetId);
      xBudget.record({ userInteractions: 1, userReads: 1 }, runId);
      timelineTweets.markLiked(tweetId);
      await recordSession("info", "tweet.like", "Tweet liked", { tweetId });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to like tweet";
      timelineTweets.markActionError(tweetId, "like", message);
      await recordSession("prob", "tweet.like.failed", message, { tweetId });
      reply.code(error instanceof XBudgetExceededError ? 429 : 502).send({ error: message });
    }
  });

  app.post("/admin/tweets/:tweetId/retweet", async (request, reply) => {
    const tweetId = getTweetIdParam(request.params);
    if (!options.config.enableXWrite) {
      reply.code(403).send({ error: "X write access is disabled. Set ENABLE_X_WRITE=true after configuring write tokens." });
      return;
    }
    if (getXApiConfig().searchWithoutApiEnabled || !getXApiConfig().xApiEnabled) {
      reply.code(403).send({ error: "X API write actions are unavailable while Search without API mode is active." });
      return;
    }
    try {
      const runId = runs.current()?.id;
      xBudget.assertCanSpend({ userInteractions: 1, userReads: 1 }, runId);
      await createXActionClient(options.config.x).retweet(tweetId);
      xBudget.record({ userInteractions: 1, userReads: 1 }, runId);
      timelineTweets.markRetweeted(tweetId);
      await recordSession("info", "tweet.retweet", "Tweet retweeted", { tweetId });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to retweet";
      timelineTweets.markActionError(tweetId, "retweet", message);
      await recordSession("prob", "tweet.retweet.failed", message, { tweetId });
      reply.code(error instanceof XBudgetExceededError ? 429 : 502).send({ error: message });
    }
  });

  app.get("/admin/login", async (_request, reply) => {
    return sendFrontendPage(reply, pageRoot, "login.html");
  });

  app.get("/admin", async (_request, reply) => {
    return sendFrontendPage(reply, pageRoot, "admin.html");
  });

  app.get("/favicon.ico", async (_request, reply) => {
    const icon = await fs.readFile(path.join(assetRoot, "trinity.ico"));
    return reply.header("cache-control", "no-store").type("image/x-icon").send(icon);
  });

  app.get("/trinity.ico", async (_request, reply) => {
    const icon = await fs.readFile(path.join(assetRoot, "trinity.ico"));
    return reply.header("cache-control", "no-store").type("image/x-icon").send(icon);
  });

  app.post("/admin/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const valid = verifyAdminPassword(body.password, {
      password: options.config.adminPassword,
      passwordHash: options.config.adminPasswordHash
    });

    if (!valid) {
      await recordSession("prob", "auth.login.failed", "Invalid admin login attempt");
      reply.code(401).send({ error: "Invalid password" });
      return;
    }

    const sessionId = crypto.randomUUID();
    sessions.add(sessionId);
    reply.setCookie("redqueen_session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/admin"
    });
    await recordSession("info", "auth.login", "Admin login accepted");
    return { ok: true };
  });

  app.post("/admin/logout", async (request, reply) => {
    const sessionId = request.cookies.redqueen_session;
    if (sessionId) {
      sessions.delete(sessionId);
    }
    reply.clearCookie("redqueen_session", { path: "/admin" });
    await recordSession("info", "auth.logout", "Admin logout");
    return { ok: true };
  });

  app.get("/admin/stats", async () => {
    const xApiConfig = getXApiConfig();
    return {
      lists: lists.countActiveByKind(),
      currentRun: runs.current(),
      xBudget: xBudget.snapshot(undefined, runs.current()?.id),
      runtimeModes: {
        xApiEnabled: xApiConfig.xApiEnabled,
        searchWithoutApiEnabled: xApiConfig.searchWithoutApiEnabled
      },
      searchWithoutApi: searchWithoutApiPlaceholderStats(xApiConfig),
      xSessionAlerts: xSessionAlerts.openAlerts()
    };
  });

  app.get("/admin/database/overview", async () => databaseAdmin.overview());

  app.get("/admin/filesystem/browse", async (request, reply) => {
    const query = filesystemBrowseQuerySchema.parse(request.query);
    try {
      return await browseFilesystem(query.path, query.mode, parseExtensionFilter(query.extensions));
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to browse local filesystem" });
    }
  });

  app.post("/admin/filesystem/copy", async (request, reply) => {
    const body = filesystemCopySchema.parse(request.body ?? {});
    try {
      return await copyFileIntoProjectDirectory(body.sourcePath, body.targetDir);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to copy local file" });
    }
  });

  app.get("/admin/vpn/profiles", async (request, reply) => {
    try {
      return await listOpenVpnProfiles();
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to list OpenVPN profiles" });
    }
  });

  app.post("/admin/vpn/profiles/auth", async (request, reply) => {
    const body = openVpnAuthSchema.parse(request.body ?? {});
    try {
      return await writeOpenVpnAuthFile(body.profilePath, body.username, body.password);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to write OpenVPN auth file" });
    }
  });

  app.get("/admin/vpn/sudo-status", async () => {
    const status = await checkVpnSudoStatus();
    await recordSession(status.available ? "info" : "prob", "vpn.sudo_status", status.message, {
      available: status.available,
      command: status.command
    });
    return status;
  });

  app.post("/admin/vpn/shutdown", async () => {
    const stoppedRun = await stopActiveRunForVpnShutdown();
    const netnsCommandStop = await requestNetnsCommandStop();
    const openVpnStop = await requestOpenVpnStop("manual_shutdown");
    const netnsTeardown = await requestNamespaceTeardownIfPresent(getXApiConfig().vpnNetnsName, openVpnStop);
    await recordSession("prob", "vpn.shutdown", "VPN shutdown requested from admin", {
      runStopped: Boolean(stoppedRun),
      stoppedRunId: stoppedRun?.id ?? null,
      netnsCommandsStopRequested: netnsCommandStop.requested,
      openVpnStopRequested: openVpnStop.requested,
      openVpnStopReason: openVpnStop.reason,
      namespaceTeardownRequested: netnsTeardown.requested,
      namespaceTeardownReason: netnsTeardown.reason,
      leakProtection:
        "Active run is stopped before tunnel shutdown; namespace kill switch blocks non-tun traffic until teardown finishes."
    });
    return {
      runStopped: Boolean(stoppedRun),
      run: stoppedRun,
      netnsCommands: {
        stop: netnsCommandStop
      },
      openVpn: {
        stop: openVpnStop
      },
      namespace: {
        teardown: netnsTeardown
      },
      leakProtection: {
        activeRunStoppedBeforeVpnShutdown: Boolean(stoppedRun),
        killSwitchPolicy: "namespace traffic can leave only through tun+ while the namespace exists",
        teardownPolicy: "OpenVPN script cleanup removes namespace processes and RedqueenX forwarding rules"
      }
    };
  });

  app.get("/admin/x-browser-accounts", async () => {
    const alertsByAccount = new Map(xSessionAlerts.openAlerts().map((alert) => [alert.accountId, alert]));
    return {
      accounts: xBrowserAccounts.list().map((account) => ({
        ...account,
        openAlert: alertsByAccount.get(account.id) ?? null
      }))
    };
  });

  app.get("/admin/x-session-alerts", async () => ({
    alerts: xSessionAlerts.openAlerts(),
    recent: xSessionAlerts.recent(20)
  }));

  app.post("/admin/x-session-alerts/:alertId/resolve", async (request, reply) => {
    try {
      const { alertId } = xSessionAlertParamSchema.parse(request.params);
      const body = xSessionAlertResolveSchema.parse(request.body);
      const alert = xSessionAlerts.resolve(alertId, body.note);
      await recordSession("info", "x.session_alert.resolved", "X session alert resolved by admin", {
        alertId: alert.id,
        accountId: alert.accountId,
        xIdentifier: alert.xIdentifier
      });
      return { alert };
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to resolve alert" });
    }
  });

  app.post("/admin/x-session-alerts/:alertId/manual-login", async (request, reply) => {
    try {
      const { alertId } = xSessionAlertParamSchema.parse(request.params);
      const alert = xSessionAlerts.find(alertId);
      if (!alert) {
        reply.code(404).send({ error: `X session alert not found: ${alertId}` });
        return;
      }
      if (alert.status !== "open") {
        reply.code(409).send({ error: "This X session alert is already resolved." });
        return;
      }

      const account = xBrowserAccounts.findById(alert.accountId);
      if (!account) {
        reply.code(404).send({ error: `X browser account not found: ${alert.accountId}` });
        return;
      }

      const commands = xAlertManualLoginCommands(account.id);
      if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
        await recordSession("info", "x.session_alert.login.launch_skipped", "Manual X login launch skipped in test mode", {
          alertId: alert.id,
          accountId: account.id,
          xIdentifier: account.xIdentifier,
          command: commands.webLaunch
        });
        return { launched: false, skippedInTest: true, alert, account, commands };
      }

      if (!hasUsableNetnsHelper()) {
        reply.code(409).send({
          error: [
            "RedqueenX cannot launch the visible X login yet because the local root helper is not installed.",
            "Run npm run setup:local once in a terminal, then click Launch visible X login again.",
            `Manual fallback command after setup: ${commands.manualLogin}`
          ].join(" "),
          commands
        });
        return;
      }

      const activeProcess = activeXAlertLoginProcesses.get(alert.id);
      if (activeProcess && activeProcess.exitCode === null) {
        return {
          launched: false,
          alreadyRunning: true,
          pid: activeProcess.pid,
          alert,
          account,
          commands,
          message: "A visible X login process is already running for this alert."
        };
      }

      const currentRun = runs.current();
      if (currentRun) {
        clearApiResumeTimer(currentRun.id);
        runs.updateStats(currentRun.id, { currentKeyword: null });
        const stopped = runs.stop(currentRun.id);
        stopWithoutApiWorker("x_alert_manual_login");
        await recordSession("prob", "x.session_alert.login_stopped_run", "Active run stopped before manual X login", {
          runId: stopped.id,
          alertId: alert.id,
          accountId: account.id,
          xIdentifier: account.xIdentifier
        });
      }

      const launched = await launchXAlertManualLogin(alert, account, commands);
      return {
        launched: true,
        pid: launched.pid,
        logPath: launched.logPath,
        alert,
        account,
        commands,
        message:
          "Visible X login launched. Solve the X verification in the Chrome window. RedqueenX will save the session when it detects that the account is logged in."
      };
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to launch manual X login" });
    }
  });

  app.get("/admin/x-session-alerts/:alertId/manual-login/status", async (request, reply) => {
    try {
      const { alertId } = xSessionAlertParamSchema.parse(request.params);
      const alert = xSessionAlerts.find(alertId);
      if (!alert) {
        reply.code(404).send({ error: `X session alert not found: ${alertId}` });
        return;
      }
      const account = xBrowserAccounts.findById(alert.accountId);
      return await readXAlertManualLoginStatus(alert, account ?? null);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to read manual X login status" });
    }
  });

  app.post("/admin/x-browser-accounts", async (request, reply) => {
    const body = xBrowserAccountSchema.parse(request.body ?? {});
    try {
      const account = xBrowserAccounts.upsert(body);
      await recordSession("info", "x_browser_account.saved", "X browser account association saved", {
        accountId: account.id,
        vpnProfilePath: account.vpnProfilePath,
        vpnProfileCount: account.vpnProfilePaths.length,
        xIdentifier: account.xIdentifier,
        storageStateExists: account.storageStateExists
      });
      return { account };
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to save X browser account" });
    }
  });

  app.delete("/admin/x-browser-accounts/:accountId", async (request, reply) => {
    const { accountId } = xBrowserAccountParamSchema.parse(request.params);
    const result = xBrowserAccounts.delete(accountId);
    if (!result.deleted) {
      reply.code(404).send({ error: "Unknown X browser account" });
      return;
    }
    await recordSession("info", "x_browser_account.deleted", "X browser account association deleted", { accountId });
    return result;
  });

  app.get("/admin/database/tables/:tableName", async (request, reply) => {
    const { tableName } = databaseTableParamSchema.parse(request.params);
    const query = databaseTableQuerySchema.parse(request.query);
    try {
      return databaseAdmin.tableDetail(tableName, query.limit);
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : "Unknown SQLite table" });
    }
  });

  app.get("/admin/database/tables/:tableName/export", async (request, reply) => {
    const { tableName } = databaseTableParamSchema.parse(request.params);
    const query = databaseExportQuerySchema.parse(request.query);
    try {
      const exported = databaseAdmin.exportTable(tableName, query.format);
      reply
        .header("content-disposition", `attachment; filename="${exported.filename}"`)
        .type(exported.contentType)
        .send(exported.body);
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : "Unknown SQLite table" });
    }
  });

  app.post("/admin/database/tables/:tableName/clear", async (request, reply) => {
    const { tableName } = databaseTableParamSchema.parse(request.params);
    const body = databaseClearSchema.parse(request.body ?? {});
    if (body.confirm !== tableName) {
      reply.code(400).send({ error: "Confirmation must match the table name." });
      return;
    }
    try {
      const result = databaseAdmin.clearTable(tableName);
      await recordSession("prob", "database.table.cleared", "SQLite table cleared", result);
      return result;
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : "Unknown SQLite table" });
    }
  });

  app.post("/admin/database/integrity-check", async () => databaseAdmin.integrityCheck());

  app.post("/admin/database/analyze", async () => {
    const result = databaseAdmin.analyze();
    await recordSession("info", "database.analyze", "SQLite ANALYZE completed");
    return result;
  });

  app.post("/admin/database/vacuum", async () => {
    const result = databaseAdmin.vacuum();
    await recordSession("info", "database.vacuum", "SQLite VACUUM completed");
    return result;
  });

  app.get("/admin/session/current", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(1000).default(200),
        level: z.enum(currentSessionLevels).default("debug"),
        includeAdminPolling: booleanQuerySchema,
        includeTweetContent: booleanQuerySchema,
        includeTweetScore: booleanQuerySchema,
        includeTweetFavoriteCount: booleanQuerySchema,
        includeTweetRetweetCount: booleanQuerySchema
      })
      .parse(request.query);
    return {
      session: await currentSession.read(query.limit, query.level, {
        includeAdminPolling: query.includeAdminPolling,
        includeTweetContent: query.includeTweetContent,
        includeTweetScore: query.includeTweetScore,
        includeTweetFavoriteCount: query.includeTweetFavoriteCount,
        includeTweetRetweetCount: query.includeTweetRetweetCount
      }),
      currentRun: runs.current() ?? runs.latest(),
      events: runs.latestEvents(80),
      xSessionAlerts: xSessionAlerts.openAlerts(),
      runtimeModes: {
        xApiEnabled: getXApiConfig().xApiEnabled,
        searchWithoutApiEnabled: getXApiConfig().searchWithoutApiEnabled
      }
    };
  });

  app.get("/admin/session/keywords", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(5_000).default(1_000) }).parse(request.query);
    const run = runs.current() ?? runs.latest();
    if (!run) {
      return { run: null, keywords: [], total: 0, loaded: 0 };
    }
    const stats = parseRunStats(run.statsJson);
    const keywords = runs.keywords(run.id, query.limit).map((item) => ({
      ...item,
      status:
        item.position <= stats.completedKeywords
          ? "completed"
          : item.keyword === stats.currentKeyword
            ? "current"
            : "pending"
    }));
    return {
      run: { id: run.id, status: run.status },
      keywords,
      total: stats.totalKeywords,
      loaded: keywords.length,
      completedKeywords: stats.completedKeywords,
      currentKeyword: stats.currentKeyword
    };
  });

  app.get("/admin/browser-snapshots", async () => listBrowserSnapshots());

  app.get("/admin/browser-snapshots/:runId/:filename", async (request, reply) => {
    try {
      const params = browserSnapshotParamSchema.parse(request.params);
      return await readBrowserSnapshot(params.runId, params.filename);
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : "Snapshot not found" });
    }
  });

  app.post("/admin/tests/run", async (request, reply) => {
    const body = adminTestRunSchema.parse(request.body ?? {});
    const test = adminTestSpecs[body.test];
    const command = `npm run ${test.script}`;
    await recordSession("info", "admin.test.started", "Admin test started", {
      test: body.test,
      label: test.label,
      command
    });

    try {
      const result = await execFileAsync("npm", ["run", test.script], {
        cwd: process.cwd(),
        timeout: test.timeoutMs,
        maxBuffer: 3 * 1024 * 1024,
        env: {
          ...process.env,
          ...(test.vpnAutostart ? { VPN_NETNS_AUTOSTART: "true" } : {})
        }
      });
      await recordSession("info", "admin.test.completed", "Admin test completed", {
        test: body.test,
        label: test.label,
        command
      });
      return {
        ok: true,
        test: body.test,
        label: test.label,
        description: test.description,
        command,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error) {
      const execError = error as Error & { code?: number | string; stdout?: string; stderr?: string };
      await recordSession("prob", "admin.test.failed", "Admin test failed", {
        test: body.test,
        label: test.label,
        command,
        code: execError.code,
        message: execError.message,
        stderr: lastOutputLines(execError.stderr ?? "", 20)
      });
      return {
        ok: false,
        test: body.test,
        label: test.label,
        description: test.description,
        command,
        code: execError.code ?? null,
        error: execError.message,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? ""
      };
    }
  });

  app.get("/admin/settings/scoring", async () => ({
    config: settings.getScoringConfig()
  }));

  app.get("/admin/settings/server-access", async (request) => {
    const config = settings.getServerAccessConfig();
    const currentIp = isServerAccessAllowed(config, request.ip).ip ?? request.ip;
    return { config, currentIp };
  });

  app.patch("/admin/settings/server-access", async (request, reply) => {
    const body = serverAccessUpdateSchema.parse(request.body ?? {});
    const nextConfig = serverAccessConfigSchema.parse({
      whitelist: parseAccessListInput(body.whitelist),
      blacklist: parseAccessListInput(body.blacklist)
    });
    let currentDecision = isServerAccessAllowed(nextConfig, request.ip);
    if (currentDecision.reason === "not_whitelisted" && currentDecision.ip) {
      nextConfig.whitelist = Array.from(new Set([...nextConfig.whitelist, currentDecision.ip]));
      currentDecision = isServerAccessAllowed(nextConfig, request.ip);
    }
    if (!currentDecision.allowed) {
      reply.code(400).send({
        error:
          "Server access settings were not saved because they would block your current IPv4 address. Keep your current IP out of the blacklist.",
        currentIp: currentDecision.ip ?? request.ip,
        reason: currentDecision.reason
      });
      return;
    }

    const config = settings.updateServerAccessConfig(nextConfig);
    await recordSession("info", "settings.server_access.updated", "RedqueenX access settings updated", {
      whitelist: config.whitelist.length,
      blacklist: config.blacklist.length,
      appliedImmediately: true
    });
    return { config, currentIp: currentDecision.ip ?? request.ip };
  });

  app.patch("/admin/settings/scoring", async (request) => {
    const body = scoringConfigSchema.parse(request.body ?? {});
    const config = settings.updateScoringConfig(body);
    await recordSession("info", "settings.scoring.updated", "Scoring settings updated", { appliedImmediately: true });
    return { config };
  });

  app.get("/admin/settings/x-api", async () => {
    const config = getXApiConfig();
    return {
      config,
      values: xApiConfigToEnvValues(config)
    };
  });

  app.patch("/admin/settings/x-api", async (request) => {
    const body = xApiUpdateSchema.parse(request.body ?? {});
    const previousConfig = getXApiConfig();
    const config = settings.updateXApiConfig(xApiEnvValuesToConfig(body.values, previousConfig), getDefaultXApiConfig());
    const values = xApiConfigToEnvValues(config);
    await env.update(values);
    if (!config.xApiEnabled) {
      stopActiveRunBecauseXDisabled();
    }
    const changedVpnKeys = changedOpenVpnConfigKeys(previousConfig, config);
    const openVpnStop = await requestOpenVpnStopForConfigChange(changedVpnKeys);
    if (changedVpnKeys.length > 0) {
      await recordSession("info", "vpn.openvpn.config_changed", "OpenVPN settings changed from admin", {
        changedKeys: changedVpnKeys,
        stopRequested: openVpnStop.requested,
        stopReason: openVpnStop.reason,
        pids: openVpnStop.pids,
        processGroups: openVpnStop.processGroups,
        stillRunning: openVpnStop.stillRunning
      });
    }
    await recordSession("info", "settings.x_api.updated", "X API settings updated", {
      appliedImmediately: true,
      envSynced: true,
      openVpnSettingsChanged: changedVpnKeys.length > 0
    });
    return {
      config,
      values,
      restartRequired: false,
      openVpn: {
        settingsChanged: changedVpnKeys.length > 0,
        changedKeys: changedVpnKeys,
        stop: openVpnStop
      }
    };
  });

  app.post("/admin/settings/no-results/reset", async () => {
    const deleted = lists.markDeletedAll("no_result");
    await recordSession("info", "settings.no_results.reset", "No.Result list reset", { deleted });
    return { deleted };
  });

  app.post("/admin/settings/x-budget/reset", async () => {
    const deleted = xBudget.resetToday();
    const budget = xBudget.snapshot(undefined, runs.current()?.id);
    await recordSession("info", "settings.x_budget.reset", "X local budget reset", {
      deleted,
      date: budget.date
    });
    return { deleted, budget };
  });

  app.post("/admin/settings/x-counters/reset", async () => {
    const updated = xBudget.resetCounters();
    const budget = xBudget.snapshot(undefined, runs.current()?.id);
    await recordSession("info", "settings.x_counters.reset", "X local counters reset", {
      updated,
      date: budget.date,
      estimatedCostUsd: budget.estimatedCostUsd,
      runEstimatedCostUsd: budget.runEstimatedCostUsd
    });
    return { updated, budget };
  });

  app.get("/admin/env", async () => ({
    values: {
      ...(await env.read()),
      ...xApiConfigToEnvValues(getXApiConfig())
    }
  }));

  app.patch("/admin/env", async (request) => {
    const body = envUpdateSchema.parse(request.body ?? {});
    const values = await env.update(body.values);
    const restartScheduled = Boolean(options.restartSignalPath);
    if (options.restartSignalPath) {
      scheduleRestartSignal(app, options.restartSignalPath, options.restartDelayMs ?? 750);
    }
    await recordSession("info", "env.updated", ".env updated", { restartScheduled });
    return {
      values,
      restartRequired: true,
      restartScheduled
    };
  });

  app.get("/admin/import/files", async () => ({
    files: importer.listFiles(options.config.legacyDataDir)
  }));

  app.post("/admin/import/legacy", async (request) => {
    const body = importSchema.parse(request.body ?? {});
    if (body.filename) {
      const result = importer.importSingle(body.dataDir ?? options.config.legacyDataDir, body.filename);
      await recordImportResult("import.legacy.single", "Legacy file imported", result);
      return result;
    }
    const result = importer.importDirectory(body.dataDir ?? options.config.legacyDataDir);
    await recordImportResult("import.legacy.directory", "Legacy directory imported", result);
    return result;
  });

  app.post("/admin/import/content", async (request) => {
    const body = importContentSchema.parse(request.body ?? {});
    const result = importer.importContent(body.filename, body.kind, body.content);
    await recordSession("info", "import.content", "Local file imported into SQLite", {
      filename: body.filename,
      kind: body.kind,
      importedLines: result.files.reduce((sum, file) => sum + file.importedLines, 0)
    });
    return result;
  });

  app.get("/admin/lists/:kind", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const query = listQuerySchema.parse(request.query);
    const page = lists.listPage(kind, {
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      includeDeleted: query.includeDeleted
    });
    return {
      kind,
      entries: page.entries,
      pagination: {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        hasMore: page.hasMore
      }
    };
  });

  app.post("/admin/lists/:kind", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const body = listMutationSchema.parse(request.body);
    const entry = lists.add(kind, body.value);
    await recordSession("info", "list.add", "List entry added", { kind, entryId: entry.id });
    return { entry };
  });

  app.patch("/admin/lists/:kind/:id", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    try {
      const body = listUpdateSchema.parse(request.body);
      const entry = lists.update(getEntryIdParam(request.params), kind, body.value);
      await recordSession("info", "list.update", "List entry updated", { kind, entryId: entry.id });
      return { entry };
    } catch (error) {
      await recordSession("prob", "list.update.failed", error instanceof Error ? error.message : "Entry not found", {
        kind
      });
      reply.code(404).send({ error: error instanceof Error ? error.message : "Entry not found" });
    }
  });

  app.delete("/admin/lists/:kind", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const body = listMutationSchema.parse(request.body);
    const deleted = lists.markDeleted(kind, body.value);
    await recordSession("info", "list.delete", "List entries deleted", { kind, deleted });
    return { deleted };
  });

  app.delete("/admin/lists/:kind/:id", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const entryId = getEntryIdParam(request.params);
    const deleted = lists.markDeletedById(kind, entryId);
    await recordSession("info", "list.delete", "List entry deleted", { kind, entryId, deleted });
    return { deleted };
  });

  app.post("/admin/runs", async (_request, reply) => {
    const runtimeConfig = getXApiConfig();
    if (runtimeConfig.searchWithoutApiEnabled) {
      const blocked = await prepareWithoutApiRunStart(reply);
      if (!blocked.ok) return;

      const existing = runs.current();
      if (existing) {
        await stopRunForFreshStart(existing, "without_api");
      }

      const run = runs.start(createInitialRunStats(lists, runtimeConfig));
      await recordSession("info", "run.started", "Fresh run started from start action", {
        runId: run.id,
        status: run.status,
        mode: "without_api",
        accountId: blocked.account.id,
        xIdentifier: blocked.account.xIdentifier,
        vpnProfilePath: runtimeConfig.vpnConfig
      });
      startWithoutApiWorker(run);
      return { run };
    }

    if (!runtimeConfig.xApiEnabled) {
      const existing = runs.current();
      if (existing) {
        clearApiResumeTimer(existing.id);
        const stopped = runs.stop(existing.id);
        await recordSession("prob", "x.search.disabled", "X API search is disabled; active run stopped", {
          runId: stopped.id
        });
      } else {
        await recordSession("prob", "x.search.disabled", "X API search is disabled; run not started");
      }
      reply.code(409).send({ error: "X API search is disabled." });
      return;
    }

    const existing = runs.current();
    if (existing) {
      await stopRunForFreshStart(existing, "x_api");
    }

    const run = runs.start(createInitialRunStats(lists, runtimeConfig));
    await recordSession("info", "run.started", "Fresh run started from start action", {
      runId: run.id,
      status: run.status
    });
    startCrawlerLoop(run);
    return { run };
  });

  app.get("/admin/runs/current", async () => ({ run: runs.current() }));

  app.post("/admin/runs/current/pause", async (_request, reply) => {
    const run = runs.current();
    if (!run) {
      await recordSession("prob", "run.pause.failed", "No active run");
      reply.code(404).send({ error: "No active run" });
      return;
    }
    clearApiResumeTimer(run.id);
    const paused = runs.pause(run.id);
    await recordSession("info", "run.paused", "Run paused", { runId: paused.id, status: paused.status });
    return { run: paused };
  });

  app.post("/admin/runs/current/resume", async (_request, reply) => {
    const run = runs.current();
    if (!run) {
      await recordSession("prob", "run.resume.failed", "No active run");
      reply.code(404).send({ error: "No active run" });
      return;
    }
    const runtimeConfig = getXApiConfig();
    if (runtimeConfig.searchWithoutApiEnabled) {
      const blocked = await prepareWithoutApiRunStart(reply);
      if (!blocked.ok) return;
      clearApiResumeTimer(run.id);
      const resumed = runs.resume(run.id);
      await recordSession("info", "run.resumed", "Run resumed", { runId: resumed.id, status: resumed.status, mode: "without_api" });
      startWithoutApiWorker(resumed);
      return { run: resumed };
    }
    if (!runtimeConfig.xApiEnabled) {
      clearApiResumeTimer(run.id);
      const stopped = runs.stop(run.id);
      await recordSession("prob", "x.search.disabled", "X API search is disabled; run stopped instead of resumed", {
        runId: stopped.id
      });
      return { run: stopped };
    }
    clearApiResumeTimer(run.id);
    const preparedRun = resetApiWindowIfDue(run);
    const resumed = runs.resume(preparedRun.id);
    await recordSession("info", "run.resumed", "Run resumed", { runId: resumed.id, status: resumed.status });
    startCrawlerLoop(resumed);
    return { run: resumed };
  });

  app.post("/admin/runs/current/stop", async (_request, reply) => {
    const run = runs.current();
    if (!run) {
      await recordSession("prob", "run.stop.failed", "No active run");
      reply.code(404).send({ error: "No active run" });
      return;
    }
    clearApiResumeTimer(run.id);
    const stopped = runs.stop(run.id);
    stopWithoutApiWorker("admin_stop");
    await recordSession("info", "run.stopped", "Run stopped", { runId: stopped.id, status: stopped.status });
    return { run: stopped };
  });

  app.post("/admin/runs/:id/pause", async (request, reply) => {
    try {
      const id = getIdParam(request.params);
      clearApiResumeTimer(id);
      const run = runs.pause(id);
      await recordSession("info", "run.paused", "Run paused", { runId: run.id, status: run.status });
      return { run };
    } catch (error) {
      await recordSession("prob", "run.pause.failed", error instanceof Error ? error.message : "Run not found");
      reply.code(404).send({ error: error instanceof Error ? error.message : "Run not found" });
    }
  });

  app.post("/admin/runs/:id/resume", async (request, reply) => {
    try {
      const id = getIdParam(request.params);
      clearApiResumeTimer(id);
      const existing = runs.get(id);
      const runtimeConfig = getXApiConfig();
      if (runtimeConfig.searchWithoutApiEnabled) {
        const blocked = await prepareWithoutApiRunStart(reply);
        if (!blocked.ok) return;
        const run = runs.resume(id);
        await recordSession("info", "run.resumed", "Run resumed", { runId: run.id, status: run.status, mode: "without_api" });
        startWithoutApiWorker(run);
        return { run };
      }
      if (!runtimeConfig.xApiEnabled) {
        const stopped = runs.stop(id);
        await recordSession("prob", "x.search.disabled", "X API search is disabled; run stopped instead of resumed", {
          runId: stopped.id
        });
        return { run: stopped };
      }
      const run = runs.resume(resetApiWindowIfDue(existing ?? id).id);
      await recordSession("info", "run.resumed", "Run resumed", { runId: run.id, status: run.status });
      startCrawlerLoop(run);
      return { run };
    } catch (error) {
      await recordSession("prob", "run.resume.failed", error instanceof Error ? error.message : "Run not found");
      reply.code(404).send({ error: error instanceof Error ? error.message : "Run not found" });
    }
  });

  app.post("/admin/runs/:id/stop", async (request, reply) => {
    try {
      const id = getIdParam(request.params);
      clearApiResumeTimer(id);
      const run = runs.stop(id);
      stopWithoutApiWorker("admin_stop");
      await recordSession("info", "run.stopped", "Run stopped", { runId: run.id, status: run.status });
      return { run };
    } catch (error) {
      await recordSession("prob", "run.stop.failed", error instanceof Error ? error.message : "Run not found");
      reply.code(404).send({ error: error instanceof Error ? error.message : "Run not found" });
    }
  });

  app.post("/admin/command", async (request) => {
    const body = commandSchema.parse(request.body);
    const result = executeAdminCommand(body.command, { lists, runs });
    await recordSession("info", "command.legacy", "Legacy command executed", { messages: result.messages.length });
    return result;
  });

  async function recordSession(
    level: CurrentSessionLevel,
    type: string,
    message: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await currentSession.record(level, type, message, data);
    } catch (error) {
      app.log.error({ err: error }, "Unable to write current session file");
    }
  }

  async function recordImportResult(type: string, message: string, result: ReturnType<LegacyImporter["importDirectory"]>) {
    await recordSession("info", type, message, {
      dataDir: result.dataDir,
      files: result.files.length,
      importedLines: result.files.reduce((sum, file) => sum + file.importedLines, 0),
      missingFiles: result.files.filter((file) => file.status === "missing").length
    });
  }

  function getDefaultXApiConfig(): XApiRuntimeConfig {
    return xApiConfigSchema.parse({
      xSearchApiCallLimit: options.config.xSearchApiCallLimit,
      xApiEnabled: options.config.xApiEnabled,
      searchWithoutApiEnabled: options.config.searchWithoutApiEnabled,
      searchWithoutApiProfileDir: options.config.searchWithoutApiProfileDir,
      searchWithoutApiStartUrl: options.config.searchWithoutApiStartUrl,
      searchWithoutApiMaxScrolls: options.config.searchWithoutApiMaxScrolls,
      searchWithoutApiScrollDelayMs: options.config.searchWithoutApiScrollDelayMs,
      searchWithoutApiScrollDelayMinMs: options.config.searchWithoutApiScrollDelayMinMs,
      searchWithoutApiScrollDelayMaxMs: options.config.searchWithoutApiScrollDelayMaxMs,
      searchWithoutApiHeadless: options.config.searchWithoutApiHeadless,
      searchWithoutApiShowBrowserLocal: options.config.searchWithoutApiShowBrowserLocal,
      searchWithoutApiKeyDelayMinMs: options.config.searchWithoutApiKeyDelayMinMs,
      searchWithoutApiKeyDelayMaxMs: options.config.searchWithoutApiKeyDelayMaxMs,
      searchWithoutApiSearchDelayMinSeconds: options.config.searchWithoutApiSearchDelayMinSeconds,
      searchWithoutApiSearchDelayMaxSeconds: options.config.searchWithoutApiSearchDelayMaxSeconds,
      searchWithoutApiSessionKeywordLimit: options.config.searchWithoutApiSessionKeywordLimit,
      searchWithoutApiSessionKeywordLimitRandom: options.config.searchWithoutApiSessionKeywordLimitRandom,
      searchWithoutApiRandomizeKeywordOrder: options.config.searchWithoutApiRandomizeKeywordOrder,
      searchWithoutApiRequestsBeforePauseMin: options.config.searchWithoutApiRequestsBeforePauseMin,
      searchWithoutApiRequestsBeforePauseMax: options.config.searchWithoutApiRequestsBeforePauseMax,
      searchWithoutApiPauseMinMinutes: options.config.searchWithoutApiPauseMinMinutes,
      searchWithoutApiPauseMaxMinutes: options.config.searchWithoutApiPauseMaxMinutes,
      searchWithoutApiScrollsMin: options.config.searchWithoutApiScrollsMin,
      searchWithoutApiScrollsMax: options.config.searchWithoutApiScrollsMax,
      searchWithoutApiTweetHoverMinSeconds: options.config.searchWithoutApiTweetHoverMinSeconds,
      searchWithoutApiTweetHoverMaxSeconds: options.config.searchWithoutApiTweetHoverMaxSeconds,
      searchWithoutApiMouseProfile: options.config.searchWithoutApiMouseProfile,
      searchWithoutApiSaveSnapshots: options.config.searchWithoutApiSaveSnapshots,
      searchWithoutApiMediaCacheEnabled: options.config.searchWithoutApiMediaCacheEnabled,
      searchWithoutApiMediaCacheDir: options.config.searchWithoutApiMediaCacheDir,
      searchWithoutApiMediaCacheTtlHours: options.config.searchWithoutApiMediaCacheTtlHours,
      searchWithoutApiMediaCacheMaxMb: options.config.searchWithoutApiMediaCacheMaxMb,
      searchWithoutApiMediaCacheMaxFileMb: options.config.searchWithoutApiMediaCacheMaxFileMb,
      searchWithoutApiMediaCacheFetchDelayMinMs: options.config.searchWithoutApiMediaCacheFetchDelayMinMs,
      searchWithoutApiMediaCacheFetchDelayMaxMs: options.config.searchWithoutApiMediaCacheFetchDelayMaxMs,
      xLoginSkipNetworkPrecheck: options.config.xLoginSkipNetworkPrecheck,
      vpnNetnsName: options.config.vpnNetnsName,
      vpnHostIface: options.config.vpnHostIface,
      vpnNetnsCidr: options.config.vpnNetnsCidr,
      vpnNetnsHostIp: options.config.vpnNetnsHostIp,
      vpnNetnsGuestIp: options.config.vpnNetnsGuestIp,
      vpnRemoteHost: options.config.vpnRemoteHost,
      vpnRemotePort: options.config.vpnRemotePort,
      vpnRemoteProto: options.config.vpnRemoteProto,
      vpnConfig: options.config.vpnConfig,
      vpnCheckHostIpv4Leak: options.config.vpnCheckHostIpv4Leak,
      vpnCheckIpv6: options.config.vpnCheckIpv6,
      vpnDiagnosticStrict: options.config.vpnDiagnosticStrict,
      vpnDiagnosticPlaywright: options.config.vpnDiagnosticPlaywright,
      playwrightChromiumExecutablePath: options.config.playwrightChromiumExecutablePath,
      playwrightDisableSandbox: options.config.playwrightDisableSandbox,
      xSearchApiWindowMinutes: options.config.xSearchApiWindowMinutes,
      xApiCreditUsd: options.config.xApiCreditUsd,
      xApiTotalCreditUsedUsd: options.config.xApiTotalCreditUsedUsd,
      xDailySpendLimitUsd: options.config.xDailySpendLimitUsd,
      xRunSpendLimitUsd: options.config.xRunSpendLimitUsd,
      xMaxSearchesPerDay: options.config.xMaxSearchesPerDay,
      xMaxPostsReadPerDay: options.config.xMaxPostsReadPerDay,
      xMaxCountCallsPerDay: options.config.xMaxCountCallsPerDay,
      xKeywordsPerQuery: options.config.xKeywordsPerQuery,
      xCountFirstMode: options.config.xCountFirstMode,
      xCostPostReadUsd: options.config.xCostPostReadUsd,
      xCostUserReadUsd: options.config.xCostUserReadUsd,
      xCostMediaReadUsd: options.config.xCostMediaReadUsd,
      xCostUserInteractionUsd: options.config.xCostUserInteractionUsd,
      xCostCountCallUsd: options.config.xCostCountCallUsd
    });
  }

  function getXApiConfig(): XApiRuntimeConfig {
    return settings.getXApiConfig(getDefaultXApiConfig());
  }

  function getMediaCache(): MediaCacheService {
    return new MediaCacheService(options.database, getMediaCacheConfigFromRuntime(getXApiConfig()));
  }

  function searchWithoutApiPlaceholderStats(xApiConfig = getXApiConfig()) {
    const availability = keywordAvailability(lists);
    return {
      enabled: xApiConfig.searchWithoutApiEnabled,
      status: xApiConfig.searchWithoutApiEnabled ? "configured" : "disabled",
      queuedKeywords: 0,
      keywordTotal: availability.totalKeywords,
      availableKeywords: availability.availableKeywords,
      excludedNoResultKeywords: availability.excludedByNoResult,
      excludedAlreadySearchedKeywords: availability.excludedBySearchTermsUsed,
      noResultKeywords: availability.noResultEntries,
      searchTermsUsedKeywords: availability.searchTermsUsedEntries,
      capturedTweets: 0,
      acceptedTweets: 0,
      rejectedTweets: 0,
      browserSessions: 0,
      keyDelayMinMs: xApiConfig.searchWithoutApiKeyDelayMinMs,
      keyDelayMaxMs: xApiConfig.searchWithoutApiKeyDelayMaxMs,
      searchDelayMinSeconds: xApiConfig.searchWithoutApiSearchDelayMinSeconds,
      searchDelayMaxSeconds: xApiConfig.searchWithoutApiSearchDelayMaxSeconds,
      sessionKeywordLimit: xApiConfig.searchWithoutApiSessionKeywordLimit,
      sessionKeywordLimitRandom: xApiConfig.searchWithoutApiSessionKeywordLimitRandom,
      randomizeKeywordOrder: xApiConfig.searchWithoutApiRandomizeKeywordOrder,
      searchedKeywords: availability.searchTermsUsedEntries,
      requestsBeforePauseMin: xApiConfig.searchWithoutApiRequestsBeforePauseMin,
      requestsBeforePauseMax: xApiConfig.searchWithoutApiRequestsBeforePauseMax,
      pauseMinMinutes: xApiConfig.searchWithoutApiPauseMinMinutes,
      pauseMaxMinutes: xApiConfig.searchWithoutApiPauseMaxMinutes,
      scrollsMin: xApiConfig.searchWithoutApiScrollsMin,
      scrollsMax: xApiConfig.searchWithoutApiScrollsMax,
      tweetHoverMinSeconds: xApiConfig.searchWithoutApiTweetHoverMinSeconds,
      tweetHoverMaxSeconds: xApiConfig.searchWithoutApiTweetHoverMaxSeconds,
      mouseProfile: xApiConfig.searchWithoutApiMouseProfile,
      mediaCacheEnabled: xApiConfig.searchWithoutApiMediaCacheEnabled,
      mediaCacheTtlHours: xApiConfig.searchWithoutApiMediaCacheTtlHours,
      mediaCacheMaxMb: xApiConfig.searchWithoutApiMediaCacheMaxMb,
      showBrowserLocal: xApiConfig.searchWithoutApiShowBrowserLocal,
      headless: xApiConfig.searchWithoutApiHeadless,
      netnsName: xApiConfig.vpnNetnsName,
      vpnRemoteHost: xApiConfig.vpnRemoteHost,
      vpnRemotePort: xApiConfig.vpnRemotePort,
      vpnRemoteProto: xApiConfig.vpnRemoteProto,
      vpnCheckHostIpv4Leak: xApiConfig.vpnCheckHostIpv4Leak,
      vpnCheckIpv6: xApiConfig.vpnCheckIpv6,
      diagnosticStrict: xApiConfig.vpnDiagnosticStrict
    };
  }

  function applyRuntimeApiStats(run: RunRecord, xApiConfig: XApiRuntimeConfig): RunRecord {
    const stats = parseRunStats(run.statsJson);
    if (
      stats.apiCallLimit === xApiConfig.xSearchApiCallLimit &&
      stats.apiWindowMinutes === xApiConfig.xSearchApiWindowMinutes
    ) {
      return run;
    }

    return runs.updateStats(run.id, {
      apiCallLimit: xApiConfig.xSearchApiCallLimit,
      apiWindowMinutes: xApiConfig.xSearchApiWindowMinutes
    });
  }

  function stopActiveRunBecauseXDisabled(): void {
    const currentRun = runs.current();
    if (!currentRun) {
      return;
    }

    clearApiResumeTimer(currentRun.id);
    runs.updateStats(currentRun.id, { currentKeyword: null });
    runs.stop(currentRun.id);
    void recordSession("prob", "x.search.disabled", "X API search disabled from settings; active run stopped", {
      runId: currentRun.id
    });
  }

  async function stopRunForFreshStart(run: RunRecord, mode: "without_api" | "x_api"): Promise<void> {
    clearApiResumeTimer(run.id);
    await blockCurrentKeywordFromAbandonedRun(run, mode);
    runs.updateStats(run.id, { currentKeyword: null });
    const stopped = runs.stop(run.id);
    if (mode === "without_api") {
      await stopWithoutApiWorkerAndWait("fresh_start");
    }
    await recordSession("info", "run.replaced", "Previous run stopped before starting a fresh run", {
      previousRunId: stopped.id,
      mode,
      reason: "start_button_always_creates_new_run"
    });
  }

  async function blockCurrentKeywordFromAbandonedRun(run: RunRecord, mode: "without_api" | "x_api"): Promise<void> {
    if (mode !== "without_api") {
      return;
    }
    const stats = parseRunStats(run.statsJson);
    const keyword = stats.currentKeyword?.trim();
    if (!keyword) {
      return;
    }
    const entry = lists.add("search_terms_used", keyword, "runtime:fresh-start-recovery", null, new Date().toISOString());
    await recordSession("info", "browser.list.search_terms_used.recovered", "Current keyword from previous run blocked before fresh start", {
      previousRunId: run.id,
      keyword,
      entryId: entry.id,
      sourceFile: entry.sourceFile
    });
  }

  async function stopActiveRunForVpnShutdown(): Promise<RunRecord | null> {
    const currentRun = runs.current();
    if (!currentRun) {
      return null;
    }

    clearApiResumeTimer(currentRun.id);
    runs.updateStats(currentRun.id, { currentKeyword: null });
    const stopped = runs.stop(currentRun.id);
    stopWithoutApiWorker("vpn_shutdown");
    await recordSession("prob", "vpn.shutdown.run_stopped", "Active run stopped before VPN shutdown", {
      runId: stopped.id,
      status: stopped.status
    });
    return stopped;
  }

  async function checkVpnSudoStatus(): Promise<{
    available: boolean;
    message: string;
    command: string;
    fallbackCommand: string;
  }> {
    const command = "npm run setup:local";
    const fallbackCommand = "npm run netns:openvpn";
    if (!hasUsableNetnsHelper()) {
      return {
        available: false,
        message:
          "RedqueenX root helper is missing or is an old non-privileged helper. Run npm run setup:local once to install the setuid root helper, then press Start again.",
        command,
        fallbackCommand
      };
    }
    try {
      await execFileAsync(netnsHelperPath, ["status"], {
        cwd: process.cwd(),
        timeout: 5_000,
        maxBuffer: 100_000
      });
      return {
        available: true,
        message: "RedqueenX root helper is installed. VPN namespace operations can run without a sudo password prompt.",
        command,
        fallbackCommand
      };
    } catch {
      return {
        available: false,
        message:
          "RedqueenX root helper is not installed or not available. RedqueenX will fail closed until setup is complete.",
        command,
        fallbackCommand
      };
    }
  }

  function xAlertManualLoginCommands(accountId: number) {
    return {
      setup: "npm run setup:local",
      manualLogin: `npm run netns:x-login -- --account-id ${accountId} --resolve-alert`,
      webLaunch: `npm run netns:x-login -- --account-id ${accountId} --resolve-alert --auto-save-on-login --hold-open-after-save`,
      diagnose: "npm run netns:diagnose",
      worker: "npm run netns:worker"
    };
  }

  function xAlertManualLoginLogPath(alertId: number): string {
    return path.join(path.resolve(process.cwd(), "runtime"), `x-alert-login-${alertId}.log`);
  }

  async function readXAlertManualLoginStatus(alert: XSessionAlertRecord, account: XBrowserAccountRecord | null) {
    const activeProcess = activeXAlertLoginProcesses.get(alert.id);
    const running = Boolean(activeProcess && activeProcess.exitCode === null);
    const logPath = xAlertManualLoginLogPath(alert.id);
    let logText = "";
    try {
      logText = await fs.readFile(logPath, "utf8");
    } catch {
      logText = "";
    }

    const saved = logText.includes("V Session validated and saved.");
    const completed = saved || logText.includes("npm run netns:x-login completed");
    const failed =
      !saved &&
      (logText.includes("npm run netns:x-login failed") ||
        logText.includes("Manual X login process failed") ||
        /\nError: /i.test(logText));
    const state = saved && running ? "saved_running" : running ? "running" : saved ? "saved" : failed ? "failed" : completed ? "completed" : "not_started";
    const publicIpv4 = logText.match(/Last login IPv4 recorded as:\s*([^\n\r]+)/)?.[1]?.trim() ?? alert.publicIpv4 ?? null;
    const message =
      state === "running"
        ? "Visible Chrome is running through the VPN namespace. Finish the manual X verification there."
        : state === "saved_running"
          ? "X session was detected and saved. Chrome is intentionally still open so the human can finish the manual verification, then close it."
          : state === "saved"
          ? "X session was detected and saved. Chrome stayed open until the human closed it."
          : state === "failed"
            ? "Visible X login failed. Read the log tail below and retry after fixing the issue."
            : state === "completed"
              ? "Visible X login process completed."
              : "Visible X login has not produced a log yet.";

    return {
      state,
      running,
      saved,
      failed,
      pid: activeProcess?.pid ?? null,
      alert,
      account,
      publicIpv4,
      logPath,
      logTail: logText ? lastOutputLines(logText, 80) : "",
      message
    };
  }

  async function launchXAlertManualLogin(
    alert: XSessionAlertRecord,
    account: XBrowserAccountRecord,
    commands: ReturnType<typeof xAlertManualLoginCommands>
  ): Promise<{ pid?: number; logPath: string }> {
    const runtimeDir = path.resolve(process.cwd(), "runtime");
    await fs.mkdir(runtimeDir, { recursive: true });
    const logPath = xAlertManualLoginLogPath(alert.id);
    const output = fsSync.openSync(logPath, "a");
    const child = spawn("npm", ["run", "netns:x-login", "--", "--account-id", String(account.id), "--resolve-alert", "--auto-save-on-login", "--hold-open-after-save"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VPN_NETNS_AUTOSTART: "true",
        VPN_NETNS_AUTOSTART_DEFAULT: "yes",
        X_LOGIN_SKIP_NETWORK_PRECHECK: "true",
        X_LOGIN_AUTO_SAVE_TIMEOUT_MS: process.env.X_LOGIN_AUTO_SAVE_TIMEOUT_MS || String(30 * 60 * 1000),
        REDQUEENX_MANUAL_LOGIN_ALERT_ID: String(alert.id)
      },
      detached: true,
      stdio: ["ignore", output, output]
    });
    activeXAlertLoginProcesses.set(alert.id, child);
    child.unref();
    child.on("error", (error) => {
      fsSync.closeSync(output);
      if (activeXAlertLoginProcesses.get(alert.id) === child) {
        activeXAlertLoginProcesses.delete(alert.id);
      }
      void recordSession("prob", "x.session_alert.login.failed", "Manual X login process failed to start", {
        alertId: alert.id,
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        error: error.message,
        logPath
      });
    });
    child.on("close", (code, signal) => {
      try {
        fsSync.closeSync(output);
      } catch {
        // The fd can already be closed if spawn emitted an error first.
      }
      if (activeXAlertLoginProcesses.get(alert.id) === child) {
        activeXAlertLoginProcesses.delete(alert.id);
      }
      void recordSession(code === 0 ? "info" : "prob", code === 0 ? "x.session_alert.login.completed" : "x.session_alert.login.failed", code === 0 ? "Manual X login process completed" : "Manual X login process failed", {
        alertId: alert.id,
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        pid: child.pid,
        exitCode: code,
        signal,
        logPath
      });
    });
    await recordSession("info", "x.session_alert.login.launched", "Visible X login launched from admin", {
      alertId: alert.id,
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      pid: child.pid,
      command: commands.webLaunch,
      logPath,
      note:
        "No CAPTCHA or 2FA is bypassed. The human must solve X verification in the visible browser, then return to admin and mark the alert resolved with a note."
    });
    return { pid: child.pid, logPath };
  }

  async function prepareWithoutApiRunStart(
    reply: FastifyReply
  ): Promise<{ ok: true; account: XBrowserAccountRecord } | { ok: false }> {
    const runtimeConfig = getXApiConfig();
    const account = xBrowserAccounts.findByVpnProfilePath(runtimeConfig.vpnConfig);
    if (!account) {
      await recordSession("prob", "browser.search.account_missing", "No X browser account is linked to the selected VPN profile", {
        vpnProfilePath: runtimeConfig.vpnConfig
      });
      reply.code(409).send({
        error:
          "Search without API needs an X browser account linked to the selected OpenVPN profile. Configure it in Settings > X browser account."
      });
      return { ok: false };
    }
    if (!account.storageStateExists || account.sessionStatus !== "valid") {
      await recordSession("prob", "browser.search.session_missing", "X browser session is missing or needs login", {
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        sessionStatus: account.sessionStatus
      });
      reply.code(409).send({
        error: `X browser session for ${account.xIdentifier} is not ready. Run npm run netns:x-login -- --account-id ${account.id}.`
      });
      return { ok: false };
    }
    const alert = xSessionAlerts.openForAccount(account.id);
    if (alert) {
      await recordSession("prob", "x.session_alert.blocked_start", "Search without API start blocked by open X session alert", {
        alertId: alert.id,
        accountId: alert.accountId,
        xIdentifier: alert.xIdentifier
      });
      reply.code(423).send({
        error: "This X account is locked by an open manual verification alert.",
        alert
      });
      return { ok: false };
    }
    const vpnPreflight = await runWithoutApiVpnPreflight();
    if (!vpnPreflight.ok) {
      await recordSession("prob", "browser.vpn.preflight.failed", "Search without API start blocked because VPN diagnostics failed", {
        vpnProfilePath: runtimeConfig.vpnConfig,
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        error: vpnPreflight.error,
        output: vpnPreflight.output
      });
      reply.code(409).send({
        error: [
          "Search without API was not started because VPN diagnostics failed.",
          "Start/Resume tried to prepare the VPN namespace automatically, but the VPN was not ready.",
          "Check Show current session for vpn.autostart.* logs. If the root helper is missing, run npm run setup:local once, then press Start again.",
          vpnPreflight.error
        ].join(" ")
      });
      return { ok: false };
    }
    await recordSession("info", "browser.vpn.preflight.passed", "Search without API VPN diagnostics passed before Start", {
      vpnProfilePath: runtimeConfig.vpnConfig,
      accountId: account.id,
      xIdentifier: account.xIdentifier
    });
    return { ok: true, account };
  }

  async function runWithoutApiVpnPreflight(): Promise<{ ok: true; output: string } | { ok: false; error: string; output: string }> {
    await recordSession(
      "info",
      "browser.vpn.preflight.started",
      "Preparing VPN namespace and running diagnostics before Search without API start"
    );
    try {
      const result = await execFileAsync("npm", ["run", "netns:diagnose"], {
        cwd: process.cwd(),
        timeout: 240_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          VPN_NETNS_AUTOSTART: "true",
          VPN_NETNS_AUTOSTART_DEFAULT: "yes"
        }
      });
      return {
        ok: true,
        output: lastOutputLines(`${result.stdout}\n${result.stderr}`, 80)
      };
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string; signal?: string; code?: number };
      return {
        ok: false,
        error: failure.message || "VPN diagnostics failed.",
        output: lastOutputLines(`${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, 80)
      };
    }
  }

  function startWithoutApiWorker(run: RunRecord): void {
    if (activeWithoutApiWorkerRunId === run.id && activeWithoutApiWorker && activeWithoutApiWorker.exitCode === null) {
      return;
    }

    const child = spawn("npm", ["run", "netns:worker", "--", "--run-id", run.id], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeWithoutApiWorker = child;
    activeWithoutApiWorkerRunId = run.id;
    void recordSession("info", "browser.worker.started", "Search without API worker process started", {
      runId: run.id,
      pid: child.pid
    });

    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        void recordSession("info", "browser.worker.stdout", firstLine(line), { runId: run.id });
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        void recordSession("prob", "browser.worker.stderr", firstLine(line), { runId: run.id });
      }
    });
    child.on("exit", (code, signal) => {
      void recordSession(code === 0 ? "info" : "prob", "browser.worker.exited", "Search without API worker process exited", {
        runId: run.id,
        code,
        signal
      });
      if (activeWithoutApiWorker === child) {
        activeWithoutApiWorker = null;
        activeWithoutApiWorkerRunId = null;
      }
    });
  }

  function stopWithoutApiWorker(reason: string): void {
    const child = activeWithoutApiWorker;
    if (!child || child.exitCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    void recordSession("prob", "browser.worker.stop_requested", "Search without API worker stop requested", {
      runId: activeWithoutApiWorkerRunId,
      pid: child.pid,
      reason
    });
  }

  async function stopWithoutApiWorkerAndWait(reason: string, timeoutMs = 5_000): Promise<void> {
    const child = activeWithoutApiWorker;
    if (!child || child.exitCode !== null) {
      return;
    }
    stopWithoutApiWorker(reason);
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  function startCrawlerLoop(run: RunRecord): void {
    if (activeCrawlerRunId === run.id) {
      return;
    }

    if (!getXApiConfig().xApiEnabled) {
      runs.updateStats(run.id, { currentKeyword: null });
      runs.stop(run.id);
      void recordSession("prob", "x.search.disabled", "X API search is disabled; run stopped", { runId: run.id });
      return;
    }

    if (!options.config.x.bearerToken) {
      void recordSession("prob", "x.search.disabled", "X_BEARER_TOKEN missing; run state started without crawler");
      return;
    }

    activeCrawlerRunId = run.id;
    void runSearchLoop(run.id).finally(() => {
      if (activeCrawlerRunId === run.id) {
        activeCrawlerRunId = null;
      }
    });
  }

  async function runSearchLoop(runId: string): Promise<void> {
    const xClient = new XApiClient({ bearerToken: options.config.x.bearerToken });
    const crawler = new Crawler(
      lists,
      xClient,
      () => settings.getScoringConfig(),
      (result) => timelineTweets.saveAccepted(result.keyword, result.tweet, result.decision)
    );
    const keywords = plannedKeywords(lists);
    let completedKeywords = 0;
    await recordSession("info", "search.plan", "Search plan prepared", { runId, totalKeywords: keywords.length });

    while (completedKeywords < keywords.length) {
      const run = await waitUntilRunnable(runId);
      if (!run) {
        await recordSession("info", "search.stopped", "Search loop stopped", { runId });
        return;
      }

      const xApiConfig = getXApiConfig();
      if (!xApiConfig.xApiEnabled) {
        runs.updateStats(runId, { currentKeyword: null });
        runs.stop(runId);
        await recordSession("prob", "x.search.disabled", "X API search was disabled; run stopped", { runId });
        return;
      }

      const keywordGroup = nextKeywordGroup(keywords, completedKeywords, xApiConfig.xKeywordsPerQuery);
      const query = buildXSearchQuery(keywordGroup);
      const preparedRun = applyRuntimeApiStats(run, xApiConfig);
      const beforeStats = parseRunStats(preparedRun.statsJson);
      if (beforeStats.apiCallsRemaining <= 0) {
        const nextApiResetAt = await pauseForApiWindow(runId, "Search paused because API call budget is empty", {
          apiCallsUsed: beforeStats.apiCallsUsed,
          apiCallLimit: beforeStats.apiCallLimit
        });
        await runRssFallback(runId);
        scheduleApiWindowResumeIfPaused(runId, nextApiResetAt);
        return;
      }

      runs.updateStats(runId, {
        currentKeyword: query,
        completedKeywords,
        remainingKeywords: keywords.length - completedKeywords
      });
      await recordSession("info", "search.keyword.started", "Searching keyword", {
        runId,
        keyword: query,
        keywordGroup,
        position: completedKeywords + 1,
        totalKeywords: keywords.length,
        apiCallsRemaining: beforeStats.apiCallsRemaining
      });

      try {
        const config = settings.getScoringConfig();
        if (getXApiConfig().xCountFirstMode) {
          xBudget.assertCanSpend({ countCalls: 1 }, runId);
          const count = await crawler.countRecent(query);
          xBudget.record({ countCalls: 1 }, runId);
          await recordSession("info", "search.count.completed", "Count-first completed", {
            runId,
            query,
            keywordGroup,
            count
          });
          if (config.enableMinimumSearchResults && count <= config.minimumSearchResults) {
            for (const keyword of keywordGroup) {
              await saveNoResultKeyword(keyword, count, config.minimumSearchResults);
            }
            completedKeywords += keywordGroup.length;
            runs.updateStats(runId, {
              completedKeywords,
              remainingKeywords: Math.max(0, keywords.length - completedKeywords),
              currentKeyword: null
            });
            await recordSession("info", "search.count.no_result", "Count-first skipped X post reads", {
              runId,
              query,
              keywordGroup,
              count,
              minimumSearchResults: config.minimumSearchResults
            });
            continue;
          }
        }

        xBudget.assertCanSpend({ searchCalls: 1, postReads: 10 }, runId);
        const tweets = await crawler.searchKeyword(query, 10, "minimal");
        xBudget.record({ searchCalls: 1, postReads: tweets.length }, runId);
        const currentAfterSearch = runs.get(runId);
        if (!currentAfterSearch || currentAfterSearch.status === "stopped" || currentAfterSearch.status === "completed") {
          if (currentAfterSearch) {
            runs.updateStats(runId, { currentKeyword: null });
          }
          await recordSession("info", "search.stopped", "Search loop stopped after current request returned", { runId });
          return;
        }
        saveSearchTermsUsed(keywordGroup);
        const isNoResultSearch = config.enableMinimumSearchResults && tweets.length <= config.minimumSearchResults;
        if (isNoResultSearch) {
          for (const keyword of keywordGroup) {
            await saveNoResultKeyword(keyword, tweets.length, config.minimumSearchResults);
          }
        }
        const selectedTweets = isNoResultSearch ? [] : crawler.selectTweetsForHydration(query, tweets);
        const prefilerRejectedTweets = isNoResultSearch ? 0 : tweets.length - selectedTweets.length;
        if (prefilerRejectedTweets > 0) {
          await recordPrefilterRejectedTweets(runId, query, tweets, selectedTweets);
        }
        const hydratedTweets = await hydrateSelectedTweets(runId, crawler, selectedTweets);
        const results = isNoResultSearch ? [] : crawler.scoreTweets(query, hydratedTweets);
        await recordTweetResults(runId, query, results);
        const accepted = results.filter((result) => result.decision.accepted).length;
        const rejected = results.length - accepted + prefilerRejectedTweets;
        const afterStats = parseRunStats(runs.get(runId)?.statsJson ?? "{}");
        const apiCallsUsed = afterStats.apiCallsUsed + 1;
        const apiCallsRemaining = Math.max(0, afterStats.apiCallLimit - apiCallsUsed);
        completedKeywords += keywordGroup.length;
        runs.updateStats(runId, {
          completedKeywords,
          remainingKeywords: Math.max(0, keywords.length - completedKeywords),
          apiCallsUsed,
          apiCallsRemaining,
          acceptedTweets: afterStats.acceptedTweets + accepted,
          rejectedTweets: afterStats.rejectedTweets + rejected,
          lastScore: results.at(-1)?.decision.score ?? afterStats.lastScore,
          lastTweetId: results.at(-1)?.tweet.id ?? afterStats.lastTweetId
        });
        await recordSession("info", "search.keyword.completed", "Keyword search completed", {
          runId,
          keyword: query,
          keywordGroup,
          tweetsReceived: tweets.length,
          tweetsPrefilterRejected: prefilerRejectedTweets,
          tweetsHydrated: hydratedTweets.length,
          acceptedTweets: accepted,
          rejectedTweets: rejected,
          noResultSaved: isNoResultSearch,
          apiCallsRemaining
        });

        if (apiCallsRemaining <= 0) {
          const nextApiResetAt = await pauseForApiWindow(runId, "Search paused until the next API window", {
            apiCallsRemaining
          });
          await runRssFallback(runId);
          scheduleApiWindowResumeIfPaused(runId, nextApiResetAt);
          return;
        }
      } catch (error) {
        runs.updateStats(runId, { currentKeyword: null });
        if (error instanceof XBudgetExceededError) {
          runs.pause(runId);
          await recordSession("prob", "x.budget.reached", error.message, {
            runId,
            query,
            budget: xBudget.snapshot(undefined, runId)
          });
          await runRssFallback(runId);
          return;
        }
        await recordSession("prob", "search.keyword.failed", error instanceof Error ? error.message : "Search failed", {
          runId,
          keyword: query
        });
        return;
      }

      const latestAfterDelay = await waitUntilRunnable(runId);
      if (!latestAfterDelay) {
        await recordSession("info", "search.stopped", "Search loop stopped", { runId });
        return;
      }
      await delay(1_000);
    }

    const latest = runs.get(runId);
    if (latest?.status === "running") {
      const stats = parseRunStats(latest.statsJson);
      runs.updateStats(runId, { currentKeyword: null, remainingKeywords: 0 });
      runs.complete(runId);
      await recordSession("info", "run.completed", "Search run completed", {
        runId,
        totalKeywords: stats.totalKeywords,
        acceptedTweets: stats.acceptedTweets,
        rejectedTweets: stats.rejectedTweets
      });
    }
  }

  async function waitUntilRunnable(runId: string): Promise<RunRecord | null> {
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

  async function hydrateSelectedTweets(
    runId: string,
    crawler: Crawler,
    tweets: Array<{ id: string }>
  ): Promise<TweetCandidate[]> {
    if (!tweets.length) {
      return [];
    }
    const tweetIds = tweets.map((tweet) => tweet.id);
    xBudget.assertCanSpend(
      {
        postReads: tweetIds.length,
        userReads: tweetIds.length,
        mediaReads: tweetIds.length
      },
      runId
    );
    const hydratedTweets = await crawler.hydrateTweets(tweetIds);
    xBudget.record(
      {
        postReads: hydratedTweets.length,
        userReads: hydratedTweets.length,
        mediaReads: hydratedTweets.reduce((sum, tweet) => sum + (tweet.entities?.media?.length ?? 0), 0)
      },
      runId
    );
    return hydratedTweets;
  }

  async function runRssFallback(runId: string): Promise<void> {
    const feeds = lists.activeValues("rss_feed").slice(0, options.config.rssFallbackFeedLimit);
    if (!feeds.length) {
      await recordSession("prob", "rss.fallback.empty", "No RSS feeds available while X search is paused", { runId });
      return;
    }

    const rssClient = new RssClient();
    let savedItems = 0;
    await recordSession("info", "rss.fallback.started", "RSS fallback started while X search is paused", {
      runId,
      feeds: feeds.length,
      configuredLimit: options.config.rssFallbackFeedLimit
    });

    for (const feed of feeds) {
      try {
        const items = await rssClient.fetch(feed);
        const importedAt = new Date().toISOString();
        for (const item of items) {
          lists.add("rss_sent", item.link, `runtime:rss:${feed}`, null, importedAt);
          lists.add("text_sent", `${item.title} ${item.link}`.trim(), `runtime:rss:${feed}`, null, importedAt);
          savedItems += 1;
        }
        await recordSession("debug", "rss.feed.completed", "RSS feed fetched", {
          runId,
          feed,
          items: items.length
        });
      } catch (error) {
        await recordSession("prob", "rss.feed.failed", error instanceof Error ? error.message : "RSS fetch failed", {
          runId,
          feed
        });
      }
    }

    await recordSession("info", "rss.fallback.completed", "RSS fallback completed", {
      runId,
      feeds: feeds.length,
      savedItems
    });
  }

  async function pauseForApiWindow(
    runId: string,
    message: string,
    data: Record<string, unknown> = {}
  ): Promise<string | null> {
    const latest = runs.get(runId);
    if (!latest) {
      return null;
    }

    const xApiConfig = getXApiConfig();
    const stats = parseRunStats(latest.statsJson);
    const nextApiResetAt = new Date(Date.now() + xApiConfig.xSearchApiWindowMinutes * 60_000).toISOString();
    runs.pause(runId);
    runs.updateStats(runId, {
      apiCallLimit: xApiConfig.xSearchApiCallLimit,
      apiWindowMinutes: xApiConfig.xSearchApiWindowMinutes,
      currentKeyword: null,
      nextApiResetAt
    });
    await recordSession("prob", "api.limit.reached", message, {
      runId,
      ...data,
      apiWindowMinutes: xApiConfig.xSearchApiWindowMinutes,
      nextApiResetAt
    });
    return nextApiResetAt;
  }

  function scheduleApiWindowResumeIfPaused(runId: string, nextApiResetAt: string | null): void {
    if (!nextApiResetAt || runs.get(runId)?.status !== "paused") {
      return;
    }
    scheduleApiWindowResume(runId, nextApiResetAt);
  }

  function scheduleApiWindowResume(runId: string, nextApiResetAt: string): void {
    clearApiResumeTimer(runId);
    const delayMs = Math.max(0, Date.parse(nextApiResetAt) - Date.now());
    const timeout = setTimeout(() => {
      apiResumeTimers.delete(runId);
      void resumeAfterApiWindow(runId);
    }, delayMs);
    timeout.unref?.();
    apiResumeTimers.set(runId, timeout);
    void recordSession("info", "api.resume.scheduled", "Search resume scheduled after API pause", {
      runId,
      nextApiResetAt,
      delayMs
    });
  }

  async function resumeAfterApiWindow(runId: string): Promise<void> {
    const run = runs.get(runId);
    if (!run || run.status !== "paused") {
      return;
    }

    const resetRun = resetApiWindowIfDue(run);
    if (resetRun.status !== "paused") {
      return;
    }

    const resumed = runs.resume(resetRun.id);
    await recordSession("info", "api.resume.started", "Search resumed after API pause", {
      runId: resumed.id,
      status: resumed.status
    });
    startCrawlerLoop(resumed);
  }

  function clearApiResumeTimer(runId: string): void {
    const timer = apiResumeTimers.get(runId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    apiResumeTimers.delete(runId);
  }

  function resetApiWindowIfDue(runOrId: RunRecord | string): RunRecord {
    const run = typeof runOrId === "string" ? runs.get(runOrId) : runOrId;
    if (!run) {
      throw new Error(`Run not found: ${runOrId}`);
    }

    const stats = parseRunStats(run.statsJson);
    const resetAt = stats.nextApiResetAt ? Date.parse(stats.nextApiResetAt) : Number.NaN;
    const resetIsDue = Number.isNaN(resetAt) || resetAt <= Date.now();
    if (stats.apiCallsRemaining > 0 || !resetIsDue) {
      return run;
    }

    const xApiConfig = getXApiConfig();
    return runs.updateStats(run.id, {
      apiCallsUsed: 0,
      apiCallLimit: xApiConfig.xSearchApiCallLimit,
      apiWindowMinutes: xApiConfig.xSearchApiWindowMinutes,
      currentKeyword: null,
      nextApiResetAt: new Date(Date.now() + xApiConfig.xSearchApiWindowMinutes * 60_000).toISOString()
    });
  }

  async function recordTweetResults(runId: string, keyword: string, results: Awaited<ReturnType<Crawler["crawlKeyword"]>>) {
    for (const result of results) {
      await recordSession("debug", "tweet.received", "Tweet received", {
        runId,
        keyword,
        tweetId: result.tweet.id,
        author: `@${result.tweet.user.screenName}`,
        createdAt: result.tweet.createdAt?.toISOString() ?? null,
        accepted: result.decision.accepted,
        score: result.decision.score,
        reasons: result.decision.reasons,
        favoriteCount: result.tweet.favoriteCount ?? 0,
        retweetCount: result.tweet.retweetCount ?? 0,
        lang: result.tweet.lang ?? null,
        mediaCount: result.tweet.entities?.media?.length ?? 0,
        urlCount: result.tweet.entities?.urls?.length ?? 0,
        text: result.tweet.text
      });
    }
  }

  async function recordPrefilterRejectedTweets(
    runId: string,
    keyword: string,
    tweets: TweetCandidate[],
    selectedTweets: Array<{ id: string }>
  ): Promise<void> {
    const selectedTweetIds = new Set(selectedTweets.map((tweet) => tweet.id));
    for (const tweet of tweets) {
      if (selectedTweetIds.has(tweet.id)) {
        continue;
      }
      await recordSession("debug", "tweet.prefilter_rejected", "Tweet rejected before hydration", {
        runId,
        keyword,
        tweetId: tweet.id,
        author: `@${tweet.user.screenName}`,
        createdAt: tweet.createdAt?.toISOString() ?? null,
        accepted: false,
        score: null,
        reasons: ["prefilter_rejected"],
        favoriteCount: tweet.favoriteCount ?? 0,
        retweetCount: tweet.retweetCount ?? 0,
        lang: tweet.lang ?? null,
        mediaCount: tweet.entities?.media?.length ?? 0,
        urlCount: tweet.entities?.urls?.length ?? 0,
        text: tweet.text
      });
    }
  }

  async function saveNoResultKeyword(keyword: string, tweetsReceived: number, minimumSearchResults: number): Promise<void> {
    const entry = lists.add("no_result", keyword, "runtime:x-search:no-result", null, new Date().toISOString());
    await recordSession("info", "search.no_result.saved", "Keyword saved to No.Result", {
      keyword,
      entryId: entry.id,
      tweetsReceived,
      minimumSearchResults
    });
  }

  function saveSearchTermsUsed(keywords: string[]): void {
    const importedAt = new Date().toISOString();
    for (const keyword of keywords) {
      lists.add("search_terms_used", keyword, "runtime:x-search:search-terms-used", null, importedAt);
    }
  }

  return app;
}

function shouldLogRequest(url: string): boolean {
  const pathname = safePath(url);
  return pathname.startsWith("/admin");
}

function safePath(url: string): string {
  return new URL(url, "http://redqueenx.local").pathname;
}

async function browseFilesystem(inputPath: string | undefined, mode: "file" | "directory", extensions: Set<string> | null) {
  const cwd = await resolveBrowseDirectory(inputPath);
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  const detailedEntries = (
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(cwd, entry.name);
        try {
          const stat = await fs.stat(entryPath);
          const type = stat.isDirectory() ? "directory" : "file";
          if (type === "file" && extensions && !extensions.has(path.extname(entry.name).toLowerCase())) {
            return null;
          }
          return {
            name: entry.name,
            path: entryPath,
            type,
            selectable: mode === "directory" ? type === "directory" : type === "file",
            size: stat.isDirectory() ? null : stat.size,
            modifiedAt: stat.mtime.toISOString()
          };
        } catch {
          return null;
        }
      })
    )
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  detailedEntries.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  const root = path.parse(cwd).root;
  return {
    mode,
    cwd,
    parent: cwd === root ? null : path.dirname(cwd),
    canSelectCurrent: mode === "directory",
    extensions: extensions ? Array.from(extensions) : [],
    roots: [
      { label: "Project", path: process.cwd() },
      { label: "Home", path: os.homedir() },
      { label: "Root", path: root }
    ],
    entries: detailedEntries
  };
}

function parseExtensionFilter(input: string | undefined) {
  if (!input?.trim()) {
    return null;
  }

  const extensions = input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.startsWith(".") ? value : `.${value}`));

  return extensions.length ? new Set(extensions) : null;
}

async function copyFileIntoProjectDirectory(sourceInput: string, targetDirInput: string) {
  const sourcePath = resolveUserPath(sourceInput);
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error("Selected path is not a file.");
  }

  const targetDir = resolveProjectDirectory(targetDirInput);
  await fs.mkdir(targetDir, { recursive: true });

  const filename = path.basename(sourcePath);
  if (!filename || filename === "." || filename === "..") {
    throw new Error("Selected file has an invalid name.");
  }

  let destinationPath = path.join(targetDir, filename);
  const alreadyInTarget = path.resolve(sourcePath) === path.resolve(destinationPath);
  if (alreadyInTarget) {
    const openVpn = await normalizeOpenVpnProfileIfNeeded(destinationPath, targetDir, sourcePath);
    return copiedFileResult(destinationPath, false, true, openVpn);
  }

  if (fsSync.existsSync(destinationPath)) {
    if (await filesHaveSameContent(sourcePath, destinationPath)) {
      const openVpn = await normalizeOpenVpnProfileIfNeeded(destinationPath, targetDir, sourcePath);
      return copiedFileResult(destinationPath, false, false, openVpn);
    }
    destinationPath = uniqueDestinationPath(destinationPath);
  }

  await fs.copyFile(sourcePath, destinationPath);
  const openVpn = await normalizeOpenVpnProfileIfNeeded(destinationPath, targetDir, sourcePath);
  return copiedFileResult(destinationPath, true, false, openVpn);
}

function copiedFileResult(
  filePath: string,
  copied: boolean,
  alreadyInTarget: boolean,
  openVpn: OpenVpnProfileNormalization | null = null
) {
  const relative = path.relative(process.cwd(), filePath).split(path.sep).join("/");
  return {
    copied,
    alreadyInTarget,
    path: filePath,
    relativePath: relative.startsWith("..") ? filePath : `./${relative}`,
    openVpn
  };
}

interface OpenVpnProfileNormalization {
  isOpenVpnProfile: boolean;
  sanitized: boolean;
  authFilePath: string | null;
  authFileExists: boolean;
  authCopied: boolean;
  remoteHost: string | null;
  remotePort: string | null;
  remoteProto: "udp" | "tcp" | null;
  disabledLines: string[];
  warnings: string[];
}

interface OpenVpnProfileSummary {
  filename: string;
  path: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  authFilePath: string | null;
  authFileExists: boolean;
  remoteHost: string | null;
  remotePort: string | null;
  remoteProto: "udp" | "tcp" | null;
  activeRemoteCount: number;
  disabledLines: string[];
  warnings: string[];
}

async function listOpenVpnProfiles() {
  const profileDir = path.resolve(process.cwd(), "ops/vpn");
  await fs.mkdir(profileDir, { recursive: true });
  const entries = await fs.readdir(profileDir, { withFileTypes: true });
  const profiles: OpenVpnProfileSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isOpenVpnProfilePath(entry.name)) {
      continue;
    }
    const filePath = path.join(profileDir, entry.name);
    profiles.push(await readOpenVpnProfileSummary(filePath));
  }

  profiles.sort((left, right) => left.filename.localeCompare(right.filename, undefined, { sensitivity: "base" }));
  return {
    directory: projectRelativePath(profileDir),
    profiles
  };
}

async function readOpenVpnProfileSummary(filePath: string): Promise<OpenVpnProfileSummary> {
  const [content, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
  const parsed = readOpenVpnProfileMetadata(content, filePath);
  const authFileExists = parsed.authFilePath ? fsSync.existsSync(parsed.authFilePath) : false;

  return {
    filename: path.basename(filePath),
    path: filePath,
    relativePath: projectRelativePath(filePath),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    authFilePath: parsed.authFilePath ? projectRelativePath(parsed.authFilePath) : null,
    authFileExists,
    remoteHost: parsed.remoteHost,
    remotePort: parsed.remotePort,
    remoteProto: parsed.remoteProto,
    activeRemoteCount: parsed.activeRemoteCount,
    disabledLines: parsed.disabledLines,
    warnings: parsed.warnings
  };
}

async function writeOpenVpnAuthFile(profileInput: string, username: string, password: string) {
  const profilePath = await resolveOpenVpnProfileInVpnDirectory(profileInput);
  const authFilePath = openVpnAuthPathForProfile(profilePath);
  const created = !fsSync.existsSync(authFilePath);

  await ensureOpenVpnProfileUsesAuthFile(profilePath, authFilePath);
  await fs.writeFile(authFilePath, `${username}\n${password}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(authFilePath, 0o600);

  return {
    ok: true,
    created,
    profilePath: projectRelativePath(profilePath),
    authFilePath: projectRelativePath(authFilePath),
    authFileExists: true,
    profile: await readOpenVpnProfileSummary(profilePath)
  };
}

async function resolveOpenVpnProfileInVpnDirectory(profileInput: string) {
  const profilePath = resolveUserPath(profileInput);
  const profileDir = path.resolve(process.cwd(), "ops/vpn");
  const relative = path.relative(profileDir, profilePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("OpenVPN profile must stay inside ./ops/vpn.");
  }
  if (!isOpenVpnProfilePath(profilePath)) {
    throw new Error("OpenVPN profile must be a .ovpn or .conf file.");
  }

  const stat = await fs.stat(profilePath);
  if (!stat.isFile()) {
    throw new Error("OpenVPN profile path is not a file.");
  }
  return profilePath;
}

async function ensureOpenVpnProfileUsesAuthFile(profilePath: string, authFilePath: string) {
  const original = await fs.readFile(profilePath, "utf8");
  const normalized = normalizeOpenVpnProfileContent(original, authFilePath);
  let nextContent = normalized.content;

  if (!hasActiveOpenVpnDirective(nextContent, "auth-user-pass")) {
    const newline = nextContent.includes("\r\n") ? "\r\n" : "\n";
    const suffix = nextContent.endsWith("\n") || nextContent.endsWith("\r\n") ? "" : newline;
    nextContent = `${nextContent}${suffix}auth-user-pass ${projectRelativePath(authFilePath)}${newline}`;
  }

  if (nextContent !== original) {
    await fs.writeFile(profilePath, nextContent, "utf8");
  }
}

function hasActiveOpenVpnDirective(content: string, name: string) {
  return content.split(/\r?\n/).some((line) => {
    if (line.trim() === "" || isCommentLine(line)) {
      return false;
    }
    return readOpenVpnDirective(line)?.name === name;
  });
}

function readOpenVpnProfileMetadata(content: string, profilePath: string) {
  const lines = content.split(/\r?\n/);
  const disabledLines: string[] = [];
  const warnings: string[] = [];
  let remoteHost: string | null = null;
  let remotePort: string | null = null;
  let remoteProto: "udp" | "tcp" | null = null;
  let activeRemoteCount = 0;
  let authFilePath: string | null = null;
  let activeAuthSeen = false;

  for (const line of lines) {
    if (line.includes("RedqueenX disabled")) {
      disabledLines.push(line.trim());
    }
    if (line.trim() === "" || isCommentLine(line)) {
      continue;
    }

    const directive = readOpenVpnDirective(line);
    if (!directive) {
      continue;
    }

    if (directive.name === "proto") {
      remoteProto = normalizeOpenVpnProto(directive.args[0]) ?? remoteProto;
      continue;
    }

    if (directive.name === "remote") {
      activeRemoteCount += 1;
      if (!remoteHost && directive.args[0]) {
        remoteHost = directive.args[0];
        remotePort = directive.args[1] ?? null;
        remoteProto = normalizeOpenVpnProto(directive.args[2]) ?? remoteProto;
      }
      continue;
    }

    if (directive.name === "auth-user-pass") {
      activeAuthSeen = true;
      authFilePath = resolveOpenVpnAuthDirectivePath(profilePath, directive.args[0]);
    }
  }

  if (!authFilePath) {
    authFilePath = openVpnAuthPathForProfile(profilePath);
  }
  if (!remoteHost) {
    warnings.push("No active remote line found in OpenVPN profile.");
  }
  if (!remotePort) {
    warnings.push("No remote port found in OpenVPN profile.");
  }
  if (!remoteProto) {
    warnings.push("No OpenVPN proto found in profile; keep VPN_REMOTE_PROTO configured manually.");
  }
  if (activeRemoteCount > 1) {
    warnings.push("More than one active remote is present; RedqueenX kill switch should use one explicit endpoint.");
  }
  if (!activeAuthSeen) {
    warnings.push("No auth-user-pass line found; create a matching .auth file only if your provider requires it.");
  }

  return {
    authFilePath,
    remoteHost,
    remotePort,
    remoteProto,
    activeRemoteCount,
    disabledLines,
    warnings
  };
}

async function normalizeOpenVpnProfileIfNeeded(
  filePath: string,
  targetDir: string,
  sourcePath: string
): Promise<OpenVpnProfileNormalization | null> {
  if (!isOpenVpnProfilePath(filePath)) {
    return null;
  }

  const original = await fs.readFile(filePath, "utf8");
  const authFilePath = openVpnAuthPathForProfile(filePath);
  const authCopied = await copyOpenVpnAuthCandidate(sourcePath, authFilePath);
  const normalized = normalizeOpenVpnProfileContent(original, authFilePath);
  if (normalized.content !== original) {
    await fs.writeFile(filePath, normalized.content, "utf8");
  }
  return {
    isOpenVpnProfile: true,
    sanitized: normalized.content !== original,
    authFilePath: normalized.authFilePath,
    authFileExists: fsSync.existsSync(authFilePath),
    authCopied,
    remoteHost: normalized.remoteHost,
    remotePort: normalized.remotePort,
    remoteProto: normalized.remoteProto,
    disabledLines: normalized.disabledLines,
    warnings: normalized.warnings
  };
}

function isOpenVpnProfilePath(filePath: string) {
  return [".ovpn", ".conf"].includes(path.extname(filePath).toLowerCase());
}

function openVpnAuthPathForProfile(profilePath: string) {
  const parsed = path.parse(profilePath);
  return path.join(parsed.dir, `${parsed.name}.auth`);
}

function resolveOpenVpnAuthDirectivePath(profilePath: string, directivePath: string | undefined) {
  if (!directivePath) {
    return openVpnAuthPathForProfile(profilePath);
  }
  if (path.isAbsolute(directivePath)) {
    return directivePath;
  }

  const projectResolved = path.resolve(process.cwd(), directivePath);
  if (directivePath.startsWith(".") || fsSync.existsSync(projectResolved)) {
    return projectResolved;
  }

  return path.resolve(path.dirname(profilePath), directivePath);
}

async function copyOpenVpnAuthCandidate(sourceProfilePath: string, destinationAuthPath: string) {
  const sourceAuthPath = findOpenVpnAuthCandidate(sourceProfilePath);
  if (!sourceAuthPath) {
    return false;
  }
  if (path.resolve(sourceAuthPath) === path.resolve(destinationAuthPath)) {
    return false;
  }
  if (fsSync.existsSync(destinationAuthPath)) {
    return false;
  }
  await fs.copyFile(sourceAuthPath, destinationAuthPath);
  await fs.chmod(destinationAuthPath, 0o600);
  return true;
}

function findOpenVpnAuthCandidate(sourceProfilePath: string) {
  const parsed = path.parse(sourceProfilePath);
  const candidates = [
    path.join(parsed.dir, `${parsed.name}.auth`),
    path.join(parsed.dir, `${parsed.name}.txt`),
    path.join(parsed.dir, "auth.txt")
  ];
  return candidates.find((candidate) => fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile()) ?? null;
}

function normalizeOpenVpnProfileContent(content: string, authFileAbsolutePath: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  const disabledLines: string[] = [];
  const warnings: string[] = [];
  const authFilePath = projectRelativePath(authFileAbsolutePath);
  let remoteHost: string | null = null;
  let remotePort: string | null = null;
  let remoteProto: "udp" | "tcp" | null = null;
  let activeRemoteSeen = false;
  let activeAuthSeen = false;
  let changed = false;

  for (const line of lines) {
    if (line.trim() === "") {
      output.push(line);
      continue;
    }

    if (isCommentLine(line) || line.includes("RedqueenX disabled")) {
      output.push(line);
      continue;
    }

    const directive = readOpenVpnDirective(line);
    if (!directive) {
      output.push(line);
      continue;
    }

    if (directive.name === "proto") {
      remoteProto = normalizeOpenVpnProto(directive.args[0]) ?? remoteProto;
      output.push(line);
      continue;
    }

    if (directive.name === "remote") {
      if (!remoteHost && directive.args[0]) {
        remoteHost = directive.args[0];
        remotePort = directive.args[1] ?? null;
        remoteProto = normalizeOpenVpnProto(directive.args[2]) ?? remoteProto;
      }

      if (activeRemoteSeen) {
        output.push(disableOpenVpnLine(line, "extra remote endpoint disabled; RedqueenX uses one explicit kill-switch endpoint"));
        disabledLines.push(line.trim());
        changed = true;
        continue;
      }

      activeRemoteSeen = true;
      output.push(line);
      continue;
    }

    if (directive.name === "auth-user-pass") {
      activeAuthSeen = true;
      const normalizedLine = `${leadingWhitespace(line)}auth-user-pass ${authFilePath}`;
      output.push(normalizedLine);
      if (line.trim() !== normalizedLine.trim()) {
        changed = true;
      }
      continue;
    }

    if (unsafeOpenVpnDirectives.has(directive.name) || directive.name === "remote-random") {
      output.push(disableOpenVpnLine(line, unsafeOpenVpnReason(directive.name)));
      disabledLines.push(line.trim());
      changed = true;
      continue;
    }

    output.push(line);
  }

  if (!remoteHost) {
    warnings.push("No active remote line found in OpenVPN profile.");
  }
  if (!remotePort) {
    warnings.push("No remote port found in OpenVPN profile.");
  }
  if (!remoteProto) {
    warnings.push("No OpenVPN proto found in profile; keep VPN_REMOTE_PROTO configured manually.");
  }
  if (!activeAuthSeen) {
    warnings.push(`No auth-user-pass line found; create ${authFilePath} only if your provider requires it.`);
  }

  return {
    content: changed ? output.join(newline) : content,
    authFilePath,
    remoteHost,
    remotePort,
    remoteProto,
    disabledLines,
    warnings
  };
}

const unsafeOpenVpnDirectives = new Set([
  "script-security",
  "up",
  "down",
  "route-up",
  "route-pre-down",
  "ipchange",
  "client-connect",
  "client-disconnect",
  "learn-address",
  "auth-user-pass-verify",
  "tls-verify",
  "down-pre"
]);

function readOpenVpnDirective(line: string) {
  const trimmed = line.trim();
  const [name, ...args] = trimmed.split(/\s+/);
  if (!name) {
    return null;
  }
  return {
    name: name.toLowerCase(),
    args
  };
}

function isCommentLine(line: string) {
  return line.trimStart().startsWith("#") || line.trimStart().startsWith(";");
}

function normalizeOpenVpnProto(value: string | undefined): "udp" | "tcp" | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("udp")) {
    return "udp";
  }
  if (normalized.startsWith("tcp")) {
    return "tcp";
  }
  return null;
}

function disableOpenVpnLine(line: string, reason: string) {
  return `${leadingWhitespace(line)}# RedqueenX disabled: ${line.trim()} # ${reason}`;
}

function unsafeOpenVpnReason(directive: string) {
  if (directive === "remote-random") {
    return "random endpoint selection is incompatible with a fixed namespace kill-switch rule";
  }
  if (directive === "script-security" || directive === "up" || directive === "down" || directive === "down-pre") {
    return "provider scripts can modify host DNS or routes";
  }
  return "provider hook disabled for namespace safety";
}

function leadingWhitespace(line: string) {
  return line.match(/^\s*/)?.[0] ?? "";
}

function projectRelativePath(filePath: string) {
  const relative = path.relative(process.cwd(), filePath).split(path.sep).join("/");
  return relative.startsWith("..") ? filePath : `./${relative}`;
}

function resolveProjectDirectory(inputPath: string) {
  const resolved = resolveUserPath(inputPath);
  const relative = path.relative(process.cwd(), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Target directory must stay inside the RedqueenX project.");
  }
  return resolved;
}

async function filesHaveSameContent(leftPath: string, rightPath: string) {
  const [leftStat, rightStat] = await Promise.all([fs.stat(leftPath), fs.stat(rightPath)]);
  if (leftStat.size !== rightStat.size) {
    return false;
  }
  const [leftHash, rightHash] = await Promise.all([hashFile(leftPath), hashFile(rightPath)]);
  return leftHash === rightHash;
}

async function hashFile(filePath: string) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function uniqueDestinationPath(destinationPath: string) {
  const parsed = path.parse(destinationPath);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Unable to find a free filename in target directory.");
}

async function resolveBrowseDirectory(inputPath: string | undefined) {
  const resolved = resolveUserPath(inputPath);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      return resolved;
    }
    return path.dirname(resolved);
  } catch {
    return findExistingParent(path.dirname(resolved));
  }
}

async function findExistingParent(candidate: string): Promise<string> {
  let current = candidate || process.cwd();
  while (true) {
    try {
      const stat = await fs.stat(current);
      if (stat.isDirectory()) {
        return current;
      }
    } catch {
      // Keep walking toward the filesystem root.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function resolveUserPath(inputPath: string | undefined) {
  const rawPath = inputPath?.trim();
  if (!rawPath) {
    return process.cwd();
  }
  if (rawPath === "~") {
    return os.homedir();
  }
  if (rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return path.resolve(process.cwd(), rawPath);
}

function pinoLevelFromStatus(statusCode: number): number {
  if (statusCode >= 500) {
    return 50;
  }
  if (statusCode >= 400) {
    return 40;
  }
  return 30;
}

function createInitialRunStats(
  lists: ListService,
  config: Pick<XApiRuntimeConfig, "xSearchApiCallLimit" | "xSearchApiWindowMinutes"> &
    Partial<
      Pick<
        XApiRuntimeConfig,
        | "searchWithoutApiEnabled"
        | "searchWithoutApiSessionKeywordLimit"
        | "searchWithoutApiSessionKeywordLimitRandom"
        | "searchWithoutApiRandomizeKeywordOrder"
        | "searchWithoutApiRequestsBeforePauseMin"
        | "searchWithoutApiRequestsBeforePauseMax"
        | "searchWithoutApiPauseMaxMinutes"
      >
    >
): RunStats {
  const apiWindowMinutes = config.searchWithoutApiEnabled
    ? config.searchWithoutApiPauseMaxMinutes ?? 120
    : config.xSearchApiWindowMinutes ?? 15;
  const keywords = plannedKeywords(lists);
  const configuredLimit = config.searchWithoutApiSessionKeywordLimit ?? 0;
  const maxKeywords =
    config.searchWithoutApiEnabled && configuredLimit > 0 ? Math.min(keywords.length, configuredLimit) : keywords.length;
  const totalKeywords =
    config.searchWithoutApiEnabled && config.searchWithoutApiSessionKeywordLimitRandom && maxKeywords > 0
      ? randomInt(1, maxKeywords)
      : maxKeywords;
  const apiCallLimit = config.searchWithoutApiEnabled
    ? searchesBeforePauseForKeywords(totalKeywords)
    : config.xSearchApiCallLimit ?? 180;
  return {
    currentKeyword: null,
    totalKeywords,
    completedKeywords: 0,
    remainingKeywords: totalKeywords,
    availableKeywords: keywords.length,
    sessionKeywordLimit: config.searchWithoutApiEnabled ? configuredLimit : null,
    sessionKeywordLimitRandom: config.searchWithoutApiSessionKeywordLimitRandom ?? false,
    randomizeKeywordOrder: config.searchWithoutApiRandomizeKeywordOrder ?? false,
    apiCallsUsed: 0,
    apiCallLimit,
    apiCallsRemaining: apiCallLimit,
    apiWindowMinutes,
    nextApiResetAt: new Date(Date.now() + apiWindowMinutes * 60_000).toISOString(),
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

function plannedKeywords(lists: ListService): string[] {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue));
  return lists
    .activeValues("keyword")
    .filter((keyword) => {
      const normalized = normalizeValue(keyword);
      return normalized.length > 0 && !noResults.has(normalized) && !alreadyUsed.has(normalized);
    });
}

function keywordAvailability(lists: ListService) {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue).filter(Boolean));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue).filter(Boolean));
  const keywords = lists
    .activeValues("keyword")
    .map((keyword) => normalizeValue(keyword))
    .filter(Boolean);

  let excludedByNoResult = 0;
  let excludedBySearchTermsUsed = 0;
  let availableKeywords = 0;
  for (const keyword of keywords) {
    if (noResults.has(keyword)) {
      excludedByNoResult += 1;
      continue;
    }
    if (alreadyUsed.has(keyword)) {
      excludedBySearchTermsUsed += 1;
      continue;
    }
    availableKeywords += 1;
  }

  return {
    totalKeywords: keywords.length,
    noResultEntries: noResults.size,
    searchTermsUsedEntries: alreadyUsed.size,
    excludedByNoResult,
    excludedBySearchTermsUsed,
    availableKeywords
  };
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(Math.random() * (high - low + 1));
}

function groupKeywordsForXQuery(keywords: string[], groupSize: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const keyword of keywords) {
    const candidate = [...current, keyword];
    if (current.length > 0 && (candidate.length > groupSize || buildXSearchQuery(candidate).length > 480)) {
      groups.push(current);
      current = [keyword];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

function nextKeywordGroup(keywords: string[], startIndex: number, groupSize: number): string[] {
  return groupKeywordsForXQuery(keywords.slice(startIndex), groupSize)[0] ?? [];
}

function buildXSearchQuery(keywords: string[]): string {
  const terms = keywords.map((keyword) => `"${keyword.replace(/["\\]/g, " ").trim()}"`).filter((keyword) => keyword !== '""');
  return terms.length > 0 ? `(${terms.join(" OR ")}) -is:retweet` : "-is:retweet";
}

function xApiEnvValuesToConfig(
  values: Partial<Record<XApiEnvKey, string>>,
  defaults: XApiRuntimeConfig
): Partial<XApiRuntimeConfig> {
  const config: Partial<XApiRuntimeConfig> = {};
  for (const [envKey, configKey] of xApiEnvMap) {
    const value = values[envKey];
    if (value === undefined || value.trim() === "") {
      continue;
    }
    if (
      configKey === "xApiEnabled" ||
      configKey === "searchWithoutApiEnabled" ||
      configKey === "searchWithoutApiHeadless" ||
      configKey === "searchWithoutApiShowBrowserLocal" ||
      configKey === "searchWithoutApiSessionKeywordLimitRandom" ||
      configKey === "searchWithoutApiRandomizeKeywordOrder" ||
      configKey === "searchWithoutApiSaveSnapshots" ||
      configKey === "searchWithoutApiMediaCacheEnabled" ||
      configKey === "xLoginSkipNetworkPrecheck" ||
      configKey === "xCountFirstMode" ||
      configKey === "vpnCheckHostIpv4Leak" ||
      configKey === "vpnCheckIpv6" ||
      configKey === "vpnDiagnosticStrict" ||
      configKey === "vpnDiagnosticPlaywright" ||
      configKey === "playwrightDisableSandbox"
    ) {
      config[configKey] = value === "true";
    } else if (configKey === "searchWithoutApiMouseProfile") {
      config[configKey] = z.enum(["smooth1", "smooth2", "smooth3"]).parse(value);
    } else if (configKey === "vpnRemoteProto") {
      config[configKey] = z.enum(["udp", "tcp"]).parse(value);
    } else if (
      configKey === "searchWithoutApiProfileDir" ||
      configKey === "searchWithoutApiStartUrl" ||
      configKey === "searchWithoutApiMediaCacheDir" ||
      configKey === "vpnNetnsName" ||
      configKey === "vpnHostIface" ||
      configKey === "vpnNetnsCidr" ||
      configKey === "vpnNetnsHostIp" ||
      configKey === "vpnNetnsGuestIp" ||
      configKey === "vpnRemoteHost" ||
      configKey === "vpnConfig" ||
      configKey === "playwrightChromiumExecutablePath"
    ) {
      config[configKey] = value;
    } else {
      config[configKey] = Number(value);
    }
  }
  xApiConfigSchema.parse({ ...defaults, ...config });
  return config;
}

function xApiConfigToEnvValues(config: XApiRuntimeConfig): Record<XApiEnvKey, string> {
  return Object.fromEntries(
    xApiEnvMap.map(([envKey, configKey]) => [envKey, String(config[configKey])])
  ) as Record<XApiEnvKey, string>;
}

export function getMediaCacheConfigFromRuntime(config: XApiRuntimeConfig): MediaCacheConfig {
  return {
    enabled: config.searchWithoutApiMediaCacheEnabled,
    cacheDir: config.searchWithoutApiMediaCacheDir,
    ttlHours: config.searchWithoutApiMediaCacheTtlHours,
    maxBytes: Math.round(config.searchWithoutApiMediaCacheMaxMb * 1024 * 1024),
    maxFileBytes: Math.round(config.searchWithoutApiMediaCacheMaxFileMb * 1024 * 1024)
  };
}

const openVpnConfigKeys: Array<keyof XApiRuntimeConfig> = [
  "vpnNetnsName",
  "vpnHostIface",
  "vpnNetnsCidr",
  "vpnNetnsHostIp",
  "vpnNetnsGuestIp",
  "vpnRemoteHost",
  "vpnRemotePort",
  "vpnRemoteProto",
  "vpnConfig"
];

interface OpenVpnStopResult {
  requested: boolean;
  reason: string;
  pids: number[];
  processGroups: number[];
  stillRunning: number[];
  errors: string[];
}

interface ProcessSummary {
  pid: number;
  processGroup: number;
}

interface NetnsTeardownResult {
  requested: boolean;
  reason: string;
  namespace: string;
  error?: string;
}

function changedOpenVpnConfigKeys(previous: XApiRuntimeConfig, next: XApiRuntimeConfig): string[] {
  return openVpnConfigKeys
    .filter((key) => String(previous[key] ?? "") !== String(next[key] ?? ""))
    .map((key) => xApiEnvMap.find(([, configKey]) => configKey === key)?.[0] ?? String(key));
}

async function requestOpenVpnStopForConfigChange(changedKeys: string[]): Promise<OpenVpnStopResult> {
  if (changedKeys.length === 0) {
    return {
      requested: false,
      reason: "vpn_settings_unchanged",
      pids: [],
      processGroups: [],
      stillRunning: [],
      errors: []
    };
  }

  return requestOpenVpnStop("settings_changed");
}

async function requestOpenVpnStop(reason: string): Promise<OpenVpnStopResult> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return { requested: false, reason: "skipped_in_test", pids: [], processGroups: [], stillRunning: [], errors: [] };
  }

  return requestScriptStop("ops/netns/openvpn.sh", reason);
}

async function requestNetnsCommandStop(): Promise<OpenVpnStopResult> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return { requested: false, reason: "skipped_in_test", pids: [], processGroups: [], stillRunning: [], errors: [] };
  }

  return requestScriptStop("ops/netns/run.sh", "manual_shutdown");
}

async function requestNamespaceTeardownIfPresent(
  namespace: string,
  openVpnStop: OpenVpnStopResult
): Promise<NetnsTeardownResult> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return { requested: false, reason: "skipped_in_test", namespace };
  }

  if (openVpnStop.stillRunning.length > 0) {
    return { requested: false, reason: "openvpn_still_closing", namespace };
  }

  if (!(await isNetworkNamespacePresent(namespace))) {
    return { requested: false, reason: "namespace_not_present", namespace };
  }

  try {
    if (!hasUsableNetnsHelper()) {
      return { requested: false, reason: "helper_missing_or_unprivileged", namespace };
    }

    await execFileAsync(netnsHelperPath, ["teardown"], {
      timeout: 15_000,
      maxBuffer: 1_000_000
    });
    return { requested: true, reason: "teardown_completed", namespace };
  } catch (error) {
    return {
      requested: false,
      reason: "teardown_needs_sudo_or_failed",
      namespace,
      error: firstLine(error instanceof Error ? error.message : String(error))
    };
  }
}

async function requestScriptStop(scriptPath: string, reason: string): Promise<OpenVpnStopResult> {
  const processes = await findScriptProcesses(scriptPath);
  const pids = processes.map((processInfo) => processInfo.pid);
  const processGroups = Array.from(new Set(processes.map((processInfo) => processInfo.processGroup)));
  if (processes.length === 0) {
    return {
      requested: false,
      reason: scriptPath.includes("openvpn.sh") ? "no_running_openvpn_script" : "no_running_namespace_command",
      pids: [],
      processGroups: [],
      stillRunning: [],
      errors: []
    };
  }

  const errors: string[] = [];
  let signaled = 0;
  for (const processGroup of processGroups) {
    try {
      process.kill(-processGroup, "SIGINT");
      signaled += 1;
    } catch (error) {
      errors.push(`process group ${processGroup}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (signaled === 0) {
    return { requested: false, reason: "signal_failed", pids, processGroups, stillRunning: pids, errors };
  }

  const stillRunning = await waitForProcessesToExit(pids, 6_000);
  return {
    requested: true,
    reason: stillRunning.length > 0 ? `${reason}_stop_requested_still_closing` : `${reason}_stopped_gracefully`,
    pids,
    processGroups,
    stillRunning,
    errors
  };
}

async function findScriptProcesses(scriptPath: string): Promise<ProcessSummary[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,pgid=,args="], {
      timeout: 2_000,
      maxBuffer: 1_000_000
    });
    const processes = stdout
      .split(/\r?\n/)
      .map((line) => {
        const match = line.trimStart().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) return null;
        const pid = Number(match[1]);
        const processGroup = Number(match[2]);
        const args = match[3];
        if (!Number.isInteger(pid) || !Number.isInteger(processGroup) || pid === process.pid) return null;
        if (!args.includes(scriptPath)) return null;
        return { pid, processGroup };
      })
      .filter((processInfo): processInfo is ProcessSummary => processInfo !== null);
    const seen = new Set<number>();
    return processes.filter((processInfo) => {
      if (seen.has(processInfo.pid)) return false;
      seen.add(processInfo.pid);
      return true;
    });
  } catch {
    return [];
  }
}

async function isNetworkNamespacePresent(namespace: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ip", ["netns", "list"], {
      timeout: 2_000,
      maxBuffer: 100_000
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .includes(namespace);
  } catch {
    return false;
  }
}

async function waitForProcessesToExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let stillRunning = pids.filter(isProcessRunning);
  while (stillRunning.length > 0 && Date.now() < deadline) {
    await delay(250);
    stillRunning = pids.filter(isProcessRunning);
  }
  return stillRunning;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean) ?? value;
}

function lastOutputLines(value: string, limit: number): string {
  return value
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .join("\n");
}

const adminTestSpecs: Record<
  z.infer<typeof adminTestRunSchema>["test"],
  { label: string; script: string; description: string; timeoutMs: number; vpnAutostart?: boolean }
> = {
  "visible-x-login-vpn": {
    label: "Visible X login VPN preflight",
    script: "test:visible-x-login-vpn",
    description:
      "Starts or reuses the VPN namespace, runs the mandatory IP leak diagnostics, and verifies the Playwright browser sees the VPN IP. It does not open X or save a login session.",
    timeoutMs: 180_000,
    vpnAutostart: true
  },
  "media-cache": {
    label: "Media cache test",
    script: "test:media-cache",
    description: "Runs the media cache unit test: local cache records, TTL cleanup, and timeline media decoration.",
    timeoutMs: 120_000
  },
  typecheck: {
    label: "Typecheck",
    script: "typecheck",
    description: "Runs TypeScript with no emit to catch type and compile-time errors.",
    timeoutMs: 120_000
  },
  unit: {
    label: "All unit tests",
    script: "test",
    description: "Runs the full Vitest suite.",
    timeoutMs: 180_000
  },
  build: {
    label: "Build",
    script: "build",
    description: "Compiles the project with the production TypeScript build.",
    timeoutMs: 120_000
  },
  "without-api-smoke": {
    label: "Without-API smoke",
    script: "netns:worker:smoke",
    description:
      "Runs the without-API Playwright smoke search through the VPN namespace. It stores smoke output but does not update SearchTerms.Used or No.Result.",
    timeoutMs: 600_000,
    vpnAutostart: true
  }
};

type XApiEnvKey =
  | "X_API_ENABLED"
  | "SEARCH_WITHOUT_API_ENABLED"
  | "SEARCH_WITHOUT_API_PROFILE_DIR"
  | "SEARCH_WITHOUT_API_START_URL"
  | "SEARCH_WITHOUT_API_MAX_SCROLLS"
  | "SEARCH_WITHOUT_API_SCROLL_DELAY_MS"
  | "SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS"
  | "SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS"
  | "SEARCH_WITHOUT_API_HEADLESS"
  | "SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL"
  | "SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS"
  | "SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS"
  | "SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS"
  | "SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS"
  | "SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT"
  | "SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM"
  | "SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER"
  | "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN"
  | "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MAX"
  | "SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES"
  | "SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES"
  | "SEARCH_WITHOUT_API_SCROLLS_MIN"
  | "SEARCH_WITHOUT_API_SCROLLS_MAX"
  | "SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS"
  | "SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS"
  | "SEARCH_WITHOUT_API_MOUSE_PROFILE"
  | "SEARCH_WITHOUT_API_SAVE_SNAPSHOTS"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_DIR"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS"
  | "SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS"
  | "X_LOGIN_SKIP_NETWORK_PRECHECK"
  | "VPN_NETNS_NAME"
  | "VPN_HOST_IFACE"
  | "VPN_NETNS_CIDR"
  | "VPN_NETNS_HOST_IP"
  | "VPN_NETNS_GUEST_IP"
  | "VPN_REMOTE_HOST"
  | "VPN_REMOTE_PORT"
  | "VPN_REMOTE_PROTO"
  | "VPN_CONFIG"
  | "VPN_CHECK_HOST_IPV4_LEAK"
  | "VPN_CHECK_IPV6"
  | "VPN_DIAGNOSTIC_STRICT"
  | "VPN_DIAGNOSTIC_PLAYWRIGHT"
  | "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"
  | "PLAYWRIGHT_DISABLE_SANDBOX"
  | "X_SEARCH_API_CALL_LIMIT"
  | "X_SEARCH_API_WINDOW_MINUTES"
  | "X_API_CREDIT_USD"
  | "X_API_TOTAL_CREDIT_USED_USD"
  | "X_DAILY_SPEND_LIMIT_USD"
  | "X_RUN_SPEND_LIMIT_USD"
  | "X_MAX_SEARCHES_PER_DAY"
  | "X_MAX_POSTS_READ_PER_DAY"
  | "X_MAX_COUNT_CALLS_PER_DAY"
  | "X_KEYWORDS_PER_QUERY"
  | "X_COUNT_FIRST_MODE"
  | "X_COST_POST_READ_USD"
  | "X_COST_USER_READ_USD"
  | "X_COST_MEDIA_READ_USD"
  | "X_COST_USER_INTERACTION_USD"
  | "X_COST_COUNT_CALL_USD";

const xApiEnvMap: Array<[XApiEnvKey, keyof XApiRuntimeConfig]> = [
  ["X_API_ENABLED", "xApiEnabled"],
  ["SEARCH_WITHOUT_API_ENABLED", "searchWithoutApiEnabled"],
  ["SEARCH_WITHOUT_API_PROFILE_DIR", "searchWithoutApiProfileDir"],
  ["SEARCH_WITHOUT_API_START_URL", "searchWithoutApiStartUrl"],
  ["SEARCH_WITHOUT_API_MAX_SCROLLS", "searchWithoutApiMaxScrolls"],
  ["SEARCH_WITHOUT_API_SCROLL_DELAY_MS", "searchWithoutApiScrollDelayMs"],
  ["SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS", "searchWithoutApiScrollDelayMinMs"],
  ["SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS", "searchWithoutApiScrollDelayMaxMs"],
  ["SEARCH_WITHOUT_API_HEADLESS", "searchWithoutApiHeadless"],
  ["SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL", "searchWithoutApiShowBrowserLocal"],
  ["SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS", "searchWithoutApiKeyDelayMinMs"],
  ["SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS", "searchWithoutApiKeyDelayMaxMs"],
  ["SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS", "searchWithoutApiSearchDelayMinSeconds"],
  ["SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS", "searchWithoutApiSearchDelayMaxSeconds"],
  ["SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT", "searchWithoutApiSessionKeywordLimit"],
  ["SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM", "searchWithoutApiSessionKeywordLimitRandom"],
  ["SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER", "searchWithoutApiRandomizeKeywordOrder"],
  ["SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN", "searchWithoutApiRequestsBeforePauseMin"],
  ["SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MAX", "searchWithoutApiRequestsBeforePauseMax"],
  ["SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES", "searchWithoutApiPauseMinMinutes"],
  ["SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES", "searchWithoutApiPauseMaxMinutes"],
  ["SEARCH_WITHOUT_API_SCROLLS_MIN", "searchWithoutApiScrollsMin"],
  ["SEARCH_WITHOUT_API_SCROLLS_MAX", "searchWithoutApiScrollsMax"],
  ["SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS", "searchWithoutApiTweetHoverMinSeconds"],
  ["SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS", "searchWithoutApiTweetHoverMaxSeconds"],
  ["SEARCH_WITHOUT_API_MOUSE_PROFILE", "searchWithoutApiMouseProfile"],
  ["SEARCH_WITHOUT_API_SAVE_SNAPSHOTS", "searchWithoutApiSaveSnapshots"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED", "searchWithoutApiMediaCacheEnabled"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_DIR", "searchWithoutApiMediaCacheDir"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS", "searchWithoutApiMediaCacheTtlHours"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB", "searchWithoutApiMediaCacheMaxMb"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB", "searchWithoutApiMediaCacheMaxFileMb"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS", "searchWithoutApiMediaCacheFetchDelayMinMs"],
  ["SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS", "searchWithoutApiMediaCacheFetchDelayMaxMs"],
  ["X_LOGIN_SKIP_NETWORK_PRECHECK", "xLoginSkipNetworkPrecheck"],
  ["VPN_NETNS_NAME", "vpnNetnsName"],
  ["VPN_HOST_IFACE", "vpnHostIface"],
  ["VPN_NETNS_CIDR", "vpnNetnsCidr"],
  ["VPN_NETNS_HOST_IP", "vpnNetnsHostIp"],
  ["VPN_NETNS_GUEST_IP", "vpnNetnsGuestIp"],
  ["VPN_REMOTE_HOST", "vpnRemoteHost"],
  ["VPN_REMOTE_PORT", "vpnRemotePort"],
  ["VPN_REMOTE_PROTO", "vpnRemoteProto"],
  ["VPN_CONFIG", "vpnConfig"],
  ["VPN_CHECK_HOST_IPV4_LEAK", "vpnCheckHostIpv4Leak"],
  ["VPN_CHECK_IPV6", "vpnCheckIpv6"],
  ["VPN_DIAGNOSTIC_STRICT", "vpnDiagnosticStrict"],
  ["VPN_DIAGNOSTIC_PLAYWRIGHT", "vpnDiagnosticPlaywright"],
  ["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "playwrightChromiumExecutablePath"],
  ["PLAYWRIGHT_DISABLE_SANDBOX", "playwrightDisableSandbox"],
  ["X_SEARCH_API_CALL_LIMIT", "xSearchApiCallLimit"],
  ["X_SEARCH_API_WINDOW_MINUTES", "xSearchApiWindowMinutes"],
  ["X_API_CREDIT_USD", "xApiCreditUsd"],
  ["X_API_TOTAL_CREDIT_USED_USD", "xApiTotalCreditUsedUsd"],
  ["X_DAILY_SPEND_LIMIT_USD", "xDailySpendLimitUsd"],
  ["X_RUN_SPEND_LIMIT_USD", "xRunSpendLimitUsd"],
  ["X_MAX_SEARCHES_PER_DAY", "xMaxSearchesPerDay"],
  ["X_MAX_POSTS_READ_PER_DAY", "xMaxPostsReadPerDay"],
  ["X_MAX_COUNT_CALLS_PER_DAY", "xMaxCountCallsPerDay"],
  ["X_KEYWORDS_PER_QUERY", "xKeywordsPerQuery"],
  ["X_COUNT_FIRST_MODE", "xCountFirstMode"],
  ["X_COST_POST_READ_USD", "xCostPostReadUsd"],
  ["X_COST_USER_READ_USD", "xCostUserReadUsd"],
  ["X_COST_MEDIA_READ_USD", "xCostMediaReadUsd"],
  ["X_COST_USER_INTERACTION_USD", "xCostUserInteractionUsd"],
  ["X_COST_COUNT_CALL_USD", "xCostCountCallUsd"]
];

function getKindParam(params: unknown) {
  const kind = z.object({ kind: z.string() }).parse(params).kind;
  return isListKind(kind) ? kind : null;
}

function getIdParam(params: unknown): string {
  return z.object({ id: z.string() }).parse(params).id;
}

function getEntryIdParam(params: unknown): number {
  return z.object({ id: z.coerce.number().int().positive() }).parse(params).id;
}

function getTweetIdParam(params: unknown): string {
  return z.object({ tweetId: z.string().regex(/^\d+$/) }).parse(params).tweetId;
}

function createXActionClient(config: AppConfig["x"]): XActionClient {
  return new XActionClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    accessToken: config.accessToken,
    accessSecret: config.accessSecret
  });
}

type BrowserSnapshotFileSummary = {
  runId: string;
  filename: string;
  path: string;
  capturedAt: string | null;
  phase: string | null;
  keyword: string | null;
  url: string | null;
  title: string | null;
  articleCount: number | null;
  tweetTextCount: number | null;
  bodyTextLength: number;
  sizeBytes: number;
  updatedAt: string;
};

function browserSnapshotRoot(): string {
  return path.resolve(process.cwd(), "runtime", "browser-search-snapshots");
}

async function listBrowserSnapshots(): Promise<{ root: string; runs: Array<{ runId: string; updatedAt: string; files: BrowserSnapshotFileSummary[] }> }> {
  const root = browserSnapshotRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });

  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9._-]+$/.test(entry.name)) {
      continue;
    }
    const runDir = path.join(root, entry.name);
    const files = await listBrowserSnapshotFiles(entry.name, runDir);
    if (files.length === 0) {
      continue;
    }
    runs.push({
      runId: entry.name,
      updatedAt: files[0].updatedAt,
      files
    });
  }

  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { root, runs };
}

async function listBrowserSnapshotFiles(runId: string, runDir: string): Promise<BrowserSnapshotFileSummary[]> {
  const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => []);
  const files: BrowserSnapshotFileSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || !/^[a-zA-Z0-9._-]+\.json$/.test(entry.name)) {
      continue;
    }
    const absolutePath = path.join(runDir, entry.name);
    const stat = await fs.stat(absolutePath);
    const summary = await readBrowserSnapshotSummary(runId, entry.name, absolutePath, stat.size, stat.mtime.toISOString());
    files.push(summary);
  }
  files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return files;
}

async function readBrowserSnapshotSummary(
  runId: string,
  filename: string,
  absolutePath: string,
  sizeBytes: number,
  updatedAt: string
): Promise<BrowserSnapshotFileSummary> {
  const content = await fs.readFile(absolutePath, "utf8").catch(() => "{}");
  const parsed = safeJsonObject(content);
  const bodyText = typeof parsed.bodyText === "string" ? parsed.bodyText : "";
  return {
    runId,
    filename,
    path: `./${path.relative(process.cwd(), absolutePath)}`,
    capturedAt: textOrNull(parsed.capturedAt),
    phase: textOrNull(parsed.phase),
    keyword: textOrNull(parsed.keyword),
    url: textOrNull(parsed.url),
    title: textOrNull(parsed.title),
    articleCount: numberOrNull(parsed.articleCount),
    tweetTextCount: numberOrNull(parsed.tweetTextCount),
    bodyTextLength: bodyText.length,
    sizeBytes,
    updatedAt
  };
}

async function readBrowserSnapshot(runId: string, filename: string): Promise<BrowserSnapshotFileSummary & { bodyText: string }> {
  const root = browserSnapshotRoot();
  const absolutePath = path.resolve(root, runId, filename);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid snapshot path");
  }
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("Snapshot not found");
  }
  const content = await fs.readFile(absolutePath, "utf8");
  const parsed = safeJsonObject(content);
  const summary = await readBrowserSnapshotSummary(runId, filename, absolutePath, stat.size, stat.mtime.toISOString());
  return {
    ...summary,
    bodyText: typeof parsed.bodyText === "string" ? parsed.bodyText : ""
  };
}

function safeJsonObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function sendFrontendPage(reply: FastifyReply, pageRoot: string, filename: string) {
  const content = await fs.readFile(path.join(pageRoot, filename), "utf8");
  return reply.type("text/html").send(content);
}

function findFrontendRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "frontend"),
    path.resolve(__dirname, "../../frontend"),
    path.resolve(__dirname, "../../../frontend")
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(path.join(candidate, "pages"))) {
      return candidate;
    }
  }

  return candidates[0];
}

function scheduleRestartSignal(app: FastifyInstance, signalPath: string, delayMs: number): void {
  const timeout = setTimeout(() => {
    const now = new Date();
    fs.utimes(signalPath, now, now).catch((error) => {
      app.log.error({ err: error, signalPath }, "Unable to request server restart");
    });
  }, delayMs);
  timeout.unref();
}
