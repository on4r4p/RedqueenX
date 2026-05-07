import { TwitterApi } from "twitter-api-v2";

export interface XWriteCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
}

export class XActionClient {
  private readonly client: TwitterApi;
  private userId: string | null = null;

  constructor(credentials: XWriteCredentials) {
    if (!credentials.apiKey || !credentials.apiSecret || !credentials.accessToken || !credentials.accessSecret) {
      throw new Error("X API key/secret and access token/secret are required for write actions.");
    }

    this.client = new TwitterApi({
      appKey: credentials.apiKey,
      appSecret: credentials.apiSecret,
      accessToken: credentials.accessToken,
      accessSecret: credentials.accessSecret
    });
  }

  async like(tweetId: string): Promise<void> {
    await this.client.v2.like(await this.loggedUserId(), tweetId);
  }

  async retweet(tweetId: string): Promise<void> {
    await this.client.v2.retweet(await this.loggedUserId(), tweetId);
  }

  private async loggedUserId(): Promise<string> {
    if (this.userId) {
      return this.userId;
    }
    const me = await this.client.v2.me();
    this.userId = me.data.id;
    return this.userId;
  }
}
