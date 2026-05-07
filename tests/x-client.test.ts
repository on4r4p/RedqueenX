import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  tweetCountRecent: vi.fn(),
  tweets: vi.fn()
}));

vi.mock("twitter-api-v2", () => ({
  TwitterApi: vi.fn(function TwitterApi() {
    return {
      v2: {
        search: mocks.search,
        tweetCountRecent: mocks.tweetCountRecent,
        tweets: mocks.tweets
      }
    };
  })
}));

import { XApiClient } from "../src/x-client";

describe("XApiClient", () => {
  it("does not drain the X search paginator beyond the requested cap", async () => {
    mocks.search.mockReturnValue(asyncTweetPaginator(25));
    const client = new XApiClient({ bearerToken: "test-bearer" });

    const tweets = await client.searchRecent("security", 10, "minimal");

    expect(tweets).toHaveLength(10);
    expect(tweets.map((tweet) => tweet.id)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(mocks.search).toHaveBeenCalledWith("security", expect.objectContaining({ max_results: 10 }));
  });
});

function asyncTweetPaginator(count: number) {
  return {
    includes: {},
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < count; index += 1) {
        yield {
          id: String(index),
          text: `security tweet ${index} with enough useful detail for testing`,
          lang: "en",
          author_id: `author-${index}`,
          public_metrics: {
            retweet_count: index,
            like_count: index
          }
        };
      }
    }
  };
}
