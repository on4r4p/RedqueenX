import { describe, expect, it, vi } from "vitest";
import { ListService } from "../src/admin/listService";
import { TimelineItemService } from "../src/admin/timelineItemService";
import { openMemoryDatabase } from "../src/db/database";
import { prioritizeLikelyRssFeeds, runRssFallback } from "../src/rssFallback";
import type { CurrentSessionLevel } from "../src/admin/currentSessionService";

describe("RSS fallback", () => {
  it("saves RSS items into timeline-compatible lists", async () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const timelineItems = new TimelineItemService(database);
    lists.add("rss_feed", "https://feed.example/rss");
    const record = vi.fn<RecordFn>().mockResolvedValue(undefined);
    const rssClient = {
      fetch: vi.fn().mockResolvedValue([
        { title: "First advisory", link: "https://feed.example/1", publishedAt: "2026-05-18T08:00:00.000Z" },
        { title: "Second advisory", link: "https://feed.example/2", publishedAt: "2026-05-18T09:00:00.000Z" }
      ])
    };

    const result = await runRssFallback({
      runId: "run-1",
      lists,
      timelineItems,
      feedLimit: 10,
      reason: "browser_pause",
      record,
      rssClient
    });

    expect(result).toEqual({ feeds: 1, savedItems: 2, failedFeeds: 0 });
    expect(rssClient.fetch).toHaveBeenCalledWith("https://feed.example/rss");
    expect(lists.activeValues("rss_sent")).toEqual(["https://feed.example/1", "https://feed.example/2"]);
    expect(lists.activeValues("text_sent")).toEqual([]);
    const savedItems = timelineItems.latest(10);
    expect(savedItems.map((item) => item.source)).toEqual(["rss", "rss"]);
    expect(savedItems.map((item) => item.text).sort()).toEqual(["First advisory", "Second advisory"]);
    expect(savedItems.map((item) => item.tweetCreatedAt)).toEqual(["2026-05-18T09:00:00.000Z", "2026-05-18T08:00:00.000Z"]);
    expect(record).toHaveBeenCalledWith(
      "info",
      "rss.fallback.completed",
      "RSS fallback completed",
      expect.objectContaining({ runId: "run-1", reason: "browser_pause", feeds: 1, savedItems: 2, failedFeeds: 0 })
    );
  });

  it("records an empty fallback when no RSS feed is configured", async () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const record = vi.fn<RecordFn>().mockResolvedValue(undefined);

    const result = await runRssFallback({
      runId: "run-empty",
      lists,
      feedLimit: 10,
      reason: "browser_completed",
      record
    });

    expect(result).toEqual({ feeds: 0, savedItems: 0, failedFeeds: 0 });
    expect(record).toHaveBeenCalledWith("prob", "rss.fallback.empty", "No RSS feeds available for fallback", {
      runId: "run-empty",
      reason: "browser_completed"
    });
  });

  it("prioritizes likely feed URLs over imported article links", async () => {
    expect(
      prioritizeLikelyRssFeeds([
        "https://packetstormsecurity.com/news/view/29421/example-article.html",
        "https://rss.packetstormsecurity.com/",
        "https://example.test/security/rss.xml"
      ])
    ).toEqual([
      "https://example.test/security/rss.xml",
      "https://rss.packetstormsecurity.com/",
      "https://packetstormsecurity.com/news/view/29421/example-article.html"
    ]);
  });
});

type RecordFn = (
  level: CurrentSessionLevel,
  type: string,
  message: string,
  data?: Record<string, unknown>
) => Promise<void>;
