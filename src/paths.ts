import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Repo root. Seed JSON lives here; SQLite is written here. */
export const REPO_ROOT = join(SRC_DIR, "..");

export const QUOTES_PATH = join(REPO_ROOT, "quotes.json");
export const EVENTS_PATH = join(REPO_ROOT, "events.jsonl");
export const DB_PATH = join(REPO_ROOT, "followup.db");
export const OUTBOX_LOG_PATH = join(REPO_ROOT, "outbox.jsonl");
export const PUBLIC_DIR = join(REPO_ROOT, "public");
