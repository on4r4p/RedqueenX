import type { Page } from "playwright-core";
import type { TweetCandidate, TweetMedia } from "../types";

export type ManualVerificationType =
  | "captcha"
  | "two_factor"
  | "challenge"
  | "login_expired"
  | "x_blocked"
  | "unknown_auth_problem";

export interface ManualVerificationDetection {
  type: ManualVerificationType;
  reason: string;
  signals: string[];
}

export interface VisibleTweetSnapshot {
  id: string;
  text: string;
  authorHandle: string;
  authorName?: string;
  avatarUrl?: string;
  createdAt?: string;
  retweetCount?: number;
  favoriteCount?: number;
  media?: TweetMedia[];
}

export interface BrowserSearchUrlOptions {
  includeRetweetFilter?: boolean;
}

export function buildBrowserSearchQuery(keyword: string, options: BrowserSearchUrlOptions = {}): string {
  return options.includeRetweetFilter ? `${keyword} -filter:retweets` : keyword;
}

export function buildBrowserSearchUrl(keyword: string, startUrl = "https://x.com/search", options: BrowserSearchUrlOptions = {}): string {
  const url = new URL(startUrl || "https://x.com/search");
  url.search = "";
  url.searchParams.set("q", buildBrowserSearchQuery(keyword, options));
  url.searchParams.set("src", "typed_query");
  url.searchParams.set("f", "live");
  return url.toString();
}

export const visibleTweetExtractorSource = String.raw`
    const doc = globalThis.document;
    const articles = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
    const compactNumber = (value) => {
      if (!value) return 0;
      const normalized = value.replace(/,/g, "").trim().toLowerCase();
      const match = normalized.match(/(\d+(?:\.\d+)?)\s*([kmb])?/);
      if (!match) return 0;
      const number = Number(match[1]);
      const suffix = match[2];
      if (suffix === "k") return Math.round(number * 1_000);
      if (suffix === "m") return Math.round(number * 1_000_000);
      if (suffix === "b") return Math.round(number * 1_000_000_000);
      return Math.round(number);
    };
    const metricValue = (article, testId) => {
      const metric = article.querySelector('[data-testid="' + testId + '"]');
      const aria = metric?.getAttribute("aria-label") ?? "";
      if (aria) return compactNumber(aria);
      return compactNumber(metric?.textContent ?? "");
    };
    const statusLink = (article) =>
      Array.from(article.querySelectorAll('a[href*="/status/"]')).find((link) =>
        /\/[^/]+\/status\/\d+/.test(link.getAttribute("href") ?? "")
      );
    const tweetText = (article) =>
      Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
        .map((node) => node.textContent ?? "")
        .join("\n")
        .trim();
    const profileImage = (article) =>
      Array.from(article.querySelectorAll("img")).find((img) => img.src.includes("profile_images"))?.src;
    const mediaItems = (article) =>
      Array.from(article.querySelectorAll('img[src]:not([src*="profile_images"])'))
        .map((img) => ({
          type: "photo",
          url: img.src,
          previewImageUrl: img.src,
          altText: img.alt || undefined,
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined
        }))
        .filter((media) => media.url);

    return articles
      .map((article) => {
        const link = statusLink(article);
        const href = link?.getAttribute("href") ?? "";
        const id = href.match(/\/status\/(\d+)/)?.[1] ?? "";
        const authorHandle = href.match(/^\/([^/]+)\/status\//)?.[1] ?? "";
        const text = tweetText(article);
        const time = article.querySelector("time")?.getAttribute("datetime") ?? undefined;
        const authorName = article.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || undefined;
        return {
          id,
          text,
          authorHandle: authorHandle ? "@" + authorHandle : "",
          authorName,
          avatarUrl: profileImage(article),
          createdAt: time,
          retweetCount: metricValue(article, "retweet"),
          favoriteCount: metricValue(article, "like"),
          media: mediaItems(article)
        };
      })
      .filter((tweet) => tweet.id && tweet.text);
`;

export async function extractVisibleTweets(page: Page): Promise<TweetCandidate[]> {
  const snapshots = (await page.evaluate(new Function(visibleTweetExtractorSource) as () => VisibleTweetSnapshot[])) as VisibleTweetSnapshot[];

  return snapshots.map(snapshotToTweetCandidate);
}

export async function detectManualVerification(page: Page): Promise<ManualVerificationDetection | null> {
  const url = page.url();
  const visibleText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const text = visibleText.toLowerCase();
  const detected = (type: ManualVerificationType, reason: string, signal: string): ManualVerificationDetection => ({
    type,
    reason,
    signals: [signal]
  });
  if (url.includes("/i/flow/login") || text.includes("sign in to x") || text.includes("log in to x")) {
    return detected("login_expired", "The X browser session is no longer logged in.", "URL or visible text matched X login flow.");
  }
  if (text.includes("captcha")) {
    return detected("captcha", "X displayed a CAPTCHA or CAPTCHA-related verification.", "Visible page text contained 'captcha'.");
  }
  if (text.includes("two-factor") || text.includes("2fa") || text.includes("verification code")) {
    return detected("two_factor", "X requested two-factor verification.", "Visible page text matched two-factor or verification-code wording.");
  }
  if (text.includes("verify") && (text.includes("account") || text.includes("identity") || text.includes("unusual"))) {
    return detected("challenge", "X requested manual account verification.", "Visible page text matched account/identity verification wording.");
  }
  if (text.includes("something went wrong") || text.includes("try reloading")) {
    return detected("x_blocked", "X returned a blocking error page: Something went wrong.", "Visible page text matched 'Something went wrong' or 'Try reloading'.");
  }
  return null;
}

export function extractHashtags(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/#([A-Za-z0-9_]+)/g)).map((match) => match[1])));
}

export function extractMentions(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/@([A-Za-z0-9_]+)/g)).map((match) => match[1])));
}

export function extractUrls(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/https?:\/\/\S+/g)).map((match) => match[0])));
}

export function snapshotToTweetCandidate(snapshot: VisibleTweetSnapshot): TweetCandidate {
  return {
    id: snapshot.id,
    text: snapshot.text,
    createdAt: snapshot.createdAt ? new Date(snapshot.createdAt) : undefined,
    retweetCount: snapshot.retweetCount ?? 0,
    favoriteCount: snapshot.favoriteCount ?? 0,
    user: {
      screenName: snapshot.authorHandle || "@unknown",
      name: snapshot.authorName,
      profileImageUrl: snapshot.avatarUrl
    },
    entities: {
      hashtags: extractHashtags(snapshot.text),
      mentions: extractMentions(snapshot.text),
      urls: extractUrls(snapshot.text),
      media: snapshot.media ?? []
    }
  };
}
