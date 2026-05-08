import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAdminApi } from "../src/admin/api";
import { openMemoryDatabase } from "../src/db/database";
import { RunService } from "../src/admin/runService";
import { XBrowserAccountService } from "../src/admin/xBrowserAccountService";
import { XSessionAlertService } from "../src/admin/xSessionAlertService";

describe("admin api", () => {
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
    const app = createAdminApi({
      database,
      config: {
        adminPassword: "secret",
        adminPasswordHash: undefined,
        sessionSecret: "test-session-secret",
        legacyDataDir: tmp,
        currentSessionFile: currentSessionFilePath,
        xApiEnabled: true,
        searchWithoutApiEnabled: false,
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
        searchWithoutApiRequestsBeforePauseMin: 10,
        searchWithoutApiRequestsBeforePauseMax: 180,
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

    const publicTimeline = await app.inject({ method: "GET", url: "/timeline" });
    expect(publicTimeline.statusCode).toBe(200);
    expect(publicTimeline.headers["content-type"]).toContain("text/html");
    expect(publicTimeline.body).toContain("/assets/timeline.js");
    const rawTimeline = await app.inject({ method: "GET", url: "/raw-timeline" });
    expect(rawTimeline.statusCode).toBe(200);
    expect(rawTimeline.body).toContain("/assets/raw-timeline.js");

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

    const publicTimelineData = await app.inject({ method: "GET", url: "/timeline/data" });
    expect(publicTimelineData.statusCode).toBe(200);
    expect(publicTimelineData.json()).toEqual({
      items: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      actionsEnabled: false
    });
    const rawTimelineData = await app.inject({ method: "GET", url: "/raw-timeline/data" });
    expect(rawTimelineData.statusCode).toBe(200);
    expect(rawTimelineData.json()).toEqual({
      items: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false }
    });

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
      payload: { password: "secret" }
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toBeDefined();

    const authHeaders = { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) };

    const adminPage = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { ...authHeaders, accept: "text/html" }
    });
    expect(adminPage.statusCode).toBe(200);
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
    expect(adminPage.body).toContain('id="list-search"');
    expect(adminPage.body).toContain('<option value="no_result">No.Result</option>');
    expect(adminPage.body).not.toContain('data-admin-section-target="import"');
    expect(adminPage.body).not.toContain('id="admin-section-import"');
    expect(adminPage.body).not.toContain("Import & Compteurs");
    expect(adminPage.body).toContain('data-admin-section-target="settings"');
    expect(adminPage.body).toContain('data-admin-section-target="session"');
    expect(adminPage.body).toContain('data-admin-section-target="tests"');
    expect(adminPage.body).toContain('data-admin-section-target="database"');
    expect(adminPage.body).toContain('data-admin-section-target="env"');
    expect(adminPage.body).toContain('id="admin-nav-more"');
    expect(adminPage.body).toContain("More ...");
    expect(adminPage.body).toContain('data-run-action="start"');
    expect(adminPage.body).toContain('href="/raw-timeline"');
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
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_SESSION_KEYWORD_LIMIT_RANDOM"');
    expect(adminPage.body).toContain('name="SEARCH_WITHOUT_API_RANDOMIZE_KEYWORD_ORDER"');
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
    expect(adminPage.body).toContain('id="x-browser-account-select"');
    expect(adminPage.body).toContain('id="x-browser-identifier"');
    expect(adminPage.body).toContain('id="x-browser-session-validation"');
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
    expect(adminPage.body).toContain('id="admin-section-tests"');
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
      payload: { note: "Human solved the challenge from the usual VPN IP." }
    });
    expect(resolveWithNote.statusCode).toBe(200);
    expect(resolveWithNote.json().alert).toMatchObject({ id: openAlert.id, status: "resolved" });
    fs.rmSync(capturedStorageStatePath, { force: true });
    expect(adminPage.body).not.toContain('id="reset-no-results-button"');
    expect(adminPage.body).toContain('id="reset-x-counters-button"');
    expect(adminPage.body).toContain('id="reset-x-budget-button"');
    expect(adminPage.body).toContain('id="env-form"');
    expect(adminPage.body).toContain('id="session-log"');
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
    const openVpnTargetDir = `runtime/admin-api-vpn-copy-${process.pid}-${Date.now()}`;
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

    const openVpnProfileDir = path.resolve("ops/vpn");
    const openVpnProfileName = `admin-api-profile-${process.pid}-${Date.now()}.ovpn`;
    const openVpnAuthName = openVpnProfileName.replace(/\.ovpn$/, ".auth");
    const openVpnProfilePath = path.join(openVpnProfileDir, openVpnProfileName);
    const openVpnAuthPath = path.join(openVpnProfileDir, openVpnAuthName);
    const secondOpenVpnProfileName = `admin-api-profile-second-${process.pid}-${Date.now()}.ovpn`;
    const secondOpenVpnProfilePath = path.join(openVpnProfileDir, secondOpenVpnProfileName);
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
      maximumTweetAgeDays: 3
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
      SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MIN: "10",
      SEARCH_WITHOUT_API_REQUESTS_BEFORE_PAUSE_MAX: "180",
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
      X_KEYWORDS_PER_QUERY: "5"
    });

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
    const envAfterXApiEnable = fs.readFileSync(envPath, "utf8");
    expect(envAfterXApiEnable).toContain("X_API_ENABLED=true");
    expect(envAfterXApiEnable).toContain("SEARCH_WITHOUT_API_ENABLED=false");

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

    const timelineAfterImport = await app.inject({ method: "GET", url: "/timeline/data", headers: authHeaders });
    expect(timelineAfterImport.statusCode).toBe(200);
    expect(timelineAfterImport.json().pagination).toMatchObject({
      total: expect.any(Number),
      limit: 50,
      offset: 0,
      hasMore: expect.any(Boolean)
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
});
