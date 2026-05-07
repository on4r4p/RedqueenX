import type { Database } from "better-sqlite3";
import type { ScoreDecision, TweetCandidate, TweetMedia } from "../types";

export interface TimelineTweetItem {
  id: number;
  source: "tweet" | "from test";
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
  media: TweetMedia[];
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
  media_json: string;
  urls_json: string;
  source_keyword: string | null;
  accepted_at: string;
  liked_at: string | null;
  retweeted_at: string | null;
};

export class TimelineTweetService {
  constructor(private readonly database: Database) {}

  saveAccepted(keyword: string, tweet: TweetCandidate, decision: ScoreDecision): void {
    this.saveAcceptedWithSource(keyword, tweet, decision, "tweet");
  }

  saveAcceptedFromTest(keyword: string, tweet: TweetCandidate, decision: ScoreDecision): void {
    this.saveAcceptedWithSource(keyword, tweet, decision, "test");
  }

  private saveAcceptedWithSource(keyword: string, tweet: TweetCandidate, decision: ScoreDecision, source: "tweet" | "test"): void {
    const urls = tweet.entities?.urls ?? [];
    const media = tweet.entities?.media ?? [];
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

  latest(limit = 40): TimelineTweetItem[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.database
      .prepare(`
        SELECT rowid, *
        FROM timeline_tweets
        ORDER BY accepted_at DESC, tweet_created_at DESC, rowid DESC
        LIMIT ?
      `)
      .all(safeLimit) as TimelineTweetRow[];

    return rows.map(mapTweetRow);
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
    media: readJson<TweetMedia[]>(row.media_json, []),
    likedAt: row.liked_at,
    retweetedAt: row.retweeted_at,
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
