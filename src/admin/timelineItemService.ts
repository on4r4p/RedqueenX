import type { Database } from "better-sqlite3";
import type { TweetMedia } from "../types";

export type TimelineItemSource = "rss" | "reddit";

export interface TimelineItemInput {
  source: TimelineItemSource;
  externalId: string;
  keyword?: string | null;
  title?: string | null;
  text: string;
  author?: string | null;
  authorName?: string | null;
  avatarUrl?: string | null;
  itemUrl?: string | null;
  externalCreatedAt?: string | null;
  score?: number | null;
  engagementScore?: number | null;
  commentsCount?: number | null;
  reasons?: string[];
  media?: TweetMedia[];
  urls?: string[];
  metadata?: Record<string, unknown>;
  acceptedAt?: string;
}

export interface TimelineItem {
  id: string;
  source: TimelineItemSource;
  keyword: string | null;
  title: string | null;
  text: string;
  tweetId: null;
  author: string | null;
  authorName: string | null;
  avatarUrl: string | null;
  sourceFile: null;
  lineNumber: null;
  tweetUrl: string | null;
  extractedUrl: string | null;
  tweetCreatedAt: string | null;
  retweetCount: number;
  favoriteCount: number;
  score: number;
  reasons: string[];
  media: TweetMedia[];
  likedAt: null;
  retweetedAt: null;
  acceptedAt: string;
}

type TimelineItemRow = {
  source: TimelineItemSource;
  external_id: string;
  keyword: string | null;
  title: string | null;
  text: string;
  author_handle: string | null;
  author_name: string | null;
  avatar_url: string | null;
  item_url: string | null;
  external_created_at: string | null;
  score: number;
  engagement_score: number;
  comments_count: number;
  reasons_json: string;
  media_json: string;
  urls_json: string;
  accepted_at: string;
  archived_at: string | null;
};

export class TimelineItemService {
  constructor(private readonly database: Database) {}

  save(input: TimelineItemInput): void {
    const urls = Array.isArray(input.urls) ? input.urls.filter(Boolean) : [];
    this.database
      .prepare(`
        INSERT INTO timeline_items (
          source,
          external_id,
          keyword,
          title,
          text,
          author_handle,
          author_name,
          avatar_url,
          item_url,
          external_created_at,
          score,
          engagement_score,
          comments_count,
          reasons_json,
          media_json,
          urls_json,
          metadata_json,
          accepted_at
        )
        VALUES (
          @source,
          @externalId,
          @keyword,
          @title,
          @text,
          @authorHandle,
          @authorName,
          @avatarUrl,
          @itemUrl,
          @externalCreatedAt,
          @score,
          @engagementScore,
          @commentsCount,
          @reasonsJson,
          @mediaJson,
          @urlsJson,
          @metadataJson,
          @acceptedAt
        )
        ON CONFLICT(source, external_id) DO UPDATE SET
          keyword = excluded.keyword,
          title = excluded.title,
          text = excluded.text,
          author_handle = excluded.author_handle,
          author_name = excluded.author_name,
          avatar_url = excluded.avatar_url,
          item_url = excluded.item_url,
          external_created_at = excluded.external_created_at,
          score = excluded.score,
          engagement_score = excluded.engagement_score,
          comments_count = excluded.comments_count,
          reasons_json = excluded.reasons_json,
          media_json = excluded.media_json,
          urls_json = excluded.urls_json,
          metadata_json = excluded.metadata_json
      `)
      .run({
        source: input.source,
        externalId: input.externalId,
        keyword: input.keyword ?? null,
        title: input.title ?? null,
        text: input.text,
        authorHandle: input.author ?? null,
        authorName: input.authorName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        itemUrl: input.itemUrl ?? null,
        externalCreatedAt: input.externalCreatedAt ?? null,
        score: Number.isFinite(input.score) ? Math.round(Number(input.score)) : 0,
        engagementScore: Number.isFinite(input.engagementScore) ? Math.round(Number(input.engagementScore)) : 0,
        commentsCount: Number.isFinite(input.commentsCount) ? Math.round(Number(input.commentsCount)) : 0,
        reasonsJson: JSON.stringify(Array.isArray(input.reasons) ? input.reasons : []),
        mediaJson: JSON.stringify(Array.isArray(input.media) ? input.media : []),
        urlsJson: JSON.stringify(urls),
        metadataJson: JSON.stringify(input.metadata ?? {}),
        acceptedAt: input.acceptedAt ?? new Date().toISOString()
      });
  }

  latest(limit = 50, offset = 0, sources?: TimelineItemSource[], archived = false): TimelineItem[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const activeSources = normalizeSources(sources);
    if (sources && activeSources.length === 0) {
      return [];
    }
    const sourceWhere = activeSources.length > 0 ? `AND source IN (${activeSources.map(() => "?").join(", ")})` : "";
    const rows = this.database
      .prepare(`
        SELECT *
        FROM timeline_items
        WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"}
        ${sourceWhere}
        ORDER BY accepted_at DESC, external_created_at DESC, source ASC, external_id DESC
        LIMIT ?
        OFFSET ?
      `)
      .all(...activeSources, safeLimit, safeOffset) as TimelineItemRow[];
    return rows.map(mapTimelineItemRow);
  }

  count(sources?: TimelineItemSource[], archived = false): number {
    const activeSources = normalizeSources(sources);
    if (sources && activeSources.length === 0) {
      return 0;
    }
    const sourceWhere = activeSources.length > 0 ? `AND source IN (${activeSources.map(() => "?").join(", ")})` : "";
    const row = this.database
      .prepare(`SELECT COUNT(*) AS total FROM timeline_items WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"} ${sourceWhere}`)
      .get(...activeSources) as { total: number };
    return row.total;
  }

  archiveAll(sources?: TimelineItemSource[], archivedAt = new Date().toISOString()): number {
    const activeSources = normalizeSources(sources);
    if (sources && activeSources.length === 0) {
      return 0;
    }
    const sourceWhere = activeSources.length > 0 ? `AND source IN (${activeSources.map(() => "?").join(", ")})` : "";
    const result = this.database
      .prepare(`UPDATE timeline_items SET archived_at = ? WHERE archived_at IS NULL ${sourceWhere}`)
      .run(archivedAt, ...activeSources);
    return Number(result.changes ?? 0);
  }

  restoreAll(sources?: TimelineItemSource[]): number {
    const activeSources = normalizeSources(sources);
    if (sources && activeSources.length === 0) {
      return 0;
    }
    const sourceWhere = activeSources.length > 0 ? `AND source IN (${activeSources.map(() => "?").join(", ")})` : "";
    const result = this.database
      .prepare(`UPDATE timeline_items SET archived_at = NULL WHERE archived_at IS NOT NULL ${sourceWhere}`)
      .run(...activeSources);
    return Number(result.changes ?? 0);
  }
}

function normalizeSources(sources: TimelineItemSource[] | undefined): TimelineItemSource[] {
  if (!sources) return [];
  return Array.from(new Set(sources.filter((source) => source === "rss" || source === "reddit")));
}

function mapTimelineItemRow(row: TimelineItemRow): TimelineItem {
  const urls = readJson<string[]>(row.urls_json, []);
  const body = row.title && row.text !== row.title ? `${row.title}\n${row.text}` : row.text;
  return {
    id: `${row.source}:${row.external_id}`,
    source: row.source,
    keyword: row.keyword,
    title: row.title,
    text: body,
    tweetId: null,
    author: row.author_handle,
    authorName: row.author_name,
    avatarUrl: row.avatar_url,
    sourceFile: null,
    lineNumber: null,
    tweetUrl: row.item_url,
    extractedUrl: urls[0] ?? row.item_url,
    tweetCreatedAt: row.external_created_at,
    retweetCount: row.engagement_score,
    favoriteCount: row.comments_count,
    score: row.score,
    reasons: readJson<string[]>(row.reasons_json, []),
    media: readJson<TweetMedia[]>(row.media_json, []),
    likedAt: null,
    retweetedAt: null,
    acceptedAt: row.accepted_at
  };
}

function readJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
