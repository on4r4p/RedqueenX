import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SCORING_CONFIG, scoreTweet } from "../src/scoring";
import type { TweetCandidate } from "../src/types";

describe("scoreTweet", () => {
  it("accepts a recent relevant tweet from a trusted account", () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
    const tweet: TweetCandidate = {
      id: "1",
      text: "Fresh infosec advisory about xss exploitation with a detailed writeup and mitigation steps included",
      lang: "en",
      createdAt: new Date("2026-05-01T11:00:00Z"),
      retweetCount: 12,
      favoriteCount: 15,
      user: {
        screenName: "trusted",
        followersCount: 1200,
        verified: true
      },
      entities: {
        urls: ["https://example.com"],
        hashtags: ["infosec"],
        mentions: []
      }
    };

    const decision = scoreTweet(tweet, {
      keywords: ["xss"],
      following: ["trusted"],
      friends: [],
      bannedUsers: [],
      bannedWords: [],
      sentTweetIds: [],
      sentTexts: []
    });

    expect(decision.accepted).toBe(true);
    expect(decision.score).toBeGreaterThanOrEqual(25);
    vi.useRealTimers();
  });

  it("rejects duplicates and banned content without mutating raw text", () => {
    const tweet: TweetCandidate = {
      id: "42",
      text: "Important malware research with enough words to pass the minimum length requirement",
      lang: "en",
      retweetCount: 10,
      user: {
        screenName: "badactor",
        description: "spam profile",
        followersCount: 1000
      }
    };

    const decision = scoreTweet(tweet, {
      keywords: ["malware"],
      following: [],
      friends: [],
      bannedUsers: ["@badactor"],
      bannedWords: ["spam"],
      sentTweetIds: ["42"],
      sentTexts: []
    });

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining(["tweet_id_already_seen", "banned_user", "banned_word:spam"]));
    expect(tweet.text).toContain("Important malware research");
  });

  it("does not require a handle search keyword to appear in tweet text", () => {
    const tweet: TweetCandidate = {
      id: "handle-1",
      text: "Published a useful incident response checklist with enough detail for defenders to evaluate",
      lang: "en",
      retweetCount: 4,
      favoriteCount: 9,
      user: {
        screenName: "security_author",
        followersCount: 900
      }
    };

    const decision = scoreTweet(
      tweet,
      {
        queryKeyword: "@security_author",
        keywords: ["@security_author"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: [],
        sentTweetIds: [],
        sentTexts: []
      },
      {
        ...DEFAULT_SCORING_CONFIG,
        enableMinimumTweetScore: false
      }
    );

    expect(decision.reasons).not.toContain("missing_keyword");
  });

  it("matches banned words as complete terms instead of normalized fragments", () => {
    const baseTweet: TweetCandidate = {
      id: "banned-fragment-1",
      text: "Great catching up yesterday. Excited to see what comes next for @AdvizorSolution",
      lang: "en",
      retweetCount: 10,
      favoriteCount: 10,
      user: {
        screenName: "analyst",
        followersCount: 1000
      }
    };
    const config = {
      ...DEFAULT_SCORING_CONFIG,
      enableMinimumTweetLength: false,
      enableMinimumTweetScore: false
    };

    const spacedSymbol = scoreTweet(
      baseTweet,
      {
        keywords: ["Great"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["see @"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(spacedSymbol.reasons).not.toContain("banned_word:see @");

    const heartSymbol = scoreTweet(
      {
        ...baseTweet,
        id: "banned-fragment-2",
        text: "#FF @ethicalhack3r @secviz"
      },
      {
        queryKeyword: "@secviz",
        keywords: ["@secviz"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["<3"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(heartSymbol.reasons).not.toContain("banned_word:<3");

    const urlOnly = scoreTweet(
      {
        ...baseTweet,
        id: "banned-url-1",
        text: "The BIGGEST Crypto PUMP is here! Join the action http://t.me/premium_pump_signal?x=1"
      },
      {
        keywords: ["Crypto"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["premium"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(urlOnly.reasons).not.toContain("banned_word:premium");

    const handleOnly = scoreTweet(
      {
        ...baseTweet,
        id: "banned-handle-1",
        text: "Useful thread from @premium_signal_team about crypto market behavior"
      },
      {
        keywords: ["crypto"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["premium"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(handleOnly.reasons).not.toContain("banned_word:premium");

    const visibleTerm = scoreTweet(
      {
        ...baseTweet,
        id: "banned-visible-1",
        text: "This premium signal looks suspicious outside the link"
      },
      {
        keywords: ["signal"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["premium"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(visibleTerm.reasons).toContain("banned_word:premium");

    const exactHeart = scoreTweet(
      {
        ...baseTweet,
        id: "banned-fragment-3",
        text: "Great writeup <3"
      },
      {
        keywords: ["writeup"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["<3"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(exactHeart.reasons).toContain("banned_word:<3");
  });

  it("can disable individual scoring checks", () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
    const tweet: TweetCandidate = {
      id: "99",
      text: "xss",
      lang: "de",
      createdAt: new Date("2026-04-01T12:00:00Z"),
      retweetCount: 0,
      favoriteCount: 0,
      user: {
        screenName: "small",
        followersCount: 0
      },
      entities: {
        hashtags: ["one", "two", "three", "four"],
        mentions: ["a", "b", "c", "d"]
      }
    };

    const decision = scoreTweet(
      tweet,
      {
        keywords: ["xss"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: [],
        sentTweetIds: [],
        sentTexts: []
      },
      {
        ...DEFAULT_SCORING_CONFIG,
        enableAllowedLanguages: false,
        enableMinimumTweetLength: false,
        enableMinimumTweetRetweets: false,
        enableMinimumTweetFavorites: false,
        enableMinimumUserFollowers: false,
        enableMaximumTweetAgeDays: false,
        enableMaximumHashtags: false,
        enableMaximumMentions: false,
        enableMinimumTweetScore: false
      }
    );

    expect(decision.reasons).not.toEqual(
      expect.arrayContaining([
        "language_not_allowed",
        "tweet_too_short",
        "not_enough_retweets",
        "not_enough_favorites",
        "not_enough_followers",
        "tweet_too_old",
        "too_many_hashtags",
        "too_many_mentions",
        "score_too_low"
      ])
    );
    vi.useRealTimers();
  });
});
