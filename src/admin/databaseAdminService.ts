import fsSync from "node:fs";
import type { Database } from "better-sqlite3";

export interface DatabaseOverview {
  database: {
    path: string;
    pageSize: number;
    pageCount: number;
    freelistCount: number;
    databaseBytes: number;
    walBytes: number;
    shmBytes: number;
    totalFileBytes: number;
  };
  tables: DatabaseTableSummary[];
}

export interface DatabaseTableSummary {
  name: string;
  rowCount: number;
  dataBytes: number | null;
  indexBytes: number | null;
  totalBytes: number | null;
  indexCount: number;
}

export interface DatabaseTableDetail extends DatabaseTableSummary {
  schemaSql: string | null;
  columns: DatabaseColumnInfo[];
  indexes: DatabaseIndexInfo[];
  foreignKeys: DatabaseForeignKeyInfo[];
  sampleRows: Record<string, unknown>[];
}

export interface DatabaseExport {
  filename: string;
  contentType: string;
  body: string;
}

type SqliteTableRow = {
  name: string;
  sql: string | null;
};

type DbstatRow = {
  name: string;
  bytes: number;
};

type IndexRow = {
  name: string;
  tbl_name: string;
};

type CountRow = {
  count: number;
};

type DatabaseColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

type DatabaseIndexInfo = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type DatabaseForeignKeyInfo = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
};

export class DatabaseAdminService {
  constructor(private readonly database: Database) {}

  overview(): DatabaseOverview {
    const tableRows = this.tableRows();
    const sizeMap = this.sizeMap();
    const indexesByTable = this.indexesByTable();
    return {
      database: this.databaseStats(),
      tables: tableRows.map((table) => this.tableSummary(table.name, sizeMap, indexesByTable))
    };
  }

  tableDetail(tableName: string, limit = 25): DatabaseTableDetail {
    this.assertUserTable(tableName);
    const sizeMap = this.sizeMap();
    const indexesByTable = this.indexesByTable();
    const summary = this.tableSummary(tableName, sizeMap, indexesByTable);
    const quoted = quoteIdentifier(tableName);
    const table = this.tableRows().find((row) => row.name === tableName);
    return {
      ...summary,
      schemaSql: table?.sql ?? null,
      columns: this.database.prepare(`PRAGMA table_info(${quoted})`).all() as DatabaseColumnInfo[],
      indexes: this.database.prepare(`PRAGMA index_list(${quoted})`).all() as DatabaseIndexInfo[],
      foreignKeys: this.database.prepare(`PRAGMA foreign_key_list(${quoted})`).all() as DatabaseForeignKeyInfo[],
      sampleRows: this.database.prepare(`SELECT * FROM ${quoted} LIMIT ?`).all(Math.min(Math.max(limit, 1), 100)) as Record<
        string,
        unknown
      >[]
    };
  }

  exportTable(tableName: string, format: "json" | "csv"): DatabaseExport {
    this.assertUserTable(tableName);
    const rows = this.database.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`).all() as Record<string, unknown>[];
    if (format === "json") {
      return {
        filename: `${tableName}.json`,
        contentType: "application/json; charset=utf-8",
        body: `${JSON.stringify(rows, null, 2)}\n`
      };
    }

    const columns = this.columnNames(tableName);
    return {
      filename: `${tableName}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: toCsv(rows, columns)
    };
  }

  clearTable(tableName: string): { table: string; deletedRows: number } {
    this.assertUserTable(tableName);
    const quoted = quoteIdentifier(tableName);
    const deleteRows = this.database.transaction(() => {
      const result = this.database.prepare(`DELETE FROM ${quoted}`).run();
      this.database.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(tableName);
      return Number(result.changes);
    });
    return {
      table: tableName,
      deletedRows: deleteRows()
    };
  }

  integrityCheck(): { ok: boolean; results: string[] } {
    const rows = this.database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    const results = rows.map((row) => row.integrity_check);
    return {
      ok: results.length === 1 && results[0] === "ok",
      results
    };
  }

  analyze(): { ok: true } {
    this.database.exec("ANALYZE");
    return { ok: true };
  }

  vacuum(): { ok: true } {
    this.database.exec("VACUUM");
    return { ok: true };
  }

  private tableSummary(
    tableName: string,
    sizeMap = this.sizeMap(),
    indexesByTable = this.indexesByTable()
  ): DatabaseTableSummary {
    const indexes = indexesByTable.get(tableName) ?? [];
    const dataBytes = sizeMap.get(tableName) ?? null;
    const indexBytes = indexes.reduce((sum, indexName) => sum + (sizeMap.get(indexName) ?? 0), 0);
    return {
      name: tableName,
      rowCount: this.countRows(tableName),
      dataBytes,
      indexBytes: sizeMap.size > 0 ? indexBytes : null,
      totalBytes: dataBytes === null ? null : dataBytes + indexBytes,
      indexCount: indexes.length
    };
  }

  private databaseStats(): DatabaseOverview["database"] {
    const pageSize = Number(this.database.pragma("page_size", { simple: true }));
    const pageCount = Number(this.database.pragma("page_count", { simple: true }));
    const freelistCount = Number(this.database.pragma("freelist_count", { simple: true }));
    const dbPath = this.database.name;
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    const databaseBytes = this.fileSize(dbPath);
    const walBytes = this.fileSize(walPath);
    const shmBytes = this.fileSize(shmPath);
    return {
      path: dbPath,
      pageSize,
      pageCount,
      freelistCount,
      databaseBytes: databaseBytes || pageSize * pageCount,
      walBytes,
      shmBytes,
      totalFileBytes: (databaseBytes || pageSize * pageCount) + walBytes + shmBytes
    };
  }

  private tableRows(): SqliteTableRow[] {
    return this.database
      .prepare(
        `
          SELECT name, sql
          FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `
      )
      .all() as SqliteTableRow[];
  }

  private assertUserTable(tableName: string): void {
    if (!this.tableRows().some((table) => table.name === tableName)) {
      throw new Error(`Unknown SQLite table: ${tableName}`);
    }
  }

  private countRows(tableName: string): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as CountRow;
    return row.count;
  }

  private columnNames(tableName: string): string[] {
    return (this.database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as DatabaseColumnInfo[]).map(
      (column) => column.name
    );
  }

  private sizeMap(): Map<string, number> {
    try {
      const rows = this.database.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name").all() as DbstatRow[];
      return new Map(rows.map((row) => [row.name, row.bytes]));
    } catch {
      return new Map();
    }
  }

  private indexesByTable(): Map<string, string[]> {
    const rows = this.database
      .prepare(
        `
          SELECT name, tbl_name
          FROM sqlite_master
          WHERE type = 'index'
            AND tbl_name NOT LIKE 'sqlite_%'
        `
      )
      .all() as IndexRow[];
    const indexes = new Map<string, string[]>();
    for (const row of rows) {
      indexes.set(row.tbl_name, [...(indexes.get(row.tbl_name) ?? []), row.name]);
    }
    return indexes;
  }

  private fileSize(filename: string): number {
    if (this.database.memory || filename === ":memory:") {
      return 0;
    }
    try {
      return fsSync.statSync(filename).size;
    } catch {
      return 0;
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column])).join(","));
  return `${[header, ...body].join("\n")}\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
