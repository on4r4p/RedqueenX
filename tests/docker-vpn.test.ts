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

describe("docker_vpn isolation", () => {
  it("keeps host_netns as the default isolation backend", () => {
    expect(loadConfig({}).searchWithoutApiIsolation).toBe("host_netns");
  });

  it("queues admin media cache reloads instead of launching host netns scripts", async () => {
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

    const login = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "secret" } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    const authHeaders = { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) };

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
      const login = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "secret" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      const authHeaders = { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) };

      const start = await app.inject({
        method: "POST",
        url: "/admin/keyword-users/prune-stale",
        headers: authHeaders,
        payload: { maxAgeDays: 90, autoIgnoreAlert: true, maxRetries: 3 }
      });
      expect(start.statusCode).toBe(202);
      initialJob = start.json().job.job;
      if (!initialJob) {
        throw new Error("Expected stale keyword cleanup job to be queued.");
      }

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
        maxRetries: 3
      });
      expect(alerts.find(alert.id)).toMatchObject({
        id: alert.id,
        status: "ignored"
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
      const login = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "secret" } });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      const authHeaders = { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) };

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

  it("keeps Docker Compose from injecting the full .env into service environments", () => {
    const compose = fs.readFileSync(path.join(process.cwd(), "compose.yaml"), "utf8");
    expect(compose).not.toContain("env_file:");
    expect(compose).toContain("./.env:/app/.env:rw");
    expect(compose).toContain("./.env:/app/.env:ro");
    expect(compose).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium");
    expect(compose).toContain("init-runtime:");
  });

  it("keeps the Docker VPN kill switch closed to new inbound tunnel traffic", () => {
    const entrypoint = fs.readFileSync(path.join(process.cwd(), "ops/docker/openvpn-entrypoint.sh"), "utf8");
    expect(entrypoint).not.toContain("iptables -A INPUT -i tun+ -j ACCEPT");
    expect(entrypoint).toContain("iptables -A OUTPUT -o tun+ -j ACCEPT");
    expect(entrypoint).toContain("iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT");
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
