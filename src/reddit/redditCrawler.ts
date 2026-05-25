import { isHandleSearchKeyword } from "../text";
import type { TweetMedia } from "../types";

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
  media: TweetMedia[];
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
    createdAt: new Date(createdUtc > 0 ? createdUtc * 1000 : Date.now()),
    media: redditMediaItems(data, title)
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function redditMediaItems(data: Record<string, unknown>, title: string): TweetMedia[] {
  const videoUrl = redditVideoUrl(data);
  const previewUrl = redditPreviewImageUrl(data);
  const directUrl = redditDirectMediaUrl(data);
  const thumbnailUrl = redditThumbnailUrl(data);
  const imageUrl = directUrl || previewUrl || thumbnailUrl;
  if (videoUrl) {
    return [
      {
        type: "video",
        url: imageUrl || videoUrl,
        previewImageUrl: imageUrl || undefined,
        videoUrl,
        altText: title
      }
    ];
  }
  if (imageUrl) {
    return [
      {
        type: "photo",
        url: imageUrl,
        previewImageUrl: previewUrl || imageUrl,
        altText: title
      }
    ];
  }
  return [];
}

function redditVideoUrl(data: Record<string, unknown>): string {
  const media = objectValue(data.secure_media) || objectValue(data.media);
  const redditVideo = media ? objectValue(media.reddit_video) : null;
  return normalizeRedditMediaUrl(redditVideo?.fallback_url);
}

function redditPreviewImageUrl(data: Record<string, unknown>): string {
  const preview = objectValue(data.preview);
  const images = arrayValue(preview?.images);
  const firstImage = objectValue(images[0]);
  const source = firstImage ? objectValue(firstImage.source) : null;
  return normalizeRedditMediaUrl(source?.url);
}

function redditDirectMediaUrl(data: Record<string, unknown>): string {
  const candidate = normalizeRedditMediaUrl(data.url_overridden_by_dest) || normalizeRedditMediaUrl(data.url);
  return candidate && isRedditHostedMediaUrl(candidate) ? candidate : "";
}

function redditThumbnailUrl(data: Record<string, unknown>): string {
  const candidate = normalizeRedditMediaUrl(data.thumbnail);
  return candidate && isRedditHostedMediaUrl(candidate) ? candidate : "";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeRedditMediaUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/&amp;/g, "&");
  if (!normalized || normalized === "self" || normalized === "default" || normalized === "nsfw") return "";
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isRedditHostedMediaUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "i.redd.it" ||
      hostname === "v.redd.it" ||
      hostname === "preview.redd.it" ||
      hostname === "external-preview.redd.it" ||
      hostname === "redditmedia.com" ||
      hostname.endsWith(".redditmedia.com")
    );
  } catch {
    return false;
  }
}
