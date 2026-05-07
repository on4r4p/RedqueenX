import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database";
import { ListService } from "../src/admin/listService";
import { RunService } from "../src/admin/runService";
import { executeAdminCommand, parseAdminCommand } from "../src/admin/commandParser";

describe("admin command parser", () => {
  it("parses legacy command syntax", () => {
    expect(parseAdminCommand("addkeyword:xss,rce; adduser:@alice @bob; !start")).toEqual([
      { type: "add", kind: "keyword", values: ["xss", "rce"] },
      { type: "add", kind: "following", values: ["@alice", "@bob"] },
      { type: "start" }
    ]);
  });

  it("executes legacy commands through admin services", () => {
    const database = openMemoryDatabase();
    const lists = new ListService(database);
    const runs = new RunService(database);

    executeAdminCommand("addkeyword:xss,rce;bankeyword:rce;adduser:@alice;banuser:@alice;!start", { lists, runs });

    expect(lists.activeValues("keyword")).toEqual(["xss"]);
    expect(lists.activeValues("banned_word")).toEqual(["rce"]);
    expect(lists.activeValues("following")).toEqual([]);
    expect(lists.activeValues("banned_user")).toEqual(["@alice"]);
    expect(runs.current()?.status).toBe("running");
  });
});
