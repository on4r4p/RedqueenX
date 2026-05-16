import { describe, expect, it } from "vitest";
import {
  isTweetOlderThanDays,
  applyKeywordUserStartIndex,
  isMissingKeywordUserText,
  isProtectedPostsText,
  isSuspendedAccountText,
  keywordUserCandidates,
  planKeywordUserCandidates,
  planResumeKeywordUserCandidates,
  tweetAgeDays
} from "../src/worker/staleKeywordUserPruner";

describe("stale keyword user pruner helpers", () => {
  it("keeps only unique @ keyword users and builds from: searches", () => {
    expect(keywordUserCandidates(["cve", "@Alice", " @alice ", "@bob", "bob", "@"])).toEqual([
      { keyword: "@Alice", handle: "alice", searchQuery: "from:alice" },
      { keyword: "@bob", handle: "bob", searchQuery: "from:bob" }
    ]);
  });

  it("separates @ keyword users already parked as stale so interrupted runs do not recheck them", () => {
    expect(planKeywordUserCandidates(["@Alice", "@bob", "@carol"], ["alice", "@Carol"])).toEqual({
      candidates: [{ keyword: "@bob", handle: "bob", searchQuery: "from:bob" }],
      alreadyStaleCandidates: [
        { keyword: "@Alice", handle: "alice", searchQuery: "from:alice" },
        { keyword: "@carol", handle: "carol", searchQuery: "from:carol" }
      ]
    });
  });

  it("skips @ keyword users already checked in the same cleanup resume state", () => {
    const candidates = keywordUserCandidates(["@Alice", "@bob", "@carol"]);

    expect(planResumeKeywordUserCandidates(candidates, [{ handle: "alice" }, "@Carol"])).toEqual({
      candidates: [{ keyword: "@bob", handle: "bob", searchQuery: "from:bob" }],
      alreadyCheckedCandidates: [
        { keyword: "@Alice", handle: "alice", searchQuery: "from:alice" },
        { keyword: "@carol", handle: "carol", searchQuery: "from:carol" }
      ]
    });
  });

  it("starts @ keyword cleanup from a 1-based candidate index", () => {
    const candidates = keywordUserCandidates(["@Alice", "@bob", "@carol"]);

    expect(applyKeywordUserStartIndex(candidates, 2)).toEqual({
      candidates: [
        { keyword: "@bob", handle: "bob", searchQuery: "from:bob" },
        { keyword: "@carol", handle: "carol", searchQuery: "from:carol" }
      ],
      alreadyCheckedCandidates: [{ keyword: "@Alice", handle: "alice", searchQuery: "from:alice" }]
    });
  });

  it("compares latest tweet age against the configured day threshold", () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const oldTweet = new Date("2026-05-01T11:59:59.000Z");
    const recentTweet = new Date("2026-05-08T12:00:00.000Z");

    expect(Number(tweetAgeDays(oldTweet, now).toFixed(2))).toBe(9);
    expect(isTweetOlderThanDays(oldTweet, 7, now)).toBe(true);
    expect(isTweetOlderThanDays(recentTweet, 7, now)).toBe(false);
  });

  it("recognizes protected posts pages so they can be removed from keywords without skipped noise", () => {
    expect(
      isProtectedPostsText(
        "These posts are protected Only approved followers can see @virusstopper's posts. To request access, click Follow."
      )
    ).toBe(true);
    expect(isProtectedPostsText("Something went wrong. Try reloading. Retry")).toBe(false);
  });

  it("recognizes missing user pages so removed accounts can be moved to stale users", () => {
    expect(isMissingKeywordUserText("This account doesn’t exist Try searching for another.")).toBe(true);
    expect(isMissingKeywordUserText("User not found")).toBe(true);
    expect(isMissingKeywordUserText("Latest posts from an active account")).toBe(false);
  });

  it("recognizes suspended account pages so suspended @keywords can be moved to stale users", () => {
    expect(isSuspendedAccountText("Account suspended X suspends accounts which violate the X Rules")).toBe(true);
    expect(isSuspendedAccountText("This active account posts security research")).toBe(false);
  });
});
