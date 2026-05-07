import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import type { ListKind } from "../types";
import { parseLegacyLines } from "../text";
import { ListService } from "../admin/listService";

export interface LegacyFileMapping {
  filename: string;
  kind: ListKind;
  optional?: boolean;
}

export interface LegacyImportFileResult {
  filename: string;
  sourceFile: string;
  kind: ListKind;
  optional: boolean;
  status: "imported" | "missing";
  sha256: string | null;
  totalLines: number;
  importedLines: number;
  derived?: Array<{
    kind: ListKind;
    sourceFile: string;
    importedLines: number;
  }>;
}

export interface LegacyImportResult {
  dataDir: string;
  importedAt: string;
  files: LegacyImportFileResult[];
}

export const LEGACY_FILE_MAPPINGS: LegacyFileMapping[] = [
  { filename: "Rq.Keywords", kind: "keyword" },
  { filename: "Rq.Following", kind: "following" },
  { filename: "Rq.Friends", kind: "friend" },
  { filename: "Rq.Bannedpeople", kind: "banned_user" },
  { filename: "Rq.Bannedword", kind: "banned_word" },
  { filename: "Rq.Rss", kind: "rss_feed", optional: true },
  { filename: "Tweets.Sent", kind: "tweet_sent" },
  { filename: "Text.Sent", kind: "text_sent" },
  { filename: "No.Result", kind: "no_result" },
  { filename: "Request.log", kind: "request_log" },
  { filename: "TotalApi.Call", kind: "total_api_call" },
  { filename: "UpdateStatus.Call", kind: "update_status_call" },
  { filename: "Current.Session", kind: "current_session" },
  { filename: "SearchTerms.Used", kind: "search_terms_used" },
  { filename: "RssSave", kind: "rss_sent" },
  { filename: ".Session", kind: "hidden_session", optional: true }
];

export class LegacyImporter {
  private readonly lists: ListService;

  constructor(private readonly database: Database) {
    this.lists = new ListService(database);
  }

  importDirectory(dataDir: string, mappings = LEGACY_FILE_MAPPINGS): LegacyImportResult {
    const importedAt = new Date().toISOString();
    const absoluteDataDir = path.resolve(dataDir);
    const files: LegacyImportFileResult[] = [];

    for (const mapping of mappings) {
      files.push(this.importFile(absoluteDataDir, mapping, importedAt));
    }
    this.lists.deduplicateActive();

    return {
      dataDir: absoluteDataDir,
      importedAt,
      files
    };
  }

  listFiles(dataDir: string, mappings = LEGACY_FILE_MAPPINGS) {
    const absoluteDataDir = path.resolve(dataDir);
    return mappings.map((mapping) => {
      const sourceFile = path.join(absoluteDataDir, mapping.filename);
      const exists = fs.existsSync(sourceFile);
      return {
        filename: mapping.filename,
        kind: mapping.kind,
        optional: mapping.optional === true,
        sourceFile,
        exists,
        size: exists ? fs.statSync(sourceFile).size : 0,
        derivedKind: mapping.filename === "RssSave" ? "rss_feed" : null
      };
    });
  }

  importSingle(dataDir: string, filename: string, mappings = LEGACY_FILE_MAPPINGS): LegacyImportResult {
    const mapping = mappings.find((item) => item.filename === filename);
    if (!mapping) {
      throw new Error(`Unknown legacy file: ${filename}`);
    }

    const importedAt = new Date().toISOString();
    const absoluteDataDir = path.resolve(dataDir);
    const files = [this.importFile(absoluteDataDir, mapping, importedAt)];
    this.lists.deduplicateActive();
    return {
      dataDir: absoluteDataDir,
      importedAt,
      files
    };
  }

  importContent(filename: string, kind: ListKind, content: string): LegacyImportResult {
    const importedAt = new Date().toISOString();
    const sourceFile = `uploaded:${filename}`;
    const files = [this.importRawContent({ filename, kind }, sourceFile, content, importedAt)];
    this.lists.deduplicateActive();
    return {
      dataDir: "uploaded",
      importedAt,
      files
    };
  }

  private importFile(dataDir: string, mapping: LegacyFileMapping, importedAt: string): LegacyImportFileResult {
    const sourceFile = path.join(dataDir, mapping.filename);
    if (!fs.existsSync(sourceFile)) {
      return {
        filename: mapping.filename,
        sourceFile,
        kind: mapping.kind,
        optional: mapping.optional === true,
        status: "missing",
        sha256: null,
        totalLines: 0,
        importedLines: 0
      };
    }

    const content = fs.readFileSync(sourceFile, "utf8");
    return this.importRawContent(mapping, sourceFile, content, importedAt);
  }

  private importRawContent(
    mapping: LegacyFileMapping,
    sourceFile: string,
    content: string,
    importedAt: string
  ): LegacyImportFileResult {
    const lines = parseLegacyLines(content);
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    const importedLines =
      mapping.kind === "rss_feed"
        ? this.lists.replaceImportedRecords(sourceFile, mapping.kind, toRssFeedRecords(lines), importedAt)
        : this.lists.replaceImportedSource(sourceFile, mapping.kind, lines, importedAt);
    const derived = this.importDerivedRecords(mapping, sourceFile, lines, importedAt);

    this.database
      .prepare(`
        INSERT INTO legacy_import_audit (
          source_file,
          kind,
          sha256,
          total_lines,
          imported_lines,
          imported_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(sourceFile, mapping.kind, sha256, lines.length, importedLines, importedAt);

    return {
      filename: mapping.filename,
      sourceFile,
      kind: mapping.kind,
      optional: mapping.optional === true,
      status: "imported",
      sha256,
      totalLines: lines.length,
      importedLines,
      derived
    };
  }

  private importDerivedRecords(
    mapping: LegacyFileMapping,
    sourceFile: string,
    lines: string[],
    importedAt: string
  ): LegacyImportFileResult["derived"] {
    if (mapping.kind !== "rss_sent") {
      return undefined;
    }

    const records = lines
      .map((line, index) => ({ rawValue: extractLastUrl(line), lineNumber: index + 1 }))
      .filter((record): record is { rawValue: string; lineNumber: number } => Boolean(record.rawValue));
    const derivedSourceFile = `${sourceFile}#rss-links`;
    const importedLines = this.lists.replaceImportedRecords(derivedSourceFile, "rss_feed", records, importedAt);

    this.database
      .prepare(`
        INSERT INTO legacy_import_audit (
          source_file,
          kind,
          sha256,
          total_lines,
          imported_lines,
          imported_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(derivedSourceFile, "rss_feed", "derived-from-rsssave", lines.length, importedLines, importedAt);

    return [
      {
        kind: "rss_feed",
        sourceFile: derivedSourceFile,
        importedLines
      }
    ];
  }
}

function toRssFeedRecords(lines: string[]): Array<{ rawValue: string; lineNumber: number }> {
  return lines.map((line, index) => ({
    rawValue: extractLastUrl(line) ?? line,
    lineNumber: index + 1
  }));
}

function extractLastUrl(line: string): string | null {
  const matches = line.match(/https?:\/\/\S+/g);
  if (!matches?.length) {
    return null;
  }

  return matches[matches.length - 1].replace(/[),.]+$/, "");
}
