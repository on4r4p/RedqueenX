import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAdminApi } from "../src/admin/api";
import { openMemoryDatabase } from "../src/db/database";
import { parseRunStats, RunService } from "../src/admin/runService";
import { ListService } from "../src/admin/listService";
import { TimelineItemService } from "../src/admin/timelineItemService";
import { TimelineTweetService } from "../src/admin/timelineTweetService";
import { XBrowserAccountService } from "../src/admin/xBrowserAccountService";
import { XSessionAlertService } from "../src/admin/xSessionAlertService";
import { loadConfig } from "../src/config";

function authHeadersFromSetCookie(setCookie: string | string[] | number | undefined): Record<string, string> {
  const values = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [String(setCookie)];
  const cookiePairs = values.map((value) => value.split(";")[0]).filter(Boolean);
  const csrfPair = cookiePairs.find((value) => value.startsWith("redqueen_csrf="));
  const csrfToken = csrfPair?.slice("redqueen_csrf=".length);
  return {
    cookie: cookiePairs.join("; "),
    ...(csrfToken ? { "x-redqueenx-csrf": decodeURIComponent(csrfToken) } : {})
  };
}

describe("admin api", () => {
  it("trusts client-certificate proxy auth without exposing admin login", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-api-mtls-"));
    const config = loadConfig({
      ADMIN_AUTH_MODE: "mtls_proxy",
      ADMIN_MTLS_PROXY_SECRET: "proxy-secret",
      ADMIN_TRUST_PROXY: "true",
      SESSION_SECRET: "test-session-secret",
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      CURRENT_SESSION_FILE: path.join(tmp, "current-session.log"),
      X_API_ENABLED: "true"
    });
    const database = openMemoryDatabase();
    const app = createAdminApi({
      database,
      config,
      envPath: path.join(tmp, ".env"),
      currentSessionFilePath: path.join(tmp, "current-session.log")
    });

    const adminDenied = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { accept: "text/html" }
    });
    expect(adminDenied.statusCode).toBe(403);

    const adminPage = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { accept: "text/html", "x-redqueenx-mtls-proxy-secret": "proxy-secret" }
    });
    expect(adminPage.statusCode).toBe(200);

    const invalidRequest = await app.inject({
      method: "GET",
      url: "/admin/lists/keyword?limit=bad",
      headers: { "x-redqueenx-mtls-proxy-secret": "proxy-secret" }
    });
    expect(invalidRequest.statusCode).toBe(400);
    expect(invalidRequest.body).toContain("Invalid request payload.");
    expect(invalidRequest.body).not.toContain("ZodError");

    const loginPage = await app.inject({ method: "GET", url: "/admin/login" });
    expect(loginPage.statusCode).toBe(404);

    const loginPost = await app.inject({
      method: "POST",
      url: "/admin/login",
      payload: { username: "admin", password: "secret" }
    });
    expect(loginPost.statusCode).toBe(404);

    const serverAccess = await app.inject({
      method: "GET",
      url: "/admin/settings/server-access",
      headers: { "x-redqueenx-mtls-proxy-secret": "proxy-secret" }
    });
    expect(serverAccess.statusCode).toBe(200);
    expect(serverAccess.json().disabled).toBe(true);

    await app.close();
  });

  it("blocks mTLS proxy auth without a shared secret from public remote addresses", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-api-mtls-source-"));
    const config = loadConfig({
      ADMIN_AUTH_MODE: "mtls_proxy",
      ADMIN_TRUST_PROXY: "true",
      SESSION_SECRET: "test-session-secret",
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      CURRENT_SESSION_FILE: path.join(tmp, "current-session.log"),
      X_API_ENABLED: "true"
    });
    const database = openMemoryDatabase();
    const app = createAdminApi({
      database,
      config,
      envPath: path.join(tmp, ".env"),
      currentSessionFilePath: path.join(tmp, "current-session.log")
    });

    const publicRemote = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { accept: "text/html" },
      remoteAddress: "203.0.113.10"
    });
    expect(publicRemote.statusCode).toBe(403);

    const dockerBridgeRemote = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { accept: "text/html" },
      remoteAddress: "172.18.0.1"
    });
    expect(dockerBridgeRemote.statusCode).toBe(200);

    await app.close();
  });

  it("stores concrete keyword batches when a chained run starts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-api-chain-"));
    const currentSessionFilePath = path.join(tmp, "current-session.log");
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    for (const keyword of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
      lists.add("keyword", keyword);
    }
    const app = createAdminApi({
      database,
      config: loadConfig({
        ADMIN_PASSWORD: "secret",
        SESSION_SECRET: "test-session-secret",
        DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
        CURRENT_SESSION_FILE: currentSessionFilePath,
        X_API_ENABLED: "true",
        SEARCH_WITHOUT_API_ENABLED: "false",
        SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT: "2",
        SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM: "false",
        SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER: "false",
        RUN_CHAIN_COUNT: "2"
      }),
      envPath: path.join(tmp, ".env"),
      currentSessionFilePath
    });

    const login = await app.inject({ method: "POST", url: "/admin/login", payload: { username: "admin", password: "secret" } });
    expect(login.statusCode).toBe(200);
    const authHeaders = authHeadersFromSetCookie(login.headers["set-cookie"]);

    const preview = await app.inject({ method: "GET", url: "/admin/runs/preview", headers: authHeaders });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().source).toBe("fresh_preview");
    expect(preview.json().previews.map((item: { sample: string[] }) => item.sample)).toEqual([
      ["alpha", "beta"],
      ["gamma", "delta"],
      ["epsilon"]
    ]);

    const runStart = await app.inject({ method: "POST", url: "/admin/runs", headers: authHeaders });
    expect(runStart.statusCode).toBe(200);
    const runs = new RunService(database);
    const run = runs.latest();
    if (!run) {
      throw new Error("Expected a run to be created.");
    }
    expect(runs.keywords(run.id).map((item) => item.keyword)).toEqual(["alpha", "beta"]);
    expect(parseRunStats(run.statsJson)).toMatchObject({
      runChainTotal: 3,
      runChainIndex: 1,
      runChainRemaining: 2,
      runChainKeywordBatches: [
        ["gamma", "delta"],
        ["epsilon"]
      ]
    });

    const activePreview = await app.inject({ method: "GET", url: "/admin/runs/preview", headers: authHeaders });
    expect(activePreview.statusCode).toBe(200);
    expect(activePreview.json()).toMatchObject({
      source: "active_run",
      run: { id: run.id, status: "running", isCurrent: true },
      runCount: 3
    });
    expect(
      activePreview.json().previews.map((item: { runIndex: number; sample: string[]; status: string }) => ({
        runIndex: item.runIndex,
        sample: item.sample,
        status: item.status
      }))
    ).toEqual([
      { runIndex: 1, sample: ["alpha", "beta"], status: "active" },
      { runIndex: 2, sample: ["gamma", "delta"], status: "queued" },
      { runIndex: 3, sample: ["epsilon"], status: "queued" }
    ]);

    const sessionKeywords = await app.inject({ method: "GET", url: "/admin/session/keywords?limit=1000", headers: authHeaders });
    expect(sessionKeywords.statusCode).toBe(200);
    expect(sessionKeywords.json().chain).toEqual({
      total: 3,
      index: 1,
      remaining: 2,
      queuedRuns: 2,
      queuedKeywords: 3
    });

    await app.close();
  });

  it("protects admin routes and supports login, list mutations, commands, and import", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-api-"));
    fs.writeFileSync(path.join(tmp, "Rq.Keywords"), "one\n\ntwo", "utf8");
    const envPath = path.join(tmp, ".env");
    const restartSignalPath = path.join(tmp, "restart-signal.ts");
    const currentSessionFilePath = path.join(tmp, "current-session.log");
    const oldSignalDate = new Date(1_000);
    fs.writeFileSync(
      envPath,
      "ADMIN_HOST=127.0.0.1\nADMIN_PORT=3005\nADMIN_PASSWORD=secret\nDATABASE_URL=./redqueenx.sqlite\nX_API_ENABLED=true\nENABLE_X_WRITE=false\n",
      "utf8"
    );
    fs.writeFileSync(restartSignalPath, "export {};\n", "utf8");
    fs.utimesSync(restartSignalPath, oldSignalDate, oldSignalDate);

    const database = openMemoryDatabase();
    const timelineService = new TimelineTweetService(database);
    const app = createAdminApi({
      database,
      config: {
        adminPassword: "secret",
        adminPasswordHash: undefined,
        adminTrustProxy: false,
        sessionSecret: "test-session-secret",
        adminIpv4Whitelist: [],
        adminIpv4Blacklist: [],
        legacyDataDir: tmp,
        currentSessionFile: currentSessionFilePath,
        xApiEnabled: true,
        searchWithoutApiEnabled: false,
        searchWithoutApiIsolation: "host_netns",
        searchWithoutApiProfileDir: "./runtime/playwright-profile",
        searchWithoutApiStartUrl: "https://x.com/search",
        searchWithoutApiMaxScrolls: 20,
        searchWithoutApiScrollDelayMs: 1200,
        searchWithoutApiScrollDelayMinMs: 5000,
        searchWithoutApiScrollDelayMaxMs: 12000,
        searchWithoutApiHeadless: false,
        searchWithoutApiShowBrowserLocal: false,
        searchWithoutApiKeyDelayMinMs: 500,
        searchWithoutApiKeyDelayMaxMs: 5000,
        searchWithoutApiSearchDelayMinSeconds: 5,
        searchWithoutApiSearchDelayMaxSeconds: 120,
        searchWithoutApiSessionKeywordLimit: 50,
        searchWithoutApiSessionKeywordLimitRandom: false,
        searchWithoutApiRandomizeKeywordOrder: false,
        searchWithoutApiUserKeywordPercent: 100,
        searchWithoutApiAutoIgnoreAlert: false,
        searchWithoutApiMaxRetries: 3,
        searchWithoutApiAutoRestartDelaySeconds: 10,
        searchWithoutApiRequestsBeforePauseMin: 10,
        searchWithoutApiPauseMinMinutes: 15,
        searchWithoutApiPauseMaxMinutes: 120,
        searchWithoutApiScrollsMin: 0,
        searchWithoutApiScrollsMax: 23,
        searchWithoutApiTweetHoverMinSeconds: 1,
        searchWithoutApiTweetHoverMaxSeconds: 15,
        searchWithoutApiMouseProfile: "smooth1",
        searchWithoutApiSaveSnapshots: false,
        searchWithoutApiMediaCacheEnabled: false,
        searchWithoutApiMediaCacheDir: "./runtime/media-cache",
        searchWithoutApiMediaCacheTtlHours: 24,
        searchWithoutApiMediaCacheMaxMb: 256,
        searchWithoutApiMediaCacheMaxFileMb: 15,
        searchWithoutApiMediaCacheFetchDelayMinMs: 800,
        searchWithoutApiMediaCacheFetchDelayMaxMs: 3000,
        timelineDefaultPageSize: 50,
        runChainCount: 0,
        staleKeywordUserMaxAgeDays: 90,
        staleKeywordUserStartIndex: 1,
        staleKeywordUserActionDelayMinSeconds: 1,
        staleKeywordUserActionDelayMaxSeconds: 5,
        staleKeywordUserAutoIgnoreAlert: false,
        staleKeywordUserMaxRetries: 3,
        staleKeywordUserAutoRestartDelaySeconds: 10,
        rawTimelineEnabled: true,
        xLoginNovncPort: 6080,
        xLoginScreen: "1920x1080x24",
        xLoginServiceMaxSeconds: 1200,
        xLoginBrowser: "chrome",
        xLoginSaveMode: "auto",
        xLoginStartUrl: "https://x.com/login",
        xLoginReuseBrowserProfile: false,
        xLoginSkipNetworkPrecheck: false,
        vpnNetnsName: "redqueenx-vpn",
        vpnHostIface: "",
        vpnNetnsCidr: "10.200.0.0/24",
        vpnNetnsHostIp: "10.200.0.1",
        vpnNetnsGuestIp: "10.200.0.2",
        vpnRemoteHost: "",
        vpnRemotePort: 1194,
        vpnRemoteProto: "udp",
        vpnConfig: "./ops/vpn/custom.conf",
        vpnCheckHostIpv4Leak: true,
        vpnCheckIpv6: true,
        vpnDiagnosticStrict: true,
        vpnDiagnosticPlaywright: true,
        playwrightChromiumExecutablePath: "/usr/bin/chromium",
        playwrightDisableSandbox: true,
        xSearchApiCallLimit: 180,
        xSearchApiWindowMinutes: 15,
        xApiCreditUsd: 12.89,
        xApiTotalCreditUsedUsd: 20.38,
        xDailySpendLimitUsd: 1,
        xRunSpendLimitUsd: 2,
        xMaxSearchesPerDay: 25,
        xMaxPostsReadPerDay: 250,
        xMaxCountCallsPerDay: 500,
        xKeywordsPerQuery: 5,
        xCountFirstMode: true,
        xCostPostReadUsd: 0.005,
        xCostUserReadUsd: 0.01,
        xCostMediaReadUsd: 0.005,
        xCostUserInteractionUsd: 0.015,
        xCostCountCallUsd: 0,
        rssFallbackFeedLimit: 25,
        redditCrawlEnabled: false,
        redditCrawlUserAgent: "RedqueenX/0.1.0",
        redditCrawlSubreddits: ["cybersecurity", "netsec", "blueteamsec", "osint", "privacy"],
        redditCrawlLimitPerKeyword: 10,
        redditCrawlSort: "relevance",
        redditCrawlTimeRange: "month",
        redditCrawlMinScore: 2,
        enableXWrite: false,
        x: {
          apiKey: undefined,
          apiSecret: undefined,
          accessToken: undefined,
          accessSecret: undefined,
          bearerToken: undefined,
          clientId: undefined,
          clientSecret: undefined
        }
      },
      envPath,
      restartSignalPath,
      restartDelayMs: 0,
      currentSessionFilePath
    });

    const denied = await app.inject({ method: "GET", url: "/admin/stats" });
    expect(denied.statusCode).toBe(401);

    const timelineLoginRedirect = await app.inject({
      method: "GET",
      url: "/timeline",
      headers: { accept: "text/html" }
    });
    expect(timelineLoginRedirect.statusCode).toBe(302);
    expect(timelineLoginRedirect.headers.location).toBe("/timeline/login");

    const publicTimelineDataDenied = await app.inject({ method: "GET", url: "/timeline/data" });
    expect(publicTimelineDataDenied.statusCode).toBe(401);

    const stylesheet = await app.inject({ method: "GET", url: "/assets/styles.css" });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers["content-type"]).toContain("text/css");

    const favicon = await app.inject({ method: "GET", url: "/favicon.ico" });
    expect(favicon.statusCode).toBe(200);
    expect(favicon.headers["content-type"]).toContain("image/x-icon");
    expect(favicon.headers["cache-control"]).toContain("no-store");

    const trinityIcon = await app.inject({ method: "GET", url: "/trinity.ico" });
    expect(trinityIcon.statusCode).toBe(200);
    expect(trinityIcon.headers["content-type"]).toContain("image/x-icon");

    const adminPageDenied = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { accept: "text/html" }
    });
    expect(adminPageDenied.statusCode).toBe(302);
    expect(adminPageDenied.headers.location).toBe("/admin/login");

    const login = await app.inject({
      method: "POST",
      url: "/admin/login",
      payload: { username: "admin", password: "secret" }
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toBeDefined();

    const authHeaders = authHeadersFromSetCookie(cookie);
    const persistedEnv = fs.readFileSync(envPath, "utf8");
    expect(persistedEnv).toContain("ADMIN_PASSWORD_HASH=");
    expect(persistedEnv).not.toContain("ADMIN_PASSWORD=secret");

    const mutationWithoutCsrf = await app.inject({
      method: "POST",
      url: "/admin/lists/keyword",
      headers: { cookie: authHeaders.cookie },
      payload: { value: "blocked-without-csrf" }
    });
    expect(mutationWithoutCsrf.statusCode).toBe(403);

    const publicTimeline = await app.inject({ method: "GET", url: "/timeline", headers: authHeaders });
    expect(publicTimeline.statusCode).toBe(200);
    expect(publicTimeline.headers["content-type"]).toContain("text/html");
    expect(publicTimeline.body).toContain("/assets/timeline.js");
    const rawTimeline = await app.inject({ method: "GET", url: "/raw-timeline", headers: authHeaders });
    expect(rawTimeline.statusCode).toBe(200);
    expect(rawTimeline.body).toContain("/assets/raw-timeline.js");
    const rejectedTimeline = await app.inject({ method: "GET", url: "/rejected-timeline", headers: authHeaders });
    expect(rejectedTimeline.statusCode).toBe(200);
    expect(rejectedTimeline.body).toContain("Rejected Timeline");
    expect(rejectedTimeline.body).toContain('id="rejected-timeline-clear-all"');
    expect(rejectedTimeline.body).toContain("/assets/raw-timeline.js");

    const publicTimelineData = await app.inject({ method: "GET", url: "/timeline/data", headers: authHeaders });
    expect(publicTimelineData.statusCode).toBe(200);
    expect(publicTimelineData.json()).toEqual({
      items: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      rawTimelineEnabled: true,
      actionsEnabled: false
    });
    const rawTimelineData = await app.inject({ method: "GET", url: "/raw-timeline/data", headers: authHeaders });
    expect(rawTimelineData.statusCode).toBe(200);
    expect(rawTimelineData.json()).toEqual({
      enabled: true,
      items: [],
      availableRejectionReasons: [],
      availableRejectionReasonGroups: [],
      selectedRejectionReasons: [],
      selectedRejectionReasonGroups: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false }
    });

    const createTimelineUser = await app.inject({
      method: "POST",
      url: "/admin/timeline-users",
      headers: authHeaders,
      payload: { username: "viewer", password: "viewer-password" }
    });
    expect(createTimelineUser.statusCode).toBe(200);
    expect(createTimelineUser.json().user).toMatchObject({ username: "viewer" });
    expect(createTimelineUser.json().user.passwordHash).toBeUndefined();

    const timelineUsers = await app.inject({ method: "GET", url: "/admin/timeline-users", headers: authHeaders });
    expect(timelineUsers.statusCode).toBe(200);
    expect(timelineUsers.json().users).toHaveLength(1);

    const badTimelineLogin = await app.inject({
      method: "POST",
      url: "/timeline/login",
      payload: { username: "viewer", password: "bad-password" }
    });
    expect(badTimelineLogin.statusCode).toBe(401);

    const timelineLogin = await app.inject({
      method: "POST",
      url: "/timeline/login",
      payload: { username: "viewer", password: "viewer-password" }
    });
    expect(timelineLogin.statusCode).toBe(200);
    const timelineCookie = timelineLogin.headers["set-cookie"];
    const timelineHeaders = authHeadersFromSetCookie(timelineCookie);

    const timelineUserData = await app.inject({ method: "GET", url: "/timeline/data", headers: timelineHeaders });
    expect(timelineUserData.statusCode).toBe(200);

    const timelineUserAdminDenied = await app.inject({ method: "GET", url: "/admin/stats", headers: timelineHeaders });
    expect(timelineUserAdminDenied.statusCode).toBe(401);

    const timelineUserBansWord = await app.inject({
      method: "POST",
      url: "/timeline/lists/banned_word",
      headers: timelineHeaders,
      payload: { value: "timeline-user-ban" }
    });
    expect(timelineUserBansWord.statusCode).toBe(200);
    expect(
      database.prepare("SELECT raw_value FROM list_entries WHERE kind = 'banned_word' AND raw_value = ? AND is_deleted = 0").get(
        "timeline-user-ban"
      )
    ).toEqual({ raw_value: "timeline-user-ban" });

    const timelineUserAddsBannedWordException = await app.inject({
      method: "POST",
      url: "/timeline/lists/banned_word_exception",
      headers: timelineHeaders,
      payload: { value: "of course" }
    });
    expect(timelineUserAddsBannedWordException.statusCode).toBe(200);
    expect(
      database
        .prepare("SELECT raw_value FROM list_entries WHERE kind = 'banned_word_exception' AND raw_value = ? AND is_deleted = 0")
        .get("of course")
    ).toEqual({ raw_value: "of course" });

    const timelineUserSuggestsKeyword = await app.inject({
      method: "POST",
      url: "/timeline/lists/suggested_keyword",
      headers: timelineHeaders,
      payload: { value: "timeline suggestion" }
    });
    expect(timelineUserSuggestsKeyword.statusCode).toBe(200);
    expect(
      database
        .prepare("SELECT raw_value FROM list_entries WHERE kind = 'suggested_keyword' AND raw_value = ? AND is_deleted = 0")
        .get("timeline suggestion")
    ).toEqual({ raw_value: "timeline suggestion" });

    const timelineUserCannotAddKeywordDirectly = await app.inject({
      method: "POST",
      url: "/timeline/lists/keyword",
      headers: timelineHeaders,
      payload: { value: "direct timeline keyword" }
    });
    expect(timelineUserCannotAddKeywordDirectly.statusCode).toBe(404);

    const timelineItems = new TimelineItemService(database);
    timelineItems.save({
      source: "reddit",
      externalId: "reddit-ignore-1",
      text: "reddit item to ignore",
      acceptedAt: "2026-05-18T10:00:00.000Z"
    });
    const timelineUserIgnoresReddit = await app.inject({
      method: "POST",
      url: "/timeline/items/reddit/reddit-ignore-1/archive",
      headers: timelineHeaders
    });
    expect(timelineUserIgnoresReddit.statusCode).toBe(200);
    expect(timelineUserIgnoresReddit.json()).toMatchObject({ source: "reddit", externalId: "reddit-ignore-1", archived: 1 });
    const activeRedditAfterIgnore = await app.inject({
      method: "GET",
      url: "/timeline/data?sources=reddit",
      headers: timelineHeaders
    });
    expect(activeRedditAfterIgnore.json().items).toEqual([]);
    const archivedRedditAfterIgnore = await app.inject({
      method: "GET",
      url: "/timeline/data?sources=reddit&archived=1",
      headers: timelineHeaders
    });
    expect(archivedRedditAfterIgnore.json().items[0]).toMatchObject({
      source: "reddit",
      externalId: "reddit-ignore-1",
      text: "reddit item to ignore"
    });
    const timelineUserAddsRedditBack = await app.inject({
      method: "POST",
      url: "/timeline/items/reddit/reddit-ignore-1/restore",
      headers: timelineHeaders
    });
    expect(timelineUserAddsRedditBack.statusCode).toBe(200);
    expect(timelineUserAddsRedditBack.json()).toMatchObject({ source: "reddit", externalId: "reddit-ignore-1", restored: 1 });

    const timelineUserAdminDeleteDenied = await app.inject({
      method: "DELETE",
      url: "/admin/rejected-timeline",
      headers: timelineHeaders
    });
    expect(timelineUserAdminDeleteDenied.statusCode).toBe(401);

    database.prepare("INSERT INTO runs (id, status, started_at, updated_at, stats_json) VALUES (?, ?, ?, ?, ?)").run(
      "run-timeline-clear-rejected",
      "stopped",
      "2026-05-07T11:30:00.000Z",
      "2026-05-07T11:30:00.000Z",
      "{}"
    );
    database
      .prepare(
        `INSERT INTO raw_timeline_tweets (
          run_id,
          tweet_id,
          source_keyword,
          text,
          decision_status,
          rejection_reasons_json
        )
        VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "run-timeline-clear-rejected",
        "tweet-timeline-clear-rejected",
        "keyword",
        "timeline clear rejected tweet",
        "rejected",
        JSON.stringify(["score_too_low"])
      );
    const timelineUserClearsRejectedTimeline = await app.inject({
      method: "DELETE",
      url: "/timeline/rejected-timeline",
      headers: timelineHeaders
    });
    expect(timelineUserClearsRejectedTimeline.statusCode).toBe(200);
    expect(timelineUserClearsRejectedTimeline.json()).toEqual({ deleted: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS total FROM raw_timeline_tweets WHERE run_id = ? AND decision_status = 'rejected'")
        .get("run-timeline-clear-rejected")
    ).toEqual({ total: 0 });

    await app.inject({
      method: "POST",
      url: "/admin/lists/rss_feed",
      headers: authHeaders,
      payload: { value: "https://example.com/feed-a.xml" }
    });
    await app.inject({
      method: "POST",
      url: "/admin/lists/rss_feed",
      headers: authHeaders,
      payload: { value: "https://example.com/feed-b.xml" }
    });
    const deleteAllList = await app.inject({
      method: "DELETE",
      url: "/admin/lists/rss_feed/all",
      headers: authHeaders
    });
    expect(deleteAllList.statusCode).toBe(200);
    expect(deleteAllList.json()).toEqual({ kind: "rss_feed", deleted: 2 });
    expect(database.prepare("SELECT COUNT(*) AS total FROM list_entries WHERE kind = 'rss_feed' AND is_deleted = 0").get()).toEqual({
      total: 0
    });

    database.prepare("INSERT INTO runs (id, status, started_at, updated_at, stats_json) VALUES (?, ?, ?, ?, ?)").run(
      "run-clear-rejected",
      "stopped",
      "2026-05-07T12:00:00.000Z",
      "2026-05-07T12:00:00.000Z",
      "{}"
    );
    database
      .prepare(
        `INSERT INTO raw_timeline_tweets (
          run_id,
          tweet_id,
          source_keyword,
          text,
          decision_status,
          rejection_reasons_json
        )
        VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("run-clear-rejected", "tweet-rejected", "keyword", "rejected tweet", "rejected", JSON.stringify(["score_too_low"]));
    database
      .prepare(
        `INSERT INTO raw_timeline_tweets (
          run_id,
          tweet_id,
          source_keyword,
          text,
          decision_status,
          rejection_reasons_json
        )
        VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("run-clear-rejected", "tweet-accepted", "keyword", "accepted tweet", "accepted", "[]");
    database
      .prepare(
        `INSERT INTO raw_timeline_tweets (
          run_id,
          tweet_id,
          source_keyword,
          text,
          author_handle,
          author_name,
          tweet_url,
          tweet_created_at,
          retweet_count,
          favorite_count,
          decision_status,
          score,
          rejection_reasons_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "run-clear-rejected",
        "tweet-manual-accept",
        "manual-keyword",
        "manual rejected tweet",
        "@manual",
        "Manual User",
        "https://twitter.com/i/web/status/tweet-manual-accept",
        "2026-05-07T10:30:00.000Z",
        12,
        34,
        "rejected",
        19,
        JSON.stringify(["score_too_low"])
      );
    database
      .prepare(
        `INSERT INTO raw_timeline_tweets (
          run_id,
          tweet_id,
          source_keyword,
          text,
          author_handle,
          author_name,
          tweet_url,
          tweet_created_at,
          retweet_count,
          favorite_count,
          decision_status,
          score,
          rejection_reasons_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "run-clear-rejected",
        "tweet-timeline-accept",
        "timeline-keyword",
        "timeline rejected tweet",
        "@timeline",
        "Timeline User",
        "https://twitter.com/i/web/status/tweet-timeline-accept",
        "2026-05-07T10:45:00.000Z",
        7,
        11,
        "rejected",
        13,
        JSON.stringify(["score_too_low"])
      );
    const timelineAcceptRejectedTweet = await app.inject({
      method: "POST",
      url: "/timeline/rejected-timeline/accept",
      headers: timelineHeaders,
      payload: {
        runId: "run-clear-rejected",
        tweetId: "tweet-timeline-accept"
      }
    });
    expect(timelineAcceptRejectedTweet.statusCode).toBe(200);
    expect(timelineAcceptRejectedTweet.json()).toEqual({
      ok: true,
      tweetId: "tweet-timeline-accept",
      runId: "run-clear-rejected"
    });

    const updateTimelineUserPassword = await app.inject({
      method: "PATCH",
      url: `/admin/timeline-users/${createTimelineUser.json().user.id}`,
      headers: authHeaders,
      payload: { username: "viewer", password: "viewer-password-2" }
    });
    expect(updateTimelineUserPassword.statusCode).toBe(200);
    const oldTimelineCookieDenied = await app.inject({ method: "GET", url: "/timeline/data", headers: timelineHeaders });
    expect(oldTimelineCookieDenied.statusCode).toBe(401);

    const acceptRejectedTweet = await app.inject({
      method: "POST",
      url: "/admin/rejected-timeline/accept",
      headers: authHeaders,
      payload: {
        runId: "run-clear-rejected",
        tweetId: "tweet-manual-accept"
      }
    });
    expect(acceptRejectedTweet.statusCode).toBe(200);
    expect(acceptRejectedTweet.json()).toEqual({
      ok: true,
      tweetId: "tweet-manual-accept",
      runId: "run-clear-rejected"
    });
    expect(
      database
        .prepare(
          "SELECT decision_status, rejection_stage, score FROM raw_timeline_tweets WHERE run_id = ? AND tweet_id = ?"
        )
        .get("run-clear-rejected", "tweet-manual-accept")
    ).toEqual({
      decision_status: "accepted",
      rejection_stage: "accepted",
      score: 19
    });
    expect(
      database
        .prepare(
          "SELECT tweet_id, text, author_handle, author_name, score, reasons_json, source_keyword FROM timeline_tweets WHERE tweet_id = ?"
        )
        .get("tweet-manual-accept")
    ).toEqual({
      tweet_id: "tweet-manual-accept",
      text: "manual rejected tweet",
      author_handle: "@manual",
      author_name: "Manual User",
      score: 19,
      reasons_json: JSON.stringify(["manual_accept_from_rejected_timeline"]),
      source_keyword: "manual-keyword"
    });
    const clearRejectedTimeline = await app.inject({
      method: "DELETE",
      url: "/admin/rejected-timeline",
      headers: authHeaders
    });
    expect(clearRejectedTimeline.statusCode).toBe(200);
    expect(clearRejectedTimeline.json()).toEqual({ deleted: 1 });
    expect(database.prepare("SELECT COUNT(*) AS total FROM raw_timeline_tweets WHERE decision_status = 'rejected'").get()).toEqual({
      total: 0
    });
    expect(database.prepare("SELECT COUNT(*) AS total FROM raw_timeline_tweets WHERE decision_status = 'accepted'").get()).toEqual({
      total: 3
    });

    const adminPage = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { ...authHeaders, accept: "text/html" }
    });
    expect(adminPage.statusCode).toBe(200);
    expect(adminPage.headers["x-frame-options"]).toBe("DENY");
    expect(adminPage.headers["x-content-type-options"]).toBe("nosniff");
    expect(adminPage.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(adminPage.body).toContain("/assets/admin.js");
    expect(adminPage.body).not.toContain("Commande legacy");
    expect(adminPage.body).not.toContain("Anciennes commandes IRC");
    expect(adminPage.body).not.toContain('id="list-kind"');
    expect(adminPage.body).not.toContain('data-show-kind="keyword"');
    expect(adminPage.body).not.toContain('data-admin-section-target="overview"');
    expect(adminPage.body).not.toContain('data-admin-section-target="counters"');
    expect(adminPage.body).not.toContain('id="admin-section-counters"');
    expect(adminPage.body).toContain('id="metrics"');
    expect(adminPage.body).toContain('id="import-local-file"');
    expect(adminPage.body).toContain('id="load-file-button"');
    expect(adminPage.body).toContain('id="save-import-button"');
    expect(adminPage.body).toContain('id="save-all-import-button"');
    expect(adminPage.body).toContain('id="download-timeline-tweets-button"');
    expect(adminPage.body).toContain('id="list-search"');
    expect(adminPage.body).toContain('id="download-list-button"');
    expect(adminPage.body).toContain('id="cleanup-lists-button"');
    expect(adminPage.body).toContain('id="delete-all-list-button"');
    expect(adminPage.body).toContain('<option value="no_result">No.Result</option>');
    expect(adminPage.body).toContain('<option value="stale_keyword_user">Stale keyword users</option>');
    expect(adminPage.body).toContain('<option value="skipped_keyword_user">Skipped keyword users</option>');
    expect(adminPage.body).toContain('<option value="timeline_tweets">Timeline tweets</option>');
    expect(adminPage.body).not.toContain('data-admin-section-target="import"');
    expect(adminPage.body).not.toContain('id="admin-section-import"');
    expect(adminPage.body).not.toContain("Import & Compteurs");
    expect(adminPage.body).toContain('data-admin-section-target="settings"');
    expect(adminPage.body).toContain('data-admin-section-target="session"');
    expect(adminPage.body).toContain('data-admin-section-target="tests"');
    expect(adminPage.body).toContain('data-admin-section-target="database"');
    expect(adminPage.body).toContain('data-admin-section-target="env"');
    expect(adminPage.body).toContain('data-admin-section-target="system"');
    expect(adminPage.body).toContain('id="admin-nav-more"');
    expect(adminPage.body).toContain("More ...");
    expect(adminPage.body).toContain('data-run-action="start"');
    expect(adminPage.body).toContain('href="/rejected-timeline"');
    expect(adminPage.body).toContain('id="server-access-form"');
    expect(adminPage.body).toContain("RedqueenX");
    expect(adminPage.body).toContain("Whitelist limits HTTPS access");
    expect(adminPage.body).toContain('name="whitelist"');
    expect(adminPage.body).toContain('name="blacklist"');
    expect(adminPage.body).toContain('id="scoring-form"');
    expect(adminPage.body).toContain('id="x-api-form"');
    expect(adminPage.body).toContain('name="minimumSearchResults"');
    expect(adminPage.body).toContain('name="luckFactorDenominator"');
    expect(adminPage.body).toContain('name="X_API_CREDIT_USD"');
    expect(adminPage.body).toContain('name="X_API_ENABLED"');
    expect(adminPage.body).toContain("Search without Api");
    expect(adminPage.body).toContain("<legend>Serveur env</legend>");
    expect(adminPage.body).not.toContain("<legend>Without Api env</legend>");
    expect(adminPage.body).toContain('name="X_LOGIN_SKIP_NETWORK_PRECHECK"');
    expect(adminPage.body).toContain("<legend>X Api env</legend>");
    expect(adminPage.body).toContain('id="search-without-api-form"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_ENABLED"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_ISOLATION"');
    expect(adminPage.body).toContain('name="X_LOGIN_NOVNC_PORT"');
    expect(adminPage.body).toContain('name="X_LOGIN_SCREEN"');
    expect(adminPage.body).toContain('name="X_LOGIN_SERVICE_MAX_SECONDS"');
    expect(adminPage.body).toContain('name="X_LOGIN_BROWSER"');
    expect(adminPage.body).toContain('name="X_LOGIN_SAVE_MODE"');
    expect(adminPage.body).toContain('name="X_LOGIN_REUSE_BROWSER_PROFILE"');
    expect(adminPage.body).toContain('name="X_LOGIN_START_URL"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM"');
    expect(adminPage.body).toContain('name="TIMELINE_DEFAULT_PAGE_SIZE"');
    expect(adminPage.body).toContain('name="RUN_CHAIN_COUNT"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_MAX_AGE_DAYS"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_START_INDEX"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_AUTO_IGNORE_ALERT"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_MAX_RETRIES"');
    expect(adminPage.body).toContain('name="STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS"');
    expect(adminPage.body).toContain('name="RAW_TIMELINE_ENABLED"');
    expect(adminPage.body).toContain('id="stale-keyword-user-days"');
    expect(adminPage.body).toContain('id="stale-keyword-user-start-index"');
    expect(adminPage.body).toContain('id="stale-keyword-user-action-delay-min-seconds"');
    expect(adminPage.body).toContain('id="stale-keyword-user-action-delay-max-seconds"');
    expect(adminPage.body).toContain('id="stale-keyword-user-max-retries"');
    expect(adminPage.body).toContain('id="open-stale-keyword-users-button"');
    expect(adminPage.body).toContain('id="open-skipped-keyword-users-button"');
    expect(adminPage.body).toContain('id="prune-stale-keyword-users-button"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT"');
    expect(adminPage.body).toContain('name="REDDIT_CRAWL_ENABLED"');
    expect(adminPage.body).toContain('name="REDDIT_CRAWL_SUBREDDITS"');
    expect(adminPage.body).toContain('name="REDDIT_CRAWL_MIN_SCORE"');
    expect(adminPage.body).toContain('name="relaxMinimumPopularityForHandleSearch"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_MAX_RETRIES"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN"');
    expect(adminPage.body).not.toContain('name="SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MAX"');
    expect(adminPage.body).toContain('<option value="search_terms_used">SearchTerms.Used</option>');
    expect(adminPage.body).toContain("Linux namespace / OpenVPN");
    expect(adminPage.body).toContain("VPN diagnostics");
    expect(adminPage.body).toContain('name="VPN_NETNS_NAME"');
    expect(adminPage.body).toContain('name="VPN_REMOTE_HOST"');
    expect(adminPage.body).toContain('name="VPN_CONFIG"');
    expect(adminPage.body).toContain('id="openvpn-profile-select"');
    expect(adminPage.body).toContain('id="openvpn-profile-detail"');
    expect(adminPage.body).toContain('id="openvpn-auth-button"');
    expect(adminPage.body).toContain('id="openvpn-shutdown-button"');
    expect(adminPage.body).not.toContain("Bulk OpenVPN import");
    expect(adminPage.body).not.toContain('id="openvpn-bulk-shared-auth"');
    expect(adminPage.body).not.toContain('id="openvpn-bulk-profile-select"');
    expect(adminPage.body).not.toContain('id="openvpn-bulk-profile-auth-button"');
    expect(adminPage.body).toContain('id="openvpn-auth-modal"');
    expect(adminPage.body).toContain('id="openvpn-auth-form"');
    expect(adminPage.body).toContain('id="x-session-alert-header"');
    expect(adminPage.body).toContain('id="x-session-alert-resolve"');
    expect(adminPage.body).toContain('id="x-session-alert-ignore"');
    expect(adminPage.body).toContain('id="x-browser-account-select"');
    expect(adminPage.body).toContain('id="x-browser-identifier"');
    expect(adminPage.body).toContain('id="x-browser-session-validation"');
    expect(adminPage.body).toContain('id="x-browser-session-import"');
    expect(adminPage.body).toContain('id="x-browser-session-export"');
    expect(adminPage.body).toContain('id="x-browser-session-import-file"');
    expect(adminPage.body).toContain('id="x-browser-account-save"');
    expect(adminPage.body).toContain('data-path-picker="file"');
    expect(adminPage.body).toContain('data-path-copy-to="./ops/vpn"');
    expect(adminPage.body).toContain('data-path-picker-extensions=".ovpn"');
    expect(adminPage.body).toContain('id="path-picker-modal"');
    expect(adminPage.body).toContain('name="PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"');
    expect(adminPage.body).not.toContain('name="SEARCH_WITHOUT_API_HEADLESS"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SHOW_BROWSER_LOCAL"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_MOUSE_PROFILE"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SAVE_SNAPSHOTS"');
    expect(adminPage.body).toContain('id="counters-updated-at"');
    expect(adminPage.body).toContain('id="session-api-left-label"');
    expect(adminPage.body).toContain('id="session-next-reset-label"');
    expect(adminPage.body).toContain('id="session-stick-bottom"');
    expect(adminPage.body).toContain('id="session-fullscreen-button"');
    expect(adminPage.body).not.toContain('id="session-grow-button"');
    expect(adminPage.body).not.toContain('id="session-shrink-button"');
    expect(adminPage.body).toContain('id="session-keywords-list"');
    expect(adminPage.body).toContain('id="toggle-inline-stale-keyword-users-button"');
    expect(adminPage.body).toContain('id="admin-section-tests"');
    expect(adminPage.body).toContain('id="admin-section-system"');
    expect(adminPage.body).toContain('data-admin-test="visible-x-login-vpn"');
    expect(adminPage.body).toContain('data-admin-test="media-cache"');
    expect(adminPage.body).toContain("Visible X login VPN preflight");
    expect(adminPage.body).toContain('id="browser-snapshots-list"');
    expect(adminPage.body).toContain('data-admin-section-target="session-alerts"');
    expect(adminPage.body).toContain('id="admin-section-session-alerts"');
    expect(adminPage.body).toContain('id="session-alerts-list"');
    expect(adminPage.body).toContain('id="x-session-alert-login"');
    expect(adminPage.body).toContain('id="x-session-alert-login-status"');
    expect(adminPage.body).toContain('id="x-session-alert-commands"');
    expect(adminPage.body).toContain('id="session-alert-detail-login"');
    expect(adminPage.body).toContain('id="session-alert-detail-login-status"');
    expect(adminPage.body).toContain('id="session-alert-detail-resolve"');
    expect(adminPage.body).toContain('id="session-alert-detail-ignore"');
    expect(adminPage.body).toContain('name="X_API_TOTAL_CREDIT_USED_USD"');

    const accountService = new XBrowserAccountService(database);
    const alertService = new XSessionAlertService(database);
    const account = accountService.upsert({
      vpnProfilePath: "./ops/vpn/test-alert.ovpn",
      xIdentifier: "@locked_account"
    });
    const openAlert = alertService.createOpen({
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: account.vpnProfilePath,
      publicIpv4: "203.0.113.42",
      alertType: "captcha"
    });
    const alertList = await app.inject({ method: "GET", url: "/admin/x-session-alerts", headers: authHeaders });
    expect(alertList.statusCode).toBe(200);
    expect(alertList.json().alerts[0]).toMatchObject({
      id: openAlert.id,
      xIdentifier: "@locked_account",
      status: "open"
    });
    const accountsWithAlert = await app.inject({ method: "GET", url: "/admin/x-browser-accounts", headers: authHeaders });
    expect(accountsWithAlert.statusCode).toBe(200);
    expect(accountsWithAlert.json().accounts.find((item: { id: number }) => item.id === account.id).openAlert.id).toBe(openAlert.id);
    const manualLoginLaunch = await app.inject({
      method: "POST",
      url: `/admin/x-session-alerts/${openAlert.id}/manual-login`,
      headers: authHeaders,
      payload: {}
    });
    expect(manualLoginLaunch.statusCode).toBe(200);
    expect(manualLoginLaunch.json()).toMatchObject({
      skippedInTest: true,
      commands: {
        setup: "npm run setup:local",
        manualLogin: `npm run netns:x-login -- --account-id ${account.id} --resolve-alert --auto-save-on-login --hold-open-after-save`
      }
    });
    const manualLoginStatus = await app.inject({
      method: "GET",
      url: `/admin/x-session-alerts/${openAlert.id}/manual-login/status`,
      headers: authHeaders
    });
    expect(manualLoginStatus.statusCode).toBe(200);
    expect(manualLoginStatus.json()).toMatchObject({
      state: "not_started",
      running: false,
      saved: false,
      failed: false,
      alert: {
        id: openAlert.id,
        accountId: account.id
      }
    });
    const resolveWithoutNote = await app.inject({
      method: "POST",
      url: `/admin/x-session-alerts/${openAlert.id}/resolve`,
      headers: authHeaders,
      payload: { note: "" }
    });
    expect(resolveWithoutNote.statusCode).toBe(400);
    const resolveBeforeCapture = await app.inject({
      method: "POST",
      url: `/admin/x-session-alerts/${openAlert.id}/resolve`,
      headers: authHeaders,
      payload: { note: "Human solved the challenge from the usual VPN IP." }
    });
    expect(resolveBeforeCapture.statusCode).toBe(409);
    expect(resolveBeforeCapture.json().error).toContain("Capture and save a fresh X browser session");
    expect(resolveBeforeCapture.json().commands.manualLogin).toContain("--auto-save-on-login");

    const capturedStorageStatePath = path.resolve(account.storageStatePath);
    fs.writeFileSync(capturedStorageStatePath, JSON.stringify({ cookies: [], origins: [] }), "utf8");
    accountService.markLogin(account.id, "203.0.113.42");
    const manualLoginStatusAfterCapture = await app.inject({
      method: "GET",
      url: `/admin/x-session-alerts/${openAlert.id}/manual-login/status`,
      headers: authHeaders
    });
    expect(manualLoginStatusAfterCapture.statusCode).toBe(200);
    expect(manualLoginStatusAfterCapture.json()).toMatchObject({
      state: "saved",
      saved: true
    });
    const resolveWithNote = await app.inject({
      method: "POST",
      url: `/admin/x-session-alerts/${openAlert.id}/resolve`,
      headers: authHeaders,
      payload: { note: "ok" }
    });
    expect(resolveWithNote.statusCode).toBe(200);
    expect(resolveWithNote.json().alert).toMatchObject({ id: openAlert.id, status: "resolved" });
    const ignoredOpenAlert = alertService.createOpen({
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: account.vpnProfilePath,
      publicIpv4: "203.0.113.42",
      alertType: "x_blocked"
    });
    const ignoreAlert = await app.inject({
      method: "POST",
      url: `/admin/x-session-alerts/${ignoredOpenAlert.id}/ignore`,
      headers: authHeaders,
      payload: {}
    });
    expect(ignoreAlert.statusCode).toBe(200);
    expect(ignoreAlert.json().alert).toMatchObject({ id: ignoredOpenAlert.id, status: "ignored" });
    expect(ignoreAlert.json().alert.resolvedByNote).toContain("Ignored from admin");
    expect(alertService.openForAccount(account.id)).toBeNull();
    fs.rmSync(capturedStorageStatePath, { force: true });
    expect(adminPage.body).not.toContain('id="reset-no-results-button"');
    expect(adminPage.body).toContain('id="reset-x-counters-button"');
    expect(adminPage.body).toContain('id="reset-x-budget-button"');
    expect(adminPage.body).toContain('id="env-form"');
    expect(adminPage.body).toContain('id="session-log"');
    expect(adminPage.body).not.toContain('id="session-stale-prune-status"');
    expect(adminPage.body).toContain('data-session-level="info"');
    expect(adminPage.body).toContain('data-session-level="prob"');
    expect(adminPage.body).toContain('data-session-level="debug"');
    expect(adminPage.body).toContain('id="session-include-admin-polling"');
    expect(adminPage.body).toContain('id="session-tweet-content"');
    expect(adminPage.body).toContain('id="session-tweet-score"');
    expect(adminPage.body).toContain('id="session-tweet-favorites"');
    expect(adminPage.body).toContain('id="session-tweet-retweets"');
    expect(adminPage.body).toContain('id="database-tables"');
    expect(adminPage.body).toContain('id="database-clear-table-button"');
    expect(adminPage.body).toContain('id="database-download-json-button"');

    const serverAccessDefaults = await app.inject({
      method: "GET",
      url: "/admin/settings/server-access",
      headers: authHeaders
    });
    expect(serverAccessDefaults.statusCode).toBe(200);
    expect(serverAccessDefaults.json().config).toEqual({
      whitelist: ["127.0.0.1"],
      blacklist: []
    });

    const serverAccessUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/settings/server-access",
      headers: authHeaders,
      payload: {
        whitelist: "127.0.0.1\n192.0.2.0/24",
        blacklist: "203.0.113.10"
      }
    });
    expect(serverAccessUpdate.statusCode).toBe(200);
    expect(serverAccessUpdate.json().config).toEqual({
      whitelist: ["127.0.0.1", "192.0.2.0/24"],
      blacklist: ["203.0.113.10"]
    });

    const serverAccessAutoKeepsCurrentIp = await app.inject({
      method: "PATCH",
      url: "/admin/settings/server-access",
      headers: authHeaders,
      payload: {
        whitelist: "37.67.185.138/32",
        blacklist: ""
      }
    });
    expect(serverAccessAutoKeepsCurrentIp.statusCode).toBe(200);
    expect(serverAccessAutoKeepsCurrentIp.json().config).toEqual({
      whitelist: ["37.67.185.138/32", "127.0.0.1"],
      blacklist: []
    });

    const serverAccessSelfBlacklist = await app.inject({
      method: "PATCH",
      url: "/admin/settings/server-access",
      headers: authHeaders,
      payload: {
        whitelist: "127.0.0.1",
        blacklist: "127.0.0.1"
      }
    });
    expect(serverAccessSelfBlacklist.statusCode).toBe(400);

    const crossOriginMutation = await app.inject({
      method: "POST",
      url: "/admin/lists/keyword",
      headers: { ...authHeaders, origin: "https://evil.example.test", "sec-fetch-site": "cross-site" },
      payload: { value: "csrf-keyword" }
    });
    expect(crossOriginMutation.statusCode).toBe(403);

    const filesystemBrowse = await app.inject({
      method: "GET",
      url: `/admin/filesystem/browse?mode=file&path=${encodeURIComponent(tmp)}`,
      headers: authHeaders
    });
    expect(filesystemBrowse.statusCode).toBe(200);
    expect(filesystemBrowse.json()).toMatchObject({
      mode: "file",
      cwd: tmp
    });
    expect(filesystemBrowse.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Rq.Keywords", path: path.join(tmp, "Rq.Keywords"), selectable: true })
      ])
    );

    const filesystemBrowseParentForMissingFile = await app.inject({
      method: "GET",
      url: `/admin/filesystem/browse?mode=file&path=${encodeURIComponent(path.join(tmp, "missing.sqlite"))}`,
      headers: authHeaders
    });
    expect(filesystemBrowseParentForMissingFile.statusCode).toBe(200);
    expect(filesystemBrowseParentForMissingFile.json().cwd).toBe(tmp);

    fs.writeFileSync(path.join(tmp, "client.ovpn"), "client\n", "utf8");
    fs.writeFileSync(path.join(tmp, "client.conf"), "client\n", "utf8");
    fs.writeFileSync(path.join(tmp, "notes.txt"), "notes\n", "utf8");
    const filesystemBrowseOpenVpnOnly = await app.inject({
      method: "GET",
      url: `/admin/filesystem/browse?mode=file&extensions=.ovpn&path=${encodeURIComponent(tmp)}`,
      headers: authHeaders
    });
    expect(filesystemBrowseOpenVpnOnly.statusCode).toBe(200);
    const openVpnOnlyNames = filesystemBrowseOpenVpnOnly.json().entries.map((entry: { name: string }) => entry.name);
    expect(openVpnOnlyNames).toContain("client.ovpn");
    expect(openVpnOnlyNames).not.toContain("client.conf");
    expect(openVpnOnlyNames).not.toContain("notes.txt");

    const openVpnSourcePath = path.join(tmp, "client.ovpn");
    const openVpnTargetDir = `ops/vpn/admin-api-vpn-copy-${process.pid}-${Date.now()}`;
    fs.writeFileSync(path.join(tmp, "client.auth"), "vpn-user\nvpn-pass\n", "utf8");
    fs.writeFileSync(
      openVpnSourcePath,
      [
        "client",
        "dev tun",
        "proto udp",
        "remote vpn.example.test 1194",
        "remote vpn-backup.example.test 443",
        "remote-random",
        "auth-user-pass",
        "script-security 2",
        "up /etc/openvpn/update-resolv-conf",
        "down /etc/openvpn/update-resolv-conf",
        ""
      ].join("\n"),
      "utf8"
    );
    const copiedOpenVpnConfig = await app.inject({
      method: "POST",
      url: "/admin/filesystem/copy",
      headers: authHeaders,
      payload: {
        sourcePath: openVpnSourcePath,
        targetDir: openVpnTargetDir
      }
    });
    expect(copiedOpenVpnConfig.statusCode).toBe(200);
    expect(copiedOpenVpnConfig.json()).toMatchObject({
      copied: true,
      alreadyInTarget: false,
      relativePath: `./${openVpnTargetDir}/client.ovpn`,
      openVpn: {
        isOpenVpnProfile: true,
        sanitized: true,
        authFilePath: `./${openVpnTargetDir}/client.auth`,
        authFileExists: true,
        authCopied: true,
        remoteHost: "vpn.example.test",
        remotePort: "1194",
        remoteProto: "udp"
      }
    });
    const copiedProfile = fs.readFileSync(path.resolve(openVpnTargetDir, "client.ovpn"), "utf8");
    expect(copiedProfile).toContain("remote vpn.example.test 1194");
    expect(copiedProfile).toContain(`auth-user-pass ./${openVpnTargetDir}/client.auth`);
    expect(copiedProfile).toContain("# RedqueenX disabled: remote-random");
    expect(copiedProfile).toContain("# RedqueenX disabled: script-security 2");
    expect(copiedProfile).toContain("# RedqueenX disabled: up /etc/openvpn/update-resolv-conf");
    expect(copiedProfile).not.toContain("\nremote-random\n");
    expect(copiedProfile).not.toContain("\nscript-security 2\n");
    expect(fs.readFileSync(path.resolve(openVpnTargetDir, "client.auth"), "utf8")).toBe("vpn-user\nvpn-pass\n");
    fs.rmSync(path.resolve(openVpnTargetDir), { recursive: true, force: true });

    const copyOutsideVpnDir = await app.inject({
      method: "POST",
      url: "/admin/filesystem/copy",
      headers: authHeaders,
      payload: {
        sourcePath: path.join(tmp, "notes.txt"),
        targetDir: "frontend/assets"
      }
    });
    expect(copyOutsideVpnDir.statusCode).toBe(400);

    const openVpnProfileDir = path.resolve("ops/vpn");
    const openVpnProfileName = `admin-api-profile-${process.pid}-${Date.now()}.ovpn`;
    const openVpnAuthName = openVpnProfileName.replace(/\.ovpn$/, ".auth");
    const openVpnProfilePath = path.join(openVpnProfileDir, openVpnProfileName);
    const openVpnAuthPath = path.join(openVpnProfileDir, openVpnAuthName);
    const secondOpenVpnProfileName = `admin-api-profile-second-${process.pid}-${Date.now()}.ovpn`;
    const secondOpenVpnProfilePath = path.join(openVpnProfileDir, secondOpenVpnProfileName);
    let importedXBrowserSessionPath: string | null = null;
    fs.mkdirSync(openVpnProfileDir, { recursive: true });
    fs.writeFileSync(
      openVpnProfilePath,
      [
        "client",
        "dev tun",
        "proto tcp-client",
        "remote scan-vpn.example.test 443",
        `auth-user-pass ${openVpnAuthName}`,
        "# RedqueenX disabled: remote scan-backup.example.test 1194 # test",
        ""
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      secondOpenVpnProfilePath,
      [
        "client",
        "dev tun",
        "proto udp",
        "remote scan-vpn-second.example.test 1194",
        ""
      ].join("\n"),
      "utf8"
    );
    try {
      const openVpnProfiles = await app.inject({
        method: "GET",
        url: "/admin/vpn/profiles",
        headers: authHeaders
      });
      expect(openVpnProfiles.statusCode).toBe(200);
      expect(openVpnProfiles.json()).toMatchObject({
        directory: "./ops/vpn",
        profiles: expect.arrayContaining([
          expect.objectContaining({
            filename: openVpnProfileName,
            relativePath: `./ops/vpn/${openVpnProfileName}`,
            authFilePath: `./ops/vpn/${openVpnAuthName}`,
            authFileExists: false,
            remoteHost: "scan-vpn.example.test",
            remotePort: "443",
            remoteProto: "tcp",
            activeRemoteCount: 1
          })
        ])
      });
      const xBrowserAccount = await app.inject({
        method: "POST",
        url: "/admin/x-browser-accounts",
        headers: authHeaders,
        payload: {
          vpnProfilePath: `./ops/vpn/${openVpnProfileName}`,
          xIdentifier: "@redqueenx_test"
        }
      });
      expect(xBrowserAccount.statusCode).toBe(200);
      importedXBrowserSessionPath = path.resolve(xBrowserAccount.json().account.storageStatePath);
      expect(xBrowserAccount.json()).toMatchObject({
        account: {
          vpnProfilePath: `./ops/vpn/${openVpnProfileName}`,
          xIdentifier: "@redqueenx_test",
          storageStatePath: expect.stringContaining(`/admin-api-profile-${process.pid}-`),
          browserProfileDir: expect.stringContaining(`/admin-api-profile-${process.pid}-`),
          sessionStatus: "missing_session",
          storageStateExists: false,
          lastLoginAt: null,
          lastLoginPublicIpv4: null
        }
      });
      expect(JSON.stringify(xBrowserAccount.json())).not.toContain("vpn-pass");
      const missingXBrowserSessionExport = await app.inject({
        method: "GET",
        url: `/admin/x-browser-accounts/${xBrowserAccount.json().account.id}/session`,
        headers: authHeaders
      });
      expect(missingXBrowserSessionExport.statusCode).toBe(404);
      const invalidXBrowserSessionImport = await app.inject({
        method: "POST",
        url: `/admin/x-browser-accounts/${xBrowserAccount.json().account.id}/session`,
        headers: authHeaders,
        payload: {
          filename: "bad-session.json",
          content: JSON.stringify({ cookies: [], origins: [] })
        }
      });
      expect(invalidXBrowserSessionImport.statusCode).toBe(400);
      const importedStorageState = {
        cookies: [
          {
            name: "auth_token",
            value: "secret-x-session-token",
            domain: ".x.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax"
          }
        ],
        origins: []
      };
      const xBrowserSessionImport = await app.inject({
        method: "POST",
        url: `/admin/x-browser-accounts/${xBrowserAccount.json().account.id}/session`,
        headers: authHeaders,
        payload: {
          filename: "x-session.json",
          content: JSON.stringify(importedStorageState)
        }
      });
      expect(xBrowserSessionImport.statusCode).toBe(200);
      expect(xBrowserSessionImport.json()).toMatchObject({
        imported: true,
        cookieCount: 1,
        filename: "x-session.json",
        account: {
          id: xBrowserAccount.json().account.id,
          sessionStatus: "valid",
          storageStateExists: true
        }
      });
      expect(JSON.stringify(xBrowserSessionImport.json())).not.toContain("secret-x-session-token");
      expect(importedXBrowserSessionPath).toBeTruthy();
      expect(fs.statSync(importedXBrowserSessionPath as string).mode & 0o777).toBe(0o600);
      const xBrowserSessionExport = await app.inject({
        method: "GET",
        url: `/admin/x-browser-accounts/${xBrowserAccount.json().account.id}/session`,
        headers: authHeaders
      });
      expect(xBrowserSessionExport.statusCode).toBe(200);
      expect(xBrowserSessionExport.headers["content-disposition"]).toContain("redqueenx_test-x-session.json");
      expect(JSON.parse(xBrowserSessionExport.body)).toMatchObject(importedStorageState);
      const xBrowserAccounts = await app.inject({
        method: "GET",
        url: "/admin/x-browser-accounts",
        headers: authHeaders
      });
      expect(xBrowserAccounts.statusCode).toBe(200);
      expect(xBrowserAccounts.json().accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: xBrowserAccount.json().account.id,
            vpnProfilePath: `./ops/vpn/${openVpnProfileName}`,
            xIdentifier: "@redqueenx_test"
          })
        ])
      );
      const openVpnAuthWrite = await app.inject({
        method: "POST",
        url: "/admin/vpn/profiles/auth",
        headers: authHeaders,
        payload: {
          profilePath: `./ops/vpn/${openVpnProfileName}`,
          username: "new-vpn-user",
          password: "new-vpn-pass"
        }
      });
      expect(openVpnAuthWrite.statusCode).toBe(200);
      expect(openVpnAuthWrite.json()).toMatchObject({
        ok: true,
        created: true,
        profilePath: `./ops/vpn/${openVpnProfileName}`,
        authFilePath: `./ops/vpn/${openVpnAuthName}`,
        authFileExists: true,
        profile: expect.objectContaining({
          authFileExists: true,
          authFilePath: `./ops/vpn/${openVpnAuthName}`
        })
      });
      expect(JSON.stringify(openVpnAuthWrite.json())).not.toContain("new-vpn-pass");
      expect(fs.readFileSync(openVpnAuthPath, "utf8")).toBe("new-vpn-user\nnew-vpn-pass\n");
      expect(fs.statSync(openVpnAuthPath).mode & 0o777).toBe(0o600);

      const removedBulkImport = await app.inject({
        method: "POST",
        url: "/admin/vpn/profiles/bulk-import",
        headers: authHeaders,
        payload: {}
      });
      expect(removedBulkImport.statusCode).toBe(404);
      const secondProfileRelativePath = `./ops/vpn/${secondOpenVpnProfileName}`;
      const xBrowserMultiProfileUpdate = await app.inject({
        method: "POST",
        url: "/admin/x-browser-accounts",
        headers: authHeaders,
        payload: {
          accountId: xBrowserAccount.json().account.id,
          vpnProfilePath: `./ops/vpn/${openVpnProfileName}`,
          vpnProfilePaths: [`./ops/vpn/${openVpnProfileName}`, secondProfileRelativePath],
          xIdentifier: "@redqueenx_test",
          replaceProfiles: true
        }
      });
      expect(xBrowserMultiProfileUpdate.statusCode).toBe(200);
      expect(xBrowserMultiProfileUpdate.json().account).toMatchObject({
        id: xBrowserAccount.json().account.id,
        xIdentifier: "@redqueenx_test",
        vpnProfilePaths: expect.arrayContaining([`./ops/vpn/${openVpnProfileName}`, secondProfileRelativePath])
      });
      const xBrowserAccountByBulkProfile = await app.inject({
        method: "POST",
        url: "/admin/x-browser-accounts",
        headers: authHeaders,
        payload: {
          vpnProfilePath: secondProfileRelativePath,
          xIdentifier: "@redqueenx_test"
        }
      });
      expect(xBrowserAccountByBulkProfile.statusCode).toBe(200);
      expect(xBrowserAccountByBulkProfile.json().account.id).toBe(xBrowserAccount.json().account.id);

      const xBrowserDelete = await app.inject({
        method: "DELETE",
        url: `/admin/x-browser-accounts/${xBrowserAccount.json().account.id}`,
        headers: authHeaders
      });
      expect(xBrowserDelete.statusCode).toBe(200);
      expect(xBrowserDelete.json()).toMatchObject({ deleted: true });
    } finally {
      fs.rmSync(openVpnProfilePath, { force: true });
      fs.rmSync(openVpnAuthPath, { force: true });
      fs.rmSync(secondOpenVpnProfilePath, { force: true });
      if (importedXBrowserSessionPath) {
        fs.rmSync(importedXBrowserSessionPath, { force: true });
      }
    }

    const scoringDefaults = await app.inject({
      method: "GET",
      url: "/admin/settings/scoring",
      headers: authHeaders
    });
    expect(scoringDefaults.statusCode).toBe(200);
    expect(scoringDefaults.json().config).toMatchObject({
      allowedLanguages: ["en", "fr"],
      enableMinimumTweetScore: true,
      minimumSearchResults: 3,
      luckFactorDenominator: 200,
      minimumTweetScore: 25
    });

    const scoringUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/settings/scoring",
      headers: authHeaders,
      payload: {
        allowedLanguages: ["EN", "fr", "en"],
        enableMinimumTweetScore: false,
        minimumSearchResults: 2,
        luckFactorDenominator: 100,
        minimumTweetLength: 50,
        minimumTweetRetweets: 2,
        maximumTweetRetweets: 500,
        minimumTweetFavorites: 1,
        maximumTweetFavorites: 250,
        relaxMinimumPopularityForHandleSearch: true,
        minimumUserFollowers: 300,
        minimumTweetScore: 20,
        maximumTweetAgeDays: 3,
        maximumHashtags: 4,
        maximumMentions: 5,
        maximumTweetsByUser: 2
      }
    });
    expect(scoringUpdate.statusCode).toBe(200);
    expect(scoringUpdate.json().config).toMatchObject({
      allowedLanguages: ["en", "fr"],
      enableMinimumTweetScore: false,
      minimumSearchResults: 2,
      luckFactorDenominator: 100,
      minimumTweetScore: 20,
      maximumTweetAgeDays: 3,
      relaxMinimumPopularityForHandleSearch: true
    });

    const xApiDefaults = await app.inject({
      method: "GET",
      url: "/admin/settings/x-api",
      headers: authHeaders
    });
    expect(xApiDefaults.statusCode).toBe(200);
    expect(xApiDefaults.json().values).toMatchObject({
      X_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ISOLATION: "host_netns",
      SEARCH_WITHOUT_API_MAX_SCROLLS: "20",
      SEARCH_WITHOUT_API_SCROLL_DELAY_MIN_MS: "5000",
      SEARCH_WITHOUT_API_SCROLL_DELAY_MAX_MS: "12000",
      SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS: "500",
      SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS: "5000",
      SEARCH_WITHOUT_API_SEARCH_DELAY_MIN_SECONDS: "5",
      SEARCH_WITHOUT_API_SEARCH_DELAY_MAX_SECONDS: "120",
      SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT: "50",
      SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM: "false",
      SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER: "false",
      SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT: "false",
      SEARCH_WITHOUT_API_MAX_RETRIES: "3",
      SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS: "10",
      TIMELINE_DEFAULT_PAGE_SIZE: "50",
      RUN_CHAIN_COUNT: "0",
      STALE_KEYWORD_USER_MAX_AGE_DAYS: "90",
      STALE_KEYWORD_USER_START_INDEX: "1",
      STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS: "1",
      STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS: "5",
      STALE_KEYWORD_USER_AUTO_IGNORE_ALERT: "false",
      STALE_KEYWORD_USER_MAX_RETRIES: "3",
      STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS: "10",
      RAW_TIMELINE_ENABLED: "true",
      X_LOGIN_NOVNC_PORT: "6080",
      X_LOGIN_SCREEN: "1920x1080x24",
      X_LOGIN_SERVICE_MAX_SECONDS: "1200",
      X_LOGIN_BROWSER: "chrome",
      X_LOGIN_SAVE_MODE: "auto",
      X_LOGIN_START_URL: "https://x.com/login",
      X_LOGIN_REUSE_BROWSER_PROFILE: "false",
      SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN: "10",
      SEARCH_WITHOUT_API_PAUSE_MIN_MINUTES: "15",
      SEARCH_WITHOUT_API_PAUSE_MAX_MINUTES: "120",
      SEARCH_WITHOUT_API_SCROLLS_MIN: "0",
      SEARCH_WITHOUT_API_SCROLLS_MAX: "23",
      SEARCH_WITHOUT_API_TWEET_HOVER_MIN_SECONDS: "1",
      SEARCH_WITHOUT_API_TWEET_HOVER_MAX_SECONDS: "15",
      SEARCH_WITHOUT_API_MOUSE_PROFILE: "smooth1",
      VPN_NETNS_NAME: "redqueenx-vpn",
      VPN_REMOTE_PORT: "1194",
      VPN_REMOTE_PROTO: "udp",
      VPN_CONFIG: "./ops/vpn/custom.conf",
      VPN_CHECK_HOST_IPV4_LEAK: "true",
      VPN_CHECK_IPV6: "true",
      VPN_DIAGNOSTIC_STRICT: "true",
      VPN_DIAGNOSTIC_PLAYWRIGHT: "true",
      X_LOGIN_SKIP_NETWORK_PRECHECK: "false",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/usr/bin/chromium",
      PLAYWRIGHT_DISABLE_SANDBOX: "true",
      X_API_TOTAL_CREDIT_USED_USD: "20.38",
      X_DAILY_SPEND_LIMIT_USD: "1",
      X_RUN_SPEND_LIMIT_USD: "2",
      X_COUNT_FIRST_MODE: "true",
      X_KEYWORDS_PER_QUERY: "5",
      REDDIT_CRAWL_ENABLED: "false",
      REDDIT_CRAWL_USER_AGENT: "RedqueenX/0.1.0",
      REDDIT_CRAWL_SUBREDDITS: "cybersecurity,netsec,blueteamsec,osint,privacy",
      REDDIT_CRAWL_LIMIT_PER_KEYWORD: "10",
      REDDIT_CRAWL_SORT: "relevance",
      REDDIT_CRAWL_TIME_RANGE: "month",
      REDDIT_CRAWL_MIN_SCORE: "2"
    });

    const generalRuntimeUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          RUN_CHAIN_COUNT: "3",
          STALE_KEYWORD_USER_MAX_AGE_DAYS: "120",
          STALE_KEYWORD_USER_START_INDEX: "2332",
          STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS: "0",
          STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS: "2",
          STALE_KEYWORD_USER_AUTO_IGNORE_ALERT: "true",
          STALE_KEYWORD_USER_MAX_RETRIES: "5",
          STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS: "12",
          REDDIT_CRAWL_ENABLED: "true",
          REDDIT_CRAWL_SUBREDDITS: "netsec,osint",
          REDDIT_CRAWL_LIMIT_PER_KEYWORD: "7",
          REDDIT_CRAWL_SORT: "top",
          REDDIT_CRAWL_TIME_RANGE: "week",
          REDDIT_CRAWL_MIN_SCORE: "5",
          SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB: "0"
        }
      }
    });
    expect(generalRuntimeUpdate.statusCode).toBe(200);
    expect(generalRuntimeUpdate.json().values.RUN_CHAIN_COUNT).toBe("3");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_MAX_AGE_DAYS).toBe("120");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_START_INDEX).toBe("2332");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS).toBe("0");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS).toBe("2");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_AUTO_IGNORE_ALERT).toBe("true");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_MAX_RETRIES).toBe("5");
    expect(generalRuntimeUpdate.json().values.STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS).toBe("12");
    expect(generalRuntimeUpdate.json().values.REDDIT_CRAWL_ENABLED).toBe("true");
    expect(generalRuntimeUpdate.json().values.REDDIT_CRAWL_SUBREDDITS).toBe("netsec,osint");
    expect(generalRuntimeUpdate.json().values.REDDIT_CRAWL_LIMIT_PER_KEYWORD).toBe("7");
    expect(generalRuntimeUpdate.json().values.REDDIT_CRAWL_SORT).toBe("top");
    expect(generalRuntimeUpdate.json().values.REDDIT_CRAWL_TIME_RANGE).toBe("week");
    expect(generalRuntimeUpdate.json().values.REDDIT_CRAWL_MIN_SCORE).toBe("5");
    expect(generalRuntimeUpdate.json().values.SEARCH_WITHOUT_API_MEDIA_CACHE_MAX_MB).toBe("0");

    const timelinePageSizeUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          TIMELINE_DEFAULT_PAGE_SIZE: "75"
        }
      }
    });
    expect(timelinePageSizeUpdate.statusCode).toBe(200);
    expect(timelinePageSizeUpdate.json().values.TIMELINE_DEFAULT_PAGE_SIZE).toBe("75");
    const timelineDefaultPageSize = await app.inject({ method: "GET", url: "/timeline/data", headers: authHeaders });
    expect(timelineDefaultPageSize.statusCode).toBe(200);
    expect(timelineDefaultPageSize.json().pagination.limit).toBe(75);
    const rawTimelineDefaultPageSize = await app.inject({ method: "GET", url: "/raw-timeline/data", headers: authHeaders });
    expect(rawTimelineDefaultPageSize.statusCode).toBe(200);
    expect(rawTimelineDefaultPageSize.json().pagination.limit).toBe(75);
    expect(rawTimelineDefaultPageSize.json().enabled).toBe(true);
    const timelineExplicitPageSize = await app.inject({ method: "GET", url: "/timeline/data?limit=3", headers: authHeaders });
    expect(timelineExplicitPageSize.statusCode).toBe(200);
    expect(timelineExplicitPageSize.json().pagination.limit).toBe(3);
    const rawTimelineDisable = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          RAW_TIMELINE_ENABLED: "false"
        }
      }
    });
    expect(rawTimelineDisable.statusCode).toBe(200);
    expect(rawTimelineDisable.json().values.RAW_TIMELINE_ENABLED).toBe("false");
    const timelineWithRawDisabled = await app.inject({ method: "GET", url: "/timeline/data", headers: authHeaders });
    expect(timelineWithRawDisabled.statusCode).toBe(200);
    expect(timelineWithRawDisabled.json().rawTimelineEnabled).toBe(false);
    const rawTimelineDisabledData = await app.inject({ method: "GET", url: "/raw-timeline/data?offset=50", headers: authHeaders });
    expect(rawTimelineDisabledData.statusCode).toBe(200);
    expect(rawTimelineDisabledData.json()).toEqual({
      enabled: false,
      items: [],
      availableRejectionReasons: [],
      availableRejectionReasonGroups: [],
      selectedRejectionReasons: [],
      selectedRejectionReasonGroups: [],
      pagination: { total: 0, limit: 75, offset: 0, hasMore: false }
    });
    const timelinePageSizeReset = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          TIMELINE_DEFAULT_PAGE_SIZE: "50",
          RUN_CHAIN_COUNT: "0",
          STALE_KEYWORD_USER_MAX_AGE_DAYS: "90",
          STALE_KEYWORD_USER_ACTION_DELAY_MIN_SECONDS: "1",
          STALE_KEYWORD_USER_ACTION_DELAY_MAX_SECONDS: "5",
          STALE_KEYWORD_USER_AUTO_IGNORE_ALERT: "false",
          STALE_KEYWORD_USER_MAX_RETRIES: "3",
          STALE_KEYWORD_USER_AUTO_RESTART_DELAY_SECONDS: "10",
          RAW_TIMELINE_ENABLED: "true"
        }
      }
    });
    expect(timelinePageSizeReset.statusCode).toBe(200);

    const xApiUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          X_API_TOTAL_CREDIT_USED_USD: "21",
          X_API_ENABLED: "true",
          X_DAILY_SPEND_LIMIT_USD: "2",
          X_RUN_SPEND_LIMIT_USD: "2",
          X_COUNT_FIRST_MODE: "false",
          X_KEYWORDS_PER_QUERY: "2"
        }
      }
    });
    expect(xApiUpdate.statusCode).toBe(200);
    expect(xApiUpdate.json()).toMatchObject({
      restartRequired: false,
      values: {
        X_API_TOTAL_CREDIT_USED_USD: "21",
        X_API_ENABLED: "true",
        X_DAILY_SPEND_LIMIT_USD: "2",
        X_RUN_SPEND_LIMIT_USD: "2",
        X_COUNT_FIRST_MODE: "false",
        X_KEYWORDS_PER_QUERY: "2"
      }
    });

    const runStart = await app.inject({
      method: "POST",
      url: "/admin/runs",
      headers: authHeaders
    });
    expect(runStart.statusCode).toBe(200);
    expect(runStart.json().run.status).toBe("running");

    const xApiDisable = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          X_API_ENABLED: "false"
        }
      }
    });
    expect(xApiDisable.statusCode).toBe(200);
    expect(xApiDisable.json().values.X_API_ENABLED).toBe("false");

    const stoppedAfterXDisable = await app.inject({
      method: "GET",
      url: "/admin/runs/current",
      headers: authHeaders
    });
    expect(stoppedAfterXDisable.statusCode).toBe(200);
    expect(stoppedAfterXDisable.json().run).toBeNull();

    const blockedStartWhileXDisabled = await app.inject({
      method: "POST",
      url: "/admin/runs",
      headers: authHeaders
    });
    expect(blockedStartWhileXDisabled.statusCode).toBe(409);
    expect(blockedStartWhileXDisabled.json().error).toContain("X API search is disabled");

    const xApiEnable = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          X_API_ENABLED: "true"
        }
      }
    });
    expect(xApiEnable.statusCode).toBe(200);

    const runStartAfterXEnable = await app.inject({
      method: "POST",
      url: "/admin/runs",
      headers: authHeaders
    });
    expect(runStartAfterXEnable.statusCode).toBe(200);
    expect(runStartAfterXEnable.json().run.status).toBe("running");

    const searchWithoutApiEnable = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          SEARCH_WITHOUT_API_ENABLED: "true",
          SEARCH_WITHOUT_API_PROFILE_DIR: "./runtime/browser-profile",
          SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS: "600",
          SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS: "4200",
          SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT: "12",
          SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM: "true",
          SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER: "true",
          SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT: "25",
          SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN: "7",
          SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT: "true",
          SEARCH_WITHOUT_API_MAX_RETRIES: "4",
          SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS: "30",
          SEARCH_WITHOUT_API_SCROLLS_MAX: "12",
          SEARCH_WITHOUT_API_MOUSE_PROFILE: "smooth2",
          VPN_REMOTE_HOST: "vpn.example.test",
          VPN_REMOTE_PORT: "443",
          VPN_REMOTE_PROTO: "tcp",
          VPN_CHECK_HOST_IPV4_LEAK: "false",
          VPN_CHECK_IPV6: "true",
          X_LOGIN_SKIP_NETWORK_PRECHECK: "true"
        }
      }
    });
    expect(searchWithoutApiEnable.statusCode).toBe(200);
    expect(searchWithoutApiEnable.json().values).toMatchObject({
      X_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ENABLED: "true",
      SEARCH_WITHOUT_API_PROFILE_DIR: "./runtime/browser-profile",
      SEARCH_WITHOUT_API_KEY_DELAY_MIN_MS: "600",
      SEARCH_WITHOUT_API_KEY_DELAY_MAX_MS: "4200",
      SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT: "12",
      SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM: "true",
      SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER: "true",
      SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT: "25",
      SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN: "7",
      SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT: "true",
      SEARCH_WITHOUT_API_MAX_RETRIES: "4",
      SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS: "30",
      SEARCH_WITHOUT_API_SCROLLS_MAX: "12",
      SEARCH_WITHOUT_API_MOUSE_PROFILE: "smooth2",
      VPN_REMOTE_HOST: "vpn.example.test",
      VPN_REMOTE_PORT: "443",
      VPN_REMOTE_PROTO: "tcp",
      VPN_CHECK_HOST_IPV4_LEAK: "false",
      VPN_CHECK_IPV6: "true",
      X_LOGIN_SKIP_NETWORK_PRECHECK: "true"
    });
    const envAfterSearchWithoutApiEnable = fs.readFileSync(envPath, "utf8");
    expect(envAfterSearchWithoutApiEnable).toContain("X_API_ENABLED=false");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_ENABLED=true");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_MOUSE_PROFILE=smooth2");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT=12");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM=true");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER=true");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT=25");
    expect(envAfterSearchWithoutApiEnable).toContain("REDDIT_CRAWL_ENABLED=true");
    expect(envAfterSearchWithoutApiEnable).toContain("REDDIT_CRAWL_SUBREDDITS=netsec,osint");
    expect(envAfterSearchWithoutApiEnable).toContain("REDDIT_CRAWL_LIMIT_PER_KEYWORD=7");
    expect(envAfterSearchWithoutApiEnable).toContain("REDDIT_CRAWL_SORT=top");
    expect(envAfterSearchWithoutApiEnable).toContain("REDDIT_CRAWL_TIME_RANGE=week");
    expect(envAfterSearchWithoutApiEnable).toContain("REDDIT_CRAWL_MIN_SCORE=5");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN=7");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_AUTO_IGNORE_ALERT=true");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_MAX_RETRIES=4");
    expect(envAfterSearchWithoutApiEnable).toContain("SEARCH_WITHOUT_API_AUTO_RESTART_DELAY_SECONDS=30");
    expect(envAfterSearchWithoutApiEnable).toContain("X_LOGIN_SKIP_NETWORK_PRECHECK=true");
    expect(envAfterSearchWithoutApiEnable).toContain("VPN_REMOTE_HOST=vpn.example.test");
    expect(envAfterSearchWithoutApiEnable).toContain("VPN_REMOTE_PORT=443");

    const stoppedAfterSearchWithoutApi = await app.inject({
      method: "GET",
      url: "/admin/runs/current",
      headers: authHeaders
    });
    expect(stoppedAfterSearchWithoutApi.statusCode).toBe(200);
    expect(stoppedAfterSearchWithoutApi.json().run).toBeNull();

    const withoutApiRun = new RunService(database).start({
      sessionKeywordLimit: 12,
      totalKeywords: 12,
      remainingKeywords: 12,
      availableKeywords: 12,
      apiCallLimit: 6,
      apiWindowMinutes: 120
    });
    const xApiDisableDuringWithoutApiRun = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          X_API_ENABLED: "false"
        }
      }
    });
    expect(xApiDisableDuringWithoutApiRun.statusCode).toBe(200);
    const keptWithoutApiRun = await app.inject({
      method: "GET",
      url: "/admin/runs/current",
      headers: authHeaders
    });
    expect(keptWithoutApiRun.statusCode).toBe(200);
    expect(keptWithoutApiRun.json().run).toMatchObject({ id: withoutApiRun.id, status: "running" });
    const stopKeptWithoutApiRun = await app.inject({
      method: "POST",
      url: "/admin/runs/current/stop",
      headers: authHeaders
    });
    expect(stopKeptWithoutApiRun.statusCode).toBe(200);
    const withoutApiRunBeforeXApiMode = new RunService(database).start({
      sessionKeywordLimit: 12,
      totalKeywords: 12,
      remainingKeywords: 12,
      availableKeywords: 12,
      apiCallLimit: 6,
      apiWindowMinutes: 120
    });

    const xApiEnableAfterSearchWithoutApi = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          X_API_ENABLED: "true"
        }
      }
    });
    expect(xApiEnableAfterSearchWithoutApi.statusCode).toBe(200);
    expect(xApiEnableAfterSearchWithoutApi.json().values).toMatchObject({
      X_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ENABLED: "false"
    });
    expect(xApiEnableAfterSearchWithoutApi.json().xApiModeShutdown).toMatchObject({
      requested: true,
      reason: "x_api_mode_enabled",
      stoppedRun: true,
      stoppedRunId: withoutApiRunBeforeXApiMode.id,
      openVpn: {
        stop: {
          reason: "skipped_in_test"
        }
      },
      namespace: {
        teardown: {
          reason: "skipped_in_test"
        }
      }
    });
    const envAfterXApiEnable = fs.readFileSync(envPath, "utf8");
    expect(envAfterXApiEnable).toContain("X_API_ENABLED=true");
    expect(envAfterXApiEnable).toContain("SEARCH_WITHOUT_API_ENABLED=false");
    const stoppedAfterXApiMode = await app.inject({
      method: "GET",
      url: "/admin/runs/current",
      headers: authHeaders
    });
    expect(stoppedAfterXApiMode.statusCode).toBe(200);
    expect(stoppedAfterXApiMode.json().run).toBeNull();

    const searchWithoutApiDisable = await app.inject({
      method: "PATCH",
      url: "/admin/settings/x-api",
      headers: authHeaders,
      payload: {
        values: {
          SEARCH_WITHOUT_API_ENABLED: "false",
          X_API_ENABLED: "true"
        }
      }
    });
    expect(searchWithoutApiDisable.statusCode).toBe(200);
    expect(searchWithoutApiDisable.json().values).toMatchObject({
      X_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ENABLED: "false"
    });

    const runStartAfterModeReset = await app.inject({
      method: "POST",
      url: "/admin/runs",
      headers: authHeaders
    });
    expect(runStartAfterModeReset.statusCode).toBe(200);
    expect(runStartAfterModeReset.json().run.status).toBe("running");

    const runPause = await app.inject({
      method: "POST",
      url: "/admin/runs/current/pause",
      headers: authHeaders
    });
    expect(runPause.statusCode).toBe(200);
    expect(runPause.json().run.status).toBe("paused");
    expect(runPause.json().rssFallback).toEqual({ feeds: 0, savedItems: 0, failedFeeds: 0 });

    const runStartWhilePaused = await app.inject({
      method: "POST",
      url: "/admin/runs",
      headers: authHeaders
    });
    expect(runStartWhilePaused.statusCode).toBe(200);
    expect(runStartWhilePaused.json().run.status).toBe("running");

    const runPauseAgain = await app.inject({
      method: "POST",
      url: "/admin/runs/current/pause",
      headers: authHeaders
    });
    expect(runPauseAgain.statusCode).toBe(200);
    expect(runPauseAgain.json().run.status).toBe("paused");
    expect(runPauseAgain.json().rssFallback).toEqual({ feeds: 0, savedItems: 0, failedFeeds: 0 });

    const runResume = await app.inject({
      method: "POST",
      url: "/admin/runs/current/resume",
      headers: authHeaders
    });
    expect(runResume.statusCode).toBe(200);
    expect(runResume.json().run.status).toBe("running");

    const currentSession = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=info",
      headers: authHeaders
    });
    expect(currentSession.statusCode).toBe(200);
    expect(currentSession.json()).toMatchObject({
      session: {
        filePath: currentSessionFilePath,
        exists: true
      },
      currentRun: {
        status: "running"
      },
      staleKeywordUserPrune: {
        running: false,
        job: null
      }
    });
    expect(currentSession.json().session.lines.join("\n")).toContain("run.started");
    expect(currentSession.json().session.lines.join("\n")).not.toContain("DEBUG");

    const sessionKeywordsPolling = await app.inject({
      method: "GET",
      url: "/admin/session/keywords?limit=1000",
      headers: authHeaders
    });
    expect(sessionKeywordsPolling.statusCode).toBe(200);

    const currentSessionDebug = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=50&level=debug",
      headers: authHeaders
    });
    expect(currentSessionDebug.statusCode).toBe(200);
    expect(currentSessionDebug.json().session.lines.join("\n")).toContain("DEBUG pino.log incoming request");
    expect(currentSessionDebug.json().session.lines.join("\n")).toContain("DEBUG pino.log request completed");
    expect(currentSessionDebug.json().session.lines.join("\n")).toContain('"msg":"incoming request"');
    expect(currentSessionDebug.json().session.lines.join("\n")).not.toContain("/admin/session/current");
    expect(currentSessionDebug.json().session.lines.join("\n")).not.toContain("/admin/session/keywords");

    const currentSessionWithPolling = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=50&level=debug&includeAdminPolling=true",
      headers: authHeaders
    });
    expect(currentSessionWithPolling.statusCode).toBe(200);
    expect(currentSessionWithPolling.json().session.lines.join("\n")).toContain("/admin/session/current");
    expect(currentSessionWithPolling.json().session.lines.join("\n")).toContain("/admin/session/keywords");
    expect(currentSessionWithPolling.json().session.lines).toContain("");

    fs.appendFileSync(
      currentSessionFilePath,
      `[2026-05-02T11:59:59.000Z] INFO vpn.diagnostics.completed VPN checks passed ${JSON.stringify({
        checksPassed: true,
        status: "passed",
        hostPublicIpv4: "37.67.185.138",
        namespacePublicIpv4: "135.136.39.68",
        playwrightIpify: "135.136.39.68",
        failures: []
      })}\n`,
      "utf8"
    );

    const currentSessionVpn = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=info",
      headers: authHeaders
    });
    expect(currentSessionVpn.statusCode).toBe(200);
    const vpnLog = currentSessionVpn.json().session.lines.join("\n");
    expect(vpnLog).toContain("VPN checks passed");
    expect(vpnLog).toContain('"checksPassed": true');
    expect(vpnLog).toContain('"namespacePublicIpv4": "135.136.39.68"');

    fs.appendFileSync(
      currentSessionFilePath,
      `[2026-05-02T12:00:00.000Z] DEBUG tweet.received Tweet received ${JSON.stringify({
        tweetId: "tweet-1",
        author: "@alice",
        keyword: "security",
        accepted: true,
        createdAt: "2026-05-02T10:00:00.000Z",
        score: 42,
        reasons: [],
        favoriteCount: 7,
        retweetCount: 3,
        text: "tweet body"
      })}\n`,
      "utf8"
    );

    const currentSessionTweetHidden = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=debug",
      headers: authHeaders
    });
    expect(currentSessionTweetHidden.statusCode).toBe(200);
    expect(currentSessionTweetHidden.json().session.lines.join("\n")).not.toContain("tweet-1");

    const currentSessionTweetScore = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=info&includeTweetScore=true&includeTweetFavoriteCount=true",
      headers: authHeaders
    });
    expect(currentSessionTweetScore.statusCode).toBe(200);
    const tweetScoreLog = currentSessionTweetScore.json().session.lines.join("\n");
    expect(tweetScoreLog).toContain("tweet-1");
    expect(tweetScoreLog).toContain('"score": 42');
    expect(tweetScoreLog).toContain('"favoriteCount": 7');
    expect(tweetScoreLog).not.toContain("tweet body");
    expect(tweetScoreLog).not.toContain('"retweetCount": 3');

    const currentSessionTweetText = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=info&includeTweetContent=true",
      headers: authHeaders
    });
    expect(currentSessionTweetText.statusCode).toBe(200);
    expect(currentSessionTweetText.json().session.lines.join("\n")).toContain("tweet body");

    fs.appendFileSync(
      currentSessionFilePath,
      `[2026-05-02T12:00:01.000Z] DEBUG tweet.prefilter_rejected Tweet rejected before hydration ${JSON.stringify({
        tweetId: "tweet-2",
        author: "@bob",
        keyword: "security",
        accepted: false,
        createdAt: "2026-05-02T10:01:00.000Z",
        reasons: ["prefilter_rejected"],
        favoriteCount: 0,
        retweetCount: 0,
        text: "prefilter body"
      })}\n`,
      "utf8"
    );

    const currentSessionPrefilterHidden = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=debug",
      headers: authHeaders
    });
    expect(currentSessionPrefilterHidden.statusCode).toBe(200);
    expect(currentSessionPrefilterHidden.json().session.lines.join("\n")).not.toContain("prefilter body");

    const currentSessionPrefilterText = await app.inject({
      method: "GET",
      url: "/admin/session/current?limit=20&level=debug&includeTweetContent=true",
      headers: authHeaders
    });
    expect(currentSessionPrefilterText.statusCode).toBe(200);
    const prefilterTextLog = currentSessionPrefilterText.json().session.lines.join("\n");
    expect(prefilterTextLog).toContain("tweet.prefilter_rejected");
    expect(prefilterTextLog).toContain("prefilter body");
    expect(prefilterTextLog).toContain("\n\n[");

    const likeWithoutWrite = await app.inject({
      method: "POST",
      url: "/admin/tweets/1234567890/like",
      headers: authHeaders
    });
    expect(likeWithoutWrite.statusCode).toBe(403);

    const runStop = await app.inject({
      method: "POST",
      url: "/admin/runs/current/stop",
      headers: authHeaders
    });
    expect(runStop.statusCode).toBe(200);
    expect(runStop.json().run.status).toBe("stopped");

    const noActiveRun = await app.inject({
      method: "GET",
      url: "/admin/runs/current",
      headers: authHeaders
    });
    expect(noActiveRun.statusCode).toBe(200);
    expect(noActiveRun.json().run).toBeNull();

    const envDefaults = await app.inject({
      method: "GET",
      url: "/admin/env",
      headers: authHeaders
    });
    expect(envDefaults.statusCode).toBe(200);
    expect(envDefaults.json().values).toMatchObject({
      ADMIN_HOST: "127.0.0.1",
      ADMIN_PORT: "3005",
      ADMIN_IPV4_WHITELIST: "",
      ADMIN_IPV4_BLACKLIST: "",
      ENABLE_X_WRITE: "false"
    });

    const envUpdate = await app.inject({
      method: "PATCH",
      url: "/admin/env",
      headers: authHeaders,
      payload: {
        values: {
          ADMIN_HOST: "0.0.0.0",
          ADMIN_PORT: "3006",
          ADMIN_PASSWORD: "secret",
          SESSION_SECRET: "test-session-secret",
          DATABASE_URL: "./redqueenx.sqlite",
          ADMIN_IPV4_WHITELIST: "127.0.0.1,192.0.2.0/24",
          ADMIN_IPV4_BLACKLIST: "203.0.113.10/32;198.51.100.9",
          X_BEARER_TOKEN: "bearer",
          X_API_KEY: "api-key",
          X_API_SECRET: "api-secret",
          X_ACCESS_TOKEN: "access-token",
          X_ACCESS_SECRET: "access-secret",
          ENABLE_X_WRITE: "true",
          X_CLIENT_ID: "client-id",
          X_CLIENT_SECRET: "client-secret"
        }
      }
    });
    expect(envUpdate.statusCode).toBe(200);
    expect(envUpdate.json()).toMatchObject({
      restartRequired: true,
      restartScheduled: true,
      values: {
        ADMIN_HOST: "0.0.0.0",
        ADMIN_IPV4_WHITELIST: "127.0.0.1,192.0.2.0/24",
        ENABLE_X_WRITE: "true",
        X_CLIENT_ID: "client-id"
      }
    });
    expect(fs.readFileSync(envPath, "utf8")).toContain("X_CLIENT_SECRET=client-secret");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fs.statSync(restartSignalPath).mtimeMs).toBeGreaterThan(oldSignalDate.getTime());

    const importFiles = await app.inject({
      method: "GET",
      url: "/admin/import/files",
      headers: authHeaders
    });
    expect(importFiles.statusCode).toBe(200);
    expect(importFiles.json().files).toEqual(
      expect.arrayContaining([expect.objectContaining({ filename: "Rq.Keywords", exists: true })])
    );

    const importAll = await app.inject({
      method: "POST",
      url: "/admin/import/legacy",
      headers: authHeaders,
      payload: {}
    });
    expect(importAll.statusCode).toBe(200);
    expect(importAll.json().files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "Rq.Keywords", status: "imported", totalLines: 3, importedLines: 3 })
      ])
    );

    const add = await app.inject({
      method: "POST",
      url: "/admin/lists/keyword",
      headers: authHeaders,
      payload: { value: "xss" }
    });
    expect(add.statusCode).toBe(200);

    const removableKeyword = await app.inject({
      method: "POST",
      url: "/admin/lists/keyword",
      headers: authHeaders,
      payload: { value: "RemoveMe" }
    });
    expect(removableKeyword.statusCode).toBe(200);
    const banMatchingKeyword = await app.inject({
      method: "POST",
      url: "/admin/lists/banned_word",
      headers: authHeaders,
      payload: { value: " removeme " }
    });
    expect(banMatchingKeyword.statusCode).toBe(200);
    expect(banMatchingKeyword.json().removedKeywords).toBe(1);
    const keywordsAfterBan = await app.inject({
      method: "GET",
      url: "/admin/lists/keyword?limit=100",
      headers: authHeaders
    });
    expect(keywordsAfterBan.statusCode).toBe(200);
    expect(keywordsAfterBan.json().entries.map((entry: { rawValue: string }) => entry.rawValue)).not.toContain("RemoveMe");

    const staleUser = await app.inject({
      method: "POST",
      url: "/admin/lists/stale_keyword_user",
      headers: authHeaders,
      payload: { value: "@old_user" }
    });
    expect(staleUser.statusCode).toBe(200);
    const restoredStaleUser = await app.inject({
      method: "POST",
      url: `/admin/lists/stale_keyword_user/${staleUser.json().entry.id}/restore-keyword`,
      headers: authHeaders
    });
    expect(restoredStaleUser.statusCode).toBe(200);
    expect(restoredStaleUser.json().entry.rawValue).toBe("@old_user");
    expect(restoredStaleUser.json().deletedFromStaleList).toBe(1);
    const staleAfterRestore = await app.inject({
      method: "GET",
      url: "/admin/lists/stale_keyword_user",
      headers: authHeaders
    });
    expect(staleAfterRestore.statusCode).toBe(200);
    expect(staleAfterRestore.json().entries).toEqual([]);
    const deleteRestoredKeyword = await app.inject({
      method: "DELETE",
      url: "/admin/lists/keyword",
      headers: authHeaders,
      payload: { value: "@old_user" }
    });
    expect(deleteRestoredKeyword.statusCode).toBe(200);
    expect(deleteRestoredKeyword.json().deleted).toBe(1);

    const skippedUser = await app.inject({
      method: "POST",
      url: "/admin/lists/skipped_keyword_user",
      headers: authHeaders,
      payload: { value: "@skip_to_stale" }
    });
    expect(skippedUser.statusCode).toBe(200);
    const skippedKeyword = await app.inject({
      method: "POST",
      url: "/admin/lists/keyword",
      headers: authHeaders,
      payload: { value: "@skip_to_stale" }
    });
    expect(skippedKeyword.statusCode).toBe(200);
    const movedSkippedUser = await app.inject({
      method: "POST",
      url: `/admin/lists/skipped_keyword_user/${skippedUser.json().entry.id}/move-to-stale`,
      headers: authHeaders
    });
    expect(movedSkippedUser.statusCode).toBe(200);
    expect(movedSkippedUser.json().entry.rawValue).toBe("@skip_to_stale");
    expect(movedSkippedUser.json().deletedFromKeywords).toBe(1);
    expect(movedSkippedUser.json().deletedFromSkippedList).toBe(1);
    const skippedAfterMove = await app.inject({
      method: "GET",
      url: "/admin/lists/skipped_keyword_user",
      headers: authHeaders
    });
    expect(skippedAfterMove.statusCode).toBe(200);
    expect(skippedAfterMove.json().entries).toEqual([]);
    const staleAfterSkippedMove = await app.inject({
      method: "GET",
      url: "/admin/lists/stale_keyword_user?limit=100",
      headers: authHeaders
    });
    expect(staleAfterSkippedMove.statusCode).toBe(200);
    expect(staleAfterSkippedMove.json().entries.map((entry: { rawValue: string }) => entry.rawValue)).toContain("@skip_to_stale");

    const suggestedKeyword = await app.inject({
      method: "POST",
      url: "/admin/lists/suggested_keyword",
      headers: authHeaders,
      payload: { value: "suggested exploit" }
    });
    expect(suggestedKeyword.statusCode).toBe(200);
    const promotedSuggestedKeyword = await app.inject({
      method: "POST",
      url: `/admin/lists/suggested_keyword/${suggestedKeyword.json().entry.id}/promote-keyword`,
      headers: authHeaders
    });
    expect(promotedSuggestedKeyword.statusCode).toBe(200);
    expect(promotedSuggestedKeyword.json().entry.rawValue).toBe("suggested exploit");
    expect(promotedSuggestedKeyword.json().deletedFromSuggestedList).toBe(1);
    expect(
      database.prepare("SELECT raw_value FROM list_entries WHERE kind = 'keyword' AND raw_value = ? AND is_deleted = 0").get(
        "suggested exploit"
      )
    ).toEqual({ raw_value: "suggested exploit" });

    const suggestedKeywordOne = await app.inject({
      method: "POST",
      url: "/admin/lists/suggested_keyword",
      headers: authHeaders,
      payload: { value: "suggested one" }
    });
    expect(suggestedKeywordOne.statusCode).toBe(200);
    const suggestedKeywordTwo = await app.inject({
      method: "POST",
      url: "/admin/lists/suggested_keyword",
      headers: authHeaders,
      payload: { value: "suggested two" }
    });
    expect(suggestedKeywordTwo.statusCode).toBe(200);
    const promotedAllSuggestedKeywords = await app.inject({
      method: "POST",
      url: "/admin/lists/suggested_keyword/promote-all",
      headers: authHeaders
    });
    expect(promotedAllSuggestedKeywords.statusCode).toBe(200);
    expect(promotedAllSuggestedKeywords.json()).toMatchObject({ promoted: 3, deletedFromSuggestedList: 3 });
    const suggestedAfterPromoteAll = await app.inject({
      method: "GET",
      url: "/admin/lists/suggested_keyword",
      headers: authHeaders
    });
    expect(suggestedAfterPromoteAll.statusCode).toBe(200);
    expect(suggestedAfterPromoteAll.json().entries).toEqual([]);
    for (const promotedKeyword of ["timeline suggestion", "suggested exploit", "suggested one", "suggested two"]) {
      const deletedPromotedKeyword = await app.inject({
        method: "DELETE",
        url: "/admin/lists/keyword",
        headers: authHeaders,
        payload: { value: promotedKeyword }
      });
      expect(deletedPromotedKeyword.statusCode).toBe(200);
      expect(deletedPromotedKeyword.json().deleted).toBe(1);
    }

    const activeCleanupKeyword = await app.inject({
      method: "POST",
      url: "/admin/lists/keyword",
      headers: authHeaders,
      payload: { value: "@cleanup_user" }
    });
    expect(activeCleanupKeyword.statusCode).toBe(200);
    const staleCleanupUser = await app.inject({
      method: "POST",
      url: "/admin/lists/stale_keyword_user",
      headers: authHeaders,
      payload: { value: "cleanup_user" }
    });
    expect(staleCleanupUser.statusCode).toBe(200);
    const cleanupLists = await app.inject({
      method: "POST",
      url: "/admin/lists/maintenance/cleanup",
      headers: authHeaders
    });
    expect(cleanupLists.statusCode).toBe(200);
    expect(cleanupLists.json()).toMatchObject({
      staleActiveKeywordsDeleted: 1
    });
    expect(cleanupLists.json().totalDeleted).toBeGreaterThanOrEqual(1);
    const deleteCleanupKeyword = await app.inject({
      method: "DELETE",
      url: "/admin/lists/keyword",
      headers: authHeaders,
      payload: { value: "@cleanup_user" }
    });
    expect(deleteCleanupKeyword.statusCode).toBe(200);
    expect(deleteCleanupKeyword.json().deleted).toBe(1);

    const command = await app.inject({
      method: "POST",
      url: "/admin/command",
      headers: authHeaders,
      payload: { command: "bankeyword:xss;!start" }
    });
    expect(command.statusCode).toBe(200);
    expect(command.json().messages).toContain("Banned 1 keyword.");

    const imported = await app.inject({
      method: "POST",
      url: "/admin/import/legacy",
      headers: authHeaders,
      payload: { filename: "Rq.Keywords" }
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().files[0]).toMatchObject({ filename: "Rq.Keywords", totalLines: 3, importedLines: 3 });

    const uploadedImport = await app.inject({
      method: "POST",
      url: "/admin/import/content",
      headers: authHeaders,
      payload: {
        filename: "RssSave",
        kind: "rss_sent",
        content: "Title : https://example.test/rss\nNo URL"
      }
    });
    expect(uploadedImport.statusCode).toBe(200);
    expect(uploadedImport.json().files[0]).toMatchObject({
      filename: "RssSave",
      sourceFile: "uploaded:RssSave",
      kind: "rss_sent",
      totalLines: 2,
      importedLines: 2,
      derived: [expect.objectContaining({ kind: "rss_feed", importedLines: 1 })]
    });

    const rssPage = await app.inject({
      method: "GET",
      url: "/admin/lists/rss_feed?limit=10",
      headers: authHeaders
    });
    expect(rssPage.statusCode).toBe(200);
    expect(rssPage.json().entries.map((entry: { rawValue: string }) => entry.rawValue)).toEqual([
      "https://example.test/rss"
    ]);

    const uploadedNoResult = await app.inject({
      method: "POST",
      url: "/admin/import/content",
      headers: authHeaders,
      payload: {
        filename: "No.Result",
        kind: "no_result",
        content: "one\nanother miss"
      }
    });
    expect(uploadedNoResult.statusCode).toBe(200);
    expect(uploadedNoResult.json().files[0]).toMatchObject({
      filename: "No.Result",
      kind: "no_result",
      totalLines: 2,
      importedLines: 2
    });

    const uploadedSearchTermsUsed = await app.inject({
      method: "POST",
      url: "/admin/import/content",
      headers: authHeaders,
      payload: {
        filename: "SearchTerms.Used",
        kind: "search_terms_used",
        content: "two\noutside keyword list"
      }
    });
    expect(uploadedSearchTermsUsed.statusCode).toBe(200);
    expect(uploadedSearchTermsUsed.json().files[0]).toMatchObject({
      filename: "SearchTerms.Used",
      kind: "search_terms_used",
      totalLines: 2,
      importedLines: 2
    });

    const databaseOverview = await app.inject({
      method: "GET",
      url: "/admin/database/overview",
      headers: authHeaders
    });
    expect(databaseOverview.statusCode).toBe(200);
    expect(databaseOverview.json().database).toMatchObject({
      pageSize: expect.any(Number),
      pageCount: expect.any(Number)
    });
    expect(databaseOverview.json().tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "list_entries",
          rowCount: expect.any(Number),
          indexCount: expect.any(Number)
        })
      ])
    );

    const listEntriesDetail = await app.inject({
      method: "GET",
      url: "/admin/database/tables/list_entries?limit=2",
      headers: authHeaders
    });
    expect(listEntriesDetail.statusCode).toBe(200);
    expect(listEntriesDetail.json()).toMatchObject({
      name: "list_entries",
      columns: expect.arrayContaining([expect.objectContaining({ name: "kind" })]),
      sampleRows: expect.any(Array)
    });
    expect(listEntriesDetail.json().sampleRows.length).toBeLessThanOrEqual(2);

    const exportJson = await app.inject({
      method: "GET",
      url: "/admin/database/tables/list_entries/export?format=json",
      headers: authHeaders
    });
    expect(exportJson.statusCode).toBe(200);
    expect(exportJson.headers["content-type"]).toContain("application/json");
    expect(exportJson.headers["content-disposition"]).toContain("list_entries.json");
    expect(JSON.parse(exportJson.body)).toEqual(expect.any(Array));

    const exportCsv = await app.inject({
      method: "GET",
      url: "/admin/database/tables/list_entries/export?format=csv",
      headers: authHeaders
    });
    expect(exportCsv.statusCode).toBe(200);
    expect(exportCsv.headers["content-type"]).toContain("text/csv");
    expect(exportCsv.headers["content-disposition"]).toContain("list_entries.csv");
    expect(exportCsv.body).toContain('"id","kind"');

    const wrongClear = await app.inject({
      method: "POST",
      url: "/admin/database/tables/legacy_import_audit/clear",
      headers: authHeaders,
      payload: { confirm: "wrong-table" }
    });
    expect(wrongClear.statusCode).toBe(400);

    const clearAudit = await app.inject({
      method: "POST",
      url: "/admin/database/tables/legacy_import_audit/clear",
      headers: authHeaders,
      payload: { confirm: "legacy_import_audit" }
    });
    expect(clearAudit.statusCode).toBe(200);
    expect(clearAudit.json()).toMatchObject({
      table: "legacy_import_audit",
      deletedRows: expect.any(Number)
    });

    const clearedAuditDetail = await app.inject({
      method: "GET",
      url: "/admin/database/tables/legacy_import_audit",
      headers: authHeaders
    });
    expect(clearedAuditDetail.statusCode).toBe(200);
    expect(clearedAuditDetail.json().rowCount).toBe(0);

    const integrityCheck = await app.inject({
      method: "POST",
      url: "/admin/database/integrity-check",
      headers: authHeaders
    });
    expect(integrityCheck.statusCode).toBe(200);
    expect(integrityCheck.json()).toMatchObject({ ok: true });

    const analyze = await app.inject({
      method: "POST",
      url: "/admin/database/analyze",
      headers: authHeaders
    });
    expect(analyze.statusCode).toBe(200);
    expect(analyze.json()).toEqual({ ok: true });

    const listPage = await app.inject({
      method: "GET",
      url: "/admin/lists/keyword?limit=2&offset=1",
      headers: authHeaders
    });
    expect(listPage.statusCode).toBe(200);
    expect(listPage.json().entries).toHaveLength(2);
    expect(listPage.json().pagination).toMatchObject({
      total: 3,
      limit: 2,
      offset: 1,
      hasMore: false
    });

    const filteredListPage = await app.inject({
      method: "GET",
      url: "/admin/lists/keyword?search=two",
      headers: authHeaders
    });
    expect(filteredListPage.statusCode).toBe(200);
    expect(filteredListPage.json().entries.map((entry: { rawValue: string }) => entry.rawValue)).toEqual(["two"]);
    expect(filteredListPage.json().pagination.total).toBe(1);

    const noResultEntry = await app.inject({
      method: "POST",
      url: "/admin/lists/no_result",
      headers: authHeaders,
      payload: { value: "two missing elsewhere" }
    });
    expect(noResultEntry.statusCode).toBe(200);

    const globalListSearch = await app.inject({
      method: "GET",
      url: "/admin/lists/search?q=two",
      headers: authHeaders
    });
    expect(globalListSearch.statusCode).toBe(200);
    expect(globalListSearch.json().total).toBeGreaterThanOrEqual(2);
    expect(globalListSearch.json().groups.map((group: { kind: string }) => group.kind)).toEqual(
      expect.arrayContaining(["keyword", "no_result"])
    );
    const deletedNoResultEntry = await app.inject({
      method: "DELETE",
      url: `/admin/lists/no_result/${noResultEntry.json().entry.id}`,
      headers: authHeaders
    });
    expect(deletedNoResultEntry.statusCode).toBe(200);

    const exportedKeywordList = await app.inject({
      method: "GET",
      url: "/admin/lists/keyword/export",
      headers: authHeaders
    });
    expect(exportedKeywordList.statusCode).toBe(200);
    expect(exportedKeywordList.headers["content-type"]).toContain("text/plain");
    expect(exportedKeywordList.headers["content-disposition"]).toContain('filename="Rq.Keywords"');
    expect(exportedKeywordList.body).toContain("one\n");
    expect(exportedKeywordList.body).toContain("two\n");

    const editedId = listPage.json().entries[0].id;
    const edited = await app.inject({
      method: "PATCH",
      url: `/admin/lists/keyword/${editedId}`,
      headers: authHeaders,
      payload: { value: "edited-keyword" }
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().entry.rawValue).toBe("edited-keyword");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/admin/lists/keyword/${editedId}`,
      headers: authHeaders
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(1);

    database.prepare("DELETE FROM timeline_tweets").run();
    timelineService.saveAcceptedManual({
      keyword: "timeline-import",
      text: "timeline export me",
      tweetId: "999001",
      author: "@timeline",
      authorName: "Timeline User",
      tweetUrl: "https://twitter.com/i/web/status/999001",
      tweetCreatedAt: "2026-05-11T10:00:00.000Z",
      retweetCount: 7,
      favoriteCount: 11,
      score: 22,
      reasons: ["manual_seed"]
    });
    const exportedTimeline = await app.inject({
      method: "GET",
      url: "/admin/timeline/export",
      headers: authHeaders
    });
    expect(exportedTimeline.statusCode).toBe(200);
    expect(exportedTimeline.headers["content-type"]).toContain("application/x-ndjson");
    expect(exportedTimeline.headers["content-disposition"]).toContain('filename="Timeline.Tweets.jsonl"');
    expect(exportedTimeline.body).toContain('"tweetId":"999001"');

    database.prepare("DELETE FROM timeline_tweets").run();
    const importedTimeline = await app.inject({
      method: "POST",
      url: "/admin/import/content",
      headers: authHeaders,
      payload: {
        filename: "Timeline.Tweets.jsonl",
        kind: "timeline_tweets",
        content: exportedTimeline.body
      }
    });
    expect(importedTimeline.statusCode).toBe(200);
    expect(importedTimeline.json().files[0]).toMatchObject({
      filename: "Timeline.Tweets.jsonl",
      kind: "timeline_tweets",
      totalLines: 1,
      importedLines: 1
    });

    const timelineAfterImport = await app.inject({ method: "GET", url: "/timeline/data", headers: authHeaders });
    expect(timelineAfterImport.statusCode).toBe(200);
    expect(timelineAfterImport.json().pagination).toMatchObject({
      total: expect.any(Number),
      limit: 50,
      offset: 0,
      hasMore: expect.any(Boolean)
    });
    expect(timelineAfterImport.json().items[0]).toMatchObject({
      tweetId: "999001",
      keyword: "timeline-import",
      score: 22
    });

    const stats = await app.inject({ method: "GET", url: "/admin/stats", headers: authHeaders });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().currentRun.status).toBe("running");
    expect(stats.json().lists).toMatchObject({
      no_result: 2,
      rss_sent: 2,
      rss_feed: 1,
      search_terms_used: 2
    });
    expect(stats.json().searchWithoutApi).toMatchObject({
      keywordTotal: expect.any(Number),
      noResultKeywords: 2,
      searchTermsUsedKeywords: 2,
      excludedNoResultKeywords: expect.any(Number),
      excludedAlreadySearchedKeywords: expect.any(Number),
      availableKeywords: expect.any(Number)
    });

	    const resetNoResults = await app.inject({
	      method: "POST",
	      url: "/admin/settings/no-results/reset",
	      headers: authHeaders
	    });
    expect(resetNoResults.statusCode).toBe(200);
    expect(resetNoResults.json()).toEqual({ deleted: 2 });

    const noResultsAfterReset = await app.inject({
      method: "GET",
      url: "/admin/lists/no_result",
      headers: authHeaders
    });
    expect(noResultsAfterReset.statusCode).toBe(200);
    expect(noResultsAfterReset.json().entries).toEqual([]);

    const currentRunId = stats.json().currentRun.id;
    const today = new Date().toISOString().slice(0, 10);
    database
      .prepare(
        `
          INSERT INTO x_budget_usage (
            usage_date,
            search_calls,
            count_calls,
            post_reads,
            user_reads,
            media_reads,
            user_interactions,
            estimated_cost_usd
          )
          VALUES (?, 3, 2, 12, 4, 1, 1, 1.23)
        `
      )
      .run(today);
    database
      .prepare(
        `
          INSERT INTO x_run_budget_usage (
            run_id,
            search_calls,
            count_calls,
            post_reads,
            user_reads,
            media_reads,
            user_interactions,
            estimated_cost_usd
          )
          VALUES (?, 3, 2, 12, 4, 1, 1, 1.23)
        `
      )
      .run(currentRunId);

    const resetXCounters = await app.inject({
      method: "POST",
      url: "/admin/settings/x-counters/reset",
      headers: authHeaders
    });
    expect(resetXCounters.statusCode).toBe(200);
    expect(resetXCounters.json()).toMatchObject({
      budget: {
        searchCalls: 0,
        countCalls: 0,
        postReads: 0,
        userReads: 0,
        mediaReads: 0,
        userInteractions: 0,
        estimatedCostUsd: 1.23,
        runEstimatedCostUsd: 1.23
      }
    });

    const resetXBudget = await app.inject({
      method: "POST",
      url: "/admin/settings/x-budget/reset",
      headers: authHeaders
    });
    expect(resetXBudget.statusCode).toBe(200);
    expect(resetXBudget.json()).toMatchObject({
      budget: {
        searchCalls: 0,
        postReads: 0
      }
    });

    await app.close();
  });

  it("applies server access rules to the forwarded client IP when trust proxy is enabled", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-api-proxy-"));
    const currentSessionFilePath = path.join(tmp, "current-session.log");
    const config = loadConfig({
      ADMIN_PASSWORD: "secret",
      SESSION_SECRET: "test-session-secret",
      CURRENT_SESSION_FILE: currentSessionFilePath,
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      ADMIN_TRUST_PROXY: "true",
      ADMIN_IPV4_WHITELIST: "203.0.113.5/32",
      ADMIN_IPV4_BLACKLIST: ""
    });
    const app = createAdminApi({
      database: openMemoryDatabase(),
      config,
      envPath: path.join(tmp, ".env"),
      currentSessionFilePath,
      restartDelayMs: 0
    });

    try {
      const allowed = await app.inject({
        method: "POST",
        url: "/admin/login",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.5" },
        payload: { username: "admin", password: "secret" }
      });
      expect(allowed.statusCode).toBe(200);

      const blocked = await app.inject({
        method: "POST",
        url: "/admin/login",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "198.51.100.7" },
        payload: { username: "admin", password: "secret" }
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toEqual({ error: "Forbidden by RedqueenX access policy" });
    } finally {
      await app.close();
    }
  });
});
