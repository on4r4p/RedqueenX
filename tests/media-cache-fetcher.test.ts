import { describe, expect, it } from "vitest";
import { assertAllowedXMediaSource } from "../src/worker/mediaCacheFetcher";

describe("media cache fetcher host guard", () => {
  it("allows known X/Twimg media hosts", () => {
    expect(() => assertAllowedXMediaSource("https://pbs.twimg.com/media/test.jpg")).not.toThrow();
    expect(() => assertAllowedXMediaSource("https://video.twimg.com/ext_tw_video/test.mp4")).not.toThrow();
    expect(() => assertAllowedXMediaSource("https://ton.twimg.com/test")).not.toThrow();
    expect(() => assertAllowedXMediaSource("https://abs.twimg.com/hashflags/test.png")).not.toThrow();
  });

  it("rejects non-X hosts and non-HTTPS URLs", () => {
    expect(() => assertAllowedXMediaSource("https://example.com/media.jpg")).toThrow("Refusing non-X media host example.com.");
    expect(() => assertAllowedXMediaSource("http://pbs.twimg.com/media/test.jpg")).toThrow("Only HTTPS X media URLs are allowed.");
  });
});
