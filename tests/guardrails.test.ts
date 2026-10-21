import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_NOW } from "../src/clock.ts";
import { KAREN_PHONE } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { approveDraft, ensureDraft, listDrafts, openDraftForQuote } from "../src/drafts.ts";
import { run } from "../src/engine.ts";
import { loadSeed, parseEventsJsonl } from "../src/ingest.ts";
import { MemoryProvider, SendError, listOutbox, sendDraft } from "../src/outbox.ts";
import { EVENTS_PATH, QUOTES_PATH } from "../src/paths.ts";
import { evaluateFromDb } from "../src/policy.ts";
import { projectFromDb, readEvents, readQuotes } from "../src/project.ts";

function seed() {
  const db = openDb(":memory:");
  loadSeed(db);
  return db;
}

test("duplicate events: unique event_id count is 82 against 88 seed lines", () => {
  const raw = readFileSync(EVENTS_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "").length;
  const db = seed();
  const events = readEvents(db);
  assert.equal(raw, 88);
  assert.equal(events.length, 82);
  db.close();
});

test("ingest twice: second load inserts nothing", () => {
  const db = openDb(":memory:");
  const first = loadSeed(db);
  const second = loadSeed(db);
  assert.equal(first.eventsInserted, 82);
  assert.equal(second.eventsInserted, 0);
  assert.equal(second.uniqueEventIds, 82);
  db.close();
});

test("reverse-order projections match file-order projections", () => {
  const forward = seed();
  const expected = Object.fromEntries(projectFromDb(forward));
  const parsed = parseEventsJsonl(readFileSync(EVENTS_PATH, "utf8"));
  const reversed = [...parsed].sort((a, b) =>
    b.event.timestamp.localeCompare(a.event.timestamp),
  );
  const dir = mkdtempSync(join(tmpdir(), "followup-"));
  const eventsPath = join(dir, "events.jsonl");
  writeFileSync(
    eventsPath,
    reversed
      .map((row) =>
        JSON.stringify({
          event_id: row.event.event_id,
          type: row.event.type,
          quote_id: row.event.quote_id,
          timestamp: row.event.timestamp,
          ...(row.event.channel ? { channel: row.event.channel } : {}),
          ...(row.event.direction ? { direction: row.event.direction } : {}),
        }),
      )
      .join("\n"),
  );
  const backward = openDb(":memory:");
  loadSeed(backward, { quotesPath: QUOTES_PATH, eventsPath });
  assert.deepEqual(Object.fromEntries(projectFromDb(backward)), expected);
  forward.close();
  backward.close();
});

test("never SMS accepted or dismissed, including draft-then-accept", () => {
  const db = seed();
  const policy = evaluateFromDb(db, DEMO_NOW);
  const banned = new Set(["Q-1004", "Q-1017", "Q-1009"]);
  for (const row of [...policy.actionable, ...policy.suppressed]) {
    assert.equal(banned.has(row.quote_id), false);
  }

  const q1026 = readQuotes(db).find((row) => row.id === "Q-1026")!;
  const candidate = policy.actionable.find((row) => row.quote_id === "Q-1026");
  assert.ok(candidate);
  const { draft } = ensureDraft(db, q1026, candidate, DEMO_NOW);
  approveDraft(db, draft.id);
  db.prepare(
    `INSERT INTO events (event_id, quote_id, type, timestamp, ingested_at)
     VALUES ('accept-late', 'Q-1026', 'quote_accepted', ?, ?)`,
  ).run(DEMO_NOW, DEMO_NOW);
  assert.throws(
    () => sendDraft(db, draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "not_open",
  );
  db.close();
});

test("Karen cooldown: outbound on Q-1003 blocks send on Q-1025", () => {
  const db = seed();
  const now = "2026-08-14T12:00:00Z";
  const quotes = readQuotes(db);
  const q1025 = quotes.find((row) => row.id === "Q-1025")!;
  const q1003 = quotes.find((row) => row.id === "Q-1003")!;
  const candidate = evaluateFromDb(db, now).actionable.find(
    (row) => row.quote_id === "Q-1025",
  );
  assert.ok(candidate);
  const first = ensureDraft(db, q1025, candidate, now);
  approveDraft(db, first.draft.id);
  sendDraft(db, first.draft.id, now, new MemoryProvider());

  const second = ensureDraft(
    db,
    q1003,
    {
      quote_id: "Q-1003",
      phone: KAREN_PHONE,
      primary: "B",
      reasons: ["B"],
    },
    now,
  );
  approveDraft(db, second.draft.id);
  assert.throws(
    () => sendDraft(db, second.draft.id, now, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "cooldown",
  );
  db.close();
});

test("engine twice → one draft per quote, never auto-approve", () => {
  const db = seed();
  const first = run(db, DEMO_NOW);
  const second = run(db, DEMO_NOW);
  assert.equal(first.drafted_because.length, 10);
  assert.equal(first.drafted_because.every((row) => row.created), true);
  const q1012 = listDrafts(db).filter((draft) => draft.quote_id === "Q-1012");
  assert.equal(q1012.length, 1);
  assert.equal(q1012[0]?.status, "drafted");
  const quoteIds = listDrafts(db).map((draft) => draft.quote_id);
  assert.equal(quoteIds.length, new Set(quoteIds).size);
  assert.equal(
    second.drafted_because.some((row) => row.quote_id === "Q-1012" && row.created),
    false,
  );
  assert.equal(
    listDrafts(db).every((draft) => draft.status === "drafted"),
    true,
  );
  db.close();
});

test("approve/send twice → provider once (send idempotent)", () => {
  const db = seed();
  run(db, DEMO_NOW);
  const draft = openDraftForQuote(db, "Q-1012");
  assert.ok(draft);
  const provider = new MemoryProvider();
  approveDraft(db, draft.id);
  const first = sendDraft(db, draft.id, DEMO_NOW, provider);
  const second = sendDraft(db, draft.id, DEMO_NOW, provider);
  assert.equal(first.noop, false);
  assert.equal(second.noop, true);
  assert.equal(provider.successes, 1);
  assert.equal(listOutbox(db).filter((row) => row.status === "sent").length, 1);
  db.close();
});

test("provider throw then retry → one success", () => {
  const db = seed();
  run(db, DEMO_NOW);
  const draft = openDraftForQuote(db, "Q-1016");
  assert.ok(draft);
  approveDraft(db, draft.id);
  const provider = new MemoryProvider();
  provider.failNext(1);
  assert.throws(() => sendDraft(db, draft.id, DEMO_NOW, provider));
  sendDraft(db, draft.id, DEMO_NOW, provider);
  assert.equal(provider.successes, 1);
  db.close();
});

test("stale draft if they replied after draft.created_at", () => {
  const db = seed();
  run(db, "2026-08-16T15:00:00Z");
  const draft = openDraftForQuote(db, "Q-1026");
  assert.ok(draft);
  approveDraft(db, draft.id);
  db.prepare(
    `INSERT INTO events (event_id, quote_id, type, timestamp, ingested_at)
     VALUES ('late-reply', 'Q-1026', 'customer_replied', '2026-08-16T17:00:00Z', ?)`,
  ).run(DEMO_NOW);
  assert.throws(
    () => sendDraft(db, draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "stale_draft",
  );
  db.close();
});

test("bad phone is refused at send time", () => {
  const db = seed();
  run(db, DEMO_NOW);
  const draft = openDraftForQuote(db, "Q-1012");
  assert.ok(draft);
  db.prepare(`UPDATE drafts SET phone = '555' WHERE id = ?`).run(draft.id);
  approveDraft(db, draft.id);
  assert.throws(
    () => sendDraft(db, draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "bad_phone",
  );
  db.close();
});

test("happy path: run → draft → approve → send → outbox once → phone suppressed", () => {
  const db = seed();
  run(db, DEMO_NOW);
  const draft = openDraftForQuote(db, "Q-1012");
  assert.ok(draft);
  assert.equal(draft.status, "drafted");
  approveDraft(db, draft.id);
  const provider = new MemoryProvider();
  sendDraft(db, draft.id, DEMO_NOW, provider);
  sendDraft(db, draft.id, DEMO_NOW, provider);
  assert.equal(provider.successes, 1);
  assert.equal(listOutbox(db).length, 1);

  const after = evaluateFromDb(db, DEMO_NOW);
  assert.equal(
    after.actionable.some((row) => row.quote_id === "Q-1012"),
    false,
  );

  const quote = readQuotes(db).find((row) => row.id === "Q-1012")!;
  const again = ensureDraft(
    db,
    quote,
    {
      quote_id: "Q-1012",
      phone: quote.customer_phone,
      primary: "D",
      reasons: ["D", "B"],
    },
    DEMO_NOW,
  );
  approveDraft(db, again.draft.id);
  assert.throws(
    () => sendDraft(db, again.draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "cooldown",
  );
  db.close();
});
