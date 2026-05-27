import { afterEach, describe, expect, it, vi } from "vitest";
import { isTopicKeyword, RedditCrawler } from "../src/reddit/redditCrawler";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("RedditCrawler", () => {
  it("skips X handle keywords", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const crawler = new RedditCrawler({
      enabled: true,
      userAgent: "RedqueenX test",
      subreddits: ["netsec"],
      limitPerKeyword: 10,
      sort: "relevance",
      timeRange: "month",
      minScore: 1
    });

    expect(isTopicKeyword("@Unix_XP")).toBe(false);
    await expect(crawler.searchKeyword("@Unix_XP")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches configured subreddits and filters low-score posts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                id: "abc",
                subreddit: "netsec",
                title: "New exploit write-up",
                selftext: "Exploit details",
                author: "researcher",
                permalink: "/r/netsec/comments/abc/new_exploit_write_up/",
                url: "https://example.test/write-up",
                url_overridden_by_dest: "https://i.redd.it/exploit.png",
                preview: {
                  images: [
                    {
                      source: {
                        url: "https://preview.redd.it/exploit-preview.png?width=960&amp;format=png"
                      }
                    }
                  ]
                },
                score: 42,
                num_comments: 7,
                created_utc: 1_778_800_000
              }
            },
            {
              data: {
                id: "low",
                subreddit: "netsec",
                title: "Low score",
                permalink: "/r/netsec/comments/low/low_score/",
                score: 0
              }
            }
          ]
        }
      })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const crawler = new RedditCrawler({
      enabled: true,
      userAgent: "RedqueenX test",
      subreddits: ["netsec", "cybersecurity"],
      limitPerKeyword: 5,
      sort: "top",
      timeRange: "week",
      minScore: 2
    });

    const posts = await crawler.searchKeyword("exploit");

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe("/r/netsec+cybersecurity/search.json");
    expect(requestedUrl.searchParams.get("q")).toBe("exploit");
    expect(requestedUrl.searchParams.get("restrict_sr")).toBe("1");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      id: "abc",
      keyword: "exploit",
      subreddit: "netsec",
      title: "New exploit write-up",
      text: "Exploit details",
      author: "researcher",
      score: 42,
      commentsCount: 7,
      media: [
        {
          type: "photo",
          url: "https://i.redd.it/exploit.png",
          previewImageUrl: "https://preview.redd.it/exploit-preview.png?width=960&format=png",
          altText: "New exploit write-up"
        }
      ]
    });
  });
});
