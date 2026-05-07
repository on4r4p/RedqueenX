import { describe, expect, it } from "vitest";
import { webrtcCandidateExtractorSource } from "../src/diagnostics/vpn";
import {
  buildBrowserSearchQuery,
  buildBrowserSearchUrl,
  extractHashtags,
  extractMentions,
  snapshotToTweetCandidate,
  visibleTweetExtractorSource
} from "../src/worker/browserSearch";
import { nextMouseProfile } from "../src/worker/humanPacing";

describe("browser search helpers", () => {
  it("builds one-keyword X Latest web search URLs without OR grouping", () => {
    const url = new URL(buildBrowserSearchUrl("mimikatz", "https://x.com/search", { includeRetweetFilter: true }));
    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("mimikatz -filter:retweets");
    expect(url.searchParams.get("q")).not.toContain(" OR ");
    expect(url.searchParams.get("f")).toBe("live");
  });

  it("omits the X retweet filter when it is not requested by browser search options", () => {
    expect(buildBrowserSearchQuery("cloudflare")).toBe("cloudflare");
    const url = new URL(buildBrowserSearchUrl("cloudflare", "https://x.com/search"));
    expect(url.searchParams.get("q")).toBe("cloudflare");
    expect(url.searchParams.get("q")).not.toContain("-filter:retweets");
    expect(url.searchParams.get("f")).toBe("live");
  });

  it("maps visible DOM snapshots into TweetCandidate scoring input", () => {
    const tweet = snapshotToTweetCandidate({
      id: "12345",
      text: "Exploit writeup for #infosec by @researcher https://example.test",
      authorHandle: "@alice",
      authorName: "Alice",
      avatarUrl: "https://pbs.twimg.com/profile_images/avatar.jpg",
      createdAt: "2026-05-04T10:00:00.000Z",
      retweetCount: 12,
      favoriteCount: 34,
      media: [{ type: "photo", url: "https://pbs.twimg.com/media/a.jpg" }]
    });

    expect(tweet).toMatchObject({
      id: "12345",
      text: expect.stringContaining("Exploit writeup"),
      retweetCount: 12,
      favoriteCount: 34,
      user: {
        screenName: "@alice",
        name: "Alice",
        profileImageUrl: "https://pbs.twimg.com/profile_images/avatar.jpg"
      }
    });
    expect(tweet.createdAt?.toISOString()).toBe("2026-05-04T10:00:00.000Z");
    expect(tweet.entities?.hashtags).toEqual(["infosec"]);
    expect(tweet.entities?.mentions).toEqual(["researcher"]);
    expect(tweet.entities?.urls).toEqual(["https://example.test"]);
    expect(tweet.entities?.media?.[0]?.url).toBe("https://pbs.twimg.com/media/a.jpg");
  });

  it("keeps the browser DOM extractor valid as standalone page JavaScript", () => {
    expect(() => new Function(visibleTweetExtractorSource)).not.toThrow();
  });

  it("keeps the WebRTC diagnostics extractor valid as standalone page JavaScript", () => {
    expect(() => new Function(webrtcCandidateExtractorSource)).not.toThrow();
  });

  it("extracts hashtags and mentions and rotates mouse profiles", () => {
    expect(extractHashtags("#a #a #B")).toEqual(["a", "B"]);
    expect(extractMentions("@one text @two @one")).toEqual(["one", "two"]);
    expect(nextMouseProfile("smooth1", "smooth1")).toBe("smooth2");
    expect(nextMouseProfile("smooth2", "smooth1")).toBe("smooth1");
  });
});
