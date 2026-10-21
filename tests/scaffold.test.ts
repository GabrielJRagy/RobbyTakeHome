import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { openDb } from "../src/db.ts";
import { EVENTS_PATH, QUOTES_PATH } from "../src/paths.ts";

test("seed files are reachable from the path constant", () => {
  assert.equal(existsSync(QUOTES_PATH), true);
  assert.equal(existsSync(EVENTS_PATH), true);
});

test("opens an in-memory sqlite database", () => {
  const db = openDb(":memory:");
  const row = db.prepare("SELECT 1 AS x").get() as { x: number };
  assert.equal(row.x, 1);
  db.close();
});
