import type { Database } from "better-sqlite3";
import { TimelineItemService, type TimelineItem, type TimelineItemSource } from "./timelineItemService";
import { TimelineTweetService, type TimelineTweetItem } from "./timelineTweetService";

export type TimelineSourceFilter = "tweet" | "rss";

export interface LegacyTimelineItem {
  id: number;
  source: "legacy" | "rss";
  text: string;
  tweetId: string | null;
  author: string | null;
  authorName: string | null;
  avatarUrl: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  tweetUrl: string | null;
  extractedUrl: string | null;
  tweetCreatedAt: string | null;
  retweetCount: number | null;
  favoriteCount: number | null;
  score: number | null;
  reasons: string[];
  media: [];
  likedAt: string | null;
  retweetedAt: string | null;
  acceptedAt: string | null;
}

type TimelineRow = {
  id: number;
  text: string;
  tweet_id: string | null;
  source_file: string | null;
  line_number: number | null;
};

export interface LegacyTimelinePage {
  items: Array<LegacyTimelineItem | TimelineTweetItem | TimelineItem>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export class LegacyTimelineService {
  private readonly timelineItems: TimelineItemService;
  private readonly timelineTweets: TimelineTweetService;

  constructor(private readonly database: Database) {
    this.timelineItems = new TimelineItemService(database);
    this.timelineTweets = new TimelineTweetService(database);
  }

  latest(limit = 50): Array<LegacyTimelineItem | TimelineTweetItem | TimelineItem> {
    return this.page({ limit, offset: 0 }).items;
  }

  page(options: { limit?: number; offset?: number; sources?: TimelineSourceFilter[]; archived?: boolean } = {}): LegacyTimelinePage {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const archived = Boolean(options.archived);
    const sourceSet = normalizeTimelineSources(options.sources);
    const itemSources = timelineItemSources(sourceSet);
    const includeTweets = sourceSet.size === 0 || sourceSet.has("tweet");
    const includeLegacyRss = sourceSet.size === 0 || sourceSet.has("rss");
    const itemTotal = this.timelineItems.count(itemSources, archived);
    const runtimeTotal = includeTweets ? this.timelineTweets.count(archived) : 0;
    const legacyRssOnly = sourceSet.size === 1 && sourceSet.has("rss");
    const legacyTotal = includeLegacyRss ? this.countLegacy({ rssOnly: legacyRssOnly, archived }) : 0;
    const timelineItems = itemTotal > 0 ? this.timelineItems.latest(itemTotal, 0, itemSources, archived) : [];
    const runtimeTweets = runtimeTotal > 0 ? this.timelineTweets.latest(runtimeTotal, 0, archived) : [];
    const legacyItems = legacyTotal > 0 ? this.latestLegacy(legacyTotal, 0, { rssOnly: legacyRssOnly, archived }) : [];
    const items = [...timelineItems, ...runtimeTweets, ...legacyItems]
      .sort(compareTimelineItems)
      .slice(offset, offset + limit);
    const total = itemTotal + runtimeTotal + legacyTotal;
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    };
  }

  private latestLegacy(limit: number, offset: number, options: { rssOnly?: boolean; archived?: boolean } = {}): LegacyTimelineItem[] {
    const rssWhere = options.rssOnly ? "AND text_entry.source_file LIKE 'runtime:rss:%'" : "";
    const archiveWhere = options.archived ? "text_entry.archived_at IS NOT NULL" : "text_entry.archived_at IS NULL";
    const rows = this.database
      .prepare(`
        SELECT
          text_entry.id,
          text_entry.raw_value AS text,
          tweet_entry.raw_value AS tweet_id,
          text_entry.source_file,
          text_entry.line_number
        FROM list_entries AS text_entry
        LEFT JOIN list_entries AS tweet_entry
          ON tweet_entry.kind = 'tweet_sent'
          AND tweet_entry.line_number = text_entry.line_number
        WHERE text_entry.kind = 'text_sent'
          AND text_entry.is_deleted = 0
          AND text_entry.is_empty = 0
          AND ${archiveWhere}
          AND (
            text_entry.source_file IS NULL
            OR text_entry.source_file NOT LIKE 'runtime:x-search:%'
          )
          ${rssWhere}
        ORDER BY text_entry.line_number DESC, text_entry.id DESC
        LIMIT ?
        OFFSET ?
      `)
      .all(limit, offset) as TimelineRow[];

    return rows.map((row) => {
      const tweetId = normalizeTweetId(row.tweet_id);
      return {
        id: row.id,
        source: row.source_file?.startsWith("runtime:rss:") ? "rss" : "legacy",
        text: row.text,
        tweetId,
        author: extractAuthor(row.text),
        authorName: null,
        avatarUrl: null,
        sourceFile: row.source_file,
        lineNumber: row.line_number,
        tweetUrl: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : null,
        extractedUrl: extractFirstUrl(row.text),
        tweetCreatedAt: null,
        retweetCount: null,
        favoriteCount: null,
        score: null,
        reasons: [],
        media: [],
        likedAt: null,
        retweetedAt: null,
        acceptedAt: null
      };
    });
  }

  private countLegacy(options: { rssOnly?: boolean; archived?: boolean } = {}): number {
    const rssWhere = options.rssOnly ? "AND text_entry.source_file LIKE 'runtime:rss:%'" : "";
    const archiveWhere = options.archived ? "text_entry.archived_at IS NOT NULL" : "text_entry.archived_at IS NULL";
    const row = this.database
      .prepare(`
        SELECT COUNT(*) AS total
        FROM list_entries AS text_entry
        WHERE text_entry.kind = 'text_sent'
          AND text_entry.is_deleted = 0
          AND text_entry.is_empty = 0
          AND ${archiveWhere}
          AND (
            text_entry.source_file IS NULL
            OR text_entry.source_file NOT LIKE 'runtime:x-search:%'
          )
          ${rssWhere}
      `)
      .get() as { total: number };
    return row.total;
  }

  archiveAll(sources?: TimelineSourceFilter[], archivedAt = new Date().toISOString()): { tweets: number; items: number; legacy: number } {
    const sourceSet = normalizeTimelineSources(sources);
    const includeTweets = sourceSet.size === 0 || sourceSet.has("tweet");
    const includeLegacyRss = sourceSet.size === 0 || sourceSet.has("rss");
    const legacyRssOnly = sourceSet.size === 1 && sourceSet.has("rss");
    const tweets = includeTweets ? this.timelineTweets.archiveAll(archivedAt) : 0;
    const items = this.timelineItems.archiveAll(timelineItemSources(sourceSet), archivedAt);
    const legacy = includeLegacyRss ? this.archiveLegacy(archivedAt, { rssOnly: legacyRssOnly }) : 0;
    return { tweets, items, legacy };
  }

  restoreAll(sources?: TimelineSourceFilter[]): { tweets: number; items: number; legacy: number } {
    const sourceSet = normalizeTimelineSources(sources);
    const includeTweets = sourceSet.size === 0 || sourceSet.has("tweet");
    const includeLegacyRss = sourceSet.size === 0 || sourceSet.has("rss");
    const legacyRssOnly = sourceSet.size === 1 && sourceSet.has("rss");
    const tweets = includeTweets ? this.timelineTweets.restoreAll() : 0;
    const items = this.timelineItems.restoreAll(timelineItemSources(sourceSet));
    const legacy = includeLegacyRss ? this.restoreLegacy({ rssOnly: legacyRssOnly }) : 0;
    return { tweets, items, legacy };
  }

  private archiveLegacy(archivedAt: string, options: { rssOnly?: boolean } = {}): number {
    const rssWhere = options.rssOnly ? "AND source_file LIKE 'runtime:rss:%'" : "";
    const result = this.database
      .prepare(`
        UPDATE list_entries
        SET archived_at = ?
        WHERE kind = 'text_sent'
          AND is_deleted = 0
          AND is_empty = 0
          AND archived_at IS NULL
          AND (
            source_file IS NULL
            OR source_file NOT LIKE 'runtime:x-search:%'
          )
          ${rssWhere}
      `)
      .run(archivedAt);
    return Number(result.changes ?? 0);
  }

  private restoreLegacy(options: { rssOnly?: boolean } = {}): number {
    const rssWhere = options.rssOnly ? "AND source_file LIKE 'runtime:rss:%'" : "";
    const result = this.database
      .prepare(`
        UPDATE list_entries
        SET archived_at = NULL
        WHERE kind = 'text_sent'
          AND is_deleted = 0
          AND is_empty = 0
          AND archived_at IS NOT NULL
          AND (
            source_file IS NULL
            OR source_file NOT LIKE 'runtime:x-search:%'
          )
          ${rssWhere}
      `)
      .run();
    return Number(result.changes ?? 0);
  }
}

function compareTimelineItems(
  left: LegacyTimelineItem | TimelineTweetItem | TimelineItem,
  right: LegacyTimelineItem | TimelineTweetItem | TimelineItem
): number {
  const dateDiff = timelineSortTime(right) - timelineSortTime(left);
  if (dateDiff !== 0) return dateDiff;
  const sourceDiff = sourcePriority(left.source) - sourcePriority(right.source);
  if (sourceDiff !== 0) return sourceDiff;
  return String(right.id).localeCompare(String(left.id));
}

function timelineSortTime(item: LegacyTimelineItem | TimelineTweetItem | TimelineItem): number {
  const date =
    item.source === "rss"
      ? item.tweetCreatedAt ?? item.acceptedAt
      : item.source === "tweet" || item.source === "from test"
        ? item.acceptedAt ?? item.tweetCreatedAt
        : item.acceptedAt ?? item.tweetCreatedAt;
  if (!date) return 0;
  const time = new Date(date).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sourcePriority(source: string): number {
  if (source === "tweet" || source === "from test") return 0;
  if (source === "rss") return 1;
  return 2;
}

function normalizeTimelineSources(sources: TimelineSourceFilter[] | undefined): Set<TimelineSourceFilter> {
  if (!sources) return new Set();
  return new Set(sources.filter((source) => source === "tweet" || source === "rss"));
}

function timelineItemSources(sources: Set<TimelineSourceFilter>): TimelineItemSource[] | undefined {
  if (sources.size === 0) return undefined;
  const itemSources: TimelineItemSource[] = [];
  if (sources.has("rss")) itemSources.push("rss");
  return itemSources;
}

function normalizeTweetId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function extractAuthor(text: string): string | null {
  const startMatch = text.match(/^(?:RT\s+)?@([A-Za-z0-9_]+)/);
  if (startMatch?.[1]) {
    return startMatch[1];
  }

  const anyMention = text.match(/@([A-Za-z0-9_]+)/);
  return anyMention?.[1] ?? null;
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/);
  if (!match?.[0]) {
    return null;
  }
  return match[0].replace(/[),.]+$/, "");
}
