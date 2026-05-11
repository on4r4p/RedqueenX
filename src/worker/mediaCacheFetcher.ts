import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { formatDiagnosticsReport, runVpnDiagnostics } from "../diagnostics/vpn";
import { CurrentSessionService, type CurrentSessionLevel } from "../admin/currentSessionService";
import { MediaCacheService, type MediaCacheConfig, type MediaSource } from "../admin/mediaCacheService";
import { TimelineTweetService } from "../admin/timelineTweetService";
import { assertVpnRuntime } from "./vpnGuard";

interface Args {
  tweetId: string;
}

const allowedMediaHosts = new Set(["abs.twimg.com", "pbs.twimg.com", "video.twimg.com", "ton.twimg.com"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const mediaConfig = mediaCacheConfigFromAppConfig(config);
  if (!mediaConfig.enabled) {
    throw new Error("SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED must be true before downloading X media.");
  }

  const database = openDatabase(config.databaseUrl);
  const timelineTweets = new TimelineTweetService(database);
  const mediaCache = new MediaCacheService(database, mediaConfig);
  const currentSession = new CurrentSessionService(config.currentSessionFile);
  const record = (level: CurrentSessionLevel, type: string, message: string, data: Record<string, unknown> = {}) =>
    currentSession.record(level, type, message, data).catch(() => undefined);

  await assertVpnRuntime(config, "Media cache fetcher");
  const report = await runVpnDiagnostics({ includePlaywright: false, strict: true });
  console.log(formatDiagnosticsReport(report));
  await record("info", "media_cache.vpn.diagnostics", "Media cache VPN diagnostics completed", {
    checksPassed: report.failures.length === 0,
    failures: report.failures
  });
  if (report.failures.length > 0) {
    throw new Error("VPN diagnostics failed; refusing to download media.");
  }

  const tweet = timelineTweets.find(args.tweetId);
  if (!tweet) {
    throw new Error(`Tweet ${args.tweetId} was not found in timeline_tweets.`);
  }

  await mediaCache.ensureRoot();
  const beforePrune = await mediaCache.prune();
  const sources = uniqueSources(mediaCache.sourcesForTimelineItem(tweet)).slice(0, 8);
  await record("info", "media_cache.fetch.started", "Media cache fetch started", {
    tweetId: tweet.tweetId,
    sourceCount: sources.length,
    maxFileMb: config.searchWithoutApiMediaCacheMaxFileMb,
    ttlHours: config.searchWithoutApiMediaCacheTtlHours,
    prune: beforePrune
  });

  const results = [];
  for (const [index, source] of sources.entries()) {
    if (index > 0) {
      const waitMs = randomInt(config.searchWithoutApiMediaCacheFetchDelayMinMs, config.searchWithoutApiMediaCacheFetchDelayMaxMs);
      await record("debug", "media_cache.fetch.delay", "Waiting before next media fetch", {
        tweetId: tweet.tweetId,
        waitMs,
        nextSourceIndex: index + 1
      });
      await delay(waitMs);
    }
    results.push(await fetchOneSource(source, mediaCache, mediaConfig, record));
  }

  const afterPrune = await mediaCache.prune();
  const completed = {
    tweetId: tweet.tweetId,
    sources: sources.length,
    downloaded: results.filter((result) => result.status === "cached").length,
    failed: results.filter((result) => result.status === "error").length,
    results,
    prune: afterPrune
  };
  await record("info", "media_cache.fetch.completed", "Media cache fetch completed", completed);
  console.log(formatSummary(completed));
}

async function fetchOneSource(
  source: MediaSource,
  mediaCache: MediaCacheService,
  config: MediaCacheConfig,
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>
) {
  const cacheId = mediaCache.cacheIdForUrl(source.sourceUrl);
  try {
    assertAllowedXMediaSource(source.sourceUrl);
    await record("debug", "media_cache.fetch.source", "Downloading media source through VPN", {
      cacheId,
      kind: source.kind,
      mediaType: source.mediaType
    });
    const response = await fetch(source.sourceUrl, {
      headers: {
        accept: source.mediaType === "video" ? "video/*,*/*;q=0.8" : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while downloading media.`);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "application/octet-stream";
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
      throw new Error(`Refusing non-media content-type ${contentType}.`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > config.maxFileBytes) {
      throw new Error(`Media file is too large: ${contentLength} bytes.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > config.maxFileBytes) {
      throw new Error(`Media file is too large after download: ${buffer.byteLength} bytes.`);
    }
    const localPath = path.join(mediaCache.rootDir, `${cacheId}${extensionForContentType(contentType, source.sourceUrl)}`);
    await fs.writeFile(localPath, buffer);
    const entry = mediaCache.upsertSuccess(source.sourceUrl, localPath, contentType, buffer.byteLength);
    return { cacheId, status: "cached", bytes: entry.sizeBytes, contentType };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to download media.";
    mediaCache.upsertFailure(source.sourceUrl, message);
    await record("prob", "media_cache.fetch.failed", message, {
      cacheId,
      kind: source.kind,
      mediaType: source.mediaType
    });
    return { cacheId, status: "error", error: message };
  }
}

export function assertAllowedXMediaSource(sourceUrl: string): void {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS X media URLs are allowed.");
  }
  if (!allowedMediaHosts.has(url.hostname)) {
    throw new Error(`Refusing non-X media host ${url.hostname}.`);
  }
}

function extensionForContentType(contentType: string, sourceUrl: string): string {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "video/mp4") return ".mp4";
  const ext = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  return /^[a-z0-9.]{1,8}$/.test(ext) ? ext : ".bin";
}

function uniqueSources(sources: MediaSource[]): MediaSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.sourceUrl)) return false;
    seen.add(source.sourceUrl);
    return true;
  });
}

function randomInt(min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(Math.random() * (high - low + 1));
}

function mediaCacheConfigFromAppConfig(config: ReturnType<typeof loadConfig>): MediaCacheConfig {
  return {
    enabled: config.searchWithoutApiMediaCacheEnabled,
    cacheDir: config.searchWithoutApiMediaCacheDir,
    ttlHours: config.searchWithoutApiMediaCacheTtlHours,
    maxBytes: Math.round(config.searchWithoutApiMediaCacheMaxMb * 1024 * 1024),
    maxFileBytes: Math.round(config.searchWithoutApiMediaCacheMaxFileMb * 1024 * 1024)
  };
}

function parseArgs(argv: string[]): Args {
  const tweetId = readArg(argv, "--tweet-id");
  if (!tweetId || !/^\d+$/.test(tweetId)) {
    throw new Error("Usage: npm run media-cache:fetch -- --tweet-id <numeric tweet id>");
  }
  return { tweetId };
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function formatSummary(summary: {
  tweetId: string;
  sources: number;
  downloaded: number;
  failed: number;
  results: Array<{ cacheId: string; status: string; bytes?: number; error?: string }>;
}) {
  const lines = [
    "Media cache fetch: COMPLETED",
    `Tweet ID: ${summary.tweetId}`,
    `Sources: ${summary.sources}`,
    `Downloaded: ${summary.downloaded}`,
    `Failed: ${summary.failed}`,
    "",
    "Results"
  ];
  for (const result of summary.results) {
    lines.push(`  - ${result.cacheId}: ${result.status}${result.bytes ? ` (${result.bytes} bytes)` : ""}${result.error ? ` - ${result.error}` : ""}`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
