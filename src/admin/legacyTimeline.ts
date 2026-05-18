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

  page(options: { limit?: number; offset?: number; sources?: TimelineSourceFilter[] } = {}): LegacyTimelinePage {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const sourceSet = normalizeTimelineSources(options.sources);
    const itemSources = timelineItemSources(sourceSet);
    const includeTweets = sourceSet.size === 0 || sourceSet.has("tweet");
    const includeLegacyRss = sourceSet.size === 0 || sourceSet.has("rss");
    const itemTotal = this.timelineItems.count(itemSources);
    const runtimeTotal = includeTweets ? this.timelineTweets.count() : 0;
    const legacyTotal = includeLegacyRss ? this.countLegacy({ rssOnly: sourceSet.has("rss") }) : 0;
    const itemOffset = Math.min(offset, itemTotal);
    const itemLimit = Math.max(0, Math.min(limit, itemTotal - itemOffset));
    const runtimeOffset = Math.max(0, Math.min(offset - itemTotal, runtimeTotal));
    const runtimeLimit = Math.max(0, Math.min(limit - itemLimit, runtimeTotal - runtimeOffset));
    const legacyOffset = Math.max(0, offset - itemTotal - runtimeTotal);
    const legacyLimit = Math.max(0, Math.min(limit - itemLimit - runtimeLimit, legacyTotal - legacyOffset));
    const timelineItems = itemLimit > 0 ? this.timelineItems.latest(itemLimit, itemOffset, itemSources) : [];
    const runtimeTweets = runtimeLimit > 0 ? this.timelineTweets.latest(runtimeLimit, runtimeOffset) : [];
    const legacyItems = legacyLimit > 0 ? this.latestLegacy(legacyLimit, legacyOffset, { rssOnly: sourceSet.has("rss") }) : [];
    const items = [...timelineItems, ...runtimeTweets, ...legacyItems];
    const total = itemTotal + runtimeTotal + legacyTotal;
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    };
  }

  private latestLegacy(limit: number, offset: number, options: { rssOnly?: boolean } = {}): LegacyTimelineItem[] {
    const rssWhere = options.rssOnly ? "AND text_entry.source_file LIKE 'runtime:rss:%'" : "";
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

  private countLegacy(options: { rssOnly?: boolean } = {}): number {
    const rssWhere = options.rssOnly ? "AND text_entry.source_file LIKE 'runtime:rss:%'" : "";
    const row = this.database
      .prepare(`
        SELECT COUNT(*) AS total
        FROM list_entries AS text_entry
        WHERE text_entry.kind = 'text_sent'
          AND text_entry.is_deleted = 0
          AND text_entry.is_empty = 0
          AND (
            text_entry.source_file IS NULL
            OR text_entry.source_file NOT LIKE 'runtime:x-search:%'
          )
          ${rssWhere}
      `)
      .get() as { total: number };
    return row.total;
  }
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
