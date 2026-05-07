import { describe, expect, it, vi } from "vitest";
import { RssClient } from "../src/rss-client";
import { Crawler } from "../src/crawler";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring";
import { openMemoryDatabase } from "../src/db/database";
import { ListService } from "../src/admin/listService";
import { TimelineTweetService } from "../src/admin/timelineTweetService";
import type { XSearchClient } from "../src/x-client";

describe("rss and crawler adapters", () => {
  it("maps RSS parser items to title/link pairs", async () => {
    const client = new RssClient() as any;
    client.parser = {
      parseURL: vi.fn().mockResolvedValue({
        items: [
          { title: "A", link: "https://a.example" },
          { title: "Missing link" }
        ]
      })
    };

    await expect(client.fetch("https://feed.example/rss")).resolves.toEqual([{ title: "A", link: "https://a.example" }]);
  });

  it("scores tweets returned by an X search client", async () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const timelineTweets = new TimelineTweetService(database);
    const createdAt = new Date();
    lists.add("keyword", "xss");

    const xClient: XSearchClient = {
      countRecent: vi.fn().mockResolvedValue(1),
      lookupTweetsDetailed: vi.fn().mockResolvedValue([]),
      searchRecent: vi.fn().mockResolvedValue([
        {
          id: "1",
          text: "Fresh xss exploitation research with enough context and mitigation detail to be useful",
          lang: "en",
          retweetCount: 10,
          favoriteCount: 10,
          createdAt,
          user: {
            screenName: "alice",
            name: "Alice",
            followersCount: 1000,
            profileImageUrl: "https://img.example/alice.jpg"
          },
          entities: {
            media: [{ type: "photo", url: "https://img.example/tweet.jpg" }]
          }
        }
      ])
    };

    const crawler = new Crawler(lists, xClient, undefined, (result) =>
      timelineTweets.saveAccepted(result.keyword, result.tweet, result.decision)
    );
    const results = await crawler.crawlKeyword("xss");

    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe("xss");
    expect(results[0].decision.normalizedText).toContain("xss");
    expect(results[0].decision.accepted).toBe(true);
    expect(lists.activeValues("tweet_sent")).toEqual(["1"]);
    expect(lists.activeValues("text_sent")).toEqual([
      "Fresh xss exploitation research with enough context and mitigation detail to be useful"
    ]);
    expect(timelineTweets.latest(1)[0]).toMatchObject({
      tweetId: "1",
      author: "alice",
      authorName: "Alice",
      avatarUrl: "https://img.example/alice.jpg",
      tweetCreatedAt: createdAt.toISOString(),
      favoriteCount: 10,
      retweetCount: 10,
      source: "tweet"
    });
    expect(timelineTweets.latest(1)[0].media).toEqual([{ type: "photo", url: "https://img.example/tweet.jpg" }]);
  });

  it("can accept a rejected tweet through the luck factor", async () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    lists.add("keyword", "malware");
    lists.add("banned_word", "spam");

    const xClient: XSearchClient = {
      countRecent: vi.fn().mockResolvedValue(1),
      lookupTweetsDetailed: vi.fn().mockResolvedValue([]),
      searchRecent: vi.fn().mockResolvedValue([
        {
          id: "lucky-1",
          text: "Fresh malware research with spam marker and enough context to evaluate this tweet",
          lang: "en",
          retweetCount: 0,
          favoriteCount: 0,
          user: {
            screenName: "bob",
            followersCount: 10
          }
        }
      ])
    };

    const crawler = new Crawler(
      lists,
      xClient,
      () => ({
        ...DEFAULT_SCORING_CONFIG,
        luckFactorDenominator: 200,
        minimumTweetLength: 0,
        minimumTweetRetweets: 0,
        minimumUserFollowers: 0,
        minimumTweetScore: 0
      }),
      undefined,
      () => 0
    );

    const results = await crawler.crawlKeyword("malware");

    expect(results[0].decision.accepted).toBe(true);
    expect(results[0].decision.reasons).toEqual(expect.arrayContaining(["banned_word:spam", "luck_factor:1/200"]));
    expect(lists.activeValues("tweet_sent")).toEqual(["lucky-1"]);
  });

  it("keeps profile-dependent rejects for detailed hydration", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    lists.add("keyword", "infosec");

    const xClient: XSearchClient = {
      countRecent: vi.fn().mockResolvedValue(1),
      lookupTweetsDetailed: vi.fn().mockResolvedValue([]),
      searchRecent: vi.fn().mockResolvedValue([])
    };
    const crawler = new Crawler(lists, xClient, () => ({
      ...DEFAULT_SCORING_CONFIG,
      minimumTweetLength: 0,
      minimumTweetRetweets: 0,
      maximumTweetRetweets: 1,
      maximumTweetFavorites: 1,
      maximumTweetAgeDays: 99
    }));

    const selected = crawler.selectTweetsForHydration('("infosec" OR "malware") -is:retweet', [
      {
        id: "candidate-1",
        text: "infosec research with enough useful context for the crawler",
        lang: "en",
        retweetCount: 99,
        favoriteCount: 99,
        createdAt: new Date(),
        user: {
          screenName: "123456789"
        }
      }
    ]);

    expect(selected.map((tweet) => tweet.id)).toEqual(["candidate-1"]);
  });

  it("explains browser prefilter rejections before scoring", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    lists.add("keyword", "infosec");
    lists.add("banned_word", "blockedterm");

    const xClient: XSearchClient = {
      countRecent: vi.fn().mockResolvedValue(1),
      lookupTweetsDetailed: vi.fn().mockResolvedValue([]),
      searchRecent: vi.fn().mockResolvedValue([])
    };
    const crawler = new Crawler(lists, xClient, () => ({
      ...DEFAULT_SCORING_CONFIG,
      minimumTweetLength: 0,
      minimumTweetRetweets: 0,
      maximumTweetAgeDays: 99
    }));

    const decision = crawler.explainTweetForHydration("infosec", {
      id: "candidate-2",
      text: "infosec blockedterm writeup",
      createdAt: new Date(),
      user: {
        screenName: "@alice"
      }
    });

    expect(decision).toEqual({
      accepted: false,
      reasons: ["banned_word:blockedterm"]
    });
    database.close();
  });

  it("does not prefilter banned words from partial symbol-normalized matches", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    lists.add("keyword", "@secviz");
    lists.add("banned_word", "see @");
    lists.add("banned_word", "<3");
    lists.add("banned_word", "premium");

    const xClient: XSearchClient = {
      countRecent: vi.fn().mockResolvedValue(1),
      lookupTweetsDetailed: vi.fn().mockResolvedValue([]),
      searchRecent: vi.fn().mockResolvedValue([])
    };
    const crawler = new Crawler(lists, xClient, () => ({
      ...DEFAULT_SCORING_CONFIG,
      minimumTweetLength: 0,
      minimumTweetRetweets: 0,
      maximumMentions: 99,
      maximumTweetAgeDays: 99
    }));

    const decision = crawler.explainTweetForHydration("@secviz", {
      id: "candidate-symbol-fragment",
      text: "Excited to see what comes next for @AdvizorSolution and #FF @ethicalhack3r @secviz",
      createdAt: new Date(),
      user: {
        screenName: "@alice"
      }
    });

    expect(decision.reasons).not.toContain("banned_word:see @");
    expect(decision.reasons).not.toContain("banned_word:<3");

    const ignoredContextDecision = crawler.explainTweetForHydration("@secviz", {
      id: "candidate-ignored-context",
      text: "The BIGGEST Crypto PUMP is here! http://t.me/premium_pump_signal from @premium_signal_team @secviz",
      createdAt: new Date(),
      user: {
        screenName: "@alice"
      }
    });

    expect(ignoredContextDecision.reasons).not.toContain("banned_word:premium");
    database.close();
  });

  it("does not prefilter handle searches when the handle is absent from tweet text", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    lists.add("keyword", "@alice");

    const xClient: XSearchClient = {
      countRecent: vi.fn().mockResolvedValue(1),
      lookupTweetsDetailed: vi.fn().mockResolvedValue([]),
      searchRecent: vi.fn().mockResolvedValue([])
    };
    const crawler = new Crawler(lists, xClient, () => ({
      ...DEFAULT_SCORING_CONFIG,
      minimumTweetLength: 0,
      minimumTweetRetweets: 0,
      maximumTweetAgeDays: 99
    }));

    const decision = crawler.explainTweetForHydration("@alice", {
      id: "candidate-handle",
      text: "new research notes with no handle mention in the body",
      createdAt: new Date(),
      user: {
        screenName: "@alice"
      }
    });

    expect(decision.reasons).not.toContain("missing_keyword");
    database.close();
  });
});
