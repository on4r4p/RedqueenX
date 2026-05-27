import crypto from "node:crypto";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "better-sqlite3";
import type { AppConfig } from "../config";
import { isListKind, ListService } from "./listService";
import { parseRunStats, RunService } from "./runService";
import { LEGACY_FILE_MAPPINGS, LegacyImporter } from "../legacy/importer";
import { executeAdminCommand } from "./commandParser";
import { hashPassword, verifyAdminPassword, verifyPassword } from "./auth";
import { signAuthToken, verifyAuthToken, type AuthTokenPayload } from "./authToken";
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
import {
  DEFAULT_SERVER_ACCESS_CONFIG,
  isServerAccessAllowed,
  mergeServerAccessConfig,
  parseAccessListInput,
  type ServerAccessConfig
} from "./serverAccess";
import { isHandleSearchKeyword, normalizeHandle, normalizeSearchText, normalizeValue } from "../text";
import type { ListKind, RunRecord, RunStats, TweetCandidate } from "../types";
import { Crawler } from "../crawler";
import { XApiClient } from "../x-client";
import { XActionClient } from "../x-actions";
import { runRssFallback as runSharedRssFallback } from "../rssFallback";
import { keywordBatchMultiplierFromRunChainCount } from "../runPlanning";
import { RedditCrawler } from "../reddit/redditCrawler";
import { crawlRedditKeywords } from "../reddit/redditTimeline";
import { TimelineTweetService, type TimelineTweetExportRecord } from "./timelineTweetService";
import { TimelineItemService, type TimelineItemSource } from "./timelineItemService";
import { normalizeRawTimelineReasonGroupIds, RawTimelineTweetService } from "./rawTimelineTweetService";
import { MediaCacheService, type MediaCacheConfig } from "./mediaCacheService";
import { MediaCacheJobService } from "./mediaCacheJobService";
import { XBudgetExceededError, XBudgetService } from "../x-budget";
import { looksLikeXApiCreditsDepleted, xApiCreditsDepletedMessage } from "../xApiErrors";
import { XBrowserAccountService, type XBrowserAccountRecord } from "./xBrowserAccountService";
import { XSessionAlertService, type XSessionAlertRecord } from "./xSessionAlertService";
import { cleanTimelineUsername, TimelineUserService } from "./timelineUserService";
import type { KeywordUserPruneMode, StaleKeywordUserPruneReport } from "../worker/staleKeywordUserPruner";

const execFileAsync = promisify(execFile);
const netnsHelperPath = "/usr/local/sbin/redqueenx-netns";
const legacyNetnsHostVethName = "rqvpn-host";

function hasUsableNetnsHelper(): boolean {
  try {
    const stat = fsSync.statSync(netnsHelperPath);
    return stat.isFile() && Boolean(stat.mode & 0o4000) && Boolean(stat.mode & 0o111);
  } catch {
    return false;
  }
}

const maxPathLength = 4096;
const maxListValueLength = 5_000;
const maxCommandLength = 5_000;
const maxImportContentLength = 10 * 1024 * 1024;
const maxEnvValueLength = 10_000;
const csrfCookieName = "redqueen_csrf";
const csrfHeaderName = "x-redqueenx-csrf";
const mtlsProxySecretHeaderName = "x-redqueenx-mtls-proxy-secret";
const loginRateLimitWindowMs = 15 * 60 * 1000;
const loginRateLimitBlockMs = 15 * 60 * 1000;
const loginRateLimitMaxAttempts = 8;
const redactedEnvValue = "";
const envSecretKeys = new Set([
  "ADMIN_PASSWORD",
  "ADMIN_PASSWORD_HASH",
  "ADMIN_MTLS_PROXY_SECRET",
  "SESSION_SECRET",
  "X_BEARER_TOKEN",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "X_CLIENT_SECRET"
]);
const loginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().max(1_000)
});
const timelineUserCredentialSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(1_000)
});
const timelineUserCreateSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(8).max(1_000)
});
const timelineUserUpdateSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().max(1_000).optional()
});
const listMutationSchema = z.object({ value: z.string().max(maxListValueLength) });
const listUpdateSchema = z.object({ value: z.string().max(maxListValueLength) });
const commandSchema = z.object({ command: z.string().min(1).max(maxCommandLength) });
const importSchema = z.object({
  dataDir: z.string().max(maxPathLength).optional(),
  filename: z.string().max(255).optional()
});
const adminImportKinds = [...LIST_KINDS, "timeline_tweets"] as const;
const importContentSchema = z.object({
  filename: z.string().min(1).max(255),
  kind: z.enum(adminImportKinds),
  content: z.string().max(maxImportContentLength)
});
const legacyFilenameByKind = new Map(LEGACY_FILE_MAPPINGS.map((mapping) => [mapping.kind, mapping.filename] as const));
const staleKeywordUserPruneSchema = z.object({
  maxAgeDays: z.coerce.number().positive().max(3650).default(90),
  actionDelayMinSeconds: z.coerce.number().int().min(0).optional(),
  actionDelayMaxSeconds: z.coerce.number().int().min(0).optional(),
  autoIgnoreAlert: z.boolean().optional(),
  startIndex: z.coerce.number().int().positive().optional(),
  maxRetries: z.coerce.number().int().min(0).max(20).optional(),
  autoRestartDelaySeconds: z.coerce.number().int().min(0).max(3600).optional()
});
const staleKeywordUserPruneSpeedSchema = z.object({
  actionDelayMinSeconds: z.coerce.number().int().min(0),
  actionDelayMaxSeconds: z.coerce.number().int().min(0)
});
const databaseTableParamSchema = z.object({ tableName: z.string().min(1).max(128) });
const databaseTableQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25)
});
const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  archived: z
    .enum(["0", "1", "false", "true"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
  sources: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((source) => source.trim())
            .filter((source): source is "tweet" | "rss" | "reddit" => source === "tweet" || source === "rss" || source === "reddit")
        : undefined
    )
});
const timelineArchiveSchema = z.object({
  sources: z.array(z.enum(["tweet", "rss", "reddit"])).optional()
});
const timelineItemParamsSchema = z.object({
  source: z.enum(["rss", "reddit"]),
  externalId: z.string().trim().min(1).max(500)
});
const rawTimelineQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(300).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  reason: z
    .union([z.string().max(500), z.array(z.string().max(500))])
    .optional()
    .transform((value) => {
      const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
      return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).slice(0, 50);
    }),
  reasonGroup: z
    .union([z.string().max(100), z.array(z.string().max(100))])
    .optional()
    .transform((value) => {
      const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
      return normalizeRawTimelineReasonGroupIds(values).slice(0, 50);
    })
});
const rawTimelineAcceptSchema = z.object({
  runId: z.string().min(1).max(255),
  tweetId: z.string().min(1).max(255)
});
const databaseExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json")
});
const databaseClearSchema = z.object({
  confirm: z.string().min(1)
});
const filesystemBrowseQuerySchema = z.object({
  path: z.string().max(maxPathLength).optional(),
  mode: z.enum(["file", "directory"]).default("file"),
  extensions: z.string().max(200).optional()
});
const filesystemCopySchema = z.object({
  sourcePath: z.string().min(1).max(maxPathLength),
  targetDir: z.string().min(1).max(maxPathLength).default("./ops/vpn")
});
const openVpnAuthSchema = z.object({
  profilePath: z.string().min(1).max(maxPathLength),
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
  vpnProfilePath: z.string().min(1).max(maxPathLength).optional(),
  vpnProfilePaths: z.array(z.string().min(1).max(maxPathLength)).max(25_000).optional(),
  xIdentifier: z.string().min(1).max(120),
  replaceProfiles: z.boolean().optional()
});
const xBrowserAccountParamSchema = z.object({
  accountId: z.coerce.number().int().positive()
});
const xBrowserSessionImportSchema = z.object({
  filename: z.string().max(255).optional(),
  content: z.string().min(1).max(maxImportContentLength)
});
const xSessionAlertParamSchema = z.object({
  alertId: z.coerce.number().int().positive()
});
const xSessionAlertResolveSchema = z.object({
  note: z.string().trim().min(1).max(2_000)
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
const listSearchQuerySchema = z.object({
  q: z
    .string()
    .max(200)
    .optional()
    .transform((value) => value?.trim() || ""),
  limit: z.coerce.number().int().positive().max(25).default(8),
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
      "SEARCH_WITHOUT_API_ISOLATION",
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
      "SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT",
      "SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT",
      "SEARCH_WITHOUT_API_MAX_RETRIES",
      "SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS",
      "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN",
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
      "TIMELINE_DEFAULT_PAGE_SIZE",
      "RUN_CHAIN_COUNT",
      "STALE_KEYWORD_USER_MAX_AGE_DAYS",
      "STALE_KEYWORD_USER_START_INDEX",
      "STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS",
      "STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS",
      "STALE_KEYWORD_USER_AUTO_IGNORE_ALERT",
      "STALE_KEYWORD_USER_MAX_RETRIES",
      "STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS",
      "RAW_TIMELINE_ENABLED",
      "X_LOGIN_NOVNC_PORT",
      "X_LOGIN_SCREEN",
      "X_LOGIN_SERVICE_MAX_SECONDS",
      "X_LOGIN_BROWSER",
      "X_LOGIN_SAVE_MODE",
      "X_LOGIN_START_URL",
      "X_LOGIN_REUSE_BROWSER_PROFILE",
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
      "REDDIT_CRAWL_ENABLED",
      "REDDIT_CRAWL_USER_AGENT",
      "REDDIT_CRAWL_SUBREDDITS",
      "REDDIT_CRAWL_LIMIT_PER_KEYWORD",
      "REDDIT_CRAWL_SORT",
      "REDDIT_CRAWL_TIME_RANGE",
      "REDDIT_CRAWL_MIN_SCORE",
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
    z.string().max(maxEnvValueLength)
  )
});
const serverAccessUpdateSchema = z.object({
  whitelist: z.string().max(10_000).default(""),
  blacklist: z.string().max(10_000).default("")
});

export interface AdminApiOptions {
  database: Database;
  config: Pick<
    AppConfig,
    | "adminPassword"
    | "adminPasswordHash"
    | "adminTrustProxy"
    | "sessionSecret"
    | "adminIpv4Whitelist"
    | "adminIpv4Blacklist"
    | "legacyDataDir"
    | "currentSessionFile"
    | "xApiEnabled"
    | "searchWithoutApiEnabled"
    | "searchWithoutApiIsolation"
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
    | "searchWithoutApiUserKeywordPercent"
    | "searchWithoutApiAutoIgnoreAlert"
    | "searchWithoutApiMaxRetries"
    | "searchWithoutApiAutoRestartDelaySeconds"
    | "searchWithoutApiRequestsBeforePauseMin"
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
    | "timelineDefaultPageSize"
    | "runChainCount"
    | "staleKeywordUserMaxAgeDays"
    | "staleKeywordUserStartIndex"
    | "staleKeywordUserActionDelayMinSeconds"
    | "staleKeywordUserActionDelayMaxSeconds"
    | "staleKeywordUserAutoIgnoreAlert"
    | "staleKeywordUserMaxRetries"
    | "staleKeywordUserAutoRestartDelaySeconds"
    | "rawTimelineEnabled"
    | "xLoginNovncPort"
    | "xLoginScreen"
    | "xLoginServiceMaxSeconds"
    | "xLoginBrowser"
    | "xLoginSaveMode"
    | "xLoginStartUrl"
    | "xLoginReuseBrowserProfile"
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
    | "redditCrawlEnabled"
    | "redditCrawlUserAgent"
    | "redditCrawlSubreddits"
    | "redditCrawlLimitPerKeyword"
    | "redditCrawlSort"
    | "redditCrawlTimeRange"
    | "redditCrawlMinScore"
    | "enableXWrite"
    | "x"
  > &
    Partial<Pick<AppConfig, "adminAuthMode" | "adminMtlsProxySecret" | "adminPublicUrl" | "adminUsername">>;
  envPath?: string;
  restartSignalPath?: string;
  restartDelayMs?: number;
  currentSessionFilePath?: string;
  logger?: boolean;
}

type WithoutApiRunStartCheck =
  | { ok: true; account: XBrowserAccountRecord }
  | { ok: false; code: number; payload: { error: string; alert?: XSessionAlertRecord }; reason: string };

type StartStaleKeywordUserPruneResult =
  | {
      ok: true;
      job: StaleKeywordUserPruneJob;
      startCheck: WithoutApiRunStartCheck | null;
      resumedPreviousFailedJob: boolean;
    }
  | {
      ok: false;
      code: number;
      payload: { error: string; alert?: XSessionAlertRecord; job?: unknown };
      reason: string;
    };

interface StaleKeywordUserPruneJob {
  id: string;
  status: "running" | "completed" | "failed" | "stopped";
  mode: KeywordUserPruneMode;
  maxAgeDays: number;
  actionDelayMinSeconds: number;
  actionDelayMaxSeconds: number;
  autoIgnoreAlert: boolean;
  maxRetries: number;
  autoRestartDelaySeconds: number;
  startIndex: number;
  restartCount: number;
  blockedByAlertId: number | null;
  restartedAfterAlertId: number | null;
  autoRestartScheduledAt: string | null;
  autoRestartAt: string | null;
  autoRestartSource: "resolved" | "ignored" | "auto_ignored" | null;
  startedAt: string;
  completedAt: string | null;
  reportPath: string;
  resumeStatePath: string;
  stoppedRun: { id: string; status: string } | null;
  child: ChildProcess | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error: string | null;
}

interface ImportedXBrowserStorageState {
  cookies: Array<Record<string, unknown>>;
  origins: unknown[];
  [key: string]: unknown;
}

function parseImportedXBrowserStorageState(content: string): ImportedXBrowserStorageState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Imported session must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Imported session must be a Playwright storageState object.");
  }

  const state = parsed as Record<string, unknown>;
  if (!Array.isArray(state.cookies)) {
    throw new Error("Imported session must contain a cookies array.");
  }
  if (state.origins !== undefined && !Array.isArray(state.origins)) {
    throw new Error("Imported session origins must be an array.");
  }

  const cookies = state.cookies.map((cookieValue, index) => {
    if (!cookieValue || typeof cookieValue !== "object" || Array.isArray(cookieValue)) {
      throw new Error(`Imported session cookie #${index + 1} is invalid.`);
    }
    const cookieRecord = cookieValue as Record<string, unknown>;
    for (const key of ["name", "value", "domain", "path"]) {
      if (typeof cookieRecord[key] !== "string") {
        throw new Error(`Imported session cookie #${index + 1} is missing ${key}.`);
      }
    }
    return cookieRecord;
  });

  const hasXAuthToken = cookies.some((cookieRecord) => {
    const name = String(cookieRecord.name);
    const domain = String(cookieRecord.domain).replace(/^\./, "").toLowerCase();
    return name === "auth_token" && (domain === "x.com" || domain.endsWith(".x.com") || domain === "twitter.com" || domain.endsWith(".twitter.com"));
  });
  if (!hasXAuthToken) {
    throw new Error("Imported session must contain an X auth_token cookie.");
  }

  return {
    ...state,
    cookies,
    origins: Array.isArray(state.origins) ? state.origins : []
  };
}

function xBrowserSessionFilename(account: XBrowserAccountRecord): string {
  const safeIdentifier =
    account.xIdentifier
      .trim()
      .replace(/^@/, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "x-browser-account";
  return `${safeIdentifier}-x-session.json`;
}

export function createAdminApi(options: AdminApiOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 50 * 1024 * 1024,
    trustProxy: options.config.adminTrustProxy
  });
  const lists = new ListService(options.database);
  const runs = new RunService(options.database);
  const importer = new LegacyImporter(options.database);
  const timeline = new LegacyTimelineService(options.database);
  const timelineTweets = new TimelineTweetService(options.database);
  const timelineItems = new TimelineItemService(options.database);
  const rawTimelineTweets = new RawTimelineTweetService(options.database);
  const mediaCacheJobs = new MediaCacheJobService(options.database);
  const settings = new SettingsService(options.database);
  const env = new EnvService(options.envPath);
  const databaseAdmin = new DatabaseAdminService(options.database);
  const xBrowserAccounts = new XBrowserAccountService(options.database);
  const xSessionAlerts = new XSessionAlertService(options.database);
  const timelineUsers = new TimelineUserService(options.database);
  const currentSession = new CurrentSessionService(options.currentSessionFilePath ?? options.config.currentSessionFile);
  const xBudget = new XBudgetService(options.database, () => getXApiConfig());
  const requestStartTimes = new WeakMap<object, number>();
  const hostname = os.hostname();
  const adminAuthMode = options.config.adminAuthMode ?? "password";
  const adminPublicUrl = normalizePublicAdminUrl(options.config.adminPublicUrl);
  const adminUsername = cleanTimelineUsername(options.config.adminUsername ?? "admin") || "admin";
  let runtimeAdminPassword = options.config.adminPassword;
  let runtimeAdminPasswordHash = options.config.adminPasswordHash;
  const usesProxyClientCertificateAuth = adminAuthMode === "mtls_proxy";
  const loginRateLimits = new Map<string, { attempts: number; windowStartedAt: number; blockedUntil: number }>();
  let activeCrawlerRunId: string | null = null;
  let activeWithoutApiWorker: ChildProcess | null = null;
  let activeWithoutApiWorkerRunId: string | null = null;
  let withoutApiAlertRestartTimer: NodeJS.Timeout | null = null;
  let mediaCacheFetchQueue: Promise<void> = Promise.resolve();
  let staleKeywordUserPruneJob: StaleKeywordUserPruneJob | null = null;
  let staleKeywordUserPruneStartInProgress = false;
  let staleKeywordUserPruneRestartTimer: NodeJS.Timeout | null = null;
  const activeXAlertLoginProcesses = new Map<number, ChildProcess>();
  const apiResumeTimers = new Map<string, NodeJS.Timeout>();
  const serverAccessEnvConfig: ServerAccessConfig = {
    whitelist: options.config.adminIpv4Whitelist,
    blacklist: options.config.adminIpv4Blacklist
  };
  const frontendRoot = findFrontendRoot();
  const pageRoot = path.join(frontendRoot, "pages");
  const assetRoot = path.join(frontendRoot, "assets");

  const getEffectiveServerAccessConfig = (storedConfig?: ServerAccessConfig): ServerAccessConfig =>
    mergeServerAccessConfig(
      storedConfig ?? settings.getServerAccessConfig(DEFAULT_SERVER_ACCESS_CONFIG),
      serverAccessEnvConfig
    );

  function readAdminAuth(request: FastifyRequest): AuthTokenPayload | null {
    const token = verifyAuthToken(request.cookies.redqueen_admin, options.config.sessionSecret);
    return token?.role === "admin" && token.sessionVersion === currentAdminSessionVersion() ? token : null;
  }

  function readTimelineAuth(request: FastifyRequest): AuthTokenPayload | null {
    const adminToken = readAdminAuth(request);
    if (adminToken) {
      return adminToken;
    }
    const timelineToken = verifyAuthToken(request.cookies.redqueen_timeline, options.config.sessionSecret);
    if (timelineToken?.role !== "timeline") {
      return null;
    }
    const userId = timelineUserIdFromSubject(timelineToken.sub);
    if (!userId) {
      return null;
    }
    const user = timelineUsers.findById(userId);
    if (!user || String(user.sessionVersion) !== timelineToken.sessionVersion) {
      return null;
    }
    return { ...timelineToken, username: user.username };
  }

  function setAuthCookie(reply: FastifyReply, request: FastifyRequest, name: "redqueen_admin" | "redqueen_timeline", token: string): void {
    reply.setCookie(name, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: isHttpsRequest(request)
    });
  }

  function setCsrfCookie(reply: FastifyReply, request: FastifyRequest): string {
    const token = crypto.randomBytes(32).toString("base64url");
    reply.setCookie(csrfCookieName, token, {
      httpOnly: false,
      sameSite: "strict",
      path: "/",
      secure: isHttpsRequest(request)
    });
    return token;
  }

  function clearAuthCookie(reply: FastifyReply, name: "redqueen_admin" | "redqueen_timeline"): void {
    reply.clearCookie(name, { path: "/" });
  }

  function currentAdminSessionVersion(): string {
    return crypto
      .createHash("sha256")
      .update(adminUsername)
      .update("\0")
      .update(runtimeAdminPasswordHash ?? runtimeAdminPassword ?? "")
      .digest("base64url")
      .slice(0, 32);
  }

  function timelineUserIdFromSubject(subject: string): number | null {
    const match = /^timeline:(\d+)$/.exec(subject);
    if (!match) {
      return null;
    }
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function loginRateLimitKey(scope: "admin" | "timeline", request: FastifyRequest, username: string): string {
    return `${scope}:${request.ip}:${cleanTimelineUsername(username).toLowerCase() || "unknown"}`;
  }

  function checkLoginRateLimit(
    scope: "admin" | "timeline",
    request: FastifyRequest,
    username: string
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const key = loginRateLimitKey(scope, request, username);
    const existing = loginRateLimits.get(key);
    if (existing?.blockedUntil && existing.blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000) };
    }

    const entry =
      existing && now - existing.windowStartedAt <= loginRateLimitWindowMs
        ? existing
        : { attempts: 0, windowStartedAt: now, blockedUntil: 0 };
    entry.attempts += 1;
    if (entry.attempts > loginRateLimitMaxAttempts) {
      entry.blockedUntil = now + loginRateLimitBlockMs;
      loginRateLimits.set(key, entry);
      return { allowed: false, retryAfterSeconds: Math.ceil(loginRateLimitBlockMs / 1000) };
    }

    loginRateLimits.set(key, entry);
    return { allowed: true };
  }

  function clearLoginRateLimit(scope: "admin" | "timeline", request: FastifyRequest, username: string): void {
    loginRateLimits.delete(loginRateLimitKey(scope, request, username));
  }

  async function requireSameOriginMutation(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: "admin" | "timeline"
  ): Promise<boolean> {
    if (isSameOriginMutationRequest(request) && hasValidCsrfToken(request)) {
      return true;
    }
    await recordSession("prob", "security.csrf_blocked", `Blocked ${scope} mutation from a non-RedqueenX origin`, {
      method: request.method,
      path: safePath(request.url),
      origin: headerValue(request.headers.origin) ?? null,
      referer: headerValue(request.headers.referer) ?? null,
      fetchSite: headerValue(request.headers["sec-fetch-site"]) ?? null,
      csrfHeaderPresent: Boolean(headerValue(request.headers[csrfHeaderName]))
    });
    reply.code(403).send({ error: `Forbidden: ${scope} mutations require the RedqueenX origin and CSRF token.` });
    return false;
  }

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
    applySecurityHeaders(request, reply);
    requestStartTimes.set(request, performance.now());
    if (!usesProxyClientCertificateAuth) {
      const accessDecision = isServerAccessAllowed(getEffectiveServerAccessConfig(), request.ip);
      if (!accessDecision.allowed) {
        await recordSession("prob", "server_access.denied", "HTTP request blocked by RedqueenX access policy", {
          ip: accessDecision.ip ?? request.ip,
          reason: accessDecision.reason,
          method: request.method,
          path: safePath(request.url)
        });
        return reply.code(403).send({ error: "Forbidden by RedqueenX access policy" });
      }
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
    const statusCode = httpError.statusCode ?? (error instanceof z.ZodError ? 400 : 500);
    void recordSession(statusCode >= 500 ? "prob" : "debug", "http.error", httpError.message, {
      method: request.method,
      path: safePath(request.url),
      statusCode
    });
    if (reply.sent) {
      return;
    }
    if (error instanceof z.ZodError) {
      reply.code(400).send({
        error: "Invalid request payload.",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      });
      return;
    }
    if (statusCode >= 500) {
      reply.code(500).send({ error: "Internal server error" });
      return;
    }
    reply.code(statusCode).send({ error: httpError.message || "Request failed" });
  });

  app.addHook("preHandler", async (request, reply) => {
    const pathName = safePath(request.url);

    if (pathName.startsWith("/admin")) {
      if (isAdminLoginRoute(request.url)) {
        return;
      }

      if (usesProxyClientCertificateAuth) {
        if (!isTrustedMtlsProxyRequest(request, options.config.adminMtlsProxySecret)) {
          await recordSession("prob", "security.mtls_proxy_header_missing", "Blocked admin request without trusted mTLS proxy header", {
            method: request.method,
            path: pathName
          });
          return reply.code(403).send({ error: "Forbidden: trusted client certificate proxy required." });
        }
        if (!options.config.adminMtlsProxySecret && !isTrustedMtlsProxySourceAddress(request.ip)) {
          await recordSession("prob", "security.mtls_proxy_untrusted_source", "Blocked admin request from an untrusted proxy source", {
            method: request.method,
            path: pathName,
            ip: request.ip
          });
          return reply.code(403).send({ error: "Forbidden: mTLS proxy mode requires a local trusted reverse proxy." });
        }
        if (isAdminMutationRequest(request) && !(await requireSameOriginMutation(request, reply, "admin"))) {
          return;
        }
        return;
      }

      if (!readAdminAuth(request)) {
        if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
          return reply.redirect("/admin/login");
        }
        return reply.code(401).send({ error: "Admin authentication required" });
      }

      if (isAdminMutationRequest(request) && !(await requireSameOriginMutation(request, reply, "admin"))) {
        return;
      }
      return;
    }

    if (!isTimelineProtectedPath(pathName)) {
      return;
    }

    if (!readTimelineAuth(request)) {
      if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
        return reply.redirect("/timeline/login");
      }
      return reply.code(401).send({ error: "Timeline authentication required" });
    }

    if (isTimelineMutationRequest(request) && !(await requireSameOriginMutation(request, reply, "timeline"))) {
      return;
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/public-config", async () => ({
    adminUrl: adminPublicUrl || "/admin",
    adminAuthMode
  }));

  app.get("/", async (_request, reply) => {
    reply.redirect("/timeline");
  });

  app.get("/timeline/login", async (request, reply) => {
    if (readTimelineAuth(request)) {
      return reply.redirect("/timeline");
    }
    return sendFrontendPage(reply, pageRoot, "timeline-login.html");
  });

  app.post("/timeline/login", async (request, reply) => {
    const parsed = timelineUserCredentialSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(401).send({ error: "Invalid timeline login" });
      return;
    }
    const body = parsed.data;
    const rateLimit = checkLoginRateLimit("timeline", request, body.username);
    if (!rateLimit.allowed) {
      await recordSession("prob", "timeline_auth.login.rate_limited", "Timeline login rate limit exceeded", {
        username: cleanTimelineUsername(body.username),
        retryAfterSeconds: rateLimit.retryAfterSeconds
      });
      reply.header("retry-after", String(rateLimit.retryAfterSeconds)).code(429).send({
        error: "Too many login attempts. Try again later."
      });
      return;
    }
    const user = timelineUsers.findByUsername(body.username);
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!valid || !user) {
      await recordSession("prob", "timeline_auth.login.failed", "Invalid timeline login attempt", {
        username: cleanTimelineUsername(body.username)
      });
      reply.code(401).send({ error: "Invalid timeline login" });
      return;
    }

    const token = signAuthToken(
      { sub: `timeline:${user.id}`, role: "timeline", username: user.username, sessionVersion: user.sessionVersion },
      options.config.sessionSecret
    );
    setAuthCookie(reply, request, "redqueen_timeline", token);
    setCsrfCookie(reply, request);
    clearLoginRateLimit("timeline", request, body.username);
    await recordSession("info", "timeline_auth.login", "Timeline login accepted", { userId: user.id });
    return { ok: true, user: { id: user.id, username: user.username } };
  });

  app.post("/timeline/logout", async (_request, reply) => {
    clearAuthCookie(reply, "redqueen_timeline");
    reply.clearCookie(csrfCookieName, { path: "/" });
    return { ok: true };
  });

  app.get("/timeline/auth", async (request) => {
    const token = readTimelineAuth(request);
    return { ok: true, user: token ? { role: token.role, username: token.username } : null };
  });

  app.get("/timeline", async (request, reply) => {
    setCsrfCookie(reply, request);
    return sendFrontendPage(reply, pageRoot, "timeline.html");
  });

  app.get("/raw-timeline", async (request, reply) => {
    setCsrfCookie(reply, request);
    return sendFrontendPage(reply, pageRoot, "raw-timeline.html");
  });

  app.get("/rejected-timeline", async (request, reply) => {
    setCsrfCookie(reply, request);
    return sendFrontendPage(reply, pageRoot, "raw-timeline.html");
  });

  app.get("/timeline/data", async (request) => {
    const query = timelineQuerySchema.parse(request.query);
    const xApiConfig = getXApiConfig();
    const mediaCacheService = getMediaCache();
    await mediaCacheService.prune().catch(() => undefined);
    const page = timeline.page({
      limit: query.limit ?? xApiConfig.timelineDefaultPageSize,
      offset: query.offset,
      sources: query.sources,
      archived: query.archived
    });
    return {
      items: page.items.map((item) => mediaCacheService.decorateTimelineItem(item)),
      pagination: {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        hasMore: page.hasMore
      },
      rawTimelineEnabled: xApiConfig.rawTimelineEnabled,
      actionsEnabled: Boolean(options.config.enableXWrite && xApiConfig.xApiEnabled && !xApiConfig.searchWithoutApiEnabled)
    };
  });

  app.post("/timeline/archive", async (request) => {
    const body = timelineArchiveSchema.parse(request.body ?? {});
    const archivedAt = new Date().toISOString();
    const archived = timeline.archiveAll(body.sources, archivedAt);
    await recordSession("info", "timeline.archive", "Timeline entries archived", {
      archivedAt,
      sources: body.sources ?? ["tweet", "rss", "reddit"],
      ...archived
    });
    return { archivedAt, archived, total: archived.tweets + archived.items + archived.legacy };
  });

  app.post("/timeline/archive/restore", async (request) => {
    const body = timelineArchiveSchema.parse(request.body ?? {});
    const restored = timeline.restoreAll(body.sources);
    await recordSession("info", "timeline.archive.restore", "Timeline archive entries restored", {
      sources: body.sources ?? ["tweet", "rss", "reddit"],
      ...restored
    });
    return { restored, total: restored.tweets + restored.items + restored.legacy };
  });

  app.post("/timeline/items/:source/:externalId/archive", async (request) => {
    const params = timelineItemParamsSchema.parse(request.params);
    const archivedAt = new Date().toISOString();
    const archived = timelineItems.archiveOne(params.source as TimelineItemSource, params.externalId, archivedAt);
    await recordSession("info", "timeline.item.archive", "Timeline item archived", {
      source: params.source,
      externalId: params.externalId,
      archivedAt,
      archived
    });
    return { source: params.source, externalId: params.externalId, archivedAt, archived };
  });

  app.post("/timeline/items/:source/:externalId/restore", async (request) => {
    const params = timelineItemParamsSchema.parse(request.params);
    const restored = timelineItems.restoreOne(params.source as TimelineItemSource, params.externalId);
    await recordSession("info", "timeline.item.restore", "Timeline item restored", {
      source: params.source,
      externalId: params.externalId,
      restored
    });
    return { source: params.source, externalId: params.externalId, restored };
  });

  app.get("/admin/timeline/export", async (_request, reply) => {
    const exported = exportTimelineTweetsContent();
    await recordSession("info", "timeline.export", "Timeline tweets downloaded from admin", {
      filename: exported.filename,
      lines: exported.lineCount
    });
    reply
      .header("content-disposition", `attachment; filename="${exported.filename}"`)
      .type(exported.contentType)
      .send(exported.body);
  });

  app.get("/raw-timeline/data", async (request) => rejectedTimelineDataResponse(request.query));

  app.get("/rejected-timeline/data", async (request) => rejectedTimelineDataResponse(request.query));

  async function clearRejectedTimeline(actor: "admin" | "timeline") {
    const deleted = rawTimelineTweets.clearRejected();
    await recordSession("info", "rejected_timeline.clear", "Rejected timeline entries deleted", { actor, deleted });
    return { deleted };
  }

  app.delete("/admin/rejected-timeline", async () => {
    return clearRejectedTimeline("admin");
  });

  app.delete("/timeline/rejected-timeline", async () => {
    return clearRejectedTimeline("timeline");
  });

  app.post("/admin/rejected-timeline/accept", async (request, reply) => {
    const body = rawTimelineAcceptSchema.parse(request.body ?? {});
    return acceptRejectedTimelineTweet(body.runId, body.tweetId, reply, "admin");
  });

  app.post("/timeline/rejected-timeline/accept", async (request, reply) => {
    const body = rawTimelineAcceptSchema.parse(request.body ?? {});
    return acceptRejectedTimelineTweet(body.runId, body.tweetId, reply, "timeline");
  });

  function rejectedTimelineDataResponse(rawQuery: unknown) {
    const query = rawTimelineQuerySchema.parse(rawQuery);
    const xApiConfig = getXApiConfig();
    const limit = query.limit ?? xApiConfig.timelineDefaultPageSize;
    const availableRejectionReasons = rawTimelineTweets.rejectionReasonOptions();
    const availableRejectionReasonGroups = rawTimelineTweets.rejectionReasonGroupOptions();
    if (!xApiConfig.rawTimelineEnabled) {
      return {
        enabled: false,
        items: [],
        availableRejectionReasons,
        availableRejectionReasonGroups,
        selectedRejectionReasons: query.reason,
        selectedRejectionReasonGroups: query.reasonGroup,
        pagination: {
          total: 0,
          limit,
          offset: 0,
          hasMore: false
        }
      };
    }
    const page = rawTimelineTweets.page({
      limit,
      offset: query.offset,
      decisionStatus: "rejected",
      rejectionReasons: query.reason,
      rejectionReasonGroups: query.reasonGroup
    });
    return {
      enabled: true,
      items: page.items,
      availableRejectionReasons,
      availableRejectionReasonGroups,
      selectedRejectionReasons: query.reason,
      selectedRejectionReasonGroups: query.reasonGroup,
      pagination: {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        hasMore: page.hasMore
      }
    };
  }

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
    return reloadTweetMediaCache(getTweetIdParam(request.params), "admin", reply);
  });

  app.post("/timeline/tweets/:tweetId/media-cache/reload", async (request, reply) => {
    return reloadTweetMediaCache(getTweetIdParam(request.params), "timeline", reply);
  });

  app.get("/timeline/media-cache/jobs/:id", async (request, reply) => {
    const job = mediaCacheJobs.find(getEntryIdParam(request.params));
    if (!job) {
      reply.code(404).send({ error: "Media cache job not found." });
      return;
    }
    return {
      job: {
        id: job.id,
        tweetId: job.tweetId,
        status: job.status,
        lastError: job.lastError,
        updatedAt: job.updatedAt
      }
    };
  });

  async function reloadTweetMediaCache(tweetId: string, actor: "admin" | "timeline", reply: FastifyReply) {
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

    await recordSession("info", "media_cache.reload.requested", "Timeline media cache reload requested", {
      tweetId,
      actor,
      sourceCount,
      viaVpnNamespace: xApiConfig.vpnNetnsName,
      isolation: xApiConfig.searchWithoutApiIsolation
    });

    if (usesDockerVpnIsolation(xApiConfig)) {
      const job = mediaCacheJobs.enqueue(tweetId, `${actor}_reload`);
      await recordSession("info", "media_cache.reload.queued", "Timeline media cache reload queued for Docker VPN worker", {
        tweetId,
        actor,
        sourceCount,
        jobId: job.id
      });
      return { ok: true, queued: true, jobId: job.id, sourceCount, item: getMediaCache().decorateTimelineItem(tweet) };
    }

    try {
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...xApiConfigToEnvValues(xApiConfig),
        CURRENT_SESSION_FILE: options.currentSessionFilePath ?? options.config.currentSessionFile,
        VPN_NETNS_AUTOSTART: "true"
      };
      const databasePath = databasePathForChild(options.database);
      if (databasePath) {
        childEnv.DATABASE_URL = databasePath;
      }
      const { stdout, stderr } = await execFileAsync("npm", ["run", "netns:media-cache:fetch", "--", "--tweet-id", tweetId], {
        cwd: process.cwd(),
        timeout: 5 * 60 * 1000,
        env: childEnv,
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
      await recordSession("prob", "media_cache.reload.failed", message, { tweetId, actor });
      reply.code(502).send({ error: message });
    }
  }

  app.post("/admin/media-cache/retry-abs-twimg-failures", async (request, reply) => {
    const xApiConfig = getXApiConfig();
    if (!xApiConfig.searchWithoutApiMediaCacheEnabled) {
      reply.code(403).send({ error: "Media cache download is disabled in Search without Api settings." });
      return;
    }
    const mediaCache = getMediaCache();
    const tweetIds = mediaCache.tweetIdsForFailedSourceError("Refusing non-X media host abs.twimg.com.", "abs.twimg.com");
    if (tweetIds.length === 0) {
      return { ok: true, matched: 0, queued: 0, mode: usesDockerVpnIsolation(xApiConfig) ? "docker_vpn" : "host_netns" };
    }

    if (usesDockerVpnIsolation(xApiConfig)) {
      const jobs = tweetIds.map((tweetId) => mediaCacheJobs.enqueue(tweetId, "retry_abs_twimg"));
      await recordSession("info", "media_cache.retry_abs_twimg.queued", "Queued media cache retries for previous abs.twimg.com failures", {
        matched: tweetIds.length,
        queued: jobs.length,
        jobIds: jobs.map((job) => job.id)
      });
      return { ok: true, matched: tweetIds.length, queued: jobs.length, mode: "docker_vpn" };
    }

    for (const tweetId of tweetIds) {
      mediaCacheFetchQueue = mediaCacheFetchQueue
        .catch(() => undefined)
        .then(() => runMediaCacheFetchProcess(tweetId, xApiConfig));
    }
    await recordSession("info", "media_cache.retry_abs_twimg.queued", "Queued media cache retries for previous abs.twimg.com failures", {
      matched: tweetIds.length,
      queued: tweetIds.length,
      isolation: xApiConfig.searchWithoutApiIsolation
    });
    return { ok: true, matched: tweetIds.length, queued: tweetIds.length, mode: "host_netns" };
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
      const creditsDepleted = await handleXApiCreditsDepleted(error, { action: "like", tweetId });
      timelineTweets.markActionError(tweetId, "like", message);
      await recordSession("prob", "tweet.like.failed", message, { tweetId });
      reply.code(creditsDepleted ? 402 : error instanceof XBudgetExceededError ? 429 : 502).send({
        error: creditsDepleted ? xApiCreditsDepletedMessage() : message
      });
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
      const creditsDepleted = await handleXApiCreditsDepleted(error, { action: "retweet", tweetId });
      timelineTweets.markActionError(tweetId, "retweet", message);
      await recordSession("prob", "tweet.retweet.failed", message, { tweetId });
      reply.code(creditsDepleted ? 402 : error instanceof XBudgetExceededError ? 429 : 502).send({
        error: creditsDepleted ? xApiCreditsDepletedMessage() : message
      });
    }
  });

  app.get("/admin/login", async (request, reply) => {
    if (usesProxyClientCertificateAuth) {
      return reply.code(404).type("text/plain").send("not found");
    }
    if (readAdminAuth(request)) {
      return reply.redirect("/admin");
    }
    return sendFrontendPage(reply, pageRoot, "login.html");
  });

  app.get("/admin", async (request, reply) => {
    setCsrfCookie(reply, request);
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
    if (usesProxyClientCertificateAuth) {
      reply.code(404).send({ error: "Admin password login is disabled when client certificate authentication is active." });
      return;
    }
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(401).send({ error: "Invalid admin credentials" });
      return;
    }
    const body = parsed.data;
    const rateLimit = checkLoginRateLimit("admin", request, body.username);
    if (!rateLimit.allowed) {
      await recordSession("prob", "auth.login.rate_limited", "Admin login rate limit exceeded", {
        username: cleanTimelineUsername(body.username),
        retryAfterSeconds: rateLimit.retryAfterSeconds
      });
      reply.header("retry-after", String(rateLimit.retryAfterSeconds)).code(429).send({
        error: "Too many login attempts. Try again later."
      });
      return;
    }
    const username = cleanTimelineUsername(body.username);
    const validUsername = username.toLowerCase() === adminUsername.toLowerCase();
    const validPassword = await verifyAdminPassword(body.password, {
      password: runtimeAdminPassword,
      passwordHash: runtimeAdminPasswordHash
    });
    const valid = validUsername && validPassword;

    if (!valid) {
      await recordSession("prob", "auth.login.failed", "Invalid admin login attempt", { username });
      reply.code(401).send({ error: "Invalid admin credentials" });
      return;
    }

    let passwordHashPersisted = Boolean(runtimeAdminPasswordHash);
    if (!runtimeAdminPasswordHash && runtimeAdminPassword) {
      const nextHash = await hashPassword(body.password);
      runtimeAdminPasswordHash = nextHash;
      runtimeAdminPassword = undefined;
      try {
        await env.update({ ADMIN_PASSWORD_HASH: nextHash, ADMIN_PASSWORD: "" });
        passwordHashPersisted = true;
      } catch (error) {
        await recordSession("prob", "auth.password_hash_persist_failed", "Admin password hash could not be written to .env", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const token = signAuthToken(
      { sub: "admin", role: "admin", username: adminUsername, sessionVersion: currentAdminSessionVersion() },
      options.config.sessionSecret
    );
    setAuthCookie(reply, request, "redqueen_admin", token);
    setCsrfCookie(reply, request);
    clearLoginRateLimit("admin", request, body.username);
    reply.clearCookie("redqueen_session", { path: "/admin" });
    await recordSession("info", "auth.login", "Admin login accepted", { passwordHashPersisted });
    return { ok: true, passwordHashPersisted };
  });

  app.post("/admin/logout", async (request, reply) => {
    if (usesProxyClientCertificateAuth) {
      reply.clearCookie(csrfCookieName, { path: "/" });
      return { ok: true, authMode: adminAuthMode };
    }
    clearAuthCookie(reply, "redqueen_admin");
    reply.clearCookie(csrfCookieName, { path: "/" });
    reply.clearCookie("redqueen_session", { path: "/admin" });
    await recordSession("info", "auth.logout", "Admin logout");
    return { ok: true };
  });

  app.get("/admin/timeline-users", async () => ({
    users: timelineUsers.list()
  }));

  app.post("/admin/timeline-users", async (request, reply) => {
    const body = timelineUserCreateSchema.parse(request.body ?? {});
    try {
      const user = timelineUsers.create({
        username: body.username,
        passwordHash: await hashPassword(body.password)
      });
      await recordSession("info", "timeline_user.created", "Timeline user created", { userId: user.id, username: user.username });
      return { user };
    } catch (error) {
      reply.code(409).send({ error: error instanceof Error ? error.message : "Unable to create timeline user." });
    }
  });

  app.patch("/admin/timeline-users/:id", async (request, reply) => {
    const id = getEntryIdParam(request.params);
    const body = timelineUserUpdateSchema.parse(request.body ?? {});
    try {
      const user = timelineUsers.update(id, {
        username: body.username,
        passwordHash: body.password && body.password.trim() ? await hashPassword(body.password) : undefined
      });
      await recordSession("info", "timeline_user.updated", "Timeline user updated", { userId: user.id, username: user.username });
      return { user };
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : "Unable to update timeline user." });
    }
  });

  app.delete("/admin/timeline-users/:id", async (request) => {
    const id = getEntryIdParam(request.params);
    const deleted = timelineUsers.delete(id);
    await recordSession("info", "timeline_user.deleted", "Timeline user deleted", { userId: id, deleted });
    return { deleted };
  });

  app.get("/admin/stats", async () => {
    const xApiConfig = getXApiConfig();
    const staleKeywordUserPrune = await staleKeywordUserPruneStatusFresh();
    return {
      lists: lists.countActiveByKind(),
      currentRun: runs.current(),
      staleKeywordUserPrune,
      xBudget: xBudget.snapshot(undefined, runs.current()?.id),
      runtimeModes: {
        adminAuthMode,
        adminPublicUrl: adminPublicUrl || null,
        xApiEnabled: xApiConfig.xApiEnabled,
        searchWithoutApiEnabled: xApiConfig.searchWithoutApiEnabled
      },
      searchWithoutApi: searchWithoutApiPlaceholderStats(xApiConfig),
      xSessionAlerts: xSessionAlerts.openAlerts()
    };
  });

  app.get("/admin/system/health", async () => systemHealthReport());

  app.get("/admin/runs/preview", async () => {
    const runtimeConfig = getXApiConfig();
    const currentRun = runs.current();
    const activePlan = currentRun ? currentRunKeywordPlanPreview(runs, currentRun) : null;
    if (activePlan) {
      const firstPreview = activePlan.previews[0] ?? { plannedKeywords: 0, sample: [] };
      return {
        generatedAt: new Date().toISOString(),
        availability: keywordAvailability(lists),
        source: "active_run",
        run: { id: currentRun?.id, status: currentRun?.status, isCurrent: true },
        runCount: activePlan.runCount,
        plannedKeywords: firstPreview.plannedKeywords,
        sample: firstPreview.sample,
        previews: activePlan.previews
      };
    }

    const keywordChain = plannedKeywordChain(lists, runtimeConfig, { deterministic: true });
    const previews = keywordChain.batches.map((preview) => ({
      runIndex: preview.runIndex,
      plannedKeywords: preview.keywords.length,
      sample: preview.keywords,
      status: "planned"
    }));
    const firstPreview = previews[0] ?? { plannedKeywords: 0, sample: [] };
    return {
      generatedAt: new Date().toISOString(),
      availability: keywordAvailability(lists),
      source: "fresh_preview",
      runCount: keywordChain.chain.total,
      plannedKeywords: firstPreview.plannedKeywords,
      sample: firstPreview.sample,
      previews
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
      const existingAlert = xSessionAlerts.find(alertId);
      if (!existingAlert) {
        reply.code(404).send({ error: `X session alert not found: ${alertId}` });
        return;
      }
      if (existingAlert.status !== "open") {
        reply.code(409).send({ error: "This X session alert is already resolved." });
        return;
      }
      const account = xBrowserAccounts.findById(existingAlert.accountId);
      if (!account) {
        reply.code(404).send({ error: `X browser account not found: ${existingAlert.accountId}` });
        return;
      }
      if (!xAlertSessionWasCaptured(existingAlert, account)) {
        const commands = xAlertManualLoginCommands(account.id);
        reply.code(409).send({
          error:
            "Capture and save a fresh X browser session before resolving this alert. Click Launch visible X login; RedqueenX will save the session automatically as soon as the login is detected.",
          commands
        });
        return;
      }
      const alert = xSessionAlerts.resolve(alertId, body.note);
      await recordSession("info", "x.session_alert.resolved", "X session alert resolved by admin", {
        alertId: alert.id,
        accountId: alert.accountId,
        xIdentifier: alert.xIdentifier
      });
      await maybeRestartStaleKeywordUserPruneAfterAlert(alert, "resolved");
      await refreshStaleKeywordUserPruneJobFromReport();
      return { alert, staleKeywordUserPrune: staleKeywordUserPruneStatus() };
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to resolve alert" });
    }
  });

  app.post("/admin/x-session-alerts/:alertId/ignore", async (request, reply) => {
    try {
      const { alertId } = xSessionAlertParamSchema.parse(request.params);
      const existingAlert = xSessionAlerts.find(alertId);
      if (!existingAlert) {
        reply.code(404).send({ error: `X session alert not found: ${alertId}` });
        return;
      }
      if (existingAlert.status !== "open") {
        reply.code(409).send({ error: "This X session alert is already closed." });
        return;
      }
      const alert = xSessionAlerts.ignore(alertId);
      markIgnoredAlertAccountReady(alert);
      await recordSession("prob", "x.session_alert.ignored", "X session alert ignored by admin", {
        alertId: alert.id,
        accountId: alert.accountId,
        xIdentifier: alert.xIdentifier,
        alertType: alert.alertType
      });
      await maybeRestartStaleKeywordUserPruneAfterAlert(alert, "ignored");
      await refreshStaleKeywordUserPruneJobFromReport();
      return { alert, staleKeywordUserPrune: staleKeywordUserPruneStatus() };
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to ignore alert" });
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

      if (usesDockerVpnIsolation()) {
        await recordSession("info", "x.session_alert.login.manual_required", "Docker VPN mode requires launching x-login from the host shell", {
          alertId: alert.id,
          accountId: account.id,
          xIdentifier: account.xIdentifier,
          command: commands.webLaunch
        });
        return {
          launched: false,
          manualRequired: true,
          alert,
          account,
          commands,
          message:
            `Docker VPN mode does not mount the Docker socket in admin. Run ${commands.manualLogin} on the Docker host. ` +
            `The noVNC page is ${commands.noVncUrl}. If this is a VPS, keep x-login running on the VPS, open a second terminal on your local PC, run ${commands.sshTunnel} after replacing <user>@<vps-host> with your SSH login, then open ${commands.noVncUrl} locally.`
        };
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

  app.get("/admin/x-session-alerts/:alertId/snapshot", async (request, reply) => {
    try {
      const { alertId } = xSessionAlertParamSchema.parse(request.params);
      const alert = xSessionAlerts.find(alertId);
      if (!alert) {
        reply.code(404).send({ error: `X session alert not found: ${alertId}` });
        return;
      }
      return await readXSessionAlertSnapshot(alert);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to read X session alert snapshot" });
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

  app.get("/admin/x-browser-accounts/:accountId/session", async (request, reply) => {
    const { accountId } = xBrowserAccountParamSchema.parse(request.params);
    const account = xBrowserAccounts.findById(accountId);
    if (!account) {
      reply.code(404).send({ error: "Unknown X browser account" });
      return;
    }
    if (!account.storageStateExists) {
      reply.code(404).send({ error: "No X browser session file exists for this account." });
      return;
    }

    const storageStatePath = path.resolve(process.cwd(), account.storageStatePath);
    try {
      const content = await fs.readFile(storageStatePath, "utf8");
      reply
        .header("content-disposition", `attachment; filename="${xBrowserSessionFilename(account)}"`)
        .type("application/json; charset=utf-8")
        .send(content);
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : "Unable to read X browser session file" });
    }
  });

  app.post("/admin/x-browser-accounts/:accountId/session", async (request, reply) => {
    try {
      const { accountId } = xBrowserAccountParamSchema.parse(request.params);
      const body = xBrowserSessionImportSchema.parse(request.body ?? {});
      const account = xBrowserAccounts.findById(accountId);
      if (!account) {
        reply.code(404).send({ error: "Unknown X browser account" });
        return;
      }

      const storageState = parseImportedXBrowserStorageState(body.content);
      const storageStatePath = path.resolve(process.cwd(), account.storageStatePath);
      const relativeStorageStatePath = path.relative(process.cwd(), storageStatePath);
      if (relativeStorageStatePath.startsWith("..") || path.isAbsolute(relativeStorageStatePath)) {
        reply.code(400).send({ error: "X browser session path must stay inside the RedqueenX project." });
        return;
      }

      await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
      await fs.writeFile(storageStatePath, `${JSON.stringify(storageState, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.chmod(storageStatePath, 0o600).catch(() => undefined);
      const updatedAccount = xBrowserAccounts.markLogin(account.id, null);
      await recordSession("info", "x_browser_account.session_imported", "X browser session imported by admin", {
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        storageStatePath: account.storageStatePath,
        filename: body.filename ? path.basename(body.filename) : null,
        cookieCount: storageState.cookies.length
      });
      return {
        account: updatedAccount,
        imported: true,
        cookieCount: storageState.cookies.length,
        filename: body.filename ? path.basename(body.filename) : null
      };
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to import X browser session" });
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
        limit: z.coerce.number().int().positive().max(5_000).default(200),
        level: z.enum(currentSessionLevels).default("debug"),
        includeAdminPolling: booleanQuerySchema,
        includeTweetContent: booleanQuerySchema,
        includeTweetScore: booleanQuerySchema,
        includeTweetFavoriteCount: booleanQuerySchema,
        includeTweetRetweetCount: booleanQuerySchema
      })
      .parse(request.query);
    const staleKeywordUserPrune = await staleKeywordUserPruneStatusFresh();
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
      staleKeywordUserPrune,
      runtimeModes: {
        adminAuthMode,
        adminPublicUrl: adminPublicUrl || null,
        xApiEnabled: getXApiConfig().xApiEnabled,
        searchWithoutApiEnabled: getXApiConfig().searchWithoutApiEnabled
      }
    };
  });

  app.get("/admin/session/keywords", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(5_000).default(1_000) }).parse(request.query);
    const currentRun = runs.current();
    const run = currentRun ?? runs.latest();
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
      run: { id: run.id, status: run.status, isCurrent: currentRun?.id === run.id },
      keywords,
      total: stats.totalKeywords,
      loaded: keywords.length,
      completedKeywords: stats.completedKeywords,
      currentKeyword: stats.currentKeyword,
      chain: runChainSummaryFromStats(stats)
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
    const storedConfig = settings.getServerAccessConfig(DEFAULT_SERVER_ACCESS_CONFIG);
    const config = getEffectiveServerAccessConfig(storedConfig);
    const currentIp = isServerAccessAllowed(config, request.ip).ip ?? request.ip;
    return {
      config,
      storedConfig,
      envConfig: serverAccessEnvConfig,
      currentIp,
      disabled: usesProxyClientCertificateAuth,
      disabledReason: usesProxyClientCertificateAuth
        ? "Client certificate authentication is active at the reverse proxy, so app-level IPv4 lists are ignored."
        : null
    };
  });

  app.patch("/admin/settings/server-access", async (request, reply) => {
    if (usesProxyClientCertificateAuth) {
      reply.code(409).send({
        error: "Server access lists are disabled while client certificate authentication is active."
      });
      return;
    }
    const body = serverAccessUpdateSchema.parse(request.body ?? {});
    let nextStoredConfig = serverAccessConfigSchema.parse({
      whitelist: parseAccessListInput(body.whitelist),
      blacklist: parseAccessListInput(body.blacklist)
    });
    let nextConfig = getEffectiveServerAccessConfig(nextStoredConfig);
    let currentDecision = isServerAccessAllowed(nextConfig, request.ip);
    if (currentDecision.reason === "not_whitelisted" && currentDecision.ip) {
      nextStoredConfig = {
        ...nextStoredConfig,
        whitelist: Array.from(new Set([...nextStoredConfig.whitelist, currentDecision.ip]))
      };
      nextConfig = getEffectiveServerAccessConfig(nextStoredConfig);
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

    const storedConfig = settings.updateServerAccessConfig(nextStoredConfig, DEFAULT_SERVER_ACCESS_CONFIG);
    const config = getEffectiveServerAccessConfig(storedConfig);
    await recordSession("info", "settings.server_access.updated", "RedqueenX access settings updated", {
      whitelist: config.whitelist.length,
      blacklist: config.blacklist.length,
      appliedImmediately: true
    });
    return { config, storedConfig, envConfig: serverAccessEnvConfig, currentIp: currentDecision.ip ?? request.ip };
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
      values: redactEnvValues(xApiConfigToEnvValues(config)),
      redactedKeys: Array.from(envSecretKeys)
    };
  });

  app.patch("/admin/settings/x-api", async (request, reply) => {
    const body = xApiUpdateSchema.parse(request.body ?? {});
    const previousConfig = getXApiConfig();
    const requestedConfig = xApiEnvValuesToConfig(body.values, previousConfig);
    if (
      requestedConfig.searchWithoutApiIsolation === "docker_vpn" &&
      previousConfig.searchWithoutApiIsolation !== "docker_vpn"
    ) {
      const legacyNetnsCheck = await checkLegacyNetnsHostVeth();
      if (legacyNetnsCheck.present) {
        await recordSession(
          "prob",
          "docker_vpn.legacy_host_netns_present",
          `Docker VPN isolation blocked because ${legacyNetnsHostVethName} still exists`,
          {
            previousIsolation: previousConfig.searchWithoutApiIsolation,
            requestedIsolation: "docker_vpn",
            legacyNetns: legacyNetnsCheck
          }
        );
        return reply.code(409).send({
          error: `Cannot switch to Docker VPN isolation while legacy host netns interface ${legacyNetnsHostVethName} still exists. Tear down the old host namespace first, then retry.`,
          legacyNetns: legacyNetnsCheck
        });
      }
      if (!legacyNetnsCheck.checked) {
        await recordSession(
          "prob",
          "docker_vpn.legacy_host_netns_check_failed",
          `Could not verify whether ${legacyNetnsHostVethName} still exists before switching to Docker VPN isolation`,
          {
            previousIsolation: previousConfig.searchWithoutApiIsolation,
            requestedIsolation: "docker_vpn",
            legacyNetns: legacyNetnsCheck
          }
        );
      }
    }
    const config = settings.updateXApiConfig(requestedConfig, previousConfig);
    const values = xApiConfigToEnvValues(config);
    await env.update(values);
    const withoutApiRunReplan = replanFreshWithoutApiRunForConfigChange(previousConfig, config);
    if (!config.xApiEnabled) {
      stopActiveRunBecauseXDisabled(config);
    }
    const xApiModeShutdown = await shutdownWithoutApiNetworkingForXApiMode(previousConfig, config);
    const changedVpnKeys = changedOpenVpnConfigKeys(previousConfig, config);
    const openVpnStop =
      xApiModeShutdown.openVpn.stop.requested || xApiModeShutdown.openVpn.stop.reason !== "x_api_mode_not_entered"
        ? xApiModeShutdown.openVpn.stop
        : await requestOpenVpnStopForConfigChange(changedVpnKeys);
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
      withoutApiRunReplanned: withoutApiRunReplan.replanned,
      withoutApiRunReplanReason: withoutApiRunReplan.reason,
      openVpnSettingsChanged: changedVpnKeys.length > 0,
      xApiModeShutdownRequested: xApiModeShutdown.requested
    });
    return {
      config,
      values: redactEnvValues(values),
      redactedKeys: Array.from(envSecretKeys),
      restartRequired: false,
      withoutApiRunReplan,
      xApiModeShutdown,
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

  app.post("/admin/settings/search-terms-used/reset", async () => {
    const deleted = lists.markDeletedAll("search_terms_used");
    await recordSession("info", "settings.search_terms_used.reset", "SearchTerms.Used list reset", { deleted });
    return { deleted };
  });

  app.get("/admin/keyword-users/prune-stale/current", async () => staleKeywordUserPruneStatusFresh());

  app.post("/admin/keyword-users/prune-stale/speed", async (request, reply) => {
    const body = staleKeywordUserPruneSpeedSchema.parse(request.body ?? {});
    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    const status = staleKeywordUserPruneStatus();
    const job = staleKeywordUserPruneJob;
    if (!job || !status.running) {
      reply.code(404).send({ error: "No running stale keyword user pruning job.", job: status });
      return;
    }
    const actionDelayMinSeconds = Math.max(0, Math.floor(body.actionDelayMinSeconds));
    const actionDelayMaxSeconds = Math.max(actionDelayMinSeconds, Math.floor(body.actionDelayMaxSeconds));
    const previousActionDelayMinSeconds = job.actionDelayMinSeconds;
    const previousActionDelayMaxSeconds = job.actionDelayMaxSeconds;
    const speedUpdate = updateStaleKeywordUserPruneSpeed(job, actionDelayMinSeconds, actionDelayMaxSeconds);
    await recordSession("info", "keyword_user_prune.speed_changed", "Stale keyword user pruning execution speed updated from admin", {
      jobId: job.id,
      mode: job.mode,
      previousActionDelayMinSeconds,
      previousActionDelayMaxSeconds,
      actionDelayMinSeconds,
      actionDelayMaxSeconds,
      controlPath: speedUpdate.controlPath,
      updatedRequestPaths: speedUpdate.updatedRequestPaths,
      reportUpdated: speedUpdate.reportUpdated
    });
    return {
      appliedImmediately: true,
      job: staleKeywordUserPruneStatus()
    };
  });

  app.post("/admin/keyword-users/prune-stale/stop", async (_request, reply) => {
    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    const status = staleKeywordUserPruneStatus();
    const job = staleKeywordUserPruneJob;
    if (!job || (!status.running && !job.autoRestartAt)) {
      reply.code(404).send({ error: "No running stale keyword user pruning job.", job: status });
      return;
    }
    if (!status.running && job.autoRestartAt) {
      clearStaleKeywordUserPruneAutoRestart(job);
      const stoppedAt = new Date().toISOString();
      const existingReport = readStaleKeywordUserPruneReport(job.id);
      const stoppedReport = stoppedStaleKeywordUserPruneReport(job, existingReport, stoppedAt, "admin_stop_auto_restart");
      writeStaleKeywordUserPruneReport(stoppedReport);
      job.status = "stopped";
      job.completedAt = stoppedAt;
      job.error = stoppedReport.error;
      job.blockedByAlertId = null;
      await recordSession("prob", "keyword_user_prune.auto_restart_cancelled", "Stale keyword user pruning auto-restart cancelled from admin", {
        jobId: job.id
      });
      return { stop: { autoRestartCancelled: true, childPid: null, removedQueuedRequest: false }, job: staleKeywordUserPruneStatus() };
    }
    const stop = stopStaleKeywordUserPruneJob(job, "admin_stop");
    await recordSession("prob", "keyword_user_prune.stop_requested", "Stale keyword user pruning stop requested from admin", {
      jobId: job.id,
      stopPath: stop.stopPath,
      removedQueuedRequest: stop.removedQueuedRequest,
      childPid: stop.childPid
    });
    return { stop, job: staleKeywordUserPruneStatus() };
  });

  app.post("/admin/keyword-users/prune-stale/progress/reset", async (_request, reply) => {
    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    const status = staleKeywordUserPruneStatus();
    if (staleKeywordUserPruneStartInProgress || status.running) {
      reply.code(409).send({
        error: "Stop the inactive users check before resetting progress.",
        job: status
      });
      return;
    }

    const previousStartIndex = getXApiConfig().staleKeywordUserStartIndex;
    const reset = resetStaleKeywordUserPruneProgress();
    settings.patchXApiConfig({ staleKeywordUserStartIndex: 1 });
    let envSynced = true;
    let envError: string | null = null;
    try {
      await env.update({ STALE_KEYWORD_USER_START_INDEX: "1" });
    } catch (error) {
      envSynced = false;
      envError = error instanceof Error ? error.message : String(error);
    }
    await recordSession("prob", "keyword_user_prune.progress_reset", "Stale keyword user pruning progress reset from admin", {
      previousStartIndex,
      nextStartIndex: 1,
      clearedJobId: reset.clearedJobId,
      autoRestartCancelled: reset.autoRestartCancelled,
      deletedFiles: reset.deletedFiles.length,
      envSynced,
      envError
    });
    return {
      reset,
      envSynced,
      envError,
      values: xApiConfigToEnvValues(getXApiConfig()),
      status: staleKeywordUserPruneStatus()
    };
  });

  app.post("/admin/keyword-users/prune-stale", async (request, reply) => {
    const body = staleKeywordUserPruneSchema.parse(request.body ?? {});
    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    const currentStatus = staleKeywordUserPruneStatus();
    if (staleKeywordUserPruneStartInProgress || currentStatus.running) {
      reply.code(409).send({ error: "A stale keyword user pruning job is already running.", job: currentStatus });
      return;
    }
    staleKeywordUserPruneStartInProgress = true;
    try {
      const started = await startStaleKeywordUserPruneFromAdmin({
        maxAgeDays: body.maxAgeDays,
        actionDelayMinSeconds: body.actionDelayMinSeconds,
        actionDelayMaxSeconds: body.actionDelayMaxSeconds,
        autoIgnoreAlert: body.autoIgnoreAlert,
        maxRetries: body.maxRetries,
        autoRestartDelaySeconds: body.autoRestartDelaySeconds,
        startIndex: body.startIndex,
        skipStartInProgressCheck: true
      });
      if (!started.ok) {
        reply.code(started.code).send(started.payload);
        return;
      }
      const { job, startCheck, resumedPreviousFailedJob } = started;
      await recordSession("info", "keyword_user_prune.job_started", "Stale keyword user pruning job started from admin", {
        jobId: job.id,
        mode: job.mode,
        maxAgeDays: job.maxAgeDays,
        actionDelayMinSeconds: job.actionDelayMinSeconds,
        actionDelayMaxSeconds: job.actionDelayMaxSeconds,
        autoIgnoreAlert: job.autoIgnoreAlert,
        maxRetries: job.maxRetries,
        autoRestartDelaySeconds: job.autoRestartDelaySeconds,
        startIndex: job.startIndex,
        resumeStatePath: job.resumeStatePath,
        resumedPreviousFailedJob,
        stoppedRun: job.stoppedRun,
        accountId: startCheck?.ok ? startCheck.account.id : null,
        xIdentifier: startCheck?.ok ? startCheck.account.xIdentifier : null
      });
      reply.code(202).send({ job: staleKeywordUserPruneStatus() });
    } finally {
      staleKeywordUserPruneStartInProgress = false;
    }
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
    values: redactEnvValues({
      ...(await env.read()),
      ...xApiConfigToEnvValues(getXApiConfig())
    }),
    redactedKeys: Array.from(envSecretKeys)
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
      values: redactEnvValues(values),
      redactedKeys: Array.from(envSecretKeys),
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
    const result =
      body.kind === "timeline_tweets"
        ? importTimelineTweetContent(body.filename, body.content)
        : importer.importContent(body.filename, body.kind, body.content);
    await recordSession("info", body.kind === "timeline_tweets" ? "import.timeline" : "import.content", body.kind === "timeline_tweets" ? "Timeline tweets imported into SQLite" : "Local file imported into SQLite", {
      filename: body.filename,
      kind: body.kind,
      importedLines: result.files.reduce((sum, file) => sum + file.importedLines, 0)
    });
    return result;
  });

  app.post("/admin/lists/maintenance/cleanup", async () => {
    const result = lists.cleanupActiveInconsistencies();
    await recordSession("info", "list.cleanup", "List duplicates and inconsistencies cleaned", { ...result });
    return result;
  });

  app.get("/admin/lists/search", async (request) => {
    const query = listSearchQuerySchema.parse(request.query);
    return lists.searchEditableLists(query.q, {
      limitPerKind: query.limit,
      includeDeleted: query.includeDeleted
    });
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

  app.get("/admin/lists/:kind/export", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const exported = exportListContent(kind);
    await recordSession("info", "list.export", "List downloaded from admin", {
      kind,
      filename: exported.filename,
      lines: exported.lineCount
    });
    reply
      .header("content-disposition", `attachment; filename="${exported.filename}"`)
      .type(`${exported.contentType}; charset=utf-8`)
      .send(exported.body);
  });

  app.post("/admin/lists/stale_keyword_user/:id/restore-keyword", async (request, reply) => {
    const entryId = getEntryIdParam(request.params);
    const staleEntry = lists.getById("stale_keyword_user", entryId);
    if (!staleEntry) {
      reply.code(404).send({ error: "Stale keyword user entry not found" });
      return;
    }

    const keywordEntry = lists.add(
      "keyword",
      staleEntry.rawValue,
      "runtime:stale-keyword-user-restore",
      null,
      new Date().toISOString()
    );
    const deleted = lists.markDeletedById("stale_keyword_user", entryId);
    const deletedSkipped = lists.markDeleted("skipped_keyword_user", staleEntry.rawValue);
    await recordSession("info", "keyword_user.restore", "Stale keyword user restored into keywords", {
      staleEntryId: entryId,
      keywordEntryId: keywordEntry.id,
      user: staleEntry.rawValue,
      deletedFromStaleList: deleted,
      deletedFromSkippedList: deletedSkipped
    });
    return { entry: keywordEntry, deletedFromStaleList: deleted, deletedFromSkippedList: deletedSkipped };
  });

  app.post("/admin/lists/skipped_keyword_user/:id/move-to-stale", async (request, reply) => {
    const entryId = getEntryIdParam(request.params);
    const skippedEntry = lists.getById("skipped_keyword_user", entryId);
    if (!skippedEntry) {
      reply.code(404).send({ error: "Skipped keyword user entry not found" });
      return;
    }

    const staleEntry = lists.add(
      "stale_keyword_user",
      skippedEntry.rawValue,
      "runtime:skipped-keyword-user-to-stale",
      null,
      new Date().toISOString()
    );
    const deletedFromKeywords = lists.markDeleted("keyword", skippedEntry.rawValue);
    const deletedFromSkippedList = lists.markDeletedById("skipped_keyword_user", entryId);
    await recordSession("info", "keyword_user.skipped_to_stale", "Skipped keyword user moved into stale keyword users", {
      skippedEntryId: entryId,
      staleEntryId: staleEntry.id,
      user: skippedEntry.rawValue,
      deletedFromKeywords,
      deletedFromSkippedList
    });
    return { entry: staleEntry, deletedFromKeywords, deletedFromSkippedList };
  });

  app.post("/admin/lists/suggested_keyword/:id/promote-keyword", async (request, reply) => {
    const entryId = getEntryIdParam(request.params);
    const suggestedEntry = lists.getById("suggested_keyword", entryId);
    if (!suggestedEntry) {
      reply.code(404).send({ error: "Suggested keyword entry not found" });
      return;
    }

    const promotedAt = new Date().toISOString();
    const keywordEntry = lists.add("keyword", suggestedEntry.rawValue, "runtime:suggested-keyword-promote", null, promotedAt);
    const deletedFromSuggestedList = lists.markDeletedById("suggested_keyword", entryId);
    await recordSession("info", "suggested_keyword.promote", "Suggested keyword promoted into keywords", {
      suggestedEntryId: entryId,
      keywordEntryId: keywordEntry.id,
      keyword: suggestedEntry.rawValue,
      deletedFromSuggestedList
    });
    return { entry: keywordEntry, deletedFromSuggestedList };
  });

  app.post("/admin/lists/suggested_keyword/promote-all", async () => {
    const suggestions = lists.list("suggested_keyword");
    const promotedAt = new Date().toISOString();
    let promoted = 0;
    let deletedFromSuggestedList = 0;
    for (const suggestion of suggestions) {
      lists.add("keyword", suggestion.rawValue, "runtime:suggested-keyword-promote", null, promotedAt);
      deletedFromSuggestedList += lists.markDeletedById("suggested_keyword", suggestion.id);
      promoted += 1;
    }
    await recordSession("info", "suggested_keyword.promote_all", "Suggested keywords promoted into keywords", {
      promoted,
      deletedFromSuggestedList
    });
    return { promoted, deletedFromSuggestedList };
  });

  app.post("/admin/lists/:kind", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const body = listMutationSchema.parse(request.body);
    return addListEntry(kind, body.value, "admin");
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
      const removedKeywords = removeKeywordMatchingBannedWord(kind, body.value);
      await recordSession("info", "list.update", "List entry updated", { kind, entryId: entry.id, removedKeywords });
      return { entry, removedKeywords };
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
    return deleteListEntry(kind, body.value, "admin");
  });

  app.delete("/admin/lists/:kind/all", async (request, reply) => {
    const kind = getKindParam(request.params);
    if (!kind) {
      reply.code(404).send({ error: "Unknown list kind" });
      return;
    }
    const deleted = lists.markDeletedAll(kind);
    await recordSession("info", "list.delete_all", "All active list entries deleted", { kind, deleted });
    return { kind, deleted };
  });

  app.post("/timeline/lists/:kind", async (request, reply) => {
    const kind = getTimelineListKindParam(request.params, Boolean(readAdminAuth(request)));
    if (!kind) {
      reply.code(404).send({ error: "Unknown timeline list action" });
      return;
    }
    const body = listMutationSchema.parse(request.body);
    return addListEntry(kind, body.value, "timeline");
  });

  app.delete("/timeline/lists/:kind", async (request, reply) => {
    const kind = getTimelineListKindParam(request.params, Boolean(readAdminAuth(request)));
    if (!kind) {
      reply.code(404).send({ error: "Unknown timeline list action" });
      return;
    }
    const body = listMutationSchema.parse(request.body);
    return deleteListEntry(kind, body.value, "timeline");
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

  function removeKeywordMatchingBannedWord(kind: string, value: string): number {
    if (kind !== "banned_word") {
      return 0;
    }
    return lists.markDeleted("keyword", value);
  }

  async function addListEntry(kind: ListKind, value: string, actor: "admin" | "timeline") {
    const entry = lists.add(kind, value);
    const removedKeywords = removeKeywordMatchingBannedWord(kind, value);
    await recordSession("info", "list.add", "List entry added", { kind, entryId: entry.id, removedKeywords, actor });
    return { entry, removedKeywords };
  }

  async function deleteListEntry(kind: ListKind, value: string, actor: "admin" | "timeline") {
    const deleted = lists.markDeleted(kind, value);
    await recordSession("info", "list.delete", "List entries deleted", { kind, deleted, actor });
    return { deleted };
  }

  async function acceptRejectedTimelineTweet(
    runId: string,
    tweetId: string,
    reply: FastifyReply,
    actor: "admin" | "timeline"
  ) {
    const rawTweet = rawTimelineTweets.find(runId, tweetId);
    if (!rawTweet) {
      reply.code(404).send({ error: "Rejected timeline tweet not found." });
      return;
    }
    if (rawTweet.decisionStatus !== "rejected") {
      reply.code(409).send({ error: "Only rejected timeline tweets can be accepted manually." });
      return;
    }

    options.database.transaction(() => {
      timelineTweets.saveAcceptedManual({
        keyword: rawTweet.keyword,
        text: rawTweet.text,
        tweetId: rawTweet.tweetId,
        author: rawTweet.author,
        authorName: rawTweet.authorName,
        tweetUrl: rawTweet.tweetUrl,
        tweetCreatedAt: rawTweet.tweetCreatedAt,
        retweetCount: rawTweet.retweetCount,
        favoriteCount: rawTweet.favoriteCount,
        score: rawTweet.score,
        reasons: ["manual_accept_from_rejected_timeline"]
      });
      rawTimelineTweets.markAccepted(runId, tweetId);
    })();

    await recordSession("info", "rejected_timeline.accepted", "Rejected timeline tweet accepted manually", {
      runId,
      tweetId,
      keyword: rawTweet.keyword,
      previousReasons: rawTweet.rejectionReasons,
      score: rawTweet.score ?? 0,
      actor
    });
    return {
      ok: true,
      tweetId: rawTweet.tweetId,
      runId: rawTweet.runId
    };
  }

  app.post("/admin/runs", async (_request, reply) => {
    const runtimeConfig = getXApiConfig();
    if (runtimeConfig.searchWithoutApiEnabled) {
      const keywordChain = plannedKeywordChain(lists, runtimeConfig);
      const keywords = keywordChain.keywords;
      const availability = keywordAvailability(lists);
      if (keywords.length === 0) {
        await sendNoEligibleKeywordsStartBlocked(reply, "without_api", availability, runtimeConfig);
        return;
      }

      const blocked = await prepareWithoutApiRunStart(reply);
      if (!blocked.ok) return;

      const existing = runs.current();
      if (existing) {
        await stopRunForFreshStart(existing, "without_api");
      }

      const run = runs.start(createInitialRunStats(lists, runtimeConfig, keywords, keywordChain.chain, keywordChain.futureBatches));
      runs.replaceKeywords(run.id, keywords);
      await recordSession("info", "run.started", "Fresh run started from start action", {
        runId: run.id,
        status: run.status,
        mode: "without_api",
        plannedKeywords: keywords.length,
        ...keywordAvailabilityLogData(availability),
        accountId: blocked.account.id,
        xIdentifier: blocked.account.xIdentifier,
        vpnProfilePath: runtimeConfig.vpnConfig
      });
      await startWithoutApiExecution(run);
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

    const keywordChain = plannedKeywordChain(lists, runtimeConfig);
    const keywords = keywordChain.keywords;
    const availability = keywordAvailability(lists);
    if (keywords.length === 0) {
      await sendNoEligibleKeywordsStartBlocked(reply, "x_api", availability, runtimeConfig);
      return;
    }

    const run = runs.start(createInitialRunStats(lists, runtimeConfig, keywords, keywordChain.chain, keywordChain.futureBatches));
    runs.replaceKeywords(run.id, keywords);
    await recordSession("info", "run.started", "Fresh run started from start action", {
      runId: run.id,
      status: run.status,
      plannedKeywords: keywords.length,
      ...keywordAvailabilityLogData(availability),
      searchPacingApplied: true
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
    const rssFallback = run.status !== "paused" ? await runRssFallback(paused.id, "manual_pause") : null;
    return { run: paused, rssFallback };
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
      await startWithoutApiExecution(resumed);
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
    if (isWithoutApiRun(run)) {
      clearWithoutApiAlertAutoRestart();
    }
    const stopped = runs.stop(run.id);
    stopWithoutApiWorker("admin_stop");
    await recordSession("info", "run.stopped", "Run stopped", { runId: stopped.id, status: stopped.status });
    return { run: stopped };
  });

  app.post("/admin/runs/:id/pause", async (request, reply) => {
    try {
      const id = getIdParam(request.params);
      clearApiResumeTimer(id);
      const existing = runs.get(id);
      const run = runs.pause(id);
      await recordSession("info", "run.paused", "Run paused", { runId: run.id, status: run.status });
      const rssFallback = existing?.status !== "paused" ? await runRssFallback(run.id, "manual_pause") : null;
      return { run, rssFallback };
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
        await startWithoutApiExecution(run);
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
      const existing = runs.get(id);
      if (existing && isWithoutApiRun(existing)) {
        clearWithoutApiAlertAutoRestart();
      }
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

  function exportListContent(kind: (typeof LIST_KINDS)[number]): {
    filename: string;
    contentType: string;
    body: string;
    lineCount: number;
  } {
    const values = lists.activeValues(kind);
    const body = values.length > 0 ? `${values.join("\n")}\n` : "";
    return {
      filename: listExportFilename(kind),
      contentType: "text/plain",
      body,
      lineCount: values.length
    };
  }

  function exportTimelineTweetsContent(): {
    filename: string;
    contentType: string;
    body: string;
    lineCount: number;
  } {
    const records = timelineTweets.exportAll();
    const body = records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
    return {
      filename: "Timeline.Tweets.jsonl",
      contentType: "application/x-ndjson; charset=utf-8",
      body,
      lineCount: records.length
    };
  }

  function importTimelineTweetContent(filename: string, content: string) {
    const importedAt = new Date().toISOString();
    const records = parseTimelineTweetImportContent(content);
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    const importedLines = timelineTweets.importExportRecords(records);
    return {
      dataDir: "uploaded",
      importedAt,
      files: [
        {
          filename,
          sourceFile: `uploaded:${filename}`,
          kind: "timeline_tweets",
          optional: false,
          status: "imported",
          sha256,
          totalLines: records.length,
          importedLines
        }
      ]
    };
  }

  function parseTimelineTweetImportContent(content: string): TimelineTweetExportRecord[] {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    const rawItems = trimmed.startsWith("[")
      ? (JSON.parse(trimmed) as unknown[])
      : trimmed
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown);

    if (!Array.isArray(rawItems)) {
      throw new Error("Timeline import file must contain a JSON array or JSON Lines objects.");
    }

    return rawItems.map((item, index) => parseTimelineTweetImportRecord(item, index));
  }

  function parseTimelineTweetImportRecord(value: unknown, index: number): TimelineTweetExportRecord {
    const record = z
      .object({
        schemaVersion: z.literal(1).optional(),
        source: z.enum(["tweet", "from test"]).default("tweet"),
        keyword: z.string().trim().min(1).optional().nullable(),
        text: z.string(),
        tweetId: z.string().min(1),
        author: z.string().optional().nullable(),
        authorName: z.string().optional().nullable(),
        avatarUrl: z.string().optional().nullable(),
        tweetUrl: z.string().optional(),
        tweetCreatedAt: z.string().optional().nullable(),
        retweetCount: z.coerce.number().default(0),
        favoriteCount: z.coerce.number().default(0),
        score: z.coerce.number().default(0),
        reasons: z.array(z.string()).default([]),
        media: z.array(z.any()).default([]),
        urls: z.array(z.string()).default([]),
        likedAt: z.string().optional().nullable(),
        retweetedAt: z.string().optional().nullable(),
        acceptedAt: z.string().optional().nullable()
      })
      .parse(value);

    return {
      schemaVersion: 1,
      source: record.source,
      keyword: record.keyword ?? null,
      text: record.text,
      tweetId: record.tweetId,
      author: record.author ?? null,
      authorName: record.authorName ?? null,
      avatarUrl: record.avatarUrl ?? null,
      tweetUrl: record.tweetUrl || `https://twitter.com/i/web/status/${record.tweetId}`,
      tweetCreatedAt: record.tweetCreatedAt ?? null,
      retweetCount: Number.isFinite(record.retweetCount) ? record.retweetCount : 0,
      favoriteCount: Number.isFinite(record.favoriteCount) ? record.favoriteCount : 0,
      score: Number.isFinite(record.score) ? record.score : 0,
      reasons: record.reasons,
      media: record.media,
      urls: record.urls,
      likedAt: record.likedAt ?? null,
      retweetedAt: record.retweetedAt ?? null,
      acceptedAt: record.acceptedAt ?? new Date(Date.now() + index).toISOString()
    };
  }

  function getDefaultXApiConfig(): XApiRuntimeConfig {
    return xApiConfigSchema.parse({
      xSearchApiCallLimit: options.config.xSearchApiCallLimit,
      xApiEnabled: options.config.xApiEnabled,
      searchWithoutApiEnabled: options.config.searchWithoutApiEnabled,
      searchWithoutApiIsolation: options.config.searchWithoutApiIsolation,
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
      searchWithoutApiUserKeywordPercent: options.config.searchWithoutApiUserKeywordPercent,
      searchWithoutApiAutoIgnoreAlert: options.config.searchWithoutApiAutoIgnoreAlert,
      searchWithoutApiMaxRetries: options.config.searchWithoutApiMaxRetries,
      searchWithoutApiAutoRestartDelaySeconds: options.config.searchWithoutApiAutoRestartDelaySeconds,
      searchWithoutApiRequestsBeforePauseMin: options.config.searchWithoutApiRequestsBeforePauseMin,
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
      timelineDefaultPageSize: options.config.timelineDefaultPageSize,
      runChainCount: options.config.runChainCount,
      staleKeywordUserMaxAgeDays: options.config.staleKeywordUserMaxAgeDays,
      staleKeywordUserStartIndex: options.config.staleKeywordUserStartIndex,
      staleKeywordUserActionDelayMinSeconds: options.config.staleKeywordUserActionDelayMinSeconds,
      staleKeywordUserActionDelayMaxSeconds: options.config.staleKeywordUserActionDelayMaxSeconds,
      staleKeywordUserAutoIgnoreAlert: options.config.staleKeywordUserAutoIgnoreAlert,
      staleKeywordUserMaxRetries: options.config.staleKeywordUserMaxRetries,
      staleKeywordUserAutoRestartDelaySeconds: options.config.staleKeywordUserAutoRestartDelaySeconds,
      rawTimelineEnabled: options.config.rawTimelineEnabled,
      xLoginNovncPort: options.config.xLoginNovncPort,
      xLoginScreen: options.config.xLoginScreen,
      xLoginServiceMaxSeconds: options.config.xLoginServiceMaxSeconds,
      xLoginBrowser: options.config.xLoginBrowser,
      xLoginSaveMode: options.config.xLoginSaveMode,
      xLoginStartUrl: options.config.xLoginStartUrl,
      xLoginReuseBrowserProfile: options.config.xLoginReuseBrowserProfile,
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
      xCostCountCallUsd: options.config.xCostCountCallUsd,
      redditCrawlEnabled: options.config.redditCrawlEnabled,
      redditCrawlUserAgent: options.config.redditCrawlUserAgent,
      redditCrawlSubreddits: options.config.redditCrawlSubreddits,
      redditCrawlLimitPerKeyword: options.config.redditCrawlLimitPerKeyword,
      redditCrawlSort: options.config.redditCrawlSort,
      redditCrawlTimeRange: options.config.redditCrawlTimeRange,
      redditCrawlMinScore: options.config.redditCrawlMinScore
    });
  }

  function getXApiConfig(): XApiRuntimeConfig {
    return settings.getXApiConfig(getDefaultXApiConfig());
  }

  async function handleXApiCreditsDepleted(error: unknown, context: Record<string, unknown> = {}): Promise<boolean> {
    if (!looksLikeXApiCreditsDepleted(error)) {
      return false;
    }
    const previousCreditUsd = getXApiConfig().xApiCreditUsd;
    let settingsError: string | null = null;
    try {
      settings.patchXApiConfig({ xApiCreditUsd: 0 });
    } catch (syncError) {
      settingsError = syncError instanceof Error ? syncError.message : String(syncError);
    }
    let envSynced = true;
    let envError: string | null = null;
    try {
      await env.update({ X_API_CREDIT_USD: "0" });
    } catch (syncError) {
      envSynced = false;
      envError = syncError instanceof Error ? syncError.message : String(syncError);
    }
    await recordSession("prob", "x_api.credits_depleted", xApiCreditsDepletedMessage(), {
      ...context,
      previousCreditUsd,
      xApiCreditUsd: 0,
      settingsError,
      envSynced,
      envError,
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
  }

  function usesDockerVpnIsolation(config = getXApiConfig()): boolean {
    return config.searchWithoutApiIsolation === "docker_vpn";
  }

  function getMediaCache(): MediaCacheService {
    return new MediaCacheService(options.database, getMediaCacheConfigFromRuntime(getXApiConfig()));
  }

  function queueAcceptedTweetMediaCache(tweetId: string, mediaCount: number): void {
    const xApiConfig = getXApiConfig();
    if (!xApiConfig.searchWithoutApiMediaCacheEnabled || mediaCount <= 0) {
      return;
    }
    if (usesDockerVpnIsolation(xApiConfig)) {
      const job = mediaCacheJobs.enqueue(tweetId, "accepted_tweet");
      void recordSession("debug", "media_cache.auto_fetch.queued", "Accepted tweet media cache fetch queued for Docker VPN worker", {
        tweetId,
        jobId: job.id,
        isolation: xApiConfig.searchWithoutApiIsolation
      });
      return;
    }
    mediaCacheFetchQueue = mediaCacheFetchQueue
      .catch(() => undefined)
      .then(() => runMediaCacheFetchProcess(tweetId, xApiConfig));
  }

  async function runMediaCacheFetchProcess(tweetId: string, xApiConfig: XApiRuntimeConfig): Promise<void> {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...xApiConfigToEnvValues(xApiConfig),
      CURRENT_SESSION_FILE: options.currentSessionFilePath ?? options.config.currentSessionFile,
      VPN_NETNS_AUTOSTART: "true"
    };
    const databasePath = databasePathForChild(options.database);
    if (databasePath) {
      childEnv.DATABASE_URL = databasePath;
    }

    await recordSession("debug", "media_cache.auto_fetch.queued", "Accepted tweet media cache fetch queued", {
      tweetId,
      viaVpnNamespace: xApiConfig.vpnNetnsName
    });

    await new Promise<void>((resolve) => {
      const child = spawn("npm", ["run", "netns:media-cache:fetch", "--", "--tweet-id", tweetId], {
        cwd: process.cwd(),
        env: childEnv,
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
        void recordSession("prob", "media_cache.auto_fetch.failed", error.message, { tweetId });
        resolve();
      });
      child.on("close", (code) => {
        void recordSession(code === 0 ? "info" : "prob", code === 0 ? "media_cache.auto_fetch.completed" : "media_cache.auto_fetch.failed", code === 0 ? "Accepted tweet media cache fetch completed" : "Accepted tweet media cache fetch failed", {
          tweetId,
          code,
          stdout: lastOutputLines(stdout, 20),
          stderr: lastOutputLines(stderr, 20)
        });
        resolve();
      });
    });
  }

  function searchWithoutApiPlaceholderStats(xApiConfig = getXApiConfig()) {
    const availability = keywordAvailability(lists);
    return {
      enabled: xApiConfig.searchWithoutApiEnabled,
      isolation: xApiConfig.searchWithoutApiIsolation,
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
      userKeywordPercent: xApiConfig.searchWithoutApiUserKeywordPercent,
      searchedKeywords: availability.searchTermsUsedEntries,
      requestsBeforePauseMin: xApiConfig.searchWithoutApiRequestsBeforePauseMin,
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
    const desiredWindowMinutes = searchPauseWindowMaxMinutesForConfig(xApiConfig);
    if (stats.apiWindowMinutes === desiredWindowMinutes) {
      return run;
    }

    return runs.updateStats(run.id, {
      apiWindowMinutes: desiredWindowMinutes
    });
  }

  function isWithoutApiRun(run: RunRecord): boolean {
    return parseRunStats(run.statsJson).sessionKeywordLimit !== null;
  }

  function replanFreshWithoutApiRunForConfigChange(
    previousConfig: XApiRuntimeConfig,
    config: XApiRuntimeConfig
  ): { replanned: boolean; reason: string; runId?: string; plannedKeywords?: number } {
    if (!config.searchWithoutApiEnabled) {
      return { replanned: false, reason: "without_api_disabled" };
    }
    if (
      previousConfig.searchWithoutApiSessionKeywordLimit === config.searchWithoutApiSessionKeywordLimit &&
      previousConfig.searchWithoutApiSessionKeywordLimitRandom === config.searchWithoutApiSessionKeywordLimitRandom &&
      previousConfig.searchWithoutApiRandomizeKeywordOrder === config.searchWithoutApiRandomizeKeywordOrder &&
      previousConfig.searchWithoutApiUserKeywordPercent === config.searchWithoutApiUserKeywordPercent &&
      previousConfig.searchWithoutApiRequestsBeforePauseMin === config.searchWithoutApiRequestsBeforePauseMin &&
      previousConfig.runChainCount === config.runChainCount
    ) {
      return { replanned: false, reason: "search_pacing_unchanged" };
    }

    const run = runs.current();
    if (!run || !isWithoutApiRun(run)) {
      return { replanned: false, reason: "no_fresh_without_api_run" };
    }

    const stats = parseRunStats(run.statsJson);
    if (stats.completedKeywords > 0 || stats.apiCallsUsed > 0 || stats.currentKeyword) {
      return { replanned: false, reason: "run_already_progressed", runId: run.id };
    }

    const keywordChain = plannedKeywordChain(lists, config);
    const keywords = keywordChain.keywords;
    runs.replaceKeywords(run.id, keywords);
    runs.updateStats(run.id, createInitialRunStats(lists, config, keywords, keywordChain.chain, keywordChain.futureBatches));
    return { replanned: true, reason: "fresh_run_replanned", runId: run.id, plannedKeywords: keywords.length };
  }

  function stopActiveRunBecauseXDisabled(config: XApiRuntimeConfig): void {
    const currentRun = runs.current();
    if (!currentRun) {
      return;
    }
    if (config.searchWithoutApiEnabled && isWithoutApiRun(currentRun)) {
      void recordSession(
        "info",
        "browser.search.x_api_disabled_ignored",
        "X API search disabled from settings; without-API run kept running",
        { runId: currentRun.id }
      );
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
    if (mode === "without_api") {
      clearWithoutApiAlertAutoRestart();
    }
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

  async function sendNoEligibleKeywordsStartBlocked(
    reply: FastifyReply,
    mode: "without_api" | "x_api",
    availability: ReturnType<typeof keywordAvailability>,
    runtimeConfig: XApiRuntimeConfig
  ): Promise<void> {
    await recordSession(
      "prob",
      "run.no_eligible_keywords",
      "No eligible keyword remains. Active keywords are already in SearchTerms.Used or No.Result; clear one of those lists to search again.",
      {
        mode,
        ...(mode === "without_api" ? { sessionKeywordLimit: runtimeConfig.searchWithoutApiSessionKeywordLimit } : {}),
        ...keywordAvailabilityLogData(availability)
      }
    );
    reply.code(409).send({
      error:
        "No eligible keyword remains. Active keywords are already in SearchTerms.Used or No.Result; clear SearchTerms.Used to search them again.",
      reason: "no_eligible_keywords",
      availability,
      resetSearchTermsUsedAvailable: availability.excludedBySearchTermsUsed > 0,
      resetSearchTermsUsedEndpoint: "/admin/settings/search-terms-used/reset"
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
    if (isWithoutApiRun(currentRun)) {
      clearWithoutApiAlertAutoRestart();
    }
    runs.updateStats(currentRun.id, { currentKeyword: null });
    const stopped = runs.stop(currentRun.id);
    stopWithoutApiWorker("vpn_shutdown");
    await recordSession("prob", "vpn.shutdown.run_stopped", "Active run stopped before VPN shutdown", {
      runId: stopped.id,
      status: stopped.status
    });
    return stopped;
  }

  async function stopActiveWithoutApiRunForXApiMode(): Promise<RunRecord | null> {
    const currentRun = runs.current();
    if (!currentRun || !isWithoutApiRun(currentRun)) {
      return null;
    }

    clearApiResumeTimer(currentRun.id);
    runs.updateStats(currentRun.id, { currentKeyword: null });
    const stopped = runs.stop(currentRun.id);
    await stopWithoutApiWorkerAndWait("x_api_mode_enabled");
    await recordSession("prob", "x_api_mode.without_api_run_stopped", "Search without API run stopped because X API mode was enabled", {
      runId: stopped.id,
      status: stopped.status
    });
    return stopped;
  }

  function stopWithoutApiStaleKeywordUserPruneForXApiMode(): { stopped: boolean; jobId: string | null; reason: string } {
    const job = staleKeywordUserPruneJob;
    if (!job || job.mode !== "without_api") {
      return { stopped: false, jobId: null, reason: "no_without_api_cleanup" };
    }
    const report = readStaleKeywordUserPruneReport(job.id);
    const status = report?.status ?? job.status;
    if (status !== "running" && !job.autoRestartAt && !job.blockedByAlertId && !report?.blockedByAlertId) {
      return { stopped: false, jobId: job.id, reason: "cleanup_not_active" };
    }
    stopStaleKeywordUserPruneJob(job, "x_api_mode_enabled");
    void recordSession("prob", "x_api_mode.keyword_user_prune_stopped", "Browser-session Keyword users cleanup stopped because X API mode was enabled", {
      jobId: job.id,
      previousStatus: status,
      autoRestartPending: Boolean(job.autoRestartAt),
      blockedByAlertId: report?.blockedByAlertId ?? job.blockedByAlertId
    });
    return { stopped: true, jobId: job.id, reason: "x_api_mode_enabled" };
  }

  async function shutdownWithoutApiNetworkingForXApiMode(
    previousConfig: XApiRuntimeConfig,
    config: XApiRuntimeConfig
  ): Promise<{
    requested: boolean;
    reason: string;
    stoppedRun: boolean;
    stoppedRunId: string | null;
    staleKeywordUserPrune: { stopped: boolean; jobId: string | null; reason: string };
    netnsCommands: { stop: OpenVpnStopResult };
    openVpn: { stop: OpenVpnStopResult };
    namespace: { teardown: NetnsTeardownResult };
  }> {
    const enteredXApiMode = config.xApiEnabled && !config.searchWithoutApiEnabled && (previousConfig.searchWithoutApiEnabled || !previousConfig.xApiEnabled);
    const skippedStop = { requested: false, reason: "x_api_mode_not_entered", pids: [], processGroups: [], stillRunning: [], errors: [] };
    const skippedTeardown = { requested: false, reason: "x_api_mode_not_entered", namespace: config.vpnNetnsName };
    if (!enteredXApiMode) {
      return {
        requested: false,
        reason: "x_api_mode_not_entered",
        stoppedRun: false,
        stoppedRunId: null,
        staleKeywordUserPrune: { stopped: false, jobId: null, reason: "x_api_mode_not_entered" },
        netnsCommands: { stop: skippedStop },
        openVpn: { stop: skippedStop },
        namespace: { teardown: skippedTeardown }
      };
    }

    const stoppedRun = await stopActiveWithoutApiRunForXApiMode();
    const staleKeywordUserPrune = stopWithoutApiStaleKeywordUserPruneForXApiMode();
    const netnsCommandStop = await requestNetnsCommandStop();
    const openVpnStop = await requestOpenVpnStop("x_api_mode_enabled");
    const netnsTeardown = await requestNamespaceTeardownIfPresent(config.vpnNetnsName, openVpnStop);
    await recordSession("prob", "x_api_mode.vpn_shutdown", "X API mode enabled; without-API VPN runtime shutdown requested", {
      stoppedRun: Boolean(stoppedRun),
      stoppedRunId: stoppedRun?.id ?? null,
      staleKeywordUserPrune,
      netnsCommandsStopRequested: netnsCommandStop.requested,
      netnsCommandsStopReason: netnsCommandStop.reason,
      openVpnStopRequested: openVpnStop.requested,
      openVpnStopReason: openVpnStop.reason,
      namespaceTeardownRequested: netnsTeardown.requested,
      namespaceTeardownReason: netnsTeardown.reason
    });
    return {
      requested: true,
      reason: "x_api_mode_enabled",
      stoppedRun: Boolean(stoppedRun),
      stoppedRunId: stoppedRun?.id ?? null,
      staleKeywordUserPrune,
      netnsCommands: { stop: netnsCommandStop },
      openVpn: { stop: openVpnStop },
      namespace: { teardown: netnsTeardown }
    };
  }

  async function stopActiveRunForKeywordUserPrune(): Promise<RunRecord | null> {
    const currentRun = runs.current();
    if (!currentRun) {
      return null;
    }

    clearApiResumeTimer(currentRun.id);
    runs.updateStats(currentRun.id, { currentKeyword: null });
    const stopped = runs.stop(currentRun.id);
    if (isWithoutApiRun(currentRun)) {
      await stopWithoutApiWorkerAndWait("stale_keyword_user_prune");
    }
    await recordSession("prob", "keyword_user_prune.run_stopped", "Active run stopped before stale keyword user pruning", {
      runId: stopped.id,
      status: stopped.status
    });
    return stopped;
  }

  async function startStaleKeywordUserPruneFromAdmin(params: {
    maxAgeDays: number;
    actionDelayMinSeconds?: number;
    actionDelayMaxSeconds?: number;
    autoIgnoreAlert?: boolean;
    maxRetries?: number;
    autoRestartDelaySeconds?: number;
    startIndex?: number;
    modeOverride?: KeywordUserPruneMode;
    restartCount?: number;
    forceResumeStatePath?: string;
    skipStartInProgressCheck?: boolean;
  }): Promise<StartStaleKeywordUserPruneResult> {
    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    const currentStatus = staleKeywordUserPruneStatus();
    if ((!params.skipStartInProgressCheck && staleKeywordUserPruneStartInProgress) || currentStatus.running) {
      return {
        ok: false,
        code: 409,
        reason: "job_running",
        payload: {
          error: "A stale keyword user pruning job is already running.",
          job: currentStatus
        }
      };
    }

    const runtimeConfig = getXApiConfig();
    const mode: KeywordUserPruneMode = params.modeOverride ?? (runtimeConfig.searchWithoutApiEnabled ? "without_api" : "x_api");
    let startCheck: WithoutApiRunStartCheck | null = null;
    if (mode === "without_api") {
      startCheck = await checkWithoutApiRunStart();
      if (!startCheck.ok) {
        return {
          ok: false,
          code: startCheck.code,
          reason: startCheck.reason,
          payload: startCheck.payload
        };
      }
    } else if (!runtimeConfig.xApiEnabled) {
      return {
        ok: false,
        code: 400,
        reason: "x_api_disabled",
        payload: { error: "X API search is disabled." }
      };
    } else if (!options.config.x.bearerToken) {
      return {
        ok: false,
        code: 400,
        reason: "missing_bearer_token",
        payload: { error: "X_BEARER_TOKEN is required to run inactive users check in X API mode." }
      };
    }
    if (mode === "x_api") {
      stopWithoutApiStaleKeywordUserPruneForXApiMode();
    }

    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    const statusAfterStartCheck = staleKeywordUserPruneStatus();
    if (statusAfterStartCheck.running) {
      return {
        ok: false,
        code: 409,
        reason: "job_running",
        payload: {
          error: "A stale keyword user pruning job is already running.",
          job: statusAfterStartCheck
        }
      };
    }

    const stoppedRun = await stopActiveRunForKeywordUserPrune();
    const actionDelayMinSeconds = Math.max(
      0,
      Math.floor(params.actionDelayMinSeconds ?? runtimeConfig.staleKeywordUserActionDelayMinSeconds)
    );
    const actionDelayMaxSeconds = Math.max(
      actionDelayMinSeconds,
      Math.floor(params.actionDelayMaxSeconds ?? runtimeConfig.staleKeywordUserActionDelayMaxSeconds)
    );
    const autoIgnoreAlert = params.autoIgnoreAlert ?? runtimeConfig.staleKeywordUserAutoIgnoreAlert;
    const maxRetries = params.maxRetries ?? runtimeConfig.staleKeywordUserMaxRetries;
    const autoRestartDelaySeconds = Math.max(
      0,
      Math.floor(params.autoRestartDelaySeconds ?? runtimeConfig.staleKeywordUserAutoRestartDelaySeconds)
    );
    const startIndex = params.startIndex ?? runtimeConfig.staleKeywordUserStartIndex;
    const resumeStatePath =
      params.forceResumeStatePath !== undefined
        ? params.forceResumeStatePath
        : startIndex === 1
          ? staleKeywordUserPruneResumeStatePathForStart(params.maxAgeDays)
          : undefined;
    const restartCount = params.restartCount ?? 0;
    const job =
      mode === "without_api" && usesDockerVpnIsolation(runtimeConfig)
        ? queueDockerStaleKeywordUserPruneJob(
            mode,
            params.maxAgeDays,
            actionDelayMinSeconds,
            actionDelayMaxSeconds,
            stoppedRun,
            autoIgnoreAlert,
            maxRetries,
            autoRestartDelaySeconds,
            startIndex,
            restartCount,
            resumeStatePath
          )
        : startStaleKeywordUserPruneJob(
            mode,
            params.maxAgeDays,
            actionDelayMinSeconds,
            actionDelayMaxSeconds,
            runtimeConfig,
            stoppedRun,
            autoIgnoreAlert,
            maxRetries,
            autoRestartDelaySeconds,
            startIndex,
            restartCount,
            resumeStatePath
          );
    return {
      ok: true,
      job,
      startCheck,
      resumedPreviousFailedJob: Boolean(resumeStatePath)
    };
  }

  function startStaleKeywordUserPruneJob(
    mode: KeywordUserPruneMode,
    maxAgeDays: number,
    actionDelayMinSeconds: number,
    actionDelayMaxSeconds: number,
    runtimeConfig: XApiRuntimeConfig,
    stoppedRun: RunRecord | null,
    autoIgnoreAlert: boolean,
    maxRetries: number,
    autoRestartDelaySeconds: number,
    startIndex: number,
    restartCount = 0,
    resumeStatePath?: string
  ): StaleKeywordUserPruneJob {
    const job = createStaleKeywordUserPruneJob(
      mode,
      maxAgeDays,
      actionDelayMinSeconds,
      actionDelayMaxSeconds,
      stoppedRun,
      autoIgnoreAlert,
      maxRetries,
      autoRestartDelaySeconds,
      startIndex,
      restartCount,
      resumeStatePath
    );
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...xApiConfigToEnvValues(runtimeConfig),
      CURRENT_SESSION_FILE: options.currentSessionFilePath ?? options.config.currentSessionFile
    };
    if (mode === "without_api") {
      childEnv.VPN_NETNS_AUTOSTART = "true";
      childEnv.VPN_NETNS_AUTOSTART_DEFAULT = "yes";
    } else {
      delete childEnv.VPN_NETNS_AUTOSTART;
      delete childEnv.VPN_NETNS_AUTOSTART_DEFAULT;
    }
    const databasePath = databasePathForChild(options.database);
    if (databasePath) {
      childEnv.DATABASE_URL = databasePath;
    }

    const child = spawn(
      "npm",
      mode === "without_api"
        ? [
            "run",
            "netns:keyword-users:prune-stale",
            "--",
            "--max-age-days",
            String(maxAgeDays),
            "--job-id",
            job.id,
            "--start-index",
            String(job.startIndex),
            "--action-delay-min-seconds",
            String(job.actionDelayMinSeconds),
            "--action-delay-max-seconds",
            String(job.actionDelayMaxSeconds),
            "--resume-state-path",
            job.resumeStatePath,
            "--mode",
            mode
          ]
        : [
            "run",
            "keyword-users:prune-stale:dev",
            "--",
            "--max-age-days",
            String(maxAgeDays),
            "--job-id",
            job.id,
            "--start-index",
            String(job.startIndex),
            "--action-delay-min-seconds",
            String(job.actionDelayMinSeconds),
            "--action-delay-max-seconds",
            String(job.actionDelayMaxSeconds),
            "--resume-state-path",
            job.resumeStatePath,
            "--mode",
            mode
          ],
      {
        cwd: process.cwd(),
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    job.child = child;
    staleKeywordUserPruneJob = job;

    child.stdout?.on("data", (chunk) => {
      job.stdout += String(chunk);
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        void recordSession("info", "keyword_user_prune.stdout", firstLine(line), { jobId: job.id });
      }
    });
    child.stderr?.on("data", (chunk) => {
      job.stderr += String(chunk);
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        void recordSession("prob", "keyword_user_prune.stderr", firstLine(line), { jobId: job.id });
      }
    });
    child.on("error", (error) => {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = error.message;
      void recordSession("prob", "keyword_user_prune.job_failed", "Stale keyword user pruning job failed to start", {
        jobId: job.id,
        error: error.message
      });
    });
    child.on("close", (code, signal) => {
      job.exitCode = code;
      job.signal = signal;
      job.completedAt = new Date().toISOString();
      job.child = null;
      const report = readStaleKeywordUserPruneReport(job.id);
      job.status = report?.status ?? (code === 0 ? "completed" : "failed");
      if (report?.status === "failed" && report.error) {
        job.error = report.error;
      } else if (report?.status === "stopped") {
        job.error = report.error ?? job.error;
      } else if (code !== 0) {
        job.error = `Worker exited with code ${code ?? "null"}${signal ? ` and signal ${signal}` : ""}.`;
      }
      resetStaleKeywordUserRetryCountAfterProgress(job, report, "job_close");
      void recordSession(
        job.status === "failed" ? "prob" : "info",
        job.status === "stopped" ? "keyword_user_prune.job_stopped" : code === 0 ? "keyword_user_prune.job_completed" : "keyword_user_prune.job_failed",
        job.status === "stopped"
          ? "Stale keyword user pruning job stopped"
          : code === 0
            ? "Stale keyword user pruning job completed"
            : "Stale keyword user pruning job failed",
        {
          jobId: job.id,
          mode: job.mode,
          status: job.status,
          code,
          signal,
          reportPath: job.reportPath,
          removedUsers: report?.removedUsers.length ?? null,
          keptUsers: report?.keptUsers.length ?? null,
          skippedUsers: report?.skippedUsers.length ?? null,
          error: job.error
        }
      );
      void handleStaleKeywordUserPruneAlertStop(job, report);
    });

    return job;
  }

  function stopStaleKeywordUserPruneJob(
    job: StaleKeywordUserPruneJob,
    reason: string
  ): { stopPath: string; removedQueuedRequest: boolean; childPid: number | null } {
    clearStaleKeywordUserPruneAutoRestart(job);
    const stoppedAt = new Date().toISOString();
    const stopPath = staleKeywordUserPruneStopPath(job.id);
    fsSync.mkdirSync(path.dirname(stopPath), { recursive: true });
    fsSync.writeFileSync(stopPath, `${JSON.stringify({ jobId: job.id, reason, requestedAt: stoppedAt }, null, 2)}\n`, "utf8");

    let removedQueuedRequest = false;
    try {
      fsSync.unlinkSync(staleKeywordUserPruneRequestPath(job.id));
      removedQueuedRequest = true;
    } catch {
      removedQueuedRequest = false;
    }

    const childPid = job.child?.pid ?? null;
    if (job.child && job.child.exitCode === null) {
      job.child.kill("SIGTERM");
    }

    const existingReport = readStaleKeywordUserPruneReport(job.id);
    const stoppedReport = stoppedStaleKeywordUserPruneReport(job, existingReport, stoppedAt, reason);
    writeStaleKeywordUserPruneReport(stoppedReport);
    job.status = "stopped";
    job.completedAt = stoppedAt;
    job.error = stoppedReport.error;
    job.blockedByAlertId = null;
    return { stopPath, removedQueuedRequest, childPid };
  }

  function resetStaleKeywordUserPruneProgress(): {
    clearedJobId: string | null;
    autoRestartCancelled: boolean;
    deletedFiles: string[];
  } {
    const job = staleKeywordUserPruneJob;
    let autoRestartCancelled = false;
    if (job?.autoRestartAt) {
      clearStaleKeywordUserPruneAutoRestart(job);
      autoRestartCancelled = true;
    }

    const deletedFiles: string[] = [];
    const deleteFile = (filePath: string | null | undefined) => {
      if (!filePath) {
        return;
      }
      try {
        const stat = fsSync.statSync(filePath);
        if (!stat.isFile()) {
          return;
        }
        fsSync.unlinkSync(filePath);
        deletedFiles.push(filePath);
      } catch {
        return;
      }
    };
    const deleteMatchingFiles = (dir: string, matcher: RegExp) => {
      let filenames: string[];
      try {
        filenames = fsSync.readdirSync(dir);
      } catch {
        return;
      }
      for (const filename of filenames) {
        if (matcher.test(filename)) {
          deleteFile(path.join(dir, filename));
        }
      }
    };

    deleteFile(job?.reportPath);
    deleteFile(job?.resumeStatePath);
    if (job) {
      deleteFile(staleKeywordUserPruneRequestPath(job.id));
      deleteFile(staleKeywordUserPruneRunningRequestPath(job.id));
      deleteFile(staleKeywordUserPruneControlPath(job.id));
      deleteFile(staleKeywordUserPruneStopPath(job.id));
    }

    const runtimeDir = path.join(process.cwd(), "runtime");
    deleteMatchingFiles(runtimeDir, /^stale-keyword-user-prune-(?:resume-)?stale-users-.+\.json$/);
    deleteMatchingFiles(staleKeywordUserPruneRequestDir(), /^stale-users-.+\.(?:json|running)$/);
    deleteMatchingFiles(path.join(runtimeDir, "stale-keyword-user-prune-controls"), /^stale-users-.+\.json$/);
    deleteMatchingFiles(path.join(runtimeDir, "stale-keyword-user-prune-stops"), /^stale-users-.+\.stop$/);

    const clearedJobId = job?.id ?? null;
    staleKeywordUserPruneJob = null;
    staleKeywordUserPruneStartInProgress = false;
    return { clearedJobId, autoRestartCancelled, deletedFiles };
  }

  function updateStaleKeywordUserPruneSpeed(
    job: StaleKeywordUserPruneJob,
    actionDelayMinSeconds: number,
    actionDelayMaxSeconds: number
  ): { controlPath: string; updatedRequestPaths: string[]; reportUpdated: boolean } {
    job.actionDelayMinSeconds = actionDelayMinSeconds;
    job.actionDelayMaxSeconds = actionDelayMaxSeconds;

    let reportUpdated = false;
    const report = readStaleKeywordUserPruneReport(job.id);
    if (report) {
      report.actionDelayMinSeconds = actionDelayMinSeconds;
      report.actionDelayMaxSeconds = actionDelayMaxSeconds;
      writeStaleKeywordUserPruneReport(report);
      reportUpdated = true;
    }

    const updatedRequestPaths = patchStaleKeywordUserPruneRequestSpeed(job.id, actionDelayMinSeconds, actionDelayMaxSeconds);
    const controlPath = writeStaleKeywordUserPruneControl(job.id, actionDelayMinSeconds, actionDelayMaxSeconds);
    return { controlPath, updatedRequestPaths, reportUpdated };
  }

  function patchStaleKeywordUserPruneRequestSpeed(
    jobId: string,
    actionDelayMinSeconds: number,
    actionDelayMaxSeconds: number
  ): string[] {
    const candidatePaths = [staleKeywordUserPruneRequestPath(jobId), staleKeywordUserPruneRunningRequestPath(jobId)];
    const updatedPaths: string[] = [];
    for (const requestPath of candidatePaths) {
      try {
        const parsed = JSON.parse(fsSync.readFileSync(requestPath, "utf8")) as Record<string, unknown>;
        parsed.actionDelayMinSeconds = actionDelayMinSeconds;
        parsed.actionDelayMaxSeconds = actionDelayMaxSeconds;
        parsed.updatedAt = new Date().toISOString();
        fsSync.writeFileSync(requestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        updatedPaths.push(requestPath);
      } catch {
        // Ignore missing queue markers; local runs do not use them.
      }
    }
    return updatedPaths;
  }

  function writeStaleKeywordUserPruneControl(jobId: string, actionDelayMinSeconds: number, actionDelayMaxSeconds: number): string {
    const controlPath = staleKeywordUserPruneControlPath(jobId);
    fsSync.mkdirSync(path.dirname(controlPath), { recursive: true });
    fsSync.writeFileSync(
      controlPath,
      `${JSON.stringify(
        {
          jobId,
          actionDelayMinSeconds,
          actionDelayMaxSeconds,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return controlPath;
  }

  function queueDockerStaleKeywordUserPruneJob(
    mode: KeywordUserPruneMode,
    maxAgeDays: number,
    actionDelayMinSeconds: number,
    actionDelayMaxSeconds: number,
    stoppedRun: RunRecord | null,
    autoIgnoreAlert: boolean,
    maxRetries: number,
    autoRestartDelaySeconds: number,
    startIndex: number,
    restartCount = 0,
    resumeStatePath?: string
  ): StaleKeywordUserPruneJob {
    const job = createStaleKeywordUserPruneJob(
      mode,
      maxAgeDays,
      actionDelayMinSeconds,
      actionDelayMaxSeconds,
      stoppedRun,
      autoIgnoreAlert,
      maxRetries,
      autoRestartDelaySeconds,
      startIndex,
      restartCount,
      resumeStatePath
    );
    fsSync.mkdirSync(staleKeywordUserPruneRequestDir(), { recursive: true });
    fsSync.writeFileSync(
      staleKeywordUserPruneRequestPath(job.id),
      `${JSON.stringify(
        {
          mode,
          jobId: job.id,
          maxAgeDays,
          actionDelayMinSeconds,
          actionDelayMaxSeconds,
          autoIgnoreAlert,
          maxRetries,
          autoRestartDelaySeconds,
          startIndex,
          restartCount,
          requestedAt: job.startedAt,
          reportPath: job.reportPath,
          resumeStatePath: job.resumeStatePath
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    staleKeywordUserPruneJob = job;
    void recordSession("info", "keyword_user_prune.docker_queued", "Stale keyword user pruning queued for Docker VPN worker", {
      jobId: job.id,
      mode: job.mode,
      maxAgeDays,
      actionDelayMinSeconds,
      actionDelayMaxSeconds,
      autoIgnoreAlert,
      maxRetries,
      autoRestartDelaySeconds,
      startIndex,
      restartCount,
      requestPath: staleKeywordUserPruneRequestPath(job.id),
      reportPath: job.reportPath,
      resumeStatePath: job.resumeStatePath
    });
    return job;
  }

  function createStaleKeywordUserPruneJob(
    mode: KeywordUserPruneMode,
    maxAgeDays: number,
    actionDelayMinSeconds: number,
    actionDelayMaxSeconds: number,
    stoppedRun: RunRecord | null,
    autoIgnoreAlert: boolean,
    maxRetries: number,
    autoRestartDelaySeconds: number,
    startIndex: number,
    restartCount = 0,
    resumeStatePath?: string
  ): StaleKeywordUserPruneJob {
    const id = `stale-users-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    return {
      id,
      status: "running",
      mode,
      maxAgeDays,
      actionDelayMinSeconds,
      actionDelayMaxSeconds,
      autoIgnoreAlert,
      maxRetries,
      autoRestartDelaySeconds,
      startIndex,
      restartCount,
      blockedByAlertId: null,
      restartedAfterAlertId: null,
      autoRestartScheduledAt: null,
      autoRestartAt: null,
      autoRestartSource: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      reportPath: staleKeywordUserPruneReportPath(id),
      resumeStatePath: resumeStatePath ?? staleKeywordUserPruneResumeStatePath(id),
      stoppedRun: stoppedRun ? { id: stoppedRun.id, status: stoppedRun.status } : null,
      child: null,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      error: null
    };
  }

  function staleKeywordUserPruneStatus() {
    const job = staleKeywordUserPruneJob;
    const staleUsers = staleKeywordUserSnapshot();
    if (!job) {
      return { running: false, job: null, staleUsers, estimates: staleKeywordUserPruneFallbackEstimates() };
    }
    const report = readStaleKeywordUserPruneReport(job.id);
    resetStaleKeywordUserRetryCountAfterProgress(job, report, "status");
    const status = report?.status ?? job.status;
    const estimates = staleKeywordUserPruneEstimates(job, report);
    return {
      running: status === "running",
      staleUsers,
      estimates,
      job: {
        id: job.id,
        status,
        mode: report?.mode ?? job.mode,
        maxAgeDays: job.maxAgeDays,
        actionDelayMinSeconds: report?.actionDelayMinSeconds ?? job.actionDelayMinSeconds,
        actionDelayMaxSeconds: report?.actionDelayMaxSeconds ?? job.actionDelayMaxSeconds,
        autoIgnoreAlert: job.autoIgnoreAlert,
        maxRetries: job.maxRetries,
        autoRestartDelaySeconds: job.autoRestartDelaySeconds,
        startIndex: report?.startIndex ?? job.startIndex,
        skippedBeforeStartIndex: report?.skippedBeforeStartIndex ?? Math.max(0, job.startIndex - 1),
        estimatedCheckedUsers: estimates.checkedUsers,
        suggestedStartIndex: estimates.suggestedStartIndex,
        restartCount: job.restartCount,
        blockedByAlertId: report?.blockedByAlertId ?? job.blockedByAlertId,
        restartedAfterAlertId: job.restartedAfterAlertId,
        autoRestartScheduledAt: job.autoRestartScheduledAt,
        autoRestartAt: job.autoRestartAt,
        autoRestartSource: job.autoRestartSource,
        startedAt: job.startedAt,
        completedAt: report?.completedAt ?? job.completedAt,
        reportPath: job.reportPath,
        resumeStatePath: job.resumeStatePath,
        stoppedRun: job.stoppedRun,
        exitCode: job.exitCode,
        signal: job.signal,
        error: report?.error ?? job.error,
        stdoutTail: lastOutputLines(job.stdout, 20),
        stderrTail: lastOutputLines(job.stderr, 20),
        report
      }
    };
  }

  async function staleKeywordUserPruneStatusFresh() {
    await refreshStaleKeywordUserPruneJobFromReport();
    recoverStaleKeywordUserPruneJobFromRuntime();
    await refreshStaleKeywordUserPruneJobFromReport();
    return staleKeywordUserPruneStatus();
  }

  function recoverStaleKeywordUserPruneJobFromRuntime(): void {
    if (!staleKeywordUserPruneRuntimeRecoveryEnabled()) {
      return;
    }
    const currentJob = staleKeywordUserPruneJob;
    if (currentJob) {
      const report = readStaleKeywordUserPruneReport(currentJob.id);
      const status = report?.status ?? currentJob.status;
      if (status === "running") {
        return;
      }
    }

    const recoveredJob = recoverStaleKeywordUserPruneJobFromRequest() ?? recoverStaleKeywordUserPruneJobFromReport();
    if (!recoveredJob) {
      return;
    }

    staleKeywordUserPruneJob = recoveredJob;
  }

  function staleKeywordUserPruneRuntimeRecoveryEnabled(): boolean {
    const databaseName = (options.database as unknown as { name?: string }).name;
    return Boolean(databaseName && databaseName !== ":memory:");
  }

  function recoverStaleKeywordUserPruneJobFromRequest(): StaleKeywordUserPruneJob | null {
    const dir = staleKeywordUserPruneRequestDir();
    let files: Array<{ filePath: string; mtimeMs: number }> = [];
    try {
      files = fsSync
        .readdirSync(dir)
        .filter((filename) => filename.endsWith(".json") || filename.endsWith(".running"))
        .map((filename) => {
          const filePath = path.join(dir, filename);
          return { filePath, mtimeMs: fsSync.statSync(filePath).mtimeMs };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs);
    } catch {
      return null;
    }

    for (const file of files) {
      const job = staleKeywordUserPruneJobFromRequestFile(file.filePath);
      if (job) {
        return job;
      }
    }
    return null;
  }

  function recoverStaleKeywordUserPruneJobFromReport(): StaleKeywordUserPruneJob | null {
    for (const reportPath of staleKeywordUserPruneReportPaths()) {
      const report = readStaleKeywordUserPruneReportFromPath(reportPath);
      if (!report || report.status !== "running" || !staleKeywordUserPruneProcessIsRunning(report.jobId)) {
        continue;
      }
      return staleKeywordUserPruneJobFromReportFile(report, reportPath);
    }
    return null;
  }

  function staleKeywordUserPruneJobFromRequestFile(filePath: string): StaleKeywordUserPruneJob | null {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(filePath, "utf8")) as {
        mode?: unknown;
        jobId?: unknown;
        maxAgeDays?: unknown;
        actionDelayMinSeconds?: unknown;
        actionDelayMaxSeconds?: unknown;
        autoIgnoreAlert?: unknown;
        maxRetries?: unknown;
        autoRestartDelaySeconds?: unknown;
        startIndex?: unknown;
        restartCount?: unknown;
        requestedAt?: unknown;
        reportPath?: unknown;
        resumeStatePath?: unknown;
      };
      const id = typeof parsed.jobId === "string" && parsed.jobId.trim() ? parsed.jobId : "";
      const maxAgeDays = Number(parsed.maxAgeDays);
      if (!id || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
        return null;
      }
      const runtimeConfig = getXApiConfig();
      const stat = fsSync.statSync(filePath);
      return {
        id,
        status: "running",
        mode: parsed.mode === "x_api" ? "x_api" : "without_api",
        maxAgeDays,
        actionDelayMinSeconds:
          Number.isFinite(Number(parsed.actionDelayMinSeconds)) && Number(parsed.actionDelayMinSeconds) >= 0
            ? Number(parsed.actionDelayMinSeconds)
            : runtimeConfig.staleKeywordUserActionDelayMinSeconds,
        actionDelayMaxSeconds: Math.max(
          Number.isFinite(Number(parsed.actionDelayMinSeconds)) && Number(parsed.actionDelayMinSeconds) >= 0
            ? Number(parsed.actionDelayMinSeconds)
            : runtimeConfig.staleKeywordUserActionDelayMinSeconds,
          Number.isFinite(Number(parsed.actionDelayMaxSeconds)) && Number(parsed.actionDelayMaxSeconds) >= 0
            ? Number(parsed.actionDelayMaxSeconds)
            : runtimeConfig.staleKeywordUserActionDelayMaxSeconds
        ),
        autoIgnoreAlert: typeof parsed.autoIgnoreAlert === "boolean" ? parsed.autoIgnoreAlert : runtimeConfig.staleKeywordUserAutoIgnoreAlert,
        maxRetries:
          Number.isFinite(Number(parsed.maxRetries)) && Number(parsed.maxRetries) >= 0
            ? Number(parsed.maxRetries)
            : runtimeConfig.staleKeywordUserMaxRetries,
        autoRestartDelaySeconds:
          Number.isFinite(Number(parsed.autoRestartDelaySeconds)) && Number(parsed.autoRestartDelaySeconds) >= 0
            ? Number(parsed.autoRestartDelaySeconds)
            : runtimeConfig.staleKeywordUserAutoRestartDelaySeconds,
        startIndex: Number.isFinite(Number(parsed.startIndex)) && Number(parsed.startIndex) > 0 ? Number(parsed.startIndex) : 1,
        restartCount: Number.isFinite(Number(parsed.restartCount)) && Number(parsed.restartCount) >= 0 ? Number(parsed.restartCount) : 0,
        blockedByAlertId: null,
        restartedAfterAlertId: null,
        autoRestartScheduledAt: null,
        autoRestartAt: null,
        autoRestartSource: null,
        startedAt: typeof parsed.requestedAt === "string" && parsed.requestedAt ? parsed.requestedAt : stat.mtime.toISOString(),
        completedAt: null,
        reportPath: typeof parsed.reportPath === "string" && parsed.reportPath ? parsed.reportPath : staleKeywordUserPruneReportPath(id),
        resumeStatePath:
          typeof parsed.resumeStatePath === "string" && parsed.resumeStatePath ? parsed.resumeStatePath : staleKeywordUserPruneResumeStatePath(id),
        stoppedRun: null,
        child: null,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        error: null
      };
    } catch {
      return null;
    }
  }

  function staleKeywordUserPruneJobFromReportFile(report: StaleKeywordUserPruneReport, reportPath: string): StaleKeywordUserPruneJob | null {
    if (!report.jobId) {
      return null;
    }
    const runtimeConfig = getXApiConfig();
    return {
      id: report.jobId,
      status: "running",
      mode: report.mode === "x_api" ? "x_api" : "without_api",
      maxAgeDays: report.maxAgeDays,
      actionDelayMinSeconds: Math.max(0, Math.floor(report.actionDelayMinSeconds ?? runtimeConfig.staleKeywordUserActionDelayMinSeconds)),
      actionDelayMaxSeconds: Math.max(
        Math.max(0, Math.floor(report.actionDelayMinSeconds ?? runtimeConfig.staleKeywordUserActionDelayMinSeconds)),
        Math.floor(report.actionDelayMaxSeconds ?? runtimeConfig.staleKeywordUserActionDelayMaxSeconds)
      ),
      autoIgnoreAlert: runtimeConfig.staleKeywordUserAutoIgnoreAlert,
      maxRetries: runtimeConfig.staleKeywordUserMaxRetries,
      autoRestartDelaySeconds: runtimeConfig.staleKeywordUserAutoRestartDelaySeconds,
      startIndex: report.startIndex,
      restartCount: 0,
      blockedByAlertId: typeof report.blockedByAlertId === "number" ? report.blockedByAlertId : null,
      restartedAfterAlertId: null,
      autoRestartScheduledAt: null,
      autoRestartAt: null,
      autoRestartSource: null,
      startedAt: report.startedAt,
      completedAt: null,
      reportPath,
      resumeStatePath: staleKeywordUserPruneResumeStatePath(report.jobId),
      stoppedRun: null,
      child: null,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      error: null
    };
  }

  function staleKeywordUserPruneReportPaths(): string[] {
    const runtimeDir = path.join(process.cwd(), "runtime");
    try {
      return fsSync
        .readdirSync(runtimeDir)
        .filter((filename) => /^stale-keyword-user-prune-stale-users-.+\.json$/.test(filename))
        .map((filename) => {
          const filePath = path.join(runtimeDir, filename);
          return { filePath, mtimeMs: fsSync.statSync(filePath).mtimeMs };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .map((entry) => entry.filePath);
    } catch {
      return [];
    }
  }

  function staleKeywordUserPruneProcessIsRunning(jobId: string): boolean {
    try {
      for (const entry of fsSync.readdirSync("/proc", { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
          continue;
        }
        let commandLine = "";
        try {
          commandLine = fsSync.readFileSync(path.join("/proc", entry.name, "cmdline"), "utf8").replace(/\0/g, " ");
        } catch {
          continue;
        }
        if (
          commandLine.includes(jobId) &&
          (commandLine.includes("staleKeywordUserPruner") || commandLine.includes("keyword-users:prune-stale"))
        ) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  async function refreshStaleKeywordUserPruneJobFromReport(): Promise<void> {
    const job = staleKeywordUserPruneJob;
    if (!job || job.child) {
      return;
    }
    const report = readStaleKeywordUserPruneReport(job.id);
    if (!report || report.status === "running") {
      return;
    }

    const wasRunning = job.status === "running";
    const previousBlockedAlertId = job.blockedByAlertId;
    const reportBlockedAlertId = typeof report.blockedByAlertId === "number" ? report.blockedByAlertId : null;
    job.status = report.status;
    job.completedAt = report.completedAt ?? job.completedAt ?? new Date().toISOString();
    job.error = report.status === "failed" || report.status === "stopped" ? report.error ?? job.error : job.error;
    if (job.exitCode === null) {
      job.exitCode = report.status === "completed" || report.status === "stopped" ? 0 : reportBlockedAlertId ? 2 : 1;
    }
    const effectiveBlockedAlertId = staleKeywordUserPruneBlockedAlertId(job, report);
    if (effectiveBlockedAlertId) {
      job.blockedByAlertId = effectiveBlockedAlertId;
    }
    resetStaleKeywordUserRetryCountAfterProgress(job, report, "report_refresh");

    if (wasRunning) {
      const eventType =
        report.status === "completed"
          ? "keyword_user_prune.job_completed"
          : report.status === "stopped"
            ? "keyword_user_prune.job_stopped"
            : "keyword_user_prune.job_failed";
      const eventMessage =
        report.status === "completed"
          ? "Stale keyword user pruning job completed"
          : report.status === "stopped"
            ? "Stale keyword user pruning job stopped"
            : "Stale keyword user pruning job failed";
      await recordSession(
        report.status === "failed" ? "prob" : "info",
        eventType,
        eventMessage,
        {
          jobId: job.id,
          code: job.exitCode,
          signal: job.signal,
          reportPath: job.reportPath,
          removedUsers: report.removedUsers.length,
          keptUsers: report.keptUsers.length,
          skippedUsers: report.skippedUsers.length,
          error: job.error
        }
      );
    }

    if (report.status === "failed" && (wasRunning || (effectiveBlockedAlertId && previousBlockedAlertId !== effectiveBlockedAlertId))) {
      await handleStaleKeywordUserPruneAlertStop(job, report);
    }
  }

  function readStaleKeywordUserPruneReport(jobId: string): StaleKeywordUserPruneReport | null {
    try {
      return JSON.parse(fsSync.readFileSync(staleKeywordUserPruneReportPath(jobId), "utf8")) as StaleKeywordUserPruneReport;
    } catch {
      return null;
    }
  }

  function writeStaleKeywordUserPruneReport(report: StaleKeywordUserPruneReport): void {
    fsSync.mkdirSync(path.dirname(staleKeywordUserPruneReportPath(report.jobId)), { recursive: true });
    fsSync.writeFileSync(staleKeywordUserPruneReportPath(report.jobId), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  function stoppedStaleKeywordUserPruneReport(
    job: StaleKeywordUserPruneJob,
    report: StaleKeywordUserPruneReport | null,
    stoppedAt: string,
    reason: string
  ): StaleKeywordUserPruneReport {
    return {
      jobId: job.id,
      mode: report?.mode ?? job.mode,
      status: "stopped",
      maxAgeDays: report?.maxAgeDays ?? job.maxAgeDays,
      actionDelayMinSeconds: report?.actionDelayMinSeconds ?? job.actionDelayMinSeconds,
      actionDelayMaxSeconds: report?.actionDelayMaxSeconds ?? job.actionDelayMaxSeconds,
      startedAt: report?.startedAt ?? job.startedAt,
      completedAt: stoppedAt,
      account: report?.account ?? null,
      vpnProfilePath: report?.vpnProfilePath ?? null,
      publicIpv4: report?.publicIpv4 ?? null,
      totalCandidates: report?.totalCandidates ?? 0,
      processedCandidates: report?.processedCandidates ?? 0,
      startIndex: report?.startIndex ?? job.startIndex,
      skippedBeforeStartIndex: report?.skippedBeforeStartIndex ?? Math.max(0, job.startIndex - 1),
      removedUsers: report?.removedUsers ?? [],
      keptUsers: report?.keptUsers ?? [],
      skippedUsers: report?.skippedUsers ?? [],
      deletedUsers: report?.deletedUsers ?? [],
      error: `Stopped by request: ${reason}.`,
      blockedByAlertId: null,
      blockedByAccountId: null,
      blockedByXIdentifier: null,
      blockedKeyword: null
    };
  }

  function staleKeywordUserSnapshot() {
    const page = lists.listPage("stale_keyword_user", { limit: 100, order: "desc" });
    return {
      entries: page.entries,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore
    };
  }

  function staleKeywordUserPruneEstimates(
    job: StaleKeywordUserPruneJob,
    report: StaleKeywordUserPruneReport | null
  ): { checkedUsers: number; suggestedStartIndex: number } {
    const skippedBeforeStartIndex = report?.skippedBeforeStartIndex ?? Math.max(0, job.startIndex - 1);
    const processed = report?.processedCandidates ?? 0;
    const reportedCheckedUsers =
      (report?.removedUsers.length ?? 0) +
      (report?.deletedUsers?.length ?? 0) +
      (report?.keptUsers.length ?? 0) +
      (report?.skippedUsers.filter((user) => user.reason !== "already_in_stale_keyword_user").length ?? 0);
    const resumeStats = readStaleKeywordUserPruneResumeStats(job.resumeStatePath);
    const checkedAfterStartIndex = Math.max(processed, reportedCheckedUsers, resumeStats.checkedUsers);
    const removedAfterStartIndex = Math.max((report?.removedUsers.length ?? 0) + (report?.deletedUsers?.length ?? 0), resumeStats.removedUsers);
    const activeCheckedAfterStartIndex = Math.max(0, checkedAfterStartIndex - removedAfterStartIndex);
    return {
      checkedUsers: skippedBeforeStartIndex + checkedAfterStartIndex,
      suggestedStartIndex: skippedBeforeStartIndex + activeCheckedAfterStartIndex + 1
    };
  }

  function staleKeywordUserPruneFallbackEstimates(): { checkedUsers: number; suggestedStartIndex: number } {
    const reportPath = latestStaleKeywordUserPruneReportPath();
    const report = reportPath ? readStaleKeywordUserPruneReportFromPath(reportPath) : null;
    if (report) {
      const skippedBeforeStartIndex = report.skippedBeforeStartIndex ?? Math.max(0, report.startIndex - 1);
      const processed = report.processedCandidates ?? 0;
      const reportedCheckedUsers =
        (report.removedUsers?.length ?? 0) +
        (report.deletedUsers?.length ?? 0) +
        (report.keptUsers?.length ?? 0) +
        (report.skippedUsers?.filter((user) => user.reason !== "already_in_stale_keyword_user").length ?? 0);
      const checkedAfterStartIndex = Math.max(processed, reportedCheckedUsers);
      const removedAfterStartIndex = (report.removedUsers?.length ?? 0) + (report.deletedUsers?.length ?? 0);
      const activeCheckedAfterStartIndex = Math.max(0, checkedAfterStartIndex - removedAfterStartIndex);
      return {
        checkedUsers: skippedBeforeStartIndex + checkedAfterStartIndex,
        suggestedStartIndex: skippedBeforeStartIndex + activeCheckedAfterStartIndex + 1
      };
    }

    const resumeStatePath = latestStaleKeywordUserPruneResumeStatePath();
    if (!resumeStatePath) {
      return { checkedUsers: 0, suggestedStartIndex: 1 };
    }
    const resumeStats = readStaleKeywordUserPruneResumeStats(resumeStatePath);
    const activeCheckedUsers = Math.max(0, resumeStats.checkedUsers - resumeStats.removedUsers);
    return {
      checkedUsers: resumeStats.checkedUsers,
      suggestedStartIndex: activeCheckedUsers + 1
    };
  }

  function latestStaleKeywordUserPruneResumeStatePath(): string | undefined {
    const runtimeDir = path.join(process.cwd(), "runtime");
    try {
      return fsSync
        .readdirSync(runtimeDir)
        .filter((filename) => /^stale-keyword-user-prune-resume-.+\.json$/.test(filename))
        .map((filename) => {
          const filePath = path.join(runtimeDir, filename);
          return { filePath, mtimeMs: fsSync.statSync(filePath).mtimeMs };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath;
    } catch {
      return undefined;
    }
  }

  function latestStaleKeywordUserPruneReportPath(): string | undefined {
    const runtimeDir = path.join(process.cwd(), "runtime");
    try {
      return fsSync
        .readdirSync(runtimeDir)
        .filter((filename) => /^stale-keyword-user-prune-stale-users-.+\.json$/.test(filename))
        .map((filename) => {
          const filePath = path.join(runtimeDir, filename);
          return { filePath, mtimeMs: fsSync.statSync(filePath).mtimeMs };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath;
    } catch {
      return undefined;
    }
  }

  function readStaleKeywordUserPruneReportFromPath(reportPath: string): StaleKeywordUserPruneReport | null {
    try {
      return JSON.parse(fsSync.readFileSync(reportPath, "utf8")) as StaleKeywordUserPruneReport;
    } catch {
      return null;
    }
  }

  function readStaleKeywordUserPruneResumeStats(resumeStatePath: string): { checkedUsers: number; removedUsers: number } {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(resumeStatePath, "utf8")) as {
        checkedUsers?: Array<{ handle?: string; keyword?: string; status?: string }>;
      };
      const checkedHandles = new Set<string>();
      const removedHandles = new Set<string>();
      for (const user of Array.isArray(parsed.checkedUsers) ? parsed.checkedUsers : []) {
        const handle = normalizeHandle(user.handle ?? user.keyword ?? "");
        if (!handle || user.status === "already_stale") {
          continue;
        }
        checkedHandles.add(handle);
        if (user.status === "remove" || user.status === "delete_keyword") {
          removedHandles.add(handle);
        }
      }
      return { checkedUsers: checkedHandles.size, removedUsers: removedHandles.size };
    } catch {
      return { checkedUsers: 0, removedUsers: 0 };
    }
  }

  function resetStaleKeywordUserRetryCountAfterProgress(
    job: StaleKeywordUserPruneJob,
    report: StaleKeywordUserPruneReport | null,
    source: string
  ): boolean {
    if (job.mode !== "without_api" || job.restartCount <= 0 || !report || !staleKeywordUserPruneReportHasUserProgress(report)) {
      return false;
    }
    const previousRestartCount = job.restartCount;
    job.restartCount = 0;
    patchStaleKeywordUserPruneRequestRestartCount(job.id, 0);
    void recordSession("info", "keyword_user_prune.retry_count_reset", "Stale keyword user pruning alert retry count reset after progress", {
      jobId: job.id,
      previousRestartCount,
      restartCount: job.restartCount,
      source,
      reportStatus: report.status,
      processedCandidates: report.processedCandidates,
      removedUsers: report.removedUsers?.length ?? 0,
      keptUsers: report.keptUsers?.length ?? 0,
      skippedUsers: report.skippedUsers?.length ?? 0,
      deletedUsers: report.deletedUsers?.length ?? 0
    });
    return true;
  }

  function staleKeywordUserPruneReportHasUserProgress(report: StaleKeywordUserPruneReport): boolean {
    const processedCandidates = Math.max(0, Number(report.processedCandidates ?? 0));
    if (processedCandidates > 0) {
      return true;
    }
    const decisions =
      (report.removedUsers?.length ?? 0) +
      (report.deletedUsers?.length ?? 0) +
      (report.keptUsers?.length ?? 0) +
      (report.skippedUsers?.filter((user) => user.reason !== "already_in_stale_keyword_user").length ?? 0);
    return decisions > 0;
  }

  function patchStaleKeywordUserPruneRequestRestartCount(jobId: string, restartCount: number): string[] {
    const candidatePaths = [staleKeywordUserPruneRequestPath(jobId), staleKeywordUserPruneRunningRequestPath(jobId)];
    const updatedPaths: string[] = [];
    for (const requestPath of candidatePaths) {
      try {
        const parsed = JSON.parse(fsSync.readFileSync(requestPath, "utf8")) as Record<string, unknown>;
        parsed.restartCount = restartCount;
        parsed.updatedAt = new Date().toISOString();
        fsSync.writeFileSync(requestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        updatedPaths.push(requestPath);
      } catch {
        // Ignore missing queue markers; local runs do not use them.
      }
    }
    return updatedPaths;
  }

  function staleKeywordUserPruneBlockedAlertId(
    job: StaleKeywordUserPruneJob,
    report: StaleKeywordUserPruneReport | null
  ): number | null {
    if ((report?.mode ?? job.mode) !== "without_api") {
      return null;
    }
    if (typeof report?.blockedByAlertId === "number") {
      return report.blockedByAlertId;
    }
    if (typeof job.blockedByAlertId === "number") {
      return job.blockedByAlertId;
    }
    if (report && staleKeywordUserPruneErrorLooksAlertBlocked(report.error)) {
      const openAlerts = xSessionAlerts.openAlerts();
      const matchingAlerts = openAlerts.filter((alert) =>
        report.blockedByAccountId
          ? alert.accountId === report.blockedByAccountId
          : report.blockedByXIdentifier
            ? alert.xIdentifier === report.blockedByXIdentifier
            : report.vpnProfilePath
              ? alert.vpnProfilePath === report.vpnProfilePath
              : true
      );
      return matchingAlerts.length === 1 ? matchingAlerts[0].id : null;
    }
    if (job.exitCode !== 2) {
      return null;
    }
    const openAlerts = xSessionAlerts.openAlerts();
    return openAlerts.length === 1 ? openAlerts[0].id : null;
  }

  function staleKeywordUserPruneErrorLooksAlertBlocked(error: string | null | undefined): boolean {
    return Boolean(
      error &&
        (/X account is locked by an open manual verification alert/i.test(error) ||
          /X returned a blocking error page/i.test(error) ||
          /manual verification/i.test(error))
    );
  }

  async function handleStaleKeywordUserPruneAlertStop(
    job: StaleKeywordUserPruneJob,
    report: StaleKeywordUserPruneReport | null
  ): Promise<void> {
    if ((report?.mode ?? job.mode) !== "without_api") {
      return;
    }
    const alertId = staleKeywordUserPruneBlockedAlertId(job, report);
    if (!alertId) {
      return;
    }
    job.blockedByAlertId = alertId;
    await recordSession("prob", "keyword_user_prune.waiting_alert_resolution", "Stale keyword user pruning is waiting for X session alert resolution", {
      jobId: job.id,
      alertId,
      maxAgeDays: job.maxAgeDays,
      actionDelayMinSeconds: job.actionDelayMinSeconds,
      actionDelayMaxSeconds: job.actionDelayMaxSeconds,
      autoIgnoreAlert: job.autoIgnoreAlert,
      maxRetries: job.maxRetries,
      autoRestartDelaySeconds: job.autoRestartDelaySeconds,
      restartCount: job.restartCount,
      blockedKeyword: report?.blockedKeyword ?? null,
      restartStrategy: "full_restart_same_resume_state"
    });
    if (!job.autoIgnoreAlert) {
      return;
    }
    if (job.restartCount >= job.maxRetries) {
      await recordSession("prob", "keyword_user_prune.auto_ignore_limit", "Stale keyword user pruning auto-ignore limit reached", {
        jobId: job.id,
        alertId,
        restartCount: job.restartCount,
        maxRestarts: job.maxRetries
      });
      return;
    }
    const alert = xSessionAlerts.find(alertId);
    if (!alert) {
      return;
    }
    const closedAlert = alert.status === "open" ? xSessionAlerts.ignore(alert.id) : alert;
    if (alert.status === "open") {
      markIgnoredAlertAccountReady(closedAlert);
      await recordSession("prob", "keyword_user_prune.alert_auto_ignored", "X session alert auto-ignored for stale keyword user pruning", {
        jobId: job.id,
        alertId: closedAlert.id,
        accountId: closedAlert.accountId,
        xIdentifier: closedAlert.xIdentifier,
        restartCount: job.restartCount
      });
    }
    await maybeRestartStaleKeywordUserPruneAfterAlert(closedAlert, "auto_ignored");
  }

  function prepareStaleKeywordUserPruneJobForRestart(
    job: StaleKeywordUserPruneJob,
    report: StaleKeywordUserPruneReport | null,
    alert: XSessionAlertRecord,
    source: "resolved" | "ignored" | "auto_ignored"
  ): void {
    const restartedAt = new Date().toISOString();
    const restartReport = stoppedStaleKeywordUserPruneReport(job, report, restartedAt, `restart_after_alert:${source}:${alert.id}`);
    restartReport.error = `Restarting after X session alert ${alert.id} was ${source}.`;
    writeStaleKeywordUserPruneReport(restartReport);
    job.status = "stopped";
    job.completedAt = restartedAt;
    job.error = restartReport.error;
    job.blockedByAlertId = null;
    job.exitCode = 0;
    job.signal = null;
  }

  function staleKeywordUserPruneAlertRestartDelayMs(job: StaleKeywordUserPruneJob): number {
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
      return 0;
    }
    return Math.max(0, Math.floor(job.autoRestartDelaySeconds)) * 1000;
  }

  function clearStaleKeywordUserPruneAutoRestart(job: StaleKeywordUserPruneJob): void {
    if (staleKeywordUserPruneRestartTimer) {
      clearTimeout(staleKeywordUserPruneRestartTimer);
      staleKeywordUserPruneRestartTimer = null;
    }
    job.autoRestartScheduledAt = null;
    job.autoRestartAt = null;
    job.autoRestartSource = null;
  }

  async function maybeRestartStaleKeywordUserPruneAfterAlert(
    alert: XSessionAlertRecord,
    source: "resolved" | "ignored" | "auto_ignored"
  ): Promise<StaleKeywordUserPruneJob | null> {
    const job = staleKeywordUserPruneJob;
    if (!job) {
      return null;
    }
    if (job.mode !== "without_api") {
      return null;
    }
    const report = readStaleKeywordUserPruneReport(job.id);
    const effectiveStatus = report?.status ?? job.status;
    const blockedAlertId = staleKeywordUserPruneBlockedAlertId(job, report);
    if (effectiveStatus === "running" || blockedAlertId !== alert.id || job.restartedAfterAlertId === alert.id) {
      return null;
    }
    if (job.autoRestartAt && job.autoRestartSource) {
      return null;
    }
    if (job.restartCount >= job.maxRetries) {
      await recordSession("prob", "keyword_user_prune.auto_restart_limit", "Stale keyword user pruning was not restarted because the retry limit was reached", {
        jobId: job.id,
        alertId: alert.id,
        restartCount: job.restartCount,
        maxRestarts: job.maxRetries
      });
      return null;
    }
    const restartDelayMs = staleKeywordUserPruneAlertRestartDelayMs(job);
    const scheduleRestartAt = (delayMs: number) => {
      const scheduledAtMs = Date.now();
      job.autoRestartScheduledAt = new Date(scheduledAtMs).toISOString();
      job.autoRestartAt = new Date(scheduledAtMs + delayMs).toISOString();
      job.autoRestartSource = source;
    };
    if (restartDelayMs > 0) {
      scheduleRestartAt(restartDelayMs);
      await recordSession("info", "keyword_user_prune.auto_restart_wait", "Waiting before restarting stale keyword user pruning after X session alert", {
        jobId: job.id,
        alertId: alert.id,
        source,
        restartDelayMs,
        autoRestartDelaySeconds: job.autoRestartDelaySeconds
      });
      if (staleKeywordUserPruneRestartTimer) {
        clearTimeout(staleKeywordUserPruneRestartTimer);
      }
      staleKeywordUserPruneRestartTimer = setTimeout(() => {
        staleKeywordUserPruneRestartTimer = null;
        void performStaleKeywordUserPruneAutoRestart(alert, source, job.id).catch((error) => {
          void recordSession("prob", "keyword_user_prune.auto_restart_failed", "Stale keyword user pruning auto-restart failed", {
            jobId: job.id,
            alertId: alert.id,
            source,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }, restartDelayMs);
      return null;
    }
    scheduleRestartAt(0);
    return performStaleKeywordUserPruneAutoRestart(alert, source, job.id);
  }

  async function performStaleKeywordUserPruneAutoRestart(
    alert: XSessionAlertRecord,
    source: "resolved" | "ignored" | "auto_ignored",
    expectedJobId: string
  ): Promise<StaleKeywordUserPruneJob | null> {
    const job = staleKeywordUserPruneJob;
    if (!job || job.id !== expectedJobId) {
      await recordSession("prob", "keyword_user_prune.auto_restart_aborted", "Auto-restart was aborted because the stale keyword user pruning job changed before restart", {
        expectedJobId,
        currentJobId: job?.id ?? null,
        alertId: alert.id,
        source
      });
      return null;
    }
    const report = readStaleKeywordUserPruneReport(job.id);
    const effectiveStatus = report?.status ?? job.status;
    const blockedAlertId = staleKeywordUserPruneBlockedAlertId(job, report);
    if (staleKeywordUserPruneJob !== job) {
      await recordSession("prob", "keyword_user_prune.auto_restart_aborted", "Auto-restart was aborted because the stale keyword user pruning job changed during the wait window", {
        jobId: job.id,
        alertId: alert.id,
        source
      });
      return null;
    }
    if (effectiveStatus === "running" || blockedAlertId !== alert.id || job.restartedAfterAlertId === alert.id) {
      clearStaleKeywordUserPruneAutoRestart(job);
      return null;
    }
    if (job.restartCount >= job.maxRetries) {
      clearStaleKeywordUserPruneAutoRestart(job);
      await recordSession("prob", "keyword_user_prune.auto_restart_limit", "Stale keyword user pruning was not restarted because the retry limit was reached", {
        jobId: job.id,
        alertId: alert.id,
        restartCount: job.restartCount,
        maxRestarts: job.maxRetries
      });
      return null;
    }
    job.restartedAfterAlertId = alert.id;
    const restartEstimate = staleKeywordUserPruneEstimates(job, report);
    prepareStaleKeywordUserPruneJobForRestart(job, report, alert, source);
    const nextRestartCount = job.restartCount + 1;
    const restartStartIndex = Math.max(1, restartEstimate.suggestedStartIndex);
    const restartedResult = await startStaleKeywordUserPruneFromAdmin({
      maxAgeDays: job.maxAgeDays,
      actionDelayMinSeconds: job.actionDelayMinSeconds,
      actionDelayMaxSeconds: job.actionDelayMaxSeconds,
      autoIgnoreAlert: job.autoIgnoreAlert,
      maxRetries: job.maxRetries,
      autoRestartDelaySeconds: job.autoRestartDelaySeconds,
      startIndex: restartStartIndex,
      modeOverride: job.mode,
      restartCount: nextRestartCount,
      forceResumeStatePath: restartStartIndex === 1 ? job.resumeStatePath : undefined
    });
    if (!restartedResult.ok) {
      clearStaleKeywordUserPruneAutoRestart(job);
      await recordSession("prob", "keyword_user_prune.auto_restart_blocked", "Stale keyword user pruning could not be restarted through the same path as Start after X session alert was closed", {
        jobId: job.id,
        alertId: alert.id,
        source,
        reason: restartedResult.reason,
        error: restartedResult.payload.error,
        startIndex: restartStartIndex
      });
      return null;
    }
    clearStaleKeywordUserPruneAutoRestart(job);
    const restarted = restartedResult.job;
    await recordSession("info", "keyword_user_prune.auto_restarted", "Stale keyword user pruning restarted after X session alert was closed", {
      previousJobId: job.id,
      jobId: restarted.id,
      alertId: alert.id,
      source,
      maxAgeDays: restarted.maxAgeDays,
      actionDelayMinSeconds: restarted.actionDelayMinSeconds,
      actionDelayMaxSeconds: restarted.actionDelayMaxSeconds,
      autoIgnoreAlert: restarted.autoIgnoreAlert,
      maxRetries: restarted.maxRetries,
      autoRestartDelaySeconds: restarted.autoRestartDelaySeconds,
      restartCount: restarted.restartCount,
      startIndex: restarted.startIndex,
      suggestedStartIndex: restartEstimate.suggestedStartIndex,
      resumeStatePath: restarted.resumeStatePath,
      accountId: restartedResult.startCheck?.ok ? restartedResult.startCheck.account.id : null,
      xIdentifier: restartedResult.startCheck?.ok ? restartedResult.startCheck.account.xIdentifier : null
    });
    return restarted;
  }

  function markIgnoredAlertAccountReady(alert: XSessionAlertRecord): void {
    const account = xBrowserAccounts.findById(alert.accountId);
    if (account?.storageStateExists) {
      xBrowserAccounts.markStatus(alert.accountId, "valid");
    }
  }

  function staleKeywordUserPruneReportPath(jobId: string): string {
    return path.join(process.cwd(), "runtime", `stale-keyword-user-prune-${safeJobPathSegment(jobId)}.json`);
  }

  function staleKeywordUserPruneResumeStatePath(jobId: string): string {
    return path.join(process.cwd(), "runtime", `stale-keyword-user-prune-resume-${safeJobPathSegment(jobId)}.json`);
  }

  function staleKeywordUserPruneResumeStatePathForStart(maxAgeDays: number): string | undefined {
    const previousJob = staleKeywordUserPruneJob;
    if (!previousJob || previousJob.maxAgeDays !== maxAgeDays) {
      return undefined;
    }
    const report = readStaleKeywordUserPruneReport(previousJob.id);
    const status = report?.status ?? previousJob.status;
    return status === "failed" ? previousJob.resumeStatePath : undefined;
  }

  function staleKeywordUserPruneRequestDir(): string {
    return path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests");
  }

  function staleKeywordUserPruneRequestPath(jobId: string): string {
    return path.join(staleKeywordUserPruneRequestDir(), `${safeJobPathSegment(jobId)}.json`);
  }

  function staleKeywordUserPruneRunningRequestPath(jobId: string): string {
    return path.join(staleKeywordUserPruneRequestDir(), `${safeJobPathSegment(jobId)}.running`);
  }

  function staleKeywordUserPruneControlPath(jobId: string): string {
    return path.join(process.cwd(), "runtime", "stale-keyword-user-prune-controls", `${safeJobPathSegment(jobId)}.json`);
  }

  function staleKeywordUserPruneStopPath(jobId: string): string {
    return path.join(process.cwd(), "runtime", "stale-keyword-user-prune-stops", `${safeJobPathSegment(jobId)}.stop`);
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

  function xLoginCommand(accountId: number, config = getXApiConfig()): string {
    return usesDockerVpnIsolation(config)
      ? `docker compose run --rm --service-ports x-login --account-id ${accountId}`
      : `npm run netns:x-login -- --account-id ${accountId}`;
  }

  function xAlertManualLoginCommands(accountId: number) {
    const runtimeConfig = getXApiConfig();
    const noVncUrl = `http://127.0.0.1:${runtimeConfig.xLoginNovncPort}/vnc.html?autoconnect=1&resize=scale`;
    const sshTunnel = `ssh -L ${runtimeConfig.xLoginNovncPort}:127.0.0.1:${runtimeConfig.xLoginNovncPort} <user>@<vps-host>`;
    const autoSaveLogin = usesDockerVpnIsolation(runtimeConfig)
      ? `docker compose run --rm --service-ports x-login --account-id ${accountId} --resolve-alert`
      : `npm run netns:x-login -- --account-id ${accountId} --resolve-alert --auto-save-on-login --hold-open-after-save`;
    return {
      setup: usesDockerVpnIsolation(runtimeConfig)
        ? `Open ${noVncUrl} after starting x-login. On a VPS, keep x-login running on the VPS, run ${sshTunnel} from your local PC after replacing <user>@<vps-host>, then open ${noVncUrl} locally.`
        : "npm run setup:local",
      manualLogin: autoSaveLogin,
      webLaunch: autoSaveLogin,
      noVncUrl: usesDockerVpnIsolation(runtimeConfig) ? noVncUrl : null,
      sshTunnel: usesDockerVpnIsolation(runtimeConfig) ? sshTunnel : null,
      diagnose: usesDockerVpnIsolation(runtimeConfig) ? "docker compose exec worker npm run diagnose:vpn" : "npm run netns:diagnose",
      worker: usesDockerVpnIsolation(runtimeConfig) ? "docker compose up -d worker" : "npm run netns:worker"
    };
  }

  function xAlertSessionWasCaptured(alert: XSessionAlertRecord, account: XBrowserAccountRecord): boolean {
    if (!account.storageStateExists || account.sessionStatus !== "valid" || !account.lastLoginAt) {
      return false;
    }
    const loginTime = Date.parse(account.lastLoginAt);
    const alertTime = Date.parse(alert.detectedAt);
    if (!Number.isFinite(loginTime) || !Number.isFinite(alertTime)) {
      return true;
    }
    return loginTime >= alertTime;
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

    const saved = logText.includes("V Session validated and saved.") || Boolean(account && xAlertSessionWasCaptured(alert, account));
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
    const result = await checkWithoutApiRunStart();
    if (!result.ok) {
      reply.code(result.code).send(result.payload);
      return { ok: false };
    }
    return result;
  }

  async function checkWithoutApiRunStart(): Promise<WithoutApiRunStartCheck> {
    const runtimeConfig = getXApiConfig();
    let account = xBrowserAccounts.findByVpnProfilePath(runtimeConfig.vpnConfig);
    if (!account) {
      await recordSession("prob", "browser.search.account_missing", "No X browser account is linked to the selected VPN profile", {
        vpnProfilePath: runtimeConfig.vpnConfig
      });
      return {
        ok: false,
        code: 409,
        reason: "account_missing",
        payload: {
          error:
            "Search without API needs an X browser account linked to the selected OpenVPN profile. Configure it in Settings > X browser account."
        }
      };
    }
    const alert = xSessionAlerts.openForAccount(account.id);
    if (alert) {
      await recordSession("prob", "x.session_alert.blocked_start", "Search without API start blocked by open X session alert", {
        alertId: alert.id,
        accountId: alert.accountId,
        xIdentifier: alert.xIdentifier
      });
      return {
        ok: false,
        code: 423,
        reason: "session_alert",
        payload: {
          error: "This X account is locked by an open manual verification alert.",
          alert
        }
      };
    }

    if (account.storageStateExists && account.sessionStatus === "needs_login") {
      account = xBrowserAccounts.markStatus(account.id, "valid");
      await recordSession("info", "browser.search.session_reused_after_alert_ignore", "Reusing stored X browser session after closed or ignored alert", {
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        vpnProfilePath: runtimeConfig.vpnConfig
      });
    }

    if (!account.storageStateExists || account.sessionStatus !== "valid") {
      await recordSession("prob", "browser.search.session_missing", "X browser session is missing or needs login", {
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        sessionStatus: account.sessionStatus
      });
      return {
        ok: false,
        code: 409,
        reason: "session_missing",
        payload: {
          error: `X browser session for ${account.xIdentifier} is not ready. Run ${xLoginCommand(account.id, runtimeConfig)}.`
        }
      };
    }
    if (usesDockerVpnIsolation(runtimeConfig)) {
      await recordSession("info", "browser.docker_vpn.preflight.deferred", "Docker VPN worker will run VPN diagnostics before browser work", {
        vpnProfilePath: runtimeConfig.vpnConfig,
        accountId: account.id,
        xIdentifier: account.xIdentifier
      });
      return { ok: true, account };
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
      return {
        ok: false,
        code: 409,
        reason: "vpn_preflight_failed",
        payload: {
          error: [
            "Search without API was not started because VPN diagnostics failed.",
            "Start/Resume tried to prepare the VPN namespace automatically, but the VPN was not ready.",
            "Check Show current session for vpn.autostart.* logs. If the root helper is missing, run npm run setup:local once, then press Start again.",
            vpnPreflight.error
          ].join(" ")
        }
      };
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

  async function maybeStartNextChainedRun(completedRunId: string, mode: "without_api" | "x_api"): Promise<void> {
    const completedRun = runs.get(completedRunId);
    if (!completedRun || completedRun.status !== "completed") {
      return;
    }
    if (runs.current()) {
      await recordSession("prob", "run.chain.skipped", "Sequential run was not started because another run is active", {
        previousRunId: completedRunId,
        mode
      });
      return;
    }

    const runtimeConfig = getXApiConfig();
    const completedStats = parseRunStats(completedRun.statsJson);
    const chain = nextRunChainState(completedStats, runtimeConfig);
    if (!chain) {
      await recordSession("info", "run.chain.completed", "Run completed; no extra run queued", {
        previousRunId: completedRunId,
        mode,
        ...runChainLogData(completedStats, runtimeConfig)
      });
      return;
    }

    const queuedBatch = nextRunChainKeywordBatch(completedStats);
    const keywords = queuedBatch?.keywords ?? plannedKeywords(lists, runtimeConfig);
    if (keywords.length === 0) {
      await recordSession("info", "run.chain.empty", "Sequential runs stopped because no eligible keywords remain. Clear SearchTerms.Used and/or No.Result to continue searching.", {
        previousRunId: completedRunId,
        mode,
        chainIndex: chain.index,
        chainTotal: chain.total,
        ...keywordAvailabilityLogData(keywordAvailability(lists))
      });
      return;
    }

    if (mode === "without_api") {
      if (!runtimeConfig.searchWithoutApiEnabled) {
        await recordSession("prob", "run.chain.disabled", "Sequential run stopped because Search without API is disabled", {
          previousRunId: completedRunId,
          chainIndex: chain.index,
          chainTotal: chain.total
        });
        return;
      }
      const startCheck = await checkWithoutApiRunStart();
      if (!startCheck.ok) {
        await recordSession("prob", "run.chain.blocked", "Sequential run stopped before start", {
          previousRunId: completedRunId,
          mode,
          reason: startCheck.reason,
          chainIndex: chain.index,
          chainTotal: chain.total
        });
        return;
      }
      const nextRun = runs.start(
        createInitialRunStats(lists, runtimeConfig, keywords, chain, queuedBatch?.remainingBatches ?? [])
      );
      runs.replaceKeywords(nextRun.id, keywords);
      await recordSession("info", "run.chain.started", "Sequential run started", {
        previousRunId: completedRunId,
        runId: nextRun.id,
        mode,
        plannedKeywords: keywords.length,
        chainIndex: chain.index,
        chainTotal: chain.total,
        accountId: startCheck.account.id,
        xIdentifier: startCheck.account.xIdentifier
      });
      await startWithoutApiExecution(nextRun);
      return;
    }

    if (!runtimeConfig.xApiEnabled) {
      await recordSession("prob", "run.chain.disabled", "Sequential run stopped because X API search is disabled", {
        previousRunId: completedRunId,
        chainIndex: chain.index,
        chainTotal: chain.total
      });
      return;
    }
    const nextRun = runs.start(
      createInitialRunStats(lists, runtimeConfig, keywords, chain, queuedBatch?.remainingBatches ?? [])
    );
    runs.replaceKeywords(nextRun.id, keywords);
    await recordSession("info", "run.chain.started", "Sequential run started", {
      previousRunId: completedRunId,
      runId: nextRun.id,
      mode,
      plannedKeywords: keywords.length,
      chainIndex: chain.index,
      chainTotal: chain.total
    });
    startCrawlerLoop(nextRun);
  }

  async function startWithoutApiExecution(run: RunRecord): Promise<void> {
    const runtimeConfig = getXApiConfig();
    if (usesDockerVpnIsolation(runtimeConfig)) {
      await recordSession("info", "browser.worker.deferred", "Search without API run assigned to Docker VPN worker", {
        runId: run.id,
        isolation: runtimeConfig.searchWithoutApiIsolation
      });
      return;
    }
    startWithoutApiWorker(run);
  }

  function startWithoutApiWorker(run: RunRecord): void {
    if (activeWithoutApiWorkerRunId === run.id && activeWithoutApiWorker && activeWithoutApiWorker.exitCode === null) {
      return;
    }

    const runtimeConfig = getXApiConfig();
    const completedKeywordsAtStart = parseRunStats(runs.get(run.id)?.statsJson ?? run.statsJson).completedKeywords;
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...xApiConfigToEnvValues(runtimeConfig),
      CURRENT_SESSION_FILE: options.currentSessionFilePath ?? options.config.currentSessionFile,
      VPN_NETNS_AUTOSTART: "true"
    };
    const databasePath = databasePathForChild(options.database);
    if (databasePath) {
      childEnv.DATABASE_URL = databasePath;
    }

    const child = spawn("npm", ["run", "netns:worker", "--", "--run-id", run.id], {
      cwd: process.cwd(),
      env: childEnv,
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
      if (code === 0) {
        resetWithoutApiAlertRetryCount(run.id, "worker_completed");
        void maybeStartNextChainedRun(run.id, "without_api");
      } else if (code === 2) {
        void handleWithoutApiAlertWorkerExit(run.id, completedKeywordsAtStart).catch((error) => {
          void recordSession("prob", "browser.search.auto_restart_failed", "Search without API auto-restart after X alert failed", {
            runId: run.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    });
  }

  function resetWithoutApiAlertRetryCount(runId: string, source: string): void {
    const run = runs.get(runId);
    if (!run) {
      return;
    }
    const stats = parseRunStats(run.statsJson);
    if ((stats.browserAlertRetryCount ?? 0) <= 0 && !stats.browserAlertAutoRestartAt) {
      return;
    }
    runs.updateStats(runId, {
      browserAlertRetryCount: 0,
      browserAlertAutoRestartAt: null,
      browserAlertLastCompletedKeywords: stats.completedKeywords,
      nextApiResetAt: stats.nextApiResetAt === stats.browserAlertAutoRestartAt ? null : stats.nextApiResetAt
    });
    void recordSession("info", "browser.search.alert_retry_reset", "Search without API alert retry count reset", {
      runId,
      source,
      completedKeywords: stats.completedKeywords
    });
  }

  async function handleWithoutApiAlertWorkerExit(runId: string, completedKeywordsAtStart: number): Promise<boolean> {
    const runtimeConfig = getXApiConfig();
    if (!runtimeConfig.searchWithoutApiEnabled || usesDockerVpnIsolation(runtimeConfig)) {
      return false;
    }
    const run = runs.get(runId);
    if (!run || run.status !== "paused") {
      return false;
    }
    const account = xBrowserAccounts.findByVpnProfilePath(runtimeConfig.vpnConfig);
    const alert = account ? xSessionAlerts.openForAccount(account.id) : xSessionAlerts.openAlerts()[0] ?? null;
    if (!alert) {
      return false;
    }

    await recordSession("prob", "browser.search.waiting_alert_resolution", "Search without API is waiting for X session alert resolution", {
      runId,
      alertId: alert.id,
      accountId: alert.accountId,
      xIdentifier: alert.xIdentifier,
      autoIgnoreAlert: runtimeConfig.searchWithoutApiAutoIgnoreAlert,
      maxRetries: runtimeConfig.searchWithoutApiMaxRetries,
      autoRestartDelaySeconds: runtimeConfig.searchWithoutApiAutoRestartDelaySeconds,
      restartStrategy: "resume_same_run"
    });

    if (!runtimeConfig.searchWithoutApiAutoIgnoreAlert) {
      return false;
    }

    const stats = parseRunStats(run.statsJson);
    const lastAlertCompleted = stats.browserAlertLastCompletedKeywords ?? completedKeywordsAtStart;
    const progressedSinceLastAlert = stats.completedKeywords > lastAlertCompleted;
    const previousRetryCount = progressedSinceLastAlert ? 0 : Math.max(0, Math.floor(stats.browserAlertRetryCount ?? 0));
    const maxRetries = Math.max(0, Math.floor(runtimeConfig.searchWithoutApiMaxRetries ?? 0));
    if (previousRetryCount >= maxRetries) {
      runs.updateStats(runId, {
        browserAlertAutoIgnore: true,
        browserAlertRetryCount: previousRetryCount,
        browserAlertMaxRetries: maxRetries,
        browserAlertAutoRestartDelaySeconds: runtimeConfig.searchWithoutApiAutoRestartDelaySeconds,
        browserAlertAutoRestartAt: null,
        browserAlertLastCompletedKeywords: stats.completedKeywords
      });
      await recordSession("prob", "browser.search.auto_ignore_limit", "Search without API auto-ignore limit reached", {
        runId,
        alertId: alert.id,
        retryCount: previousRetryCount,
        maxRetries
      });
      return false;
    }

    const closedAlert = xSessionAlerts.ignore(alert.id);
    markIgnoredAlertAccountReady(closedAlert);
    const nextRetryCount = previousRetryCount + 1;
    const delayMs = withoutApiAlertRestartDelayMs(runtimeConfig.searchWithoutApiAutoRestartDelaySeconds);
    const restartAt = new Date(Date.now() + delayMs).toISOString();
    runs.updateStats(runId, {
      browserAlertAutoIgnore: true,
      browserAlertRetryCount: nextRetryCount,
      browserAlertMaxRetries: maxRetries,
      browserAlertAutoRestartDelaySeconds: runtimeConfig.searchWithoutApiAutoRestartDelaySeconds,
      browserAlertAutoRestartAt: restartAt,
      browserAlertLastCompletedKeywords: stats.completedKeywords,
      nextApiResetAt: restartAt
    });
    await recordSession("prob", "browser.search.alert_auto_ignored", "X session alert auto-ignored for Search without API", {
      runId,
      alertId: closedAlert.id,
      accountId: closedAlert.accountId,
      xIdentifier: closedAlert.xIdentifier,
      retryCount: nextRetryCount,
      maxRetries,
      autoRestartDelaySeconds: runtimeConfig.searchWithoutApiAutoRestartDelaySeconds
    });
    await recordSession("info", "browser.search.auto_restart_wait", "Waiting before resuming Search without API after X session alert", {
      runId,
      alertId: closedAlert.id,
      retryCount: nextRetryCount,
      maxRetries,
      restartAt,
      delayMs
    });

    scheduleWithoutApiRestartAfterAlert(runId, closedAlert.id, "auto_ignored", delayMs);
    return true;
  }

  function withoutApiAlertRestartDelayMs(seconds: number): number {
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
      return 0;
    }
    return Math.max(0, Math.floor(seconds)) * 1000;
  }

  function clearWithoutApiAlertAutoRestart(): void {
    if (withoutApiAlertRestartTimer) {
      clearTimeout(withoutApiAlertRestartTimer);
      withoutApiAlertRestartTimer = null;
    }
  }

  function scheduleWithoutApiRestartAfterAlert(
    runId: string,
    alertId: number,
    source: "resolved" | "ignored" | "auto_ignored",
    delayMs: number
  ): void {
    clearWithoutApiAlertAutoRestart();
    withoutApiAlertRestartTimer = setTimeout(() => {
      withoutApiAlertRestartTimer = null;
      void performWithoutApiRestartAfterAlert(runId, alertId, source).catch((error) => {
        void recordSession("prob", "browser.search.auto_restart_failed", "Search without API auto-restart after X alert failed", {
          runId,
          alertId,
          source,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, delayMs);
  }

  async function performWithoutApiRestartAfterAlert(
    runId: string,
    alertId: number,
    source: "resolved" | "ignored" | "auto_ignored"
  ): Promise<RunRecord | null> {
    const run = runs.get(runId);
    if (!run || run.status !== "paused") {
      return null;
    }
    const startCheck = await checkWithoutApiRunStart();
    if (!startCheck.ok) {
      await recordSession("prob", "browser.search.auto_restart_blocked", "Search without API could not restart after X session alert", {
        runId,
        alertId,
        source,
        reason: startCheck.reason,
        error: startCheck.payload.error
      });
      return null;
    }
    runs.updateStats(runId, {
      browserAlertAutoRestartAt: null,
      nextApiResetAt: null
    });
    const resumed = runs.resume(runId);
    await recordSession("info", "browser.search.auto_restarted", "Search without API restarted after X session alert", {
      runId,
      alertId,
      source,
      accountId: startCheck.account.id,
      xIdentifier: startCheck.account.xIdentifier
    });
    await startWithoutApiExecution(resumed);
    return resumed;
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
      (result) => {
        timelineTweets.saveAccepted(result.keyword, result.tweet, result.decision);
        queueAcceptedTweetMediaCache(result.tweet.id, result.tweet.entities?.media?.length ?? 0);
      }
    );
    let keywords = runs.keywords(runId, 5_000).map((item) => item.keyword);
    if (keywords.length === 0) {
      const xApiConfig = getXApiConfig();
      const existingStats = parseRunStats(runs.get(runId)?.statsJson ?? "{}");
      keywords = plannedKeywords(lists, xApiConfig);
      runs.replaceKeywords(runId, keywords);
      runs.updateStats(runId, createInitialRunStats(lists, xApiConfig, keywords, runChainStateFromStats(existingStats, xApiConfig)));
    }
    let completedKeywords = Math.min(parseRunStats(runs.get(runId)?.statsJson ?? "{}").completedKeywords, keywords.length);
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
          if (isBelowMinimumSearchResults(config.enableMinimumSearchResults, count, config.minimumSearchResults)) {
            for (const keyword of keywordGroup) {
              await saveNoResultKeyword(keyword, count, config.minimumSearchResults);
            }
            await runRedditCrawl(runId, keywordGroup, xApiConfig);
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
        const isNoResultSearch = isBelowMinimumSearchResults(config.enableMinimumSearchResults, tweets.length, config.minimumSearchResults);
        if (isNoResultSearch) {
          for (const keyword of keywordGroup) {
            await saveNoResultKeyword(keyword, tweets.length, config.minimumSearchResults);
          }
        }
        const prefilterResults = isNoResultSearch ? [] : crawler.explainTweetsForHydration(query, tweets);
        const selectedTweets = prefilterResults.filter((result) => result.decision.accepted).map((result) => result.tweet);
        const prefilerRejectedTweets = isNoResultSearch ? 0 : tweets.length - selectedTweets.length;
        if (prefilerRejectedTweets > 0) {
          await recordPrefilterRejectedTweets(runId, query, tweets, selectedTweets);
        }
        if (!isNoResultSearch) {
          await maybeMoveStaleKeywordUsersFromApiTooOldResults(runId, keywordGroup, tweets, prefilterResults, xClient);
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
        await runRedditCrawl(runId, keywordGroup, xApiConfig);
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
        if (await handleXApiCreditsDepleted(error, { action: "search", runId, query, keywordGroup })) {
          runs.pause(runId);
          await runRssFallback(runId);
          return;
        }
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
      await maybeStartNextChainedRun(runId, "x_api");
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

  async function runRssFallback(
    runId: string,
    reason = "x_api_paused"
  ): Promise<Awaited<ReturnType<typeof runSharedRssFallback>>> {
    return runSharedRssFallback({
      runId,
      lists,
      timelineItems,
      feedLimit: options.config.rssFallbackFeedLimit,
      reason,
      record: recordSession
    });
  }

  async function runRedditCrawl(runId: string, keywords: string[], config = getXApiConfig()): Promise<void> {
    if (!config.redditCrawlEnabled) {
      return;
    }

    try {
      const crawler = new RedditCrawler({
        enabled: config.redditCrawlEnabled,
        userAgent: config.redditCrawlUserAgent,
        subreddits: config.redditCrawlSubreddits,
        limitPerKeyword: config.redditCrawlLimitPerKeyword,
        sort: config.redditCrawlSort,
        timeRange: config.redditCrawlTimeRange,
        minScore: config.redditCrawlMinScore
      });

      await crawlRedditKeywords({
        runId,
        keywords,
        crawler,
        timelineItems,
        record: recordSession
      });
    } catch (error) {
      await recordSession("prob", "reddit.search.failed", error instanceof Error ? error.message : "Reddit crawl failed", {
        runId,
        keywords
      });
    }
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
    const pauseMinutes = randomSearchPauseWindowMinutesForConfig(xApiConfig);
    const nextApiResetAt = new Date(Date.now() + pauseMinutes * 60_000).toISOString();
    runs.pause(runId);
    runs.updateStats(runId, {
      apiCallLimit: stats.apiCallLimit,
      apiWindowMinutes: pauseMinutes,
      currentKeyword: null,
      nextApiResetAt
    });
    await recordSession("prob", "api.limit.reached", message, {
      runId,
      ...data,
      apiWindowMinutes: pauseMinutes,
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
    const apiCallLimit = apiSearchesBeforePauseForKeywords(stats.remainingKeywords, xApiConfig);
    const pauseMinutes = searchPauseWindowMaxMinutesForConfig(xApiConfig);
    return runs.updateStats(run.id, {
      apiCallsUsed: 0,
      apiCallLimit,
      apiWindowMinutes: pauseMinutes,
      apiCallsRemaining: apiCallLimit,
      currentKeyword: null,
      nextApiResetAt: new Date(Date.now() + pauseMinutes * 60_000).toISOString()
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
        scoreBreakdown: result.decision.scoreBreakdown,
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

  async function maybeMoveStaleKeywordUsersFromApiTooOldResults(
    runId: string,
    keywordGroup: string[],
    tweets: TweetCandidate[],
    prefilterResults: ReturnType<Crawler["explainTweetsForHydration"]>,
    xClient: XApiClient
  ): Promise<void> {
    for (const keyword of keywordGroup) {
      if (!isHandleSearchKeyword(keyword)) {
        continue;
      }
      const handle = normalizeHandle(keyword);
      if (!handle) {
        continue;
      }
      const relevantTweets = tweets.filter((tweet) => tweetMentionsHandleOrComesFromHandle(tweet, handle));
      if (!relevantTweets.length) {
        continue;
      }
      const relevantTweetIds = new Set(relevantTweets.map((tweet) => tweet.id));
      const tooOldTweets = prefilterResults.filter(
        (result) => relevantTweetIds.has(result.tweet.id) && result.decision.reasons.some((reason) => reason.startsWith("tweet_too_old"))
      );
      const tooOldRatio = tooOldTweets.length / relevantTweets.length;
      if (tooOldTweets.length < 1 || tooOldRatio < 0.6) {
        continue;
      }

      await recordSession("info", "search.keyword_user_stale_check.started", "Most X API results for @keyword were too old; checking the user directly", {
        runId,
        keyword,
        handle,
        visibleTweets: relevantTweets.length,
        tooOldTweets: tooOldTweets.length,
        tooOldRatio,
        maxAgeDays: options.config.staleKeywordUserMaxAgeDays
      });

      const result = await checkKeywordUserStaleViaXApi(handle, xClient);
      if (result.status === "remove") {
        moveKeywordUserToStaleFromApi(keyword, result.reason);
        await recordSession("info", "search.keyword_user_stale_check.removed", "Keyword user moved to Stale keyword users after X API activity check", {
          runId,
          keyword,
          handle,
          ...result,
          maxAgeDays: options.config.staleKeywordUserMaxAgeDays
        });
      } else if (result.status === "keep") {
        await recordSession("debug", "search.keyword_user_stale_check.kept", "Keyword user kept because X API found recent direct activity", {
          runId,
          keyword,
          handle,
          ...result,
          maxAgeDays: options.config.staleKeywordUserMaxAgeDays
        });
      } else {
        await recordSession("prob", "search.keyword_user_stale_check.skipped", "Keyword user could not be confirmed stale through X API", {
          runId,
          keyword,
          handle,
          ...result
        });
      }
    }
  }

  async function checkKeywordUserStaleViaXApi(
    handle: string,
    xClient: XApiClient
  ): Promise<
    | { status: "remove"; reason: string; latestTweetId: string | null; latestTweetCreatedAt: string | null; ageDays: number | null }
    | { status: "keep"; reason: string; latestTweetId: string; latestTweetCreatedAt: string; ageDays: number }
    | { status: "skip"; reason: string; error?: string }
  > {
    let user: Awaited<ReturnType<XApiClient["lookupUserByUsername"]>>;
    try {
      user = await xClient.lookupUserByUsername(handle);
    } catch (error) {
      const reason = xApiUserUnavailableReason(error);
      if (reason) {
        return { status: "remove", reason, latestTweetId: null, latestTweetCreatedAt: null, ageDays: null };
      }
      return { status: "skip", reason: "x_api_user_lookup_failed", error: error instanceof Error ? error.message : String(error) };
    }

    if (!user?.id) {
      return { status: "remove", reason: "user_not_found", latestTweetId: null, latestTweetCreatedAt: null, ageDays: null };
    }
    if (user.protected) {
      return { status: "remove", reason: "protected_posts", latestTweetId: null, latestTweetCreatedAt: null, ageDays: null };
    }

    let timeline: TweetCandidate[];
    try {
      timeline = await xClient.userTimeline(user.id, 10, "minimal");
    } catch (error) {
      const reason = xApiUserUnavailableReason(error);
      if (reason) {
        return { status: "remove", reason, latestTweetId: null, latestTweetCreatedAt: null, ageDays: null };
      }
      return { status: "skip", reason: "x_api_user_timeline_failed", error: error instanceof Error ? error.message : String(error) };
    }

    const latestTweet = timeline
      .filter((tweet) => tweet.createdAt)
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))[0];
    if (!latestTweet?.createdAt) {
      return { status: "remove", reason: "no_direct_tweet_for_user", latestTweetId: null, latestTweetCreatedAt: null, ageDays: null };
    }
    const ageDays = Number(Math.max(0, (Date.now() - latestTweet.createdAt.getTime()) / 86_400_000).toFixed(2));
    if (ageDays > options.config.staleKeywordUserMaxAgeDays) {
      return {
        status: "remove",
        reason: "latest_tweet_too_old",
        latestTweetId: latestTweet.id,
        latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
        ageDays
      };
    }
    return {
      status: "keep",
      reason: "latest_tweet_within_max_age",
      latestTweetId: latestTweet.id,
      latestTweetCreatedAt: latestTweet.createdAt.toISOString(),
      ageDays
    };
  }

  function moveKeywordUserToStaleFromApi(keyword: string, reason: string): void {
    const importedAt = new Date().toISOString();
    lists.add("stale_keyword_user", keyword, `runtime:x-search-stale-check:${reason}`, null, importedAt);
    lists.markDeleted("keyword", keyword);
    lists.markDeleted("skipped_keyword_user", keyword);
    lists.markDeleted("no_result", keyword);
    lists.markDeleted("search_terms_used", keyword);
  }

  function tweetMentionsHandleOrComesFromHandle(tweet: TweetCandidate, handle: string): boolean {
    const normalizedHandle = normalizeHandle(handle);
    if (!normalizedHandle) {
      return false;
    }
    const author = normalizeHandle(tweet.user.screenName);
    return author === normalizedHandle || normalizeSearchText(tweet.text).includes(`@${normalizedHandle}`.toLowerCase());
  }

  function xApiUserUnavailableReason(error: unknown): "user_not_found" | "account_suspended" | "protected_posts" | null {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (normalized.includes("suspended")) {
      return "account_suspended";
    }
    if (normalized.includes("protected") || normalized.includes("unauthorized")) {
      return "protected_posts";
    }
    if (normalized.includes("not found") || normalized.includes("could not find") || normalized.includes("does not exist")) {
      return "user_not_found";
    }
    return null;
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

  function isBelowMinimumSearchResults(enabled: boolean, resultCount: number, minimumSearchResults: number): boolean {
    return enabled && Math.max(0, Math.floor(resultCount)) < Math.max(1, Math.floor(minimumSearchResults));
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

function isAdminLoginRoute(url: string): boolean {
  return safePath(url) === "/admin/login";
}

function normalizePublicAdminUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function applySecurityHeaders(request: FastifyRequest, reply: FastifyReply): void {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("cross-origin-opener-policy", "same-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  reply.header(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob: https://i.redd.it https://preview.redd.it https://external-preview.redd.it https://*.redditmedia.com",
      "media-src 'self' blob: https://i.redd.it https://v.redd.it https://preview.redd.it https://external-preview.redd.it https://*.redditmedia.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; ")
  );
  if (isHttpsRequest(request)) {
    reply.header("strict-transport-security", "max-age=15552000; includeSubDomains");
  }
}

function isAdminMutationRequest(request: FastifyRequest): boolean {
  return request.url.startsWith("/admin") && ["DELETE", "PATCH", "POST", "PUT"].includes(request.method);
}

function isTimelineMutationRequest(request: FastifyRequest): boolean {
  return isTimelineProtectedPath(safePath(request.url)) && ["DELETE", "PATCH", "POST", "PUT"].includes(request.method);
}

function isTimelineProtectedPath(pathName: string): boolean {
  if (pathName === "/timeline/login") {
    return false;
  }
  return (
    pathName === "/timeline" ||
    pathName === "/raw-timeline" ||
    pathName === "/rejected-timeline" ||
    pathName === "/timeline/data" ||
    pathName === "/timeline/archive" ||
    pathName === "/timeline/archive/restore" ||
    pathName.startsWith("/timeline/items/") ||
    pathName === "/raw-timeline/data" ||
    pathName === "/rejected-timeline/data" ||
    pathName === "/timeline/auth" ||
    pathName === "/timeline/logout" ||
    pathName.startsWith("/timeline/lists/") ||
    pathName.startsWith("/timeline/tweets/") ||
    pathName.startsWith("/timeline/media-cache/jobs/") ||
    pathName === "/timeline/rejected-timeline" ||
    pathName === "/timeline/rejected-timeline/accept" ||
    pathName.startsWith("/media-cache/")
  );
}

function isSameOriginMutationRequest(request: FastifyRequest): boolean {
  const fetchSite = headerValue(request.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") {
    return false;
  }

  const host = headerValue(request.headers.host);
  if (!host) {
    return true;
  }

  const origin = headerValue(request.headers.origin);
  if (origin) {
    return originMatchesHost(origin, host);
  }

  const referer = headerValue(request.headers.referer);
  if (referer) {
    try {
      return originMatchesHost(new URL(referer).origin, host);
    } catch {
      return false;
    }
  }

  return true;
}

function hasValidCsrfToken(request: FastifyRequest): boolean {
  const cookieToken = request.cookies[csrfCookieName];
  const headerToken = headerValue(request.headers[csrfHeaderName]);
  if (!cookieToken || !headerToken) {
    return false;
  }
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  return cookieBuffer.length === headerBuffer.length && crypto.timingSafeEqual(cookieBuffer, headerBuffer);
}

function isTrustedMtlsProxyRequest(request: FastifyRequest, secret: string | undefined): boolean {
  if (!secret) {
    return true;
  }
  const actual = headerValue(request.headers[mtlsProxySecretHeaderName]);
  if (!actual) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(secret);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isTrustedMtlsProxySourceAddress(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, "").toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "::1") {
    return true;
  }
  // Docker bridge gateways normally reach published 127.0.0.1 ports from 172.16.0.0/12.
  const dockerBridgeMatch = normalized.match(/^172\.(\d{1,2})\./);
  if (dockerBridgeMatch) {
    const secondOctet = Number(dockerBridgeMatch[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

function redactEnvValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, envSecretKeys.has(key) && value ? redactedEnvValue : value])
  );
}

function isHttpsRequest(request: FastifyRequest): boolean {
  const forwardedProto = headerValue(request.headers["x-forwarded-proto"])?.split(",")[0]?.trim().toLowerCase();
  return forwardedProto === "https" || Boolean((request.raw.socket as { encrypted?: boolean }).encrypted);
}

function originMatchesHost(origin: string, host: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
  const vpnDirectory = path.resolve(process.cwd(), "ops/vpn");
  const vpnRelative = path.relative(vpnDirectory, resolved);
  if (vpnRelative.startsWith("..") || path.isAbsolute(vpnRelative)) {
    throw new Error("File copy target must stay inside ./ops/vpn.");
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

interface RunChainState {
  total: number;
  index: number;
  remaining: number;
}

function initialRunChainState(config: { runChainCount?: number }): RunChainState {
  void config;
  return { total: 1, index: 1, remaining: 0 };
}

function runChainTotalFromAdditionalCount(config: { runChainCount?: number }): number {
  return keywordBatchMultiplierFromRunChainCount(config.runChainCount);
}

function nextRunChainState(stats: RunStats, config: { runChainCount?: number }): RunChainState | null {
  void stats;
  void config;
  return null;
}

function runChainLogData(stats: RunStats, config: { runChainCount?: number }): Record<string, number | null> {
  void stats;
  void config;
  return {
    runChainTotal: 1,
    runChainIndex: 1,
    runChainRemaining: 0
  };
}

function runChainStateFromStats(stats: RunStats, config: { runChainCount?: number }): RunChainState {
  void stats;
  return initialRunChainState(config);
}

function runChainSummaryFromStats(stats: RunStats): {
  total: number;
  index: number;
  remaining: number;
  queuedRuns: number;
  queuedKeywords: number;
} {
  void stats;
  return {
    total: 1,
    index: 1,
    remaining: 0,
    queuedRuns: 0,
    queuedKeywords: 0
  };
}

function currentRunKeywordPlanPreview(
  runs: RunService,
  run: RunRecord
): {
  runCount: number;
  previews: Array<{ runIndex: number; plannedKeywords: number; sample: string[]; status: "active" | "queued" }>;
} {
  const stats = parseRunStats(run.statsJson);
  const chain = runChainSummaryFromStats(stats);
  const currentKeywords = runs.keywords(run.id, 5_000).map((item) => item.keyword);

  const previews: Array<{ runIndex: number; plannedKeywords: number; sample: string[]; status: "active" | "queued" }> = [
    {
      runIndex: chain.index,
      plannedKeywords: Math.max(currentKeywords.length, Math.floor(stats.totalKeywords ?? 0)),
      sample: currentKeywords,
      status: "active"
    },
  ];

  return {
    runCount: Math.max(chain.total, previews.length),
    previews
  };
}

type KeywordPlanConfig = {
  runChainCount?: number;
  searchWithoutApiSessionKeywordLimit?: number;
  searchWithoutApiSessionKeywordLimitRandom?: boolean;
  searchWithoutApiRandomizeKeywordOrder?: boolean;
  searchWithoutApiUserKeywordPercent?: number;
};

interface KeywordPlanOptions {
  deterministic?: boolean;
  multiplier?: number;
}

function plannedKeywordChain(
  lists: ListService,
  config: KeywordPlanConfig,
  options: KeywordPlanOptions = {}
): {
  keywords: string[];
  futureBatches: string[][];
  chain: RunChainState;
  batches: Array<{ runIndex: number; keywords: string[] }>;
} {
  const keywords = plannedKeywords(lists, config, {
    ...options,
    multiplier: options.multiplier ?? runChainTotalFromAdditionalCount(config)
  });
  const batches = [{ runIndex: 1, keywords }]
    .filter((batch) => batch.keywords.length > 0)
    .map((batch, index) => ({ runIndex: index + 1, keywords: batch.keywords }));
  if (batches.length === 0) {
    return {
      keywords: [],
      futureBatches: [],
      chain: { total: 1, index: 1, remaining: 0 },
      batches: [{ runIndex: 1, keywords: [] }]
    };
  }

  return {
    keywords: batches[0]?.keywords ?? [],
    futureBatches: [],
    chain: { total: 1, index: 1, remaining: 0 },
    batches
  };
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

function normalizeRunChainKeywordBatches(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((batch): batch is unknown[] => Array.isArray(batch))
    .map((batch) => batch.map((keyword) => String(keyword).trim()).filter(Boolean))
    .filter((batch) => batch.length > 0);
}

function createInitialRunStats(
  lists: ListService,
  config: Pick<XApiRuntimeConfig, "xSearchApiCallLimit" | "xSearchApiWindowMinutes" | "xKeywordsPerQuery"> &
    Partial<
      Pick<
        XApiRuntimeConfig,
        | "searchWithoutApiEnabled"
        | "searchWithoutApiSessionKeywordLimit"
        | "searchWithoutApiSessionKeywordLimitRandom"
        | "searchWithoutApiRandomizeKeywordOrder"
        | "searchWithoutApiUserKeywordPercent"
        | "searchWithoutApiAutoIgnoreAlert"
        | "searchWithoutApiMaxRetries"
        | "searchWithoutApiAutoRestartDelaySeconds"
        | "searchWithoutApiRequestsBeforePauseMin"
        | "searchWithoutApiPauseMinMinutes"
        | "searchWithoutApiPauseMaxMinutes"
        | "runChainCount"
      >
    >,
  plannedKeywordList?: string[],
  runChain = initialRunChainState(config),
  runChainKeywordBatches: string[][] = []
): RunStats {
  const apiWindowMinutes = searchPauseWindowMaxMinutesForConfig(config);
  const availableKeywords = plannedKeywords(lists, config, { deterministic: true }).length;
  const keywords = plannedKeywordList ?? plannedKeywords(lists, config);
  const configuredLimit = config.searchWithoutApiSessionKeywordLimit ?? 0;
  const totalKeywords = keywords.length;
  const apiCallLimit = config.searchWithoutApiEnabled
    ? searchesBeforePauseForKeywords(totalKeywords, config)
    : apiSearchesBeforePauseForKeywords(totalKeywords, config);
  const stats: RunStats = {
    currentKeyword: null,
    totalKeywords,
    completedKeywords: 0,
    remainingKeywords: totalKeywords,
    availableKeywords,
    sessionKeywordLimit: config.searchWithoutApiEnabled ? configuredLimit : null,
    sessionKeywordLimitRandom: config.searchWithoutApiSessionKeywordLimitRandom ?? false,
    randomizeKeywordOrder: config.searchWithoutApiRandomizeKeywordOrder ?? false,
    userKeywordPercent: config.searchWithoutApiUserKeywordPercent ?? 100,
    runChainTotal: runChain.total,
    runChainIndex: runChain.index,
    runChainRemaining: runChain.remaining,
    apiCallsUsed: 0,
    apiCallLimit,
    apiCallsRemaining: apiCallLimit,
    apiWindowMinutes,
    nextApiResetAt: null,
    browserAlertAutoIgnore: config.searchWithoutApiEnabled ? config.searchWithoutApiAutoIgnoreAlert ?? false : false,
    browserAlertRetryCount: 0,
    browserAlertMaxRetries: config.searchWithoutApiEnabled ? config.searchWithoutApiMaxRetries ?? 0 : 0,
    browserAlertAutoRestartDelaySeconds: config.searchWithoutApiEnabled ? config.searchWithoutApiAutoRestartDelaySeconds ?? 0 : 0,
    browserAlertAutoRestartAt: null,
    browserAlertLastCompletedKeywords: null,
    acceptedTweets: 0,
    rejectedTweets: 0,
    lastScore: null,
    lastTweetId: null
  };
  const normalizedBatches = normalizeRunChainKeywordBatches(runChainKeywordBatches);
  if (normalizedBatches.length > 0) {
    stats.runChainKeywordBatches = normalizedBatches;
  }
  return stats;
}

function searchesBeforePauseForKeywords(
  remainingKeywords: number,
  config: { searchWithoutApiRequestsBeforePauseMin?: number }
): number {
  const remaining = Math.max(0, Math.floor(remainingKeywords));
  if (remaining <= 0) {
    return 0;
  }
  const manualMin = Math.max(1, Math.floor(config.searchWithoutApiRequestsBeforePauseMin ?? 1));
  return manualMin;
}

function apiSearchesBeforePauseForKeywords(
  remainingKeywords: number,
  config: {
    searchWithoutApiRequestsBeforePauseMin?: number;
    xKeywordsPerQuery?: number;
    xSearchApiCallLimit?: number;
  }
): number {
  const keywordLimit = searchesBeforePauseForKeywords(remainingKeywords, config);
  if (keywordLimit <= 0) {
    return 0;
  }
  const keywordsPerSearch = Math.max(1, Math.floor(config.xKeywordsPerQuery ?? 1));
  const pacingLimit = Math.max(1, Math.ceil(keywordLimit / keywordsPerSearch));
  const apiLimit = Math.max(1, Math.floor(config.xSearchApiCallLimit ?? pacingLimit));
  return Math.min(apiLimit, pacingLimit);
}

function searchPauseWindowMaxMinutesForConfig(config: {
  searchWithoutApiPauseMinMinutes?: number;
  searchWithoutApiPauseMaxMinutes?: number;
  xSearchApiWindowMinutes?: number;
}): number {
  const fallback = Math.max(0, Math.floor(config.xSearchApiWindowMinutes ?? 15));
  return Math.max(0, Math.floor(config.searchWithoutApiPauseMaxMinutes ?? fallback));
}

function randomSearchPauseWindowMinutesForConfig(config: {
  searchWithoutApiPauseMinMinutes?: number;
  searchWithoutApiPauseMaxMinutes?: number;
  xSearchApiWindowMinutes?: number;
}): number {
  const fallback = searchPauseWindowMaxMinutesForConfig(config);
  const min = Math.max(0, Math.floor(config.searchWithoutApiPauseMinMinutes ?? fallback));
  const max = Math.max(min, searchPauseWindowMaxMinutesForConfig(config));
  return min === max ? max : randomInt(min, max);
}

function plannedKeywords(
  lists: ListService,
  config?: KeywordPlanConfig,
  options: KeywordPlanOptions = {}
): string[] {
  return plannedKeywordBatches(lists, config, 1, options)[0]?.keywords ?? [];
}

function plannedKeywordBatches(
  lists: ListService,
  config: KeywordPlanConfig | undefined,
  count: number,
  options: KeywordPlanOptions = {}
): Array<{ runIndex: number; keywords: string[] }> {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue));
  let remainingKeywords = lists
    .activeValues("keyword")
    .filter((keyword) => {
      const normalized = normalizeValue(keyword);
      return normalized.length > 0 && !noResults.has(normalized) && !alreadyUsed.has(normalized);
    });
  const totalBatches = Math.max(1, Math.floor(count));
  const batches: Array<{ runIndex: number; keywords: string[] }> = [];
  const multiplier = Math.max(1, Math.floor(options.multiplier ?? runChainTotalFromAdditionalCount(config ?? {})));

  for (let runIndex = 1; runIndex <= totalBatches; runIndex += 1) {
    const orderedKeywords = config?.searchWithoutApiRandomizeKeywordOrder && !options.deterministic
      ? shuffleKeywordList(remainingKeywords)
      : remainingKeywords;
    const configuredLimit = Math.max(0, Math.floor(config?.searchWithoutApiSessionKeywordLimit ?? 0));
    const totalKeywords = plannedKeywordSelectionCount(
      orderedKeywords.length,
      configuredLimit,
      multiplier,
      Boolean(config?.searchWithoutApiSessionKeywordLimitRandom) && !options.deterministic
    );
    const keywords = applyUserKeywordPercent(orderedKeywords, totalKeywords, config?.searchWithoutApiUserKeywordPercent);
    batches.push({ runIndex, keywords });

    if (keywords.length === 0) {
      remainingKeywords = [];
      continue;
    }
    const usedInPreview = new Set(keywords.map(normalizeValue));
    remainingKeywords = remainingKeywords.filter((keyword) => !usedInPreview.has(normalizeValue(keyword)));
  }

  return batches;
}

function plannedKeywordSelectionCount(
  available: number,
  configuredLimit: number,
  multiplier: number,
  randomize: boolean
): number {
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
    const fallback = indexedKeywords.filter(({ index }) => !selectedIndexes.has(index)).slice(0, total - selected.length);
    selected.push(...fallback);
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .slice(0, total)
    .map(({ keyword }) => keyword);
}

function shuffleKeywordList(keywords: string[]): string[] {
  const shuffled = [...keywords];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function keywordAvailability(lists: ListService) {
  const noResults = new Set(lists.activeValues("no_result").map(normalizeValue).filter(Boolean));
  const alreadyUsed = new Set(lists.activeValues("search_terms_used").map(normalizeValue).filter(Boolean));
  const keywords = Array.from(new Set(lists.activeValues("keyword").map((keyword) => normalizeValue(keyword)).filter(Boolean)));

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

function keywordAvailabilityLogData(availability: ReturnType<typeof keywordAvailability>) {
  return {
    keywordTotal: availability.totalKeywords,
    availableKeywords: availability.availableKeywords,
    noResultKeywords: availability.noResultEntries,
    searchTermsUsedKeywords: availability.searchTermsUsedEntries,
    excludedNoResultKeywords: availability.excludedByNoResult,
    excludedAlreadySearchedKeywords: availability.excludedBySearchTermsUsed
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
      configKey === "searchWithoutApiAutoIgnoreAlert" ||
      configKey === "searchWithoutApiSaveSnapshots" ||
      configKey === "searchWithoutApiMediaCacheEnabled" ||
      configKey === "staleKeywordUserAutoIgnoreAlert" ||
      configKey === "rawTimelineEnabled" ||
      configKey === "xLoginReuseBrowserProfile" ||
      configKey === "xLoginSkipNetworkPrecheck" ||
      configKey === "xCountFirstMode" ||
      configKey === "vpnCheckHostIpv4Leak" ||
      configKey === "vpnCheckIpv6" ||
      configKey === "vpnDiagnosticStrict" ||
      configKey === "vpnDiagnosticPlaywright" ||
      configKey === "playwrightDisableSandbox" ||
      configKey === "redditCrawlEnabled"
    ) {
      config[configKey] = value === "true";
    } else if (configKey === "searchWithoutApiMouseProfile") {
      config[configKey] = z.enum(["smooth1", "smooth2", "smooth3"]).parse(value);
    } else if (configKey === "searchWithoutApiIsolation") {
      config[configKey] = z.enum(["host_netns", "docker_vpn"]).parse(value);
    } else if (configKey === "xLoginSaveMode") {
      config[configKey] = z.enum(["auto", "cdp", "profile"]).parse(value);
    } else if (configKey === "xLoginBrowser") {
      config[configKey] = z.enum(["chrome", "firefox"]).parse(value);
    } else if (configKey === "vpnRemoteProto") {
      config[configKey] = z.enum(["udp", "tcp"]).parse(value);
    } else if (configKey === "redditCrawlSort") {
      config[configKey] = z.enum(["relevance", "hot", "top", "new", "comments"]).parse(value);
    } else if (configKey === "redditCrawlTimeRange") {
      config[configKey] = z.enum(["hour", "day", "week", "month", "year", "all"]).parse(value);
    } else if (configKey === "redditCrawlSubreddits") {
      config[configKey] = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (
      configKey === "searchWithoutApiProfileDir" ||
      configKey === "searchWithoutApiStartUrl" ||
      configKey === "searchWithoutApiMediaCacheDir" ||
      configKey === "xLoginStartUrl" ||
      configKey === "xLoginScreen" ||
      configKey === "vpnNetnsName" ||
      configKey === "vpnHostIface" ||
      configKey === "vpnNetnsCidr" ||
      configKey === "vpnNetnsHostIp" ||
      configKey === "vpnNetnsGuestIp" ||
      configKey === "vpnRemoteHost" ||
      configKey === "vpnConfig" ||
      configKey === "playwrightChromiumExecutablePath" ||
      configKey === "redditCrawlUserAgent"
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

function databasePathForChild(database: Database): string | undefined {
  const name = (database as unknown as { name?: string }).name;
  if (name && name !== ":memory:") return name;
  return process.env.DATABASE_URL;
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

async function checkLegacyNetnsHostVeth(): Promise<{
  interfaceName: string;
  checked: boolean;
  present: boolean;
  error?: string;
}> {
  try {
    await execFileAsync("ip", ["link", "show", legacyNetnsHostVethName], {
      timeout: 2_000,
      maxBuffer: 100_000
    });
    return { interfaceName: legacyNetnsHostVethName, checked: true, present: true };
  } catch (error) {
    if (isMissingNetworkDeviceError(error)) {
      return { interfaceName: legacyNetnsHostVethName, checked: true, present: false };
    }
    return {
      interfaceName: legacyNetnsHostVethName,
      checked: false,
      present: false,
      error: commandErrorSummary(error)
    };
  }
}

function isMissingNetworkDeviceError(error: unknown): boolean {
  const output = commandErrorOutput(error).toLowerCase();
  return output.includes("does not exist") || output.includes("cannot find device") || output.includes("device not found");
}

function commandErrorSummary(error: unknown): string {
  return firstLine(commandErrorOutput(error)).slice(0, 500);
}

function commandErrorOutput(error: unknown): string {
  const commandError = error as { stdout?: unknown; stderr?: unknown; message?: unknown; code?: unknown };
  const stderr = typeof commandError.stderr === "string" ? commandError.stderr : "";
  const stdout = typeof commandError.stdout === "string" ? commandError.stdout : "";
  const message =
    typeof commandError.message === "string" ? commandError.message : error instanceof Error ? error.message : String(error);
  const code = typeof commandError.code === "string" ? commandError.code : "";
  return [stderr, stdout, message, code].filter(Boolean).join("\n");
}

type SafeCommandResult = {
  available: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

type IpCount = {
  ip: string;
  count: number;
};

async function systemHealthReport() {
  const since = "30 days ago";
  const hostReport = await readVpsHealthReport();
  if (hostReport) {
    return {
      ...hostReport,
      environment: {
        ...(typeof hostReport.environment === "object" && hostReport.environment ? hostReport.environment : {}),
        inDocker: fsSync.existsSync("/.dockerenv"),
        containerHost: os.hostname(),
        source: "host-collector"
      }
    };
  }

  if (fsSync.existsSync("/.dockerenv")) {
    const unavailableMessage =
      "Host health collector not configured. Run node scripts/vps-health-collect.cjs /opt/RedqueenX/runtime/docker/vps-health.json on the VPS host.";
    return {
      generatedAt: new Date().toISOString(),
      environment: {
        inDocker: true,
        cwd: process.cwd(),
        host: os.hostname(),
        source: "container-fallback",
        reportPath: vpsHealthReportPath()
      },
      services: ["docker", "caddy", "redqueenx-webhook"].map((name) => ({
        name,
        available: false,
        status: "host collector required",
        error: unavailableMessage
      })),
      ssh: { available: false, window: since, failedAttempts: 0, acceptedLogins: 0, topIps: [] as IpCount[], loginIps: [] as IpCount[], error: unavailableMessage },
      fail2ban: {
        available: false,
        jails: [] as string[],
        sshd: { currentlyBanned: 0, totalBanned: 0, bannedIps: [] as string[] },
        error: unavailableMessage
      },
      caddy: { available: false, window: since, suspiciousRequests: 0, topIps: [] as IpCount[], error: unavailableMessage },
      webhook: { available: false, window: since, posts: 0, invalidSignatures: 0, errors: 0, topIps: [] as IpCount[], error: unavailableMessage },
      docker: { available: false, services: [] as Array<{ name: string; status: string }>, error: unavailableMessage }
    };
  }

  const [docker, caddy, webhook, ssh, fail2ban, dockerCompose] = await Promise.all([
    serviceStatus("docker"),
    serviceStatus("caddy"),
    serviceStatus("redqueenx-webhook"),
    sshHealth(since),
    fail2banHealth(),
    dockerComposeHealth()
  ]);
  const caddyScan = await caddyScanHealth(since);
  const webhookActivity = await webhookHealth(since);

  return {
    generatedAt: new Date().toISOString(),
    environment: {
      inDocker: fsSync.existsSync("/.dockerenv"),
      cwd: process.cwd(),
      host: os.hostname()
    },
    services: [docker, caddy, webhook],
    ssh,
    fail2ban,
    caddy: caddyScan,
    webhook: webhookActivity,
    docker: dockerCompose
  };
}

async function readVpsHealthReport(): Promise<Record<string, unknown> | null> {
  const reportPath = vpsHealthReportPath();
  try {
    const content = await fs.readFile(reportPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.generatedAt !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("Failed to read VPS health report", { reportPath, error: commandErrorSummary(error) });
    }
    return null;
  }
}

function vpsHealthReportPath(): string {
  return path.resolve(process.env.VPS_HEALTH_REPORT_PATH || path.join(process.cwd(), "runtime/vps-health.json"));
}

async function serviceStatus(name: string) {
  const result = await safeExec("systemctl", ["is-active", name], 3_000, 100_000);
  return {
    name,
    available: result.available,
    status: result.available ? firstLine(result.stdout || result.stderr || "unknown") || "unknown" : "unavailable",
    error: result.error
  };
}

async function sshHealth(since: string) {
  const result = await safeExec("journalctl", ["-u", "ssh", "-u", "sshd", "--since", since, "--no-pager", "-o", "cat"], 8_000);
  if (!result.available) {
    return { available: false, window: since, failedAttempts: 0, topIps: [] as IpCount[], error: result.error };
  }
  const failedPattern = /Failed password|Invalid user|authentication failure|Connection closed by authenticating user/i;
  const failedLines = result.stdout
    .split(/\r?\n/)
    .filter((line) => failedPattern.test(line));
  const acceptedPattern = /Accepted password|Accepted publickey|Accepted keyboard-interactive/i;
  const acceptedLines = result.stdout
    .split(/\r?\n/)
    .filter((line) => acceptedPattern.test(line));
  return {
    available: true,
    window: since,
    failedAttempts: failedLines.length,
    acceptedLogins: acceptedLines.length,
    topIps: topIpCounts(failedLines.join("\n")),
    loginIps: topIpCounts(acceptedLines.join("\n")),
    error: result.stderr ? firstLine(result.stderr) : undefined
  };
}

async function fail2banHealth() {
  const [summary, sshd] = await Promise.all([
    safeExec("fail2ban-client", ["status"], 5_000),
    safeExec("fail2ban-client", ["status", "sshd"], 5_000)
  ]);
  if (!summary.available && !sshd.available) {
    return {
      available: false,
      jails: [] as string[],
      sshd: { currentlyBanned: 0, totalBanned: 0, bannedIps: [] as string[] },
      error: summary.error || sshd.error
    };
  }
  const sshdText = sshd.stdout || "";
  return {
    available: true,
    jails: parseFail2banJails(summary.stdout),
    sshd: {
      currentlyBanned: parseNumberAfterLabel(sshdText, "Currently banned"),
      totalBanned: parseNumberAfterLabel(sshdText, "Total banned"),
      bannedIps: parseFail2banBannedIps(sshdText)
    },
    error: !sshd.available ? sshd.error : undefined
  };
}

async function caddyScanHealth(since: string) {
  const result = await safeExec("journalctl", ["-u", "caddy", "--since", since, "--no-pager", "-o", "cat"], 8_000, 4_000_000);
  if (!result.available) {
    return { available: false, window: since, suspiciousRequests: 0, topIps: [] as IpCount[], error: result.error };
  }
  const suspiciousPattern =
    /\.env|wp-login\.php|xmlrpc\.php|phpmyadmin|phpMyAdmin|cgi-bin|boaform|HNAP1|vendor\/phpunit|actuator|server-status|\.git|\.aws|config\.json/i;
  const suspiciousLines = result.stdout
    .split(/\r?\n/)
    .filter((line) => suspiciousPattern.test(line));
  return {
    available: true,
    window: since,
    suspiciousRequests: suspiciousLines.length,
    topIps: topIpCounts(suspiciousLines.join("\n"))
  };
}

async function webhookHealth(since: string) {
  const result = await safeExec("journalctl", ["-u", "redqueenx-webhook", "--since", since, "--no-pager", "-o", "cat"], 8_000);
  if (!result.available) {
    return { available: false, window: since, posts: 0, invalidSignatures: 0, errors: 0, topIps: [] as IpCount[], error: result.error };
  }
  return {
    available: true,
    window: since,
    posts: countMatches(result.stdout, /incoming HTTP POST|POST \/hooks/gi),
    invalidSignatures: countMatches(result.stdout, /invalid payload signatures/gi),
    errors: countMatches(result.stdout, /error evaluating hook|error occurred|error in exec/gi),
    topIps: topIpCounts(result.stdout)
  };
}

async function dockerComposeHealth() {
  const result = await safeExec("docker", ["compose", "-f", "compose.prod.yaml", "ps"], 6_000, 500_000);
  if (!result.available) {
    return { available: false, services: [] as Array<{ name: string; status: string }>, error: result.error };
  }
  const services = result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s{2,}/);
      return {
        name: parts[0] || line,
        status: parts.find((part) => /\b(Up|Exited|Restarting|Created|Paused)\b/i.test(part)) || parts.at(-1) || "unknown"
      };
    });
  return { available: true, services };
}

async function safeExec(command: string, args: string[], timeout = 5_000, maxBuffer = 2_000_000): Promise<SafeCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      maxBuffer
    });
    return { available: true, stdout, stderr };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: code !== "ENOENT",
      stdout: typeof (error as { stdout?: unknown }).stdout === "string" ? String((error as { stdout?: unknown }).stdout) : "",
      stderr: typeof (error as { stderr?: unknown }).stderr === "string" ? String((error as { stderr?: unknown }).stderr) : "",
      error: commandErrorSummary(error)
    };
  }
}

function topIpCounts(text: string, limit = 30): IpCount[] {
  const counts = new Map<string, number>();
  for (const ip of extractIps(text)) {
    counts.set(ip, (counts.get(ip) || 0) + 1);
  }
  return Array.from(counts, ([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip))
    .slice(0, limit);
}

function extractIps(text: string): string[] {
  const ips = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return ips.filter((ip) => ip.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255));
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function parseNumberAfterLabel(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:\\s*(\\d+)`, "i"));
  return match ? Number(match[1]) : 0;
}

function parseFail2banJails(text: string): string[] {
  const match = text.match(/Jail list:\s*(.+)$/im);
  if (!match) return [];
  return match[1].split(/,\s*/).map((jail) => jail.trim()).filter(Boolean);
}

function parseFail2banBannedIps(text: string): string[] {
  const match = text.match(/Banned IP list:\s*(.*)$/im);
  if (!match || !match[1].trim()) return [];
  return extractIps(match[1]);
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

function safeJobPathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "job"
  );
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
  | "SEARCH_WITHOUT_API_ISOLATION"
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
  | "SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT"
  | "SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT"
  | "SEARCH_WITHOUT_API_MAX_RETRIES"
  | "SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS"
  | "SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN"
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
  | "TIMELINE_DEFAULT_PAGE_SIZE"
  | "RUN_CHAIN_COUNT"
  | "STALE_KEYWORD_USER_MAX_AGE_DAYS"
  | "STALE_KEYWORD_USER_START_INDEX"
  | "STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS"
  | "STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS"
  | "STALE_KEYWORD_USER_AUTO_IGNORE_ALERT"
  | "STALE_KEYWORD_USER_MAX_RETRIES"
  | "STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS"
  | "RAW_TIMELINE_ENABLED"
  | "X_LOGIN_NOVNC_PORT"
  | "X_LOGIN_SCREEN"
  | "X_LOGIN_SERVICE_MAX_SECONDS"
  | "X_LOGIN_BROWSER"
  | "X_LOGIN_SAVE_MODE"
  | "X_LOGIN_START_URL"
  | "X_LOGIN_REUSE_BROWSER_PROFILE"
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
  | "REDDIT_CRAWL_ENABLED"
  | "REDDIT_CRAWL_USER_AGENT"
  | "REDDIT_CRAWL_SUBREDDITS"
  | "REDDIT_CRAWL_LIMIT_PER_KEYWORD"
  | "REDDIT_CRAWL_SORT"
  | "REDDIT_CRAWL_TIME_RANGE"
  | "REDDIT_CRAWL_MIN_SCORE"
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
  ["SEARCH_WITHOUT_API_ISOLATION", "searchWithoutApiIsolation"],
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
  ["SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT", "searchWithoutApiUserKeywordPercent"],
  ["SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT", "searchWithoutApiAutoIgnoreAlert"],
  ["SEARCH_WITHOUT_API_MAX_RETRIES", "searchWithoutApiMaxRetries"],
  ["SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS", "searchWithoutApiAutoRestartDelaySeconds"],
  ["SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN", "searchWithoutApiRequestsBeforePauseMin"],
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
  ["TIMELINE_DEFAULT_PAGE_SIZE", "timelineDefaultPageSize"],
  ["RUN_CHAIN_COUNT", "runChainCount"],
  ["STALE_KEYWORD_USER_MAX_AGE_DAYS", "staleKeywordUserMaxAgeDays"],
  ["STALE_KEYWORD_USER_START_INDEX", "staleKeywordUserStartIndex"],
  ["STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS", "staleKeywordUserActionDelayMinSeconds"],
  ["STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS", "staleKeywordUserActionDelayMaxSeconds"],
  ["STALE_KEYWORD_USER_AUTO_IGNORE_ALERT", "staleKeywordUserAutoIgnoreAlert"],
  ["STALE_KEYWORD_USER_MAX_RETRIES", "staleKeywordUserMaxRetries"],
  ["STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS", "staleKeywordUserAutoRestartDelaySeconds"],
  ["RAW_TIMELINE_ENABLED", "rawTimelineEnabled"],
  ["X_LOGIN_NOVNC_PORT", "xLoginNovncPort"],
  ["X_LOGIN_SCREEN", "xLoginScreen"],
  ["X_LOGIN_SERVICE_MAX_SECONDS", "xLoginServiceMaxSeconds"],
  ["X_LOGIN_BROWSER", "xLoginBrowser"],
  ["X_LOGIN_SAVE_MODE", "xLoginSaveMode"],
  ["X_LOGIN_START_URL", "xLoginStartUrl"],
  ["X_LOGIN_REUSE_BROWSER_PROFILE", "xLoginReuseBrowserProfile"],
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
  ["REDDIT_CRAWL_ENABLED", "redditCrawlEnabled"],
  ["REDDIT_CRAWL_USER_AGENT", "redditCrawlUserAgent"],
  ["REDDIT_CRAWL_SUBREDDITS", "redditCrawlSubreddits"],
  ["REDDIT_CRAWL_LIMIT_PER_KEYWORD", "redditCrawlLimitPerKeyword"],
  ["REDDIT_CRAWL_SORT", "redditCrawlSort"],
  ["REDDIT_CRAWL_TIME_RANGE", "redditCrawlTimeRange"],
  ["REDDIT_CRAWL_MIN_SCORE", "redditCrawlMinScore"],
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

function getTimelineListKindParam(params: unknown, adminAuthenticated: boolean): ListKind | null {
  const kind = getKindParam(params);
  if (kind === "banned_user" || kind === "banned_word" || kind === "banned_word_exception" || kind === "suggested_keyword") {
    return kind;
  }
  return kind === "keyword" && adminAuthenticated ? kind : null;
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

function listExportFilename(kind: (typeof LIST_KINDS)[number]): string {
  return legacyFilenameByKind.get(kind) ?? `${kind}.txt`;
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

function xSessionAlertSnapshotRoot(): string {
  return path.resolve(process.cwd(), "runtime", "x-session-alert-snapshots");
}

async function readXSessionAlertSnapshot(alert: { details?: Record<string, unknown> | null }) {
  const snapshotPath = typeof alert.details?.snapshotPath === "string" ? alert.details.snapshotPath : "";
  if (!snapshotPath) {
    throw new Error("This alert has no captured snapshot file.");
  }

  const root = xSessionAlertSnapshotRoot();
  const absolutePath = path.resolve(process.cwd(), snapshotPath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid X session alert snapshot path.");
  }

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("X session alert snapshot not found.");
  }

  const raw = await fs.readFile(absolutePath, "utf8");
  return {
    path: `./${path.relative(process.cwd(), absolutePath)}`,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
    snapshot: safeJsonObject(raw),
    raw
  };
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
  return reply.type("text/html").send(injectAppFooter(content));
}

let cachedAppFooter: string | null = null;

function injectAppFooter(content: string): string {
  if (!content.includes("</main>")) {
    return content;
  }
  return content.replace("</main>", `${appFooterHtml()}\n  </main>`);
}

function appFooterHtml(): string {
  cachedAppFooter ??= renderAppFooter(resolveLastCommitInfo());
  return cachedAppFooter;
}

function renderAppFooter(commit: { date: string; sha: string | null }): string {
  const title = commit.sha ? ` title="Commit ${escapeHtml(commit.sha)}"` : "";
  return `\n    <footer class="app-footer"${title}>Last commit: ${escapeHtml(commit.date)}</footer>`;
}

function resolveLastCommitInfo(): { date: string; sha: string | null } {
  const envDate = cleanBuildMetadataValue(process.env.REDQUEENX_BUILD_COMMIT_DATE);
  const envSha = cleanBuildMetadataValue(process.env.REDQUEENX_BUILD_COMMIT_SHA);
  if (envDate) {
    return { date: formatCommitDate(envDate), sha: envSha };
  }

  try {
    const date = execFileSync("git", ["log", "-1", "--format=%cI"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 1_000
    }).trim();
    const sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 1_000
    }).trim();
    return { date: formatCommitDate(date), sha };
  } catch {
    return { date: formatCommitDate(resolveRuntimeBuildDate()), sha: envSha };
  }
}

function cleanBuildMetadataValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }
  return trimmed;
}

function resolveRuntimeBuildDate(): string {
  try {
    return fsSync.statSync(__filename).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function formatCommitDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const timeZone = process.env.TZ?.trim() || "Europe/Paris";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short"
  }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
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
