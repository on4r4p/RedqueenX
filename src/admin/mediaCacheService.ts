import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Database } from "better-sqlite3";
import type { TweetMedia } from "../types";
import type { TimelineTweetItem } from "./timelineTweetService";

export type MediaCacheStatus = "cached" | "missing" | "expired" | "error" | "disabled" | "no_source";

export interface MediaCacheConfig {
  enabled: boolean;
  cacheDir: string;
  ttlHours: number;
  maxBytes: number;
  maxFileBytes: number;
}

export interface MediaCacheEntry {
  cacheId: string;
  sourceUrl: string;
  localPath: string;
  contentType: string | null;
  sizeBytes: number;
  cachedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface CachedMediaItem {
  type: string;
  altText?: string;
  width?: number;
  height?: number;
  cacheId: string | null;
  cacheStatus: MediaCacheStatus;
  cachedUrl: string | null;
  lastError?: string | null;
  hasRemoteSource: boolean;
}

export interface CachedAvatar {
  cacheId: string | null;
  cacheStatus: MediaCacheStatus;
  cachedUrl: string | null;
  lastError?: string | null;
  hasRemoteSource: boolean;
}

export interface MediaSource {
  sourceUrl: string;
  kind: "avatar" | "media";
  mediaType: string;
}

type TimelineMediaItem = Omit<TimelineTweetItem, "source" | "tweetId" | "tweetUrl" | "retweetCount" | "favoriteCount" | "score" | "acceptedAt"> & {
  source: string;
  tweetId: string | null;
  tweetUrl: string | null;
  retweetCount: number | null;
  favoriteCount: number | null;
  score: number | null;
  acceptedAt: string | null;
};

type MediaCacheRow = {
  cache_id: string;
  source_url: string;
  local_path: string;
  content_type: string | null;
  size_bytes: number;
  cached_at: string | null;
  expires_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export class MediaCacheService {
  constructor(
    private readonly database: Database,
    private readonly config: MediaCacheConfig
  ) {}

  get rootDir(): string {
    return path.resolve(this.config.cacheDir);
  }

  cacheIdForUrl(sourceUrl: string): string {
    return crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
  }

  publicUrl(cacheId: string): string {
    return `/media-cache/${encodeURIComponent(cacheId)}`;
  }

  decorateTimelineItem<T extends TimelineMediaItem>(item: T) {
    const avatarCache = this.decorateAvatar(item.avatarUrl);
    const media = item.media.map((mediaItem) => this.decorateMedia(mediaItem));
    const summary = media.reduce(
      (acc, mediaItem) => {
        acc[mediaItem.cacheStatus] = (acc[mediaItem.cacheStatus] ?? 0) + 1;
        return acc;
      },
      {} as Record<MediaCacheStatus, number>
    );

    return {
      ...item,
      avatarUrl: null,
      avatarCache,
      media,
      mediaCache: {
        enabled: this.config.enabled,
        ttlHours: this.config.ttlHours,
        maxMb: Math.round(this.config.maxBytes / 1024 / 1024),
        cached: summary.cached ?? 0,
        missing: summary.missing ?? 0,
        expired: summary.expired ?? 0,
        errors: summary.error ?? 0,
        disabled: summary.disabled ?? 0
      }
    };
  }

  sourcesForTimelineItem(item: TimelineMediaItem): MediaSource[] {
    const sources: MediaSource[] = [];
    if (item.avatarUrl) {
      sources.push({ sourceUrl: item.avatarUrl, kind: "avatar", mediaType: "image" });
    }
    for (const media of item.media) {
      const sourceUrl = sourceUrlFromMedia(media);
      if (sourceUrl) {
        sources.push({ sourceUrl, kind: "media", mediaType: media.videoUrl || media.type === "video" ? "video" : "image" });
      }
    }
    return sources;
  }

  getEntryById(cacheId: string): MediaCacheEntry | null {
    const row = this.database.prepare("SELECT * FROM media_cache_entries WHERE cache_id = ?").get(cacheId) as MediaCacheRow | undefined;
    return row ? mapRow(row) : null;
  }

  getEntryBySourceUrl(sourceUrl: string): MediaCacheEntry | null {
    const row = this.database.prepare("SELECT * FROM media_cache_entries WHERE source_url = ?").get(sourceUrl) as MediaCacheRow | undefined;
    return row ? mapRow(row) : null;
  }

  getServeableEntry(cacheId: string): MediaCacheEntry | null {
    const entry = this.getEntryById(cacheId);
    if (!entry || !this.isEntryUsable(entry)) {
      return null;
    }
    return entry;
  }

  upsertSuccess(sourceUrl: string, localPath: string, contentType: string, sizeBytes: number, now = new Date()): MediaCacheEntry {
    const cacheId = this.cacheIdForUrl(sourceUrl);
    const cachedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.config.ttlHours * 60 * 60 * 1000).toISOString();
    this.database
      .prepare(
        `
          INSERT INTO media_cache_entries (
            cache_id, source_url, local_path, content_type, size_bytes, cached_at, expires_at, last_error, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
          ON CONFLICT(cache_id) DO UPDATE SET
            source_url = excluded.source_url,
            local_path = excluded.local_path,
            content_type = excluded.content_type,
            size_bytes = excluded.size_bytes,
            cached_at = excluded.cached_at,
            expires_at = excluded.expires_at,
            last_error = NULL,
            updated_at = excluded.updated_at
        `
      )
      .run(cacheId, sourceUrl, localPath, contentType, sizeBytes, cachedAt, expiresAt);
    return this.getEntryById(cacheId)!;
  }

  upsertFailure(sourceUrl: string, message: string): MediaCacheEntry {
    const cacheId = this.cacheIdForUrl(sourceUrl);
    const localPath = path.join(this.rootDir, `${cacheId}.failed`);
    this.database
      .prepare(
        `
          INSERT INTO media_cache_entries (
            cache_id, source_url, local_path, content_type, size_bytes, cached_at, expires_at, last_error, updated_at
          )
          VALUES (?, ?, ?, NULL, 0, NULL, NULL, ?, datetime('now'))
          ON CONFLICT(cache_id) DO UPDATE SET
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `
      )
      .run(cacheId, sourceUrl, localPath, message);
    return this.getEntryById(cacheId)!;
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async prune(): Promise<{ expired: number; overQuota: number; bytesBefore: number; bytesAfter: number }> {
    await this.ensureRoot();
    const nowIso = new Date().toISOString();
    const expiredRows = this.database
      .prepare("SELECT * FROM media_cache_entries WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .all(nowIso) as MediaCacheRow[];
    let expired = 0;
    for (const row of expiredRows) {
      await removeFileIfExists(row.local_path);
      this.database.prepare("DELETE FROM media_cache_entries WHERE cache_id = ?").run(row.cache_id);
      expired += 1;
    }

    let rows = this.cachedRows();
    let bytesBefore = rows.reduce((sum, row) => sum + row.size_bytes, 0);
    let total = bytesBefore;
    let overQuota = 0;
    while (total > this.config.maxBytes && rows.length > 0) {
      const row = rows.shift()!;
      await removeFileIfExists(row.local_path);
      this.database.prepare("DELETE FROM media_cache_entries WHERE cache_id = ?").run(row.cache_id);
      total -= row.size_bytes;
      overQuota += 1;
    }

    return { expired, overQuota, bytesBefore, bytesAfter: Math.max(0, total) };
  }

  private decorateAvatar(sourceUrl: string | null): CachedAvatar {
    if (!sourceUrl) {
      return { cacheId: null, cacheStatus: "no_source", cachedUrl: null, hasRemoteSource: false };
    }
    return this.decorateSource(sourceUrl);
  }

  private decorateMedia(media: TweetMedia): CachedMediaItem {
    const sourceUrl = sourceUrlFromMedia(media);
    if (!sourceUrl) {
      return {
        type: media.type,
        altText: media.altText,
        width: media.width,
        height: media.height,
        cacheId: null,
        cacheStatus: "no_source",
        cachedUrl: null,
        hasRemoteSource: false
      };
    }
    const cached = this.decorateSource(sourceUrl);
    return {
      type: media.videoUrl || media.type === "video" ? "video" : media.type || "image",
      altText: media.altText,
      width: media.width,
      height: media.height,
      ...cached
    };
  }

  private decorateSource(sourceUrl: string): CachedAvatar {
    const cacheId = this.cacheIdForUrl(sourceUrl);
    if (!this.config.enabled) {
      return { cacheId, cacheStatus: "disabled", cachedUrl: null, hasRemoteSource: true };
    }
    const entry = this.getEntryBySourceUrl(sourceUrl);
    if (!entry) {
      return { cacheId, cacheStatus: "missing", cachedUrl: null, hasRemoteSource: true };
    }
    if (entry.lastError) {
      return { cacheId, cacheStatus: "error", cachedUrl: null, lastError: entry.lastError, hasRemoteSource: true };
    }
    if (this.isEntryExpired(entry) || !fsSync.existsSync(entry.localPath)) {
      return { cacheId, cacheStatus: "expired", cachedUrl: null, hasRemoteSource: true };
    }
    return { cacheId, cacheStatus: "cached", cachedUrl: this.publicUrl(cacheId), hasRemoteSource: true };
  }

  private isEntryUsable(entry: MediaCacheEntry): boolean {
    return !entry.lastError && !this.isEntryExpired(entry) && fsSync.existsSync(entry.localPath);
  }

  private isEntryExpired(entry: MediaCacheEntry): boolean {
    return Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now());
  }

  private cachedRows(): MediaCacheRow[] {
    return this.database
      .prepare(
        `
          SELECT * FROM media_cache_entries
          WHERE last_error IS NULL AND cached_at IS NOT NULL
          ORDER BY cached_at ASC
        `
      )
      .all() as MediaCacheRow[];
  }
}

export function sourceUrlFromMedia(media: TweetMedia): string | null {
  return media.videoUrl ?? media.url ?? media.previewImageUrl ?? null;
}

function mapRow(row: MediaCacheRow): MediaCacheEntry {
  return {
    cacheId: row.cache_id,
    sourceUrl: row.source_url,
    localPath: row.local_path,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    cachedAt: row.cached_at,
    expiresAt: row.expires_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
