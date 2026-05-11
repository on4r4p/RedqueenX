import type { ScoreDecision, ScoringConfig, TweetCandidate } from "./types";
import { isHandleSearchKeyword, normalizeHandle, normalizeSearchText, textContainsBannedTerm } from "./text";

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  enableMinimumSearchResults: true,
  enableLuckFactor: true,
  enableAllowedLanguages: true,
  enableMinimumTweetLength: true,
  enableMinimumTweetRetweets: true,
  enableMaximumTweetRetweets: true,
  enableMinimumTweetFavorites: true,
  enableMaximumTweetFavorites: true,
  enableMinimumUserFollowers: true,
  enableMinimumTweetScore: true,
  enableMaximumTweetAgeDays: true,
  enableMaximumHashtags: true,
  enableMaximumMentions: true,
  enableMaximumTweetsByUser: true,
  enableSimilarTweetText: true,
  minimumSearchResults: 3,
  luckFactorDenominator: 200,
  allowedLanguages: ["en", "fr"],
  minimumTweetLength: 70,
  minimumTweetRetweets: 1,
  maximumTweetRetweets: 623,
  minimumTweetFavorites: 0,
  maximumTweetFavorites: 323,
  minimumUserFollowers: 400,
  minimumTweetScore: 25,
  maximumTweetAgeDays: 2,
  maximumHashtags: 3,
  maximumMentions: 3,
  maximumTweetsByUser: 2,
  similarTweetTextThreshold: 0.52
};

export interface ScoreLists {
  queryKeyword?: string;
  keywords: string[];
  following: string[];
  friends: string[];
  bannedUsers: string[];
  bannedWords: string[];
  sentTweetIds: string[];
  sentTexts: string[];
  tweetsByUser?: Record<string, number>;
}

export function scoreTweet(tweet: TweetCandidate, lists: ScoreLists, config: ScoringConfig = DEFAULT_SCORING_CONFIG): ScoreDecision {
  const reasons: string[] = [];
  let score = 0;
  const normalizedText = normalizeSearchText(tweet.text);
  const userHandle = normalizeHandle(tweet.user.screenName) ?? tweet.user.screenName.toLowerCase();
  const following = new Set(lists.following.map((value) => normalizeHandle(value) ?? value.toLowerCase()));
  const friends = new Set(lists.friends.map((value) => normalizeHandle(value) ?? value.toLowerCase()));
  const bannedUsers = new Set(lists.bannedUsers.map((value) => normalizeHandle(value) ?? value.toLowerCase()));

  if (config.enableMinimumTweetLength && tweet.text.length < config.minimumTweetLength) {
    reasons.push("tweet_too_short");
  }

  if (config.enableAllowedLanguages) {
    const tweetLang = normalizeLanguageCode(tweet.lang);
    if (!tweetLang) {
      reasons.push("language_unknown");
    } else if (!isAllowedLanguage(tweetLang, config.allowedLanguages)) {
      reasons.push("language_not_allowed");
    }
  }

  if (lists.sentTweetIds.includes(tweet.id)) {
    reasons.push("tweet_id_already_seen");
  }

  const exactSentTextMatch = lists.sentTexts.some((sentText) => normalizeSearchText(sentText) === normalizedText);
  if (exactSentTextMatch) {
    reasons.push("tweet_text_already_seen");
  } else if (config.enableSimilarTweetText) {
    const similarMatch = findSimilarSentText(tweet.text, lists.sentTexts, config.similarTweetTextThreshold);
    if (similarMatch) {
      reasons.push(`tweet_text_too_similar:${Math.round(similarMatch.score * 100)}%`);
    }
  }

  if (bannedUsers.has(userHandle)) {
    reasons.push("banned_user");
  }

  const userBio = tweet.user.description ?? "";
  for (const bannedWord of lists.bannedWords) {
    if (textContainsBannedTerm(tweet.text, bannedWord) || textContainsBannedTerm(userBio, bannedWord)) {
      reasons.push(`banned_word:${bannedWord}`);
      break;
    }
  }

  const matchedKeyword =
    isHandleSearchKeyword(lists.queryKeyword) ||
    lists.keywords.some((keyword) => {
      const normalizedKeyword = normalizeSearchText(keyword);
      return normalizedKeyword.length > 0 && normalizedText.includes(normalizedKeyword);
    });
  if (!matchedKeyword) {
    reasons.push("missing_keyword");
  } else {
    score += 10;
  }

  const hashtags = tweet.entities?.hashtags?.length ?? 0;
  if (config.enableMaximumHashtags && hashtags >= config.maximumHashtags) {
    reasons.push("too_many_hashtags");
  } else {
    score += hashtags;
  }

  const mentions = tweet.entities?.mentions?.length ?? 0;
  if (config.enableMaximumMentions && mentions >= config.maximumMentions) {
    reasons.push("too_many_mentions");
  } else {
    score += mentions;
  }

  const userTweetCount = lists.tweetsByUser?.[userHandle] ?? 0;
  if (config.enableMaximumTweetsByUser && userTweetCount >= config.maximumTweetsByUser) {
    reasons.push("too_many_tweets_by_user");
  }

  const retweets = tweet.retweetCount ?? 0;
  if (config.enableMinimumTweetRetweets && retweets < config.minimumTweetRetweets) {
    reasons.push("not_enough_retweets");
  }
  if (config.enableMaximumTweetRetweets && retweets > config.maximumTweetRetweets && !following.has(userHandle) && !friends.has(userHandle)) {
    reasons.push("too_many_retweets");
  }
  score += boundedPopularityScore(retweets);

  const favorites = tweet.favoriteCount ?? 0;
  if (config.enableMinimumTweetFavorites && favorites < config.minimumTweetFavorites) {
    reasons.push("not_enough_favorites");
  }
  if (favorites > 0 && (!config.enableMinimumTweetFavorites || favorites > config.minimumTweetFavorites)) {
    score += 1 + boundedPopularityScore(favorites);
  }
  if (config.enableMaximumTweetFavorites && favorites > config.maximumTweetFavorites && !following.has(userHandle) && !friends.has(userHandle)) {
    reasons.push("too_many_favorites");
  }

  const followers = tweet.user.followersCount ?? 0;
  if (config.enableMinimumUserFollowers && followers < config.minimumUserFollowers && !following.has(userHandle) && !friends.has(userHandle)) {
    reasons.push("not_enough_followers");
  } else {
    score += boundedPopularityScore(Math.floor(followers / 100));
  }

  if (tweet.user.verified) {
    score += 5;
  }
  if (following.has(userHandle)) {
    score += 10;
  }
  if (friends.has(userHandle)) {
    score += 15;
  }

  if (tweet.createdAt) {
    const ageMs = Date.now() - tweet.createdAt.getTime();
    const ageDays = ageMs / 86_400_000;
    if (config.enableMaximumTweetAgeDays && ageDays > config.maximumTweetAgeDays) {
      reasons.push("tweet_too_old");
    } else {
      score += Math.max(0, 24 - Math.floor(ageMs / 3_600_000));
    }
  }

  if (tweet.entities?.urls?.length) {
    score += 3;
  }
  if (tweet.entities?.media?.length) {
    score += 3;
  }

  if (config.enableMinimumTweetScore && score < config.minimumTweetScore) {
    reasons.push("score_too_low");
  }

  return {
    accepted: reasons.length === 0,
    score,
    reasons,
    normalizedText
  };
}

export function normalizeLanguageCode(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "und") return null;
  return normalized.split("-")[0] || null;
}

export function isAllowedLanguage(lang: string, allowedLanguages: string[]): boolean {
  const normalizedLang = normalizeLanguageCode(lang);
  if (!normalizedLang) return false;
  return allowedLanguages.some((allowed) => normalizeLanguageCode(allowed) === normalizedLang);
}

function boundedPopularityScore(value: number): number {
  if (value <= 0) return 0;
  if (value <= 23) return value;
  return 23 + Math.min(23, Math.floor((value - 20) / 10));
}

export interface SimilarSentTextMatch {
  score: number;
}

export function findSimilarSentText(text: string, sentTexts: string[], threshold: number): SimilarSentTextMatch | null {
  const normalizedThreshold = normalizeSimilarityThreshold(threshold);
  let best: SimilarSentTextMatch | null = null;
  for (const sentText of sentTexts) {
    const score = tweetTextSimilarity(text, sentText);
    if (score >= normalizedThreshold && (!best || score > best.score)) {
      best = { score };
    }
  }
  return best;
}

export function tweetTextSimilarity(left: string, right: string): number {
  const leftText = normalizeSearchText(left);
  const rightText = normalizeSearchText(right);
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  if (hasLongSharedWindow(leftText, rightText)) return 1;

  const leftTokens = meaningfulTokenSet(leftText);
  const rightTokens = meaningfulTokenSet(rightText);
  if (leftTokens.size < 6 || rightTokens.size < 6) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  if (shared < 6) return 0;

  const dice = (2 * shared) / (leftTokens.size + rightTokens.size);
  const overlap = shared / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(dice, overlap);
}

function normalizeSimilarityThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCORING_CONFIG.similarTweetTextThreshold;
  return Math.max(0, Math.min(1, value));
}

function hasLongSharedWindow(left: string, right: string): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < 40) return false;
  const windowSize = Math.max(40, Math.floor(shorter.length * 0.45));
  for (let start = 0; start + windowSize <= shorter.length; start += 1) {
    const sample = shorter.slice(start, start + windowSize).trim();
    if (sample.length >= 40 && longer.includes(sample)) {
      return true;
    }
  }
  return false;
}

function meaningfulTokenSet(text: string): Set<string> {
  const tokens = text
    .split(" ")
    .map(normalizeSimilarityToken)
    .filter((token) => token.length >= 3 && !similarityStopWords.has(token));
  return new Set(tokens);
}

function normalizeSimilarityToken(token: string): string {
  if (token === "sqli") return "sql";
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

const similarityStopWords = new Set([
  "about",
  "according",
  "after",
  "again",
  "against",
  "also",
  "and",
  "another",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "could",
  "described",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "may",
  "more",
  "not",
  "now",
  "over",
  "post",
  "reportedly",
  "says",
  "that",
  "the",
  "their",
  "this",
  "through",
  "was",
  "were",
  "with",
  "would"
]);
