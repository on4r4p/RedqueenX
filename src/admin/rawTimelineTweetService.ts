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

export interface RawTimelineReasonOption {
  reason: string;
  count: number;
}

export interface RawTimelineReasonGroupOption {
  id: string;
  label: string;
  count: number;
}

export interface RawTimelinePageOptions {
  limit?: number;
  offset?: number;
  decisionStatus?: "pending" | "accepted" | "rejected";
  rejectionReasons?: string[];
  rejectionReasonGroups?: string[];
}

type RawTimelineReasonGroupDefinition = {
  id: string;
  label: string;
  exact: string[];
  prefixes: string[];
};

export const rawTimelineReasonGroups: RawTimelineReasonGroupDefinition[] = [
  { id: "banned_word", label: "Banned word", exact: ["banned_word"], prefixes: ["banned_word:"] },
  { id: "banned_user", label: "Banned user", exact: ["banned_user"], prefixes: ["banned_user:"] },
  { id: "tweet_too_old", label: "Too old", exact: ["tweet_too_old"], prefixes: ["tweet_too_old:"] },
  { id: "tweet_too_short", label: "Too short", exact: ["tweet_too_short"], prefixes: [] },
  { id: "language", label: "Language", exact: ["language_unknown", "language_not_allowed"], prefixes: ["language_not_allowed:"] },
  { id: "duplicate", label: "Duplicate", exact: ["tweet_id_already_seen", "tweet_text_already_seen"], prefixes: ["tweet_text_too_similar:"] },
  { id: "missing_keyword", label: "Missing keyword", exact: ["missing_keyword"], prefixes: [] },
  { id: "hashtags", label: "Too many hashtags", exact: ["too_many_hashtags"], prefixes: ["too_many_hashtags:"] },
  { id: "mentions", label: "Too many mentions", exact: ["too_many_mentions"], prefixes: ["too_many_mentions:"] },
  { id: "user_frequency", label: "Too many tweets by user", exact: ["too_many_tweets_by_user"], prefixes: [] },
  { id: "retweets", label: "Retweets", exact: ["not_enough_retweets", "too_many_retweets"], prefixes: ["not_enough_retweets:", "too_many_retweets:"] },
  { id: "favorites", label: "Favorites", exact: ["not_enough_favorites", "too_many_favorites"], prefixes: ["not_enough_favorites:", "too_many_favorites:"] },
  { id: "followers", label: "Followers", exact: ["not_enough_followers"], prefixes: ["not_enough_followers:"] },
  { id: "score", label: "Score too low", exact: ["score_too_low"], prefixes: [] },
  { id: "prefilter", label: "Prefilter", exact: ["prefilter_rejected"], prefixes: [] }
];

const rawTimelineReasonGroupById = new Map(rawTimelineReasonGroups.map((group) => [group.id, group]));

export function normalizeRawTimelineReasonGroupIds(values: string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const id = value.trim();
    if (!id || seen.has(id) || !rawTimelineReasonGroupById.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
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
  constructor(private readonly database: Database) { }

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

  latest(limit = 50, offset = 0, options: Omit<RawTimelinePageOptions, "limit" | "offset"> = {}): RawTimelineTweetItem[] {
    const safeLimit = Math.max(1, Math.min(limit, 300));
    const safeOffset = Math.max(0, Math.floor(offset));
    const filter = rawTimelineFilterSql(options);
    const rows = this.database
      .prepare(`
        SELECT *
        FROM raw_timeline_tweets
        ${filter.whereClause}
        ORDER BY captured_at DESC, run_id DESC, tweet_id DESC
        LIMIT ?
        OFFSET ?
      `)
      .all(...filter.params, safeLimit, safeOffset) as RawTimelineTweetRow[];
    return rows.map(mapRawTweetRow);
  }

  page(options: RawTimelinePageOptions = {}): RawTimelineTweetPage {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 300));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const filterOptions = {
      decisionStatus: options.decisionStatus,
      rejectionReasons: options.rejectionReasons,
      rejectionReasonGroups: options.rejectionReasonGroups
    };
    const total = this.count(filterOptions);
    const items = this.latest(limit, offset, filterOptions);
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total
    };
  }

  count(options: Omit<RawTimelinePageOptions, "limit" | "offset"> = {}): number {
    const filter = rawTimelineFilterSql(options);
    const row = this.database
      .prepare(`SELECT COUNT(*) AS total FROM raw_timeline_tweets ${filter.whereClause}`)
      .get(...filter.params) as { total: number };
    return row.total;
  }

  rejectionReasonOptions(limit = 200): RawTimelineReasonOption[] {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return this.database
      .prepare(`
        SELECT json_each.value AS reason, COUNT(*) AS count
        FROM raw_timeline_tweets, json_each(raw_timeline_tweets.rejection_reasons_json)
        WHERE raw_timeline_tweets.decision_status = 'rejected'
          AND json_each.type = 'text'
          AND TRIM(json_each.value) <> ''
        GROUP BY json_each.value
        ORDER BY count DESC, reason ASC
        LIMIT ?
      `)
      .all(safeLimit) as RawTimelineReasonOption[];
  }

  rejectionReasonGroupOptions(): RawTimelineReasonGroupOption[] {
    return rawTimelineReasonGroups
      .map((group) => ({
        id: group.id,
        label: group.label,
        count: this.count({ decisionStatus: "rejected", rejectionReasonGroups: [group.id] })
      }))
      .filter((group) => group.count > 0);
  }

  clearRejected(): number {
    const result = this.database.prepare("DELETE FROM raw_timeline_tweets WHERE decision_status = 'rejected'").run();
    return result.changes;
  }
}

function rawTimelineFilterSql(options: Omit<RawTimelinePageOptions, "limit" | "offset">) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.decisionStatus) {
    clauses.push("decision_status = ?");
    params.push(options.decisionStatus);
  }
  const rejectionReasons = Array.from(new Set((options.rejectionReasons ?? []).map((reason) => reason.trim()).filter(Boolean)));
  const rejectionReasonGroups = normalizeRawTimelineReasonGroupIds(options.rejectionReasonGroups);
  if (rejectionReasons.length > 0 || rejectionReasonGroups.length > 0) {
    const reasonFilters: string[] = [];
    const reasonParams: unknown[] = [];
    if (rejectionReasons.length > 0) {
      reasonFilters.push(`json_each.value IN (${rejectionReasons.map(() => "?").join(", ")})`);
      reasonParams.push(...rejectionReasons);
    }
    for (const groupId of rejectionReasonGroups) {
      const group = rawTimelineReasonGroupById.get(groupId);
      if (!group) continue;
      reasonFilters.push(rawTimelineReasonGroupSql(group, "json_each.value", reasonParams));
    }
    if (reasonFilters.length > 0) {
      clauses.push(`
        EXISTS (
          SELECT 1
          FROM json_each(raw_timeline_tweets.rejection_reasons_json)
          WHERE json_each.type = 'text'
            AND (${reasonFilters.join(" OR ")})
        )
      `);
      params.push(...reasonParams);
    }
  }
  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function rawTimelineReasonGroupSql(group: RawTimelineReasonGroupDefinition, expression: string, params: unknown[]): string {
  const clauses: string[] = [];
  for (const exact of group.exact) {
    clauses.push(`${expression} = ?`);
    params.push(exact);
  }
  for (const prefix of group.prefixes) {
    clauses.push(`substr(${expression}, 1, ?) = ?`);
    params.push(prefix.length, prefix);
  }
  return clauses.length > 0 ? `(${clauses.join(" OR ")})` : "0";
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
