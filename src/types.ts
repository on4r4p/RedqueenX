export const LIST_KINDS = [
  "keyword",
  "following",
  "friend",
  "banned_user",
  "banned_word",
  "banned_word_exception",
  "rss_feed",
  "tweet_sent",
  "text_sent",
  "no_result",
  "suggested_keyword",
  "request_log",
  "total_api_call",
  "update_status_call",
  "current_session",
  "search_terms_used",
  "stale_keyword_user",
  "skipped_keyword_user",
  "rss_sent",
  "hidden_session"
] as const;

export type ListKind = (typeof LIST_KINDS)[number];

export type RunStatus = "running" | "paused" | "stopped" | "completed";

export interface ListEntry {
  id: number;
  kind: ListKind;
  rawValue: string;
  normalizedValue: string;
  handleNormalized: string | null;
  sourceFile: string | null;
  lineNumber: number | null;
  isEmpty: boolean;
  isDeleted: boolean;
  createdAt: string;
  importedAt: string | null;
}

export interface RunRecord {
  id: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  statsJson: string;
}

export interface RunStats {
  currentKeyword: string | null;
  totalKeywords: number;
  completedKeywords: number;
  remainingKeywords: number;
  availableKeywords?: number | null;
  sessionKeywordLimit?: number | null;
  sessionKeywordLimitRandom?: boolean;
  randomizeKeywordOrder?: boolean;
  userKeywordPercent?: number;
  runChainTotal?: number | null;
  runChainIndex?: number | null;
  runChainRemaining?: number | null;
  apiCallsUsed: number;
  apiCallLimit: number;
  apiCallsRemaining: number;
  apiWindowMinutes: number;
  nextApiResetAt: string | null;
  browserAlertAutoIgnore?: boolean;
  browserAlertRetryCount?: number;
  browserAlertMaxRetries?: number;
  browserAlertAutoRestartDelaySeconds?: number;
  browserAlertAutoRestartAt?: string | null;
  browserAlertLastCompletedKeywords?: number | null;
  acceptedTweets: number;
  rejectedTweets: number;
  lastScore: number | null;
  lastTweetId: string | null;
}

export interface RunEventRecord {
  id: number;
  runId: string | null;
  type: string;
  message: string;
  dataJson: string;
  createdAt: string;
}

export interface TweetCandidate {
  id: string;
  text: string;
  lang?: string;
  createdAt?: Date;
  retweetCount?: number;
  favoriteCount?: number;
  user: {
    screenName: string;
    name?: string;
    description?: string;
    followersCount?: number;
    verified?: boolean;
    profileImageUrl?: string;
  };
  entities?: {
    hashtags?: string[];
    mentions?: string[];
    urls?: string[];
    media?: TweetMedia[];
  };
}

export interface TweetMedia {
  type: string;
  url?: string;
  previewImageUrl?: string;
  videoUrl?: string;
  altText?: string;
  width?: number;
  height?: number;
}

export interface ScoringConfig {
  enableMinimumSearchResults: boolean;
  enableLuckFactor: boolean;
  enableAllowedLanguages: boolean;
  enableMinimumTweetLength: boolean;
  enableMinimumTweetRetweets: boolean;
  enableMaximumTweetRetweets: boolean;
  enableMinimumTweetFavorites: boolean;
  enableMaximumTweetFavorites: boolean;
  relaxMinimumPopularityForHandleSearch: boolean;
  enableMinimumUserFollowers: boolean;
  enableMinimumTweetScore: boolean;
  enableMaximumTweetAgeDays: boolean;
  enableMaximumHashtags: boolean;
  enableMaximumMentions: boolean;
  enableMaximumTweetsByUser: boolean;
  enableSimilarTweetText: boolean;
  minimumSearchResults: number;
  luckFactorDenominator: number;
  allowedLanguages: string[];
  minimumTweetLength: number;
  minimumTweetRetweets: number;
  maximumTweetRetweets: number;
  minimumTweetFavorites: number;
  maximumTweetFavorites: number;
  minimumUserFollowers: number;
  minimumTweetScore: number;
  maximumTweetAgeDays: number;
  maximumHashtags: number;
  maximumMentions: number;
  maximumTweetsByUser: number;
  similarTweetTextThreshold: number;
}

export interface ScoreDecision {
  accepted: boolean;
  score: number;
  scoreBreakdown?: ScoreBreakdownItem[];
  reasons: string[];
  normalizedText: string;
}

export interface ScoreBreakdownItem {
  label: string;
  points: number;
}
