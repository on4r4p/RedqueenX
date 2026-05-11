import { describe, expect, it } from "vitest";
import { ListService } from "../src/admin/listService";
import { LegacyTimelineService } from "../src/admin/legacyTimeline";
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
