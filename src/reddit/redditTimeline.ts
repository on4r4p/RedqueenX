import type { CurrentSessionLevel } from "../admin/currentSessionService";
import type { TimelineItemService } from "../admin/timelineItemService";
import { isHandleSearchKeyword } from "../text";
import type { RedditCrawler, RedditPost } from "./redditCrawler";

const redditTextMaxCharacters = 700;

export interface RedditSearchResult {
  searchedKeywords: number;
  skippedHandleKeywords: number;
  savedPosts: number;
  failedKeywords: number;
}

export async function crawlRedditKeywords(options: {
  runId: string;
  keywords: string[];
  crawler: RedditCrawler;
  timelineItems: TimelineItemService;
  record: (level: CurrentSessionLevel, type: string, message: string, data?: Record<string, unknown>) => Promise<void>;
}): Promise<RedditSearchResult> {
  let searchedKeywords = 0;
  let skippedHandleKeywords = 0;
  let savedPosts = 0;
  let failedKeywords = 0;

  for (const keyword of options.keywords) {
    if (isHandleSearchKeyword(keyword)) {
      skippedHandleKeywords += 1;
      continue;
    }

    searchedKeywords += 1;
    try {
      const posts = await options.crawler.searchKeyword(keyword);
      for (const post of posts) {
        options.timelineItems.save(redditPostToTimelineItem(post));
        savedPosts += 1;
      }
      await options.record("debug", "reddit.keyword.completed", "Reddit keyword search completed", {
        runId: options.runId,
        keyword,
        posts: posts.length
      });
    } catch (error) {
      failedKeywords += 1;
      await options.record("prob", "reddit.keyword.failed", error instanceof Error ? error.message : "Reddit keyword search failed", {
        runId: options.runId,
        keyword
      });
    }
  }

  if (searchedKeywords > 0 || skippedHandleKeywords > 0) {
    await options.record("info", "reddit.search.completed", "Reddit crawl completed", {
      runId: options.runId,
      searchedKeywords,
      skippedHandleKeywords,
      savedPosts,
      failedKeywords
    });
  }

  return { searchedKeywords, skippedHandleKeywords, savedPosts, failedKeywords };
}

function redditPostToTimelineItem(post: RedditPost) {
  return {
    source: "reddit" as const,
    externalId: post.id,
    keyword: post.keyword,
    title: post.title,
    text: truncateRedditText(post.text, post.title),
    author: `u/${post.author}`,
    authorName: `r/${post.subreddit}`,
    itemUrl: post.permalink,
    externalCreatedAt: post.createdAt.toISOString(),
    score: post.score,
    engagementScore: post.score,
    commentsCount: post.commentsCount,
    reasons: ["reddit_crawl"],
    media: post.media,
    urls: [post.url, post.permalink].filter((url, index, urls) => url && urls.indexOf(url) === index),
    metadata: {
      subreddit: post.subreddit,
      commentsCount: post.commentsCount
    }
  };
}

function truncateRedditText(text: string, title: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const titleLength = title && normalized !== title ? title.length + 1 : 0;
  const maxTextCharacters = Math.max(80, redditTextMaxCharacters - titleLength);
  if (normalized.length <= maxTextCharacters) {
    return normalized;
  }
  return `${normalized.slice(0, maxTextCharacters - 3).trimEnd()}...`;
}
