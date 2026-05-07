import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database";

describe("fresh database boot", () => {
  it("creates an empty SQLite database when DATABASE_URL does not exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-fresh-db-"));
    const databasePath = path.join(tmp, "redqueenx.sqlite");

    expect(fs.existsSync(databasePath)).toBe(false);

    const database = openDatabase(databasePath);
    try {
      expect(fs.existsSync(databasePath)).toBe(true);

      const tableNames = new Set(
        (
          database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as Array<{ name: string }>
        ).map((row) => row.name)
      );

      expect(tableNames).toContain("list_entries");
      expect(tableNames).toContain("runs");
      expect(tableNames).toContain("timeline_tweets");
      expect(tableNames).toContain("raw_timeline_tweets");
      expect(tableNames).toContain("x_session_alerts");

      for (const table of ["list_entries", "runs", "timeline_tweets", "raw_timeline_tweets", "x_session_alerts"]) {
        const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        expect(row.count).toBe(0);
      }
    } finally {
      database.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
