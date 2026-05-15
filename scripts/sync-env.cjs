#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const options = parseArgs(args);
const root = process.cwd();
const envPath = path.resolve(root, options.envPath);
const examplePath = path.resolve(root, options.examplePath);

main();

function main() {
  if (!fs.existsSync(examplePath)) {
    fail(`Example env file not found: ${examplePath}`);
  }

  if (!fs.existsSync(envPath)) {
    if (options.dryRun) {
      console.log(`[env:sync] Would create ${relative(envPath)} from ${relative(examplePath)}.`);
      return;
    }
    fs.copyFileSync(examplePath, envPath);
    console.log(`[env:sync] Created ${relative(envPath)} from ${relative(examplePath)}.`);
    return;
  }

  const exampleText = fs.readFileSync(examplePath, "utf8");
  const envText = fs.readFileSync(envPath, "utf8");
  const existingKeys = new Set(readAssignedKeys(envText));
  const missingKeys = readAssignedKeys(exampleText).filter((key) => !existingKeys.has(key));

  if (missingKeys.length === 0) {
    console.log(`[env:sync] ${relative(envPath)} already contains every key from ${relative(examplePath)}.`);
    return;
  }

  const missingSet = new Set(missingKeys);
  const appendText = buildAppendText(exampleText, missingSet);
  if (!appendText.trim()) {
    console.log("[env:sync] No appendable missing key lines found.");
    return;
  }

  if (options.dryRun) {
    console.log(`[env:sync] Would add ${missingKeys.length} missing key(s) to ${relative(envPath)}:`);
    for (const key of missingKeys) {
      console.log(`  - ${key}`);
    }
    return;
  }

  const prefix = envText.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(envPath, `${envText}${prefix}${appendText}`, "utf8");
  console.log(`[env:sync] Added ${missingKeys.length} missing key(s) to ${relative(envPath)}:`);
  for (const key of missingKeys) {
    console.log(`  - ${key}`);
  }
}

function parseArgs(input) {
  const options = {
    envPath: ".env",
    examplePath: ".env.example",
    dryRun: false
  };

  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--env") {
      options.envPath = requireValue(input, ++index, "--env");
      continue;
    }
    if (arg === "--example") {
      options.examplePath = requireValue(input, ++index, "--example");
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/sync-env.cjs [--dry-run] [--env .env] [--example .env.example]");
      process.exit(0);
    }
    fail(`Unknown option: ${arg}`);
  }

  return options;
}

function requireValue(input, index, flag) {
  const value = input[index];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a path value.`);
  }
  return value;
}

function readAssignedKeys(text) {
  const keys = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const key = readAssignmentKey(line);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function buildAppendText(exampleText, missingKeys) {
  const output = [
    "",
    "# =============================================================================",
    "# Added from .env.example by npm run env:sync",
    "# Existing values above were kept unchanged.",
    "# ============================================================================="
  ];
  let pendingContext = [];
  let previousOutputWasBlank = false;

  for (const line of exampleText.split(/\r?\n/)) {
    const key = readAssignmentKey(line);
    if (!key) {
      if (line.trim() === "" || line.trimStart().startsWith("#")) {
        pendingContext.push(line);
      }
      continue;
    }

    if (!missingKeys.has(key)) {
      pendingContext = [];
      continue;
    }

    for (const contextLine of trimContext(pendingContext)) {
      const isBlank = contextLine.trim() === "";
      if (isBlank && previousOutputWasBlank) {
        continue;
      }
      output.push(contextLine);
      previousOutputWasBlank = isBlank;
    }
    output.push(line);
    previousOutputWasBlank = false;
    pendingContext = [];
  }

  return `${output.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function trimContext(lines) {
  const copy = [...lines];
  while (copy.length > 0 && copy[0].trim() === "") {
    copy.shift();
  }
  while (copy.length > 0 && copy[copy.length - 1].trim() === "") {
    copy.pop();
  }
  return copy.length > 0 ? ["", ...copy] : [];
}

function readAssignmentKey(line) {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1] ?? null;
}

function relative(filePath) {
  const rel = path.relative(root, filePath);
  return rel && !rel.startsWith("..") ? rel : filePath;
}

function fail(message) {
  console.error(`[env:sync] ${message}`);
  process.exit(64);
}
