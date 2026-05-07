import type { Database } from "better-sqlite3";
import { TimelineTweetService, type TimelineTweetItem } from "./timelineTweetService";

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

export class LegacyTimelineService {
  private readonly timelineTweets: TimelineTweetService;

  constructor(private readonly database: Database) {
    this.timelineTweets = new TimelineTweetService(database);
  }

  latest(limit = 40): Array<LegacyTimelineItem | TimelineTweetItem> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const runtimeTweets = this.timelineTweets.latest(safeLimit);
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
        ORDER BY text_entry.line_number DESC, text_entry.id DESC
        LIMIT ?
      `)
      .all(safeLimit) as TimelineRow[];

    const legacyItems: LegacyTimelineItem[] = rows.map((row) => {
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
        media: [],
        likedAt: null,
        retweetedAt: null,
        acceptedAt: null
      };
    });

    return [...runtimeTweets, ...legacyItems].slice(0, safeLimit);
  }
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
