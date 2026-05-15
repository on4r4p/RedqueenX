import type { Database } from "better-sqlite3";

export type TimelineUserRecord = {
  id: number;
  username: string;
  usernameNormalized: string;
  sessionVersion: number;
  createdAt: string;
  updatedAt: string;
};

type TimelineUserRow = {
  id: number;
  username: string;
  username_normalized: string;
  password_hash: string;
  session_version: number;
  created_at: string;
  updated_at: string;
};

export class TimelineUserService {
  constructor(private readonly database: Database) {}

  list(): TimelineUserRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM timeline_users
        ORDER BY username_normalized ASC
      `
      )
      .all() as TimelineUserRow[];
    return rows.map(mapPublicRow);
  }

  findByUsername(username: string): (TimelineUserRecord & { passwordHash: string }) | null {
    const usernameNormalized = normalizeTimelineUsername(username);
    if (!usernameNormalized) {
      return null;
    }
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM timeline_users
        WHERE username_normalized = ?
        LIMIT 1
      `
      )
      .get(usernameNormalized) as TimelineUserRow | undefined;
    return row ? mapPrivateRow(row) : null;
  }

  findById(id: number): (TimelineUserRecord & { passwordHash: string }) | null {
    const row = this.database.prepare("SELECT * FROM timeline_users WHERE id = ? LIMIT 1").get(id) as TimelineUserRow | undefined;
    return row ? mapPrivateRow(row) : null;
  }

  create(input: { username: string; passwordHash: string }): TimelineUserRecord {
    const username = cleanTimelineUsername(input.username);
    const usernameNormalized = normalizeTimelineUsername(username);
    if (!username || !usernameNormalized) {
      throw new Error("Timeline username is required.");
    }
    const row = this.database
      .prepare(
        `
        INSERT INTO timeline_users (username, username_normalized, password_hash)
        VALUES (@username, @usernameNormalized, @passwordHash)
        RETURNING *
      `
      )
      .get({ username, usernameNormalized, passwordHash: input.passwordHash }) as TimelineUserRow;
    return mapPublicRow(row);
  }

  update(id: number, input: { username: string; passwordHash?: string }): TimelineUserRecord {
    const username = cleanTimelineUsername(input.username);
    const usernameNormalized = normalizeTimelineUsername(username);
    if (!username || !usernameNormalized) {
      throw new Error("Timeline username is required.");
    }
    const row = this.database
      .prepare(
        `
        UPDATE timeline_users
        SET username = @username,
            username_normalized = @usernameNormalized,
            password_hash = COALESCE(@passwordHash, password_hash),
            session_version = session_version + 1,
            updated_at = datetime('now')
        WHERE id = @id
        RETURNING *
      `
      )
      .get({ id, username, usernameNormalized, passwordHash: input.passwordHash ?? null }) as TimelineUserRow | undefined;
    if (!row) {
      throw new Error(`Timeline user not found: ${id}`);
    }
    return mapPublicRow(row);
  }

  delete(id: number): number {
    const result = this.database.prepare("DELETE FROM timeline_users WHERE id = ?").run(id);
    return Number(result.changes || 0);
  }
}

export function cleanTimelineUsername(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function normalizeTimelineUsername(value: string): string {
  return cleanTimelineUsername(value).toLowerCase();
}

function mapPublicRow(row: TimelineUserRow): TimelineUserRecord {
  return {
    id: row.id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    sessionVersion: row.session_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPrivateRow(row: TimelineUserRow): TimelineUserRecord & { passwordHash: string } {
  return {
    ...mapPublicRow(row),
    passwordHash: row.password_hash
  };
}
