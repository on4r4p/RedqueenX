import { describe, expect, it } from "vitest";
import { webrtcCandidateExtractorSource } from "../src/diagnostics/vpn";
import {
  buildBrowserSearchQuery,
  buildBrowserSearchUrl,
  detectManualVerificationFromState,
  extractHashtags,
  extractMentions,
  sameManualVerificationDetection,
  snapshotToTweetCandidate,
  visibleTweetExtractorSource
} from "../src/worker/browserSearch";
import { nextMouseProfile } from "../src/worker/humanPacing";
import { isEmojiMediaUrl } from "../src/tweetMedia";

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
      lang: "es-MX",
      createdAt: "2026-05-04T10:00:00.000Z",
      retweetCount: 12,
      favoriteCount: 34,
      media: [
        {
          type: "photo",
          url: "https://abs-0.twimg.com/emoji/v2/svg/1f447.svg",
          previewImageUrl: "https://abs-0.twimg.com/emoji/v2/svg/1f447.svg",
          altText: "👇"
        },
        { type: "photo", url: "https://pbs.twimg.com/media/a.jpg" }
      ]
    });

    expect(tweet).toMatchObject({
      id: "12345",
      text: expect.stringContaining("Exploit writeup"),
      retweetCount: 12,
      favoriteCount: 34,
      lang: "es",
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
    expect(tweet.entities?.media).toHaveLength(1);
    expect(tweet.entities?.media?.[0]?.url).toBe("https://pbs.twimg.com/media/a.jpg");
  });

  it("recognizes X emoji image URLs without treating normal media as emoji", () => {
    expect(isEmojiMediaUrl("https://abs-0.twimg.com/emoji/v2/svg/1f447.svg")).toBe(true);
    expect(isEmojiMediaUrl("https://abs.twimg.com/emoji/v2/72x72/1f447.png")).toBe(true);
    expect(isEmojiMediaUrl("https://pbs.twimg.com/media/real-photo.jpg")).toBe(false);
    expect(isEmojiMediaUrl("https://abs.twimg.com/hashflags/test-image.png")).toBe(false);
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

  it("does not create a manual verification alert from tweet text content", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search?q=captcha&f=live",
        visibleText: "Home Latest A tweet talking about captcha and something went wrong in an app.",
        nonTweetVisibleText: "Home Latest Search filters",
        articleCount: 3,
        tweetTextCount: 3
      })
    ).toBeNull();
  });

  it("does not treat bundled script hashes as visible 2FA prompts", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search",
        visibleText: "To view keyboard shortcuts, press question mark",
        nonTweetVisibleText: "To view keyboard shortcuts window.__chunk='f2fa7a'",
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("does not treat technical 2FA feature flags as a visible two-factor prompt", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search",
        visibleText: "To view keyboard shortcuts, press question mark",
        nonTweetVisibleText:
          'To view keyboard shortcuts window.__INITIAL_STATE__ {"2fa_temporary_password_enabled":false,"verification_code_feature_enabled":true}',
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("classifies X blocking pages before technical 2FA substrings", () => {
    const detected = detectManualVerificationFromState({
      url: "https://x.com/search",
      visibleText: "Something went wrong. Try reloading.",
      nonTweetVisibleText:
        'Something went wrong. Try reloading. window.__INITIAL_STATE__ {"2fa_temporary_password_enabled":false,"verification_code_feature_enabled":true}',
      articleCount: 0,
      tweetTextCount: 0
    });

    expect(detected).toMatchObject({ type: "x_blocked" });
  });

  it("does not treat sidebar news mentioning 2FA as an X two-factor prompt", () => {
    const text =
      "To view keyboard shortcuts, press question mark Home Explore Top Latest People Media Lists Search filters Advanced search Today’s News Google Threat Intelligence Group identifies first AI-generated zero-day exploit bypassing 2FA in popular open-source web administration tool 3 hours ago · News · 1,027 posts Terms of Service Privacy Policy";

    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search?q=from%3Amy_name_is_fer&src=typed_query&f=live",
        visibleText: text,
        nonTweetVisibleText: text,
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("does not trigger manual verification from technical detector substrings", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search",
        visibleText: "To view keyboard shortcuts, press question mark",
        nonTweetVisibleText:
          "To view keyboard shortcuts captchaHandler recaptchav2 f2fa7a verifyAccount unusualHash sign-in-to-x somethingwentwrong tryreloading",
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("does not create a challenge from unrelated visible words on the same page", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search",
        visibleText: "Verify your email preferences. Account security article. Unusual weather trending.",
        nonTweetVisibleText: "Verify your email preferences. Account security article. Unusual weather trending.",
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("does not create a CAPTCHA alert from reCAPTCHA mentioned in X news/sidebar text", () => {
    const text = [
      "To view keyboard shortcuts, press question mark",
      "Home",
      "Explore",
      "Top",
      "Latest",
      "Search filters",
      "Advanced search",
      "Today's News",
      "Google's Cloud Fraud Defense reCAPTCHA Update Blocks Users of DeGoogled Android Phones like GrapheneOS from Websites",
      "Trending now - News - 580 posts"
    ].join("\n");

    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search?q=%40kapitanluffy&src=typed_query&f=live",
        visibleText: text,
        nonTweetVisibleText: text,
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("does not treat recoverable X search-shell retry prompts as a session alert", () => {
    const searchShellText = [
      "Home",
      "Explore",
      "Notifications",
      "Post",
      "Blue king",
      "@Blueking561857",
      "Top",
      "Latest",
      "People",
      "Media",
      "Lists",
      "See new posts",
      "Something went wrong. Try reloading.",
      "Retry",
      "Search filters",
      "People",
      "From anyone",
      "Location",
      "Anywhere",
      "Advanced search"
    ].join("\n");

    const detected =
      detectManualVerificationFromState({
        url: "https://x.com/search?q=csrf+exploit&src=typed_query&f=live",
        visibleText: searchShellText,
        nonTweetVisibleText: searchShellText,
        articleCount: 0,
        tweetTextCount: 0
      });

    expect(detected).toBeNull();
  });

  it("detects generic X search failures from non-tweet text", () => {
    const detected = detectManualVerificationFromState({
      url: "https://x.com/search?q=test&f=live",
      visibleText: "Something went wrong. Try reloading.",
      nonTweetVisibleText: "Something went wrong. Try reloading.",
      articleCount: 0,
      tweetTextCount: 0
    });

    expect(detected).toMatchObject({ type: "x_blocked" });
    expect(detected?.signals.join(" ")).toContain("excluding tweet articles");
  });

  it("detects the X privacy-extension blocking page from non-tweet text", () => {
    const text =
      "Something went wrong, but don't fret — let's give it another shot. Try again Some privacy related extensions may cause issues on x.com. Please disable them and try again.";

    const detected = detectManualVerificationFromState({
      url: "https://x.com/search",
      visibleText: text,
      nonTweetVisibleText: text,
      articleCount: 0,
      tweetTextCount: 0
    });

    expect(detected).toMatchObject({ type: "x_blocked" });
    expect(detected?.signals.join(" ")).toContain("privacy-extension");
    expect(detected?.signals.join(" ")).toContain("excluding tweet articles");
  });

  it("can confirm the same X blocking alert after a refresh retry", () => {
    const text =
      "Something went wrong, but don't fret — let's give it another shot. Try again Some privacy related extensions may cause issues on x.com. Please disable them and try again.";
    const first = detectManualVerificationFromState({
      url: "https://x.com/search",
      visibleText: text,
      nonTweetVisibleText: text,
      articleCount: 0,
      tweetTextCount: 0
    });
    const second = detectManualVerificationFromState({
      url: "https://x.com/search",
      visibleText: text,
      nonTweetVisibleText: text,
      articleCount: 0,
      tweetTextCount: 0
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(sameManualVerificationDetection(first!, second!)).toBe(true);
  });

  it("does not create a manual verification alert from an empty X app shell snapshot", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search",
        visibleText: "",
        nonTweetVisibleText: "",
        articleCount: 0,
        tweetTextCount: 0
      })
    ).toBeNull();
  });

  it("still detects real two-factor wording in visible page text", () => {
    const detected = detectManualVerificationFromState({
      url: "https://x.com/account/access",
      visibleText: "Enter your 2FA code to continue.",
      nonTweetVisibleText: "Enter your 2FA code to continue.",
      articleCount: 0,
      tweetTextCount: 0
    });

    expect(detected?.type).toBe("two_factor");
  });

  it("still detects real CAPTCHA, login, and challenge wording in visible page text", () => {
    expect(
      detectManualVerificationFromState({
        url: "https://x.com/account/access",
        visibleText: "Complete this CAPTCHA to continue.",
        nonTweetVisibleText: "Complete this CAPTCHA to continue.",
        articleCount: 0,
        tweetTextCount: 0
      })?.type
    ).toBe("captcha");

    expect(
      detectManualVerificationFromState({
        url: "https://x.com/search",
        visibleText: "Log in to X to continue.",
        nonTweetVisibleText: "Log in to X to continue.",
        articleCount: 0,
        tweetTextCount: 0
      })?.type
    ).toBe("login_expired");

    expect(
      detectManualVerificationFromState({
        url: "https://x.com/account/access",
        visibleText: "Verify your account to continue.",
        nonTweetVisibleText: "Verify your account to continue.",
        articleCount: 0,
        tweetTextCount: 0
      })?.type
    ).toBe("challenge");
  });

  it("reports exact manual verification detection signals from non-tweet page text", () => {
    const detected = detectManualVerificationFromState({
      url: "https://x.com/account/access",
      visibleText: "Access to your account has been temporarily restricted.",
      nonTweetVisibleText: "Access to your account has been temporarily restricted.",
      articleCount: 0,
      tweetTextCount: 0
    });

    expect(detected).toMatchObject({
      type: "x_blocked",
      pageState: {
        articleCount: 0,
        tweetTextCount: 0
      }
    });
    expect(detected?.signals.join(" ")).toContain("explicit account access");
    expect(detected?.signals.join(" ")).toContain("excluding tweet articles");
  });
});
