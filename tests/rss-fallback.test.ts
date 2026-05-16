import { describe, expect, it, vi } from "vitest";
import { ListService } from "../src/admin/listService";
import { openMemoryDatabase } from "../src/db/database";
import { runRssFallback } from "../src/rssFallback";
import type { CurrentSessionLevel } from "../src/admin/currentSessionService";

describe("RSS fallback", () => {
  it("saves RSS items into timeline-compatible lists", async () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    lists.add("rss_feed", "https://feed.example/rss");
    const record = vi.fn<RecordFn>().mockResolvedValue(undefined);
    const rssClient = {
      fetch: vi.fn().mockResolvedValue([
        { title: "First advisory", link: "https://feed.example/1" },
        { title: "Second advisory", link: "https://feed.example/2" }
      ])
    };

    const result = await runRssFallback({
      runId: "run-1",
      lists,
      feedLimit: 10,
      reason: "browser_pause",
      record,
      rssClient
    });

    expect(result).toEqual({ feeds: 1, savedItems: 2, failedFeeds: 0 });
    expect(rssClient.fetch).toHaveBeenCalledWith("https://feed.example/rss");
    expect(lists.activeValues("rss_sent")).toEqual(["https://feed.example/1", "https://feed.example/2"]);
    expect(lists.activeValues("text_sent")).toEqual([
      "First advisory https://feed.example/1",
      "Second advisory https://feed.example/2"
    ]);
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
});

type RecordFn = (
  level: CurrentSessionLevel,
  type: string,
  message: string,
  data?: Record<string, unknown>
) => Promise<void>;
