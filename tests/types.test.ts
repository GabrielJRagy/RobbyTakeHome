import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_NOW, hoursBetween } from "../src/clock.ts";
import { COOLDOWN_HOURS, KAREN_PHONE, KAREN_QUOTE_IDS } from "../src/config.ts";

test("demo now is a fixed ISO instant after the seed window", () => {
  assert.equal(DEMO_NOW, "2026-08-16T18:00:00Z");
  assert.equal(hoursBetween(DEMO_NOW, "2026-08-16T16:00:00Z"), 2);
});

test("Karen's two quotes share one phone for cooldown", () => {
  assert.equal(KAREN_PHONE, "+19175552003");
  assert.deepEqual([...KAREN_QUOTE_IDS], ["Q-1003", "Q-1025"]);
  assert.equal(COOLDOWN_HOURS, 72);
});
