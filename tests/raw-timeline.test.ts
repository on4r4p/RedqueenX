import { describe, expect, it } from "vitest";
import { RawTimelineTweetService } from "../src/admin/rawTimelineTweetService";
import { openMemoryDatabase } from "../src/db/database";
import type { TweetCandidate } from "../src/types";

describe("RawTimelineTweetService", () => {
  it("stores scoring rejection reasons for raw timeline tweets", () => {
    const database = openMemoryDatabase();
    database.prepare("INSERT INTO runs (id, status, started_at, updated_at, stats_json) VALUES (?, ?, ?, ?, ?)").run(
      "run-raw",
      "running",
      "2026-05-07T12:00:00.000Z",
      "2026-05-07T12:00:00.000Z",
      "{}"
    );
    const service = new RawTimelineTweetService(database);
    const tweet: TweetCandidate = {
      id: "tweet-1",
      text: "blocked visible tweet",
      user: { screenName: "@blocked", name: "Blocked User" },
      retweetCount: 0,
      favoriteCount: 0,
      entities: { urls: [], media: [] }
    };

    expect(service.saveVisible("run-raw", "cloudflare", [tweet])).toBe(1);
    expect(
      service.saveDecisions("run-raw", [
        {
          tweetId: "tweet-1",
          status: "rejected",
          stage: "prefilter",
          score: null,
          reasons: ["banned_user:@blocked", "tweet_too_short"]
        }
      ])
    ).toBe(1);

    const [item] = service.latest(10);
    expect(item).toMatchObject({
      tweetId: "tweet-1",
      keyword: "cloudflare",
      decisionStatus: "rejected",
      rejectionStage: "prefilter",
      score: null,
      rejectionReasons: ["banned_user:@blocked", "tweet_too_short"]
    });
  });

  it("paginates raw timeline tweets", () => {
    const database = openMemoryDatabase();
    database.prepare("INSERT INTO runs (id, status, started_at, updated_at, stats_json) VALUES (?, ?, ?, ?, ?)").run(
      "run-raw",
      "running",
      "2026-05-07T12:00:00.000Z",
      "2026-05-07T12:00:00.000Z",
      "{}"
    );
    const service = new RawTimelineTweetService(database);
    const tweets: TweetCandidate[] = [
      { id: "tweet-1", text: "first visible tweet", user: { screenName: "@one" } },
      { id: "tweet-2", text: "second visible tweet", user: { screenName: "@two" } },
      { id: "tweet-3", text: "third visible tweet", user: { screenName: "@three" } }
    ];

    expect(service.saveVisible("run-raw", "cloudflare", tweets)).toBe(3);

    const page = service.page({ limit: 2, offset: 1 });
    expect(page).toMatchObject({
      total: 3,
      limit: 2,
      offset: 1,
      hasMore: false
    });
    expect(page.items).toHaveLength(2);
  });

  it("filters rejected timeline tweets by rejection reason", () => {
    const database = openMemoryDatabase();
    database.prepare("INSERT INTO runs (id, status, started_at, updated_at, stats_json) VALUES (?, ?, ?, ?, ?)").run(
      "run-raw",
      "running",
      "2026-05-07T12:00:00.000Z",
      "2026-05-07T12:00:00.000Z",
      "{}"
    );
    const service = new RawTimelineTweetService(database);
    const tweets: TweetCandidate[] = [
      { id: "tweet-1", text: "blocked user", user: { screenName: "@blocked" } },
      { id: "tweet-2", text: "short text", user: { screenName: "@short" } },
      { id: "tweet-3", text: "old text", user: { screenName: "@old" } },
      { id: "tweet-4", text: "accepted text", user: { screenName: "@accepted" } }
    ];

    expect(service.saveVisible("run-raw", "cloudflare", tweets)).toBe(4);
    expect(
      service.saveDecisions("run-raw", [
        {
          tweetId: "tweet-1",
          status: "rejected",
          stage: "prefilter",
          score: null,
          reasons: ["banned_user:@blocked", "tweet_too_short"]
        },
        {
          tweetId: "tweet-2",
          status: "rejected",
          stage: "scoring",
          score: 1,
          reasons: ["tweet_too_short"]
        },
        {
          tweetId: "tweet-3",
          status: "rejected",
          stage: "scoring",
          score: 4,
          reasons: ["tweet_too_old:42d"]
        },
        {
          tweetId: "tweet-4",
          status: "accepted",
          stage: "accepted",
          score: 25,
          reasons: []
        }
      ])
    ).toBe(4);

    const page = service.page({ decisionStatus: "rejected", rejectionReasons: ["banned_user:@blocked"] });
    expect(page.total).toBe(1);
    expect(page.items[0].tweetId).toBe("tweet-1");
    const groupPage = service.page({ decisionStatus: "rejected", rejectionReasonGroups: ["banned_user", "tweet_too_old"] });
    expect(groupPage.total).toBe(2);
    expect(groupPage.items.map((item) => item.tweetId).sort()).toEqual(["tweet-1", "tweet-3"]);
    expect(service.rejectionReasonOptions()).toEqual([
      { reason: "tweet_too_short", count: 2 },
      { reason: "banned_user:@blocked", count: 1 },
      { reason: "tweet_too_old:42d", count: 1 }
    ]);
    expect(service.rejectionReasonGroupOptions()).toEqual([
      { id: "banned_user", label: "Banned user", count: 1 },
      { id: "tweet_too_old", label: "Too old", count: 1 },
      { id: "tweet_too_short", label: "Too short", count: 2 }
    ]);
  });

  it("clears only rejected timeline tweets", () => {
    const database = openMemoryDatabase();
    database.prepare("INSERT INTO runs (id, status, started_at, updated_at, stats_json) VALUES (?, ?, ?, ?, ?)").run(
      "run-clear",
      "stopped",
      "2026-05-07T12:00:00.000Z",
      "2026-05-07T12:00:00.000Z",
      "{}"
    );
    const service = new RawTimelineTweetService(database);
    const tweets: TweetCandidate[] = [
      { id: "tweet-rejected", text: "rejected tweet", user: { screenName: "@rejected" } },
      { id: "tweet-accepted", text: "accepted tweet", user: { screenName: "@accepted" } }
    ];

    expect(service.saveVisible("run-clear", "cloudflare", tweets)).toBe(2);
    expect(
      service.saveDecisions("run-clear", [
        {
          tweetId: "tweet-rejected",
          status: "rejected",
          stage: "scoring",
          score: 1,
          reasons: ["score_too_low"]
        },
        {
          tweetId: "tweet-accepted",
          status: "accepted",
          stage: "accepted",
          score: 50,
          reasons: []
        }
      ])
    ).toBe(2);

    expect(service.clearRejected()).toBe(1);
    expect(service.page({ decisionStatus: "rejected" }).total).toBe(0);
    expect(service.page({ decisionStatus: "accepted" }).total).toBe(1);
  });
});
