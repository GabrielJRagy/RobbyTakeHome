import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEMO_NOW } from "../src/clock.ts";
import { KAREN_PHONE } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { loadSeed } from "../src/ingest.ts";
import { evaluate, evaluateFromDb } from "../src/policy.ts";
import { projectAsOf, readEvents, readQuotes } from "../src/project.ts";
import type { Draft, OutboxRow } from "../src/types.ts";

function seedDb() {
  const db = openDb(":memory:");
  loadSeed(db);
  return db;
}

test("accepted and dismissed quotes are never actionable (Q-1004, Q-1017, Q-1009)", () => {
  const db = seedDb();
  const result = evaluateFromDb(db, DEMO_NOW);
  const ids = new Set([
    ...result.actionable.map((c) => c.quote_id),
    ...result.suppressed.map((c) => c.quote_id),
  ]);
  assert.equal(ids.has("Q-1004"), false);
  assert.equal(ids.has("Q-1017"), false);
  assert.equal(ids.has("Q-1009"), false);
  db.close();
});

test("Q-1012 and Q-1016 attach every matching signal (multi-reason)", () => {
  const db = seedDb();
  const result = evaluateFromDb(db, DEMO_NOW);
  const q1012 = result.actionable.find((c) => c.quote_id === "Q-1012");
  const q1016 = result.actionable.find((c) => c.quote_id === "Q-1016");
  assert.deepEqual(q1012?.reasons, ["D", "B"]);
  assert.equal(q1012?.primary, "D");
  assert.deepEqual(q1016?.reasons, ["C", "B"]);
  assert.equal(q1016?.primary, "C");
  db.close();
});

test("golden snapshot at demo now", () => {
  const db = seedDb();
  const result = evaluateFromDb(db, DEMO_NOW);
  const expected = JSON.parse(
    readFileSync(new URL("./golden/policy-demo-now.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
  db.close();
});

test("phone cooldown: outbound on Q-1003 suppresses Q-1025, not omitted", () => {
  const db = seedDb();
  const now = "2026-08-14T12:00:00Z";
  const quotes = readQuotes(db);
  const projections = projectAsOf(quotes, readEvents(db), now);
  const q1003 = projections.get("Q-1003");
  assert.ok(q1003);
  projections.set("Q-1003", {
    ...q1003,
    last_outbound_at: "2026-08-13T06:00:00Z",
  });

  const result = evaluate({ quotes, projections, now });
  const q1025 = result.suppressed.find((c) => c.quote_id === "Q-1025");
  assert.ok(q1025, "Q-1025 must remain visible as suppressed");
  assert.deepEqual(q1025.suppressedBecause, ["cooldown"]);
  assert.equal(q1025.reasons.includes("A"), true);
  assert.equal(
    result.actionable.some((c) => c.quote_id === "Q-1025"),
    false,
  );
  db.close();
});

test("pending draft on Karen's phone is in-flight for Q-1025", () => {
  const db = seedDb();
  const now = "2026-08-14T12:00:00Z";
  const draft: Draft = {
    id: "d1",
    quote_id: "Q-1003",
    phone: KAREN_PHONE,
    body: "hi",
    channel: "sms",
    reasons: ["A"],
    created_at: now,
    status: "drafted",
  };
  const result = evaluateFromDb(db, now, { drafts: [draft] });
  const q1025 = result.suppressed.find((c) => c.quote_id === "Q-1025");
  assert.ok(q1025);
  assert.equal(q1025.suppressedBecause.includes("in_flight"), true);
  db.close();
});

test("queued outbox counts as phone cooldown", () => {
  const db = seedDb();
  const now = "2026-08-14T12:00:00Z";
  const outbox: OutboxRow = {
    id: "o1",
    draft_id: "d1",
    idempotency_key: "d1",
    status: "queued",
    to: KAREN_PHONE,
    channel: "sms",
    body: "hi",
    created_at: "2026-08-13T06:00:00Z",
  };
  const result = evaluateFromDb(db, now, { outbox: [outbox] });
  const q1025 = result.suppressed.find((c) => c.quote_id === "Q-1025");
  assert.ok(q1025);
  assert.equal(q1025.suppressedBecause.includes("cooldown"), true);
  db.close();
});

test("two values of now: Q-1026 is A+B after the view, only B before it", () => {
  const db = seedDb();
  const afterView = evaluateFromDb(db, DEMO_NOW);
  const beforeView = evaluateFromDb(db, "2026-08-16T12:00:00Z");
  assert.deepEqual(
    afterView.actionable.find((c) => c.quote_id === "Q-1026")?.reasons,
    ["A", "B"],
  );
  assert.deepEqual(
    beforeView.actionable.find((c) => c.quote_id === "Q-1026")?.reasons,
    ["B"],
  );
  db.close();
});
