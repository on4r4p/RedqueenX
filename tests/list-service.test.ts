import DatabaseConstructor from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ListService } from "../src/admin/listService";
import { openMemoryDatabase } from "../src/db/database";
import { migrate } from "../src/db/schema";

describe("ListService", () => {
  it("reuses active entries for normalized value duplicates", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);

    const first = lists.add("keyword", "Alpha");
    const duplicate = lists.add("keyword", " alpha ");

    expect(duplicate.id).toBe(first.id);
    expect(lists.activeValues("keyword")).toEqual(["Alpha"]);
    expect(lists.countActiveByKind().keyword).toBe(1);
  });

  it("reuses active handle entries across @handle variants", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);

    const first = lists.add("following", "@Alice");
    const duplicate = lists.add("following", "alice");

    expect(duplicate.id).toBe(first.id);
    expect(lists.activeValues("following")).toEqual(["@Alice"]);
  });

  it("deduplicates skipped keyword users by handle while keeping the recorded reason", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);

    const first = lists.add("skipped_keyword_user", "@Alice", "reason:no_visible_tweet_for_user");
    const duplicate = lists.add("skipped_keyword_user", "alice", "reason:latest_tweet_has_no_date");

    expect(duplicate.id).toBe(first.id);
    expect(lists.list("skipped_keyword_user")).toMatchObject([
      {
        rawValue: "@Alice",
        handleNormalized: "alice",
        sourceFile: "reason:no_visible_tweet_for_user"
      }
    ]);
  });

  it("merges updates into an existing active entry instead of creating a duplicate", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const keeper = lists.add("keyword", "alpha");
    const edited = lists.add("keyword", "beta");

    const merged = lists.update(edited.id, "keyword", " ALPHA ");

    expect(merged.id).toBe(keeper.id);
    expect(lists.activeValues("keyword")).toEqual(["alpha"]);
    expect(lists.list("keyword", true).find((entry) => entry.id === edited.id)?.isDeleted).toBe(true);
  });

  it("cleans known cross-list inconsistencies", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);

    lists.add("keyword", "");
    lists.add("keyword", "RemoveMe");
    lists.add("banned_word", " removeme ");
    lists.add("keyword", "@bad");
    lists.add("following", "bad");
    lists.add("friend", "@bad");
    lists.add("stale_keyword_user", "@bad");
    lists.add("skipped_keyword_user", "@bad", "reason:no_visible_tweet_for_user");
    lists.add("banned_user", "@bad");
    lists.add("keyword", "@active");
    lists.add("stale_keyword_user", "active");
    lists.add("skipped_keyword_user", "@active", "reason:latest_tweet_has_no_date");
    lists.add("stale_keyword_user", "@old");
    lists.add("skipped_keyword_user", "old", "reason:latest_tweet_has_no_date");

    const result = lists.cleanupActiveInconsistencies();

    expect(result).toMatchObject({
      emptyDeleted: 1,
      keywordBannedWordsDeleted: 1,
      keywordBannedUsersDeleted: 1,
      followingBannedUsersDeleted: 1,
      friendBannedUsersDeleted: 1,
      staleBannedUsersDeleted: 1,
      skippedBannedUsersDeleted: 1,
      staleActiveKeywordsDeleted: 1,
      skippedActiveKeywordsDeleted: 1,
      skippedStaleUsersDeleted: 1,
      totalDeleted: 10
    });
    expect(lists.activeValues("keyword")).toEqual(["@active"]);
    expect(lists.activeValues("following")).toEqual([]);
    expect(lists.activeValues("friend")).toEqual([]);
    expect(lists.activeValues("stale_keyword_user")).toEqual(["@old"]);
    expect(lists.activeValues("skipped_keyword_user")).toEqual([]);
  });

  it("deduplicates legacy active rows during migration and enforces unique active indexes", () => {
    const database = new DatabaseConstructor(":memory:");
    database.exec(`
      CREATE TABLE list_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        raw_value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        handle_normalized TEXT,
        source_file TEXT,
        line_number INTEGER,
        is_empty INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        imported_at TEXT
      );

      INSERT INTO list_entries (kind, raw_value, normalized_value, source_file)
      VALUES
        ('keyword', 'alpha', 'alpha', NULL),
        ('keyword', ' alpha ', 'alpha', '/legacy/Rq.Keywords');

      INSERT INTO list_entries (kind, raw_value, normalized_value, handle_normalized, source_file)
      VALUES
        ('following', '@Alice', '@alice', 'alice', 'uploaded:Rq.User'),
        ('following', 'alice', 'alice', 'alice', '/legacy/Rq.User');

      INSERT INTO list_entries (kind, raw_value, normalized_value, is_deleted)
      VALUES ('keyword', 'ALPHA', 'alpha', 1);
    `);

    migrate(database);

    const activeRows = database
      .prepare("SELECT kind, raw_value FROM list_entries WHERE is_deleted = 0 ORDER BY kind ASC, id ASC")
      .all() as Array<{ kind: string; raw_value: string }>;
    expect(activeRows).toEqual([
      { kind: "following", raw_value: "alice" },
      { kind: "keyword", raw_value: "alpha" }
    ]);

    expect(() => {
      database
        .prepare(
          `
            INSERT INTO list_entries (kind, raw_value, normalized_value)
            VALUES ('keyword', ' alpha ', 'alpha')
          `
        )
        .run();
    }).toThrow();
  });
});
