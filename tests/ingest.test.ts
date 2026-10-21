import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openDb } from "../src/db.ts";
import {
  JsonlParseError,
  loadSeed,
  parseEventsJsonl,
} from "../src/ingest.ts";
import { EVENTS_PATH } from "../src/paths.ts";

test("valid JSONL objects parse into stored events", () => {
  const rows = parseEventsJsonl(
    `{"event_id":"e1","type":"quote_viewed","quote_id":"Q-1","timestamp":"2026-08-01T00:00:00Z"}
{"event_id":"e2","type":"message_sent","quote_id":"Q-1","timestamp":"2026-08-02T00:00:00Z","channel":"sms","direction":"outbound"}
`,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.event.event_id, "e1");
  assert.equal(rows[1]?.event.channel, "sms");
  assert.deepEqual(rows.flatMap((r) => r.warnings), []);
});

test("blank JSONL lines are skipped, not treated as records", () => {
  // Webhook dumps and editors leave empty lines. Counting them as events
  // would inflate activity and break unique-id vs line-count checks.
  const rows = parseEventsJsonl(`
{"event_id":"e1","type":"quote_viewed","quote_id":"Q-1","timestamp":"2026-08-01T00:00:00Z"}

{"event_id":"e2","type":"quote_viewed","quote_id":"Q-1","timestamp":"2026-08-02T00:00:00Z"}
`);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.line),
    [2, 4],
  );
});

test("bad JSON fails with a 1-based line number", () => {
  // A truncated webhook line must not silently drop the rest of the file
  // or become a fake event. The line number is how you find it in the dump.
  assert.throws(
    () =>
      parseEventsJsonl(`{"event_id":"e1","type":"quote_viewed","quote_id":"Q-1","timestamp":"2026-08-01T00:00:00Z"}
{not-json}
{"event_id":"e3","type":"quote_viewed","quote_id":"Q-1","timestamp":"2026-08-03T00:00:00Z"}
`),
    (err: unknown) => {
      assert.ok(err instanceof JsonlParseError);
      assert.equal(err.line, 2);
      assert.match(err.message, /line 2/);
      return true;
    },
  );
});

test("real seed: unique event_id count vs raw non-blank lines", () => {
  // The assignment's messy stream is duplicated on purpose. If ingest stored
  // every line, view counts and last-touch would double and policy would lie.
  const text = readFileSync(EVENTS_PATH, "utf8");
  const rawLines = text.split("\n").filter((line) => line.trim() !== "").length;
  const db = openDb(":memory:");
  const first = loadSeed(db);
  const second = loadSeed(db);

  assert.equal(rawLines, 88);
  assert.equal(first.eventLines, 88);
  assert.equal(first.uniqueEventIds, 82);
  assert.equal(first.eventsInserted, 82);
  assert.equal(first.quotes, 30);
  assert.equal(second.eventsInserted, 0);
  assert.equal(second.uniqueEventIds, 82);
  db.close();
});

test("missing quote_id is kept with a warning; unknown types are stored", () => {
  const rows = parseEventsJsonl(
    `{"event_id":"e-missing","type":"quote_viewed","timestamp":"2026-08-01T00:00:00Z"}
{"event_id":"e-unknown","type":"quote_priced","quote_id":"Q-1","timestamp":"2026-08-01T00:00:00Z"}
`,
  );
  assert.equal(rows[0]?.event.quote_id, null);
  assert.equal(rows[0]?.warnings.length, 1);
  assert.equal(rows[1]?.event.type, "quote_priced");
  assert.match(rows[1]?.warnings[0] ?? "", /unknown type/);
});
