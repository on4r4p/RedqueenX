import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const envKeys = [
  "ADMIN_HOST",
  "ADMIN_PORT",
  "ADMIN_TRUST_PROXY",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "DATABASE_URL",
  "CURRENT_SESSION_FILE",
  "ADMIN_IPV4_WHITELIST",
  "ADMIN_IPV4_BLACKLIST",
  "X_API_ENABLED",
  "SEARCH_WITHOUT_API_ENABLED",
  "SEARCH_WITHOUT_API_ISOLATION",
  "X_LOGIN_SKIP_NETWORK_PRECHECK",
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
  "X_BEARER_TOKEN",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "ENABLE_X_WRITE",
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
  "X_COST_COUNT_CALL_USD",
  "RSS_FALLBACK_FEED_LIMIT",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET"
] as const;

export type EnvKey = (typeof envKeys)[number];

export const envUpdateSchema = z.object({
  values: z.partialRecord(z.enum(envKeys), z.string().max(10_000))
});

export class EnvService {
  constructor(private readonly envPath = path.resolve(process.cwd(), ".env")) {}

  async read(): Promise<Record<EnvKey, string>> {
    const content = await this.readContent();
    return {
      ...Object.fromEntries(envKeys.map((key) => [key, ""])),
      ...parseEnvContent(content)
    } as Record<EnvKey, string>;
  }

  async update(values: Partial<Record<EnvKey, string>>): Promise<Record<EnvKey, string>> {
    const content = await this.readContent();
    const nextContent = updateEnvContent(content, values);
    await fs.writeFile(this.envPath, nextContent, "utf8");
    return this.read();
  }

  private async readContent(): Promise<string> {
    try {
      return await fs.readFile(this.envPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
}

function parseEnvContent(content: string): Partial<Record<EnvKey, string>> {
  const values: Partial<Record<EnvKey, string>> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1] as EnvKey;
    if (!envKeys.includes(key)) continue;
    values[key] = unquoteEnvValue(match[2]);
  }
  return values;
}

function updateEnvContent(content: string, values: Partial<Record<EnvKey, string>>): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const updatedLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
    if (!match) return line;
    const key = match[2] as EnvKey;
    if (!envKeys.includes(key) || !(key in values)) return line;
    seen.add(key);
    return `${match[1]}${key}${match[3]}${quoteEnvValue(values[key] ?? "")}`;
  });

  const missingEntries = envKeys
    .filter((key) => key in values && !seen.has(key))
    .map((key) => `${key}=${quoteEnvValue(values[key] ?? "")}`);

  const joined = [...updatedLines, ...missingEntries].join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quoteEnvValue(value: string): string {
  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
