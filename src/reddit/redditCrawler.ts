import { isHandleSearchKeyword } from "../text";

export interface RedditCrawlerConfig {
  enabled: boolean;
  userAgent: string;
  subreddits: string[];
  limitPerKeyword: number;
  sort: "relevance" | "hot" | "top" | "new" | "comments";
  timeRange: "hour" | "day" | "week" | "month" | "year" | "all";
  minScore: number;
}

export interface RedditPost {
  id: string;
  keyword: string;
  subreddit: string;
  title: string;
  text: string;
  author: string;
  url: string;
  permalink: string;
  score: number;
  commentsCount: number;
  createdAt: Date;
}

type RedditListing = {
  data?: {
    children?: Array<{
      kind?: string;
      data?: Record<string, unknown>;
    }>;
  };
};

export function isTopicKeyword(keyword: string): boolean {
  const trimmed = keyword.trim();
  return trimmed.length > 0 && !isHandleSearchKeyword(trimmed);
}

export class RedditCrawler {
  constructor(private readonly config: RedditCrawlerConfig) {}

  async searchKeyword(keyword: string): Promise<RedditPost[]> {
    const normalizedKeyword = keyword.trim();
    if (!this.config.enabled || !isTopicKeyword(normalizedKeyword)) {
      return [];
    }

    const url = redditSearchUrl(normalizedKeyword, this.config);
    const response = await fetch(url, {
      headers: {
        "user-agent": this.config.userAgent,
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Reddit search failed with HTTP ${response.status}`);
    }

    const listing = (await response.json()) as RedditListing;
    return (listing.data?.children ?? [])
      .map((child) => mapRedditChild(normalizedKeyword, child.data))
      .filter((post): post is RedditPost => Boolean(post))
      .filter((post) => post.score >= this.config.minScore)
      .slice(0, this.config.limitPerKeyword);
  }
}

function redditSearchUrl(keyword: string, config: RedditCrawlerConfig): string {
  const subredditPath = config.subreddits.length > 0 ? `/r/${config.subreddits.map(encodeURIComponent).join("+")}` : "";
  const url = new URL(`https://www.reddit.com${subredditPath}/search.json`);
  url.searchParams.set("q", keyword);
  url.searchParams.set("limit", String(config.limitPerKeyword));
  url.searchParams.set("sort", config.sort);
  url.searchParams.set("t", config.timeRange);
  if (config.subreddits.length > 0) {
    url.searchParams.set("restrict_sr", "1");
  }
  return url.toString();
}

function mapRedditChild(keyword: string, data: Record<string, unknown> | undefined): RedditPost | null {
  if (!data) return null;
  const id = stringValue(data.id);
  const subreddit = stringValue(data.subreddit);
  const title = stringValue(data.title);
  const permalink = stringValue(data.permalink);
  if (!id || !subreddit || !title || !permalink) {
    return null;
  }

  const createdUtc = numberValue(data.created_utc);
  const text = stringValue(data.selftext) || title;
  return {
    id,
    keyword,
    subreddit,
    title,
    text,
    author: stringValue(data.author) || "unknown",
    url: stringValue(data.url) || `https://www.reddit.com${permalink}`,
    permalink: `https://www.reddit.com${permalink}`,
    score: numberValue(data.score),
    commentsCount: numberValue(data.num_comments),
    createdAt: new Date(createdUtc > 0 ? createdUtc * 1000 : Date.now())
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
