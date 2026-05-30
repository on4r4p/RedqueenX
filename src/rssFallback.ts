import crypto from "node:crypto";
import { ListService } from "./admin/listService";
import type { CurrentSessionLevel } from "./admin/currentSessionService";
import type { TimelineItemService } from "./admin/timelineItemService";
import { RssClient, type RssItem } from "./rss-client";
import type { ListEntry } from "./types";

export interface RssFallbackResult {
  feeds: number;
  savedItems: number;
  failedFeeds: number;
}

export interface RssFallbackOptions {
  runId: string;
  lists: ListService;
  feedLimit: number;
  reason: string;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
  rssClient?: Pick<RssClient, "fetch">;
  timelineItems?: TimelineItemService;
}

export async function runRssFallback(options: RssFallbackOptions): Promise<RssFallbackResult> {
  const feeds = activePrioritizedRssFeeds(options.lists).slice(0, options.feedLimit);
  if (!feeds.length) {
    await options.record("prob", "rss.fallback.empty", "No RSS feeds available for fallback", {
      runId: options.runId,
      reason: options.reason
    });
    return { feeds: 0, savedItems: 0, failedFeeds: 0 };
  }

  const rssClient = options.rssClient ?? new RssClient();
  let savedItems = 0;
  let failedFeeds = 0;
  await options.record("info", "rss.fallback.started", "RSS fallback started", {
    runId: options.runId,
    reason: options.reason,
    feeds: feeds.length,
    configuredLimit: options.feedLimit
  });

  for (const feed of feeds) {
    try {
      const items = await rssClient.fetch(feed);
      const importedAt = new Date().toISOString();
      for (const item of items) {
        saveRssItem(options.lists, options.timelineItems, feed, item, importedAt);
        savedItems += 1;
      }
      await options.record("debug", "rss.feed.completed", "RSS feed fetched", {
        runId: options.runId,
        reason: options.reason,
        feed,
        items: items.length
      });
    } catch (error) {
      failedFeeds += 1;
      await options.record("prob", "rss.feed.failed", error instanceof Error ? error.message : "RSS fetch failed", {
        runId: options.runId,
        reason: options.reason,
        feed
      });
    }
  }

  await options.record("info", "rss.fallback.completed", "RSS fallback completed", {
    runId: options.runId,
    reason: options.reason,
    feeds: feeds.length,
    savedItems,
    failedFeeds
  });

  return { feeds: feeds.length, savedItems, failedFeeds };
}

export function prioritizeLikelyRssFeeds(feeds: string[]): string[] {
  return feeds
    .map((feed, index) => ({ feed, index, score: rssFeedScore(feed, null) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ feed }) => feed);
}

function activePrioritizedRssFeeds(lists: ListService): string[] {
  return lists
    .list("rss_feed")
    .filter((entry) => !entry.isDeleted && !entry.isEmpty)
    .map((entry, index) => ({
      feed: entry.rawValue,
      index,
      score: rssFeedScore(entry.rawValue, entry)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ feed }) => feed);
}

function rssFeedScore(feed: string, entry: Pick<ListEntry, "sourceFile"> | null): number {
  let url: URL;
  try {
    url = new URL(feed);
  } catch {
    return 0;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  const sourceFile = entry?.sourceFile?.toLowerCase() ?? "";
  let score = 0;
  if (sourceFile === "manual:hacking-rss") score += 24;
  if (sourceFile.endsWith("rq.rss")) score += 12;
  if (url.protocol === "https:") score += 2;
  if (hostname === "rss.packetstormsecurity.com" || hostname.startsWith("feeds.") || hostname.startsWith("rss.")) score += 8;
  if (pathname.includes("/feed") || pathname.includes("/rss") || pathname.includes("/atom")) score += 8;
  if (pathname.endsWith(".xml") || pathname.endsWith(".rss") || pathname.endsWith(".atom")) score += 8;
  if (hostname.includes("feedburner.com")) score += 8;
  if (hostname === "go.theregister.co.uk" || pathname.includes("feed-sponsor")) score -= 8;
  if (pathname.includes("/news/view/") || pathname.includes("/files/") || pathname.includes("/archive/")) score -= 6;
  return score;
}

function saveRssItem(lists: ListService, timelineItems: TimelineItemService | undefined, feed: string, item: RssItem, importedAt: string): void {
  const source = `runtime:rss:${feed}`;
  const acceptedAt = item.publishedAt ?? importedAt;
  lists.add("rss_sent", item.link, source, null, importedAt);
  if (!timelineItems) {
    lists.add("text_sent", `${item.title} ${item.link}`.trim(), source, null, importedAt);
    return;
  }
  timelineItems.save({
    source: "rss",
    externalId: crypto.createHash("sha256").update(item.link || `${feed}:${item.title}`).digest("hex"),
    keyword: null,
    title: item.title,
    text: item.title,
    authorName: feed,
    itemUrl: item.link,
    externalCreatedAt: item.publishedAt ?? null,
    score: 0,
    engagementScore: 0,
    commentsCount: 0,
    reasons: ["rss_fallback"],
    urls: item.link ? [item.link] : [],
    metadata: { feed },
    acceptedAt
  });
}
