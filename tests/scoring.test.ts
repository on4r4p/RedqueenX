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

  it("does not reject the allowed phrase of course when course is banned", () => {
    const tweet: TweetCandidate = {
      id: "course-1",
      text: "Of course this advisory includes enough detail about vulnerability mitigation for defenders",
      lang: "en",
      retweetCount: 10,
      user: {
        screenName: "researcher",
        followersCount: 1000
      }
    };

    const decision = scoreTweet(
      tweet,
      {
        keywords: ["vulnerability"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["course"],
        bannedWordExceptions: ["of course"],
        sentTweetIds: [],
        sentTexts: []
      },
      {
        ...DEFAULT_SCORING_CONFIG,
        enableMinimumTweetScore: false
      }
    );

    expect(decision.reasons).not.toContain("banned_word:course");
  });

  it("still rejects course outside the allowed phrase", () => {
    const tweet: TweetCandidate = {
      id: "course-2",
      text: "This course includes enough detail about vulnerability mitigation for defenders",
      lang: "en",
      retweetCount: 10,
      user: {
        screenName: "researcher",
        followersCount: 1000
      }
    };

    const decision = scoreTweet(
      tweet,
      {
        keywords: ["vulnerability"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["course"],
        sentTweetIds: [],
        sentTexts: []
      },
      {
        ...DEFAULT_SCORING_CONFIG,
        enableMinimumTweetScore: false
      }
    );

    expect(decision.reasons).toContain("banned_word:course");
  });

  it("softens minimum popularity checks for @user searches without disabling them", () => {
    const tweet: TweetCandidate = {
      id: "handle-popularity",
      text: "Fresh vulnerability research with detailed exploit analysis and mitigation notes for defenders",
      lang: "en",
      retweetCount: 1,
      favoriteCount: 1,
      user: {
        screenName: "maldevel",
        followersCount: 1000
      }
    };

    const lists = {
      queryKeyword: "@maldevel",
      keywords: ["vulnerability"],
      following: [],
      friends: [],
      bannedUsers: [],
      bannedWords: [],
      sentTweetIds: [],
      sentTexts: []
    };

    const strictDecision = scoreTweet(tweet, lists, {
      ...DEFAULT_SCORING_CONFIG,
      enableMinimumTweetScore: false,
      minimumTweetRetweets: 2,
      minimumTweetFavorites: 2,
      relaxMinimumPopularityForHandleSearch: false
    });
    expect(strictDecision.reasons).toEqual(expect.arrayContaining(["not_enough_retweets", "not_enough_favorites"]));

    const relaxedDecision = scoreTweet(tweet, lists, {
      ...DEFAULT_SCORING_CONFIG,
      enableMinimumTweetScore: false,
      minimumTweetRetweets: 2,
      minimumTweetFavorites: 2,
      relaxMinimumPopularityForHandleSearch: true
    });
    expect(relaxedDecision.reasons).not.toContain("not_enough_retweets");
    expect(relaxedDecision.reasons).not.toContain("not_enough_favorites");

    const zeroEngagementDecision = scoreTweet(
      {
        ...tweet,
        id: "handle-popularity-zero",
        retweetCount: 0,
        favoriteCount: 0
      },
      lists,
      {
        ...DEFAULT_SCORING_CONFIG,
        enableMinimumTweetScore: false,
        minimumTweetRetweets: 1,
        minimumTweetFavorites: 1,
        relaxMinimumPopularityForHandleSearch: true
      }
    );
    expect(zeroEngagementDecision.reasons).toEqual(expect.arrayContaining(["not_enough_retweets", "not_enough_favorites"]));
  });

  it("rejects tweets that are too similar to already accepted text", () => {
    const previousText =
      "A threat actor on a cybercrime forum is claiming to sell an alleged unpatched Boolean-based Blind SQL Injection vulnerability targeting a French government-related imports website. According to the post, the vulnerability allegedly affects a high-traffic backend system.";
    const tweet: TweetCandidate = {
      id: "similar-2",
      text: "A threat actor is advertising access to an alleged SQL injection vulnerability affecting a French government-related system. According to the post, the vulnerability is described as a Boolean-based blind SQLi, reportedly allowing unauthorized access to backend databases.",
      lang: "en",
      retweetCount: 10,
      favoriteCount: 10,
      user: {
        screenName: "intelbreaches",
        followersCount: 1000
      }
    };

    const decision = scoreTweet(tweet, {
      keywords: ["SQL injection"],
      following: [],
      friends: [],
      bannedUsers: [],
      bannedWords: [],
      sentTweetIds: [],
      sentTexts: [previousText]
    });

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^tweet_text_too_similar:/)]));
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

  it("adds keyword text relevance on top of handle search relevance", () => {
    const tweet: TweetCandidate = {
      id: "handle-keyword-1",
      text: "Published a fresh vulnerability advisory with exploit details and mitigation guidance for defenders",
      lang: "en",
      retweetCount: 1,
      favoriteCount: 0,
      user: {
        screenName: "security_author",
        followersCount: 400
      }
    };

    const decision = scoreTweet(
      tweet,
      {
        queryKeyword: "@security_author",
        keywords: ["@security_author", "vulnerability advisory"],
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
    expect(decision.scoreBreakdown).toEqual(
      expect.arrayContaining([{ label: "handle search keyword + keyword match", points: 28 }])
    );
  });

  it("adds extra relevance when a normal search tweet matches multiple keywords", () => {
    const tweet: TweetCandidate = {
      id: "multi-keyword-1",
      text: "Fresh XSS incident response notes include malware indicators and practical mitigation steps for defenders",
      lang: "en",
      retweetCount: 1,
      favoriteCount: 0,
      user: {
        screenName: "researcher",
        followersCount: 400
      }
    };

    const decision = scoreTweet(
      tweet,
      {
        queryKeyword: "xss",
        keywords: ["xss", "incident response", "malware"],
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

    expect(decision.scoreBreakdown).toEqual(
      expect.arrayContaining([{ label: "keyword match + 2 extra keywords", points: 26 }])
    );
  });

  it("gives strong relevance points to exact security keywords", () => {
    const tweet: TweetCandidate = {
      id: "relevance-1",
      text: "New CVE-2026-12345 vulnerability advisory includes exploit PoC details and mitigation steps for defenders",
      lang: "en",
      retweetCount: 1,
      favoriteCount: 0,
      user: {
        screenName: "researcher",
        followersCount: 400
      }
    };

    const decision = scoreTweet(tweet, {
      keywords: ["vulnerability advisory"],
      following: [],
      friends: [],
      bannedUsers: [],
      bannedWords: [],
      sentTweetIds: [],
      sentTexts: []
    });

    expect(decision.reasons).not.toContain("score_too_low");
    expect(decision.score).toBeGreaterThanOrEqual(DEFAULT_SCORING_CONFIG.minimumTweetScore);
    expect(decision.scoreBreakdown).toEqual(
      expect.arrayContaining([
        { label: "keyword match", points: 18 },
        { label: "security relevance", points: 15 }
      ])
    );
  });

  it("reduces score progressively as tweet age increases", () => {
    vi.setSystemTime(new Date("2026-05-16T12:00:00Z"));
    const baseTweet: TweetCandidate = {
      id: "age-score-1",
      text: "Fresh vulnerability advisory includes exploit details and mitigation guidance for defenders",
      lang: "en",
      retweetCount: 10,
      favoriteCount: 10,
      user: {
        screenName: "researcher",
        followersCount: 1000
      }
    };
    const lists = {
      keywords: ["vulnerability advisory"],
      following: [],
      friends: [],
      bannedUsers: [],
      bannedWords: [],
      sentTweetIds: [],
      sentTexts: []
    };
    const config = {
      ...DEFAULT_SCORING_CONFIG,
      maximumTweetAgeDays: 365,
      enableMinimumTweetScore: false
    };

    const recent = scoreTweet({ ...baseTweet, createdAt: new Date("2026-05-16T10:00:00Z") }, lists, config);
    const old = scoreTweet({ ...baseTweet, id: "age-score-2", createdAt: new Date("2025-05-16T10:00:00Z") }, lists, config);

    expect(old.score).toBeLessThan(recent.score);
    expect(old.scoreBreakdown?.find((item) => item.label === "tweet age")?.points).toBeLessThan(0);
    vi.useRealTimers();
  });

  it("rejects unknown or disallowed tweet languages when allowed languages are enabled", () => {
    const baseTweet: TweetCandidate = {
      id: "lang-1",
      text: "Fresh malware research with enough context and mitigation detail to be useful",
      retweetCount: 10,
      favoriteCount: 10,
      user: {
        screenName: "researcher",
        followersCount: 1000
      }
    };
    const lists = {
      keywords: ["malware"],
      following: [],
      friends: [],
      bannedUsers: [],
      bannedWords: [],
      sentTweetIds: [],
      sentTexts: []
    };

    expect(scoreTweet(baseTweet, lists).reasons).toContain("language_unknown");
    expect(scoreTweet({ ...baseTweet, lang: "es" }, lists).reasons).toContain("language_not_allowed");
    expect(scoreTweet({ ...baseTweet, lang: "en-US" }, lists).reasons).not.toContain("language_not_allowed");
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

    const mentionBridge = scoreTweet(
      {
        ...baseTweet,
        id: "banned-mention-bridge-1",
        text: "RT @julierobert: Si this advisory confirms the security impact"
      },
      {
        keywords: ["advisory"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["rt si"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(mentionBridge.reasons).not.toContain("banned_word:rt si");

    const directPhrase = scoreTweet(
      {
        ...baseTweet,
        id: "banned-direct-phrase-1",
        text: "This thread says rt si this advisory confirms the security impact"
      },
      {
        keywords: ["advisory"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["rt si"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(directPhrase.reasons).toContain("banned_word:rt si");

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

    const hashtagPrefix = scoreTweet(
      {
        ...baseTweet,
        id: "banned-hashtag-prefix-1",
        text: "Day 56 - #AdventOfCyber found some amazing resources about ethical hacking"
      },
      {
        keywords: ["ethical"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["#ad"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(hashtagPrefix.reasons).not.toContain("banned_word:#ad");

    const exactHashtag = scoreTweet(
      {
        ...baseTweet,
        id: "banned-hashtag-exact-1",
        text: "Suspicious sponsored post #ad about cyber security resources"
      },
      {
        keywords: ["cyber"],
        following: [],
        friends: [],
        bannedUsers: [],
        bannedWords: ["#ad"],
        sentTweetIds: [],
        sentTexts: []
      },
      config
    );
    expect(exactHashtag.reasons).toContain("banned_word:#ad");
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
