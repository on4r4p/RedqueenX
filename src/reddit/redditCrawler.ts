import { isHandleSearchKeyword } from "../text";
import type { TweetMedia } from "../types";

export interface RedditCrawlerConfig {
  enabled: boolean;
  userAgent: string;
  clientId?: string;
  clientSecret?: string;
  subreddits: string[];
  includeGeneralSearch: boolean;
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

type RedditAccessToken = {
  value: string;
  expiresAtMs: number;
};

export function isTopicKeyword(keyword: string): boolean {
  const trimmed = keyword.trim();
  return trimmed.length > 0 && !isHandleSearchKeyword(trimmed);
}

export class RedditCrawler {
  private accessToken: RedditAccessToken | null = null;

  constructor(private readonly config: RedditCrawlerConfig) {}

  async searchKeyword(keyword: string): Promise<RedditPost[]> {
    const normalizedKeyword = keyword.trim();
    if (!this.config.enabled || !isTopicKeyword(normalizedKeyword)) {
      return [];
    }

    const postsById = new Map<string, RedditPost>();
    const auth = await this.requestAuth();
    for (const subreddits of redditSearchScopes(this.config)) {
      const url = redditSearchUrl(normalizedKeyword, this.config, subreddits, auth.oauth);
      const listing = await fetchRedditListing(url, auth.headers, auth.oauth);
      for (const post of (listing.data?.children ?? [])
        .map((child) => mapRedditChild(normalizedKeyword, child.data))
        .filter((post): post is RedditPost => Boolean(post))
        .filter((post) => post.score >= this.config.minScore)) {
        if (!postsById.has(post.id)) {
          postsById.set(post.id, post);
        }
      }
    }

    return Array.from(postsById.values()).slice(0, this.config.limitPerKeyword);
  }

  private async requestAuth(): Promise<{ oauth: boolean; headers: Record<string, string> }> {
    const clientId = this.config.clientId?.trim() || "";
    const clientSecret = this.config.clientSecret?.trim() || "";
    const headers = {
      "user-agent": this.config.userAgent,
      accept: "application/json"
    };

    if (!clientId && !clientSecret) {
      return { oauth: false, headers };
    }
    if (!clientId || !clientSecret) {
      throw new Error("Both REDDIT_CRAWL_CLIENT_ID and REDDIT_CRAWL_CLIENT_SECRET are required for Reddit OAuth.");
    }

    const token = await this.getAccessToken(clientId, clientSecret);
    return {
      oauth: true,
      headers: {
        ...headers,
        authorization: `Bearer ${token}`
      }
    };
  }

  private async getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAtMs > Date.now() + 60_000) {
      return this.accessToken.value;
    }

    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": this.config.userAgent,
        accept: "application/json"
      },
      body: new URLSearchParams({ grant_type: "client_credentials" })
    });
    if (!response.ok) {
      throw new Error(`Reddit OAuth token request failed with HTTP ${response.status}${await responseErrorPreview(response)}`);
    }

    const payload = await parseJsonResponse(response, "Reddit OAuth token response");
    const accessToken = stringValue(payload.access_token);
    if (!accessToken) {
      throw new Error("Reddit OAuth token response did not include an access_token.");
    }

    const expiresIn = Math.max(60, numberValue(payload.expires_in) || 3600);
    this.accessToken = {
      value: accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000
    };
    return accessToken;
  }
}

function redditSearchScopes(config: RedditCrawlerConfig): string[][] {
  const scopes = config.subreddits.length > 0 ? [config.subreddits] : [[]];
  if (config.includeGeneralSearch && config.subreddits.length > 0) {
    scopes.push([]);
  }
  return scopes;
}

function redditSearchUrl(keyword: string, config: RedditCrawlerConfig, subreddits: string[], oauth: boolean): string {
  const subredditPath = subreddits.length > 0 ? `/r/${subreddits.map(encodeURIComponent).join("+")}` : "";
  const host = oauth ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const endpoint = oauth ? "search" : "search.json";
  const url = new URL(`${host}${subredditPath}/${endpoint}`);
  url.searchParams.set("q", keyword);
  url.searchParams.set("limit", String(config.limitPerKeyword));
  url.searchParams.set("sort", config.sort);
  url.searchParams.set("t", config.timeRange);
  if (subreddits.length > 0) {
    url.searchParams.set("restrict_sr", "1");
  }
  return url.toString();
}

async function fetchRedditListing(url: string, headers: Record<string, string>, oauth: boolean): Promise<RedditListing> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const mode = oauth ? "OAuth" : "public JSON";
    const advice = oauth
      ? ""
      : " Reddit is blocking unauthenticated search JSON; configure REDDIT_CRAWL_CLIENT_ID and REDDIT_CRAWL_CLIENT_SECRET for OAuth.";
    throw new Error(`Reddit ${mode} search failed with HTTP ${response.status}.${advice}${await responseErrorPreview(response)}`);
  }

  return parseJsonResponse(response, oauth ? "Reddit OAuth search response" : "Reddit public JSON search response") as Promise<RedditListing>;
}

async function parseJsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown;
    return objectValue(payload) || {};
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
}

async function responseErrorPreview(response: Response): Promise<string> {
  try {
    const preview = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 180);
    return preview ? ` Response preview: ${preview}` : "";
  } catch {
    return "";
  }
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
