# Prompt series: Robby follow-up engine

Seed facts:
- `quotes.json`: 30 quotes (Q-1000–Q-1029). open | accepted | dismissed.
  Accepted: Q-1004, Q-1017. Dismissed: Q-1009.
- Same person, two quotes: Karen Nguyen / +19175552003 is Q-1003 and Q-1025.
- `events.jsonl`: quote_viewed, quote_sent, customer_replied, message_sent, quote_accepted.
  Duplicate `event_id`s. Timestamps not in file order.
- `last_contact_at` disagrees with events (e.g. Q-1005). Events win for activity; quotes are
  the catalog.

---

### 1 — Read, don't code
Read `Robby Takehome Assignment_Final.pdf`, `quotes.json`, and `events.jsonl`. Summarize: the
problem, five build requirements, three hard guardrails, required deliverables, and what they
are not grading. List every data quirk (duplicates, out-of-order events, `quote_sent` not in
the PDF, last_contact mismatches, two quotes sharing a phone). No application code.

### 2 — Design note
In chat (not a committed doc unless I ask): storage, event idempotency key, quote vs customer
identity, injected `now`, draft/approve/send/outbox states, how OutboxPort maps to Twilio/email
in production. Flag 3 judgment calls before coding.

### 3 — 3-hour cut + stack
Must-ship vs nice-if-time vs out of scope. The cut must still cover ingest, policy, drafting,
HITL send, a way to run, tests on risky bits, README. Default unless I override: TypeScript,
Node, SQLite, one tiny local UI or CLI. Justify why that is enough.

### 4 — Scaffold
Init package.json, TypeScript, test runner, SQLite, `src/` layout (ingest, policy, drafting,
outbox, api/ui), README stub with empty "how to run / policy / 50 shops / next day" headings.
No business logic. Seed files stay at repo root or `data/` behind one path constant.

### 5 — Types, clock, identity
Types for Quote and every event `type` in the seed (including `quote_sent`), optional
channel/direction. Required: event_id, quote_id, type, timestamp.

Inject `now` everywhere policy/cooldown need time. Demo default `2026-08-16T18:00:00Z`. Ban
`Date.now()` in policy/send.

Cooldown is by `customer_phone`; reasons are per quote. Named constants + a short comment.
Karen Nguyen is the fixture.

State machines in types/comments only: quote open|accepted|dismissed; draft
drafted|approved|rejected|sent|failed; outbox queued|sending|sent|failed with an idempotency
key.

### 6 — Ingest
JSONL parser: skip blanks, fail with line number on bad JSON. Insert-or-ignore on `event_id`.
Store original timestamp plus `ingested_at`. Quotes keyed by id; never invent quotes from
events. Missing quote_id: keep the event, warn, don't crash. Unknown types: store, don't
project. `loadSeed()` is rerunnable.

Tests: valid/blank/bad JSON; unique event_id count vs raw lines on the real seed.

### 7 — Project activity (events win)
Per-quote projection from the full event set, not file order, not `quotes.last_contact_at`:
first_sent_at, last_viewed_at, view_count, last_customer_reply_at, last_outbound_at,
last_accepted_at.

Status: max(JSON status, accepted if `quote_accepted` exists). Never un-dismiss/un-accept from
a view/reply. JSON last_contact_at is a hint only.

Customer index: `quotesForPhone`, `lastOutboundForPhone`.

Fixtures: Q-1004, Q-1009, Q-1005 (null last_contact but message_sent), Karen two quotes / one
phone. Reverse-order ingest must match. CLI: `npm run ingest`.

### 8 — Policy signals
`evaluate(now)` is a pure function of quotes, projections, outbox/drafts, now, config. Only
open quotes (`isMessageable`). Q-1004 / Q-1017 / Q-1009 never actionable even with later views.

MVP signals (attach every match):
- A viewed recently, no outbound after that view (VIEW_WINDOW ~48h)
- B large quote, no touch in N days or never contacted (LARGE_AMOUNT ~10000, STALE_DAYS ~3)
- C customer replied, we have not answered (highest priority)
- D repeat views then quiet (view_count >= 3; Q-1012)

Min age so brand-new zero-activity quotes are not spammed. Config in one file. Comment extra
signals you would add with more data; do not implement them.

### 9 — Rank, cooldown, suppress
Rank: C > A > D > B, then amount desc, then last-view recency.

Phone cooldown (~72h) on outbound or outbox sent/queued → suppressed with why, not omitted.
Q-1003 blocks Q-1025 and vice versa. Pending draft → suppressed as in-flight.

Policy never enqueues sends. Golden snapshot test at demo `now`. CLI: `npm run policy`.
Tests: accepted/dismissed excluded, phone cooldown, multi-reason, two values of `now`.

### 10 — Draft templates
Deterministic templates, not an LLM. Keyed by primary signal. First name, tech name, amount,
one CTA. Short, SMS default, ~320 chars. `draftFor(candidate, now)`. Never interpolate another
customer's fields.

### 11 — HITL drafts
Persist: id, quote_id, phone, body, channel, reasons, created_at, status `drafted`. One open
draft per quote so engine reruns do not duplicate.

List → edit (edit resets approval; cannot edit sent) → approve | reject. Approve does **not**
send. Rejected is dead; a later run may draft again if still eligible. Send accepts only
`approved`.

### 12 — Outbox send
`OutboxPort.send` with memory/file impl. Comment production (enqueue, provider, webhooks,
retry with same key). Idempotency key = `draft_id`. Already `sent` → no-op. Mark `sending` in
a transaction. Success updates draft, outbox, and outbound projection. Failure is retryable;
at most one provider success.

Send-time guards: still open, phone cooldown, no other in-flight, phone E.164-ish,
**stale-draft** if they replied after `draft.created_at`. Successes append-only.

### 13 — Engine job
`run(now)`: ingest if needed → evaluate → create missing drafts for top N (default 10). Never
auto-approve or auto-send. Decision log: drafted_because / suppressed_because.

One run surface only (HTTP **or** CLI): candidates, drafts, approve, reject, send, engine/run.

Happy path: run → draft → approve → send → one outbox row → second send no-op → phone
suppressed.

### 14 — Guardrail tests
Name tests after rules. Real seed plus synthetics. Temp SQLite, injected clock.

Must cover: duplicate events; ingest twice; reverse-order projections; never SMS
accepted/dismissed (including draft-then-accept); Karen cooldown; engine twice → one draft;
approve/send twice → provider once; provider throw then retry → one success; stale draft;
bad phone.

No 100% coverage. No UI or SQLite-itself tests.

### 15 — Demo app
One surface: local HTML + server **or** CLI. Ugly tables are fine. Boot loads seed. One
README command to install/run/open.

Screens: (1) ranked follow-ups, actionable vs suppressed; (2) draft review with reason/body
and a plain-English cooldown warning; (3) outbox log; (4) Run engine with editable `now`.
Refused sends error visibly. Never fail silent.

### 16 — Demo script
README: exact clicks/commands for a stable candidate (e.g. Q-1012) through send, then send on
Q-1004 must fail. Ingest → list → draft → approve → send → cooldown in under 3 minutes.

### 17 — README: how to run
Commands you actually ran: install, ingest, policy, app, test. What you chose not to test,
and why.

### 18 — README: policy and why
Four signals, thresholds tied to the seed (amount spread, Q-1012 view burst, Karen duplicate
phone), ranking, phone-level cooldown, events-over-JSON for last contact, stale-draft check.
Prose you can defend. No code required.

### 19 — README: 50 shops
~2 paragraphs, no code. Parent company, 50 shops, own quotes/phones/opinions. Tenant
isolation, per-shop policy config, from-numbers, no cross-shop cooldown collisions, staggered
rollout, audit. Engine stays a pure function of shop config + events. Point at seams you
already have (config, OutboxPort, clock), not a rewrite.

### 20 — README: where you stopped
Another day: quiet hours, delivery webhooks, template A/B, per-tech load, real Twilio, shop
admin config, conversion ranking. Be honest if something is incomplete.

### 21 — Tighten, don't expand
Grep for `Date.now()` in policy/send. Fix flaky tests. Delete dead code. Skim README for
claims the code does not support. If time remains, tighten tests and README — do not start
another feature.

### 22 — Git hygiene
Confirm `.gitignore` excludes `prompts.readme`, node_modules, SQLite files, `.env`. No
secrets in the tree.

### 23 — Conversation history
Export the coding-agent transcript with the deliverable (assignment requires it). Use of AI
is fine; you must be able to defend every README sentence and every policy threshold.

### 24 — Submit
Final commands: test, ingest, policy, run. Stop.
