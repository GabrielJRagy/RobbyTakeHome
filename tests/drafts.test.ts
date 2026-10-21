import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_NOW } from "../src/clock.ts";
import { SMS_MAX_CHARS } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { draftFor, firstName } from "../src/drafting.ts";
import {
  approveDraft,
  editDraft,
  ensureDraft,
  openDraftForQuote,
  rejectDraft,
} from "../src/drafts.ts";
import { loadSeed } from "../src/ingest.ts";
import {
  MemoryProvider,
  SendError,
  sendDraft,
} from "../src/outbox.ts";
import { evaluateFromDb } from "../src/policy.ts";
import { projectAsOf, readEvents, readQuotes } from "../src/project.ts";

function seed() {
  const db = openDb(":memory:");
  loadSeed(db);
  return db;
}

function quoteAndCandidate(db: ReturnType<typeof openDb>, quoteId: string, now = DEMO_NOW) {
  const policy = evaluateFromDb(db, now);
  const candidate = policy.actionable.find((row) => row.quote_id === quoteId);
  const quote = readQuotes(db).find((row) => row.id === quoteId);
  assert.ok(candidate, `${quoteId} should be actionable`);
  assert.ok(quote);
  return { quote, candidate };
}

test("draftFor uses only that quote's name, tech, amount and stays short", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1012");
  const { body, channel } = draftFor(candidate, DEMO_NOW, quote);
  assert.equal(channel, "sms");
  assert.equal(body.includes(firstName(quote.customer_name)), true);
  assert.equal(body.includes("Carl"), true);
  assert.equal(body.includes("Jaden"), true);
  assert.equal(body.includes("18,000"), true);
  assert.equal(body.includes("Karen"), false);
  assert.ok(body.length <= SMS_MAX_CHARS);
  assert.throws(() =>
    draftFor(candidate, DEMO_NOW, readQuotes(db).find((row) => row.id === "Q-1000")!),
  );
  db.close();
});

test("one open draft per quote; rerun does not duplicate", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1012");
  const first = ensureDraft(db, quote, candidate, DEMO_NOW);
  const second = ensureDraft(db, quote, candidate, DEMO_NOW);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.draft.id, second.draft.id);
  assert.equal(first.draft.status, "drafted");
  db.close();
});

test("edit resets approval; cannot edit sent", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1012");
  const { draft } = ensureDraft(db, quote, candidate, DEMO_NOW);
  approveDraft(db, draft.id);
  const edited = editDraft(db, draft.id, "custom body");
  assert.equal(edited.status, "drafted");
  assert.equal(edited.body, "custom body");
  approveDraft(db, draft.id);
  sendDraft(db, draft.id, DEMO_NOW, new MemoryProvider());
  assert.throws(() => editDraft(db, draft.id, "nope"));
  db.close();
});

test("approve does not send; reject is dead then a new draft can be created", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1012");
  const { draft } = ensureDraft(db, quote, candidate, DEMO_NOW);
  const approved = approveDraft(db, draft.id);
  assert.equal(approved.status, "approved");
  assert.equal(openDraftForQuote(db, "Q-1012")?.status, "approved");
  rejectDraft(db, draft.id);
  assert.equal(openDraftForQuote(db, "Q-1012"), undefined);
  const again = ensureDraft(db, quote, candidate, DEMO_NOW);
  assert.equal(again.created, true);
  assert.notEqual(again.draft.id, draft.id);
  db.close();
});

test("send accepts only approved; second send is a no-op; provider once", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1012");
  const { draft } = ensureDraft(db, quote, candidate, DEMO_NOW);
  const provider = new MemoryProvider();
  assert.throws(() => sendDraft(db, draft.id, DEMO_NOW, provider), SendError);
  approveDraft(db, draft.id);
  const first = sendDraft(db, draft.id, DEMO_NOW, provider);
  const second = sendDraft(db, draft.id, DEMO_NOW, provider);
  assert.equal(first.noop, false);
  assert.equal(second.noop, true);
  assert.equal(provider.successes, 1);
  assert.equal(provider.attempts, 1);
  const projection = projectAsOf(readQuotes(db), readEvents(db), DEMO_NOW).get(
    "Q-1012",
  );
  assert.equal(projection?.last_outbound_at, DEMO_NOW);
  db.close();
});

test("provider throw then retry yields one success", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1016");
  const { draft } = ensureDraft(db, quote, candidate, DEMO_NOW);
  approveDraft(db, draft.id);
  const provider = new MemoryProvider();
  provider.failNext(1);
  assert.throws(() => sendDraft(db, draft.id, DEMO_NOW, provider));
  const retry = sendDraft(db, draft.id, DEMO_NOW, provider);
  assert.equal(retry.noop, false);
  assert.equal(provider.successes, 1);
  assert.equal(provider.attempts, 2);
  db.close();
});

test("stale-draft if they replied after draft.created_at", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1026");
  const { draft } = ensureDraft(db, quote, candidate, "2026-08-16T15:00:00Z");
  approveDraft(db, draft.id);
  db.prepare(
    `INSERT INTO events (event_id, quote_id, type, timestamp, ingested_at)
     VALUES ('reply-late', 'Q-1026', 'customer_replied', '2026-08-16T17:00:00Z', ?)`,
  ).run(DEMO_NOW);
  assert.throws(
    () => sendDraft(db, draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "stale_draft",
  );
  db.close();
});

test("bad phone is refused; accepted quote cannot send", () => {
  const db = seed();
  const { quote, candidate } = quoteAndCandidate(db, "Q-1012");
  const { draft } = ensureDraft(db, quote, candidate, DEMO_NOW);
  db.prepare(`UPDATE drafts SET phone = '555' WHERE id = ?`).run(draft.id);
  approveDraft(db, draft.id);
  assert.throws(
    () => sendDraft(db, draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "bad_phone",
  );

  const q1004 = readQuotes(db).find((row) => row.id === "Q-1004")!;
  const forced = ensureDraft(
    db,
    q1004,
    {
      quote_id: "Q-1004",
      phone: q1004.customer_phone,
      primary: "A",
      reasons: ["A"],
    },
    DEMO_NOW,
  );
  approveDraft(db, forced.draft.id);
  assert.throws(
    () => sendDraft(db, forced.draft.id, DEMO_NOW, new MemoryProvider()),
    (err: unknown) => err instanceof SendError && err.code === "not_open",
  );
  db.close();
});
