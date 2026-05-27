import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { RunEventRecord, RunRecord, RunStats, RunStatus } from "../types";

type RunRow = {
  id: string;
  status: RunStatus;
  started_at: string;
  updated_at: string;
  stopped_at: string | null;
  stats_json: string;
};

type RunEventRow = {
  id: number;
  run_id: string | null;
  type: string;
  message: string;
  data_json: string;
  created_at: string;
};

type RunKeywordRow = {
  run_id: string;
  position: number;
  keyword: string;
  created_at: string;
};

export interface RunKeywordItem {
  runId: string;
  position: number;
  keyword: string;
  createdAt: string;
}

export class RunService {
  constructor(private readonly database: Database) {}

  start(stats: Partial<RunStats> = {}): RunRecord {
    const existing = this.current();
    if (existing && (existing.status === "running" || existing.status === "paused")) {
      return existing;
    }

    const now = new Date().toISOString();
    const run: RunRecord = {
      id: randomUUID(),
      status: "running",
      startedAt: now,
      updatedAt: now,
      stoppedAt: null,
      statsJson: JSON.stringify(createRunStats(stats))
    };

    this.database
      .prepare(`
        INSERT INTO runs (id, status, started_at, updated_at, stopped_at, stats_json)
        VALUES (@id, @status, @startedAt, @updatedAt, @stoppedAt, @statsJson)
      `)
      .run(run);
    this.addEvent(run.id, "run.started", "Run started");
    return run;
  }

  pause(id: string): RunRecord {
    return this.transition(id, "paused", "run.paused", "Run paused");
  }

  resume(id: string): RunRecord {
    return this.transition(id, "running", "run.resumed", "Run resumed");
  }

  stop(id: string): RunRecord {
    return this.transition(id, "stopped", "run.stopped", "Run stopped", true);
  }

  complete(id: string): RunRecord {
    return this.transition(id, "completed", "run.completed", "Run completed", true);
  }

  current(): RunRecord | null {
    const row = this.database
      .prepare("SELECT * FROM runs WHERE status IN ('running', 'paused') ORDER BY started_at DESC, id DESC LIMIT 1")
      .get() as RunRow | undefined;

    return row ? mapRun(row) : null;
  }

  latest(): RunRecord | null {
    const row = this.database
      .prepare("SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT 1")
      .get() as RunRow | undefined;

    return row ? mapRun(row) : null;
  }

  get(id: string): RunRecord | null {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  updateStats(id: string, patch: Partial<RunStats>): RunRecord {
    const existing = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    if (!existing) {
      throw new Error(`Run not found: ${id}`);
    }

    const stats = {
      ...parseRunStats(existing.stats_json),
      ...patch
    };
    if (stats.apiCallLimit > 0) {
      stats.apiCallsRemaining = Math.max(0, stats.apiCallLimit - stats.apiCallsUsed);
    }

    const now = new Date().toISOString();
    this.database
      .prepare("UPDATE runs SET stats_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(stats), now, id);

    const updated = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow;
    return mapRun(updated);
  }

  addEvent(runId: string | null, type: string, message: string, data: unknown = {}): void {
    this.database
      .prepare(`
        INSERT INTO run_events (run_id, type, message, data_json)
        VALUES (?, ?, ?, ?)
      `)
      .run(runId, type, message, JSON.stringify(data));
  }

  latestEvents(limit = 80): RunEventRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM run_events ORDER BY id DESC LIMIT ?")
      .all(limit) as RunEventRow[];

    return rows.reverse().map((row) => ({
      id: row.id,
      runId: row.run_id,
      type: row.type,
      message: row.message,
      dataJson: row.data_json,
      createdAt: row.created_at
    }));
  }

  replaceKeywords(runId: string, keywords: string[]): void {
    const replace = this.database.transaction((values: string[]) => {
      this.database.prepare("DELETE FROM run_keywords WHERE run_id = ?").run(runId);
      const statement = this.database.prepare(`
        INSERT INTO run_keywords (run_id, position, keyword)
        VALUES (?, ?, ?)
      `);
      values.forEach((keyword, index) => statement.run(runId, index + 1, keyword));
    });
    replace(keywords);
  }

  keywords(runId: string, limit = 500): RunKeywordItem[] {
    const safeLimit = Math.max(1, Math.min(limit, 5_000));
    const rows = this.database
      .prepare(`
        SELECT *
        FROM run_keywords
        WHERE run_id = ?
        ORDER BY position ASC
        LIMIT ?
      `)
      .all(runId, safeLimit) as RunKeywordRow[];
    return rows.map((row) => ({
      runId: row.run_id,
      position: row.position,
      keyword: row.keyword,
      createdAt: row.created_at
    }));
  }

  private transition(id: string, status: RunStatus, eventType: string, eventMessage: string, setStoppedAt = false): RunRecord {
    const existing = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    if (!existing) {
      throw new Error(`Run not found: ${id}`);
    }
    if (status === "paused" && existing.status === "paused") {
      return mapRun(existing);
    }
    if (status === "running" && existing.status === "running") {
      return mapRun(existing);
    }
    if (status === "stopped" && existing.status === "stopped") {
      return mapRun(existing);
    }
    if (existing.status === "stopped" || existing.status === "completed") {
      throw new Error(`Run is not active: ${id}`);
    }

    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE runs
        SET status = ?,
            updated_at = ?,
            stopped_at = CASE WHEN ? = 1 THEN ? ELSE stopped_at END
        WHERE id = ?
      `)
      .run(status, now, setStoppedAt ? 1 : 0, now, id);
    this.addEvent(id, eventType, eventMessage);

    const updated = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow;
    return mapRun(updated);
  }
}

export function createRunStats(stats: Partial<RunStats> = {}): RunStats {
  const apiCallLimit = stats.apiCallLimit ?? 180;
  const apiCallsUsed = stats.apiCallsUsed ?? 0;
  const runStats: RunStats = {
    currentKeyword: stats.currentKeyword ?? null,
    totalKeywords: stats.totalKeywords ?? 0,
    completedKeywords: stats.completedKeywords ?? 0,
    remainingKeywords: stats.remainingKeywords ?? stats.totalKeywords ?? 0,
    availableKeywords: stats.availableKeywords ?? null,
    sessionKeywordLimit: stats.sessionKeywordLimit ?? null,
    sessionKeywordLimitRandom: stats.sessionKeywordLimitRandom ?? false,
    randomizeKeywordOrder: stats.randomizeKeywordOrder ?? false,
    userKeywordPercent: stats.userKeywordPercent ?? 100,
    runChainTotal: stats.runChainTotal ?? null,
    runChainIndex: stats.runChainIndex ?? null,
    runChainRemaining: stats.runChainRemaining ?? null,
    apiCallsUsed,
    apiCallLimit,
    apiCallsRemaining: stats.apiCallsRemaining ?? Math.max(0, apiCallLimit - apiCallsUsed),
    apiWindowMinutes: stats.apiWindowMinutes ?? 15,
    nextApiResetAt: stats.nextApiResetAt ?? null,
    browserAlertAutoIgnore: stats.browserAlertAutoIgnore ?? false,
    browserAlertRetryCount: stats.browserAlertRetryCount ?? 0,
    browserAlertMaxRetries: stats.browserAlertMaxRetries ?? 0,
    browserAlertAutoRestartDelaySeconds: stats.browserAlertAutoRestartDelaySeconds ?? 0,
    browserAlertAutoRestartAt: stats.browserAlertAutoRestartAt ?? null,
    browserAlertLastCompletedKeywords: stats.browserAlertLastCompletedKeywords ?? null,
    acceptedTweets: stats.acceptedTweets ?? 0,
    rejectedTweets: stats.rejectedTweets ?? 0,
    lastScore: stats.lastScore ?? null,
    lastTweetId: stats.lastTweetId ?? null
  };
  const runChainKeywordBatches = normalizeRunChainKeywordBatches(stats.runChainKeywordBatches);
  if (runChainKeywordBatches.length > 0) {
    runStats.runChainKeywordBatches = runChainKeywordBatches;
  }
  return runStats;
}

export function parseRunStats(statsJson: string): RunStats {
  try {
    return createRunStats(JSON.parse(statsJson) as Partial<RunStats>);
  } catch {
    return createRunStats();
  }
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    stoppedAt: row.stopped_at,
    statsJson: row.stats_json
  };
}

function normalizeRunChainKeywordBatches(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((batch): batch is unknown[] => Array.isArray(batch))
    .map((batch) => batch.map((keyword) => String(keyword).trim()).filter(Boolean))
    .filter((batch) => batch.length > 0);
}
