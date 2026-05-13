import { setTimeout as delay } from "node:timers/promises";
import type { Page, Response } from "playwright-core";
import type { TweetCandidate, TweetMedia } from "../types";
import { mediaWithoutEmojiImages } from "../tweetMedia";

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
  lang?: string;
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

export interface BrowserNavigationRetryEvent {
  url: string;
  attempt: number;
  maxAttempts: number;
  retryDelayMs: number;
  error: string;
}

type BrowserGotoOptions = NonNullable<Parameters<Page["goto"]>[1]>;

export async function gotoWithTransientRetry(
  page: Page,
  url: string,
  gotoOptions: BrowserGotoOptions = {},
  retryOptions: {
    attempts?: number;
    retryDelayMs?: number;
    onRetry?: (event: BrowserNavigationRetryEvent) => Promise<void> | void;
  } = {}
): Promise<Response | null> {
  const maxAttempts = Math.max(1, Math.floor(retryOptions.attempts ?? 3));
  const retryDelayMs = Math.max(0, Math.floor(retryOptions.retryDelayMs ?? 2_000));
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await page.goto(url, gotoOptions);
    } catch (error) {
      lastError = error;
      if (!isTransientBrowserNavigationError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await retryOptions.onRetry?.({
        url,
        attempt,
        maxAttempts,
        retryDelayMs,
        error: error instanceof Error ? error.message : String(error)
      });
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function isTransientBrowserNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_(?:CERT_VERIFIER_CHANGED|NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|INTERNET_DISCONNECTED|TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED)\b/i.test(
    message
  );
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
    const tweetLang = (article) => {
      const textNodes = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
      for (const node of textNodes) {
        const directLang = node.getAttribute("lang");
        if (directLang && directLang.toLowerCase() !== "und") return directLang.toLowerCase();
        const childLang = Array.from(node.querySelectorAll("[lang]"))
          .map((child) => child.getAttribute("lang"))
          .find((value) => value && value.toLowerCase() !== "und");
        if (childLang) return childLang.toLowerCase();
      }
      return undefined;
    };
    const profileImage = (article) =>
      Array.from(article.querySelectorAll("img")).find((img) => img.src.includes("profile_images"))?.src;
    const isEmojiImage = (img) => {
      if (img.closest('[data-testid="tweetText"]')) return true;
      try {
        const url = new URL(img.src);
        const hostname = url.hostname.toLowerCase();
        const pathname = url.pathname.toLowerCase();
        return (
          ((hostname === "abs.twimg.com" || hostname.endsWith(".twimg.com")) && /\/emoji\/v\d+\//.test(pathname)) ||
          hostname.includes("twemoji") ||
          pathname.includes("/twemoji/")
        );
      } catch {
        return false;
      }
    };
    const mediaItems = (article) =>
      Array.from(article.querySelectorAll('img[src]:not([src*="profile_images"])'))
        .filter((img) => !isEmojiImage(img))
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
          lang: tweetLang(article),
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
  const rawText = state.nonTweetVisibleText;
  const text = rawText.toLowerCase();
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
  if (hasXPrivacyExtensionBlockText(text)) {
    return detected("x_blocked", "X returned a blocking error page mentioning privacy-related extensions.", "Visible page text matched X privacy-extension blocking wording.");
  }
  if (hasXBlockedText(text) && !isRecoverableShellError(state)) {
    return detected("x_blocked", "X returned a blocking error page: Something went wrong.", "Visible page text matched 'Something went wrong' or 'Try again/reloading'.");
  }
  if (hasTwoFactorText(text)) {
    return detected("two_factor", "X requested two-factor verification.", "Visible page text matched user-facing two-factor or verification-code wording.");
  }
  if (hasManualChallengeText(text)) {
    return detected("challenge", "X requested manual account verification.", "Visible page text matched account/identity verification wording.");
  }
  if (hasExplicitXAccessBlockText(text)) {
    return detected("x_blocked", "X returned an explicit account access blocking page.", "Visible page text matched explicit account access blocking wording.");
  }
  return null;
}

export function sameManualVerificationDetection(
  first: Pick<ManualVerificationDetection, "type" | "reason">,
  second: Pick<ManualVerificationDetection, "type" | "reason">
): boolean {
  return first.type === second.type && first.reason === second.reason;
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
  return (
    /\btwo[-\s]?factor\s+(?:authentication|verification)\b.{0,80}\b(?:required|needed|continue|confirm|verify|enter|input|type|provide|submit|use)\b/.test(
      text
    ) ||
    /\b(?:required|needed|continue|confirm|verify|enter|input|type|provide|submit|use)\b.{0,80}\btwo[-\s]?factor\s+(?:authentication|verification)\b/.test(
      text
    ) ||
    /\b(?:enter|input|type|provide|submit|use)\b.{0,80}\b(?:2fa|two[-\s]?factor|verification|authentication|login|security)\s+code\b/.test(text) ||
    /\b(?:verification|authentication|login|security)\s+code\b.{0,80}\b(?:enter|input|type|provide|submit|required|sent|text|email|authenticator|phone)\b/.test(text) ||
    /\b(?:we|x)\s+(?:sent|emailed|texted)\b.{0,80}\bcode\b/.test(text) ||
    /\bcheck\s+(?:your\s+)?(?:phone|email|authenticator\s+app)\b.{0,80}\bcode\b/.test(text) ||
    /\b(?:2fa|two[-\s]?factor)\s+code\b/.test(text)
  );
}

function isLoginExpiredPage(url: string, text: string): boolean {
  return url.includes("/i/flow/login") || /\b(?:sign|log)\s+in\s+to\s+x\b/.test(text);
}

function hasCaptchaText(text: string): boolean {
  if (!/\b(?:captcha|recaptcha|hcaptcha)\b/.test(text)) {
    return false;
  }
  return (
    /\b(?:complete|solve|pass|verify|verification|required|challenge|security|continue|human|robot|automated)\b.{0,80}\b(?:captcha|recaptcha|hcaptcha)\b/.test(text) ||
    /\b(?:captcha|recaptcha|hcaptcha)\b.{0,80}\b(?:complete|solve|pass|verify|verification|required|challenge|security|continue|human|robot|automated)\b/.test(text) ||
    /\b(?:are\s+you\s+a\s+robot|verify\s+(?:you(?:'|’)?re|that\s+you\s+are)\s+human|confirm\s+you\s+are\s+human)\b/.test(text)
  );
}

function hasManualChallengeText(text: string): boolean {
  return (
    /\b(?:verify|confirm|authenticate|validate)\s+(?:your\s+)?(?:account|identity)\b/.test(text) ||
    /\b(?:account|identity)\s+(?:verification|required|confirmation)\b/.test(text) ||
    /\bunusual\s+(?:login|sign[-\s]?in|activity)\b/.test(text)
  );
}

function hasExplicitXAccessBlockText(text: string): boolean {
  return (
    /\baccount\s+(?:is\s+)?(?:temporarily\s+)?(?:locked|restricted|limited|blocked|suspended)\b/.test(text) ||
    /\bwe(?:'|’)?ve\s+(?:temporarily\s+)?(?:locked|restricted|limited|blocked)\s+(?:your\s+)?account\b/.test(text) ||
    /\baccess\s+to\s+(?:this|your)\s+account\s+(?:has\s+been\s+)?(?:temporarily\s+)?(?:restricted|limited|blocked|suspended)\b/.test(text) ||
    /\bautomated\s+(?:requests|behavior|activity)\b/.test(text)
  );
}

function hasXBlockedText(text: string): boolean {
  return /\bsomething\s+went\s+wrong\b|\btry\s+(?:again|reloading)\b/.test(text);
}

function isRecoverableShellError(state: ManualVerificationPageState): boolean {
  const normalizedText = normalizeDetectorText(state.nonTweetVisibleText).toLowerCase();
  if (!/\bsomething\s+went\s+wrong\b|\btry\s+reloading\b/.test(normalizedText)) {
    return false;
  }

  if (state.url.includes("/search")) {
    const searchShellSignals = [
      /\bsearch\s*filters\b/,
      /\badvanced\s*search\b/,
      /\bpeople\s*from\s*anyone\b/,
      /\btop\s*latest\s*people\s*media\s*lists\b/,
      /\bsee\s*new\s*posts\b/,
      /\bwho\s*to\s*follow\b/
    ];
    if (searchShellSignals.filter((pattern) => pattern.test(normalizedText)).length >= 2) {
      return true;
    }
  }

  if (state.articleCount <= 0 || !isLoadedXAppShell(normalizedText)) {
    return false;
  }

  const sidebarSignals = [
    /\bsubscribe\s+to\s+premium\b/,
    /\bwhat(?:'|’)s\s+happening\b/,
    /\bwho\s+to\s+follow\b/,
    /\btrending\s+in\b/
  ];
  return sidebarSignals.some((pattern) => pattern.test(normalizedText));
}

function isLoadedXAppShell(text: string): boolean {
  const shellSignals = [/\bhome\b/, /\bexplore\b/, /\bnotifications\b/, /\bprofile\b/, /\bfor\s+you\b/, /\bfollowing\b/];
  return shellSignals.filter((pattern) => pattern.test(text)).length >= 3;
}

function hasXPrivacyExtensionBlockText(text: string): boolean {
  return (
    /\bsomething\s+went\s+wrong\b/.test(text) &&
    /\btry\s+again\b/.test(text) &&
    /\bprivacy\s+related\s+extensions?\b/.test(text) &&
    /\bdisable\s+them\s+and\s+try\s+again\b/.test(text)
  );
}

function normalizeDetectorText(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
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
    lang: normalizeSnapshotLang(snapshot.lang),
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
      media: mediaWithoutEmojiImages(snapshot.media)
    }
  };
}

function normalizeSnapshotLang(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "und") return undefined;
  return normalized.split("-")[0];
}
