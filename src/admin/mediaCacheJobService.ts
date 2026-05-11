import type { Database } from "better-sqlite3";

export type MediaCacheJobStatus = "pending" | "running" | "completed" | "failed";

export type MediaCacheJobRecord = {
  id: number;
  tweetId: string;
  status: MediaCacheJobStatus;
  source: string;
  attempts: number;
  lastError: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type MediaCacheJobRow = {
  id: number;
  tweet_id: string;
  status: MediaCacheJobStatus;
  source: string;
  attempts: number;
  last_error: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export class MediaCacheJobService {
  constructor(private readonly database: Database) {}

  enqueue(tweetId: string, source = "admin"): MediaCacheJobRecord {
    const existing = this.database
      .prepare(
        `
          SELECT *
          FROM media_cache_jobs
          WHERE tweet_id = ?
            AND status IN ('pending', 'running')
          ORDER BY id DESC
          LIMIT 1
        `
      )
      .get(tweetId) as MediaCacheJobRow | undefined;
    if (existing) {
      return mapJob(existing);
    }

    const result = this.database
      .prepare(
        `
          INSERT INTO media_cache_jobs (tweet_id, status, source, requested_at, updated_at)
          VALUES (?, 'pending', ?, datetime('now'), datetime('now'))
        `
      )
      .run(tweetId, source);
    return this.find(Number(result.lastInsertRowid))!;
  }

  claimNext(): MediaCacheJobRecord | null {
    const transaction = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `
            SELECT *
            FROM media_cache_jobs
            WHERE status = 'pending'
            ORDER BY requested_at ASC, id ASC
            LIMIT 1
          `
        )
        .get() as MediaCacheJobRow | undefined;
      if (!row) {
        return null;
      }
      const result = this.database
        .prepare(
          `
            UPDATE media_cache_jobs
            SET status = 'running',
                attempts = attempts + 1,
                started_at = datetime('now'),
                updated_at = datetime('now'),
                last_error = NULL
            WHERE id = ?
              AND status = 'pending'
          `
        )
        .run(row.id);
      if (result.changes !== 1) {
        return null;
      }
      return this.find(row.id);
    });
    return transaction();
  }

  complete(id: number): void {
    this.database
      .prepare(
        `
          UPDATE media_cache_jobs
          SET status = 'completed',
              completed_at = datetime('now'),
              updated_at = datetime('now'),
              last_error = NULL
          WHERE id = ?
        `
      )
      .run(id);
  }

  fail(id: number, error: string): void {
    this.database
      .prepare(
        `
          UPDATE media_cache_jobs
          SET status = 'failed',
              completed_at = datetime('now'),
              updated_at = datetime('now'),
              last_error = ?
          WHERE id = ?
        `
      )
      .run(error.slice(0, 2000), id);
  }

  resetStaleRunning(maxAgeMinutes = 30): number {
    const result = this.database
      .prepare(
        `
          UPDATE media_cache_jobs
          SET status = 'pending',
              started_at = NULL,
              updated_at = datetime('now'),
              last_error = COALESCE(last_error, 'Worker stopped before the media cache job completed.')
          WHERE status = 'running'
            AND started_at <= datetime('now', ?)
        `
      )
      .run(`-${Math.max(1, Math.floor(maxAgeMinutes))} minutes`);
    return result.changes;
  }

  find(id: number): MediaCacheJobRecord | null {
    const row = this.database.prepare("SELECT * FROM media_cache_jobs WHERE id = ?").get(id) as MediaCacheJobRow | undefined;
    return row ? mapJob(row) : null;
  }
}

function mapJob(row: MediaCacheJobRow): MediaCacheJobRecord {
  return {
    id: row.id,
    tweetId: row.tweet_id,
    status: row.status,
    source: row.source,
    attempts: row.attempts,
    lastError: row.last_error,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}
