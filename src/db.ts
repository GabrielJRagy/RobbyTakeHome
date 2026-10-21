import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./paths.ts";

export type Db = DatabaseSync;

export function openDb(path: string = DB_PATH): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);
  return db;
}

export function ensureSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      tech_name TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_contact_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      quote_id TEXT,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      channel TEXT,
      direction TEXT,
      ingested_at TEXT NOT NULL
    );
  `);
}
