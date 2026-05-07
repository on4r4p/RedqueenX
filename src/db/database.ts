import DatabaseConstructor, { type Database } from "better-sqlite3";
import { migrate } from "./schema";

export function openDatabase(filename: string): Database {
  const database = new DatabaseConstructor(filename);
  migrate(database);
  return database;
}

export function openMemoryDatabase(): Database {
  const database = new DatabaseConstructor(":memory:");
  migrate(database);
  return database;
}
