import type { Database } from "better-sqlite3";

export interface XBudgetConfig {
  xApiCreditUsd: number;
  xApiTotalCreditUsedUsd: number;
  xDailySpendLimitUsd: number;
  xRunSpendLimitUsd: number;
  xMaxSearchesPerDay: number;
  xMaxPostsReadPerDay: number;
  xMaxCountCallsPerDay: number;
  xCostPostReadUsd: number;
  xCostUserReadUsd: number;
  xCostMediaReadUsd: number;
  xCostUserInteractionUsd: number;
  xCostCountCallUsd: number;
}

export interface XBudgetUsageDelta {
  searchCalls?: number;
  countCalls?: number;
  postReads?: number;
  userReads?: number;
  mediaReads?: number;
  userInteractions?: number;
}

export interface XBudgetSnapshot {
  date: string;
  searchCalls: number;
  countCalls: number;
  postReads: number;
  userReads: number;
  mediaReads: number;
  userInteractions: number;
  apiCreditUsd: number;
  apiTotalCreditUsedUsd: number;
  projectedTotalCreditUsedUsd: number;
  estimatedCostUsd: number;
  lifetimeEstimatedCostUsd: number;
  runId: string | null;
  runEstimatedCostUsd: number | null;
  remainingApiCreditUsd: number | null;
  remainingDailySpendUsd: number | null;
  remainingRunSpendUsd: number | null;
  remainingSearches: number | null;
  remainingPostReads: number | null;
  remainingCountCalls: number | null;
}

type XBudgetUsageRow = {
  usage_date?: string;
  run_id?: string;
  search_calls: number;
  count_calls: number;
  post_reads: number;
  user_reads: number;
  media_reads: number;
  user_interactions: number;
  estimated_cost_usd: number;
};

export class XBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XBudgetExceededError";
  }
}

export class XBudgetService {
  constructor(
    private readonly database: Database,
    private readonly configSource: XBudgetConfig | (() => XBudgetConfig)
  ) {}

  snapshot(date = todayKey(), runId?: string | null): XBudgetSnapshot {
    const config = this.config();
    const row = this.row(date);
    const runRow = runId ? this.runRow(runId) : null;
    const lifetimeEstimatedCost = this.lifetimeEstimatedCost();
    return {
      date,
      searchCalls: row.search_calls,
      countCalls: row.count_calls,
      postReads: row.post_reads,
      userReads: row.user_reads,
      mediaReads: row.media_reads,
      userInteractions: row.user_interactions,
      apiCreditUsd: config.xApiCreditUsd,
      apiTotalCreditUsedUsd: config.xApiTotalCreditUsedUsd,
      projectedTotalCreditUsedUsd: config.xApiTotalCreditUsedUsd + lifetimeEstimatedCost,
      estimatedCostUsd: row.estimated_cost_usd,
      lifetimeEstimatedCostUsd: lifetimeEstimatedCost,
      runId: runId ?? null,
      runEstimatedCostUsd: runRow?.estimated_cost_usd ?? null,
      remainingApiCreditUsd: remaining(config.xApiCreditUsd, lifetimeEstimatedCost),
      remainingDailySpendUsd: remaining(config.xDailySpendLimitUsd, row.estimated_cost_usd),
      remainingRunSpendUsd: runRow ? remaining(config.xRunSpendLimitUsd, runRow.estimated_cost_usd) : null,
      remainingSearches: remaining(config.xMaxSearchesPerDay, row.search_calls),
      remainingPostReads: remaining(config.xMaxPostsReadPerDay, row.post_reads),
      remainingCountCalls: remaining(config.xMaxCountCallsPerDay, row.count_calls)
    };
  }

  assertCanSpend(delta: XBudgetUsageDelta, runId?: string | null): void {
    const config = this.config();
    const row = this.row(todayKey());
    const runRow = runId ? this.runRow(runId) : null;
    const estimatedCost = this.estimateCost(delta);
    if (exceeds(config.xMaxSearchesPerDay, row.search_calls + (delta.searchCalls ?? 0))) {
      throw new XBudgetExceededError("X daily search budget reached.");
    }
    if (exceeds(config.xMaxCountCallsPerDay, row.count_calls + (delta.countCalls ?? 0))) {
      throw new XBudgetExceededError("X daily count-first budget reached.");
    }
    if (exceeds(config.xMaxPostsReadPerDay, row.post_reads + (delta.postReads ?? 0))) {
      throw new XBudgetExceededError("X daily post read budget reached.");
    }
    if (exceeds(config.xDailySpendLimitUsd, row.estimated_cost_usd + estimatedCost)) {
      throw new XBudgetExceededError("X daily spend budget reached.");
    }
    if (runRow && exceeds(config.xRunSpendLimitUsd, runRow.estimated_cost_usd + estimatedCost)) {
      throw new XBudgetExceededError("X run spend budget reached.");
    }
    if (exceeds(config.xApiCreditUsd, this.lifetimeEstimatedCost() + estimatedCost)) {
      throw new XBudgetExceededError("X API credit budget reached.");
    }
  }

  record(delta: XBudgetUsageDelta, runId?: string | null): XBudgetSnapshot {
    const date = todayKey();
    const estimatedCost = this.estimateCost(delta);
    this.database
      .prepare(`
        INSERT INTO x_budget_usage (
          usage_date,
          search_calls,
          count_calls,
          post_reads,
          user_reads,
          media_reads,
          user_interactions,
          estimated_cost_usd,
          updated_at
        )
        VALUES (
          @date,
          @searchCalls,
          @countCalls,
          @postReads,
          @userReads,
          @mediaReads,
          @userInteractions,
          @estimatedCostUsd,
          datetime('now')
        )
        ON CONFLICT(usage_date) DO UPDATE SET
          search_calls = search_calls + excluded.search_calls,
          count_calls = count_calls + excluded.count_calls,
          post_reads = post_reads + excluded.post_reads,
          user_reads = user_reads + excluded.user_reads,
          media_reads = media_reads + excluded.media_reads,
          user_interactions = user_interactions + excluded.user_interactions,
          estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd,
          updated_at = excluded.updated_at
      `)
      .run({
        date,
        searchCalls: delta.searchCalls ?? 0,
        countCalls: delta.countCalls ?? 0,
        postReads: delta.postReads ?? 0,
        userReads: delta.userReads ?? 0,
        mediaReads: delta.mediaReads ?? 0,
        userInteractions: delta.userInteractions ?? 0,
        estimatedCostUsd: estimatedCost
      });
    if (runId) {
      this.database
        .prepare(`
          INSERT INTO x_run_budget_usage (
            run_id,
            search_calls,
            count_calls,
            post_reads,
            user_reads,
            media_reads,
            user_interactions,
            estimated_cost_usd,
            updated_at
          )
          VALUES (
            @runId,
            @searchCalls,
            @countCalls,
            @postReads,
            @userReads,
            @mediaReads,
            @userInteractions,
            @estimatedCostUsd,
            datetime('now')
          )
          ON CONFLICT(run_id) DO UPDATE SET
            search_calls = search_calls + excluded.search_calls,
            count_calls = count_calls + excluded.count_calls,
            post_reads = post_reads + excluded.post_reads,
            user_reads = user_reads + excluded.user_reads,
            media_reads = media_reads + excluded.media_reads,
            user_interactions = user_interactions + excluded.user_interactions,
            estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd,
            updated_at = excluded.updated_at
        `)
        .run({
          runId,
          searchCalls: delta.searchCalls ?? 0,
          countCalls: delta.countCalls ?? 0,
          postReads: delta.postReads ?? 0,
          userReads: delta.userReads ?? 0,
          mediaReads: delta.mediaReads ?? 0,
          userInteractions: delta.userInteractions ?? 0,
          estimatedCostUsd: estimatedCost
        });
    }
    return this.snapshot(date, runId);
  }

  resetToday(date = todayKey()): number {
    const dailyResult = this.database.prepare("DELETE FROM x_budget_usage WHERE usage_date = ?").run(date);
    const runResult = this.database.prepare("DELETE FROM x_run_budget_usage").run();
    return dailyResult.changes + runResult.changes;
  }

  resetCounters(date = todayKey()): number {
    const dailyResult = this.database
      .prepare(
        `
          UPDATE x_budget_usage
          SET
            search_calls = 0,
            count_calls = 0,
            post_reads = 0,
            user_reads = 0,
            media_reads = 0,
            user_interactions = 0,
            updated_at = datetime('now')
          WHERE usage_date = ?
        `
      )
      .run(date);
    const runResult = this.database
      .prepare(
        `
          UPDATE x_run_budget_usage
          SET
            search_calls = 0,
            count_calls = 0,
            post_reads = 0,
            user_reads = 0,
            media_reads = 0,
            user_interactions = 0,
            updated_at = datetime('now')
        `
      )
      .run();
    return dailyResult.changes + runResult.changes;
  }

  estimateCost(delta: XBudgetUsageDelta): number {
    const config = this.config();
    return (
      (delta.postReads ?? 0) * config.xCostPostReadUsd +
      (delta.userReads ?? 0) * config.xCostUserReadUsd +
      (delta.mediaReads ?? 0) * config.xCostMediaReadUsd +
      (delta.userInteractions ?? 0) * config.xCostUserInteractionUsd +
      (delta.countCalls ?? 0) * config.xCostCountCallUsd
    );
  }

  private config(): XBudgetConfig {
    return typeof this.configSource === "function" ? this.configSource() : this.configSource;
  }

  private row(date: string): XBudgetUsageRow {
    const row = this.database.prepare("SELECT * FROM x_budget_usage WHERE usage_date = ?").get(date) as
      | XBudgetUsageRow
      | undefined;
    return (
      row ?? {
        usage_date: date,
        search_calls: 0,
        count_calls: 0,
        post_reads: 0,
        user_reads: 0,
        media_reads: 0,
        user_interactions: 0,
        estimated_cost_usd: 0
      }
    );
  }

  private runRow(runId: string): XBudgetUsageRow {
    const row = this.database.prepare("SELECT * FROM x_run_budget_usage WHERE run_id = ?").get(runId) as
      | XBudgetUsageRow
      | undefined;
    return (
      row ?? {
        run_id: runId,
        usage_date: todayKey(),
        search_calls: 0,
        count_calls: 0,
        post_reads: 0,
        user_reads: 0,
        media_reads: 0,
        user_interactions: 0,
        estimated_cost_usd: 0
      }
    );
  }

  private lifetimeEstimatedCost(): number {
    const row = this.database.prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM x_budget_usage").get() as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function remaining(limit: number, used: number): number | null {
  return limit > 0 ? Math.max(0, limit - used) : null;
}

function exceeds(limit: number, value: number): boolean {
  return limit > 0 && value > limit;
}
