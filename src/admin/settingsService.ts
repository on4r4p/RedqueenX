import type { Database } from "better-sqlite3";
import { z } from "zod";
import { DEFAULT_SCORING_CONFIG } from "../scoring";
import type { ScoringConfig } from "../types";
import type { XBudgetConfig } from "../x-budget";
import {
  DEFAULT_SERVER_ACCESS_CONFIG,
  isAccessEntry,
  normalizeAccessList,
  type ServerAccessConfig
} from "./serverAccess";

const scoringSettingKey = "scoring_config";
const xApiSettingKey = "x_api_config";
const serverAccessSettingKey = "server_access_config";

const booleanSettingSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const scoringConfigSchema = z.object({
  enableMinimumSearchResults: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMinimumSearchResults),
  enableLuckFactor: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableLuckFactor),
  enableAllowedLanguages: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableAllowedLanguages),
  enableMinimumTweetLength: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMinimumTweetLength),
  enableMinimumTweetRetweets: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMinimumTweetRetweets),
  enableMaximumTweetRetweets: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMaximumTweetRetweets),
  enableMinimumTweetFavorites: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMinimumTweetFavorites),
  enableMaximumTweetFavorites: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMaximumTweetFavorites),
  relaxMinimumPopularityForHandleSearch: booleanSettingSchema.default(
    DEFAULT_SCORING_CONFIG.relaxMinimumPopularityForHandleSearch
  ),
  enableMinimumUserFollowers: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMinimumUserFollowers),
  enableMinimumTweetScore: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMinimumTweetScore),
  enableMaximumTweetAgeDays: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMaximumTweetAgeDays),
  enableMaximumHashtags: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMaximumHashtags),
  enableMaximumMentions: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMaximumMentions),
  enableMaximumTweetsByUser: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableMaximumTweetsByUser),
  enableSimilarTweetText: booleanSettingSchema.default(DEFAULT_SCORING_CONFIG.enableSimilarTweetText),
  minimumSearchResults: z.coerce.number().int().min(0).default(DEFAULT_SCORING_CONFIG.minimumSearchResults),
  luckFactorDenominator: z.coerce.number().int().min(0).default(DEFAULT_SCORING_CONFIG.luckFactorDenominator),
  allowedLanguages: z
    .array(z.string().trim().min(1))
    .min(1)
    .transform((values) => Array.from(new Set(values.map((value) => value.toLowerCase())))),
  minimumTweetLength: z.coerce.number().int().min(0),
  minimumTweetRetweets: z.coerce.number().int().min(0),
  maximumTweetRetweets: z.coerce.number().int().min(0),
  minimumTweetFavorites: z.coerce.number().int().min(0),
  maximumTweetFavorites: z.coerce.number().int().min(0),
  minimumUserFollowers: z.coerce.number().int().min(0),
  minimumTweetScore: z.coerce.number().int().min(0),
  maximumTweetAgeDays: z.coerce.number().min(0),
  maximumHashtags: z.coerce.number().int().min(0),
  maximumMentions: z.coerce.number().int().min(0),
  maximumTweetsByUser: z.coerce.number().int().min(0),
  similarTweetTextThreshold: z.coerce.number().min(0).max(1).default(DEFAULT_SCORING_CONFIG.similarTweetTextThreshold)
});

const accessListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .refine(isAccessEntry, "Use IPv4 addresses or IPv4 CIDR ranges only.")
  )
  .transform(normalizeAccessList);

export const serverAccessConfigSchema = z.object({
  whitelist: accessListSchema.default(DEFAULT_SERVER_ACCESS_CONFIG.whitelist),
  blacklist: accessListSchema.default(DEFAULT_SERVER_ACCESS_CONFIG.blacklist)
});

export const xApiConfigSchema = z.object({
  xApiEnabled: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiEnabled: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiIsolation: z.enum(["host_netns", "docker_vpn"]),
  searchWithoutApiProfileDir: z.string(),
  searchWithoutApiStartUrl: z.string(),
  searchWithoutApiMaxScrolls: z.coerce.number().int().min(1),
  searchWithoutApiScrollDelayMs: z.coerce.number().int().min(0),
  searchWithoutApiScrollDelayMinMs: z.coerce.number().int().min(0),
  searchWithoutApiScrollDelayMaxMs: z.coerce.number().int().min(0),
  searchWithoutApiHeadless: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiShowBrowserLocal: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiKeyDelayMinMs: z.coerce.number().int().min(0),
  searchWithoutApiKeyDelayMaxMs: z.coerce.number().int().min(0),
  searchWithoutApiSearchDelayMinSeconds: z.coerce.number().int().min(0),
  searchWithoutApiSearchDelayMaxSeconds: z.coerce.number().int().min(0),
  searchWithoutApiSessionKeywordLimit: z.coerce.number().int().min(0),
  searchWithoutApiSessionKeywordLimitRandom: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiRandomizeKeywordOrder: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiUserKeywordPercent: z.coerce.number().int().min(0).max(100),
  searchWithoutApiAutoIgnoreAlert: booleanSettingSchema,
  searchWithoutApiMaxRetries: z.coerce.number().int().min(0).max(20),
  searchWithoutApiAutoRestartDelaySeconds: z.coerce.number().int().min(0).max(3600),
  searchWithoutApiRequestsBeforePauseMin: z.coerce.number().int().min(1),
  searchWithoutApiPauseMinMinutes: z.coerce.number().int().min(0),
  searchWithoutApiPauseMaxMinutes: z.coerce.number().int().min(0),
  searchWithoutApiScrollsMin: z.coerce.number().int().min(0),
  searchWithoutApiScrollsMax: z.coerce.number().int().min(0),
  searchWithoutApiTweetHoverMinSeconds: z.coerce.number().int().min(0),
  searchWithoutApiTweetHoverMaxSeconds: z.coerce.number().int().min(0),
  searchWithoutApiMouseProfile: z.enum(["smooth1", "smooth2", "smooth3"]),
  searchWithoutApiSaveSnapshots: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiMediaCacheEnabled: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  searchWithoutApiMediaCacheDir: z.string(),
  searchWithoutApiMediaCacheTtlHours: z.coerce.number().min(0),
  searchWithoutApiMediaCacheMaxMb: z.coerce.number().min(0),
  searchWithoutApiMediaCacheMaxFileMb: z.coerce.number().min(1),
  searchWithoutApiMediaCacheFetchDelayMinMs: z.coerce.number().int().min(0),
  searchWithoutApiMediaCacheFetchDelayMaxMs: z.coerce.number().int().min(0),
  timelineDefaultPageSize: z.coerce.number().int().min(1).max(200),
  runChainCount: z.coerce.number().int().min(1),
  staleKeywordUserMaxAgeDays: z.coerce.number().int().min(1).max(3650),
  staleKeywordUserStartIndex: z.coerce.number().int().min(1),
  staleKeywordUserActionDelayMinSeconds: z.coerce.number().int().min(0),
  staleKeywordUserActionDelayMaxSeconds: z.coerce.number().int().min(0),
  staleKeywordUserAutoIgnoreAlert: booleanSettingSchema,
  staleKeywordUserMaxRetries: z.coerce.number().int().min(0).max(20),
  staleKeywordUserAutoRestartDelaySeconds: z.coerce.number().int().min(0).max(3600),
  rawTimelineEnabled: booleanSettingSchema,
  xLoginNovncPort: z.coerce.number().int().min(1).max(65535),
  xLoginScreen: z.string().min(5).max(40),
  xLoginServiceMaxSeconds: z.coerce.number().int().min(60).max(86400),
  xLoginBrowser: z.enum(["chrome", "firefox"]),
  xLoginSaveMode: z.enum(["auto", "cdp", "profile"]),
  xLoginStartUrl: z.string().url(),
  xLoginReuseBrowserProfile: booleanSettingSchema,
  xLoginSkipNetworkPrecheck: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  vpnNetnsName: z.string(),
  vpnHostIface: z.string(),
  vpnNetnsCidr: z.string(),
  vpnNetnsHostIp: z.string(),
  vpnNetnsGuestIp: z.string(),
  vpnRemoteHost: z.string(),
  vpnRemotePort: z.coerce.number().int().positive(),
  vpnRemoteProto: z.enum(["udp", "tcp"]),
  vpnConfig: z.string(),
  vpnCheckHostIpv4Leak: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  vpnCheckIpv6: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  vpnDiagnosticStrict: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  vpnDiagnosticPlaywright: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  playwrightChromiumExecutablePath: z.string(),
  playwrightDisableSandbox: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  xSearchApiCallLimit: z.coerce.number().int().positive(),
  xSearchApiWindowMinutes: z.coerce.number().positive(),
  xApiCreditUsd: z.coerce.number().min(0),
  xApiTotalCreditUsedUsd: z.coerce.number().min(0),
  xDailySpendLimitUsd: z.coerce.number().min(0),
  xRunSpendLimitUsd: z.coerce.number().min(0),
  xMaxSearchesPerDay: z.coerce.number().int().min(0),
  xMaxPostsReadPerDay: z.coerce.number().int().min(0),
  xMaxCountCallsPerDay: z.coerce.number().int().min(0),
  xKeywordsPerQuery: z.coerce.number().int().min(1).max(16),
  xCountFirstMode: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  xCostPostReadUsd: z.coerce.number().min(0),
  xCostUserReadUsd: z.coerce.number().min(0),
  xCostMediaReadUsd: z.coerce.number().min(0),
  xCostUserInteractionUsd: z.coerce.number().min(0),
  xCostCountCallUsd: z.coerce.number().min(0)
});

export type XApiRuntimeConfig = z.infer<typeof xApiConfigSchema> & XBudgetConfig;

type SettingRow = {
  value_json: string;
};

export class SettingsService {
  constructor(private readonly database: Database) {}

  getScoringConfig(): ScoringConfig {
    const row = this.database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(scoringSettingKey) as
      | SettingRow
      | undefined;

    if (!row) {
      return DEFAULT_SCORING_CONFIG;
    }

    try {
      return scoringConfigSchema.parse({
        ...DEFAULT_SCORING_CONFIG,
        ...JSON.parse(row.value_json)
      });
    } catch {
      return DEFAULT_SCORING_CONFIG;
    }
  }

  updateScoringConfig(input: unknown): ScoringConfig {
    const config = scoringConfigSchema.parse(input);
    this.database
      .prepare(
        `
          INSERT INTO app_settings (key, value_json, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      )
      .run(scoringSettingKey, JSON.stringify(config));

    return config;
  }

  getServerAccessConfig(defaults: ServerAccessConfig = DEFAULT_SERVER_ACCESS_CONFIG): ServerAccessConfig {
    const row = this.database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(serverAccessSettingKey) as
      | SettingRow
      | undefined;

    if (!row) {
      return serverAccessConfigSchema.parse(defaults);
    }

    try {
      return serverAccessConfigSchema.parse({
        ...defaults,
        ...JSON.parse(row.value_json)
      });
    } catch {
      return serverAccessConfigSchema.parse(defaults);
    }
  }

  updateServerAccessConfig(input: unknown, defaults: ServerAccessConfig = DEFAULT_SERVER_ACCESS_CONFIG): ServerAccessConfig {
    const config = serverAccessConfigSchema.parse({
      ...defaults,
      ...(typeof input === "object" && input !== null ? input : {})
    });
    this.database
      .prepare(
        `
          INSERT INTO app_settings (key, value_json, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      )
      .run(serverAccessSettingKey, JSON.stringify(config));

    return config;
  }

  getXApiConfig(defaults: XApiRuntimeConfig): XApiRuntimeConfig {
    const row = this.database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(xApiSettingKey) as
      | SettingRow
      | undefined;

    if (!row) {
      return normalizeRuntimeModes(xApiConfigSchema.parse(defaults));
    }

    try {
      return normalizeRuntimeModes(xApiConfigSchema.parse({
        ...defaults,
        ...JSON.parse(row.value_json)
      }));
    } catch {
      return normalizeRuntimeModes(xApiConfigSchema.parse(defaults));
    }
  }

  updateXApiConfig(input: unknown, defaults: XApiRuntimeConfig): XApiRuntimeConfig {
    const inputObject = typeof input === "object" && input !== null ? (input as Partial<XApiRuntimeConfig>) : {};
    const config = normalizeRuntimeModes(xApiConfigSchema.parse({
      ...defaults,
      ...inputObject
    }), inputObject);
    this.database
      .prepare(
        `
          INSERT INTO app_settings (key, value_json, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      )
      .run(xApiSettingKey, JSON.stringify(config));

    return config;
  }

  patchXApiConfig(input: Partial<XApiRuntimeConfig>): Partial<XApiRuntimeConfig> {
    const patch = xApiConfigSchema.partial().parse(input);
    const row = this.database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(xApiSettingKey) as
      | SettingRow
      | undefined;
    let current: Record<string, unknown> = {};
    if (row) {
      try {
        const parsed = JSON.parse(row.value_json);
        current = typeof parsed === "object" && parsed !== null ? parsed : {};
      } catch {
        current = {};
      }
    }
    const next = {
      ...current,
      ...patch
    };
    this.database
      .prepare(
        `
          INSERT INTO app_settings (key, value_json, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `
      )
      .run(xApiSettingKey, JSON.stringify(next));

    return next as Partial<XApiRuntimeConfig>;
  }
}

function normalizeRuntimeModes(config: XApiRuntimeConfig, changed: Partial<XApiRuntimeConfig> = {}): XApiRuntimeConfig {
  const normalizedConfig: XApiRuntimeConfig = {
    ...config,
    staleKeywordUserActionDelayMinSeconds: Math.max(0, Math.floor(config.staleKeywordUserActionDelayMinSeconds)),
    staleKeywordUserActionDelayMaxSeconds: Math.max(
      Math.max(0, Math.floor(config.staleKeywordUserActionDelayMinSeconds)),
      Math.floor(config.staleKeywordUserActionDelayMaxSeconds)
    ),
    staleKeywordUserAutoRestartDelaySeconds: Math.max(0, Math.floor(config.staleKeywordUserAutoRestartDelaySeconds))
  };
  if (changed.searchWithoutApiEnabled === true) {
    return {
      ...normalizedConfig,
      xApiEnabled: false
    };
  }

  if (changed.xApiEnabled === true) {
    return {
      ...normalizedConfig,
      searchWithoutApiEnabled: false
    };
  }

  if (normalizedConfig.searchWithoutApiEnabled) {
    return {
      ...normalizedConfig,
      xApiEnabled: false
    };
  }

  if (normalizedConfig.xApiEnabled) {
    return {
      ...normalizedConfig,
      searchWithoutApiEnabled: false
    };
  }

  return normalizedConfig;
}
