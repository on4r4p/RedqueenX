import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import SqliteDatabase from "better-sqlite3";
import { chromium, type BrowserContext, type Page, type Response } from "playwright-core";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { runVpnDiagnostics, type VpnDiagnosticsReport } from "../diagnostics/vpn";
import { EnvService } from "../admin/envService";
import { XBrowserAccountService, type XBrowserAccountRecord } from "../admin/xBrowserAccountService";
import { XSessionAlertService } from "../admin/xSessionAlertService";
import { clearStaleChromiumProfileLocks } from "./chromiumProfileLock";
import { shouldDisableChromiumSandbox } from "./chromiumSandbox";
import { assertVpnRuntime } from "./vpnGuard";

interface LoginArgs {
  accountId?: number;
  vpnProfilePath?: string;
  resolveAlert?: boolean;
  autoSaveOnLogin?: boolean;
  holdOpenAfterSave?: boolean;
}

interface LoginContextSummary {
  accountId: number;
  xIdentifier: string;
  vpnProfilePath: string;
  linkedVpnProfileCount: number;
  vpnPublicIpv4: string | null;
}

type XLoginSaveMode = "cdp" | "profile";
type XLoginBrowser = "chrome" | "firefox";

let lastLoginContext: LoginContextSummary | null = null;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const database = openDatabase(config.databaseUrl);
  const accounts = new XBrowserAccountService(database);
  const xSessionAlerts = new XSessionAlertService(database);

  try {
    const account = selectAccount(accounts, args);
    lastLoginContext = loginContextSummary(account, null, config.vpnConfig);
    const openAlert = xSessionAlerts.openForAccount(account.id);
    if (openAlert && !args.resolveAlert) {
      xSessionAlerts.openForAccountOrThrow(account);
    }
    assertActiveVpnProfileLinked(account, config.vpnConfig);
    await assertVpnRuntime(config, "X browser login");
    const report = await runVpnDiagnostics({ includePlaywright: false, strict: true });
    if (report.failures.length > 0) {
      throw new Error(`VPN diagnostics failed before X login: ${report.failures.join(" ")}`);
    }
    const publicIpv4 = publicIpv4FromReport(report);
    lastLoginContext = loginContextSummary(account, publicIpv4, config.vpnConfig);
    if (args.resolveAlert) {
      console.log(
        openAlert
          ? "Open X session alert found. Opening visible Chrome for manual human verification."
          : "Alert-resolution mode requested. Opening visible Chrome for manual human verification."
      );
      console.log("X login network precheck is skipped in alert-resolution mode so the human can inspect the page directly.");
    }
    const saveMode = xLoginSaveMode();
    const loginBrowser = xLoginBrowser();
    if (loginBrowser === "firefox" && saveMode !== "profile") {
      throw new Error("X_LOGIN_BROWSER=firefox requires X_LOGIN_SAVE_MODE=auto or profile.");
    }
    if (!args.resolveAlert && saveMode !== "profile") {
      await assertXLoginApiReachable();
    } else if (!args.resolveAlert && saveMode === "profile") {
      console.log("X login network precheck is skipped in profile-save mode so the human login can proceed in normal Chrome.");
    }

    const storageStatePath = path.resolve(process.cwd(), account.storageStatePath);
    const savedBrowserProfileDir = path.resolve(process.cwd(), account.browserProfileDir);
    const browserProfileDir = await xLoginBrowserProfileDir(savedBrowserProfileDir, loginBrowser);
    await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
    await fs.mkdir(browserProfileDir, { recursive: true });
    const removedProfileLocks =
      loginBrowser === "firefox"
        ? await clearStaleFirefoxProfileLocks(browserProfileDir)
        : await clearStaleChromiumProfileLocks(browserProfileDir);

    const executablePath =
      loginBrowser === "firefox" ? findFirefoxExecutable() : config.playwrightChromiumExecutablePath || findChromiumExecutable();
    const display = detectGraphicalDisplay();
    const minimalChromeLaunch = loginBrowser === "chrome" && isDockerVpnLoginRuntime() && saveMode === "profile";
    const launchArgs = minimalChromeLaunch
      ? []
      : [
          ...display.launchArgs,
          "--disable-dev-shm-usage"
        ];
    if (shouldDisableChromiumSandbox(config.playwrightDisableSandbox)) {
      launchArgs.push("--no-sandbox");
    }
    const cdpPort = Number(process.env.X_LOGIN_CDP_PORT || "9222");
    const cdpAddress = chromeCdpBindAddress();
    const cdpTimeoutMs = xLoginCdpTimeoutMs();
    const startUrl = xLoginStartUrl();

    console.log(`X account: ${account.xIdentifier}`);
    console.log(`VPN profile: ${config.vpnConfig}`);
    console.log(`Linked VPN profiles on this X account: ${account.vpnProfilePaths.length}`);
    console.log(`VPN public IPv4: ${publicIpv4 ?? "unknown"}`);
    console.log(`Storage state will be saved to: ${account.storageStatePath}`);
    console.log(`Login URL: ${startUrl}`);
    console.log(`Login browser: ${loginBrowser}`);
    console.log(
      browserProfileDir === savedBrowserProfileDir
        ? `Browser profile: ${account.browserProfileDir}`
        : "Browser profile: temporary clean profile for this login attempt"
    );
    console.log(`Session save mode: ${saveMode === "profile" ? "profile extraction after manual login" : "live CDP capture"}`);
    console.log(`Graphical display: ${display.label}`);
    if (minimalChromeLaunch) {
      console.log("Docker noVNC login is using minimal Chrome flags to keep the manual X login flow closer to a normal browser.");
    }
    if (removedProfileLocks.length > 0) {
      console.log(`Removed stale Chromium profile locks: ${removedProfileLocks.join(", ")}.`);
    }
    console.log("A normal visible Chrome window will open through the VPN namespace.");
    console.log("Log in manually, including any 2FA or challenge requested by X.");
    if (args.autoSaveOnLogin) {
      console.log("Auto-save mode is active: RedqueenX will save the session as soon as it detects the X login cookie.");
      if (args.holdOpenAfterSave) {
        console.log("Manual alert mode is active: Chrome will stay open after the session is saved. Close Chrome yourself when the challenge is fully resolved.");
      }
    } else if (loginBrowser === "firefox" && saveMode === "profile") {
      console.log("Firefox noVNC save mode: after X Home is visible, close the Firefox window inside noVNC to save the session.");
    }

    if (saveMode === "profile") {
      const browserProcess =
        loginBrowser === "firefox"
          ? launchManualFirefox(browserProfileDir, executablePath, startUrl, display)
          : launchManualChrome(browserProfileDir, executablePath, launchArgs, null, startUrl, display, {
              minimal: minimalChromeLaunch
            });
      try {
        if (loginBrowser === "firefox") {
          await waitForChromeExit(browserProcess);
        } else if (args.autoSaveOnLogin) {
          console.log("Auto-save was requested, but profile-save mode needs one manual Enter after the account is visibly logged in.");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          await rl.question("When the account is visibly logged in, press Enter here to close the browser and save the session. ");
          rl.close();
        } else {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          await rl.question("When the account is visibly logged in, press Enter here to close the browser and save the session. ");
          rl.close();
        }
      } finally {
        if (loginBrowser !== "firefox" || browserProcess.exitCode === null) {
          await stopChromeAndWait(browserProcess);
        }
      }
      if (loginBrowser === "firefox") {
        await clearStaleFirefoxProfileLocks(browserProfileDir);
      } else {
        await clearStaleChromiumProfileLocks(browserProfileDir);
        await saveStorageStateFromBrowserProfile(browserProfileDir, storageStatePath, executablePath, launchArgs);
      }
    } else {
      const chrome = launchManualChrome(browserProfileDir, executablePath, launchArgs, { port: cdpPort, address: cdpAddress }, startUrl, display);
      try {
        await waitForChromeCdp(cdpPort, chrome, cdpTimeoutMs);

        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        try {
          const context = browser.contexts()[0];
          if (!context) {
            throw new Error("Unable to access the Chrome browser context through CDP.");
          }
          attachXLoginDiagnostics(context);
          await prepareVisibleLoginPage(context, startUrl);
          if (args.autoSaveOnLogin) {
            await waitForXLoginCookie(context, Number(process.env.X_LOGIN_AUTO_SAVE_TIMEOUT_MS || 30 * 60 * 1000));
          } else {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            });
            await rl.question("When the account is logged in, press Enter here to save the session. ");
            rl.close();
          }
          await ensureXLoginCookie(context);
          await context.storageState({ path: storageStatePath });
        } finally {
          if (!args.holdOpenAfterSave) {
            await browser.close();
          }
        }

        if (args.holdOpenAfterSave) {
          console.log("Chrome is still open for manual verification. Finish CAPTCHA/2FA/challenge if needed, then close the Chrome window.");
          await waitForChromeExit(chrome);
          console.log("Chrome was closed by the user. Manual X login helper is exiting.");
        }
      } finally {
        if (!args.holdOpenAfterSave) {
          stopChrome(chrome);
        }
      }
    }

    const updated = accounts.markLogin(account.id, publicIpv4);
    const precheckReset = await resetXLoginNetworkPrecheck();
    console.log(greenTerminal("V Session validated and saved."));
    console.log(`Session saved for ${updated.xIdentifier}.`);
    console.log(`Last login IPv4 recorded as: ${updated.lastLoginPublicIpv4 ?? "unknown"}`);
    if (precheckReset) {
      console.log("X_LOGIN_SKIP_NETWORK_PRECHECK was reset to false in .env.");
    }
  } finally {
    database.close();
  }
}

function loginContextSummary(account: XBrowserAccountRecord, vpnPublicIpv4: string | null, activeVpnProfilePath: string): LoginContextSummary {
  return {
    accountId: account.id,
    xIdentifier: account.xIdentifier,
    vpnProfilePath: activeVpnProfilePath,
    linkedVpnProfileCount: account.vpnProfilePaths.length,
    vpnPublicIpv4
  };
}

async function resetXLoginNetworkPrecheck() {
  const envService = new EnvService();
  const values = await envService.read();
  if (values.X_LOGIN_SKIP_NETWORK_PRECHECK !== "true") {
    return false;
  }
  await envService.update({ X_LOGIN_SKIP_NETWORK_PRECHECK: "false" });
  process.env.X_LOGIN_SKIP_NETWORK_PRECHECK = "false";
  return true;
}

function greenTerminal(message: string) {
  if (!process.stdout.isTTY) {
    return message;
  }
  return `\u001B[32m${message}\u001B[0m`;
}

function assertActiveVpnProfileLinked(account: XBrowserAccountRecord, activeVpnProfilePath: string) {
  const active = profilePathKey(activeVpnProfilePath);
  if (!active) {
    throw new Error("VPN_CONFIG is empty. Select an OpenVPN profile before running X login.");
  }
  if (!account.vpnProfilePaths.some((profilePath) => profilePathKey(profilePath) === active)) {
    throw new Error(
      [
        `Active OpenVPN profile ${activeVpnProfilePath} is not linked to ${account.xIdentifier}.`,
        "Open Admin > Settings > X browser account and link this VPN profile, or enable the option to link all imported profiles to that X account."
      ].join(" ")
    );
  }
}

function parseArgs(args: string[]): LoginArgs {
  const parsed: LoginArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--account-id" && next) {
      parsed.accountId = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--account-id=")) {
      parsed.accountId = Number(arg.slice("--account-id=".length));
      continue;
    }
    if (arg === "--vpn-profile" && next) {
      parsed.vpnProfilePath = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--vpn-profile=")) {
      parsed.vpnProfilePath = arg.slice("--vpn-profile=".length);
      continue;
    }
    if (arg === "--resolve-alert") {
      parsed.resolveAlert = true;
      continue;
    }
    if (arg === "--auto-save-on-login") {
      parsed.autoSaveOnLogin = true;
      continue;
    }
    if (arg === "--hold-open-after-save") {
      parsed.holdOpenAfterSave = true;
    }
  }
  return parsed;
}

function selectAccount(service: XBrowserAccountService, args: LoginArgs): XBrowserAccountRecord {
  if (args.accountId) {
    const account = service.findById(args.accountId);
    if (!account) {
      throw new Error(`Unknown X browser account id: ${args.accountId}`);
    }
    return account;
  }

  if (args.vpnProfilePath) {
    const account = service.findByVpnProfilePath(args.vpnProfilePath);
    if (!account) {
      throw new Error(`No X browser account is linked to VPN profile: ${args.vpnProfilePath}`);
    }
    return account;
  }

  const allAccounts = service.list();
  if (allAccounts.length === 1) {
    return allAccounts[0];
  }

  const choices = allAccounts
    .map((account) => `  ${account.id}: ${account.xIdentifier} -> ${account.vpnProfilePath}`)
    .join("\n");
  throw new Error(
    `Choose one account with --account-id <id> or --vpn-profile <path>.\n${choices || "No X browser account exists yet."}`
  );
}

function publicIpv4FromReport(report: VpnDiagnosticsReport): string | null {
  const value = report.checks.publicIpv4?.value;
  return typeof value === "string" ? value : null;
}

async function assertXLoginApiReachable() {
  if (process.env.X_LOGIN_SKIP_NETWORK_PRECHECK === "true") {
    return;
  }

  const endpoint = "https://api.x.com/1.1/onboarding/task.json?flow_name=login";
  const response = await fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: "https://x.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers":
        "authorization,content-type,x-csrf-token,x-twitter-active-user,x-twitter-client-language"
    },
    signal: AbortSignal.timeout(15_000)
  });
  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (!response.ok || !allowOrigin) {
    const contentType = response.headers.get("content-type") ?? "unknown";
    throw new Error(
      [
        "X login API precheck failed before opening Chrome.",
        `${endpoint} returned HTTP ${response.status} (${contentType}) without the expected CORS allow-origin header.`,
        "This matches the X page error 'Something went wrong' and usually means X/Cloudflare is blocking this VPN/IP or login flow.",
        "Try another OpenVPN profile/IP, wait before retrying, or run with X_LOGIN_SKIP_NETWORK_PRECHECK=true if you explicitly want to open Chrome anyway."
      ].join(" ")
    );
  }
}

function findChromiumExecutable(): string | undefined {
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].find((candidate) => fsSync.existsSync(candidate));
}

function findFirefoxExecutable(): string | undefined {
  return [
    "/usr/bin/firefox-esr",
    "/usr/bin/firefox"
  ].find((candidate) => fsSync.existsSync(candidate));
}

async function xLoginBrowserProfileDir(savedBrowserProfileDir: string, browser: XLoginBrowser) {
  const persistentProfileDir = browser === "firefox" ? path.join(savedBrowserProfileDir, "firefox") : savedBrowserProfileDir;
  if (process.env.X_LOGIN_REUSE_BROWSER_PROFILE === "true") {
    return persistentProfileDir;
  }
  return fs.mkdtemp(path.join(os.tmpdir(), `redqueenx-x-login-${browser}-`));
}

async function clearStaleFirefoxProfileLocks(profileDir: string) {
  const removed: string[] = [];
  for (const filename of ["parent.lock", ".parentlock", "lock"]) {
    const target = path.join(profileDir, filename);
    try {
      await fs.unlink(target);
      removed.push(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return removed;
}

function launchManualChrome(
  userDataDir: string,
  executablePath: string | undefined,
  args: string[],
  cdp: { port: number; address: string } | null,
  startUrl: string,
  display: ReturnType<typeof detectGraphicalDisplay>,
  options: { minimal?: boolean } = {}
) {
  if (!executablePath) {
    throw new Error("No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH in Settings.");
  }

  const chromeArgs = options.minimal
    ? [
        `--user-data-dir=${userDataDir}`,
        ...sanitizeXLoginChromeArgs(args),
        startUrl
      ]
    : [
        `--user-data-dir=${userDataDir}`,
        ...(cdp
          ? [
              `--remote-debugging-port=${cdp.port}`,
              `--remote-debugging-address=${cdp.address}`,
              "--remote-allow-origins=*"
            ]
          : []),
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--use-mock-keychain",
        "--new-window",
        "--start-maximized",
        "--window-position=80,80",
        "--window-size=1400,950",
        ...sanitizeXLoginChromeArgs(args),
        startUrl
      ];

  try {
    return spawn(executablePath, chromeArgs, {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env
    });
  } catch (error) {
    throw new Error(friendlyBrowserLaunchError(error, display));
  }
}

function launchManualFirefox(
  userDataDir: string,
  executablePath: string | undefined,
  startUrl: string,
  display: ReturnType<typeof detectGraphicalDisplay>
) {
  if (!executablePath) {
    throw new Error("No Firefox executable found. Rebuild the Docker image so firefox-esr is installed.");
  }

  const firefoxArgs = [
    "-profile",
    userDataDir,
    "-no-remote",
    "-new-window",
    startUrl
  ];

  try {
    return spawn(executablePath, firefoxArgs, {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env
    });
  } catch (error) {
    throw new Error(friendlyBrowserLaunchError(error, display));
  }
}

export function sanitizeXLoginChromeArgs(args: string[]) {
  return args.filter((arg) => !arg.startsWith("--disable-blink-features="));
}

function xLoginSaveMode(): XLoginSaveMode {
  const raw = (process.env.X_LOGIN_SAVE_MODE || "auto").trim().toLowerCase();
  if (raw === "cdp" || raw === "profile") {
    return raw;
  }
  if (raw === "auto" || raw === "") {
    return isDockerVpnLoginRuntime() ? "profile" : "cdp";
  }
  throw new Error("X_LOGIN_SAVE_MODE must be auto, cdp, or profile.");
}

function xLoginBrowser(): XLoginBrowser {
  const raw = (process.env.X_LOGIN_BROWSER || "chrome").trim().toLowerCase();
  if (raw === "chrome" || raw === "firefox") {
    return raw;
  }
  throw new Error("X_LOGIN_BROWSER must be chrome or firefox.");
}

function xLoginStartUrl() {
  const value = process.env.X_LOGIN_START_URL?.trim() || "https://x.com/login";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (url.hostname !== "x.com" && url.hostname !== "twitter.com")) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error("X_LOGIN_START_URL must be an https://x.com/... or https://twitter.com/... URL.");
  }
}

function chromeCdpBindAddress() {
  return isDockerVpnLoginRuntime() ? "0.0.0.0" : "127.0.0.1";
}

function isDockerVpnLoginRuntime() {
  return process.env.REDQUEENX_DOCKER_VPN === "true" || process.env.SEARCH_WITHOUT_API_ISOLATION === "docker_vpn";
}

function xLoginCdpTimeoutMs() {
  const parsed = Number(process.env.X_LOGIN_CDP_TIMEOUT_MS || "60000");
  if (!Number.isFinite(parsed)) {
    return 60_000;
  }
  return Math.max(5_000, Math.floor(parsed));
}

async function waitForChromeCdp(port: number, chrome: ChildProcess, timeoutMs: number) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  let stderr = "";
  chrome.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
    if (stderr.length > 8_000) {
      stderr = stderr.slice(-8_000);
    }
  });

  const safeTimeoutMs = Math.max(5_000, timeoutMs);
  const deadline = Date.now() + safeTimeoutMs;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) {
      throw new Error(
        friendlyBrowserLaunchError(
          new Error(`Chrome exited before login window was ready. ${stderr.trim()}`),
          detectGraphicalDisplay()
        )
      );
    }
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }

  throw new Error(
    [
      `Chrome did not expose its local debugging endpoint at ${endpoint} within ${Math.round(safeTimeoutMs / 1000)}s.`,
      stderr.trim() ? `Chrome stderr:\n${stderr.trim()}` : "Chrome stderr was empty.",
      "If the visible Chrome window opened anyway, the CDP port may be blocked or already in use inside the Docker VPN namespace.",
      "Retry after closing any old x-login windows, or set X_LOGIN_CDP_PORT to another port before running x-login."
    ].join("\n")
  );
}

function attachXLoginDiagnostics(context: BrowserContext) {
  const attachPage = (page: Page) => {
    page.on("requestfailed", (request) => {
      if (isXLoginDiagnosticUrl(request.url())) {
        console.log(`X login request failed: ${safeDiagnosticUrl(request.url())} - ${request.failure()?.errorText ?? "unknown error"}`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && isXLoginDiagnosticResponse(response)) {
        console.log(`X login response ${response.status()}: ${safeDiagnosticUrl(response.url())}`);
        void logXLoginApiErrorDetail(response).catch(() => undefined);
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error" && /login|onboarding|api|network|failed|error/i.test(message.text())) {
        console.log(`X login console error: ${firstLine(message.text()).slice(0, 240)}`);
      }
    });
  };

  for (const page of context.pages()) {
    attachPage(page);
  }
  context.on("page", attachPage);
}

async function prepareVisibleLoginPage(context: BrowserContext, startUrl: string) {
  const page = context.pages().find((candidate) => !candidate.isClosed()) ?? (await context.newPage());
  await page.bringToFront().catch(() => undefined);
  await page.evaluate("window.focus()").catch(() => undefined);

  if (!isXPageUrl(page.url())) {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((error) => {
      console.log(`X login page navigation warning: ${firstLine(errorMessage(error)).slice(0, 240)}`);
    });
  }

  await page.bringToFront().catch(() => undefined);
  await page.evaluate("window.focus()").catch(() => undefined);
  console.log(`Visible login page ready: ${safeDiagnosticUrl(page.url())}`);
}

function isXPageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "x.com" || url.hostname === "twitter.com";
  } catch {
    return false;
  }
}

async function logXLoginApiErrorDetail(response: Response) {
  if (!/\/onboarding\/task\.json/.test(new URL(response.url()).pathname)) {
    return;
  }
  const contentType = response.headers()["content-type"] ?? "";
  if (!contentType.includes("json")) {
    return;
  }
  const detail = summarizeXLoginApiError(await response.text());
  if (detail) {
    console.log(`X login API error detail: ${detail}`);
  }
}

export function summarizeXLoginApiError(text: string) {
  try {
    const parsed = JSON.parse(text) as { errors?: Array<{ code?: unknown; message?: unknown }> };
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const messages = errors
      .map((error) => {
        const code = typeof error.code === "number" || typeof error.code === "string" ? String(error.code) : "";
        const message = typeof error.message === "string" ? error.message : "";
        return [code && `code ${code}`, message && sanitizeXLoginApiErrorMessage(message)].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    return messages.slice(0, 3).join(" | ");
  } catch {
    return "";
  }
}

function sanitizeXLoginApiErrorMessage(message: string) {
  return message
    .replace(/\bg;[^\s]+/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 300);
}

function isXLoginDiagnosticResponse(response: Response) {
  return isXLoginDiagnosticUrl(response.url());
}

function isXLoginDiagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "api.x.com" || url.hostname.endsWith(".x.com") || url.hostname.endsWith(".twitter.com")) &&
      (/\/onboarding\/task\.json|\/i\/api\//.test(url.pathname) || /login|onboarding|account/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function safeDiagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return firstLine(value).slice(0, 240);
  }
}

async function ensureXLoginCookie(context: { cookies: (urls?: string[]) => Promise<Array<{ name: string }>> }) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  if (!cookies.some((cookie) => cookie.name === "auth_token")) {
    throw new Error(
      "X login cookie was not found. Keep the Chrome window open, finish the X login, then press Enter only after the account is visibly logged in."
    );
  }
}

async function saveStorageStateFromBrowserProfile(
  browserProfileDir: string,
  storageStatePath: string,
  executablePath: string | undefined,
  args: string[]
) {
  if (!executablePath) {
    throw new Error("No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH in Settings.");
  }
  const extractionArgs = sanitizeXLoginChromeArgs(
    args.filter((arg) => arg !== "--enable-features=UseOzonePlatform" && !arg.startsWith("--ozone-platform="))
  );
  const context = await chromium.launchPersistentContext(browserProfileDir, {
    executablePath,
    headless: true,
    args: extractionArgs,
    timeout: 60_000
  });
  try {
    await ensureXLoginCookie(context);
    await context.storageState({ path: storageStatePath });
  } finally {
    await context.close().catch(() => undefined);
  }
}

type FirefoxCookieRow = {
  host: string;
  path: string;
  name: string;
  value: string;
  expiry: number;
  isSecure: number;
  isHttpOnly: number;
  sameSite: number | null;
};

async function saveStorageStateFromFirefoxProfile(browserProfileDir: string, storageStatePath: string) {
  const cookieDbPath = path.join(browserProfileDir, "cookies.sqlite");
  if (!fsSync.existsSync(cookieDbPath)) {
    throw new Error("Firefox cookie database was not found. Finish the X login before pressing Enter.");
  }

  const database = new SqliteDatabase(cookieDbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = database
      .prepare(
        `
          SELECT host, path, name, value, expiry, isSecure, isHttpOnly, sameSite
          FROM moz_cookies
          WHERE host LIKE '%x.com' OR host LIKE '%twitter.com'
        `
      )
      .all() as FirefoxCookieRow[];

    const cookies = rows.map((row) => ({
      name: row.name,
      value: row.value,
      domain: row.host,
      path: row.path || "/",
      expires: Number.isFinite(row.expiry) && row.expiry > 0 ? row.expiry : -1,
      httpOnly: Boolean(row.isHttpOnly),
      secure: Boolean(row.isSecure),
      sameSite: firefoxSameSite(row.sameSite)
    }));

    if (!cookies.some((cookie) => cookie.name === "auth_token")) {
      throw new Error(
        "X login cookie was not found in the Firefox profile. Keep the noVNC browser open, finish the X login, then press Enter only after the account is visibly logged in."
      );
    }

    await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
    await fs.writeFile(storageStatePath, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.chmod(storageStatePath, 0o600).catch(() => undefined);
  } finally {
    database.close();
  }
}

async function waitForFirefoxStorageState(
  browserProfileDir: string,
  storageStatePath: string,
  browserProcess: ChildProcess,
  timeoutMs: number
) {
  const startedAt = Date.now();
  const safeTimeoutMs = Math.max(60_000, Math.min(timeoutMs, 60 * 60 * 1000));
  let lastError: unknown;

  while (Date.now() - startedAt < safeTimeoutMs) {
    try {
      await saveStorageStateFromFirefoxProfile(browserProfileDir, storageStatePath);
      return;
    } catch (error) {
      lastError = error;
    }

    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      break;
    }
    await delay(2_000);
  }

  const detail = lastError instanceof Error ? ` Last check: ${lastError.message}` : "";
  throw new Error(
    [
      "Timed out while waiting for the X login cookie in Firefox.",
      "Keep the noVNC Firefox window open until X Home is visibly loaded.",
      detail
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function firefoxSameSite(value: number | null): "Strict" | "Lax" | "None" {
  if (value === 2) return "Strict";
  if (value === 1) return "Lax";
  return "None";
}

async function waitForXLoginCookie(
  context: { cookies: (urls?: string[]) => Promise<Array<{ name: string }>> },
  timeoutMs: number
) {
  const startedAt = Date.now();
  const safeTimeoutMs = Math.max(60_000, Math.min(timeoutMs, 60 * 60 * 1000));
  while (Date.now() - startedAt < safeTimeoutMs) {
    try {
      await ensureXLoginCookie(context);
      return;
    } catch {
      await delay(2_000);
    }
  }
  throw new Error(
    [
      "Timed out while waiting for the X login cookie.",
      "Keep the visible Chrome window open only while the human is solving X verification.",
      "Retry the manual login flow after the challenge is solved from the usual IP/VPN profile."
    ].join(" ")
  );
}

function stopChrome(chrome: ChildProcess) {
  if (chrome.exitCode !== null || chrome.killed) {
    return;
  }
  chrome.kill("SIGTERM");
}

async function stopChromeAndWait(chrome: ChildProcess) {
  if (chrome.exitCode !== null || chrome.signalCode !== null) {
    return;
  }
  chrome.kill("SIGTERM");
  await Promise.race([waitForChromeExit(chrome), delay(8_000)]);
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGKILL");
    await waitForChromeExit(chrome);
  }
}

async function waitForChromeExit(chrome: ChildProcess): Promise<void> {
  if (chrome.exitCode !== null || chrome.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    chrome.once("exit", () => resolve());
    chrome.once("error", () => resolve());
  });
}

function detectGraphicalDisplay() {
  const sessionType = process.env.XDG_SESSION_TYPE?.toLowerCase();
  const waylandDisplay = process.env.WAYLAND_DISPLAY;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const waylandSocket = waylandDisplay && runtimeDir ? path.join(runtimeDir, waylandDisplay) : undefined;
  const availableWaylandSocket = waylandSocket && fsSync.existsSync(waylandSocket) ? waylandSocket : undefined;
  const x11Display = process.env.DISPLAY;
  const x11Socket = x11Display ? x11SocketPath(x11Display) : undefined;
  const availableX11Display = x11Display && (!x11Socket || fsSync.existsSync(x11Socket)) ? x11Display : undefined;

  if (sessionType === "wayland") {
    if (availableWaylandSocket) {
      return waylandDisplayInfo(availableWaylandSocket);
    }
    if (availableX11Display) {
      return x11DisplayInfo(availableX11Display, x11Socket, "X11 fallback from Wayland session");
    }
    throw noDisplayError("Wayland session detected, but the Wayland socket is not available.");
  }

  if (sessionType === "x11") {
    if (availableX11Display) {
      return x11DisplayInfo(availableX11Display, x11Socket);
    }
    if (availableWaylandSocket) {
      return waylandDisplayInfo(availableWaylandSocket, "Wayland fallback from X11 session");
    }
    throw noDisplayError("X11 session detected, but DISPLAY/X11 socket is not available.");
  }

  if (availableWaylandSocket) {
    return waylandDisplayInfo(availableWaylandSocket, "Wayland auto-detected");
  }
  if (availableX11Display) {
    return x11DisplayInfo(availableX11Display, x11Socket, "X11 auto-detected");
  }

  throw noDisplayError("No Wayland or X11 display was detected.");
}

function waylandDisplayInfo(socketPath: string, note = "Wayland") {
  return {
    kind: "wayland" as const,
    label: `${note} (${socketPath})`,
    launchArgs: ["--ozone-platform=wayland", "--enable-features=UseOzonePlatform"]
  };
}

function x11DisplayInfo(display: string, socketPath: string | undefined, note = "X11") {
  return {
    kind: "x11" as const,
    label: `${note} (${display}${socketPath ? `, ${socketPath}` : ""})`,
    launchArgs: ["--ozone-platform=x11"]
  };
}

export function x11SocketPath(display: string) {
  const trimmed = display.trim();
  const localMatch =
    trimmed.match(/^:(\d+)(?:\.\d+)?$/) ??
    trimmed.match(/^unix:(\d+)(?:\.\d+)?$/i) ??
    trimmed.match(/^unix\/:(\d+)(?:\.\d+)?$/i);
  return localMatch ? `/tmp/.X11-unix/X${localMatch[1]}` : undefined;
}

function noDisplayError(reason: string) {
  return new Error(
    [
      reason,
      "No graphical display is available for manual X login.",
      "Run this command from a local graphical terminal on your computer, not from SSH or a non-graphical shell.",
      "The VPN diagnostics can run headless, but X login needs a visible browser window."
    ].join(" ")
  );
}

function friendlyBrowserLaunchError(error: unknown, display: ReturnType<typeof detectGraphicalDisplay>) {
  const original = errorMessage(error);
  if (/XServer|Missing X server|Authorization required|ozone_platform_x11/i.test(original)) {
    return [
      "Chromium could not open the visible login window.",
      `Detected display: ${display.label}.`,
      "RedqueenX chooses Wayland or X11 from XDG_SESSION_TYPE, then falls back to available display sockets.",
      "If you are on Wayland, make sure WAYLAND_DISPLAY and XDG_RUNTIME_DIR are inherited by the terminal.",
      "If your desktop uses X11, allow the local user before retrying:",
      `  xhost +SI:localuser:${process.env.USER || "on4r4p"}`,
      "After the login is saved, you can revoke it with:",
      `  xhost -SI:localuser:${process.env.USER || "on4r4p"}`,
      `Original Playwright error: ${firstLine(original)}`
    ].join("\n");
  }
  return original;
}

function firstLine(value: string) {
  return value.split(/\r?\n/).find(Boolean) ?? value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run netns:x-login -- --account-id <id>");
  console.log("  npm run netns:x-login -- --vpn-profile ./ops/vpn/client.ovpn");
  console.log("  npm run netns:x-login -- --account-id <id> --resolve-alert");
  console.log("  npm run netns:x-login -- --account-id <id> --resolve-alert --auto-save-on-login --hold-open-after-save");
  console.log("  docker compose run --rm --service-ports x-login --account-id <id>");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    printLoginContextSummary(lastLoginContext);
    process.exit(1);
  });
}

function printLoginContextSummary(context: LoginContextSummary | null) {
  if (!context) {
    return;
  }

  console.error("");
  console.error("X login context");
  console.error(`  VPN public IPv4: ${context.vpnPublicIpv4 ?? "unknown"}`);
  console.error(`  OpenVPN profile: ${context.vpnProfilePath}`);
  console.error(`  Linked profiles: ${context.linkedVpnProfileCount}`);
  console.error(`  X account:       ${context.xIdentifier}`);
  console.error(`  Account id:      ${context.accountId}`);
}

function profilePathKey(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
