import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { runVpnDiagnostics, type VpnDiagnosticsReport } from "../diagnostics/vpn";
import { EnvService } from "../admin/envService";
import { XBrowserAccountService, type XBrowserAccountRecord } from "../admin/xBrowserAccountService";
import { XSessionAlertService } from "../admin/xSessionAlertService";
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
    } else {
      await assertXLoginApiReachable();
    }

    const storageStatePath = path.resolve(process.cwd(), account.storageStatePath);
    const browserProfileDir = path.resolve(process.cwd(), account.browserProfileDir);
    await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
    await fs.mkdir(browserProfileDir, { recursive: true });

    const executablePath = config.playwrightChromiumExecutablePath || findChromiumExecutable();
    const display = detectGraphicalDisplay();
    const launchArgs = [
      ...display.launchArgs,
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ];
    if (shouldDisableSandbox(config.playwrightDisableSandbox)) {
      launchArgs.push("--no-sandbox");
    }
    const cdpPort = Number(process.env.X_LOGIN_CDP_PORT || "9222");

    console.log(`X account: ${account.xIdentifier}`);
    console.log(`VPN profile: ${config.vpnConfig}`);
    console.log(`Linked VPN profiles on this X account: ${account.vpnProfilePaths.length}`);
    console.log(`VPN public IPv4: ${publicIpv4 ?? "unknown"}`);
    console.log(`Storage state will be saved to: ${account.storageStatePath}`);
    console.log(`Graphical display: ${display.label}`);
    console.log("A normal visible Chrome window will open through the VPN namespace.");
    console.log("Log in manually, including any 2FA or challenge requested by X.");
    if (args.autoSaveOnLogin) {
      console.log("Auto-save mode is active: RedqueenX will save the session as soon as it detects the X login cookie.");
      if (args.holdOpenAfterSave) {
        console.log("Manual alert mode is active: Chrome will stay open after the session is saved. Close Chrome yourself when the challenge is fully resolved.");
      }
    }

    const chrome = launchManualChrome(browserProfileDir, executablePath, launchArgs, cdpPort, display);

    try {
      await waitForChromeCdp(cdpPort, chrome);

      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      try {
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("Unable to access the Chrome browser context through CDP.");
        }
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

      const updated = accounts.markLogin(account.id, publicIpv4);
      const precheckReset = await resetXLoginNetworkPrecheck();
      console.log(greenTerminal("V Session validated and saved."));
      console.log(`Session saved for ${updated.xIdentifier}.`);
      console.log(`Last login IPv4 recorded as: ${updated.lastLoginPublicIpv4 ?? "unknown"}`);
      if (precheckReset) {
        console.log("X_LOGIN_SKIP_NETWORK_PRECHECK was reset to false in .env.");
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

function shouldDisableSandbox(configured: boolean) {
  const uid = process.getuid?.();
  return configured && uid === 0;
}

function findChromiumExecutable(): string | undefined {
  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable"
  ].find((candidate) => fsSync.existsSync(candidate));
}

function launchManualChrome(
  userDataDir: string,
  executablePath: string | undefined,
  args: string[],
  cdpPort: number,
  display: ReturnType<typeof detectGraphicalDisplay>
) {
  if (!executablePath) {
    throw new Error("No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH in Settings.");
  }

  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
    ...args,
    "https://x.com/i/flow/login"
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

async function waitForChromeCdp(port: number, chrome: ChildProcess) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  let stderr = "";
  chrome.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
    if (stderr.length > 8_000) {
      stderr = stderr.slice(-8_000);
    }
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
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

  throw new Error(`Chrome did not expose its local debugging endpoint at ${endpoint}.`);
}

async function ensureXLoginCookie(context: { cookies: (urls?: string[]) => Promise<Array<{ name: string }>> }) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  if (!cookies.some((cookie) => cookie.name === "auth_token")) {
    throw new Error(
      "X login cookie was not found. Keep the Chrome window open, finish the X login, then press Enter only after the account is visibly logged in."
    );
  }
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

function x11SocketPath(display: string) {
  const match = display.match(/:(\d+)/);
  return match ? `/tmp/.X11-unix/X${match[1]}` : undefined;
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
  console.log("  docker compose run --rm x-login --account-id <id>");
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
