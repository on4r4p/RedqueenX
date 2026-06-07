#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const since = process.env.VPS_HEALTH_SINCE || "30 days ago";
const repoDir = process.env.REDQUEENX_DIR || "/opt/RedqueenX";
const outputPath = process.argv[2] || process.env.VPS_HEALTH_REPORT_PATH || path.join(repoDir, "runtime/docker/vps-health.json");
const composeFile = process.env.REDQUEENX_COMPOSE_FILE || path.join(repoDir, "compose.prod.yaml");
const caddyAccessLogPath =
  process.env.REDQUEENX_CADDY_ACCESS_LOG || path.join(repoDir, "runtime/docker/caddy-logs/access.log");
const securityHistoryPath =
  process.env.REDQUEENX_SECURITY_HISTORY_PATH || path.join(repoDir, "runtime/docker/vps-security-history.json");
const securityHistoryEventsPath =
  process.env.REDQUEENX_SECURITY_HISTORY_EVENTS_PATH || path.join(repoDir, "runtime/docker/vps-security-events.jsonl");
const healthFileMode = parseFileMode(process.env.REDQUEENX_HEALTH_FILE_MODE || "0644");
const suspiciousHttpStatuses = new Set([308, 400, 401, 403, 404, 405, 408, 429]);
const suspiciousPathPattern =
  /\.env|wp-login\.php|xmlrpc\.php|phpmyadmin|phpMyAdmin|cgi-bin|boaform|HNAP1|vendor\/phpunit|actuator|server-status|\.git|\.aws|config\.json|etc\/passwd|\.DS_Store|adminer|setup\.php|telescope|debug\/default\/view|solr\/admin|manager\/html|wp-admin|\.svn/i;

function safeExec(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd || repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 8000,
      maxBuffer: options.maxBuffer || 4_000_000
    });
    return { available: true, stdout, stderr: "" };
  } catch (error) {
    const code = error && error.code;
    return {
      available: code !== "ENOENT",
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr: typeof error.stderr === "string" ? error.stderr : "",
      error: commandErrorSummary(error)
    };
  }
}

function commandErrorSummary(error) {
  const stderr = typeof error.stderr === "string" ? error.stderr : "";
  const stdout = typeof error.stdout === "string" ? error.stdout : "";
  const message = typeof error.message === "string" ? error.message : String(error);
  return firstLine([stderr, stdout, message].filter(Boolean).join("\n")).slice(0, 500);
}

function firstLine(value) {
  return String(value).split(/\r?\n/).find(Boolean) || "";
}

function serviceStatus(name) {
  const active = safeExec("systemctl", ["is-active", name], { timeout: 3000, maxBuffer: 100000 });
  const status = active.available ? firstLine(active.stdout || active.stderr || "unknown") || "unknown" : "unavailable";
  return { name, available: active.available, status, error: active.error };
}

function journal(unitNames) {
  const args = [];
  for (const unit of unitNames) {
    args.push("-u", unit);
  }
  args.push("--since", since, "--no-pager", "-o", "cat");
  return safeExec("journalctl", args, { timeout: 8000, maxBuffer: 4_000_000 });
}

function sshHealth() {
  const result = journal(["ssh", "sshd"]);
  if (!result.available) {
    return {
      available: false,
      window: since,
      failedAttempts: 0,
      acceptedLogins: 0,
      topIps: [],
      loginIps: [],
      samples: [],
      error: result.error
    };
  }
  const lines = result.stdout.split(/\r?\n/);
  const failedLines = lines.filter((line) =>
    /Failed password|Invalid user|authentication failure|Connection closed by authenticating user/i.test(line)
  );
  const acceptedLines = lines.filter((line) => /Accepted password|Accepted publickey|Accepted keyboard-interactive/i.test(line));
  return {
    available: true,
    window: since,
    failedAttempts: failedLines.length,
    acceptedLogins: acceptedLines.length,
    topIps: topIpCounts(failedLines.join("\n")),
    loginIps: topIpCounts(acceptedLines.join("\n")),
    samples: [
      logSnippet("SSH accepted login log sample", acceptedLines),
      logSnippet("SSH failed attempt log sample", failedLines)
    ],
    error: result.stderr ? firstLine(result.stderr) : undefined
  };
}

function fail2banHealth() {
  const summary = safeExec("fail2ban-client", ["status"], { timeout: 5000 });
  const banLog = journal(["fail2ban"]);
  const banLines = banLog.available
    ? banLog.stdout.split(/\r?\n/).filter((line) => /\bBan\s+\d{1,3}(?:\.\d{1,3}){3}\b/i.test(line))
    : [];
  const jails = parseFail2banJails(summary.stdout);
  const jailNames = Array.from(new Set(["sshd", ...jails])).filter(Boolean).slice(0, 20);
  const jailStats = jailNames.map((jail) => {
    const status = safeExec("fail2ban-client", ["status", jail], { timeout: 5000 });
    const text = status.stdout || "";
    return {
      jail,
      available: status.available && !status.error,
      currentlyBanned: parseNumberAfterLabel(text, "Currently banned"),
      totalBanned: parseNumberAfterLabel(text, "Total banned"),
      bannedIps: parseFail2banBannedIps(text),
      error: status.error,
      sample: logSnippet(`fail2ban ${jail} status`, text.split(/\r?\n/), 40)
    };
  });
  const sshd = jailStats.find((jail) => jail.jail === "sshd") || {
    currentlyBanned: 0,
    totalBanned: 0,
    bannedIps: []
  };
  const summaryOk = summary.available && !summary.error;
  const anyJailOk = jailStats.some((jail) => jail.available);
  if (!summaryOk && !anyJailOk) {
    return {
      available: false,
      jails: [],
      sshd: { currentlyBanned: 0, totalBanned: 0, bannedIps: [] },
      banLogIps: topIpCounts(banLines.join("\n"), 500),
      jailStats: [],
      samples: [logSnippet("fail2ban ban event sample", banLines, 40, banLog.error)],
      error: summary.error || sshd.error
    };
  }
  return {
    available: true,
    jails,
    sshd: {
      currentlyBanned: sshd.currentlyBanned,
      totalBanned: sshd.totalBanned,
      bannedIps: sshd.bannedIps
    },
    banLogIps: topIpCounts(banLines.join("\n"), 500),
    jailStats: jailStats.map(({ sample, ...jail }) => jail),
    samples: [
      logSnippet("fail2ban status", summary.stdout.split(/\r?\n/), 40),
      logSnippet("fail2ban ban event sample", banLines, 40, banLog.error),
      ...jailStats.map((jail) => jail.sample)
    ],
    error: !summaryOk ? summary.error : !sshd.available ? sshd.error : undefined
  };
}

function caddyScanHealth() {
  const journalResult = journal(["caddy"]);
  const accessLogResult = readFileTail(caddyAccessLogPath, 2_000_000);
  if (!journalResult.available && !accessLogResult.available) {
    return {
      available: false,
      window: since,
      suspiciousRequests: 0,
      statusHits: 0,
      statusCounts: [],
      topIps: [],
      statusIps: [],
      samples: [],
      accessLogPath: caddyAccessLogPath,
      error: journalResult.error || accessLogResult.error
    };
  }
  const lines = [
    ...journalResult.stdout.split(/\r?\n/).filter(Boolean),
    ...accessLogResult.stdout.split(/\r?\n/).filter(Boolean)
  ];
  const suspiciousLines = lines.filter((line) => suspiciousPathPattern.test(line));
  const statusLines = lines.filter((line) => {
    const status = httpStatusFromLine(line);
    return status !== null && suspiciousHttpStatuses.has(status);
  });
  return {
    available: true,
    window: since,
    accessLogPath: caddyAccessLogPath,
    sources: {
      journal: journalResult.available,
      accessLog: accessLogResult.available
    },
    suspiciousRequests: suspiciousLines.length,
    statusHits: statusLines.length,
    statusCounts: statusCounts(statusLines),
    topIps: topIpCounts(suspiciousLines.join("\n")),
    statusIps: topIpCounts(statusLines.join("\n")),
    samples: [
      logSnippet("Caddy suspicious path sample", suspiciousLines.map(formatCaddyLine)),
      logSnippet("Caddy suspicious status sample", statusLines.map(formatCaddyLine)),
      logSnippet("Caddy access log tail", accessLogResult.stdout.split(/\r?\n/).filter(Boolean).map(formatCaddyLine), 20, accessLogResult.error)
    ],
    error: journalResult.stderr ? firstLine(journalResult.stderr) : accessLogResult.error
  };
}

function webhookHealth() {
  const result = journal(["redqueenx-webhook"]);
  if (!result.available) {
    return { available: false, window: since, posts: 0, invalidSignatures: 0, errors: 0, topIps: [], samples: [], error: result.error };
  }
  const suspiciousLines = result.stdout
    .split(/\r?\n/)
    .filter((line) => /invalid payload signatures|error evaluating hook|error occurred|error in exec|POST \/hooks/i.test(line));
  return {
    available: true,
    window: since,
    posts: countMatches(result.stdout, /incoming HTTP POST|POST \/hooks/gi),
    invalidSignatures: countMatches(result.stdout, /invalid payload signatures/gi),
    errors: countMatches(result.stdout, /error evaluating hook|error occurred|error in exec/gi),
    topIps: topIpCounts(result.stdout),
    samples: [logSnippet("Webhook suspicious activity sample", suspiciousLines)]
  };
}

function dockerComposeHealth() {
  const result = safeExec("docker", ["compose", "-f", composeFile, "ps"], { timeout: 6000, maxBuffer: 500000 });
  if (!result.available) {
    return { available: false, services: [], logIps: [], samples: [], error: result.error };
  }
  const logs = safeExec("docker", ["compose", "-f", composeFile, "logs", "--tail", "120"], {
    timeout: 8000,
    maxBuffer: 1_000_000
  });
  const services = result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s{2,}/);
      return {
        name: parts[0] || line,
        status: parts.find((part) => /\b(Up|Exited|Restarting|Created|Paused)\b/i.test(part)) || parts.at(-1) || "unknown"
      };
    });
  return {
    available: true,
    services,
    logIps: topIpCounts(logs.stdout),
    samples: [
      logSnippet("Docker compose ps", result.stdout.split(/\r?\n/), 40, result.error),
      logSnippet("Docker compose logs tail", logs.stdout.split(/\r?\n/), 80, logs.error)
    ],
    error: result.error
  };
}

function firewallHealth() {
  const rules = safeExec("iptables", ["-S"], { timeout: 5000, maxBuffer: 1_000_000 });
  const chains = safeExec("iptables", ["-L", "-n", "--line-numbers"], { timeout: 5000, maxBuffer: 1_000_000 });
  const nft = safeExec("nft", ["list", "ruleset"], { timeout: 5000, maxBuffer: 1_000_000 });
  const interestingRules = (rules.stdout || "")
    .split(/\r?\n/)
    .filter((line) => /f2b|fail2ban|redqueenx|DROP|REJECT|BLACKLIST/i.test(line));
  return {
    available: rules.available || nft.available,
    droppedIps: topIpCounts([...interestingRules, ...filterInterestingFirewallLines(nft.stdout)].join("\n"), 500),
    samples: [
      logSnippet("iptables fail2ban/drop rules", interestingRules.length ? interestingRules : rules.stdout.split(/\r?\n/), 80, rules.error),
      logSnippet("iptables chain counters", chains.stdout.split(/\r?\n/), 80, chains.error),
      logSnippet("nft ruleset fail2ban/drop rules", filterInterestingFirewallLines(nft.stdout), 80, nft.error)
    ],
    error: rules.available || nft.available ? undefined : rules.error || nft.error
  };
}

function filterInterestingFirewallLines(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => /f2b|fail2ban|redqueenx|drop|reject|blacklist/i.test(line));
}

function readFileTail(filePath, maxBytes) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return { available: false, stdout: "", stderr: "", error: "not a regular file" };
    }
    const start = Math.max(0, stats.size - maxBytes);
    const length = stats.size - start;
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return { available: true, stdout: buffer.toString("utf8"), stderr: "" };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return {
      available: false,
      stdout: "",
      stderr: "",
      error: commandErrorSummary(error)
    };
  }
}

function logSnippet(label, lines, limit = 12, error) {
  return {
    label,
    lines: lines.filter(Boolean).slice(-limit).map(cleanLogLine),
    error
  };
}

function cleanLogLine(line) {
  return String(line).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
}

function httpStatusFromLine(line) {
  const parsed = parseCaddyJson(line);
  if (parsed && Number.isInteger(parsed.status)) {
    return parsed.status;
  }
  const jsonMatch = String(line).match(/"status":\s*(\d{3})\b/);
  if (jsonMatch) {
    return Number(jsonMatch[1]);
  }
  const combinedMatch = String(line).match(/"\S+\s+\S+\s+HTTP\/[0-9.]+"\s+(\d{3})\b/);
  return combinedMatch ? Number(combinedMatch[1]) : null;
}

function statusCounts(lines) {
  const counts = new Map();
  for (const line of lines) {
    const status = httpStatusFromLine(line);
    if (status === null) continue;
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return Array.from(counts, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status - b.status);
}

function parseCaddyJson(line) {
  try {
    const parsed = JSON.parse(line);
    const request = parsed && typeof parsed === "object" ? parsed.request || {} : {};
    return {
      ts: parsed.ts,
      status: Number(parsed.status),
      method: request.method,
      uri: request.uri,
      ip: request.client_ip || request.remote_ip,
      host: request.host
    };
  } catch {
    return null;
  }
}

function formatCaddyLine(line) {
  const parsed = parseCaddyJson(line);
  if (!parsed) return line;
  const ts = typeof parsed.ts === "number" ? new Date(parsed.ts * 1000).toISOString() : "";
  return [ts, parsed.ip, parsed.method, parsed.host, parsed.uri, parsed.status ? `status=${parsed.status}` : ""]
    .filter(Boolean)
    .join(" ");
}

function securityHistory(report) {
  const now = report.generatedAt || new Date().toISOString();
  const history = readSecurityHistory();
  const byIp = history.byIp && typeof history.byIp === "object" ? history.byIp : {};
  const events = [];

  for (const row of report.ssh?.topIps || []) {
    events.push({
      at: now,
      ip: row.ip,
      action: "ssh_failed",
      source: "ssh",
      count: row.count,
      detail: `${row.count} failed SSH attempt(s) in ${report.ssh.window || since}`
    });
  }

  for (const jail of report.fail2ban?.jailStats || []) {
    for (const ip of jail.bannedIps || []) {
      events.push({
        at: now,
        ip,
        action: "banned",
        source: `fail2ban:${jail.jail}`,
        count: 1,
        detail: `currently banned in ${jail.jail}`
      });
    }
  }

  for (const row of report.fail2ban?.banLogIps || []) {
    events.push({
      at: now,
      ip: row.ip,
      action: "banned",
      source: "fail2ban:journal",
      count: row.count,
      detail: `${row.count} fail2ban Ban event(s) in ${report.ssh?.window || since}`
    });
  }

  for (const row of report.firewall?.droppedIps || []) {
    events.push({
      at: now,
      ip: row.ip,
      action: "dropped",
      source: "firewall",
      count: row.count,
      detail: "present in iptables/nft drop or reject rules"
    });
  }

  for (const event of events) {
    if (!event.ip) continue;
    const existing = byIp[event.ip] || {
      ip: event.ip,
      firstSeen: now,
      lastSeen: now,
      actions: [],
      sources: [],
      observations: 0,
      sshFailedCount: 0,
      bannedCount: 0,
      droppedCount: 0
    };
    existing.lastSeen = now;
    existing.actions = mergeUnique(existing.actions, [event.action]);
    existing.sources = mergeUnique(existing.sources, [event.source]);
    existing.observations = Number(existing.observations || 0) + 1;
    if (event.action === "ssh_failed") {
      existing.sshFailedCount = Math.max(Number(existing.sshFailedCount || 0), Number(event.count || 1));
    }
    if (event.action === "banned") {
      existing.bannedCount = Number(existing.bannedCount || 0) + 1;
    }
    if (event.action === "dropped") {
      existing.droppedCount = Number(existing.droppedCount || 0) + 1;
    }
    existing.lastDetail = event.detail;
    byIp[event.ip] = existing;
  }

  appendSecurityEvents(events);

  const ips = Object.values(byIp).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)) || a.ip.localeCompare(b.ip));
  const next = {
    version: 1,
    updatedAt: now,
    path: securityHistoryPath,
    eventsPath: securityHistoryEventsPath,
    ipCount: ips.length,
    byIp,
    ips
  };
  writeJsonFile(securityHistoryPath, next);
  return {
    available: true,
    path: securityHistoryPath,
    eventsPath: securityHistoryEventsPath,
    ipCount: ips.length,
    ips,
    samples: [logSnippet("Persisted security IP history", ips.map(formatHistoryLine), 40)]
  };
}

function readSecurityHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(securityHistoryPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return { version: 1, byIp: {} };
  }
  return { version: 1, byIp: {} };
}

function appendSecurityEvents(events) {
  const lines = events
    .filter((event) => event.ip)
    .map((event) => `${JSON.stringify(event)}\n`)
    .join("");
  if (!lines) return;
  fs.mkdirSync(path.dirname(securityHistoryEventsPath), { recursive: true });
  fs.appendFileSync(securityHistoryEventsPath, lines, { mode: healthFileMode });
  chmodIfPossible(securityHistoryEventsPath, healthFileMode);
}

function mergeUnique(existing, values) {
  return Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...values])).sort();
}

function formatHistoryLine(entry) {
  const actions = Array.isArray(entry.actions) ? entry.actions.join(",") : "";
  const sources = Array.isArray(entry.sources) ? entry.sources.join(",") : "";
  return `${entry.ip} actions=${actions} sources=${sources} first=${entry.firstSeen} last=${entry.lastSeen} observations=${entry.observations}`;
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: healthFileMode });
  chmodIfPossible(filePath, healthFileMode);
}

function chmodIfPossible(filePath, mode) {
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Best effort. The collector still produces the report when chmod is denied.
  }
}

function parseFileMode(value) {
  const parsed = Number.parseInt(String(value), 8);
  return Number.isFinite(parsed) ? parsed : 0o644;
}

function topIpCounts(text, limit = 30) {
  const counts = new Map();
  for (const ip of extractIps(text)) {
    counts.set(ip, (counts.get(ip) || 0) + 1);
  }
  return Array.from(counts, ([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip))
    .slice(0, limit);
}

function extractIps(text) {
  const ips = String(text).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return ips.filter((ip) => ip.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255));
}

function parseNumberAfterLabel(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`${escaped}:\\s*(\\d+)`, "i"));
  return match ? Number(match[1]) : 0;
}

function parseFail2banJails(text) {
  const match = String(text).match(/Jail list:\s*(.+)$/im);
  if (!match) return [];
  return match[1].split(/,\s*/).map((jail) => jail.trim()).filter(Boolean);
}

function parseFail2banBannedIps(text) {
  const match = String(text).match(/Banned IP list:\s*(.*)$/im);
  if (!match || !match[1].trim()) return [];
  return extractIps(match[1]);
}

function countMatches(text, pattern) {
  return Array.from(String(text).matchAll(pattern)).length;
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    inDocker: false,
    cwd: repoDir,
    host: os.hostname(),
    source: "host-collector"
  },
  services: [serviceStatus("docker"), serviceStatus("caddy"), serviceStatus("redqueenx-webhook")],
  ssh: sshHealth(),
  fail2ban: fail2banHealth(),
  caddy: caddyScanHealth(),
  webhook: webhookHealth(),
  docker: dockerComposeHealth(),
  firewall: firewallHealth()
};

report.history = securityHistory(report);

writeJsonFile(outputPath, report);
console.log(outputPath);
