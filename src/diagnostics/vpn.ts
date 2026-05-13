import fs from "node:fs/promises";
import fsSync from "node:fs";
import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

type CheckStatus = "ok" | "warn" | "fail" | "skipped";

interface CheckResult<T = unknown> {
  status: CheckStatus;
  value?: T;
  error?: string;
}

export interface VpnDiagnosticsReport {
  generatedAt: string;
  hostname: string;
  checks: Record<string, CheckResult>;
  warnings: string[];
  failures: string[];
}

interface VpnDiagnosticsOptions {
  includePlaywright?: boolean;
  strict?: boolean;
}

const execFileAsync = promisify(execFile);

export const webrtcCandidateExtractorSource = String.raw`
  return (async () => {
    const PeerConnection = globalThis.RTCPeerConnection;
    if (!PeerConnection) return [];

    const pc = new PeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const results = [];

    pc.createDataChannel("redqueenx-vpn-test");
    pc.onicecandidate = (event) => {
      const candidate = event && event.candidate && event.candidate.candidate;
      if (candidate) results.push(candidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    pc.close();
    return results;
  })();
`;

export async function runVpnDiagnostics(options: VpnDiagnosticsOptions = {}): Promise<VpnDiagnosticsReport> {
  const warnings: string[] = [];
  const failures: string[] = [];
  const strict = options.strict ?? process.env.VPN_DIAGNOSTIC_STRICT === "true";
  const checkHostIpv4Leak = process.env.VPN_CHECK_HOST_IPV4_LEAK !== "false";
  const checkIpv6 = process.env.VPN_CHECK_IPV6 === "true";
  const hostPublicIpv4 = normalizedOptionalEnv("VPN_HOST_PUBLIC_IPV4");
  const hostPublicIpv6 = normalizedOptionalEnv("VPN_HOST_PUBLIC_IPV6");

  const checks: Record<string, CheckResult> = {
    hostPublicIpv4: hostPublicIpv4
      ? { status: "ok", value: hostPublicIpv4 }
      : { status: "warn", error: "Not detected before entering the VPN namespace." },
    hostPublicIpv6: hostPublicIpv6
      ? { status: "ok", value: hostPublicIpv6 }
      : { status: "skipped", value: "No host IPv6 detected before entering the VPN namespace." },
    publicIpv4: await safeCheck(async () => fetchPublicIp(4)),
    publicIpv6: checkIpv6 ? await checkPublicIpv6() : { status: "skipped", value: "Disabled by VPN_CHECK_IPV6=false" },
    resolvConf: await safeCheck(async () => fs.readFile("/etc/resolv.conf", "utf8")),
    dnsLookup: await safeCheck(async () => dns.lookup("example.com", { all: true })),
    cloudflareWhoami: await safeCheck(async () => {
      const resolver = new dns.Resolver();
      resolver.setServers(["1.1.1.1"]);
      return resolver.resolveTxt("whoami.cloudflare");
    })
  };

  if (options.includePlaywright ?? process.env.VPN_DIAGNOSTIC_PLAYWRIGHT !== "false") {
    checks.playwright = await safeCheck(runPlaywrightDiagnostics);
    evaluatePlaywrightCheck(
      checks.playwright,
      hostPublicIpv4,
      hostPublicIpv6,
      checkHostIpv4Leak,
      checkIpv6,
      warnings,
      failures,
      strict
    );
  } else {
    checks.playwright = { status: "skipped", value: "Disabled by VPN_DIAGNOSTIC_PLAYWRIGHT=false" };
  }

  applyPublicIpv4Fallback(checks, warnings);
  evaluateIpv4LeakCheck("publicIpv4", checks.publicIpv4, hostPublicIpv4, checkHostIpv4Leak, warnings, failures, strict);
  if (checkIpv6) {
    evaluateIpv6LeakCheck(checks.publicIpv6, hostPublicIpv6, warnings, failures, strict);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    hostname: os.hostname(),
    checks,
    warnings,
    failures
  };
  await recordDiagnosticsToCurrentSession(report);
  return report;
}

async function runPlaywrightDiagnostics() {
  const chromium = await loadChromium();
  const executablePath = normalizedOptionalEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH") ?? findChromiumExecutable();
  const args = [
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer"
  ];
  if (process.env.PLAYWRIGHT_DISABLE_SANDBOX !== "false") {
    args.push("--no-sandbox");
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args
  });

  try {
    const page = await browser.newPage();
    await page.goto("https://api.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: 15_000 });
    const ipifyBody = await page.textContent("body");
    const webrtcCandidates = await page.evaluate(new Function(webrtcCandidateExtractorSource) as () => Promise<string[]>);

    return {
      ipify: parseIpifyBody(ipifyBody),
      webrtcCandidates
    };
  } finally {
    await browser.close();
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

async function loadChromium() {
  const coreModuleName = "playwright-core";
  const fullModuleName = "playwright";

  try {
    const { chromium } = (await import(coreModuleName)) as PlaywrightChromiumModule;
    return chromium;
  } catch (coreError) {
    try {
      const { chromium } = (await import(fullModuleName)) as PlaywrightChromiumModule;
      return chromium;
    } catch {
      throw new Error(`Cannot load playwright-core or playwright: ${errorMessage(coreError)}`);
    }
  }
}

interface PlaywrightChromiumModule {
  chromium: {
    launch: (options: {
      headless: boolean;
      executablePath?: string;
      args: string[];
    }) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
        textContent: (selector: string) => Promise<string | null>;
        evaluate: <T>(callback: string | (() => T) | (() => Promise<T>)) => Promise<T>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}

async function safeCheck<T>(check: () => Promise<T>): Promise<CheckResult<T>> {
  try {
    return { status: "ok", value: await check() };
  } catch (error) {
    return { status: "warn", error: errorMessage(error) };
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchPublicIp(family: 4 | 6): Promise<string> {
  const attempts = family === 4 ? publicIpv4Attempts() : publicIpv6Attempts();
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const value = normalizePublicIpResponse(await attempt.run());
      if (net.isIP(value) === family) {
        return value;
      }
      errors.push(`${attempt.label}: expected IPv${family}, got ${value || "empty response"}`);
    } catch (error) {
      errors.push(`${attempt.label}: ${errorMessage(error)}`);
    }
  }

  throw new Error(`Could not verify public IPv${family}. ${errors.join(" | ")}`);
}

async function checkPublicIpv6(): Promise<CheckResult<string>> {
  try {
    return { status: "ok", value: await fetchPublicIp(6) };
  } catch (error) {
    return { status: "skipped", value: `IPv6 unavailable or blocked: ${errorMessage(error)}` };
  }
}

async function fetchTextWithCurl(url: string, family: 4 | 6): Promise<string> {
  try {
    const { stdout } = await execFileAsync("curl", [`-${family}`, "-fsS", "--max-time", "10", url]);
    return stdout;
  } catch (error) {
    throw new Error(`curl -${family} ${url} failed: ${errorMessage(error)}`);
  }
}

function publicIpv4Attempts(): Array<{ label: string; run: () => Promise<string> }> {
  return [
    {
      label: "api.ipify.org",
      run: async () => fetchTextWithCurl("https://api.ipify.org?format=json", 4)
    },
    {
      label: "api.ipify.org via pinned IPv4",
      run: async () =>
        curlText(["-4", "-fsS", "--max-time", "10", "--resolve", "api.ipify.org:443:104.26.12.205", "https://api.ipify.org?format=json"])
    },
    {
      label: "ifconfig.co",
      run: async () => curlText(["-4", "-fsS", "--max-time", "10", "https://ifconfig.co/ip"])
    },
    {
      label: "ifconfig.me",
      run: async () => curlText(["-4", "-fsS", "--max-time", "10", "https://ifconfig.me/ip"])
    },
    {
      label: "Cloudflare trace 1.1.1.1",
      run: async () => parseCloudflareTraceIp(await curlText(["-4", "-fsSk", "--max-time", "10", "https://1.1.1.1/cdn-cgi/trace"]))
    },
    {
      label: "Cloudflare trace 1.0.0.1",
      run: async () => parseCloudflareTraceIp(await curlText(["-4", "-fsSk", "--max-time", "10", "https://1.0.0.1/cdn-cgi/trace"]))
    }
  ];
}

function publicIpv6Attempts(): Array<{ label: string; run: () => Promise<string> }> {
  return [
    {
      label: "api64.ipify.org",
      run: async () => fetchTextWithCurl("https://api64.ipify.org?format=json", 6)
    },
    {
      label: "ifconfig.co IPv6",
      run: async () => curlText(["-6", "-fsS", "--max-time", "10", "https://ifconfig.co/ip"])
    },
    {
      label: "Cloudflare trace IPv6 primary",
      run: async () =>
        parseCloudflareTraceIp(await curlText(["-6", "-fsSk", "--max-time", "10", "https://[2606:4700:4700::1111]/cdn-cgi/trace"]))
    },
    {
      label: "Cloudflare trace IPv6 secondary",
      run: async () =>
        parseCloudflareTraceIp(await curlText(["-6", "-fsSk", "--max-time", "10", "https://[2606:4700:4700::1001]/cdn-cgi/trace"]))
    }
  ];
}

async function curlText(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("curl", args);
    return stdout;
  } catch (error) {
    throw new Error(`curl ${args.join(" ")} failed: ${errorMessage(error)}`);
  }
}

function parseCloudflareTraceIp(trace: string): string {
  const line = trace
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("ip="));
  return line?.slice("ip=".length).trim() ?? "";
}

function normalizePublicIpResponse(response: string): string {
  const trimmed = response.trim();
  try {
    const parsed = JSON.parse(trimmed) as { ip?: unknown };
    if (typeof parsed.ip === "string") {
      return parsed.ip.trim();
    }
  } catch {
    // Plain text IP responses are still valid.
  }
  return trimmed;
}

function applyPublicIpv4Fallback(checks: Record<string, CheckResult>, warnings: string[]) {
  if (checks.publicIpv4.status === "ok") {
    return;
  }

  const playwright = checks.playwright?.value as { ipify?: string } | undefined;
  const ipify = playwright?.ipify;
  if (!ipify || net.isIP(ipify) !== 4) {
    return;
  }

  const originalError = checks.publicIpv4.error ?? String(checks.publicIpv4.value ?? "unknown error");
  checks.publicIpv4 = {
    status: "ok",
    value: ipify
  };
  warnings.push(`publicIpv4 curl check failed, but Playwright confirmed IPv4 ${ipify}. Original error: ${originalError}`);
}

function evaluateIpv4LeakCheck(
  checkName: string,
  check: CheckResult,
  hostPublicIp: string | undefined,
  checkHostLeak: boolean,
  warnings: string[],
  failures: string[],
  strict: boolean
) {
  if (check.status !== "ok" || typeof check.value !== "string") {
    const message = `${checkName} could not be verified.`;
    if (strict) failures.push(message);
    else warnings.push(message);
    return;
  }

  if (!checkHostLeak) {
    return;
  }

  if (!hostPublicIp) {
    warnings.push(`${checkName} host IPv4 leak check is enabled, but host public IPv4 was not provided by the launcher.`);
    return;
  }

  if (check.value === hostPublicIp) {
    failures.push(`${checkName} matches the host public IPv4 ${hostPublicIp}.`);
  }
}

function evaluateIpv6LeakCheck(
  check: CheckResult,
  hostPublicIp: string | undefined,
  warnings: string[],
  failures: string[],
  strict: boolean
) {
  if (check.status !== "ok" || typeof check.value !== "string") {
    return;
  }

  if (!hostPublicIp) {
    const message = `IPv6 is reachable as ${check.value}, but host public IPv6 was not detected before entering the namespace.`;
    if (strict) failures.push(message);
    else warnings.push(message);
    return;
  }

  if (check.value === hostPublicIp) {
    failures.push(`publicIpv6 matches the host public IPv6 ${hostPublicIp}.`);
  }
}

function evaluatePlaywrightCheck(
  check: CheckResult,
  hostPublicIpv4: string | undefined,
  hostPublicIpv6: string | undefined,
  checkIpv4Leak: boolean,
  checkIpv6Leak: boolean,
  warnings: string[],
  failures: string[],
  strict: boolean
) {
  if (check.status !== "ok") {
    const message = `Playwright diagnostics could not run: ${check.error ?? "unknown error"}.`;
    if (strict) failures.push(message);
    else warnings.push(message);
    return;
  }

  const value = check.value as { ipify?: string; webrtcCandidates?: string[] };
  if (value.ipify) {
    evaluateIpv4LeakCheck(
      "playwright.ipify",
      { status: "ok", value: value.ipify },
      hostPublicIpv4,
      checkIpv4Leak,
      warnings,
      failures,
      strict
    );
  }

  if (
    checkIpv4Leak &&
    hostPublicIpv4 &&
    value.webrtcCandidates?.some((candidate) => candidate.includes(hostPublicIpv4))
  ) {
    failures.push(`WebRTC candidates include the host public IPv4 ${hostPublicIpv4}.`);
  }

  if (
    checkIpv6Leak &&
    hostPublicIpv6 &&
    value.webrtcCandidates?.some((candidate) => candidate.includes(hostPublicIpv6))
  ) {
    failures.push(`WebRTC candidates include the host public IPv6 ${hostPublicIpv6}.`);
  }
}

function parseIpifyBody(body: string | null): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { ip?: string };
    return parsed.ip;
  } catch {
    return body.trim();
  }
}

async function recordDiagnosticsToCurrentSession(report: VpnDiagnosticsReport): Promise<void> {
  const sessionFile = normalizedOptionalEnv("CURRENT_SESSION_FILE");
  if (!sessionFile) {
    return;
  }

  const summary = summarizeDiagnosticsReport(report);
  const level = report.failures.length > 0 ? "PROB" : "INFO";
  const type = report.failures.length > 0 ? "vpn.diagnostics.failed" : "vpn.diagnostics.completed";
  const message = report.failures.length > 0 ? "VPN checks failed; protected command must stay blocked" : "VPN checks passed";
  const target = path.resolve(process.cwd(), sessionFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(
    target,
    `[${new Date().toISOString()}] ${level} ${type} ${message} ${JSON.stringify(summary)}\n`,
    "utf8"
  );
}

function summarizeDiagnosticsReport(report: VpnDiagnosticsReport): Record<string, unknown> {
  const playwright = report.checks.playwright?.value as
    | {
        ipify?: string;
        webrtcCandidates?: string[];
      }
    | undefined;

  return {
    checksPassed: report.failures.length === 0,
    status: report.failures.length === 0 ? "passed" : "failed",
    generatedAt: report.generatedAt,
    hostPublicIpv4: checkValue(report.checks.hostPublicIpv4),
    namespacePublicIpv4: checkValue(report.checks.publicIpv4),
    hostPublicIpv6: checkValue(report.checks.hostPublicIpv6),
    namespacePublicIpv6: checkValue(report.checks.publicIpv6),
    playwrightIpify: playwright?.ipify ?? null,
    webrtcCandidates: playwright?.webrtcCandidates ?? [],
    checks: Object.fromEntries(
      Object.entries(report.checks).map(([name, check]) => [
        name,
        {
          status: check.status,
          value: typeof check.value === "string" ? check.value : undefined,
          error: check.error
        }
      ])
    ),
    warnings: report.warnings,
    failures: report.failures
  };
}

function checkValue(check: CheckResult | undefined): unknown {
  if (!check) {
    return null;
  }
  if (check.status === "ok") {
    return check.value ?? null;
  }
  return check.error ?? check.value ?? null;
}

function normalizedOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const report = await runVpnDiagnostics({
    includePlaywright: process.env.VPN_DIAGNOSTIC_PLAYWRIGHT !== "false",
    strict: process.env.VPN_DIAGNOSTIC_STRICT === "true"
  });
  if (process.env.VPN_DIAGNOSTIC_OUTPUT === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDiagnosticsReport(report));
  }
  if (report.failures.length > 0) {
    process.exitCode = 1;
  }
}

export function formatDiagnosticsReport(report: VpnDiagnosticsReport): string {
  const lines: string[] = [];
  const playwright = report.checks.playwright?.value as { ipify?: string; webrtcCandidates?: string[] } | undefined;
  const status = report.failures.length === 0 ? "PASSED" : "FAILED";

  lines.push(`VPN diagnostics: ${status}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Host: ${report.hostname}`);
  lines.push("");
  lines.push("Network");
  lines.push(`  Host IPv4:       ${formatCheckShort(report.checks.hostPublicIpv4)}`);
  lines.push(`  Namespace IPv4:  ${formatCheckShort(report.checks.publicIpv4)}`);
  lines.push(`  Playwright IPv4: ${playwright?.ipify ?? "not available"}`);
  lines.push(`  Host IPv6:       ${formatCheckShort(report.checks.hostPublicIpv6)}`);
  lines.push(`  Namespace IPv6:  ${formatCheckShort(report.checks.publicIpv6)}`);
  lines.push(`  DNS lookup:      ${formatCheckShort(report.checks.dnsLookup)}`);
  lines.push(`  Resolver file:   ${formatCheckShort(report.checks.resolvConf)}`);

  if (playwright?.webrtcCandidates?.length) {
    lines.push("");
    lines.push("WebRTC candidates");
    for (const candidate of playwright.webrtcCandidates) {
      lines.push(`  - ${candidate}`);
    }
  }

  lines.push("");
  lines.push("Checks");
  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`  ${name}: ${check.status.toUpperCase()} ${formatCheckShort(check)}`);
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (report.failures.length > 0) {
    lines.push("");
    lines.push("Failures");
    for (const failure of report.failures) {
      lines.push(`  - ${failure}`);
    }
  }

  return lines.join("\n");
}

function formatCheckShort(check: CheckResult | undefined): string {
  if (!check) {
    return "missing";
  }
  if (typeof check.value === "string") {
    const singleLine = check.value.replace(/\s+/g, " ").trim();
    return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine;
  }
  if (Array.isArray(check.value)) {
    return `${check.value.length} entries`;
  }
  if (check.value && typeof check.value === "object") {
    return "available";
  }
  return check.error ?? String(check.value ?? "not available");
}

if (require.main === module) {
  void main();
}
