import { describe, expect, it, vi } from "vitest";
import { TimelineItemService } from "../src/admin/timelineItemService";
import { openMemoryDatabase } from "../src/db/database";
import { crawlRedditKeywords } from "../src/reddit/redditTimeline";
import type { RedditCrawler, RedditPost } from "../src/reddit/redditCrawler";
import type { CurrentSessionLevel } from "../src/admin/currentSessionService";

describe("Reddit timeline crawl", () => {
  it("saves topic keyword posts, skips @user keywords, and keeps failures non-fatal", async () => {
    const database = openMemoryDatabase();
    const timelineItems = new TimelineItemService(database);
    const record = vi.fn<RecordFn>().mockResolvedValue(undefined);
    const crawler = {
      searchKeyword: vi.fn(async (keyword: string) => {
        if (keyword === "malware") {
          throw new Error("Reddit unavailable");
        }
        return [
          {
            id: "reddit-1",
            keyword,
            subreddit: "netsec",
            title: "Exploit analysis",
            text: "Exploit analysis body ".repeat(80),
            author: "researcher",
            url: "https://example.test/exploit",
            permalink: "https://www.reddit.com/r/netsec/comments/reddit-1/exploit/",
            score: 42,
            commentsCount: 6,
            createdAt: new Date("2026-05-18T10:00:00.000Z"),
            media: [
              {
                type: "photo",
                url: "https://i.redd.it/exploit.png",
                previewImageUrl: "https://preview.redd.it/exploit.png",
                altText: "Exploit analysis"
              }
            ]
          } satisfies RedditPost
        ];
      })
    } as unknown as RedditCrawler;

    const result = await crawlRedditKeywords({
      runId: "run-1",
      keywords: ["exploit", "@alice", "malware"],
      crawler,
      timelineItems,
      record
    });

    expect(result).toEqual({ searchedKeywords: 2, skippedHandleKeywords: 1, savedPosts: 1, failedKeywords: 1 });
    expect(crawler.searchKeyword).toHaveBeenCalledWith("exploit");
    expect(crawler.searchKeyword).toHaveBeenCalledWith("malware");
    expect(crawler.searchKeyword).not.toHaveBeenCalledWith("@alice");
    expect(timelineItems.latest(10).map((item) => item.source)).toEqual(["reddit"]);
    expect(timelineItems.latest(10)[0]).toMatchObject({
      keyword: "exploit",
      author: "u/researcher",
      authorName: "r/netsec",
      retweetCount: 42,
      favoriteCount: 6,
      media: [
        {
          type: "photo",
          url: "https://i.redd.it/exploit.png",
          previewImageUrl: "https://preview.redd.it/exploit.png",
          altText: "Exploit analysis"
        }
      ]
    });
    expect(timelineItems.latest(10)[0].text.length).toBeLessThanOrEqual(700);
    expect(timelineItems.latest(10)[0].text.endsWith("...")).toBe(true);
    expect(record).toHaveBeenCalledWith("prob", "reddit.keyword.failed", "Reddit unavailable", {
      runId: "run-1",
      keyword: "malware"
    });
  });
});

type RecordFn = (
  level: CurrentSessionLevel,
  type: string,
  message: string,
  data?: Record<string, unknown>
) => Promise<void>;
