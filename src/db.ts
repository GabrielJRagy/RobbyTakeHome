import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./paths.ts";

export type Db = DatabaseSync;

export function wipeDbFiles(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) unlinkSync(file);
  }
}

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

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      body TEXT NOT NULL,
      channel TEXT NOT NULL,
      reasons TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      to_phone TEXT NOT NULL,
      channel TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      provider_message_id TEXT,
      error TEXT
    );
  `);
}
