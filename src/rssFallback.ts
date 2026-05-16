import { ListService } from "./admin/listService";
import type { CurrentSessionLevel } from "./admin/currentSessionService";
import { RssClient, type RssItem } from "./rss-client";

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
}

export async function runRssFallback(options: RssFallbackOptions): Promise<RssFallbackResult> {
  const feeds = options.lists.activeValues("rss_feed").slice(0, options.feedLimit);
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
        saveRssItem(options.lists, feed, item, importedAt);
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

function saveRssItem(lists: ListService, feed: string, item: RssItem, importedAt: string): void {
  const source = `runtime:rss:${feed}`;
  lists.add("rss_sent", item.link, source, null, importedAt);
  lists.add("text_sent", `${item.title} ${item.link}`.trim(), source, null, importedAt);
}
