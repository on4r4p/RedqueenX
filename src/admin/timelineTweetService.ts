import type { Database } from "better-sqlite3";
import type { ScoreDecision, TweetCandidate, TweetMedia } from "../types";
import { mediaWithoutEmojiImages } from "../tweetMedia";

export interface TimelineTweetItem {
  id: number;
  source: "tweet" | "from test";
  keyword?: string | null;
  text: string;
  tweetId: string;
  author: string | null;
  authorName: string | null;
  avatarUrl: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  tweetUrl: string;
  extractedUrl: string | null;
  tweetCreatedAt: string | null;
  retweetCount: number;
  favoriteCount: number;
  score: number;
  reasons: string[];
  media: TweetMedia[];
  likedAt: string | null;
  retweetedAt: string | null;
  acceptedAt: string;
}

export interface TimelineTweetPage {
  items: TimelineTweetItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TimelineTweetExportRecord {
  schemaVersion: 1;
  source: "tweet" | "from test";
  keyword?: string | null;
  text: string;
  tweetId: string;
  author: string | null;
  authorName: string | null;
  avatarUrl: string | null;
  tweetUrl: string;
  tweetCreatedAt: string | null;
  retweetCount: number;
  favoriteCount: number;
  score: number;
  reasons: string[];
  media: TweetMedia[];
  urls: string[];
  likedAt: string | null;
  retweetedAt: string | null;
  acceptedAt: string;
}

type TimelineTweetRow = {
  rowid: number;
  tweet_id: string;
  text: string;
  author_handle: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  tweet_url: string | null;
  tweet_created_at: string | null;
  retweet_count: number;
  favorite_count: number;
  score: number;
  reasons_json: string;
  media_json: string;
  urls_json: string;
  source_keyword: string | null;
  accepted_at: string;
  liked_at: string | null;
  retweeted_at: string | null;
};

export interface TimelineManualAcceptedInput {
  keyword: string;
  text: string;
  tweetId: string;
  author: string | null;
  authorName: string | null;
  tweetUrl: string | null;
  tweetCreatedAt: string | null;
  retweetCount: number;
  favoriteCount: number;
  score?: number | null;
  reasons?: string[];
}

export class TimelineTweetService {
  constructor(private readonly database: Database) {}

  saveAccepted(keyword: string, tweet: TweetCandidate, decision: ScoreDecision): void {
    this.saveAcceptedWithSource(keyword, tweet, decision, "tweet");
  }

  saveAcceptedFromTest(keyword: string, tweet: TweetCandidate, decision: ScoreDecision): void {
    this.saveAcceptedWithSource(keyword, tweet, decision, "test");
  }

  saveAcceptedManual(input: TimelineManualAcceptedInput): void {
    const reasons = Array.isArray(input.reasons) && input.reasons.length > 0
      ? input.reasons
      : ["manual_accept_from_rejected_timeline"];
    this.database
      .prepare(`
        INSERT INTO timeline_tweets (
          tweet_id,
          text,
          author_handle,
          author_name,
          author_avatar_url,
          tweet_url,
          lang,
          tweet_created_at,
          retweet_count,
          favorite_count,
          score,
          reasons_json,
          media_json,
          urls_json,
          source_keyword,
          accepted_at
        )
        VALUES (
          @tweetId,
          @text,
          @authorHandle,
          @authorName,
          NULL,
          @tweetUrl,
          NULL,
          @tweetCreatedAt,
          @retweetCount,
          @favoriteCount,
          @score,
          @reasonsJson,
          '[]',
          '[]',
          @sourceKeyword,
          @acceptedAt
        )
        ON CONFLICT(tweet_id) DO UPDATE SET
          text = excluded.text,
          author_handle = excluded.author_handle,
          author_name = excluded.author_name,
          tweet_url = excluded.tweet_url,
          tweet_created_at = excluded.tweet_created_at,
          retweet_count = excluded.retweet_count,
          favorite_count = excluded.favorite_count,
          score = excluded.score,
          reasons_json = excluded.reasons_json,
          source_keyword = excluded.source_keyword
      `)
      .run({
        tweetId: input.tweetId,
        text: input.text,
        authorHandle: input.author,
        authorName: input.authorName,
        tweetUrl: input.tweetUrl ?? `https://twitter.com/i/web/status/${input.tweetId}`,
        tweetCreatedAt: input.tweetCreatedAt,
        retweetCount: input.retweetCount ?? 0,
        favoriteCount: input.favoriteCount ?? 0,
        score: Number.isFinite(input.score) ? Math.max(0, Math.round(Number(input.score))) : 0,
        reasonsJson: JSON.stringify(reasons),
        sourceKeyword: input.keyword,
        acceptedAt: new Date().toISOString()
      });
  }

  private saveAcceptedWithSource(keyword: string, tweet: TweetCandidate, decision: ScoreDecision, source: "tweet" | "test"): void {
    const urls = tweet.entities?.urls ?? [];
    const media = mediaWithoutEmojiImages(tweet.entities?.media);
    const sourceKeyword = source === "test" ? `test:${keyword}` : keyword;
    this.database
      .prepare(`
        INSERT INTO timeline_tweets (
          tweet_id,
          text,
          author_handle,
          author_name,
          author_avatar_url,
          tweet_url,
          lang,
          tweet_created_at,
          retweet_count,
          favorite_count,
          score,
          reasons_json,
          media_json,
          urls_json,
          source_keyword,
          accepted_at
        )
        VALUES (
          @tweetId,
          @text,
          @authorHandle,
          @authorName,
          @authorAvatarUrl,
          @tweetUrl,
          @lang,
          @tweetCreatedAt,
          @retweetCount,
          @favoriteCount,
          @score,
          @reasonsJson,
          @mediaJson,
          @urlsJson,
          @sourceKeyword,
          @acceptedAt
        )
        ON CONFLICT(tweet_id) DO UPDATE SET
          text = excluded.text,
          author_handle = excluded.author_handle,
          author_name = excluded.author_name,
          author_avatar_url = excluded.author_avatar_url,
          tweet_url = excluded.tweet_url,
          lang = excluded.lang,
          tweet_created_at = excluded.tweet_created_at,
          retweet_count = excluded.retweet_count,
          favorite_count = excluded.favorite_count,
          score = excluded.score,
          reasons_json = excluded.reasons_json,
          media_json = excluded.media_json,
          urls_json = excluded.urls_json,
          source_keyword = excluded.source_keyword
      `)
      .run({
        tweetId: tweet.id,
        text: tweet.text,
        authorHandle: tweet.user.screenName,
        authorName: tweet.user.name ?? null,
        authorAvatarUrl: tweet.user.profileImageUrl ?? null,
        tweetUrl: `https://twitter.com/i/web/status/${tweet.id}`,
        lang: tweet.lang ?? null,
        tweetCreatedAt: tweet.createdAt?.toISOString() ?? null,
        retweetCount: tweet.retweetCount ?? 0,
        favoriteCount: tweet.favoriteCount ?? 0,
        score: decision.score,
        reasonsJson: JSON.stringify(decision.reasons),
        mediaJson: JSON.stringify(media),
        urlsJson: JSON.stringify(urls),
        sourceKeyword,
        acceptedAt: new Date().toISOString()
      });
  }

  latest(limit = 50, offset = 0): TimelineTweetItem[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.database
      .prepare(`
        SELECT rowid, *
        FROM timeline_tweets
        ORDER BY accepted_at DESC, tweet_created_at DESC, rowid DESC
        LIMIT ?
        OFFSET ?
      `)
      .all(safeLimit, safeOffset) as TimelineTweetRow[];

    return rows.map(mapTweetRow);
  }

  page(options: { limit?: number; offset?: number } = {}): TimelineTweetPage {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
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
    const row = this.database.prepare("SELECT COUNT(*) AS total FROM timeline_tweets").get() as { total: number };
    return row.total;
  }

  exportAll(): TimelineTweetExportRecord[] {
    const rows = this.database
      .prepare(`
        SELECT rowid, *
        FROM timeline_tweets
        ORDER BY accepted_at DESC, tweet_created_at DESC, rowid DESC
      `)
      .all() as TimelineTweetRow[];

    return rows.map(mapTweetExportRow);
  }

  importExportRecords(records: TimelineTweetExportRecord[]): number {
    if (records.length === 0) {
      return 0;
    }

    const insert = this.database.prepare(`
      INSERT INTO timeline_tweets (
        tweet_id,
        text,
        author_handle,
        author_name,
        author_avatar_url,
        tweet_url,
        lang,
        tweet_created_at,
        retweet_count,
        favorite_count,
        score,
        reasons_json,
        media_json,
        urls_json,
        source_keyword,
        accepted_at,
        liked_at,
        retweeted_at
      )
      VALUES (
        @tweetId,
        @text,
        @authorHandle,
        @authorName,
        @authorAvatarUrl,
        @tweetUrl,
        NULL,
        @tweetCreatedAt,
        @retweetCount,
        @favoriteCount,
        @score,
        @reasonsJson,
        @mediaJson,
        @urlsJson,
        @sourceKeyword,
        @acceptedAt,
        @likedAt,
        @retweetedAt
      )
      ON CONFLICT(tweet_id) DO UPDATE SET
        text = excluded.text,
        author_handle = excluded.author_handle,
        author_name = excluded.author_name,
        author_avatar_url = excluded.author_avatar_url,
        tweet_url = excluded.tweet_url,
        tweet_created_at = excluded.tweet_created_at,
        retweet_count = excluded.retweet_count,
        favorite_count = excluded.favorite_count,
        score = excluded.score,
        reasons_json = excluded.reasons_json,
        media_json = excluded.media_json,
        urls_json = excluded.urls_json,
        source_keyword = excluded.source_keyword,
        accepted_at = excluded.accepted_at,
        liked_at = excluded.liked_at,
        retweeted_at = excluded.retweeted_at
    `);

    const save = this.database.transaction((items: TimelineTweetExportRecord[]) => {
      let imported = 0;
      for (const item of items) {
        const urls = Array.isArray(item.urls) ? item.urls.filter((value) => typeof value === "string" && value) : [];
        insert.run({
          tweetId: item.tweetId,
          text: item.text,
          authorHandle: item.author ?? null,
          authorName: item.authorName ?? null,
          authorAvatarUrl: item.avatarUrl ?? null,
          tweetUrl: item.tweetUrl || `https://twitter.com/i/web/status/${item.tweetId}`,
          tweetCreatedAt: item.tweetCreatedAt ?? null,
          retweetCount: Number.isFinite(item.retweetCount) ? item.retweetCount : 0,
          favoriteCount: Number.isFinite(item.favoriteCount) ? item.favoriteCount : 0,
          score: Number.isFinite(item.score) ? item.score : 0,
          reasonsJson: JSON.stringify(Array.isArray(item.reasons) ? item.reasons : []),
          mediaJson: JSON.stringify(Array.isArray(item.media) ? mediaWithoutEmojiImages(item.media) : []),
          urlsJson: JSON.stringify(urls),
          sourceKeyword: exportSourceKeyword(item),
          acceptedAt: item.acceptedAt || new Date().toISOString(),
          likedAt: item.likedAt ?? null,
          retweetedAt: item.retweetedAt ?? null
        });
        imported += 1;
      }
      return imported;
    });

    return save(records);
  }

  find(tweetId: string): TimelineTweetItem | null {
    const row = this.database
      .prepare(
        `
          SELECT rowid, *
          FROM timeline_tweets
          WHERE tweet_id = ?
        `
      )
      .get(tweetId) as TimelineTweetRow | undefined;

    return row ? mapTweetRow(row) : null;
  }

  markLiked(tweetId: string): void {
    this.database
      .prepare("UPDATE timeline_tweets SET liked_at = ?, like_error = NULL WHERE tweet_id = ?")
      .run(new Date().toISOString(), tweetId);
  }

  markRetweeted(tweetId: string): void {
    this.database
      .prepare("UPDATE timeline_tweets SET retweeted_at = ?, retweet_error = NULL WHERE tweet_id = ?")
      .run(new Date().toISOString(), tweetId);
  }

  markActionError(tweetId: string, action: "like" | "retweet", message: string): void {
    const column = action === "like" ? "like_error" : "retweet_error";
    this.database.prepare(`UPDATE timeline_tweets SET ${column} = ? WHERE tweet_id = ?`).run(message, tweetId);
  }
}

function mapTweetRow(row: TimelineTweetRow): TimelineTweetItem {
  const urls = readJson<string[]>(row.urls_json, []);
  return {
    id: row.rowid,
    source: row.source_keyword?.startsWith("test:") ? "from test" : "tweet",
    keyword: displayKeyword(row.source_keyword),
    text: row.text,
    tweetId: row.tweet_id,
    author: row.author_handle,
    authorName: row.author_name,
    avatarUrl: row.author_avatar_url,
    sourceFile: "timeline_tweets",
    lineNumber: null,
    tweetUrl: row.tweet_url ?? `https://twitter.com/i/web/status/${row.tweet_id}`,
    extractedUrl: urls[0] ?? null,
    tweetCreatedAt: row.tweet_created_at,
    retweetCount: row.retweet_count,
    favoriteCount: row.favorite_count,
    score: row.score,
    reasons: readJson<string[]>(row.reasons_json, []),
    media: mediaWithoutEmojiImages(readJson<TweetMedia[]>(row.media_json, [])),
    likedAt: row.liked_at,
    retweetedAt: row.retweeted_at,
    acceptedAt: row.accepted_at
  };
}

function mapTweetExportRow(row: TimelineTweetRow): TimelineTweetExportRecord {
  return {
    schemaVersion: 1,
    source: row.source_keyword?.startsWith("test:") ? "from test" : "tweet",
    keyword: displayKeyword(row.source_keyword),
    text: row.text,
    tweetId: row.tweet_id,
    author: row.author_handle,
    authorName: row.author_name,
    avatarUrl: row.author_avatar_url,
    tweetUrl: row.tweet_url ?? `https://twitter.com/i/web/status/${row.tweet_id}`,
    tweetCreatedAt: row.tweet_created_at,
    retweetCount: row.retweet_count,
    favoriteCount: row.favorite_count,
    score: row.score,
    reasons: readJson<string[]>(row.reasons_json, []),
    media: mediaWithoutEmojiImages(readJson<TweetMedia[]>(row.media_json, [])),
    urls: readJson<string[]>(row.urls_json, []),
    likedAt: row.liked_at,
    retweetedAt: row.retweeted_at,
    acceptedAt: row.accepted_at
  };
}

function displayKeyword(sourceKeyword: string | null): string | null {
  if (!sourceKeyword) return null;
  return sourceKeyword.startsWith("test:") ? sourceKeyword.slice("test:".length) : sourceKeyword;
}

function exportSourceKeyword(item: TimelineTweetExportRecord): string | null {
  if (!item.keyword) {
    return null;
  }
  return item.source === "from test" ? `test:${item.keyword}` : item.keyword;
}

function readJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
