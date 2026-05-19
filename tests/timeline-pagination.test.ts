import { describe, expect, it } from "vitest";
import { ListService } from "../src/admin/listService";
import { LegacyTimelineService } from "../src/admin/legacyTimeline";
import { TimelineItemService } from "../src/admin/timelineItemService";
import { TimelineTweetService } from "../src/admin/timelineTweetService";
import { openMemoryDatabase } from "../src/db/database";

describe("timeline pagination", () => {
  it("paginates accepted tweets before legacy timeline entries", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const runtime = new TimelineTweetService(database);
    const timeline = new LegacyTimelineService(database);
    const decision = { accepted: true, score: 10, reasons: ["test"], normalizedText: "accepted" };

    runtime.saveAccepted("xss", { id: "tweet-1", text: "accepted one", user: { screenName: "@one" } }, decision);
    runtime.saveAccepted("rce", { id: "tweet-2", text: "accepted two", user: { screenName: "@two" } }, decision);
    lists.add("text_sent", "legacy one", "uploaded:Text.Sent", 1);
    lists.add("text_sent", "legacy two", "uploaded:Text.Sent", 2);

    const page = timeline.page({ limit: 2, offset: 1 });

    expect(page).toMatchObject({
      total: 4,
      limit: 2,
      offset: 1,
      hasMore: true
    });
    expect(page.items.map((item) => item.source)).toEqual(["tweet", "legacy"]);
  });

  it("paginates timeline sources by their display date instead of source blocks", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const external = new TimelineItemService(database);
    const runtime = new TimelineTweetService(database);
    const timeline = new LegacyTimelineService(database);
    const decision = { accepted: true, score: 10, reasons: ["test"], normalizedText: "accepted" };

    external.save({
      source: "rss",
      externalId: "rss-1",
      keyword: "malware",
      title: "RSS item",
      text: "RSS item about malware",
      itemUrl: "https://feed.example/1",
      acceptedAt: "2026-05-18T10:00:00.000Z"
    });
    runtime.saveAccepted("xss", { id: "tweet-1", text: "accepted one", user: { screenName: "@one" } }, decision);
    lists.add("text_sent", "legacy one", "uploaded:Text.Sent", 1);

    const page = timeline.page({ limit: 3, offset: 0 });

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.source)).toEqual(["tweet", "rss", "legacy"]);
  });

  it("filters timeline items by source", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const external = new TimelineItemService(database);
    const runtime = new TimelineTweetService(database);
    const timeline = new LegacyTimelineService(database);
    const decision = { accepted: true, score: 10, reasons: ["test"], normalizedText: "accepted" };

    external.save({ source: "rss", externalId: "rss-1", text: "rss item", acceptedAt: "2026-05-18T09:00:00.000Z" });
    runtime.saveAccepted("xss", { id: "tweet-1", text: "accepted one", user: { screenName: "@one" } }, decision);
    lists.add("text_sent", "legacy rss https://feed.example/1", "runtime:rss:https://feed.example/rss", 1);
    lists.add("text_sent", "legacy one", "uploaded:Text.Sent", 2);

    expect(timeline.page({ sources: ["tweet"], limit: 10 }).items.map((item) => item.source)).toEqual(["tweet"]);
    expect(timeline.page({ sources: ["rss"], limit: 10 }).items.map((item) => item.source)).toEqual(["rss", "rss"]);
  });

  it("archives timeline items without deleting their rows", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const external = new TimelineItemService(database);
    const runtime = new TimelineTweetService(database);
    const timeline = new LegacyTimelineService(database);
    const decision = { accepted: true, score: 10, reasons: ["test"], normalizedText: "accepted" };

    external.save({ source: "rss", externalId: "rss-1", text: "rss item", acceptedAt: "2026-05-18T09:00:00.000Z" });
    runtime.saveAccepted("xss", { id: "tweet-1", text: "accepted one", user: { screenName: "@one" } }, decision);
    lists.add("text_sent", "legacy one", "uploaded:Text.Sent", 1);

    const archived = timeline.archiveAll(["tweet", "rss"], "2026-05-19T10:00:00.000Z");

    expect(archived).toEqual({ tweets: 1, items: 1, legacy: 1 });
    expect(timeline.page({ limit: 10 }).items).toEqual([]);
    expect(timeline.page({ archived: true, limit: 10 }).items.map((item) => item.source).sort()).toEqual(["legacy", "rss", "tweet"]);
    expect(database.prepare("SELECT COUNT(*) AS total FROM timeline_tweets").get()).toEqual({ total: 1 });
    expect(database.prepare("SELECT COUNT(*) AS total FROM timeline_items").get()).toEqual({ total: 1 });
    expect(database.prepare("SELECT COUNT(*) AS total FROM list_entries WHERE kind = 'text_sent'").get()).toEqual({ total: 1 });

    const restored = timeline.restoreAll(["tweet", "rss"]);

    expect(restored).toEqual({ tweets: 1, items: 1, legacy: 1 });
    expect(timeline.page({ archived: true, limit: 10 }).items).toEqual([]);
    expect(timeline.page({ limit: 10 }).items.map((item) => item.source).sort()).toEqual(["legacy", "rss", "tweet"]);
  });

  it("exposes luck factor reasons for accepted tweets", () => {
    const database = openMemoryDatabase();
    const runtime = new TimelineTweetService(database);
    const decision = {
      accepted: true,
      score: 6,
      reasons: ["banned_word:spam", "luck_factor:1/200"],
      normalizedText: "accepted by luck factor"
    };

    runtime.saveAccepted(
      "malware",
      { id: "lucky-tweet", text: "accepted by luck factor", user: { screenName: "@lucky" } },
      decision
    );

    expect(runtime.latest(1)[0]).toMatchObject({
      tweetId: "lucky-tweet",
      keyword: "malware",
      reasons: ["banned_word:spam", "luck_factor:1/200"]
    });
  });

  it("does not expose X emoji images as accepted tweet media", () => {
    const database = openMemoryDatabase();
    const runtime = new TimelineTweetService(database);
    const decision = { accepted: true, score: 10, reasons: ["test"], normalizedText: "emoji media" };

    runtime.saveAccepted(
      "tools",
      {
        id: "emoji-tweet",
        text: "👇 useful tools",
        user: { screenName: "@emoji" },
        entities: {
          media: [
            {
              type: "photo",
              url: "https://abs-0.twimg.com/emoji/v2/svg/1f447.svg",
              previewImageUrl: "https://abs-0.twimg.com/emoji/v2/svg/1f447.svg",
              altText: "👇"
            }
          ]
        }
      },
      decision
    );

    expect(runtime.find("emoji-tweet")?.media).toEqual([]);

    database
      .prepare("UPDATE timeline_tweets SET media_json = ? WHERE tweet_id = ?")
      .run(
        JSON.stringify([
          {
            type: "photo",
            url: "https://abs.twimg.com/emoji/v2/72x72/1f447.png",
            previewImageUrl: "https://abs.twimg.com/emoji/v2/72x72/1f447.png",
            altText: "👇"
          }
        ]),
        "emoji-tweet"
      );

    expect(runtime.find("emoji-tweet")?.media).toEqual([]);
  });
});
