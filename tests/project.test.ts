import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { KAREN_PHONE, KAREN_QUOTE_IDS } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { loadSeed, parseEventsJsonl } from "../src/ingest.ts";
import { EVENTS_PATH, QUOTES_PATH } from "../src/paths.ts";
import { customerIndexFromDb, projectFromDb } from "../src/project.ts";
import type { QuoteProjection } from "../src/types.ts";

function loadRealSeed() {
  const db = openDb(":memory:");
  loadSeed(db);
  return db;
}

test("Q-1004 stays accepted; later views do not reopen it", () => {
  const db = loadRealSeed();
  const projection = projectFromDb(db).get("Q-1004");
  assert.deepEqual(projection, {
    quote_id: "Q-1004",
    status: "accepted",
    first_sent_at: "2026-08-07T07:00:00Z",
    last_viewed_at: "2026-08-14T12:00:00Z",
    view_count: 3,
    last_customer_reply_at: "2026-08-09T20:00:00Z",
    last_outbound_at: null,
    last_accepted_at: "2026-08-10T07:00:00Z",
  } satisfies QuoteProjection);
  db.close();
});

test("Q-1009 stays dismissed; view and reply do not un-dismiss", () => {
  const db = loadRealSeed();
  const projection = projectFromDb(db).get("Q-1009");
  assert.equal(projection?.status, "dismissed");
  assert.equal(projection?.last_viewed_at, "2026-08-15T00:00:00Z");
  assert.equal(projection?.last_customer_reply_at, "2026-08-10T05:00:00Z");
  db.close();
});

test("Q-1005: null last_contact_at but message_sent is last_outbound_at", () => {
  const db = loadRealSeed();
  const quotes = db
    .prepare("SELECT last_contact_at FROM quotes WHERE id = 'Q-1005'")
    .get() as { last_contact_at: string | null };
  assert.equal(quotes.last_contact_at, null);
  const projection = projectFromDb(db).get("Q-1005");
  assert.equal(projection?.last_outbound_at, "2026-08-08T09:00:00Z");
  assert.equal(projection?.first_sent_at, "2026-08-07T14:00:00Z");
  db.close();
});

test("Karen Nguyen: two quotes, one phone, shared outbound index", () => {
  const db = loadRealSeed();
  const customers = customerIndexFromDb(db);
  assert.deepEqual(customers.quotesForPhone.get(KAREN_PHONE), [...KAREN_QUOTE_IDS]);
  assert.equal(customers.lastOutboundForPhone.get(KAREN_PHONE), null);
  const projections = projectFromDb(db);
  assert.equal(projections.get("Q-1003")?.first_sent_at, "2026-08-01T15:00:00Z");
  assert.equal(projections.get("Q-1025")?.last_viewed_at, "2026-08-13T00:00:00Z");
  db.close();
});

test("reverse-order ingest matches file-order projection", () => {
  const forward = openDb(":memory:");
  loadSeed(forward);
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
  const actual = Object.fromEntries(projectFromDb(backward));
  assert.deepEqual(actual, expected);
  forward.close();
  backward.close();
});
