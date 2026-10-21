import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { EVENTS_PATH, QUOTES_PATH } from "../src/paths.ts";

test("seed files are reachable from the path constant", () => {
  assert.equal(existsSync(QUOTES_PATH), true);
  assert.equal(existsSync(EVENTS_PATH), true);
});
