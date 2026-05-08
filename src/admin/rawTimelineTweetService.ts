import type { Database } from "better-sqlite3";
import type { TweetCandidate } from "../types";

export interface RawTimelineTweetItem {
  runId: string;
  source: "raw";
  keyword: string;
  text: string;
  tweetId: string;
  author: string | null;
  authorName: string | null;
  tweetUrl: string;
  tweetCreatedAt: string | null;
  retweetCount: number;
  favoriteCount: number;
  mediaCount: number;
  urlCount: number;
  decisionStatus: "pending" | "accepted" | "rejected";
  rejectionStage: string | null;
  score: number | null;
  rejectionReasons: string[];
  decisionAt: string | null;
  capturedAt: string;
}

export interface RawTimelineDecisionUpdate {
  tweetId: string;
  status: "accepted" | "rejected";
  stage: "accepted" | "prefilter" | "scoring";
  score: number | null;
  reasons: string[];
}

export interface RawTimelineTweetPage {
  items: RawTimelineTweetItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

type RawTimelineTweetRow = {
  run_id: string;
  tweet_id: string;
  source_keyword: string;
  text: string;
  author_handle: string | null;
  author_name: string | null;
  tweet_url: string | null;
  tweet_created_at: string | null;
  retweet_count: number;
  favorite_count: number;
  media_count: number;
  url_count: number;
  decision_status: string;
  rejection_stage: string | null;
  score: number | null;
  rejection_reasons_json: string;
  decision_at: string | null;
  captured_at: string;
};

export class RawTimelineTweetService {
  constructor(private readonly database: Database) {}

  saveVisible(runId: string, keyword: string, tweets: TweetCandidate[]): number {
    if (tweets.length === 0) return 0;
    const capturedAt = new Date().toISOString();
    const statement = this.database.prepare(`
      INSERT INTO raw_timeline_tweets (
        run_id,
        tweet_id,
        source_keyword,
        text,
        author_handle,
        author_name,
        tweet_url,
        tweet_created_at,
        retweet_count,
        favorite_count,
        media_count,
        url_count,
        captured_at
      )
      VALUES (
        @runId,
        @tweetId,
        @keyword,
        @text,
        @authorHandle,
        @authorName,
        @tweetUrl,
        @tweetCreatedAt,
        @retweetCount,
        @favoriteCount,
        @mediaCount,
        @urlCount,
        @capturedAt
      )
      ON CONFLICT(run_id, tweet_id) DO UPDATE SET
        source_keyword = excluded.source_keyword,
        text = excluded.text,
        author_handle = excluded.author_handle,
        author_name = excluded.author_name,
        tweet_url = excluded.tweet_url,
        tweet_created_at = excluded.tweet_created_at,
        retweet_count = excluded.retweet_count,
        favorite_count = excluded.favorite_count,
        media_count = excluded.media_count,
        url_count = excluded.url_count,
        captured_at = excluded.captured_at
    `);
    const save = this.database.transaction((values: TweetCandidate[]) => {
      let saved = 0;
      for (const tweet of values) {
        statement.run({
          runId,
          tweetId: tweet.id,
          keyword,
          text: tweet.text,
          authorHandle: tweet.user.screenName ?? null,
          authorName: tweet.user.name ?? null,
          tweetUrl: `https://twitter.com/i/web/status/${tweet.id}`,
          tweetCreatedAt: tweet.createdAt?.toISOString() ?? null,
          retweetCount: tweet.retweetCount ?? 0,
          favoriteCount: tweet.favoriteCount ?? 0,
          mediaCount: tweet.entities?.media?.length ?? 0,
          urlCount: tweet.entities?.urls?.length ?? 0,
          capturedAt
        });
        saved += 1;
      }
      return saved;
    });
    return save(tweets);
  }

  saveDecisions(runId: string, decisions: RawTimelineDecisionUpdate[]): number {
    if (decisions.length === 0) return 0;
    const decisionAt = new Date().toISOString();
    const statement = this.database.prepare(`
      UPDATE raw_timeline_tweets
      SET
        decision_status = @status,
        rejection_stage = @stage,
        score = @score,
        rejection_reasons_json = @reasonsJson,
        decision_at = @decisionAt
      WHERE run_id = @runId AND tweet_id = @tweetId
    `);
    const save = this.database.transaction((values: RawTimelineDecisionUpdate[]) => {
      let updated = 0;
      for (const decision of values) {
        const result = statement.run({
          runId,
          tweetId: decision.tweetId,
          status: decision.status,
          stage: decision.stage,
          score: decision.score,
          reasonsJson: JSON.stringify(decision.reasons),
          decisionAt
        });
        updated += result.changes;
      }
      return updated;
    });
    return save(decisions);
  }

  latest(limit = 80, offset = 0): RawTimelineTweetItem[] {
    const safeLimit = Math.max(1, Math.min(limit, 300));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.database
      .prepare(`
        SELECT *
        FROM raw_timeline_tweets
        ORDER BY captured_at DESC, run_id DESC, tweet_id DESC
        LIMIT ?
        OFFSET ?
      `)
      .all(safeLimit, safeOffset) as RawTimelineTweetRow[];
    return rows.map(mapRawTweetRow);
  }

  page(options: { limit?: number; offset?: number } = {}): RawTimelineTweetPage {
    const limit = Math.max(1, Math.min(options.limit ?? 80, 300));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const total = this.count();
    const items = this.latest(limit, offset);
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    };
  }

  count(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS total FROM raw_timeline_tweets").get() as { total: number };
    return row.total;
  }
}

function mapRawTweetRow(row: RawTimelineTweetRow): RawTimelineTweetItem {
  return {
    runId: row.run_id,
    source: "raw",
    keyword: row.source_keyword,
    text: row.text,
    tweetId: row.tweet_id,
    author: row.author_handle,
    authorName: row.author_name,
    tweetUrl: row.tweet_url ?? `https://twitter.com/i/web/status/${row.tweet_id}`,
    tweetCreatedAt: row.tweet_created_at,
    retweetCount: row.retweet_count,
    favoriteCount: row.favorite_count,
    mediaCount: row.media_count,
    urlCount: row.url_count,
    decisionStatus: readDecisionStatus(row.decision_status),
    rejectionStage: row.rejection_stage,
    score: row.score,
    rejectionReasons: readJson<string[]>(row.rejection_reasons_json, []),
    decisionAt: row.decision_at,
    capturedAt: row.captured_at
  };
}

function readDecisionStatus(value: string): "pending" | "accepted" | "rejected" {
  return value === "accepted" || value === "rejected" ? value : "pending";
}

function readJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
