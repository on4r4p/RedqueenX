import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAdminApi } from "../src/admin/api";
import { MediaCacheService } from "../src/admin/mediaCacheService";
import { TimelineTweetService } from "../src/admin/timelineTweetService";
import { XBrowserAccountService } from "../src/admin/xBrowserAccountService";
import { XSessionAlertService } from "../src/admin/xSessionAlertService";
import { loadConfig } from "../src/config";
import { openMemoryDatabase } from "../src/db/database";
import type { ScoreDecision, TweetCandidate } from "../src/types";
import { clearStaleChromiumProfileLocks } from "../src/worker/chromiumProfileLock";
import { shouldDisableChromiumSandbox } from "../src/worker/chromiumSandbox";
import { sanitizeXLoginChromeArgs, summarizeXLoginApiError, x11SocketPath } from "../src/worker/xLogin";

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

describe("docker_vpn isolation", () => {
  it("keeps host_netns as the default isolation backend", () => {
    expect(loadConfig({}).searchWithoutApiIsolation).toBe("host_netns");
  });

  it("refuses to switch to docker_vpn while the legacy rqvpn-host interface exists", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-docker-vpn-switch-"));
    const currentSessionFile = path.join(tmp, "current-session.log");
    const envPath = path.join(tmp, ".env");
    const fakeBinDir = path.join(tmp, "bin");
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.writeFileSync(envPath, "", "utf8");
    fs.writeFileSync(
      path.join(fakeBinDir, "ip"),
      `#!/bin/sh
if [ "$1" = "link" ] && [ "$2" = "show" ] && [ "$3" = "rqvpn-host" ]; then
  echo "5: rqvpn-host@if4: <BROADCAST,MULTICAST,UP,LOWER_UP>"
  exit 0
fi
echo "unexpected ip call: $*" >&2
exit 1
`,
      "utf8"
    );
    fs.chmodSync(path.join(fakeBinDir, "ip"), 0o755);

    const config = loadConfig({
      ADMIN_PASSWORD: "secret",
      SESSION_SECRET: "test-session-secret",
      CURRENT_SESSION_FILE: currentSessionFile,
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      X_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ISOLATION: "host_netns"
    });
    const database = openMemoryDatabase();
    const app = createAdminApi({
      database,
      config,
      envPath,
      currentSessionFilePath: currentSessionFile,
      restartDelayMs: 0
    });
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;

    try {
      const login = await app.inject({ method: "POST", url: "/admin/login", payload: { username: "admin", password: "secret" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      const authHeaders = authHeadersFromSetCookie(cookie);

      const response = await app.inject({
        method: "PATCH",
        url: "/admin/settings/x-api",
        headers: authHeaders,
        payload: { values: { SEARCH_WITHOUT_API_ISOLATION: "docker_vpn" } }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: expect.stringContaining("rqvpn-host"),
        legacyNetns: {
          interfaceName: "rqvpn-host",
          checked: true,
          present: true
        }
      });

      const current = await app.inject({
        method: "GET",
        url: "/admin/settings/x-api",
        headers: authHeaders
      });
      expect(current.statusCode).toBe(200);
      expect(current.json().config.searchWithoutApiIsolation).toBe("host_netns");
      expect(fs.readFileSync(envPath, "utf8")).not.toContain("SEARCH_WITHOUT_API_ISOLATION=docker_vpn");
    } finally {
      process.env.PATH = originalPath;
      await app.close();
    }
  });

  it("parses admin IPv4 whitelist and blacklist from env lists", () => {
    const config = loadConfig({
      ADMIN_IPV4_WHITELIST: "192.168.0.1/24,127.0.0.1 37.67.185.138/32",
      ADMIN_IPV4_BLACKLIST: "203.0.113.10;198.51.100.0/24"
    });

    expect(config.adminIpv4Whitelist).toEqual(["192.168.0.1/24", "127.0.0.1", "37.67.185.138/32"]);
    expect(config.adminIpv4Blacklist).toEqual(["203.0.113.10", "198.51.100.0/24"]);
  });

  it("does not require a local X11 socket for Docker or SSH TCP displays", () => {
    expect(x11SocketPath("172.17.0.1:0.0")).toBeUndefined();
    expect(x11SocketPath("localhost:10.0")).toBeUndefined();
    expect(x11SocketPath(":0")).toBe("/tmp/.X11-unix/X0");
    expect(x11SocketPath("unix:1.0")).toBe("/tmp/.X11-unix/X1");
  });

  it("removes unsupported anti-automation flags from visible Docker x-login", () => {
    expect(sanitizeXLoginChromeArgs(["--ozone-platform=x11", "--disable-blink-features=AutomationControlled"])).toEqual([
      "--ozone-platform=x11"
    ]);
  });

  it("prints only sanitized X login API error details", () => {
    const detail = summarizeXLoginApiError(
      JSON.stringify({
        errors: [{ code: 366, message: "Bad flow token g;177866619941009045:-1778666201427:LzIDRsrl22PJPOX1miicgQRi:1" }]
      })
    );

    expect(detail).toBe("code 366: Bad flow token [redacted]");
  });

  it("keeps Chromium sandbox enabled for non-root Docker VPN containers", () => {
    expect(shouldDisableChromiumSandbox(true, { REDQUEENX_DOCKER_VPN: "true" }, 1000)).toBe(false);
    expect(shouldDisableChromiumSandbox(true, { SEARCH_WITHOUT_API_ISOLATION: "docker_vpn" }, 1000)).toBe(false);
    expect(shouldDisableChromiumSandbox(true, { REDQUEENX_CHROMIUM_SANDBOX_UNAVAILABLE: "true" }, 1000)).toBe(true);
    expect(shouldDisableChromiumSandbox(true, {}, 0)).toBe(true);
    expect(shouldDisableChromiumSandbox(true, {}, 1000)).toBe(false);
    expect(shouldDisableChromiumSandbox(false, { REDQUEENX_CHROMIUM_SANDBOX_UNAVAILABLE: "true" }, 1000)).toBe(false);
  });

  it("clears stale Chromium singleton locks left by failed Docker x-login attempts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-chromium-profile-"));
    fs.symlinkSync("old-container-49", path.join(tmp, "SingletonLock"));
    fs.symlinkSync("/tmp/redqueenx-missing-chrome/SingletonSocket", path.join(tmp, "SingletonSocket"));
    fs.symlinkSync("11691698302493908969", path.join(tmp, "SingletonCookie"));

    const removed = await clearStaleChromiumProfileLocks(tmp);

    expect(removed).toEqual(["SingletonLock", "SingletonSocket", "SingletonCookie"]);
    expect(fs.existsSync(path.join(tmp, "SingletonLock"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "SingletonSocket"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "SingletonCookie"))).toBe(false);
  });

  it("keeps Chromium singleton locks when they point at the current process", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-chromium-active-profile-"));
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(tmp, "SingletonLock"));

    const removed = await clearStaleChromiumProfileLocks(tmp);

    expect(removed).toEqual([]);
    expect(fs.lstatSync(path.join(tmp, "SingletonLock")).isSymbolicLink()).toBe(true);
  });

  it("queues media cache reloads instead of launching host netns scripts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-docker-vpn-"));
    const currentSessionFile = path.join(tmp, "current-session.log");
    const envPath = path.join(tmp, ".env");
    fs.writeFileSync(envPath, "", "utf8");

    const config = loadConfig({
      ADMIN_PASSWORD: "secret",
      SESSION_SECRET: "test-session-secret",
      CURRENT_SESSION_FILE: currentSessionFile,
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      X_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ISOLATION: "docker_vpn",
      SEARCH_WITHOUT_API_MEDIA_CACHE_ENABLED: "true",
      SEARCH_WITHOUT_API_MEDIA_CACHE_DIR: path.join(tmp, "media-cache")
    });
    const database = openMemoryDatabase();
    const timeline = new TimelineTweetService(database);
    timeline.saveAcceptedFromTest("cloudflare", testTweet(), testDecision());
    timeline.saveAcceptedFromTest("timeline", { ...testTweet(), id: "2050000000000000003" }, testDecision());
    timeline.saveAcceptedFromTest("hashflag", absTwimgTweet(), testDecision());
    const mediaCache = new MediaCacheService(database, {
      enabled: true,
      cacheDir: path.join(tmp, "media-cache"),
      ttlHours: 24,
      maxBytes: 10 * 1024 * 1024,
      maxFileBytes: 1024 * 1024
    });
    mediaCache.upsertFailure("https://abs.twimg.com/hashflags/test-image.png", "Refusing non-X media host abs.twimg.com.");

    const app = createAdminApi({
      database,
      config,
      envPath,
      currentSessionFilePath: currentSessionFile,
      restartDelayMs: 0
    });

    const login = await app.inject({ method: "POST", url: "/admin/login", payload: { username: "admin", password: "secret" } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    const authHeaders = authHeadersFromSetCookie(cookie);
    const createTimelineUser = await app.inject({
      method: "POST",
      url: "/admin/timeline-users",
      headers: authHeaders,
      payload: { username: "viewer", password: "viewer-password" }
    });
    expect(createTimelineUser.statusCode).toBe(200);
    const timelineLogin = await app.inject({
      method: "POST",
      url: "/timeline/login",
      payload: { username: "viewer", password: "viewer-password" }
    });
    expect(timelineLogin.statusCode).toBe(200);
    const timelineCookie = timelineLogin.headers["set-cookie"];
    const timelineHeaders = authHeadersFromSetCookie(timelineCookie);

    const reload = await app.inject({
      method: "POST",
      url: "/admin/tweets/2050000000000000001/media-cache/reload",
      headers: authHeaders
    });

    expect(reload.statusCode).toBe(200);
    expect(reload.json()).toMatchObject({ ok: true, queued: true, sourceCount: 2 });
    const jobs = database.prepare("SELECT tweet_id, status, source FROM media_cache_jobs").all() as Array<{
      tweet_id: string;
      status: string;
      source: string;
    }>;
    expect(jobs).toEqual([
      {
        tweet_id: "2050000000000000001",
        status: "pending",
        source: "admin_reload"
      }
    ]);

    const sessionLog = fs.readFileSync(currentSessionFile, "utf8");
    expect(sessionLog).toContain("media_cache.reload.queued");
    expect(sessionLog).not.toContain("netns:media-cache:fetch");

    const timelineReload = await app.inject({
      method: "POST",
      url: "/timeline/tweets/2050000000000000003/media-cache/reload",
      headers: timelineHeaders
    });
    expect(timelineReload.statusCode).toBe(200);
    expect(timelineReload.json()).toMatchObject({ ok: true, queued: true, sourceCount: 2 });
    const timelineJobStatus = await app.inject({
      method: "GET",
      url: `/timeline/media-cache/jobs/${timelineReload.json().jobId}`,
      headers: timelineHeaders
    });
    expect(timelineJobStatus.statusCode).toBe(200);
    expect(timelineJobStatus.json().job).toMatchObject({
      tweetId: "2050000000000000003",
      status: "pending"
    });
    const timelineJobs = database
      .prepare("SELECT tweet_id, status, source FROM media_cache_jobs WHERE source = 'timeline_reload'")
      .all() as Array<{
        tweet_id: string;
        status: string;
        source: string;
      }>;
    expect(timelineJobs).toEqual([
      {
        tweet_id: "2050000000000000003",
        status: "pending",
        source: "timeline_reload"
      }
    ]);

    const retry = await app.inject({
      method: "POST",
      url: "/admin/media-cache/retry-abs-twimg-failures",
      headers: authHeaders
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ ok: true, matched: 1, queued: 1, mode: "docker_vpn" });
    const retryJobs = database
      .prepare("SELECT tweet_id, status, source FROM media_cache_jobs WHERE source = 'retry_abs_twimg'")
      .all() as Array<{
        tweet_id: string;
        status: string;
        source: string;
      }>;
    expect(retryJobs).toEqual([
      {
        tweet_id: "2050000000000000002",
        status: "pending",
        source: "retry_abs_twimg"
      }
    ]);

    await app.close();
  });

  it("auto-ignores and restarts Docker stale keyword cleanup after a legacy X alert report", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-docker-stale-users-"));
    const currentSessionFile = path.join(tmp, "current-session.log");
    const envPath = path.join(tmp, ".env");
    const vpnProfilePath = `./runtime/test-vpn-${process.pid}-${Date.now()}.ovpn`;
    fs.writeFileSync(envPath, "", "utf8");

    const config = loadConfig({
      ADMIN_PASSWORD: "secret",
      SESSION_SECRET: "test-session-secret",
      CURRENT_SESSION_FILE: currentSessionFile,
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      VPN_CONFIG: vpnProfilePath,
      X_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ISOLATION: "docker_vpn",
      STALE_KEYWORD_USER_AUTO_IGNORE_ALERT: "true",
      STALE_KEYWORD_USER_MAX_RETRIES: "3"
    });
    const database = openMemoryDatabase();
    const accounts = new XBrowserAccountService(database);
    const alerts = new XSessionAlertService(database);
    const account = accounts.upsert({
      vpnProfilePath: config.vpnConfig,
      xIdentifier: "@docker_stale_cleanup"
    });
    fs.mkdirSync(path.dirname(path.resolve(account.storageStatePath)), { recursive: true });
    fs.writeFileSync(path.resolve(account.storageStatePath), JSON.stringify({ cookies: [], origins: [] }), "utf8");
    accounts.markLogin(account.id, "203.0.113.10");

    const app = createAdminApi({
      database,
      config,
      envPath,
      currentSessionFilePath: currentSessionFile,
      restartDelayMs: 0
    });

    let initialJob: { id: string; reportPath: string; resumeStatePath: string } | null = null;
    let restartedJob: { id: string; reportPath: string; resumeStatePath: string } | null = null;
    try {
      const login = await app.inject({ method: "POST", url: "/admin/login", payload: { username: "admin", password: "secret" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      const authHeaders = authHeadersFromSetCookie(cookie);

      const start = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale",
        headers: authHeaders,
        payload: { maxAgeDays: 90, autoIgnoreAlert: true, maxRetries: 3, autoRestartDelaySeconds: 12 }
      });
      expect(start.statusCode).toBe(202);
      initialJob = start.json().job.job;
      if (!initialJob) {
        throw new Error("Expected stale keyword cleanup job to be queued.");
      }
      const resumedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(initialJob.resumeStatePath), { recursive: true });
      fs.writeFileSync(
        initialJob.resumeStatePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: resumedAt,
            checkedUsers: [
              {
                keyword: "@already_checked",
                handle: "already_checked",
                status: "keep",
                jobId: initialJob.id,
                checkedAt: resumedAt
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const alert = alerts.createOpen({
        accountId: account.id,
        xIdentifier: account.xIdentifier,
        vpnProfilePath: account.vpnProfilePath,
        publicIpv4: "203.0.113.10",
        alertType: "x_blocked"
      });
      const completedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(initialJob.reportPath), { recursive: true });
      fs.writeFileSync(
        initialJob.reportPath,
        `${JSON.stringify(
          {
            jobId: initialJob.id,
            status: "failed",
            maxAgeDays: 90,
            startedAt: completedAt,
            completedAt,
            account: account.xIdentifier,
            vpnProfilePath: account.vpnProfilePath,
            publicIpv4: "203.0.113.10",
            totalCandidates: 4044,
            processedCandidates: 42,
            startIndex: 1,
            skippedBeforeStartIndex: 0,
            removedUsers: [],
            keptUsers: [],
            skippedUsers: [],
            blockedKeyword: "@stuck_user",
            error: "X returned a blocking error page: Something went wrong."
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const current = await app.inject({
        method: "GET",
        url: "/admin/keyword-users/prune-stale/current",
        headers: authHeaders
      });
      expect(current.statusCode).toBe(200);
      restartedJob = current.json().job;
      if (!restartedJob) {
        throw new Error("Expected stale keyword cleanup job to restart.");
      }
      expect(restartedJob.id).not.toBe(initialJob.id);
      expect(restartedJob).toMatchObject({
        status: "running",
        restartCount: 1,
        autoIgnoreAlert: true,
        maxRetries: 3,
        autoRestartDelaySeconds: 12,
        startIndex: 43
      });
      expect(restartedJob.resumeStatePath).not.toBe(initialJob.resumeStatePath);
      expect(JSON.parse(fs.readFileSync(initialJob.reportPath, "utf8"))).toMatchObject({
        status: "stopped",
        processedCandidates: 42,
        skippedUsers: [],
        error: `Restarting after X session alert ${alert.id} was auto_ignored.`
      });
      expect(alerts.find(alert.id)).toMatchObject({
        id: alert.id,
        status: "ignored"
      });

      const restartedProgressAt = new Date().toISOString();
      fs.writeFileSync(
        restartedJob.reportPath,
        `${JSON.stringify(
          {
            jobId: restartedJob.id,
            mode: "without_api",
            status: "running",
            maxAgeDays: 90,
            startedAt: restartedProgressAt,
            completedAt: null,
            account: account.xIdentifier,
            vpnProfilePath: account.vpnProfilePath,
            publicIpv4: "203.0.113.10",
            totalCandidates: 4001,
            processedCandidates: 2,
            startIndex: 43,
            skippedBeforeStartIndex: 42,
            removedUsers: [],
            keptUsers: [
              {
                keyword: "@continued",
                handle: "continued",
                latestTweetId: "1",
                latestTweetCreatedAt: restartedProgressAt,
                ageDays: 0,
                reason: "latest_tweet_within_max_age"
              }
            ],
            skippedUsers: [],
            error: null
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const progressed = await app.inject({
        method: "GET",
        url: "/admin/keyword-users/prune-stale/current",
        headers: authHeaders
      });
      expect(progressed.statusCode).toBe(200);
      expect(progressed.json().job).toMatchObject({
        id: restartedJob.id,
        status: "running",
        restartCount: 0
      });
      expect(JSON.parse(fs.readFileSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${restartedJob.id}.json`), "utf8"))).toMatchObject({
        jobId: restartedJob.id,
        restartCount: 0
      });
    } finally {
      await app.close();
      for (const job of [initialJob, restartedJob].filter(Boolean) as Array<{ id: string; reportPath: string; resumeStatePath: string }>) {
        fs.rmSync(job.reportPath, { force: true });
        fs.rmSync(job.resumeStatePath, { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.json`), { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.running`), { force: true });
      }
      fs.rmSync(path.resolve(account.storageStatePath), { force: true });
    }
  });

  it("stops a queued Docker stale keyword cleanup", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-docker-stale-users-stop-"));
    const currentSessionFile = path.join(tmp, "current-session.log");
    const envPath = path.join(tmp, ".env");
    const vpnProfilePath = `./runtime/test-vpn-${process.pid}-${Date.now()}.ovpn`;
    fs.writeFileSync(envPath, "", "utf8");

    const config = loadConfig({
      ADMIN_PASSWORD: "secret",
      SESSION_SECRET: "test-session-secret",
      CURRENT_SESSION_FILE: currentSessionFile,
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      VPN_CONFIG: vpnProfilePath,
      X_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ISOLATION: "docker_vpn"
    });
    const database = openMemoryDatabase();
    const accounts = new XBrowserAccountService(database);
    const account = accounts.upsert({
      vpnProfilePath: config.vpnConfig,
      xIdentifier: "@docker_stale_cleanup"
    });
    fs.mkdirSync(path.dirname(path.resolve(account.storageStatePath)), { recursive: true });
    fs.writeFileSync(path.resolve(account.storageStatePath), JSON.stringify({ cookies: [], origins: [] }), "utf8");
    accounts.markLogin(account.id, "203.0.113.10");

    const app = createAdminApi({
      database,
      config,
      envPath,
      currentSessionFilePath: currentSessionFile,
      restartDelayMs: 0
    });

    let job: { id: string; reportPath: string; resumeStatePath: string } | null = null;
    try {
      const login = await app.inject({ method: "POST", url: "/admin/login", payload: { username: "admin", password: "secret" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      const authHeaders = authHeadersFromSetCookie(cookie);

      const start = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale",
        headers: authHeaders,
        payload: { maxAgeDays: 90 }
      });
      expect(start.statusCode).toBe(202);
      job = start.json().job.job;
      if (!job) {
        throw new Error("Expected stale keyword cleanup job to be queued.");
      }

      const requestPath = path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.json`);
      expect(fs.existsSync(requestPath)).toBe(true);

      const duplicateStart = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale",
        headers: authHeaders,
        payload: { maxAgeDays: 90 }
      });
      expect(duplicateStart.statusCode).toBe(409);
      expect(duplicateStart.json()).toMatchObject({
        error: "A stale keyword user pruning job is already running.",
        job: {
          running: true,
          job: { id: job.id }
        }
      });

      const stop = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale/stop",
        headers: authHeaders
      });
      expect(stop.statusCode).toBe(200);
      expect(stop.json().job).toMatchObject({
        running: false,
        job: {
          id: job.id,
          status: "stopped"
        }
      });
      expect(fs.existsSync(requestPath)).toBe(false);
      expect(JSON.parse(fs.readFileSync(job.reportPath, "utf8"))).toMatchObject({
        jobId: job.id,
        status: "stopped",
        error: "Stopped by request: admin_stop."
      });
    } finally {
      await app.close();
      if (job) {
        fs.rmSync(job.reportPath, { force: true });
        fs.rmSync(job.resumeStatePath, { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.json`), { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.running`), { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-stops", `${job.id}.stop`), { force: true });
      }
      fs.rmSync(path.resolve(account.storageStatePath), { force: true });
    }
  });

  it("updates the execution speed of a running Docker stale keyword cleanup immediately", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-docker-stale-users-speed-"));
    const currentSessionFile = path.join(tmp, "current-session.log");
    const envPath = path.join(tmp, ".env");
    const vpnProfilePath = `./runtime/test-vpn-${process.pid}-${Date.now()}.ovpn`;
    fs.writeFileSync(envPath, "", "utf8");

    const config = loadConfig({
      ADMIN_PASSWORD: "secret",
      SESSION_SECRET: "test-session-secret",
      CURRENT_SESSION_FILE: currentSessionFile,
      DATABASE_URL: path.join(tmp, "redqueenx.sqlite"),
      VPN_CONFIG: vpnProfilePath,
      X_API_ENABLED: "false",
      SEARCH_WITHOUT_API_ENABLED: "true",
      SEARCH_WITHOUT_API_ISOLATION: "docker_vpn"
    });
    const database = openMemoryDatabase();
    const accounts = new XBrowserAccountService(database);
    const account = accounts.upsert({
      vpnProfilePath: config.vpnConfig,
      xIdentifier: "@docker_stale_cleanup"
    });
    fs.mkdirSync(path.dirname(path.resolve(account.storageStatePath)), { recursive: true });
    fs.writeFileSync(path.resolve(account.storageStatePath), JSON.stringify({ cookies: [], origins: [] }), "utf8");
    accounts.markLogin(account.id, "203.0.113.10");

    const app = createAdminApi({
      database,
      config,
      envPath,
      currentSessionFilePath: currentSessionFile,
      restartDelayMs: 0
    });

    let job: { id: string; reportPath: string; resumeStatePath: string } | null = null;
    try {
      const login = await app.inject({ method: "POST", url: "/admin/login", payload: { username: "admin", password: "secret" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      const authHeaders = authHeadersFromSetCookie(cookie);

      const start = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale",
        headers: authHeaders,
        payload: { maxAgeDays: 90, actionDelayMinSeconds: 5, actionDelayMaxSeconds: 10 }
      });
      expect(start.statusCode).toBe(202);
      job = start.json().job.job;
      if (!job) {
        throw new Error("Expected stale keyword cleanup job to be queued.");
      }

      const speed = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale/speed",
        headers: authHeaders,
        payload: { actionDelayMinSeconds: 0, actionDelayMaxSeconds: 0 }
      });
      expect(speed.statusCode).toBe(200);
      expect(speed.json()).toMatchObject({
        appliedImmediately: true,
        job: {
          running: true,
          job: {
            id: job.id,
            actionDelayMinSeconds: 0,
            actionDelayMaxSeconds: 0
          }
        }
      });

      const requestPath = path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.json`);
      expect(JSON.parse(fs.readFileSync(requestPath, "utf8"))).toMatchObject({
        jobId: job.id,
        actionDelayMinSeconds: 0,
        actionDelayMaxSeconds: 0
      });

      const controlPath = path.join(process.cwd(), "runtime", "stale-keyword-user-prune-controls", `${job.id}.json`);
      expect(JSON.parse(fs.readFileSync(controlPath, "utf8"))).toMatchObject({
        jobId: job.id,
        actionDelayMinSeconds: 0,
        actionDelayMaxSeconds: 0
      });
    } finally {
      await app.close();
      if (job) {
        fs.rmSync(job.reportPath, { force: true });
        fs.rmSync(job.resumeStatePath, { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.json`), { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-requests", `${job.id}.running`), { force: true });
        fs.rmSync(path.join(process.cwd(), "runtime", "stale-keyword-user-prune-controls", `${job.id}.json`), { force: true });
      }
      fs.rmSync(path.resolve(account.storageStatePath), { force: true });
    }
  });

  it("keeps Docker Compose from injecting the full .env into service environments", () => {
    const compose = fs.readFileSync(path.join(process.cwd(), "compose.yaml"), "utf8");
    const dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    expect(compose).not.toContain("env_file:");
    expect(compose).toContain("profiles:");
    expect(compose).toContain("- caddy");
    expect(compose).toContain('"127.0.0.1:${ADMIN_PORT:-3005}:${ADMIN_PORT:-3005}"');
    expect(compose).toContain("./.env:/app/.env:rw");
    expect(compose).toContain("./.env:/app/.env:ro");
    expect(compose).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/google-chrome-stable");
    expect(compose).toContain('PLAYWRIGHT_DISABLE_SANDBOX: "false"');
    expect(dockerfile).toContain("firefox-esr");
    expect(compose).toContain("seccomp=unconfined");
    expect(compose).toContain("X_LOGIN_NOVNC_PORT: ${X_LOGIN_NOVNC_PORT:-6080}");
    expect(compose).toContain("X_LOGIN_SERVICE_MAX_SECONDS: ${X_LOGIN_SERVICE_MAX_SECONDS:-1200}");
    expect(compose).toContain("X_LOGIN_BROWSER: ${X_LOGIN_BROWSER:-chrome}");
    expect(compose).toContain("X_LOGIN_REUSE_BROWSER_PROFILE: ${X_LOGIN_REUSE_BROWSER_PROFILE:-false}");
    expect(compose).toContain('"127.0.0.1:${X_LOGIN_NOVNC_PORT:-6080}:${X_LOGIN_NOVNC_PORT:-6080}"');
    expect(compose).not.toContain("/tmp/.X11-unix:/tmp/.X11-unix:rw");
    expect(compose).toContain("init-runtime:");
    expect(fs.readFileSync(path.join(process.cwd(), "src/worker/dockerVpnWorker.ts"), "utf8")).toContain(
      "SEARCH_WITHOUT_API_USER_KEYWORD_PERCENT"
    );
  });

  it("keeps the Docker VPN kill switch closed to new inbound tunnel traffic", () => {
    const entrypoint = fs.readFileSync(path.join(process.cwd(), "ops/docker/openvpn-entrypoint.sh"), "utf8");
    expect(entrypoint).not.toContain("iptables -A INPUT -i tun+ -j ACCEPT");
    expect(entrypoint).toContain("iptables -A OUTPUT -o tun+ -j ACCEPT");
    expect(entrypoint).toContain("iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT");
    expect(entrypoint).toContain('iptables -A INPUT -i eth0 -p tcp --dport "$novnc_port" -j ACCEPT');
  });

  it("uses Xvfb and noVNC for Docker x-login instead of host X11 forwarding", () => {
    const entrypoint = fs.readFileSync(path.join(process.cwd(), "ops/docker/x-login-entrypoint.sh"), "utf8");
    expect(entrypoint).toContain("Xvfb");
    expect(entrypoint).toContain("x11vnc");
    expect(entrypoint).toContain("websockify --web=/usr/share/novnc");
    expect(entrypoint).toContain("http://127.0.0.1:${novnc_port}/vnc.html");
    expect(entrypoint).toContain('timeout --foreground --kill-after=15s "${service_max_seconds}s" npm run x:login -- "$@" &');
    expect(entrypoint).toContain("handle_signal()");
    expect(entrypoint).not.toContain("DOCKER_X11");
  });

  it("keeps project-local OpenVPN auth paths valid inside Docker", () => {
    const entrypoint = fs.readFileSync(path.join(process.cwd(), "ops/docker/openvpn-entrypoint.sh"), "utf8");
    expect(entrypoint).toContain('if (value ~ /^\\.\\/ops\\/vpn\\//) return "/app/" substr(value, 3);');
    expect(entrypoint).toContain('if (value ~ /^ops\\/vpn\\//) return "/app/" value;');
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

function absTwimgTweet(): TweetCandidate {
  return {
    ...testTweet(),
    id: "2050000000000000002",
    text: "X hashflag test tweet with abs.twimg.com media",
    entities: {
      ...testTweet().entities,
      media: [
        {
          type: "photo",
          url: "https://abs.twimg.com/hashflags/test-image.png",
          previewImageUrl: "https://abs.twimg.com/hashflags/test-image.png",
          altText: "test image"
        }
      ]
    }
  };
}
