import type { Database } from "better-sqlite3";
import { LIST_KINDS, type ListEntry, type ListKind } from "../types";
import { isHandleSearchKeyword, normalizeHandle, normalizeValue } from "../text";

type ListEntryRow = {
  id: number;
  kind: ListKind;
  raw_value: string;
  normalized_value: string;
  handle_normalized: string | null;
  source_file: string | null;
  line_number: number | null;
  is_empty: number;
  is_deleted: number;
  created_at: string;
  imported_at: string | null;
};

type DeduplicateRow = {
  id: number;
  kind: ListKind;
  normalized_value: string;
  handle_normalized: string | null;
  source_file: string | null;
};

export interface ListConsistencyCleanupResult {
  duplicatesDeleted: number;
  emptyDeleted: number;
  keywordBannedWordsDeleted: number;
  keywordBannedUsersDeleted: number;
  followingBannedUsersDeleted: number;
  friendBannedUsersDeleted: number;
  staleBannedUsersDeleted: number;
  skippedBannedUsersDeleted: number;
  staleActiveKeywordsDeleted: number;
  skippedActiveKeywordsDeleted: number;
  skippedStaleUsersDeleted: number;
  totalDeleted: number;
}

export function isListKind(value: string): value is ListKind {
  return (LIST_KINDS as readonly string[]).includes(value);
}

export class ListService {
  constructor(private readonly database: Database) {}

  add(kind: ListKind, rawValue: string, sourceFile?: string | null, lineNumber?: number | null, importedAt?: string | null): ListEntry {
    const duplicate = this.findDuplicate(kind, rawValue);
    if (duplicate) {
      return mapRow(duplicate);
    }

    const insert = this.database.prepare(`
      INSERT INTO list_entries (
        kind,
        raw_value,
        normalized_value,
        handle_normalized,
        source_file,
        line_number,
        is_empty,
        imported_at
      )
      VALUES (@kind, @rawValue, @normalizedValue, @handleNormalized, @sourceFile, @lineNumber, @isEmpty, @importedAt)
      RETURNING *
    `);

    const row = insert.get({
      kind,
      rawValue,
      normalizedValue: normalizeValue(rawValue),
      handleNormalized: handleKinds.has(kind) ? normalizeHandle(rawValue) : null,
      sourceFile: sourceFile ?? null,
      lineNumber: lineNumber ?? null,
      isEmpty: rawValue.length === 0 ? 1 : 0,
      importedAt: importedAt ?? null
    }) as ListEntryRow;

    return mapRow(row);
  }

  update(id: number, kind: ListKind, rawValue: string): ListEntry {
    const duplicate = this.findDuplicate(kind, rawValue, id);
    if (duplicate) {
      const deleted = this.markDeletedById(kind, id);
      if (deleted === 0) {
        throw new Error(`List entry not found: ${kind}#${id}`);
      }
      return mapRow(duplicate);
    }

    const row = this.database
      .prepare(`
        UPDATE list_entries
        SET raw_value = @rawValue,
            normalized_value = @normalizedValue,
            handle_normalized = @handleNormalized,
            is_empty = @isEmpty
        WHERE id = @id
          AND kind = @kind
          AND is_deleted = 0
        RETURNING *
      `)
      .get({
        id,
        kind,
        rawValue,
        normalizedValue: normalizeValue(rawValue),
        handleNormalized: handleKinds.has(kind) ? normalizeHandle(rawValue) : null,
        isEmpty: rawValue.length === 0 ? 1 : 0
      }) as ListEntryRow | undefined;

    if (!row) {
      throw new Error(`List entry not found: ${kind}#${id}`);
    }

    return mapRow(row);
  }

  getById(kind: ListKind, id: number, includeDeleted = false): ListEntry | null {
    const row = this.database
      .prepare(`
        SELECT *
        FROM list_entries
        WHERE id = ?
          AND kind = ?
          AND (? = 1 OR is_deleted = 0)
        LIMIT 1
      `)
      .get(id, kind, includeDeleted ? 1 : 0) as ListEntryRow | undefined;

    return row ? mapRow(row) : null;
  }

  list(kind: ListKind, includeDeleted = false): ListEntry[] {
    const rows = this.database
      .prepare(`
        SELECT *
        FROM list_entries
        WHERE kind = ?
          AND (? = 1 OR is_deleted = 0)
        ORDER BY id ASC
      `)
      .all(kind, includeDeleted ? 1 : 0) as ListEntryRow[];

    return rows.map(mapRow);
  }

  listPage(
    kind: ListKind,
    options: { includeDeleted?: boolean; limit?: number; offset?: number; order?: "asc" | "desc"; search?: string } = {}
  ): { entries: ListEntry[]; total: number; limit: number; offset: number; hasMore: boolean } {
    const includeDeleted = options.includeDeleted === true;
    const limit = Math.max(1, Math.min(options.limit ?? 80, 200));
    const offset = Math.max(0, options.offset ?? 0);
    const order = options.order === "asc" ? "ASC" : "DESC";
    const search = options.search?.trim() ?? "";
    const searchParams = {
      kind,
      includeDeleted: includeDeleted ? 1 : 0,
      search,
      rawSearch: `%${escapeLike(search)}%`,
      normalizedSearch: `%${escapeLike(normalizeValue(search))}%`
    };

    const totalRow = this.database
      .prepare(`
        SELECT COUNT(*) AS total
        FROM list_entries
        WHERE kind = @kind
          AND (@includeDeleted = 1 OR is_deleted = 0)
          AND (
            @search = ''
            OR raw_value LIKE @rawSearch ESCAPE '\\'
            OR normalized_value LIKE @normalizedSearch ESCAPE '\\'
            OR handle_normalized LIKE @normalizedSearch ESCAPE '\\'
          )
      `)
      .get(searchParams) as { total: number };

    const rows = this.database
      .prepare(`
        SELECT *
        FROM list_entries
        WHERE kind = @kind
          AND (@includeDeleted = 1 OR is_deleted = 0)
          AND (
            @search = ''
            OR raw_value LIKE @rawSearch ESCAPE '\\'
            OR normalized_value LIKE @normalizedSearch ESCAPE '\\'
            OR handle_normalized LIKE @normalizedSearch ESCAPE '\\'
          )
        ORDER BY id ${order}
        LIMIT @limit
        OFFSET @offset
      `)
      .all({ ...searchParams, limit, offset }) as ListEntryRow[];

    return {
      entries: rows.map(mapRow),
      total: totalRow.total,
      limit,
      offset,
      hasMore: offset + rows.length < totalRow.total
    };
  }

  activeValues(kind: ListKind): string[] {
    const rows = this.database
      .prepare(`
        SELECT raw_value
        FROM list_entries
        WHERE kind = ?
          AND is_deleted = 0
          AND is_empty = 0
        ORDER BY id ASC
      `)
      .all(kind) as Array<{ raw_value: string }>;

    return rows.map((row) => row.raw_value);
  }

  markDeleted(kind: ListKind, rawValue: string): number {
    const normalizedValue = normalizeValue(rawValue);
    const handleNormalized = normalizeHandle(rawValue);
    const result = this.database
      .prepare(`
        UPDATE list_entries
        SET is_deleted = 1
        WHERE kind = ?
          AND is_deleted = 0
          AND (
            normalized_value = ?
            OR (? IS NOT NULL AND handle_normalized = ?)
          )
      `)
      .run(kind, normalizedValue, handleNormalized, handleNormalized);

    return result.changes;
  }

  markDeletedById(kind: ListKind, id: number): number {
    const result = this.database
      .prepare(`
        UPDATE list_entries
        SET is_deleted = 1
        WHERE id = ?
          AND kind = ?
          AND is_deleted = 0
      `)
      .run(id, kind);

    return result.changes;
  }

  markDeletedAll(kind: ListKind): number {
    const result = this.database
      .prepare(`
        UPDATE list_entries
        SET is_deleted = 1
        WHERE kind = ?
          AND is_deleted = 0
      `)
      .run(kind);

    return result.changes;
  }

  countActiveByKind(): Record<string, number> {
    const rows = this.database
      .prepare(`
        SELECT kind, COUNT(*) AS count
        FROM list_entries
        WHERE is_deleted = 0
        GROUP BY kind
      `)
      .all() as Array<{ kind: string; count: number }>;

    return Object.fromEntries(rows.map((row) => [row.kind, row.count]));
  }

  deduplicateActive(kind?: ListKind): number {
    const rows = this.database
      .prepare(`
        SELECT id, kind, normalized_value, handle_normalized, source_file
        FROM list_entries
        WHERE is_deleted = 0
          AND (@kind IS NULL OR kind = @kind)
        ORDER BY kind ASC, id ASC
      `)
      .all({ kind: kind ?? null }) as DeduplicateRow[];

    const groups = new Map<string, DeduplicateRow[]>();
    for (const row of rows) {
      const key = dedupeKey(row);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    let deleted = 0;
    const deleteById = this.database.prepare("DELETE FROM list_entries WHERE id = ?");
    const transaction = this.database.transaction(() => {
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const [keeper, ...duplicates] = [...group].sort(compareDedupeRows);
        for (const duplicate of duplicates) {
          if (duplicate.id === keeper.id) continue;
          deleteById.run(duplicate.id);
          deleted += 1;
        }
      }
    });

    transaction();
    return deleted;
  }

  cleanupActiveInconsistencies(): ListConsistencyCleanupResult {
    const result: ListConsistencyCleanupResult = {
      duplicatesDeleted: 0,
      emptyDeleted: 0,
      keywordBannedWordsDeleted: 0,
      keywordBannedUsersDeleted: 0,
      followingBannedUsersDeleted: 0,
      friendBannedUsersDeleted: 0,
      staleBannedUsersDeleted: 0,
      skippedBannedUsersDeleted: 0,
      staleActiveKeywordsDeleted: 0,
      skippedActiveKeywordsDeleted: 0,
      skippedStaleUsersDeleted: 0,
      totalDeleted: 0
    };

    for (const kind of editableListKinds) {
      result.duplicatesDeleted += this.deduplicateActive(kind);
    }

    const transaction = this.database.transaction(() => {
      const deleteEmpty = this.database.prepare(`
        UPDATE list_entries
        SET is_deleted = 1
        WHERE kind = ?
          AND is_deleted = 0
          AND is_empty = 1
      `);
      for (const kind of editableListKinds) {
        result.emptyDeleted += deleteEmpty.run(kind).changes;
      }

      const deleteKeywordByNormalized = this.database.prepare(`
        UPDATE list_entries
        SET is_deleted = 1
        WHERE kind = 'keyword'
          AND is_deleted = 0
          AND normalized_value = ?
      `);
      const bannedWords = this.activeListRows("banned_word");
      for (const bannedWord of bannedWords) {
        result.keywordBannedWordsDeleted += deleteKeywordByNormalized.run(bannedWord.normalizedValue).changes;
      }

      const deleteByHandle = this.database.prepare(`
        UPDATE list_entries
        SET is_deleted = 1
        WHERE kind = ?
          AND is_deleted = 0
          AND handle_normalized = ?
      `);
      const bannedUsers = this.activeListRows("banned_user").map((entry) => entry.handleNormalized).filter(Boolean) as string[];
      for (const handle of bannedUsers) {
        result.keywordBannedUsersDeleted += deleteKeywordByNormalized.run(`@${handle}`).changes;
        result.followingBannedUsersDeleted += deleteByHandle.run("following", handle).changes;
        result.friendBannedUsersDeleted += deleteByHandle.run("friend", handle).changes;
        result.staleBannedUsersDeleted += deleteByHandle.run("stale_keyword_user", handle).changes;
        result.skippedBannedUsersDeleted += deleteByHandle.run("skipped_keyword_user", handle).changes;
      }

      const activeKeywordHandles = this.activeListRows("keyword")
        .filter((entry) => isHandleSearchKeyword(entry.rawValue))
        .map((entry) => normalizeHandle(entry.rawValue))
        .filter(Boolean) as string[];
      for (const handle of activeKeywordHandles) {
        result.staleActiveKeywordsDeleted += deleteByHandle.run("stale_keyword_user", handle).changes;
        result.skippedActiveKeywordsDeleted += deleteByHandle.run("skipped_keyword_user", handle).changes;
      }

      const activeStaleHandles = this.activeListRows("stale_keyword_user").map((entry) => entry.handleNormalized).filter(Boolean) as string[];
      for (const handle of activeStaleHandles) {
        result.skippedStaleUsersDeleted += deleteByHandle.run("skipped_keyword_user", handle).changes;
      }
    });

    transaction();
    result.totalDeleted =
      result.duplicatesDeleted +
      result.emptyDeleted +
      result.keywordBannedWordsDeleted +
      result.keywordBannedUsersDeleted +
      result.followingBannedUsersDeleted +
      result.friendBannedUsersDeleted +
      result.staleBannedUsersDeleted +
      result.skippedBannedUsersDeleted +
      result.staleActiveKeywordsDeleted +
      result.skippedActiveKeywordsDeleted +
      result.skippedStaleUsersDeleted;
    return result;
  }

  replaceImportedSource(sourceFile: string, kind: ListKind, values: string[], importedAt: string): number {
    return this.replaceImportedRecords(
      sourceFile,
      kind,
      values.map((rawValue, index) => ({ rawValue, lineNumber: index + 1 })),
      importedAt
    );
  }

  replaceImportedRecords(
    sourceFile: string,
    kind: ListKind,
    records: Array<{ rawValue: string; lineNumber: number | null }>,
    importedAt: string
  ): number {
    let insertedRecords = 0;
    const transaction = this.database.transaction(() => {
      this.database.prepare("DELETE FROM list_entries WHERE source_file = ?").run(sourceFile);
      const deleteById = this.database.prepare("DELETE FROM list_entries WHERE id = ?");
      const findDuplicates = this.database.prepare(`
        SELECT *
        FROM list_entries
        WHERE kind = @kind
          AND is_deleted = 0
          AND (
            normalized_value = @normalizedValue
            OR (@handleNormalized IS NOT NULL AND handle_normalized = @handleNormalized)
          )
        ORDER BY id ASC
      `);
      const insert = this.database.prepare(`
        INSERT INTO list_entries (
          kind,
          raw_value,
          normalized_value,
          handle_normalized,
          source_file,
          line_number,
          is_empty,
          imported_at
        )
        VALUES (@kind, @rawValue, @normalizedValue, @handleNormalized, @sourceFile, @lineNumber, @isEmpty, @importedAt)
      `);

      for (const record of records) {
        const rawValue = record.rawValue;
        const normalizedValue = normalizeValue(rawValue);
        const handleNormalized = handleKinds.has(kind) ? normalizeHandle(rawValue) : null;
        const duplicates = findDuplicates.all({
          kind,
          normalizedValue,
          handleNormalized
        }) as ListEntryRow[];
        let shouldInsert = true;

        for (const duplicate of duplicates) {
          if (sourcePriority(duplicate.source_file) < sourcePriority(sourceFile)) {
            deleteById.run(duplicate.id);
          } else {
            shouldInsert = false;
          }
        }

        if (!shouldInsert) {
          continue;
        }

        insert.run({
          kind,
          rawValue,
          normalizedValue,
          handleNormalized,
          sourceFile,
          lineNumber: record.lineNumber,
          isEmpty: rawValue.length === 0 ? 1 : 0,
          importedAt
        });
        insertedRecords += 1;
      }
    });

    transaction();
    return insertedRecords;
  }

  private findDuplicate(kind: ListKind, rawValue: string, excludeId?: number): ListEntryRow | undefined {
    const normalizedValue = normalizeValue(rawValue);
    const handleNormalized = handleKinds.has(kind) ? normalizeHandle(rawValue) : null;
    return this.database
      .prepare(`
        SELECT *
        FROM list_entries
        WHERE kind = @kind
          AND is_deleted = 0
          AND (@excludeId IS NULL OR id != @excludeId)
          AND (
            normalized_value = @normalizedValue
            OR (@handleNormalized IS NOT NULL AND handle_normalized = @handleNormalized)
          )
        ORDER BY id ASC
        LIMIT 1
      `)
      .get({ kind, normalizedValue, handleNormalized, excludeId: excludeId ?? null }) as ListEntryRow | undefined;
  }

  private activeListRows(kind: ListKind): ListEntry[] {
    return (
      this.database
        .prepare(`
          SELECT *
          FROM list_entries
          WHERE kind = ?
            AND is_deleted = 0
          ORDER BY id ASC
        `)
        .all(kind) as ListEntryRow[]
    ).map(mapRow);
  }
}

const handleKinds = new Set<ListKind>(["following", "friend", "banned_user", "stale_keyword_user", "skipped_keyword_user"]);
const editableListKinds: ListKind[] = [
  "keyword",
  "following",
  "friend",
  "banned_user",
  "banned_word",
  "banned_word_exception",
  "rss_feed",
  "no_result",
  "search_terms_used",
  "stale_keyword_user",
  "skipped_keyword_user"
];

function sourcePriority(sourceFile: string | null): number {
  if (!sourceFile) return 3;
  if (sourceFile.startsWith("uploaded:")) return 1;
  return 2;
}

function dedupeKey(row: DeduplicateRow): string {
  const value = handleKinds.has(row.kind) && row.handle_normalized ? row.handle_normalized : row.normalized_value;
  return `${row.kind}\u0000${value}`;
}

function compareDedupeRows(left: DeduplicateRow, right: DeduplicateRow): number {
  const priorityDiff = sourcePriority(right.source_file) - sourcePriority(left.source_file);
  if (priorityDiff !== 0) return priorityDiff;
  return left.id - right.id;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function mapRow(row: ListEntryRow): ListEntry {
  return {
    id: row.id,
    kind: row.kind,
    rawValue: row.raw_value,
    normalizedValue: row.normalized_value,
    handleNormalized: row.handle_normalized,
    sourceFile: row.source_file,
    lineNumber: row.line_number,
    isEmpty: row.is_empty === 1,
    isDeleted: row.is_deleted === 1,
    createdAt: row.created_at,
    importedAt: row.imported_at
  };
}
