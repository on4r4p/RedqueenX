import fs from "node:fs/promises";
import path from "node:path";

export const currentSessionLevels = ["info", "prob", "debug"] as const;
export type CurrentSessionLevel = (typeof currentSessionLevels)[number];

export interface CurrentSessionSnapshot {
  filePath: string;
  exists: boolean;
  updatedAt: string | null;
  lines: string[];
}

export interface CurrentSessionReadOptions {
  includeAdminPolling?: boolean;
  includeTweetContent?: boolean;
  includeTweetScore?: boolean;
  includeTweetFavoriteCount?: boolean;
  includeTweetRetweetCount?: boolean;
}

export class CurrentSessionService {
  constructor(
    private readonly filePath = path.resolve(process.cwd(), "runtime/current-session.log"),
    private readonly maxReadBytes = 4 * 1024 * 1024
  ) {}

  async record(
    level: CurrentSessionLevel,
    type: string,
    message: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const timestamp = new Date().toISOString();
    const dataText = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
    await fs.appendFile(this.filePath, `[${timestamp}] ${level.toUpperCase()} ${type} ${message}${dataText}\n`, "utf8");
  }

  async read(
    limit = 200,
    level: CurrentSessionLevel = "debug",
    options: CurrentSessionReadOptions = {}
  ): Promise<CurrentSessionSnapshot> {
    try {
      const [content, stat] = await Promise.all([this.readTailContent(), fs.stat(this.filePath)]);
      return {
        filePath: this.filePath,
        exists: true,
        updatedAt: stat.mtime.toISOString(),
        lines: filterTailLines(content, limit, level, options)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          filePath: this.filePath,
          exists: false,
          updatedAt: null,
          lines: []
        };
      }
      throw error;
    }
  }

  private async readTailContent(): Promise<string> {
    const file = await fs.open(this.filePath, "r");
    try {
      const stat = await file.stat();
      const length = Math.min(stat.size, this.maxReadBytes);
      const start = Math.max(0, stat.size - length);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  }
}

function filterTailLines(
  content: string,
  limit: number,
  level: CurrentSessionLevel,
  options: CurrentSessionReadOptions
): string[] {
  const allowed = allowedLevels(level);
  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (isTweetLine(line)) {
        return shouldShowTweetLine(options);
      }
      return allowed.has(readLineLevel(line));
    });

  const visibleLines = options.includeAdminPolling ? lines : filterAdminPolling(lines);
  const formattedLines = visibleLines.map((line) => formatLine(line, options));
  return insertEventSpacing(formattedLines.slice(-limit));
}

function filterAdminPolling(lines: string[]): string[] {
  const pollingReqIds = new Set<string>();
  for (const line of lines) {
    if (isAdminPollingRequestLine(line)) {
      const reqId = readReqId(line);
      if (reqId) {
        pollingReqIds.add(reqId);
      }
    }
  }

  return lines.filter((line) => {
    if (isAdminPollingRequestLine(line)) {
      return false;
    }
    const reqId = readReqId(line);
    return !reqId || !pollingReqIds.has(reqId);
  });
}

function isAdminPollingRequestLine(line: string): boolean {
  return adminPollingPaths.some((path) => line.includes(path));
}

const adminPollingPaths = ["/admin/session/current", "/admin/session/keywords"];

function readReqId(line: string): string | null {
  return line.match(/"reqId":"([^"]+)"/)?.[1] ?? null;
}

function insertEventSpacing(lines: string[]): string[] {
  const spaced: string[] = [];
  let previousReqId: string | null = null;
  let previousWasLogLine = false;
  for (const line of lines) {
    const reqId = readReqId(line);
    const isLogLine = line.startsWith("[");
    if ((isLogLine && previousWasLogLine) || (reqId && previousReqId && previousReqId !== reqId)) {
      spaced.push("");
    }
    spaced.push(line);
    if (reqId) {
      previousReqId = reqId;
    }
    previousWasLogLine = isLogLine;
  }
  return spaced;
}

function isTweetLine(line: string): boolean {
  return line.includes(" tweet.received ") || line.includes(" tweet.prefilter_rejected ");
}

function shouldShowTweetLine(options: CurrentSessionReadOptions): boolean {
  return Boolean(
    options.includeTweetContent ||
      options.includeTweetScore ||
      options.includeTweetFavoriteCount ||
      options.includeTweetRetweetCount
  );
}

function formatLine(line: string, options: CurrentSessionReadOptions): string {
  if (isManualVerificationLine(line)) {
    return formatManualVerificationLine(line);
  }
  if (isVpnLine(line)) {
    return formatJsonPayloadLine(line);
  }
  if (isBrowserLine(line)) {
    return formatJsonPayloadLine(line);
  }
  if (isKeywordUserPruneLine(line)) {
    return formatKeywordUserPruneLine(line);
  }
  if (isTweetLine(line)) {
    return formatTweetLine(line, options);
  }
  return line;
}

function isManualVerificationLine(line: string): boolean {
  return line.includes(" x.manual_verification.required ") || line.includes(" x.session_alert.open ");
}

function formatManualVerificationLine(line: string): string {
  const payloadStart = line.indexOf("{");
  if (payloadStart < 0) {
    return line;
  }

  try {
    const payload = JSON.parse(line.slice(payloadStart)) as Record<string, unknown>;
    const accountId = valueText(payload.accountId);
    const xIdentifier = valueText(payload.xIdentifier);
    const vpnProfilePath = valueText(payload.vpnProfilePath);
    const publicIpv4 = valueText(payload.publicIpv4);
    const alertType = valueText(payload.alertType);
    const message = valueText(payload.message) || "RedqueenX stopped because X requested a manual verification.";
    const recommendation =
      valueText(payload.recommendation) ||
      "Log in manually from the usual IP/VPN profile used by this X account, resolve the challenge, then mark the alert as resolved.";
    const details = payload.details && typeof payload.details === "object" ? (payload.details as Record<string, unknown>) : {};
    const refreshRetry =
      details.refreshRetry && typeof details.refreshRetry === "object" ? (details.refreshRetry as Record<string, unknown>) : null;
    const commands = Array.isArray(payload.commands)
      ? payload.commands.map((command) => `  ${String(command)}`).join("\n")
      : accountId
        ? [
            "  npm run setup:local",
            `  npm run netns:x-login -- --account-id ${accountId} --resolve-alert --auto-save-on-login --hold-open-after-save`,
            "  npm run netns:diagnose",
            "  npm run netns:worker"
          ].join("\n")
        : "";

    return [
      "============================================================",
      "X MANUAL VERIFICATION REQUIRED",
      "============================================================",
      message,
      "No more scraping or login will run for this X account until this alert is resolved.",
      `Account: ${xIdentifier || accountId || "unknown"}`,
      `VPN profile: ${vpnProfilePath || "unknown"}`,
      `Detected IP: ${publicIpv4 || "unknown"}`,
      `Challenge type: ${alertType || "unknown"}`,
      details.url ? `X URL: ${valueText(details.url)}` : "",
      details.title ? `Page title: ${valueText(details.title)}` : "",
      details.reason ? `Detected reason: ${valueText(details.reason)}` : "",
      Array.isArray(details.detectionSignals) && details.detectionSignals.length
        ? `Detection signals: ${details.detectionSignals.map(valueText).join(" | ")}`
        : "",
      refreshRetry ? formatManualVerificationRefreshRetry(refreshRetry) : "",
      details.snapshotPath ? `Evidence snapshot: ${valueText(details.snapshotPath)}` : "",
      "",
      "What to do:",
      recommendation,
      commands ? `\nRecommended commands for visible login and session capture:\n${commands}` : "",
      "============================================================"
    ]
      .filter((part) => part !== "")
      .join("\n");
  } catch {
    return line;
  }
}

function formatManualVerificationRefreshRetry(refreshRetry: Record<string, unknown>): string {
  const retryDelayMs = Number(refreshRetry.retryDelayMs);
  const waitedSeconds = Number.isFinite(retryDelayMs) ? Math.round(retryDelayMs / 1_000) : null;
  const confirmedSameAlert = refreshRetry.confirmedSameAlert === true;
  const confirmedReason = valueText(refreshRetry.confirmedReason);
  return [
    `Refresh retry: waited ${waitedSeconds ?? "?"}s and reloaded X once before opening this alert.`,
    confirmedSameAlert ? "Same alert confirmed after refresh." : "A session alert was still present after refresh.",
    confirmedReason ? `Confirmed reason: ${confirmedReason}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function isVpnLine(line: string): boolean {
  return line.includes(" vpn.");
}

function isBrowserLine(line: string): boolean {
  return line.includes(" browser.");
}

function isKeywordUserPruneLine(line: string): boolean {
  return line.includes(" keyword_user_prune.");
}

function formatKeywordUserPruneLine(line: string): string {
  const payloadStart = line.indexOf("{");
  if (payloadStart < 0) {
    return line;
  }

  try {
    const prefix = line.slice(0, payloadStart).trimEnd();
    const payload = JSON.parse(line.slice(payloadStart)) as Record<string, unknown>;
    const event = prefix.match(/\s(keyword_user_prune\.[^\s]+)/)?.[1] ?? "keyword_user_prune";
    const keyword = valueText(payload.keyword);
    const handle = valueText(payload.handle);
    const position = valueText(payload.position);
    const total = valueText(payload.totalCandidates);
    const remaining = valueText(payload.remainingUsers);
    const processed = valueText(payload.processedUsers);
    const progress = total
      ? `${processed || position || "0"}/${total} checked, ${remaining || "0"} @user remaining`
      : "";

    if (event.endsWith(".started")) {
      const alreadyChecked = valueText(payload.skippedAlreadyCheckedUsers);
      return `${prefix}\nStale @keyword cleanup started: ${valueText(payload.totalCandidates) || "0"} @user to check, threshold ${valueText(payload.maxAgeDays) || "?"} days${alreadyChecked ? `, ${alreadyChecked} already checked skipped` : ""}.`;
    }
    if (event.endsWith(".resume_skipped")) {
      return `${prefix}\nSkipped ${valueText(payload.skippedAlreadyCheckedUsers) || "0"} @user already checked by this cleanup. ${valueText(payload.remainingUsers) || "0"} @user remaining to check.`;
    }
    if (event.endsWith(".user_search")) {
      return `${prefix}\nChecking ${keyword || handle || "unknown user"}${progress ? ` (${progress})` : ""}. Search: ${valueText(payload.searchQuery) || "unknown"}`;
    }
    if (event.endsWith(".random_pause")) {
      const seconds = Math.round(Number(payload.delayMs || 0) / 1000);
      return `${prefix}\nPause ${seconds}s before ${valueText(payload.phase) || "next action"} for ${keyword || handle || "unknown user"}${progress ? ` (${progress})` : ""}.`;
    }
    if (event.endsWith(".progress")) {
      return `${prefix}\nChecked ${keyword || handle || "unknown user"}: ${valueText(payload.decision) || "done"}. ${progress}. Removed ${valueText(payload.removedUsers) || "0"}, kept ${valueText(payload.keptUsers) || "0"}, skipped ${valueText(payload.skippedUsers) || "0"}.`;
    }
    if (event.endsWith(".removed")) {
      if (valueText(payload.reason) === "protected_posts") {
        return `${prefix}\nRemoved ${keyword || handle || "unknown user"} from Keywords and moved it to Stale keyword users because posts are protected. ${progress}.`;
      }
      if (valueText(payload.reason) === "account_suspended") {
        return `${prefix}\nRemoved ${keyword || handle || "unknown user"} from Keywords and moved it to Stale keyword users because the account is suspended. ${progress}.`;
      }
      if (valueText(payload.reason) === "user_not_found") {
        return `${prefix}\nRemoved ${keyword || handle || "unknown user"} from Keywords and moved it to Stale keyword users because the account was not found. ${progress}.`;
      }
      return `${prefix}\nRemoved ${keyword || handle || "unknown user"} from Keywords: latest tweet ${valueText(payload.latestTweetCreatedAt) || "unknown date"}, age ${valueText(payload.ageDays) || "?"} days. ${progress}.`;
    }
    if (event.endsWith(".user_kept")) {
      return `${prefix}\nKept ${keyword || handle || "unknown user"}: latest tweet age ${valueText(payload.ageDays) || "?"} days. ${progress}.`;
    }
    if (event.endsWith(".user_skipped")) {
      return `${prefix}\nSkipped ${keyword || handle || "unknown user"}: ${valueText(payload.reason) || "unknown reason"}. ${progress}.`;
    }
    if (event.endsWith(".already_stale_skipped")) {
      return `${prefix}\nSkipped ${keyword || handle || "unknown user"}: already in Stale keyword users. Removed ${valueText(payload.deletedKeywords) || "0"} matching keyword entry without opening X. ${valueText(payload.remainingUsers) || "0"} @user remaining to check.`;
    }
    if (event.endsWith(".completed")) {
      return `${prefix}\nStale @keyword cleanup completed: ${valueText(payload.processedCandidates) || "0"}/${valueText(payload.totalCandidates) || "0"} checked, ${valueText(payload.removedUsers) || "0"} removed, ${valueText(payload.keptUsers) || "0"} kept, ${valueText(payload.skippedUsers) || "0"} skipped.`;
    }
    return formatJsonPayloadLine(line);
  } catch {
    return line;
  }
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function formatJsonPayloadLine(line: string): string {
  const payloadStart = line.indexOf("{");
  if (payloadStart < 0) {
    return line;
  }

  try {
    const prefix = line.slice(0, payloadStart).trimEnd();
    const payload = JSON.parse(line.slice(payloadStart)) as Record<string, unknown>;
    return `${prefix}\n${JSON.stringify(payload, null, 2)}`;
  } catch {
    return line;
  }
}

function formatTweetLine(line: string, options: CurrentSessionReadOptions): string {
  const payloadStart = line.indexOf("{");
  if (payloadStart < 0) {
    return line;
  }

  try {
    const prefix = line.slice(0, payloadStart).trimEnd();
    const payload = JSON.parse(line.slice(payloadStart)) as Record<string, unknown>;
    const visiblePayload: Record<string, unknown> = {
      tweetId: payload.tweetId,
      author: payload.author,
      keyword: payload.keyword,
      accepted: payload.accepted,
      createdAt: payload.createdAt
    };
    if (options.includeTweetScore) {
      visiblePayload.score = payload.score;
      visiblePayload.reasons = payload.reasons;
    }
    if (options.includeTweetFavoriteCount) {
      visiblePayload.favoriteCount = payload.favoriteCount;
    }
    if (options.includeTweetRetweetCount) {
      visiblePayload.retweetCount = payload.retweetCount;
    }
    if (options.includeTweetContent) {
      visiblePayload.text = payload.text;
    }
    return `${prefix}\n${JSON.stringify(visiblePayload, null, 2)}`;
  } catch {
    return line;
  }
}

function allowedLevels(level: CurrentSessionLevel): Set<CurrentSessionLevel> {
  if (level === "info") {
    return new Set(["info"]);
  }
  if (level === "prob") {
    return new Set(["info", "prob"]);
  }
  return new Set(["info", "prob", "debug"]);
}

function readLineLevel(line: string): CurrentSessionLevel {
  const match = line.match(/^\[[^\]]+\]\s+(INFO|PROB|DEBUG)\s+/);
  if (!match) {
    return "info";
  }
  return match[1].toLowerCase() as CurrentSessionLevel;
}
