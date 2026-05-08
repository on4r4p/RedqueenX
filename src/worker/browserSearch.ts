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
  pageState: ManualVerificationPageState;
}

export interface ManualVerificationPageState {
  url: string;
  visibleText: string;
  nonTweetVisibleText: string;
  articleCount: number;
  tweetTextCount: number;
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
  const state = await readManualVerificationPageState(page);
  return detectManualVerificationFromState(state);
}

export function detectManualVerificationFromState(state: ManualVerificationPageState): ManualVerificationDetection | null {
  const url = state.url;
  const text = state.nonTweetVisibleText.toLowerCase();
  const detected = (type: ManualVerificationType, reason: string, signal: string): ManualVerificationDetection => ({
    type,
    reason,
    signals: [signal, `Detection source: page text excluding tweet articles.`, `Tweet articles visible: ${state.articleCount}.`],
    pageState: state
  });
  if (isLoginExpiredPage(url, text)) {
    return detected("login_expired", "The X browser session is no longer logged in.", "URL or visible text matched X login flow.");
  }
  if (hasCaptchaText(text)) {
    return detected("captcha", "X displayed a CAPTCHA or CAPTCHA-related verification.", "Visible page text matched CAPTCHA wording.");
  }
  if (hasTwoFactorText(text)) {
    return detected("two_factor", "X requested two-factor verification.", "Visible page text matched two-factor or verification-code wording.");
  }
  if (hasManualChallengeText(text)) {
    return detected("challenge", "X requested manual account verification.", "Visible page text matched account/identity verification wording.");
  }
  if (hasXBlockedText(text) && !isRecoverableSearchResultError(url, text)) {
    return detected("x_blocked", "X returned a blocking error page: Something went wrong.", "Visible page text matched 'Something went wrong' or 'Try reloading'.");
  }
  return null;
}

async function readManualVerificationPageState(page: Page): Promise<ManualVerificationPageState> {
  const url = page.url();
  const fallbackVisibleText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const domState = await page
    .evaluate(() => {
      const doc = (globalThis as unknown as { document: any }).document;
      const body = doc.body;
      const visibleText = body?.innerText || body?.textContent || "";
      const clone = body?.cloneNode(true);
      clone
        ?.querySelectorAll('article[data-testid="tweet"], script, style, noscript, template, svg')
        .forEach((node: any) => node.remove());
      return {
        visibleText,
        nonTweetVisibleText: clone?.innerText || clone?.textContent || "",
        articleCount: doc.querySelectorAll('article[data-testid="tweet"]').length,
        tweetTextCount: doc.querySelectorAll('[data-testid="tweetText"]').length
      };
    })
    .catch(() => ({
      visibleText: fallbackVisibleText,
      nonTweetVisibleText: fallbackVisibleText,
      articleCount: 0,
      tweetTextCount: 0
    }));

  return {
    url,
    visibleText: normalizeDetectorText(domState.visibleText ?? fallbackVisibleText),
    nonTweetVisibleText: normalizeDetectorText(domState.nonTweetVisibleText ?? fallbackVisibleText),
    articleCount: domState.articleCount,
    tweetTextCount: domState.tweetTextCount
  };
}

function hasTwoFactorText(text: string): boolean {
  return /\b(?:two[-\s]?factor|2fa)\b|\bverification\s+code\b/.test(text);
}

function isLoginExpiredPage(url: string, text: string): boolean {
  return url.includes("/i/flow/login") || /\b(?:sign|log)\s+in\s+to\s+x\b/.test(text);
}

function hasCaptchaText(text: string): boolean {
  return /\b(?:captcha|recaptcha|hcaptcha)\b/.test(text);
}

function hasManualChallengeText(text: string): boolean {
  return (
    /\b(?:verify|confirm|authenticate|validate)\s+(?:your\s+)?(?:account|identity)\b/.test(text) ||
    /\b(?:account|identity)\s+(?:verification|required|confirmation)\b/.test(text) ||
    /\bunusual\s+(?:login|sign[-\s]?in|activity)\b/.test(text)
  );
}

function hasXBlockedText(text: string): boolean {
  return /\bsomething\s+went\s+wrong\b|\btry\s+reloading\b/.test(text);
}

function isRecoverableSearchResultError(url: string, text: string): boolean {
  if (!url.includes("/search")) {
    return false;
  }
  return (
    /\btop\s+latest\s+people\s+media\s+lists\b/.test(text) &&
    /\bsearch\s+filters\b/.test(text) &&
    /\badvanced\s+search\b/.test(text)
  );
}

function normalizeDetectorText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
