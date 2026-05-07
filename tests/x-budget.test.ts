import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database";
import { XBudgetExceededError, XBudgetService, type XBudgetConfig } from "../src/x-budget";

const budgetConfig: XBudgetConfig = {
  xApiCreditUsd: 1,
  xApiTotalCreditUsedUsd: 20.38,
  xDailySpendLimitUsd: 1,
  xRunSpendLimitUsd: 0.1,
  xMaxSearchesPerDay: 2,
  xMaxPostsReadPerDay: 10,
  xMaxCountCallsPerDay: 3,
  xCostPostReadUsd: 0.01,
  xCostUserReadUsd: 0.02,
  xCostMediaReadUsd: 0.03,
  xCostUserInteractionUsd: 0.04,
  xCostCountCallUsd: 0
};

describe("XBudgetService", () => {
  it("records daily X usage and remaining budget", () => {
    const database = openMemoryDatabase();
    const budget = new XBudgetService(database, budgetConfig);
    insertRun(database, "run-1");

    budget.record({ searchCalls: 1, countCalls: 1, postReads: 2, userReads: 1, mediaReads: 1 }, "run-1");
    const snapshot = budget.snapshot(undefined, "run-1");

    expect(snapshot.searchCalls).toBe(1);
    expect(snapshot.countCalls).toBe(1);
    expect(snapshot.postReads).toBe(2);
    expect(snapshot.userReads).toBe(1);
    expect(snapshot.mediaReads).toBe(1);
    expect(snapshot.estimatedCostUsd).toBeCloseTo(0.07);
    expect(snapshot.lifetimeEstimatedCostUsd).toBeCloseTo(0.07);
    expect(snapshot.apiCreditUsd).toBeCloseTo(1);
    expect(snapshot.apiTotalCreditUsedUsd).toBeCloseTo(20.38);
    expect(snapshot.projectedTotalCreditUsedUsd).toBeCloseTo(20.45);
    expect(snapshot.remainingApiCreditUsd).toBeCloseTo(0.93);
    expect(snapshot.runEstimatedCostUsd).toBeCloseTo(0.07);
    expect(snapshot.remainingRunSpendUsd).toBeCloseTo(0.03);
    expect(snapshot.remainingSearches).toBe(1);
    expect(snapshot.remainingPostReads).toBe(8);
    expect(snapshot.remainingCountCalls).toBe(2);
  });

  it("rejects reads and writes above configured caps", () => {
    const database = openMemoryDatabase();
    const budget = new XBudgetService(database, budgetConfig);
    budget.record({ searchCalls: 2, postReads: 10, countCalls: 3 });

    expect(() => budget.assertCanSpend({ searchCalls: 1 })).toThrow(XBudgetExceededError);
    expect(() => budget.assertCanSpend({ postReads: 1 })).toThrow(XBudgetExceededError);
    expect(() => budget.assertCanSpend({ countCalls: 1 })).toThrow(XBudgetExceededError);
  });

  it("rejects usage above the remaining account credit", () => {
    const database = openMemoryDatabase();
    const budget = new XBudgetService(database, { ...budgetConfig, xApiCreditUsd: 0.05, xDailySpendLimitUsd: 0 });
    budget.record({ postReads: 4 });

    expect(() => budget.assertCanSpend({ postReads: 2 })).toThrow(XBudgetExceededError);
  });

  it("rejects usage above the current run budget", () => {
    const database = openMemoryDatabase();
    const budget = new XBudgetService(database, { ...budgetConfig, xDailySpendLimitUsd: 0, xRunSpendLimitUsd: 0.05 });
    insertRun(database, "run-limited");
    budget.record({ postReads: 4 }, "run-limited");

    expect(() => budget.assertCanSpend({ postReads: 2 }, "run-limited")).toThrow(XBudgetExceededError);
  });

  it("resets local counters without clearing estimated spend", () => {
    const database = openMemoryDatabase();
    const budget = new XBudgetService(database, budgetConfig);
    insertRun(database, "run-counter-reset");
    budget.record({ searchCalls: 1, countCalls: 1, postReads: 2, userReads: 1, mediaReads: 1 }, "run-counter-reset");

    budget.resetCounters();
    const snapshot = budget.snapshot(undefined, "run-counter-reset");

    expect(snapshot.searchCalls).toBe(0);
    expect(snapshot.countCalls).toBe(0);
    expect(snapshot.postReads).toBe(0);
    expect(snapshot.userReads).toBe(0);
    expect(snapshot.mediaReads).toBe(0);
    expect(snapshot.estimatedCostUsd).toBeCloseTo(0.07);
    expect(snapshot.runEstimatedCostUsd).toBeCloseTo(0.07);
  });
});

function insertRun(database: ReturnType<typeof openMemoryDatabase>, id: string): void {
  database
    .prepare("INSERT INTO runs (id, status, started_at, updated_at) VALUES (?, 'running', datetime('now'), datetime('now'))")
    .run(id);
}
