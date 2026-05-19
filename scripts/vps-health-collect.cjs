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
    return { available: false, window: since, failedAttempts: 0, acceptedLogins: 0, topIps: [], loginIps: [], error: result.error };
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
    error: result.stderr ? firstLine(result.stderr) : undefined
  };
}

function fail2banHealth() {
  const summary = safeExec("fail2ban-client", ["status"], { timeout: 5000 });
  const sshd = safeExec("fail2ban-client", ["status", "sshd"], { timeout: 5000 });
  if (!summary.available && !sshd.available) {
    return {
      available: false,
      jails: [],
      sshd: { currentlyBanned: 0, totalBanned: 0, bannedIps: [] },
      error: summary.error || sshd.error
    };
  }
  const sshdText = sshd.stdout || "";
  return {
    available: true,
    jails: parseFail2banJails(summary.stdout),
    sshd: {
      currentlyBanned: parseNumberAfterLabel(sshdText, "Currently banned"),
      totalBanned: parseNumberAfterLabel(sshdText, "Total banned"),
      bannedIps: parseFail2banBannedIps(sshdText)
    },
    error: !sshd.available ? sshd.error : undefined
  };
}

function caddyScanHealth() {
  const result = journal(["caddy"]);
  if (!result.available) {
    return { available: false, window: since, suspiciousRequests: 0, topIps: [], error: result.error };
  }
  const suspiciousPattern =
    /\.env|wp-login\.php|xmlrpc\.php|phpmyadmin|phpMyAdmin|cgi-bin|boaform|HNAP1|vendor\/phpunit|actuator|server-status|\.git|\.aws|config\.json/i;
  const suspiciousLines = result.stdout.split(/\r?\n/).filter((line) => suspiciousPattern.test(line));
  return {
    available: true,
    window: since,
    suspiciousRequests: suspiciousLines.length,
    topIps: topIpCounts(suspiciousLines.join("\n"))
  };
}

function webhookHealth() {
  const result = journal(["redqueenx-webhook"]);
  if (!result.available) {
    return { available: false, window: since, posts: 0, invalidSignatures: 0, errors: 0, topIps: [], error: result.error };
  }
  return {
    available: true,
    window: since,
    posts: countMatches(result.stdout, /incoming HTTP POST|POST \/hooks/gi),
    invalidSignatures: countMatches(result.stdout, /invalid payload signatures/gi),
    errors: countMatches(result.stdout, /error evaluating hook|error occurred|error in exec/gi),
    topIps: topIpCounts(result.stdout)
  };
}

function dockerComposeHealth() {
  const result = safeExec("docker", ["compose", "-f", composeFile, "ps"], { timeout: 6000, maxBuffer: 500000 });
  if (!result.available) {
    return { available: false, services: [], error: result.error };
  }
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
  return { available: true, services };
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
  docker: dockerComposeHealth()
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(outputPath);
