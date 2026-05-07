import { ListService } from "./admin/listService";
import { scoreTweet, type ScoreLists, DEFAULT_SCORING_CONFIG } from "./scoring";
import type { ScoreDecision, ScoringConfig, TweetCandidate } from "./types";
import { isHandleSearchKeyword, normalizeHandle, normalizeSearchText, textContainsBannedTerm } from "./text";
import type { XSearchClient, XSearchMode } from "./x-client";

export interface CrawlResult {
  keyword: string;
  tweet: TweetCandidate;
  decision: ScoreDecision;
}

export type AcceptedTweetHandler = (result: CrawlResult) => void;

export interface TweetPrefilterDecision {
  accepted: boolean;
  reasons: string[];
}

export interface TweetPrefilterResult {
  tweet: TweetCandidate;
  decision: TweetPrefilterDecision;
}

export class Crawler {
  constructor(
    private readonly lists: ListService,
    private readonly xClient: XSearchClient,
    private readonly getScoringConfig: () => ScoringConfig = () => DEFAULT_SCORING_CONFIG,
    private readonly onAcceptedTweet?: AcceptedTweetHandler,
    private readonly random: () => number = Math.random
  ) {}

  async crawlKeyword(keyword: string, maxResults = 100): Promise<CrawlResult[]> {
    const tweets = await this.xClient.searchRecent(keyword, maxResults);
    return this.scoreTweets(keyword, tweets);
  }

  async searchKeyword(keyword: string, maxResults = 100, mode: XSearchMode = "detailed"): Promise<TweetCandidate[]> {
    return this.xClient.searchRecent(keyword, maxResults, mode);
  }

  async hydrateTweets(tweetIds: string[]): Promise<TweetCandidate[]> {
    return this.xClient.lookupTweetsDetailed(tweetIds);
  }

  countRecent(keyword: string): Promise<number> {
    return this.xClient.countRecent(keyword);
  }

  selectTweetsForHydration(keyword: string, tweets: TweetCandidate[]): TweetCandidate[] {
    return this.explainTweetsForHydration(keyword, tweets)
      .filter((result) => result.decision.accepted)
      .map((result) => result.tweet);
  }

  explainTweetForHydration(keyword: string, tweet: TweetCandidate): TweetPrefilterDecision {
    return explainTweetPrefilter(tweet, keyword, this.buildScoreLists(keyword), this.getScoringConfig());
  }

  explainTweetsForHydration(keyword: string, tweets: TweetCandidate[]): TweetPrefilterResult[] {
    const scoreLists = this.buildScoreLists(keyword);
    const config = this.getScoringConfig();
    return tweets.map((tweet) => ({
      tweet,
      decision: explainTweetPrefilter(tweet, keyword, scoreLists, config)
    }));
  }

  scoreTweets(keyword: string, tweets: TweetCandidate[]): CrawlResult[] {
    const scoreLists = this.buildScoreLists(keyword);

    return tweets.map((tweet) => {
      const config = this.getScoringConfig();
      const decision = this.applyLuckFactor(scoreTweet(tweet, scoreLists, config), config);
      if (decision.accepted) {
        const importedAt = new Date().toISOString();
        this.lists.add("tweet_sent", tweet.id, `runtime:x-search:${keyword}`, null, importedAt);
        this.lists.add("text_sent", tweet.text, `runtime:x-search:${keyword}`, null, importedAt);
        scoreLists.sentTweetIds.push(tweet.id);
        scoreLists.sentTexts.push(tweet.text);
      }

      const result = {
        keyword,
        tweet,
        decision
      };
      if (decision.accepted) {
        this.onAcceptedTweet?.(result);
      }
      return result;
    });
  }

  private applyLuckFactor(decision: ScoreDecision, config: ScoringConfig): ScoreDecision {
    if (!config.enableLuckFactor || decision.accepted || config.luckFactorDenominator <= 0) {
      return decision;
    }
    if (this.random() >= 1 / config.luckFactorDenominator) {
      return decision;
    }

    return {
      ...decision,
      accepted: true,
      reasons: [...decision.reasons, `luck_factor:1/${config.luckFactorDenominator}`]
    };
  }

  private buildScoreLists(keyword?: string): ScoreLists {
    const keywords = this.lists.activeValues("keyword");
    const queryKeyword = keyword?.trim();
    const queryKeywords = queryKeyword && !keywords.includes(queryKeyword) ? [queryKeyword] : [];
    return {
      queryKeyword: keyword,
      keywords: [...keywords, ...queryKeywords],
      following: this.lists.activeValues("following"),
      friends: this.lists.activeValues("friend"),
      bannedUsers: this.lists.activeValues("banned_user"),
      bannedWords: this.lists.activeValues("banned_word"),
      sentTweetIds: this.lists.activeValues("tweet_sent"),
      sentTexts: this.lists.activeValues("text_sent")
    };
  }
}

export function explainTweetPrefilter(
  tweet: TweetCandidate,
  keyword: string,
  lists: ScoreLists,
  config: ScoringConfig
): TweetPrefilterDecision {
  const reasons: string[] = [];
  const normalizedText = normalizeSearchText(tweet.text);
  if (config.enableMinimumTweetLength && tweet.text.length < config.minimumTweetLength) {
    reasons.push("tweet_too_short");
  }
  if (config.enableAllowedLanguages && tweet.lang && !config.allowedLanguages.includes(tweet.lang)) {
    reasons.push(`language_not_allowed:${tweet.lang}`);
  }
  if (lists.sentTweetIds.includes(tweet.id)) {
    reasons.push("tweet_id_already_seen");
  }
  if (lists.sentTexts.some((sentText) => normalizeSearchText(sentText) === normalizedText)) {
    reasons.push("tweet_text_already_seen");
  }

  const userHandle = normalizeHandle(tweet.user.screenName) ?? tweet.user.screenName.toLowerCase();
  const bannedUsers = new Set(lists.bannedUsers.map((value) => normalizeHandle(value) ?? value.toLowerCase()));
  if (bannedUsers.has(userHandle)) {
    reasons.push(`banned_user:${tweet.user.screenName}`);
  }
  for (const bannedWord of lists.bannedWords) {
    if (textContainsBannedTerm(tweet.text, bannedWord)) {
      reasons.push(`banned_word:${bannedWord}`);
      break;
    }
  }

  const normalizedKeywords = extractQueryTerms(keyword).map(normalizeSearchText).filter(Boolean);
  const matchesKeyword =
    isHandleSearchKeyword(keyword) ||
    normalizedKeywords.some((value) => normalizedText.includes(value)) ||
    lists.keywords.some((value) => {
      const normalizedKeyword = normalizeSearchText(value);
      return normalizedKeyword.length > 0 && normalizedText.includes(normalizedKeyword);
    });
  if (!matchesKeyword) {
    reasons.push("missing_keyword");
  }

  const hashtags = tweet.entities?.hashtags?.length ?? 0;
  if (config.enableMaximumHashtags && hashtags >= config.maximumHashtags) {
    reasons.push(`too_many_hashtags:${hashtags}`);
  }
  const mentions = tweet.entities?.mentions?.length ?? 0;
  if (config.enableMaximumMentions && mentions >= config.maximumMentions) {
    reasons.push(`too_many_mentions:${mentions}`);
  }

  const retweets = tweet.retweetCount ?? 0;
  if (config.enableMinimumTweetRetweets && retweets < config.minimumTweetRetweets) {
    reasons.push(`not_enough_retweets:${retweets}`);
  }

  if (config.enableMaximumTweetAgeDays && tweet.createdAt) {
    const ageDays = (Date.now() - tweet.createdAt.getTime()) / 86_400_000;
    if (ageDays > config.maximumTweetAgeDays) {
      reasons.push(`tweet_too_old:${Math.floor(ageDays)}d`);
    }
  }

  return {
    accepted: reasons.length === 0,
    reasons
  };
}

function extractQueryTerms(query: string): string[] {
  return query
    .replace(/\s+-is:retweet\b/gi, "")
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/i)
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}
