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
});
