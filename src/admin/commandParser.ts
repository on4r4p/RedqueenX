import { ListService } from "./listService";
import { RunService } from "./runService";
import type { ListKind } from "../types";

export interface CommandExecutionResult {
  command: string;
  messages: string[];
  data?: unknown;
}

export interface CommandServices {
  lists: ListService;
  runs: RunService;
}

type ParsedCommand =
  | { type: "add"; kind: ListKind; values: string[] }
  | { type: "delete"; kind: ListKind; values: string[] }
  | { type: "ban_keyword"; values: string[] }
  | { type: "ban_user"; values: string[] }
  | { type: "list"; kind: ListKind }
  | { type: "start" }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "unknown"; raw: string };

export function parseAdminCommand(input: string): ParsedCommand[] {
  return input
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseSingleCommand);
}

export function executeAdminCommand(input: string, services: CommandServices): CommandExecutionResult {
  const parsed = parseAdminCommand(input);
  const messages: string[] = [];
  const data: unknown[] = [];

  for (const command of parsed) {
    switch (command.type) {
      case "add": {
        for (const value of command.values) {
          services.lists.add(command.kind, value);
        }
        messages.push(`Added ${command.values.length} entr${command.values.length === 1 ? "y" : "ies"} to ${command.kind}.`);
        break;
      }
      case "delete": {
        let changes = 0;
        for (const value of command.values) {
          changes += services.lists.markDeleted(command.kind, value);
        }
        messages.push(`Deleted ${changes} entr${changes === 1 ? "y" : "ies"} from ${command.kind}.`);
        break;
      }
      case "ban_keyword": {
        for (const value of command.values) {
          services.lists.add("banned_word", value);
          services.lists.markDeleted("keyword", value);
        }
        messages.push(`Banned ${command.values.length} keyword${command.values.length === 1 ? "" : "s"}.`);
        break;
      }
      case "ban_user": {
        for (const value of command.values) {
          services.lists.add("banned_user", value);
          services.lists.markDeleted("following", value);
          services.lists.markDeleted("friend", value);
          services.lists.markDeleted("keyword", value);
        }
        messages.push(`Banned ${command.values.length} user${command.values.length === 1 ? "" : "s"}.`);
        break;
      }
      case "list": {
        const entries = services.lists.list(command.kind);
        data.push({ kind: command.kind, entries });
        messages.push(`${command.kind}: ${entries.length} active entr${entries.length === 1 ? "y" : "ies"}.`);
        break;
      }
      case "start": {
        const run = services.runs.start();
        data.push(run);
        messages.push(`Run ${run.id} is ${run.status}.`);
        break;
      }
      case "pause": {
        const current = services.runs.current();
        if (!current) {
          messages.push("No run to pause.");
          break;
        }
        const run = services.runs.pause(current.id);
        data.push(run);
        messages.push(`Run ${run.id} paused.`);
        break;
      }
      case "stop": {
        const current = services.runs.current();
        if (!current) {
          messages.push("No run to stop.");
          break;
        }
        const run = services.runs.stop(current.id);
        data.push(run);
        messages.push(`Run ${run.id} stopped.`);
        break;
      }
      case "unknown":
        messages.push(`Command not recognised: ${command.raw}`);
        break;
    }
  }

  return {
    command: input,
    messages,
    data: data.length > 0 ? data : undefined
  };
}

function parseSingleCommand(raw: string): ParsedCommand {
  const lowered = raw.toLowerCase();

  if (lowered === "!start") return { type: "start" };
  if (lowered === "!stop") return { type: "stop" };
  if (lowered === "!pause") return { type: "pause" };
  if (lowered === "!keywords") return { type: "list", kind: "keyword" };
  if (lowered === "!users") return { type: "list", kind: "following" };
  if (lowered === "!friends") return { type: "list", kind: "friend" };
  if (lowered === "!badkeys") return { type: "list", kind: "banned_word" };
  if (lowered === "!badppl") return { type: "list", kind: "banned_user" };
  if (lowered === "!rss") return { type: "list", kind: "rss_feed" };

  if (lowered.startsWith("addkeyword:")) return { type: "add", kind: "keyword", values: splitCsv(raw.slice(raw.indexOf(":") + 1)) };
  if (lowered.startsWith("delkeyword:")) return { type: "delete", kind: "keyword", values: splitCsv(raw.slice(raw.indexOf(":") + 1)) };
  if (lowered.startsWith("bankeyword:")) return { type: "ban_keyword", values: splitCsv(raw.slice(raw.indexOf(":") + 1)) };

  if (lowered.startsWith("adduser:")) return { type: "add", kind: "following", values: splitUserList(raw.slice(raw.indexOf(":") + 1)) };
  if (lowered.startsWith("deluser:")) return { type: "delete", kind: "following", values: splitUserList(raw.slice(raw.indexOf(":") + 1)) };
  if (lowered.startsWith("banuser:")) return { type: "ban_user", values: splitUserList(raw.slice(raw.indexOf(":") + 1)) };

  if (lowered.startsWith("addfriend:")) return { type: "add", kind: "friend", values: splitUserList(raw.slice(raw.indexOf(":") + 1)) };
  if (lowered.startsWith("delfriend:")) return { type: "delete", kind: "friend", values: splitUserList(raw.slice(raw.indexOf(":") + 1)) };

  if (lowered.startsWith("addrss:")) return { type: "add", kind: "rss_feed", values: splitCsv(raw.slice(raw.indexOf(":") + 1)) };
  if (lowered.startsWith("delrss:")) return { type: "delete", kind: "rss_feed", values: splitCsv(raw.slice(raw.indexOf(":") + 1)) };

  return { type: "unknown", raw };
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitUserList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
