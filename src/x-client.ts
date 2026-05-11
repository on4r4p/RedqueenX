import { TwitterApi } from "twitter-api-v2";
import type { TweetCandidate, TweetMedia } from "./types";

export type XSearchMode = "minimal" | "detailed";

export interface XUserProfile {
  id: string;
  username: string;
  name?: string;
  protected?: boolean;
}

export interface XSearchClient {
  countRecent(query: string): Promise<number>;
  searchRecent(query: string, maxResults: number, mode?: XSearchMode): Promise<TweetCandidate[]>;
  lookupTweetsDetailed(tweetIds: string[]): Promise<TweetCandidate[]>;
  lookupUserByUsername?(username: string): Promise<XUserProfile | null>;
  userTimeline?(userId: string, maxResults: number, mode?: XSearchMode): Promise<TweetCandidate[]>;
}

export interface XClientOptions {
  bearerToken?: string;
}

export class XApiClient implements XSearchClient {
  private readonly client: TwitterApi;

  constructor(options: XClientOptions) {
    if (!options.bearerToken) {
      throw new Error("X_BEARER_TOKEN is required for X API search.");
    }
    this.client = new TwitterApi(options.bearerToken);
  }

  async countRecent(query: string): Promise<number> {
    const result = await this.client.v2.tweetCountRecent(query);
    return (result as any).meta?.total_tweet_count ?? 0;
  }

  async searchRecent(query: string, maxResults: number, mode: XSearchMode = "detailed"): Promise<TweetCandidate[]> {
    const cappedMaxResults = Math.max(10, Math.min(maxResults, 100));
    const results = await this.client.v2.search(query, {
      max_results: cappedMaxResults,
      ...tweetFieldsForMode(mode)
    });

    const tweets: any[] = [];
    for await (const tweet of results) {
      tweets.push(tweet);
      if (tweets.length >= cappedMaxResults) {
        break;
      }
    }

    return mapTweets(tweets, results.includes);
  }

  async lookupTweetsDetailed(tweetIds: string[]): Promise<TweetCandidate[]> {
    if (!tweetIds.length) {
      return [];
    }
    const result = await this.client.v2.tweets(tweetIds, tweetFieldsForMode("detailed"));
    return mapTweets((result as any).data ?? [], (result as any).includes);
  }

  async lookupUserByUsername(username: string): Promise<XUserProfile | null> {
    const result = await this.client.v2.userByUsername(username, {
      "user.fields": ["username", "name", "protected"]
    });
    const user = (result as any)?.data;
    if (!user?.id || !user?.username) {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      protected: user.protected
    };
  }

  async userTimeline(userId: string, maxResults: number, mode: XSearchMode = "detailed"): Promise<TweetCandidate[]> {
    const cappedMaxResults = Math.max(5, Math.min(maxResults, 100));
    const results = await this.client.v2.userTimeline(userId, {
      max_results: cappedMaxResults,
      ...tweetFieldsForMode(mode)
    });

    const tweets: any[] = [];
    for await (const tweet of results) {
      tweets.push(tweet);
      if (tweets.length >= cappedMaxResults) {
        break;
      }
    }

    return mapTweets(tweets, results.includes);
  }
}

function tweetFieldsForMode(mode: XSearchMode): Record<string, string[]> {
  if (mode === "minimal") {
    return {
      "tweet.fields": ["created_at", "lang", "public_metrics", "entities", "author_id"]
    };
  }

  return {
    "tweet.fields": ["created_at", "lang", "public_metrics", "entities", "author_id", "attachments"],
    expansions: ["author_id", "attachments.media_keys"],
    "media.fields": ["type", "url", "preview_image_url", "alt_text", "width", "height", "variants"],
    "user.fields": ["username", "name", "description", "public_metrics", "verified", "profile_image_url"]
  };
}

function mapTweets(tweets: any[], includes: any = {}): TweetCandidate[] {
  const users = new Map<string, any>();
  for (const user of includes?.users ?? []) {
    users.set(user.id, user);
  }
  const medias = new Map<string, any>();
  for (const media of includes?.media ?? []) {
    medias.set(media.media_key, media);
  }

  return tweets.map((tweet) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    return {
      id: tweet.id,
      text: tweet.text,
      lang: tweet.lang,
      createdAt: tweet.created_at ? new Date(tweet.created_at) : undefined,
      retweetCount: tweet.public_metrics?.retweet_count,
      favoriteCount: tweet.public_metrics?.like_count,
      user: {
        screenName: user?.username ?? tweet.author_id ?? "unknown",
        name: user?.name,
        description: user?.description,
        followersCount: user?.public_metrics?.followers_count,
        verified: user?.verified,
        profileImageUrl: user?.profile_image_url
      },
      entities: {
        hashtags: tweet.entities?.hashtags?.map((tag: any) => tag.tag),
        mentions: tweet.entities?.mentions?.map((mention: any) => mention.username),
        urls: tweet.entities?.urls?.map((url: any) => url.expanded_url ?? url.url),
        media: (tweet.attachments?.media_keys ?? [])
          .map((key: string) => medias.get(key))
          .filter(Boolean)
          .map(mapMedia)
      }
    };
  });
}

function mapMedia(media: any): TweetMedia {
  return {
    type: media.type,
    url: media.url,
    previewImageUrl: media.preview_image_url,
    videoUrl: bestVideoUrl(media.variants),
    altText: media.alt_text,
    width: media.width,
    height: media.height
  };
}

function bestVideoUrl(variants: any[] | undefined): string | undefined {
  return variants
    ?.filter((variant) => variant.content_type === "video/mp4" && variant.url)
    .sort((left, right) => (right.bit_rate ?? 0) - (left.bit_rate ?? 0))[0]?.url;
}
