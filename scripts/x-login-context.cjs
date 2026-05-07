#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const commandText = process.argv.slice(2).join(" ");
const activeVpnProfile = process.env.VPN_CONFIG || readEnvValue("VPN_CONFIG") || "./ops/vpn/custom.conf";
const databasePath = path.resolve(readEnvValue("DATABASE_URL") || process.env.DATABASE_URL || "./redqueenx.sqlite");

if (!/x:login|x-login/.test(commandText)) {
  process.exit(0);
}

try {
  const Database = require("better-sqlite3");
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    printContext(database);
  } finally {
    database.close();
  }
} catch (error) {
  console.error("");
  console.error("X login selection");
  console.error(`  Active OpenVPN profile: ${activeVpnProfile}`);
  console.error(`  X account: unable to read SQLite context (${firstLine(error.message || String(error))})`);
}

function printContext(database) {
  const requestedAccountId = parseAccountId(commandText);
  const requestedVpnProfile = parseOptionValue(commandText, "vpn-profile");
  const account = requestedAccountId
    ? findAccountById(database, requestedAccountId)
    : requestedVpnProfile
      ? findAccountByVpnProfile(database, requestedVpnProfile)
      : null;

  console.error("");
  console.error("X login selection");
  console.error(`  Active OpenVPN profile: ${activeVpnProfile}`);

  if (requestedAccountId && !account) {
    console.error(`  Requested X account: id ${requestedAccountId} not found`);
    return;
  }

  if (requestedVpnProfile && !account) {
    console.error(`  Requested X account: no account linked to ${requestedVpnProfile}`);
    return;
  }

  if (!account) {
    console.error("  Requested X account: not specified");
    return;
  }

  const linkedProfiles = linkedProfilesForAccount(database, account);
  const activeLinked = linkedProfiles.some((profilePath) => profilePathKey(profilePath) === profilePathKey(activeVpnProfile));

  console.error(`  Requested X account: ${account.x_identifier} (id ${account.id})`);
  console.error(`  Primary account .ovpn: ${account.vpn_profile_path}`);
  console.error(`  Linked .ovpn profiles: ${linkedProfiles.length}`);
  console.error(`  Active profile linked: ${activeLinked ? "yes" : "no"}`);
}

function findAccountById(database, id) {
  return database.prepare("SELECT * FROM x_browser_accounts WHERE id = ?").get(id);
}

function findAccountByVpnProfile(database, vpnProfilePath) {
  const normalized = normalizeProjectPath(vpnProfilePath);
  return (
    database
      .prepare(
        `
          SELECT account.*
          FROM x_browser_account_profiles AS profile
          JOIN x_browser_accounts AS account ON account.id = profile.account_id
          WHERE profile.vpn_profile_path = ?
        `
      )
      .get(normalized) ||
    database.prepare("SELECT * FROM x_browser_accounts WHERE vpn_profile_path = ?").get(normalized)
  );
}

function linkedProfilesForAccount(database, account) {
  const rows = database
    .prepare(
      `
        SELECT vpn_profile_path
        FROM x_browser_account_profiles
        WHERE account_id = ?
        ORDER BY id ASC
      `
    )
    .all(account.id);
  const profiles = rows.map((row) => row.vpn_profile_path);
  if (!profiles.includes(account.vpn_profile_path)) {
    profiles.unshift(account.vpn_profile_path);
  }
  return Array.from(new Set(profiles));
}

function parseAccountId(value) {
  const match = value.match(/--account-id(?:=|\s+)(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseOptionValue(value, optionName) {
  const escaped = optionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`--${escaped}(?:=|\\s+)([^\\s]+)`));
  return match?.[1] || "";
}

function normalizeProjectPath(value) {
  const resolved = path.resolve(process.cwd(), value.trim());
  const relative = path.relative(process.cwd(), resolved).split(path.sep).join("/");
  return relative.startsWith("..") || path.isAbsolute(relative) ? value : `./${relative}`;
}

function profilePathKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function readEnvValue(key) {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return "";
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const name = trimmed.slice(0, equals).trim();
    if (name !== key) continue;
    return unquote(trimmed.slice(equals + 1).trim());
  }
  return "";
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function firstLine(value) {
  return String(value).split(/\r?\n/).find(Boolean) || String(value);
}
