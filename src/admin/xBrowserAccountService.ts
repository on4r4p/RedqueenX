import fsSync from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";

export type XBrowserSessionStatus = "missing_session" | "valid" | "expired" | "ip_mismatch" | "needs_login";

export interface XBrowserAccountRecord {
  id: number;
  vpnProfilePath: string;
  vpnProfilePaths: string[];
  xIdentifier: string;
  storageStatePath: string;
  browserProfileDir: string;
  sessionStatus: XBrowserSessionStatus;
  storageStateExists: boolean;
  lastLoginAt: string | null;
  lastLoginPublicIpv4: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type XBrowserAccountRow = {
  id: number;
  vpn_profile_path: string;
  x_identifier: string;
  storage_state_path: string;
  browser_profile_dir: string;
  session_status: XBrowserSessionStatus;
  last_login_at: string | null;
  last_login_public_ipv4: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

interface UpsertInput {
  accountId?: number;
  vpnProfilePath?: string;
  vpnProfilePaths?: string[];
  xIdentifier: string;
  replaceProfiles?: boolean;
}

export class XBrowserAccountService {
  constructor(private readonly database: Database) {}

  list(): XBrowserAccountRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM x_browser_accounts
          ORDER BY updated_at DESC, id DESC
        `
      )
      .all() as XBrowserAccountRow[];
    return rows.map((row) => this.toRecord(row));
  }

  findById(id: number): XBrowserAccountRecord | null {
    const row = this.database.prepare("SELECT * FROM x_browser_accounts WHERE id = ?").get(id) as
      | XBrowserAccountRow
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  findByVpnProfilePath(vpnProfilePath: string): XBrowserAccountRecord | null {
    const normalizedProfilePath = normalizeProjectPath(vpnProfilePath);
    const linkedRow = this.database
      .prepare(
        `
          SELECT account.*
          FROM x_browser_account_profiles AS profile
          JOIN x_browser_accounts AS account ON account.id = profile.account_id
          WHERE profile.vpn_profile_path = ?
        `
      )
      .get(normalizedProfilePath) as XBrowserAccountRow | undefined;
    if (linkedRow) {
      return this.toRecord(linkedRow);
    }

    const row = this.database.prepare("SELECT * FROM x_browser_accounts WHERE vpn_profile_path = ?").get(normalizedProfilePath) as
      | XBrowserAccountRow
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  upsert(input: UpsertInput): XBrowserAccountRecord {
    const vpnProfilePaths = normalizeProfilePathList(input);
    if (vpnProfilePaths.length === 0) {
      throw new Error("X browser account must be linked to at least one .ovpn profile.");
    }
    for (const vpnProfilePath of vpnProfilePaths) {
      if (!isOpenVpnProfilePath(vpnProfilePath)) {
        throw new Error("X browser account profiles must be .ovpn files.");
      }
    }
    const vpnProfilePath = vpnProfilePaths[0];

    const xIdentifier = normalizeIdentifier(input.xIdentifier);
    const existing =
      (input.accountId ? this.findById(input.accountId) : null) ??
      this.findByVpnProfilePath(vpnProfilePath) ??
      this.findByIdentifier(xIdentifier);
    const storageStatePath = existing?.storageStatePath ?? defaultStorageStatePath(vpnProfilePath, xIdentifier);
    const browserProfileDir = existing?.browserProfileDir ?? defaultBrowserProfileDir(vpnProfilePath, xIdentifier);
    ensureParentDirectory(storageStatePath);
    fsSync.mkdirSync(path.resolve(process.cwd(), browserProfileDir), { recursive: true });

    const now = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      let accountId: number;
      if (existing) {
      this.database
        .prepare(
          `
            UPDATE x_browser_accounts
            SET x_identifier = ?,
                storage_state_path = ?,
                browser_profile_dir = ?,
                session_status = CASE WHEN ? = 1 THEN session_status ELSE 'missing_session' END,
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(xIdentifier, storageStatePath, browserProfileDir, fsSync.existsSync(path.resolve(storageStatePath)) ? 1 : 0, now, existing.id);
        accountId = existing.id;
      } else {
        const insert = this.database
          .prepare(
            `
              INSERT INTO x_browser_accounts (
                vpn_profile_path,
                x_identifier,
                storage_state_path,
                browser_profile_dir,
                session_status,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            vpnProfilePath,
            xIdentifier,
            storageStatePath,
            browserProfileDir,
            fsSync.existsSync(path.resolve(storageStatePath)) ? "valid" : "missing_session",
            now,
            now
          );
        accountId = Number(insert.lastInsertRowid);
      }

      this.linkProfiles(accountId, vpnProfilePaths, Boolean(input.replaceProfiles));
      return accountId;
    });

    return this.required(transaction());
  }

  delete(id: number): { id: number; deleted: boolean } {
    const result = this.database.prepare("DELETE FROM x_browser_accounts WHERE id = ?").run(id);
    return {
      id,
      deleted: result.changes > 0
    };
  }

  markLogin(id: number, publicIpv4: string | null): XBrowserAccountRecord {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE x_browser_accounts
          SET session_status = 'valid',
              last_login_at = ?,
              last_login_public_ipv4 = ?,
              last_checked_at = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(now, publicIpv4, now, now, id);
    return this.required(id);
  }

  markStatus(id: number, status: XBrowserSessionStatus): XBrowserAccountRecord {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          UPDATE x_browser_accounts
          SET session_status = ?,
              last_checked_at = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(status, now, now, id);
    return this.required(id);
  }

  private required(id: number): XBrowserAccountRecord {
    const account = this.findById(id);
    if (!account) {
      throw new Error(`Unknown X browser account: ${id}`);
    }
    return account;
  }

  private toRecord(row: XBrowserAccountRow): XBrowserAccountRecord {
    return {
      id: row.id,
      vpnProfilePath: row.vpn_profile_path,
      vpnProfilePaths: this.profilePathsForAccount(row.id, row.vpn_profile_path),
      xIdentifier: row.x_identifier,
      storageStatePath: row.storage_state_path,
      browserProfileDir: row.browser_profile_dir,
      sessionStatus: row.session_status,
      storageStateExists: fsSync.existsSync(path.resolve(process.cwd(), row.storage_state_path)),
      lastLoginAt: row.last_login_at,
      lastLoginPublicIpv4: row.last_login_public_ipv4,
      lastCheckedAt: row.last_checked_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private findByIdentifier(xIdentifier: string): XBrowserAccountRecord | null {
    const row = this.database.prepare("SELECT * FROM x_browser_accounts WHERE x_identifier = ? ORDER BY updated_at DESC, id DESC").get(xIdentifier) as
      | XBrowserAccountRow
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  private profilePathsForAccount(accountId: number, fallbackProfilePath: string): string[] {
    const rows = this.database
      .prepare(
        `
          SELECT vpn_profile_path
          FROM x_browser_account_profiles
          WHERE account_id = ?
          ORDER BY id ASC
        `
      )
      .all(accountId) as Array<{ vpn_profile_path: string }>;
    const paths = rows.map((row) => row.vpn_profile_path);
    if (!paths.includes(fallbackProfilePath)) {
      paths.unshift(fallbackProfilePath);
    }
    return Array.from(new Set(paths));
  }

  private linkProfiles(accountId: number, vpnProfilePaths: string[], replaceProfiles: boolean): void {
    if (replaceProfiles) {
      this.database.prepare("DELETE FROM x_browser_account_profiles WHERE account_id = ?").run(accountId);
    }

    const deleteProfileLink = this.database.prepare("DELETE FROM x_browser_account_profiles WHERE vpn_profile_path = ?");
    const insertProfileLink = this.database.prepare(
      `
        INSERT INTO x_browser_account_profiles (account_id, vpn_profile_path, created_at)
        VALUES (?, ?, ?)
      `
    );
    const now = new Date().toISOString();
    for (const vpnProfilePath of vpnProfilePaths) {
      deleteProfileLink.run(vpnProfilePath);
      insertProfileLink.run(accountId, vpnProfilePath, now);
    }
  }
}

function normalizeProfilePathList(input: UpsertInput): string[] {
  const values = [...(input.vpnProfilePath ? [input.vpnProfilePath] : []), ...(input.vpnProfilePaths ?? [])];
  return Array.from(new Set(values.map((value) => normalizeProjectPath(value)).filter(Boolean)));
}

function normalizeIdentifier(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("X account identifier is required.");
  }
  if (normalized.length > 120) {
    throw new Error("X account identifier is too long.");
  }
  return normalized;
}

function normalizeProjectPath(value: string): string {
  const resolved = path.resolve(process.cwd(), value.trim());
  const relative = path.relative(process.cwd(), resolved).split(path.sep).join("/");
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path must stay inside the RedqueenX project.");
  }
  return `./${relative}`;
}

function isOpenVpnProfilePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".ovpn";
}

function defaultStorageStatePath(vpnProfilePath: string, xIdentifier: string): string {
  return `./runtime/x-auth/${safeProfileName(vpnProfilePath)}/${safeSegment(xIdentifier)}.json`;
}

function defaultBrowserProfileDir(vpnProfilePath: string, xIdentifier: string): string {
  return `./runtime/x-browser/${safeProfileName(vpnProfilePath)}/${safeSegment(xIdentifier)}`;
}

function safeProfileName(vpnProfilePath: string): string {
  return safeSegment(path.basename(vpnProfilePath, path.extname(vpnProfilePath)));
}

function safeSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "x-account";
}

function ensureParentDirectory(filePath: string): void {
  fsSync.mkdirSync(path.dirname(path.resolve(process.cwd(), filePath)), { recursive: true });
}
