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
  relaxMinimumPopularityForHandleSearch: false,
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
  bannedWordExceptions?: string[];
  sentTweetIds: string[];
  sentTexts: string[];
  tweetsByUser?: Record<string, number>;
}

export function scoreTweet(tweet: TweetCandidate, lists: ScoreLists, config: ScoringConfig = DEFAULT_SCORING_CONFIG): ScoreDecision {
  const reasons: string[] = [];
  const scoreBreakdown: { label: string; points: number }[] = [];
  let score = 0;
  const addScore = (points: number, label: string) => {
    if (!Number.isFinite(points) || points <= 0) return;
    score += points;
    scoreBreakdown.push({ label, points });
  };
  const addPenalty = (points: number, label: string) => {
    if (!Number.isFinite(points) || points <= 0) return;
    score -= points;
    scoreBreakdown.push({ label, points: -points });
  };
  const normalizedText = normalizeSearchText(tweet.text);
  const relaxMinimumPopularity =
    config.relaxMinimumPopularityForHandleSearch && isHandleSearchKeyword(lists.queryKeyword ?? "");
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
  const bannedWordExceptions = lists.bannedWordExceptions ?? [];
  for (const bannedWord of lists.bannedWords) {
    if (
      textContainsBannedTerm(tweet.text, bannedWord, bannedWordExceptions) ||
      textContainsBannedTerm(userBio, bannedWord, bannedWordExceptions)
    ) {
      reasons.push(`banned_word:${bannedWord}`);
      break;
    }
  }

  const keywordMatch = scoreKeywordRelevance(tweet, lists, normalizedText);
  const matchedKeyword = keywordMatch.matched;
  if (!matchedKeyword) {
    reasons.push("missing_keyword");
  } else {
    addScore(keywordMatch.points, keywordMatch.label);
  }

  addScore(scoreSecurityRelevance(normalizedText), "security relevance");

  const hashtags = tweet.entities?.hashtags?.length ?? 0;
  if (config.enableMaximumHashtags && hashtags >= config.maximumHashtags) {
    reasons.push("too_many_hashtags");
  } else {
    addScore(hashtags, "hashtags");
  }

  const mentions = tweet.entities?.mentions?.length ?? 0;
  if (config.enableMaximumMentions && mentions >= config.maximumMentions) {
    reasons.push("too_many_mentions");
  } else {
    addScore(mentions, "mentions");
  }

  const userTweetCount = lists.tweetsByUser?.[userHandle] ?? 0;
  if (config.enableMaximumTweetsByUser && userTweetCount >= config.maximumTweetsByUser) {
    reasons.push("too_many_tweets_by_user");
  }

  const retweets = tweet.retweetCount ?? 0;
  if (!relaxMinimumPopularity && config.enableMinimumTweetRetweets && retweets < config.minimumTweetRetweets) {
    reasons.push("not_enough_retweets");
  }
  if (config.enableMaximumTweetRetweets && retweets > config.maximumTweetRetweets && !following.has(userHandle) && !friends.has(userHandle)) {
    reasons.push("too_many_retweets");
  }
  addScore(boundedPopularityScore(retweets), "retweets");

  const favorites = tweet.favoriteCount ?? 0;
  if (!relaxMinimumPopularity && config.enableMinimumTweetFavorites && favorites < config.minimumTweetFavorites) {
    reasons.push("not_enough_favorites");
  }
  if (favorites > 0 && (!config.enableMinimumTweetFavorites || favorites > config.minimumTweetFavorites)) {
    addScore(1 + boundedPopularityScore(favorites), "favorites");
  }
  if (config.enableMaximumTweetFavorites && favorites > config.maximumTweetFavorites && !following.has(userHandle) && !friends.has(userHandle)) {
    reasons.push("too_many_favorites");
  }

  const followers = tweet.user.followersCount ?? 0;
  if (config.enableMinimumUserFollowers && followers < config.minimumUserFollowers && !following.has(userHandle) && !friends.has(userHandle)) {
    reasons.push("not_enough_followers");
  } else {
    addScore(boundedPopularityScore(Math.floor(followers / 100)), "author followers");
  }

  if (tweet.user.verified) {
    addScore(5, "verified author");
  }
  if (following.has(userHandle)) {
    addScore(10, "followed author");
  }
  if (friends.has(userHandle)) {
    addScore(15, "friend author");
  }

  if (tweet.createdAt) {
    const ageMs = Date.now() - tweet.createdAt.getTime();
    const ageDays = ageMs / 86_400_000;
    const maximumAgeDays = Math.max(1, config.maximumTweetAgeDays);
    if (config.enableMaximumTweetAgeDays && ageDays > config.maximumTweetAgeDays) {
      reasons.push("tweet_too_old");
    }
    addPenalty(scoreTweetAgePenalty(ageDays, maximumAgeDays), "tweet age");
    if (ageDays <= maximumAgeDays) {
      addScore(Math.max(0, 24 - Math.floor(ageMs / 3_600_000)), "fresh tweet");
    }
  }

  if (tweet.entities?.urls?.length) {
    addScore(3, "has URL");
  }
  if (tweet.entities?.media?.length) {
    addScore(3, "has media");
  }

  if (config.enableMinimumTweetScore && score < config.minimumTweetScore) {
    reasons.push("score_too_low");
  }

  return {
    accepted: reasons.length === 0,
    score,
    scoreBreakdown,
    reasons,
    normalizedText
  };
}

function scoreKeywordRelevance(
  tweet: TweetCandidate,
  lists: ScoreLists,
  normalizedText: string
): { matched: boolean; points: number; label: string } {
  if (isHandleSearchKeyword(lists.queryKeyword)) {
    const keywordTextMatch = bestKeywordTextRelevance(tweet, lists, normalizedText);
    if (keywordTextMatch) {
      return {
        matched: true,
        points: 10 + keywordTextMatch.points,
        label: `handle search keyword + ${keywordTextMatch.label}`
      };
    }
    return { matched: true, points: 10, label: "handle search keyword" };
  }

  const best = bestKeywordTextRelevance(tweet, lists, normalizedText);
  return best ? { matched: true, ...best } : { matched: false, points: 0, label: "keyword match" };
}

function bestKeywordTextRelevance(tweet: TweetCandidate, lists: ScoreLists, normalizedText: string): { points: number; label: string } | null {
  const matches: Array<{ points: number; label: string; keyword: string }> = [];
  const hashtags = (tweet.entities?.hashtags ?? []).map((value) => normalizeSearchText(value)).filter(Boolean);
  for (const keyword of lists.keywords) {
    if (isHandleSearchKeyword(keyword)) continue;
    const normalizedKeyword = normalizeSearchText(keyword);
    if (!normalizedKeyword) continue;
    if (normalizedText.includes(normalizedKeyword)) {
      const exactPoints = normalizedKeyword.length >= 8 ? 18 : 15;
      matches.push({ points: exactPoints, label: "keyword match", keyword: normalizedKeyword });
      continue;
    }

    const keywordTokens = meaningfulKeywordTokens(normalizedKeyword);
    if (keywordTokens.length >= 2) {
      const matchedTokens = keywordTokens.filter((token) => normalizedText.includes(token)).length;
      if (matchedTokens >= 2) {
        const partialPoints = Math.min(14, 7 + matchedTokens * 2);
        matches.push({ points: partialPoints, label: "partial keyword match", keyword: normalizedKeyword });
      }
    }

    if (hashtags.some((hashtag) => hashtag === normalizedKeyword || hashtag.includes(normalizedKeyword))) {
      const hashtagPoints = 12;
      matches.push({ points: hashtagPoints, label: "keyword hashtag", keyword: normalizedKeyword });
    }
  }

  if (matches.length === 0) return null;
  const uniqueMatches = [...new Map(matches.sort((left, right) => right.points - left.points).map((match) => [match.keyword, match])).values()];
  const [best, ...extraMatches] = uniqueMatches;
  const extraPoints = Math.min(12, extraMatches.length * 4);
  if (extraPoints === 0) {
    return { points: best.points, label: best.label };
  }
  return {
    points: best.points + extraPoints,
    label: `${best.label} + ${extraMatches.length} extra keyword${extraMatches.length === 1 ? "" : "s"}`
  };
}

const securityRelevanceTerms = [
  "0day",
  "advisory",
  "breach",
  "cve",
  "exploit",
  "incident response",
  "ioc",
  "malware",
  "mitigation",
  "patch",
  "phishing",
  "poc",
  "ransomware",
  "threat actor",
  "vulnerability",
  "xss"
];

function scoreSecurityRelevance(normalizedText: string): number {
  let points = 0;
  if (/\bcve\s*\d{4}\s*\d{4,7}\b/.test(normalizedText)) {
    points += 8;
  }
  for (const term of securityRelevanceTerms) {
    if (normalizedText.includes(term)) {
      points += 3;
    }
  }
  return Math.min(points, 15);
}

function meaningfulKeywordTokens(normalizedKeyword: string): string[] {
  return normalizedKeyword
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
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

function scoreTweetAgePenalty(ageDays: number, maximumAgeDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 1) return 0;
  const configuredWindow = Math.max(1, maximumAgeDays - 1);
  const withinWindowPenalty = Math.ceil((Math.min(ageDays, maximumAgeDays) - 1) / configuredWindow * 20);
  const overLimitPenalty = ageDays > maximumAgeDays ? Math.ceil((ageDays - maximumAgeDays) * 3) : 0;
  return Math.min(100, withinWindowPenalty + overLimitPenalty);
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
