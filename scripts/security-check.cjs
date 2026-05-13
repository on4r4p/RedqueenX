#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const MAX_SCAN_BYTES = 1_000_000;

const allowedVpnFiles = new Set(["ops/vpn/README.md", "ops/vpn/custom.conf.example"]);

const pathRules = [
  {
    label: "local .env files must not be tracked",
    test: (file) => /^\.env(?:$|\.)/.test(file) && file !== ".env.example"
  },
  {
    label: "SQLite databases must not be tracked",
    test: (file) => /(^|\/)(redqueenx\.)?[^/]*\.(sqlite|db)(?:-|$)/.test(file) || /\.(sqlite|db)(?:-|$)/.test(file)
  },
  {
    label: "legacy oldpython material must not be tracked",
    test: (file) => file === "oldpython" || file.startsWith("oldpython/")
  },
  {
    label: "runtime data must not be tracked",
    test: (file) => file === "runtime" || file.startsWith("runtime/")
  },
  {
    label: "Playwright auth state must not be tracked",
    test: (file) => file === "playwright/.auth" || file.startsWith("playwright/.auth/")
  },
  {
    label: "OpenVPN private profiles/auth files must not be tracked",
    test: (file) => file.startsWith("ops/vpn/") && !allowedVpnFiles.has(file)
  },
  {
    label: "local netns override must not be tracked",
    test: (file) => file === "ops/netns/env.local"
  }
];

const secretRules = [
  {
    label: "private key block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
  },
  {
    label: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b|github_pat_[A-Za-z0-9_]{20,}/
  },
  {
    label: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/
  },
  {
    label: "OpenAI API key",
    pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/
  },
  {
    label: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/
  }
];

function main() {
  const failures = [];
  const files = listCandidateFiles();

  for (const file of files) {
    for (const rule of pathRules) {
      if (rule.test(file)) {
        failures.push(`${file}: ${rule.label}`);
      }
    }
  }

  for (const file of files) {
    scanFileForSecrets(file, failures);
  }

  if (failures.length > 0) {
    console.error("[security:check] FAILED");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(`[security:check] OK - inspected ${files.length} publishable file(s).`);
}

function listCandidateFiles() {
  if (isGitRepository()) {
    const output = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, encoding: "buffer" }
    );
    return output
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
  }

  console.warn("[security:check] Warning: not a git repository; scanning source-like files with built-in excludes.");
  return walk(ROOT)
    .map((file) => normalize(path.relative(ROOT, file)))
    .filter((file) => file && shouldIncludeWithoutGit(file))
    .sort();
}

function isGitRepository() {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relative = normalize(path.relative(ROOT, fullPath));
    if (shouldPrune(relative)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function shouldPrune(relative) {
  return (
    relative === ".git" ||
    relative.startsWith(".git/") ||
    relative === "node_modules" ||
    relative.startsWith("node_modules/") ||
    relative === "dist" ||
    relative.startsWith("dist/") ||
    relative === "coverage" ||
    relative.startsWith("coverage/") ||
    relative === "runtime" ||
    relative.startsWith("runtime/") ||
    relative === "oldpython" ||
    relative.startsWith("oldpython/") ||
    relative === "playwright/.auth" ||
    relative.startsWith("playwright/.auth/")
  );
}

function shouldIncludeWithoutGit(file) {
  if (file === ".env.example") {
    return true;
  }
  if (file.startsWith("ops/vpn/")) {
    return allowedVpnFiles.has(file);
  }
  if (file.startsWith("ops/netns/")) {
    return file !== "ops/netns/env.local";
  }
  return /\.(?:cjs|mjs|js|ts|tsx|json|md|html|css|yml|yaml|example|sh)$/.test(file);
}

function scanFileForSecrets(file, failures) {
  const absolutePath = path.join(ROOT, file);
  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    return;
  }
  if (!stats.isFile() || stats.size > MAX_SCAN_BYTES) {
    return;
  }

  const content = fs.readFileSync(absolutePath);
  if (content.includes(0)) {
    return;
  }
  const text = content.toString("utf8");

  for (const rule of secretRules) {
    if (rule.pattern.test(text)) {
      failures.push(`${file}: possible ${rule.label}`);
    }
  }

  if (isExampleEnvLike(file)) {
    scanExampleEnv(file, text, failures);
  }
}

function isExampleEnvLike(file) {
  return file === ".env.example" || file.endsWith(".env.example") || file.endsWith("/env.example");
}

function scanExampleEnv(file, text, failures) {
  const allowedValues = new Set([
    "",
    "0",
    "false",
    "true",
    "auto",
    "udp",
    "tcp",
    "smooth1",
    "change-me",
    "change-me-to-a-long-random-string"
  ]);
  const safePrefixes = ["./", "/", "http://", "https://"];
  const nonSensitiveKeys = new Set(["ADMIN_AUTH_MODE"]);
  const sensitiveKeyPattern = /(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE|BEARER|CLIENT_ID|CLIENT_SECRET|ACCESS_TOKEN)/i;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (/KEYWORDS?|KEY_DELAY/i.test(key)) {
      continue;
    }
    if (nonSensitiveKeys.has(key)) {
      continue;
    }
    if (!sensitiveKeyPattern.test(key)) {
      continue;
    }
    if (allowedValues.has(value) || safePrefixes.some((prefix) => value.startsWith(prefix))) {
      continue;
    }
    if (/^(your-|example-|placeholder|optional|changeme)/i.test(value)) {
      continue;
    }
    failures.push(`${file}: ${key} should be an empty or obvious placeholder value`);
  }
}

function normalize(file) {
  return file.split(path.sep).join("/");
}

main();
