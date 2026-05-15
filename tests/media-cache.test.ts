import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MediaCacheService } from "../src/admin/mediaCacheService";
import { TimelineTweetService } from "../src/admin/timelineTweetService";
import { openMemoryDatabase } from "../src/db/database";
import type { ScoreDecision, TweetCandidate } from "../src/types";

describe("media cache", () => {
  it("does not expose remote media URLs to timeline clients", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const database = openMemoryDatabase();
    const timeline = new TimelineTweetService(database);
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 24,
      maxBytes: 10 * 1024 * 1024,
      maxFileBytes: 1024 * 1024
    });

    timeline.saveAcceptedFromTest("cloudflare", testTweet(), testDecision());
    const raw = timeline.find("2050000000000000001");
    expect(raw).not.toBeNull();

    const missing = mediaCache.decorateTimelineItem(raw!);
    expect(missing.avatarUrl).toBeNull();
    expect(missing.avatarCache.cacheStatus).toBe("missing");
    expect(missing.media[0].cacheStatus).toBe("missing");
    expect(missing.media[0].cachedUrl).toBeNull();
    expect(JSON.stringify(missing)).not.toContain("pbs.twimg.com");

    const sourceUrl = testTweet().entities!.media![0].url!;
    const localPath = path.join(tmp, "cached-image.jpg");
    fs.writeFileSync(localPath, "image-bytes");
    mediaCache.upsertSuccess(sourceUrl, localPath, "image/jpeg", 11);

    const cached = mediaCache.decorateTimelineItem(raw!);
    expect(cached.media[0].cacheStatus).toBe("cached");
    expect(cached.media[0].cachedUrl).toMatch(/^\/media-cache\/[a-f0-9]{32}$/);
    expect(JSON.stringify(cached)).not.toContain(sourceUrl);
    expect(JSON.stringify(cached)).not.toContain("pbs.twimg.com");
  });

  it("keeps cached media indefinitely when ttl is zero", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const database = openMemoryDatabase();
    const timeline = new TimelineTweetService(database);
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 0,
      maxBytes: 10 * 1024 * 1024,
      maxFileBytes: 1024 * 1024
    });

    timeline.saveAcceptedFromTest("cloudflare", testTweet(), testDecision());
    const raw = timeline.find("2050000000000000001")!;
    const sourceUrl = testTweet().entities!.media![0].url!;
    const localPath = path.join(tmp, "expired-image.jpg");
    fs.writeFileSync(localPath, "image-bytes");
    mediaCache.upsertSuccess(sourceUrl, localPath, "image/jpeg", 11);

    const cached = mediaCache.decorateTimelineItem(raw);
    expect(cached.media[0].cacheStatus).toBe("cached");
    expect(cached.media[0].cachedUrl).toMatch(/^\/media-cache\/[a-f0-9]{32}$/);
    expect(mediaCache.getServeableEntry(mediaCache.cacheIdForUrl(sourceUrl))).not.toBeNull();
  });

  it("refuses to serve cache entries whose local path escapes the cache directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const outside = path.join(os.tmpdir(), `redqueen-outside-${Date.now()}.jpg`);
    const database = openMemoryDatabase();
    const timeline = new TimelineTweetService(database);
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 24,
      maxBytes: 10 * 1024 * 1024,
      maxFileBytes: 1024 * 1024
    });

    timeline.saveAcceptedFromTest("cloudflare", testTweet(), testDecision());
    const raw = timeline.find("2050000000000000001")!;
    const sourceUrl = testTweet().entities!.media![0].url!;
    fs.writeFileSync(outside, "image-bytes");
    mediaCache.upsertSuccess(sourceUrl, outside, "image/jpeg", 11);

    const decorated = mediaCache.decorateTimelineItem(raw);
    expect(decorated.media[0].cacheStatus).toBe("expired");
    expect(decorated.media[0].cachedUrl).toBeNull();
    expect(mediaCache.getServeableEntry(mediaCache.cacheIdForUrl(sourceUrl))).toBeNull();

    fs.rmSync(outside, { force: true });
  });

  it("marks expired or failed media without serving a stale remote URL", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const database = openMemoryDatabase();
    const timeline = new TimelineTweetService(database);
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 0.000001,
      maxBytes: 10 * 1024 * 1024,
      maxFileBytes: 1024 * 1024
    });

    timeline.saveAcceptedFromTest("cloudflare", testTweet(), testDecision());
    const raw = timeline.find("2050000000000000001")!;
    const sourceUrl = testTweet().entities!.media![0].url!;
    const localPath = path.join(tmp, "expired-image.jpg");
    fs.writeFileSync(localPath, "image-bytes");
    mediaCache.upsertSuccess(sourceUrl, localPath, "image/jpeg", 11, new Date(Date.now() - 60_000));

    const expired = mediaCache.decorateTimelineItem(raw);
    expect(expired.media[0].cacheStatus).toBe("expired");
    expect(expired.media[0].cachedUrl).toBeNull();
    expect(mediaCache.getServeableEntry(mediaCache.cacheIdForUrl(sourceUrl))).toBeNull();

    mediaCache.upsertFailure(sourceUrl, "HTTP 403 while downloading media.");
    const failed = mediaCache.decorateTimelineItem(raw);
    expect(failed.media[0].cacheStatus).toBe("error");
    expect(failed.media[0].lastError).toContain("HTTP 403");
    expect(JSON.stringify(failed)).not.toContain(sourceUrl);
  });

  it("finds timeline tweets with retryable failed media cache sources", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const database = openMemoryDatabase();
    const timeline = new TimelineTweetService(database);
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 24,
      maxBytes: 10 * 1024 * 1024,
      maxFileBytes: 1024 * 1024
    });
    const tweet: TweetCandidate = {
      ...testTweet(),
      id: "2050000000000000002",
      entities: {
        ...testTweet().entities,
        media: [
          {
            type: "photo",
            url: "https://abs.twimg.com/hashflags/test-image.png",
            previewImageUrl: "https://abs.twimg.com/hashflags/test-image.png"
          }
        ]
      }
    };

    timeline.saveAcceptedFromTest("cloudflare", tweet, testDecision());
    mediaCache.upsertFailure("https://abs.twimg.com/hashflags/test-image.png", "Refusing non-X media host abs.twimg.com.");

    expect(mediaCache.tweetIdsForFailedSourceError("Refusing non-X media host abs.twimg.com.", "abs.twimg.com")).toEqual([
      "2050000000000000002"
    ]);
  });

  it("prunes expired and over-quota cache files", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const database = openMemoryDatabase();
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 24,
      maxBytes: 12,
      maxFileBytes: 1024 * 1024
    });

    const first = path.join(tmp, "first.jpg");
    const second = path.join(tmp, "second.jpg");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(first, "1234567890");
    fs.writeFileSync(second, "1234567890");
    mediaCache.upsertSuccess("https://pbs.twimg.com/media/first.jpg", first, "image/jpeg", 10, new Date(Date.now() - 1_000));
    mediaCache.upsertSuccess("https://pbs.twimg.com/media/second.jpg", second, "image/jpeg", 10, new Date());

    const result = await mediaCache.prune();
    expect(result.overQuota).toBe(1);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(true);
  });

  it("skips cache quota pruning when max bytes is zero", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-media-cache-"));
    const database = openMemoryDatabase();
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: tmp,
      ttlHours: 24,
      maxBytes: 0,
      maxFileBytes: 1024 * 1024
    });

    const first = path.join(tmp, "first.jpg");
    const second = path.join(tmp, "second.jpg");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(first, "1234567890");
    fs.writeFileSync(second, "1234567890");
    mediaCache.upsertSuccess("https://pbs.twimg.com/media/first.jpg", first, "image/jpeg", 10);
    mediaCache.upsertSuccess("https://pbs.twimg.com/media/second.jpg", second, "image/jpeg", 10);

    const result = await mediaCache.prune();
    expect(result.overQuota).toBe(0);
    expect(fs.existsSync(first)).toBe(true);
    expect(fs.existsSync(second)).toBe(true);
    expect(result.bytesAfter).toBe(20);
  });
});

function testDecision(): ScoreDecision {
  return { accepted: true, score: 42, reasons: [], normalizedText: "cloudflare test tweet with visible media" };
}

function testTweet(): TweetCandidate {
  return {
    id: "2050000000000000001",
    text: "Cloudflare test tweet with visible media",
    createdAt: new Date("2026-05-05T10:00:00.000Z"),
    retweetCount: 2,
    favoriteCount: 3,
    user: {
      screenName: "@tester",
      name: "Tester",
      profileImageUrl: "https://pbs.twimg.com/profile_images/tester/avatar.jpg"
    },
    entities: {
      media: [
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/test-image.jpg",
          previewImageUrl: "https://pbs.twimg.com/media/test-image.jpg",
          altText: "test image"
        }
      ],
      urls: ["https://example.test/post"],
      hashtags: [],
      mentions: []
    }
  };
}
