import path from "node:path";
import { z } from "zod";
import { parseAccessListInput } from "./admin/serverAccess";

const envSchema = z.object({
  ADMIN_HOST: z.string().default("0.0.0.0"),
  ADMIN_PORT: z.coerce.number().int().positive().default(3005),
  ADMIN_TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ADMIN_AUTH_MODE: z.enum(["password", "mtls_proxy"]).default("password"),
  ADMIN_MTLS_PROXY_SECRET: z.string().default(""),
  ADMIN_PUBLIC_URL: z
    .string()
    .default("")
    .transform((value) => value.trim()),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  SESSION_SECRET: z.string().default("redqueenx-dev-session-secret"),
  DATABASE_URL: z.string().default("./redqueenx.sqlite"),
  CURRENT_SESSION_FILE: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value : "./runtime/current-session.log")),
  ADMIN_IPV4_WHITELIST: z.string().default(""),
  ADMIN_IPV4_BLACKLIST: z.string().default(""),
  X_API_KEY: z.string().optional(),
  X_API_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_API_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_ISOLATION: z.enum(["host_netns", "docker_vpn"]).default("host_netns"),
  SEARCH_WITHOUT_API_PROFILE_DIR: z.string().default("./runtime/playwright-profile"),
  SEARCH_WITHOUT_API_START_URL: z.string().default("https://x.com/search"),
  SEARCH_WITHOUT_API_MAX_SCROLLS: z.coerce.number().int().min(1).default(20),
  SEARCH_WITHOUT_API_SCROLL_DELAY_MS: z.coerce.number().int().min(0).default(1200),
  SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS: z.coerce.number().int().min(0).default(5000),
  SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS: z.coerce.number().int().min(0).default(12000),
  SEARCH_WITHOUT_API_HEADLESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS: z.coerce.number().int().min(0).default(500),
  SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS: z.coerce.number().int().min(0).default(5000),
  SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS: z.coerce.number().int().min(0).default(5),
  SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS: z.coerce.number().int().min(0).default(120),
  SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT: z.coerce.number().int().min(0).default(50),
  SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT: z.coerce.number().int().min(0).max(100).default(100),
  SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(3),
  SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS: z.coerce.number().int().min(0).max(3600).default(10),
  SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN: z.coerce.number().int().min(1).default(10),
  SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES: z.coerce.number().int().min(0).default(15),
  SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES: z.coerce.number().int().min(0).default(120),
  SEARCH_WITHOUT_API_SCROLLS_MIN: z.coerce.number().int().min(0).default(0),
  SEARCH_WITHOUT_API_SCROLLS_MAX: z.coerce.number().int().min(0).default(23),
  SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS: z.coerce.number().int().min(0).default(1),
  SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS: z.coerce.number().int().min(0).default(15),
  SEARCH_WITHOUT_API_MOUSE_PROFILE: z.enum(["smooth1", "smooth2", "smooth3"]).default("smooth1"),
  SEARCH_WITHOUT_API_SAVE_SNAPSHOTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SEARCH_WITHOUT_API_MEDIA_CACHE_DIR: z.string().default("./runtime/media-cache"),
  SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS: z.coerce.number().min(0).default(24),
  SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB: z.coerce.number().min(0).default(256),
  SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB: z.coerce.number().min(1).default(15),
  SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS: z.coerce.number().int().min(0).default(800),
  SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS: z.coerce.number().int().min(0).default(3000),
  TIMELINE_DEFAULT_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(50),
  RUN_CHAIN_COUNT: z.coerce.number().int().min(1).default(1),
  STALE_KEYWORD_USER_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  STALE_KEYWORD_USER_START_INDEX: z.coerce.number().int().min(1).default(1),
  STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS: z.coerce.number().int().min(0).default(1),
  STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS: z.coerce.number().int().min(0).default(5),
  STALE_KEYWORD_USER_AUTO_IGNORE_ALERT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  STALE_KEYWORD_USER_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(3),
  STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS: z.coerce.number().int().min(0).max(3600).default(10),
  RAW_TIMELINE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  X_LOGIN_NOVNC_PORT: z.coerce.number().int().min(1).max(65535).default(6080),
  X_LOGIN_SCREEN: z.string().min(5).max(40).default("1920x1080x24"),
  X_LOGIN_SERVICE_MAX_SECONDS: z.coerce.number().int().min(60).max(86400).default(1200),
  X_LOGIN_BROWSER: z.enum(["chrome", "firefox"]).default("chrome"),
  X_LOGIN_SAVE_MODE: z.enum(["auto", "cdp", "profile"]).default("auto"),
  X_LOGIN_START_URL: z.string().url().default("https://x.com/login"),
  X_LOGIN_REUSE_BROWSER_PROFILE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  X_LOGIN_SKIP_NETWORK_PRECHECK: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  VPN_NETNS_NAME: z.string().default("redqueenx-vpn"),
  VPN_HOST_IFACE: z.string().default(""),
  VPN_NETNS_CIDR: z.string().default("10.200.0.0/24"),
  VPN_NETNS_HOST_IP: z.string().default("10.200.0.1"),
  VPN_NETNS_GUEST_IP: z.string().default("10.200.0.2"),
  VPN_REMOTE_HOST: z.string().default(""),
  VPN_REMOTE_PORT: z.coerce.number().int().positive().default(1194),
  VPN_REMOTE_PROTO: z.enum(["udp", "tcp"]).default("udp"),
  VPN_CONFIG: z.string().default("./ops/vpn/custom.conf"),
  VPN_CHECK_HOST_IPV4_LEAK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  VPN_CHECK_IPV6: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  VPN_DIAGNOSTIC_STRICT: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  VPN_DIAGNOSTIC_PLAYWRIGHT: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: z.string().default(""),
  PLAYWRIGHT_DISABLE_SANDBOX: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  X_SEARCH_API_CALL_LIMIT: z.coerce.number().int().positive().default(180),
  X_SEARCH_API_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  X_API_CREDIT_USD: z.coerce.number().min(0).default(0),
  X_API_TOTAL_CREDIT_USED_USD: z.coerce.number().min(0).default(0),
  X_DAILY_SPEND_LIMIT_USD: z.coerce.number().min(0).default(1),
  X_RUN_SPEND_LIMIT_USD: z.coerce.number().min(0).default(2),
  X_MAX_SEARCHES_PER_DAY: z.coerce.number().int().min(0).default(25),
  X_MAX_POSTS_READ_PER_DAY: z.coerce.number().int().min(0).default(250),
  X_MAX_COUNT_CALLS_PER_DAY: z.coerce.number().int().min(0).default(500),
  X_KEYWORDS_PER_QUERY: z.coerce.number().int().min(1).max(16).default(5),
  X_COUNT_FIRST_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  X_COST_POST_READ_USD: z.coerce.number().min(0).default(0.005),
  X_COST_USER_READ_USD: z.coerce.number().min(0).default(0.01),
  X_COST_MEDIA_READ_USD: z.coerce.number().min(0).default(0.005),
  X_COST_USER_INTERACTION_USD: z.coerce.number().min(0).default(0.015),
  X_COST_COUNT_CALL_USD: z.coerce.number().min(0).default(0),
  RSS_FALLBACK_FEED_LIMIT: z.coerce.number().int().positive().default(25),
  ENABLE_X_WRITE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const staleKeywordUserActionDelayMinSeconds = Math.max(0, Math.floor(parsed.STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS));
  const staleKeywordUserActionDelayMaxSeconds = Math.max(
    staleKeywordUserActionDelayMinSeconds,
    Math.floor(parsed.STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS)
  );

  return {
    adminHost: parsed.ADMIN_HOST,
    adminPort: parsed.ADMIN_PORT,
    adminTrustProxy: parsed.ADMIN_TRUST_PROXY,
    adminAuthMode: parsed.ADMIN_AUTH_MODE,
    adminMtlsProxySecret: parsed.ADMIN_MTLS_PROXY_SECRET,
    adminPublicUrl: parsed.ADMIN_PUBLIC_URL,
    adminUsername: parsed.ADMIN_USERNAME,
    adminPassword: parsed.ADMIN_PASSWORD,
    adminPasswordHash: parsed.ADMIN_PASSWORD_HASH,
    sessionSecret: parsed.SESSION_SECRET,
    databaseUrl: path.resolve(parsed.DATABASE_URL),
    currentSessionFile: path.resolve(parsed.CURRENT_SESSION_FILE),
    adminIpv4Whitelist: parseAccessListInput(parsed.ADMIN_IPV4_WHITELIST),
    adminIpv4Blacklist: parseAccessListInput(parsed.ADMIN_IPV4_BLACKLIST),
    legacyDataDir: path.resolve("./oldpython/Data"),
    xSearchApiCallLimit: parsed.X_SEARCH_API_CALL_LIMIT,
    xApiEnabled: parsed.X_API_ENABLED,
    searchWithoutApiEnabled: parsed.SEARCH_WITHOUT_API_ENABLED,
    searchWithoutApiIsolation: parsed.SEARCH_WITHOUT_API_ISOLATION,
    searchWithoutApiProfileDir: parsed.SEARCH_WITHOUT_API_PROFILE_DIR,
    searchWithoutApiStartUrl: parsed.SEARCH_WITHOUT_API_START_URL,
    searchWithoutApiMaxScrolls: parsed.SEARCH_WITHOUT_API_MAX_SCROLLS,
    searchWithoutApiScrollDelayMs: parsed.SEARCH_WITHOUT_API_SCROLL_DELAY_MS,
    searchWithoutApiScrollDelayMinMs: parsed.SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS,
    searchWithoutApiScrollDelayMaxMs: parsed.SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS,
    searchWithoutApiHeadless: parsed.SEARCH_WITHOUT_API_HEADLESS,
    searchWithoutApiShowBrowserLocal: parsed.SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL,
    searchWithoutApiKeyDelayMinMs: parsed.SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS,
    searchWithoutApiKeyDelayMaxMs: parsed.SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS,
    searchWithoutApiSearchDelayMinSeconds: parsed.SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS,
    searchWithoutApiSearchDelayMaxSeconds: parsed.SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS,
    searchWithoutApiSessionKeywordLimit: parsed.SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT,
    searchWithoutApiSessionKeywordLimitRandom: parsed.SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM,
    searchWithoutApiRandomizeKeywordOrder: parsed.SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER,
    searchWithoutApiUserKeywordPercent: parsed.SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT,
    searchWithoutApiAutoIgnoreAlert: parsed.SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT,
    searchWithoutApiMaxRetries: parsed.SEARCH_WITHOUT_API_MAX_RETRIES,
    searchWithoutApiAutoRestartDelaySeconds: parsed.SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS,
    searchWithoutApiRequestsBeforePauseMin: parsed.SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN,
    searchWithoutApiPauseMinMinutes: parsed.SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES,
    searchWithoutApiPauseMaxMinutes: parsed.SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES,
    searchWithoutApiScrollsMin: parsed.SEARCH_WITHOUT_API_SCROLLS_MIN,
    searchWithoutApiScrollsMax: parsed.SEARCH_WITHOUT_API_SCROLLS_MAX,
    searchWithoutApiTweetHoverMinSeconds: parsed.SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS,
    searchWithoutApiTweetHoverMaxSeconds: parsed.SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS,
    searchWithoutApiMouseProfile: parsed.SEARCH_WITHOUT_API_MOUSE_PROFILE,
    searchWithoutApiSaveSnapshots: parsed.SEARCH_WITHOUT_API_SAVE_SNAPSHOTS,
    searchWithoutApiMediaCacheEnabled: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED,
    searchWithoutApiMediaCacheDir: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_DIR,
    searchWithoutApiMediaCacheTtlHours: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_TTL_HOURS,
    searchWithoutApiMediaCacheMaxMb: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB,
    searchWithoutApiMediaCacheMaxFileMb: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_FILE_MB,
    searchWithoutApiMediaCacheFetchDelayMinMs: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MIN_MS,
    searchWithoutApiMediaCacheFetchDelayMaxMs: parsed.SEARCH_WITHOUT_API_MEDIA_CACHE_FETCH_DELAY_MAX_MS,
    timelineDefaultPageSize: parsed.TIMELINE_DEFAULT_PAGE_SIZE,
    runChainCount: parsed.RUN_CHAIN_COUNT,
    staleKeywordUserMaxAgeDays: parsed.STALE_KEYWORD_USER_MAX_AGE_DAYS,
    staleKeywordUserStartIndex: parsed.STALE_KEYWORD_USER_START_INDEX,
    staleKeywordUserActionDelayMinSeconds,
    staleKeywordUserActionDelayMaxSeconds,
    staleKeywordUserAutoIgnoreAlert: parsed.STALE_KEYWORD_USER_AUTO_IGNORE_ALERT,
    staleKeywordUserMaxRetries: parsed.STALE_KEYWORD_USER_MAX_RETRIES,
    staleKeywordUserAutoRestartDelaySeconds: parsed.STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS,
    rawTimelineEnabled: parsed.RAW_TIMELINE_ENABLED,
    xLoginNovncPort: parsed.X_LOGIN_NOVNC_PORT,
    xLoginScreen: parsed.X_LOGIN_SCREEN,
    xLoginServiceMaxSeconds: parsed.X_LOGIN_SERVICE_MAX_SECONDS,
    xLoginBrowser: parsed.X_LOGIN_BROWSER,
    xLoginSaveMode: parsed.X_LOGIN_SAVE_MODE,
    xLoginStartUrl: parsed.X_LOGIN_START_URL,
    xLoginReuseBrowserProfile: parsed.X_LOGIN_REUSE_BROWSER_PROFILE,
    xLoginSkipNetworkPrecheck: parsed.X_LOGIN_SKIP_NETWORK_PRECHECK,
    vpnNetnsName: parsed.VPN_NETNS_NAME,
    vpnHostIface: parsed.VPN_HOST_IFACE,
    vpnNetnsCidr: parsed.VPN_NETNS_CIDR,
    vpnNetnsHostIp: parsed.VPN_NETNS_HOST_IP,
    vpnNetnsGuestIp: parsed.VPN_NETNS_GUEST_IP,
    vpnRemoteHost: parsed.VPN_REMOTE_HOST,
    vpnRemotePort: parsed.VPN_REMOTE_PORT,
    vpnRemoteProto: parsed.VPN_REMOTE_PROTO,
    vpnConfig: parsed.VPN_CONFIG,
    vpnCheckHostIpv4Leak: parsed.VPN_CHECK_HOST_IPV4_LEAK,
    vpnCheckIpv6: parsed.VPN_CHECK_IPV6,
    vpnDiagnosticStrict: parsed.VPN_DIAGNOSTIC_STRICT,
    vpnDiagnosticPlaywright: parsed.VPN_DIAGNOSTIC_PLAYWRIGHT,
    playwrightChromiumExecutablePath: parsed.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    playwrightDisableSandbox: parsed.PLAYWRIGHT_DISABLE_SANDBOX,
    xSearchApiWindowMinutes: parsed.X_SEARCH_API_WINDOW_MINUTES,
    xApiCreditUsd: parsed.X_API_CREDIT_USD,
    xApiTotalCreditUsedUsd: parsed.X_API_TOTAL_CREDIT_USED_USD,
    xDailySpendLimitUsd: parsed.X_DAILY_SPEND_LIMIT_USD,
    xRunSpendLimitUsd: parsed.X_RUN_SPEND_LIMIT_USD,
    xMaxSearchesPerDay: parsed.X_MAX_SEARCHES_PER_DAY,
    xMaxPostsReadPerDay: parsed.X_MAX_POSTS_READ_PER_DAY,
    xMaxCountCallsPerDay: parsed.X_MAX_COUNT_CALLS_PER_DAY,
    xKeywordsPerQuery: parsed.X_KEYWORDS_PER_QUERY,
    xCountFirstMode: parsed.X_COUNT_FIRST_MODE,
    xCostPostReadUsd: parsed.X_COST_POST_READ_USD,
    xCostUserReadUsd: parsed.X_COST_USER_READ_USD,
    xCostMediaReadUsd: parsed.X_COST_MEDIA_READ_USD,
    xCostUserInteractionUsd: parsed.X_COST_USER_INTERACTION_USD,
    xCostCountCallUsd: parsed.X_COST_COUNT_CALL_USD,
    rssFallbackFeedLimit: parsed.RSS_FALLBACK_FEED_LIMIT,
    enableXWrite: parsed.ENABLE_X_WRITE,
    x: {
      apiKey: parsed.X_API_KEY,
      apiSecret: parsed.X_API_SECRET,
      accessToken: parsed.X_ACCESS_TOKEN,
      accessSecret: parsed.X_ACCESS_SECRET,
      bearerToken: parsed.X_BEARER_TOKEN,
      clientId: parsed.X_CLIENT_ID,
      clientSecret: parsed.X_CLIENT_SECRET
    }
  };
}
