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
});
