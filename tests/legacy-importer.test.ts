import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database";
import { LegacyImporter } from "../src/legacy/importer";

describe("LegacyImporter", () => {
  it("imports unique legacy values without trimming raw values or dropping empty lines", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-import-"));
    const keywords = path.join(tmp, "Rq.Keywords");
    fs.writeFileSync(keywords, " alpha \n\nbeta\nalpha\néxploit", "utf8");

    const database = openMemoryDatabase();
    const importer = new LegacyImporter(database);
    const result = importer.importDirectory(tmp, [{ filename: "Rq.Keywords", kind: "keyword" }]);

    expect(result.files).toMatchObject([
      {
        filename: "Rq.Keywords",
        status: "imported",
        totalLines: 5,
        importedLines: 4
      }
    ]);

    const rows = database
      .prepare("SELECT raw_value, line_number, is_empty, source_file FROM list_entries ORDER BY line_number ASC")
      .all() as Array<{ raw_value: string; line_number: number; is_empty: number; source_file: string }>;

    expect(rows.map((row) => row.raw_value)).toEqual([" alpha ", "", "beta", "éxploit"]);
    expect(rows.map((row) => row.line_number)).toEqual([1, 2, 3, 5]);
    expect(rows.map((row) => row.is_empty)).toEqual([0, 1, 0, 0]);
    expect(rows.every((row) => row.source_file === keywords)).toBe(true);

    const audit = database
      .prepare("SELECT source_file, total_lines, imported_lines, length(sha256) AS hash_length FROM legacy_import_audit")
      .get() as { source_file: string; total_lines: number; imported_lines: number; hash_length: number };
    expect(audit).toEqual({
      source_file: keywords,
      total_lines: 5,
      imported_lines: 4,
      hash_length: 64
    });
  });

  it("does not create an imported row for an absent optional file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-import-"));
    const database = openMemoryDatabase();
    const importer = new LegacyImporter(database);

    const result = importer.importDirectory(tmp, [{ filename: "Rq.Rss", kind: "rss_feed", optional: true }]);

    expect(result.files[0]).toMatchObject({ status: "missing", totalLines: 0, importedLines: 0 });
    const count = database.prepare("SELECT COUNT(*) AS count FROM list_entries").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("imports RSS feeds as unique URLs even when lines include titles", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-import-"));
    fs.writeFileSync(
      path.join(tmp, "Rq.Rss"),
      "Title : https://example.test/rss\nhttps://feed.test/a,\nDuplicate : https://example.test/rss",
      "utf8"
    );

    const database = openMemoryDatabase();
    const importer = new LegacyImporter(database);
    const result = importer.importSingle(tmp, "Rq.Rss", [{ filename: "Rq.Rss", kind: "rss_feed" }]);

    expect(result.files[0]).toMatchObject({
      filename: "Rq.Rss",
      kind: "rss_feed",
      totalLines: 3,
      importedLines: 2
    });

    const rows = database
      .prepare("SELECT raw_value, line_number FROM list_entries WHERE kind = 'rss_feed' ORDER BY line_number ASC")
      .all() as Array<{ raw_value: string; line_number: number }>;

    expect(rows).toEqual([
      { raw_value: "https://example.test/rss", line_number: 1 },
      { raw_value: "https://feed.test/a", line_number: 2 }
    ]);
  });

  it("replaces uploaded duplicate data with legacy directory data", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-import-"));
    const rqRss = path.join(tmp, "Rq.Rss");
    fs.writeFileSync(rqRss, "Title : https://example.test/rss", "utf8");

    const database = openMemoryDatabase();
    const importer = new LegacyImporter(database);
    importer.importContent("RssSave", "rss_sent", "Title : https://example.test/rss");
    importer.importSingle(tmp, "Rq.Rss", [{ filename: "Rq.Rss", kind: "rss_feed" }]);

    const rows = database
      .prepare("SELECT raw_value, source_file FROM list_entries WHERE kind = 'rss_feed'")
      .all() as Array<{ raw_value: string; source_file: string }>;

    expect(rows).toEqual([{ raw_value: "https://example.test/rss", source_file: rqRss }]);
  });

  it("keeps RssSave lines raw and derives rss_feed URLs from the title-prefixed lines", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-import-"));
    const rssSave = path.join(tmp, "RssSave");
    fs.writeFileSync(
      rssSave,
      "CVE-2021-0001 title : https://example.test/cve\nNo URL line\nThreat post : https://feed.test/a,",
      "utf8"
    );

    const database = openMemoryDatabase();
    const importer = new LegacyImporter(database);
    const result = importer.importSingle(tmp, "RssSave", [{ filename: "RssSave", kind: "rss_sent" }]);

    expect(result.files[0]).toMatchObject({
      filename: "RssSave",
      kind: "rss_sent",
      importedLines: 3,
      derived: [expect.objectContaining({ kind: "rss_feed", importedLines: 2 })]
    });

    const rawRows = database
      .prepare("SELECT raw_value FROM list_entries WHERE kind = 'rss_sent' ORDER BY line_number ASC")
      .all() as Array<{ raw_value: string }>;
    expect(rawRows.map((row) => row.raw_value)).toEqual([
      "CVE-2021-0001 title : https://example.test/cve",
      "No URL line",
      "Threat post : https://feed.test/a,"
    ]);

    const feedRows = database
      .prepare("SELECT raw_value, line_number FROM list_entries WHERE kind = 'rss_feed' ORDER BY line_number ASC")
      .all() as Array<{ raw_value: string; line_number: number }>;
    expect(feedRows).toEqual([
      { raw_value: "https://example.test/cve", line_number: 1 },
      { raw_value: "https://feed.test/a", line_number: 3 }
    ]);
  });

  it("imports uploaded content with an uploaded source marker", () => {
    const database = openMemoryDatabase();
    const importer = new LegacyImporter(database);

    const result = importer.importContent("Rq.Keywords", "keyword", " alpha \n\nbeta");

    expect(result).toMatchObject({
      dataDir: "uploaded",
      files: [
        {
          filename: "Rq.Keywords",
          sourceFile: "uploaded:Rq.Keywords",
          kind: "keyword",
          totalLines: 3,
          importedLines: 3
        }
      ]
    });

    const rows = database
      .prepare("SELECT raw_value, line_number, source_file FROM list_entries ORDER BY line_number ASC")
      .all() as Array<{ raw_value: string; line_number: number; source_file: string }>;

    expect(rows).toEqual([
      { raw_value: " alpha ", line_number: 1, source_file: "uploaded:Rq.Keywords" },
      { raw_value: "", line_number: 2, source_file: "uploaded:Rq.Keywords" },
      { raw_value: "beta", line_number: 3, source_file: "uploaded:Rq.Keywords" }
    ]);
  });
});
