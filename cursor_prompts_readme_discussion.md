# Prompts readme discussion
_Exported on 10/26/2026 at 13:35:15 EDT from Cursor (3.20.21)_

---

**User**

 @prompts.readme (22-25) 

---

**Cursor**

I'll read the assignment PDF and the two data files, then summarize the problem, requirements, guardrails, deliverables, and data quirks.

I'll compute event-type counts, duplicate IDs, timestamp order, and last-contact mismatches against the quote catalog.

## Problem

Home-service techs send quotes that sit open. Homeowners view, reply, or ghost. Follow-up is currently a shop owner scrolling ~60 open quotes and texting from memory. Deals die from late or missed contact.

The MVP is an automated follow-up engine: decide **who** and **when**, **draft** a message, then **send only after human approval**. There is no real SMS/email; “send” writes to an outbox, designed as if a provider sits behind it. Time budget is **3 hours**.

Seed: 30 quotes (`Q-1000`–`Q-1029`) and 88 JSONL event lines.

---

## Five build requirements

1. **Ingest** events into storage you choose.
2. **Follow-up policy** for a given “now”: prioritized candidates with reasons (examples: recent view with no response; large quote with no contact in N days; plus other signals you would look for, documented).
3. **Message drafting**.
4. **HITL** draft → approve → send.
5. **A way to run / display** the work (localhost is fine).

---

## Three hard guardrails

- Never message the same **customer** twice inside a cooldown window.
- Never message an **accepted** or **dismissed** quote.
- Re-running the engine or retrying a failed send must **never double-send**.

---

## Required deliverables

- The code
- Coding-agent conversation history
- Tests on what you consider risky (not 100% coverage)
- README: how to run; follow-up policy and why; ~2 paragraphs (no code) on a parent company with 50 shops; what you’d build with another day

---

## What they are not grading

UI, deployment, auth, and framework choice. They **are** grading messy-input correctness, send guardrails, quote/message state, and README judgment. AI is allowed; you must still defend the submission.

---

## Data quirks

**Duplicates.** 88 lines, **82 unique `event_id`s**. Six identical replay pairs:

| `event_id` prefix | type | quote | timestamp | lines |
|---|---|---|---|---|
| `5487fd4f` | `quote_viewed` | Q-1029 | 2026-08-07T20:00:00Z | 9, 34 |
| `98326856` | `quote_sent` | Q-1014 | 2026-08-08T02:00:00Z | 10, 77 |
| `3d1a85dd` | `quote_viewed` | Q-1015 | 2026-08-10T17:00:00Z | 23, 87 |
| `f42d47cc` | `quote_sent` | Q-1000 | 2026-08-08T03:00:00Z | 48, 61 |
| `e623a689` | `customer_replied` | Q-1020 | 2026-08-12T13:00:00Z | 49, 83 |
| `3c835dc0` | `customer_replied` | Q-1009 | 2026-08-10T05:00:00Z | 50, 62 |

**Out of order.** Timestamps are not file order. First line is `2026-08-12`, last line is `2026-08-11`; stream min/max is `2026-08-01T15:00:00Z` … `2026-08-16T16:00:00Z`.

**`quote_sent` is not in the PDF.** The assignment lists `quote_viewed`, `customer_replied`, `message_sent`, `quote_accepted`. The seed also has **32 `quote_sent`** events (most common after views). Unique-type counts: 38 viewed, 32 `quote_sent`, 11 replied, 6 `message_sent`, 1 `quote_accepted`. `created_at` generally matches first `quote_sent`.

**`last_contact_at` disagrees with events.** Treat the JSON field as a stale hint; events win.

- **Q-1005** (called out): `last_contact_at` is `null`, but `message_sent` exists at `2026-08-08T09:00:00Z` (plus `quote_sent` at created time).
- **Q-1012**: also `null` despite `message_sent` `2026-08-07T01:00:00Z` and six views.
- **`message_sent` later than `last_contact_at`:** Q-1002 (`08-08T18:00` vs send `08-13T21:00`), Q-1019 (`08-11T02:00` vs send `08-14T14:00`), Q-1027 (`08-08T08:00` vs send `08-10T04:00`).
- **Q-1020:** `last_contact_at` `08-13T17:00` is **after** `message_sent` `08-12T19:00` and matches **no** event.
- **Null `last_contact_at` with only `quote_sent` (no `message_sent`):** Q-1000, Q-1001, Q-1010, Q-1015, Q-1018, Q-1024, Q-1025, Q-1028.
- **Non-null `last_contact_at` that matches no event timestamp** on that quote (and is not last `quote_sent` / `message_sent`): Q-1003, Q-1004, Q-1006–Q-1009, Q-1011, Q-1013, Q-1014, Q-1016, Q-1017, Q-1021–Q-1023, Q-1026, Q-1029. In this seed, **no** `last_contact_at` equals an event timestamp.

**Two quotes, one phone.** **Karen Nguyen** / `+19175552003` is **Q-1003** (created `08-01`, `last_contact_at` set) and **Q-1025** (created `08-10`, `last_contact_at` null). Cooldown is by customer, not by quote. Phones otherwise look sequential; `+19175552025` is unused because Q-1025 reused `2003`.

**Other catalog vs event mismatches (same messy-input class):**

- Status: 27 open, **accepted Q-1004 and Q-1017**, **dismissed Q-1009**.
- Only **Q-1004** has a `quote_accepted` event (`08-10T07:00`). **Q-1017 is accepted in JSON with no accept event.** Q-1004 still has **views after accept** (`08-11`, `08-14`). Q-1009 still has a **view after dismiss** (`08-15`).
- Every quote has at least one event; no orphan `quote_id`s.
- Optional fields: `message_sent` carries `channel` + `direction: outbound`; `customer_replied` carries `channel` (`sms` or `email`).

---

**User**

@prompts.readme:28-30 

---

**Cursor**

Design note only — nothing committed.

## Storage

SQLite, one local file. Quotes, events, projections, drafts, and outbox live in the same DB so ingest, policy, and send share one transaction boundary.

- **quotes**: catalog from `quotes.json`, keyed by `id`. Never invented from events.
- **events**: append-only. Original `timestamp` plus `ingested_at`. `INSERT OR IGNORE` on `event_id`.
- **projections**: derived from the full event set, not file order, not `last_contact_at`. Rebuildable; events remain source of truth.
- **drafts / outbox**: persisted so a second engine run or a retry does not create a second send.

Rationale: the seed is tiny, but the shape matches “webhook stream + catalog + outbox,” and tests can use a temp file.

## Event idempotency key

**`event_id`.** Duplicates in the seed are byte-identical replays of the same id. Deduping on `(quote_id, type, timestamp)` would be wrong if two real views shared a second; the id is the webhook delivery key.

Unknown types are stored, not projected. Missing `quote_id` is kept with a warning. Quotes are never created from events.

## Quote vs customer identity

- **Quote** (`Q-1004`, `Q-1009`, …) is the unit of **status, reasons, and drafts**. Accepted/dismissed is per quote. A draft is “about this quote.”
- **Customer** is **`customer_phone`**. Cooldown, “already in-flight,” and “do not double-text Karen” are phone-level.

Karen Nguyen is the fixture: **Q-1003 and Q-1025 share `+19175552003`**. Outbound or queued/sent outbox on either quote suppresses the other. Reasons still attach to the quote that matched (e.g. Q-1025 viewed recently).

Name is display-only. Phone is the identity we can actually cool down on.

## Injected `now`

Policy, cooldown, stale-draft, and “viewed recently” take **`now` as an argument**. Demo default **`2026-08-16T18:00:00Z`** (after the latest seed event, `2026-08-16T16:00:00Z`).

`Date.now()` is banned in policy and send so ranking, golden snapshots, and “what if we ran tomorrow” are deterministic. The clock is a seam for 50 shops / quiet hours later.

## Draft / approve / send / outbox states

**Quote:** `open | accepted | dismissed`. JSON status is the floor; a `quote_accepted` event can raise to accepted. Views/replies never un-dismiss or un-accept.

**Draft:** `drafted → approved | rejected`. Approve does **not** send. Rejected is terminal for that row; a later engine run may create a new draft if still eligible. Edit resets approval. Sent drafts are frozen. Failed is a send outcome on the draft after the provider errors (retryable until one success).

One **open** draft per quote (`drafted` or `approved`) so reruns do not stack copies.

**Outbox:** `queued → sending → sent | failed`, with idempotency key **`draft_id`**. Send is allowed only from **`approved`**. Already `sent` is a no-op. Mark `sending` in a transaction before the provider call so two workers cannot both succeed. Success updates draft, outbox, and outbound projection together. At most one provider success per key.

Send-time checks (not only policy-time): quote still open, phone cooldown, no other in-flight for that phone, phone looks E.164, **stale-draft** if they replied after `draft.created_at`. Policy never enqueues sends.

## OutboxPort → Twilio / email in production

```
OutboxPort.send({ idempotencyKey: draft_id, to, channel, body })
```

Local impl: memory or a table/file append. Production:

1. Insert outbox `queued` with `draft_id` as the idempotency key (unique).
2. Worker flips `sending`, calls Twilio (SMS) or the email API with **that same key** so their side also dedups.
3. Success → `sent` + store provider message id. Failure → `failed`, retry with the **same** key.
4. Delivery webhooks (`delivered` / `bounced` / inbound) are later events; they must not create a second outbound.

The port is the shop-specific from-number / provider seam. The engine stays a pure function of config + events + `now`; it does not know Twilio.

---

## Three judgment calls (before coding)

**1. `quote_sent` vs `message_sent` for “last outbound.”**  
The PDF never mentions `quote_sent`. I will treat **`quote_sent` as catalog delivery** (usually equals `created_at`) and **`message_sent` as follow-up outbound** for cooldown and “have we answered.” Cooldown therefore keys off follow-up sends plus our own outbox, not the original quote email. If `quote_sent` also cooled down the phone, brand-new quotes would be silenced for 72h and the seed would be mostly empty. *Risk:* if Robby considers the quote itself a contact, Q-1005-style `message_sent` is still the activity clock, but initial send would start cooldown.

**2. Accepted-in-JSON with no `quote_accepted` event (Q-1017).**  
Status = **max(JSON status, accepted if the event exists)**. Q-1017 stays accepted; we never un-accept from later views. We do **not** invent a `quote_accepted` row. *Risk:* if JSON is as stale as `last_contact_at`, we might over-suppress — safer than texting an accepted job.

**3. Policy ranks and drafts; humans send.**  
`evaluate(now)` returns actionable + suppressed (with why). The engine job creates missing drafts for top N; it never auto-approves or auto-sends. Phone cooldown **suppresses with a reason**, it does not drop the row. *Risk:* extra HITL friction vs a “just text them” owner; matches the assignment and the double-send guardrail.

If you want a different call on (1) — cooling down on `quote_sent` too — say so before scaffold.

---

**User**

@prompts.readme (33-35) Lets do CLI

---

**Cursor**

**Stack (your override):** TypeScript, Node, SQLite, **CLI only**. No local HTML UI.

That is enough because they grade messy ingest, send guardrails, quote/message state, and README judgment — not UI or framework. A CLI can run the full loop (`ingest` → `policy` → `draft` → `approve` → `send` → `outbox`) and dump ranked tables. Outbox stays a port; Twilio is a comment.

---

## Must-ship (covers the assignment)

| Slice | What ships |
|---|---|
| **Ingest** | JSONL + quotes into SQLite. `event_id` idempotency. Events win for activity. |
| **Policy** | `evaluate(now)`: open quotes only; signals A–D; rank; phone cooldown as suppressed-with-why, not omitted. |
| **Drafting** | Deterministic templates by primary signal. One open draft per quote. |
| **HITL send** | List / edit / approve / reject / send. Approve ≠ send. `OutboxPort` + `draft_id` idempotency. Send-time guards including stale-draft. |
| **Way to run** | One install command + CLI: `ingest`, `policy`, `engine`, `drafts`, `approve`, `reject`, `send`, `outbox`. Injected `now` (default `2026-08-16T18:00:00Z`). |
| **Tests (risky bits)** | Dup events, ingest twice, reverse-order projection, never SMS accepted/dismissed, Karen cooldown, engine twice → one draft, approve/send twice → provider once, provider throw then retry → one success, stale draft, bad phone. |
| **README** | How to run (commands you actually ran); policy and why; 50 shops; where you stopped. Plus a 3-minute demo script on a stable candidate (e.g. Q-1012) and a refused send on Q-1004. |

Conversation history goes in with the deliverable.

---

## Nice-if-time (only after must-ship is defensible)

- Edit-draft in CLI (reset approval); if skipped, approve the template as-is.
- Golden snapshot of `policy` at demo `now`.
- Decision log lines: `drafted_because` / `suppressed_because`.
- File-backed outbox in addition to SQLite (SQLite row is the real outbox).
- Extra README polish: exact click-equivalents as copy-paste command blocks.

Do **not** start these if tests/README are still thin.

---

## Out of scope

- Local HTML/CSS, SPA, auth, deploy, real Twilio/SendGrid.
- LLM drafting, A/B templates, quiet hours, delivery webhooks, per-tech load, shop admin UI.
- 100% coverage, testing SQLite itself, testing the CLI argv parser as UI.
- Multi-tenant runtime (README only; seams: config, `OutboxPort`, clock).
- Treating `quote_sent` as cooldown outbound (judgment call from the design note).
- Inventing quotes from events; un-accepting/un-dismissing from views.

---

## Why this cut still looks like a complete take-home

The assignment’s five build items and three guardrails are all on the CLI path. A reviewer can `npm test`, `npm run ingest`, `npm run policy`, then walk Q-1012 to an outbox row and see Q-1004 refused — under 3 minutes, no browser. Time saved on UI goes to idempotency, Karen’s shared phone, and README that you can defend.

---

**User**

@prompts.readme:38-40 A lot of the file structure is there already

---

**Cursor**

I'll inspect the existing layout, then fill in the scaffold (package, TypeScript, tests, SQLite, README stub) without adding business logic.

Existing `src/` stubs and a bare `package.json` are in place. I'll wire TypeScript, a test runner, SQLite, path constants, and a README stub—no business logic.

`better-sqlite3` segfaulted on this Node build, so I’ll switch the DB layer to something that loads cleanly.

Scaffold is in place on top of the empty `src/` files. No policy, ingest, or send logic yet.

**Kept:** `src/ingest.ts`, `policy.ts`, `drafts.ts`, `outbox.ts`, `app.ts`. Seed stays at repo root (`quotes.json`, `events.jsonl`).

**Added:**
- TypeScript (`tsconfig.json`), `tsx`, Node’s test runner
- SQLite via `node:sqlite` (`src/db.ts`) — `better-sqlite3` segfaulted on this Node 22 build
- One path constant in `src/paths.ts` (`QUOTES_PATH`, `EVENTS_PATH`, `DB_PATH`)
- `src/drafting.ts` (templates) vs existing `drafts.ts` (HITL records)
- CLI entry in `src/app.ts` (no HTTP UI)
- `README.md` with the four empty headings
- `.gitignore`: `node_modules`, SQLite files, `.env`, `prompts.readme`

`npm test` (2 passing) and `npm start` (usage) both run. Commands `ingest` / `policy` / `engine` still exit “not implemented” until the next steps.

---

**User**

 @prompts.readme:42-55 BTW, read the @prompts.readme - at what point are we cleansing data?

---

**Cursor**

I'll implement types, clock, and identity, and check the prompt series for where messy seed data is handled versus stored as-is.

There is no dedicated cleanse step: ingest stores the messy stream, and later projection/policy interpret it. I'll add types, an injected clock, and phone-level identity next.

We never cleanse the seed into a tidy dataset. Messy input is the product.

**Step 6 (ingest)** is only parser hygiene: skip blank lines, fail on bad JSON with a line number, `INSERT OR IGNORE` on `event_id`. Original timestamps stay. Unknown types and missing `quote_id`s are kept. Quotes are not invented or rewritten. `last_contact_at` is not “fixed.”

**Step 7 (project)** is where a consistent activity picture is *derived*: events win, file order does not, JSON `last_contact_at` is a hint. Status can only stay or become accepted if the event exists; views do not un-dismiss.

**Steps 8–9 / 12** decide (not messageable, cooldown, stale draft). They do not edit history.

If someone “cleansed” duplicates and sorted timestamps up front, the idempotency and reverse-order tests would be fake.

---

Types/clock/identity are in place (no ingest logic yet):

- `src/types.ts` — `Quote`, every seed event type including `quote_sent`, optional channel/direction, required `event_id` / `quote_id` / `type` / `timestamp`. Draft and outbox machines in comments only.
- `src/clock.ts` — injected `now`, `DEMO_NOW = 2026-08-16T18:00:00Z`. Policy/send comments ban `Date.now()`.
- `src/config.ts` — `COOLDOWN_HOURS = 72` on `customer_phone`; reasons stay per quote. Karen `+19175552003` / Q-1003 + Q-1025.

---

**User**

@prompts.readme:56-62 Justify why this is necessary to cover with tests

---

**Cursor**

I'll implement ingest and add those tests because they lock the messy-input contract the rest of the engine depends on. Checking the current modules first.

Those ingest tests are necessary because **policy will treat whatever ingest stored as history**. A silent parse bug here looks like a “smart” follow-up later.

**Valid JSON.** Confirms the happy path actually yields `event_id` / `quote_id` / `type` / `timestamp` (and optional channel/direction). If this is wrong, every projection is fiction.

**Blank lines.** Real JSONL dumps have them. If a blank became a record, you invent empty events; if it aborted the file, you drop the tail of the webhook stream. Skipping is the only safe behavior, and it is easy to get wrong with `split("\n")`.

**Bad JSON + line number.** A truncated webhook line must fail loud on that line, not skip the rest or crash with a stack that does not point at `events.jsonl:62`. Without the line number, “messy input” is undebuggable.

**Unique `event_id` vs raw lines on the real seed (88 → 82).** This is the assignment’s duplicate stream. Inserting all 88 would double Q-1029 views, Q-1014 sends, Q-1020 replies, etc., and cooldown/view-count signals would fire on ghosts. Re-running `loadSeed` and asserting **0 new inserts / still 82** is the same guard as “retry must never double-send,” one layer down. A `Set` in a one-off script does not prove `INSERT OR IGNORE` survived a second boot.

We do **not** test SQLite itself, and we do not “cleanse” the seed. Ingest stores duplicates as ignored, unknown types as rows, missing `quote_id` as null + warning.

`loadSeed()` is rerunnable; `npm run ingest` wrote 30 quotes and 82 events. Projection is next.

---

**User**

Based on the diff, return a one sentence commit message on what's done

---

**Cursor**

Add a TypeScript CLI scaffold that idempotently ingests the quote catalog and messy event stream into SQLite without inventing quotes or double-counting duplicate `event_id`s.

---

**User**

@prompts.readme:64-76 

---

**Cursor**

I'll project activity from the full event set (events win, not file order or `last_contact_at`) and lock the named fixtures with tests.

Activity is now projected from the **full event set** (timestamps, not file order, not `last_contact_at`). Unknown types are ignored. `quote_sent` is `first_sent_at`; follow-up `message_sent` is `last_outbound_at`.

**Status:** dismissed stays dismissed; accepted stays accepted; `quote_accepted` can raise open → accepted. Views/replies never reopen a quote.

**Fixtures (also printed by `npm run ingest`):**
- **Q-1004** accepted, 3 views including after accept, no follow-up send
- **Q-1009** dismissed despite later view + reply
- **Q-1005** JSON `last_contact_at` is null; `last_outbound_at` is `2026-08-08T09:00:00Z`
- **Karen** `+19175552003` → Q-1003 and Q-1025; shared `lastOutboundForPhone` is null (no `message_sent`)

Reverse-order ingest matches file-order projection. Policy is next.

---

**User**

@prompts.readme:77-98 

---

**Cursor**

I'll implement `evaluate(now)` as a pure function: signal matching, rank, phone cooldown, and suppress-with-why—no sends.

`evaluate(now)` is a pure function: it ranks and suppresses, and it never enqueues a send. Only projected **open** quotes are eligible, so Q-1004 / Q-1017 / Q-1009 never appear even with later views.

**Signals** (every match is attached): **C** unanswered reply, **A** view in 48h with no follow-up after it, **D** ≥3 views still unanswered (Q-1012), **B** amount ≥ $10k and last follow-up/`quote_sent` older than 3 days. Brand-new zero-activity quotes wait 24h before B. Rank: **C > A > D > B**, then amount, then last view.

**Cooldown** is by phone (72h on `message_sent` or queued/sent outbox). A pending draft is in-flight for the whole phone, so Q-1003 blocks Q-1025. Cooldown rows stay on the list with `suppressedBecause`.

At demo now the golden list is 13 actionable, 0 suppressed. `npm run policy` (optional `--now=`). Drafting is next.

---

**User**

How can I test everything from the cli

---

**Cursor**

From the repo root, after `npm install`:

**Automated suite (ingest, projections, policy)**  
```bash
npm test
npx tsc --noEmit
```

One file or one name:  
```bash
npx tsx --experimental-sqlite --test tests/policy.test.ts
npx tsx --experimental-sqlite --test --test-name-pattern="golden" tests/policy.test.ts
```

**Manual CLI (what exists today)**  
```bash
npm start                          # usage
npm run ingest                     # 30 quotes, 82 unique events, fixture projections
npm run policy                     # ranked list at 2026-08-16T18:00:00Z
npm run policy -- --now=2026-08-16T12:00:00Z
```

Second ingest should show `"eventsInserted": 0` and still `"uniqueEventIds": 82`. Policy at the later `now` should list Q-1026 as `A+B`; at `12:00` it should be `B` only. Q-1004 / Q-1017 / Q-1009 must not appear.

**Not wired yet:** `npm run engine`, drafts, approve, send. Those still exit `command not implemented`.

---

**User**

 @prompts.readme:99-120 

---

**Cursor**

I'll implement templates, HITL draft persistence, and guarded outbox send, then wire CLI commands so the loop can be exercised without an engine job yet.

Templates, HITL drafts, and guarded send are in. Approve still does not send. Policy never enqueues.

**Templates** (`draftFor`): primary signal C/A/D/B, first name + tech + amount + one CTA, SMS, ≤320 chars. Mixing another quote’s fields throws.

**Drafts:** one open row per quote (`drafted` / `approved`). Edit resets approval; sent is frozen. Reject is terminal; a later `ensureDraft` can create a new row.

**Send:** `OutboxPort` (memory + append-only `outbox.jsonl`). Idempotency key = `draft_id`. Already `sent` → no-op. Mark `sending` in a transaction. Success updates draft, outbox, and a `message_sent` event. Provider failure is retryable; at most one success. Guards: still open, 72h phone cooldown, no other in-flight, E.164-ish phone, **stale-draft** if they replied after `draft.created_at`. Refused sends print the error code (not silent).

CLI loop for Q-1012:

```bash
npx tsx --experimental-sqlite src/app.ts draft Q-1012
npx tsx --experimental-sqlite src/app.ts drafts
npx tsx --experimental-sqlite src/app.ts approve <draft-id>
npx tsx --experimental-sqlite src/app.ts send <draft-id>
npx tsx --experimental-sqlite src/app.ts send <draft-id>   # no-op
npx tsx --experimental-sqlite src/app.ts draft Q-1004      # fails: not actionable
```

Engine auto-draft of top N is next.

---

**User**

@prompts.readme:121-138 

---

**Cursor**

I'll add `run(now)` (ingest → evaluate → draft top N, never auto-send) and name the remaining guardrail tests after the rules.

`run(now)` ingests, evaluates, and creates missing drafts for the top **10** actionable quotes. It never auto-approves or auto-sends. The log is `drafted_because` / `suppressed_because`.

CLI is the only surface: candidates, drafts, approve, reject, send, engine.

**Happy path**

```bash
npm run engine
npx tsx --experimental-sqlite src/app.ts drafts
npx tsx --experimental-sqlite src/app.ts approve <draft-id>   # pick Q-1012
npx tsx --experimental-sqlite src/app.ts send <draft-id>
npx tsx --experimental-sqlite src/app.ts send <draft-id>     # no-op
npx tsx --experimental-sqlite src/app.ts outbox
npm run policy                                               # Q-1012 off actionable; phone on cooldown
```

Guardrail tests in `tests/guardrails.test.ts` are named after the rules: duplicate events, ingest twice, reverse-order projections, never SMS accepted/dismissed (including draft-then-accept), Karen cooldown, engine twice → one draft per quote, approve/send twice → provider once, provider throw then retry, stale draft, bad phone. 40 tests passing. Demo UI/README is next.

---

**User**

@prompts.readme:140-147 

---

**Cursor**

I'll turn the CLI into the demo surface: four readable screens, seed loaded on boot, refused sends visible, and one README command to run it.

The demo surface is the **CLI**. Boot loads the seed. One command:

```bash
npm install && npm start
```

That prints all four screens at demo `now` (`2026-08-16T18:00:00Z`). Change the clock with `npm start -- --now=2026-08-14T12:00:00Z`.

| Screen | What you see |
| --- | --- |
| 1 | Ranked follow-ups: actionable vs suppressed (suppressed stay on the list with why) |
| 2 | Draft review: reasons, body, plain-English cooldown / in-flight warning |
| 3 | Outbox log |
| 4 | How to run the engine with an injected `--now` (never auto-approve or auto-send) |

Refused sends print a `SEND REFUSED` block with an English reason, then exit 1. They do not fail silent.

`npm run policy`, `drafts`, `outbox`, and `npm run engine -- --now=...` are the same screens one at a time.

---

**User**

@/Users/gabrielragy/.cursor/projects/Users-gabrielragy-Downloads-seed/terminals/1.txt:724-730 What is D+B?

---

**Cursor**

**D+B** are the two policy signals that matched Q-1012, joined with `+` because every match is attached (not just the primary).

- **D** — repeat views, then quiet (`view_count >= 3`). Q-1012 is the fixture: six views, last one about 72h before demo `now`, and no follow-up after that burst.
- **B** — large quote (`>= $10k`) with no recent touch. Q-1012 is $18,000.

Rank uses the **primary** only: **D > B**, so it would sort as a D. The `/ a draft or send is already in flight…` part is why it is **suppressed** (there is already an open draft for that phone), not a third signal.

---

**User**

Why are they named that way? 

---

**Cursor**

They are named **A / B / C / D** because that is how the take-home prompt labeled the four MVP signals, not because the letters mean something in the data.

The prompt listed them in this order:

- **A** — viewed recently, no outbound after that view  
- **B** — large quote, no touch in N days (or never contacted)  
- **C** — customer replied, we have not answered  
- **D** — repeat views, then quiet (Q-1012)

Ranking is **not** alphabetical. It is **C > A > D > B** (unanswered reply first, then recent view, then view-burst, then large/stale). Using the prompt’s letters keeps the golden snapshot, logs, and `D+B` compact. The CLI still prints the English next to the letter (`they opened the quote several times…`).

If this were a shop-facing product we would drop the letters and show only those phrases.

---

**User**

@prompts.readme:148-159 

---

**Cursor**

I'll write the README demo, how-to-run, and policy sections from commands I actually run, and let `approve`/`send` take a quote id so the Q-1012 path is copy-pasteable.

README now has the demo script, how to run, and policy write-up. Those commands were actually run (`npm test`, `ingest`, `policy`, `engine`, Q-1012 approve/send/send, Q-1004 refuse).

**Demo (copy-paste):** ingest → policy → engine → `approve Q-1012` → `send Q-1012` → send again (`noop`) → `draft Q-1004` fails with `SEND REFUSED` / `not_actionable`. `approve`/`send` take a quote id so you do not have to copy a UUID.

**How to run:** `npm install && npm start`, plus the commands above. Not tested: table layout, SQLite itself, real Twilio, HTML — those are not the double-send / accepted-quote risks.

**Policy:** C > A > D > B; 48h view window vs Q-1012’s ~72h burst; $10k / 3-day stale from the amount spread; 72h cooldown by **phone** (Karen = Q-1003 + Q-1025); events beat `last_contact_at`; stale-draft if they reply after the draft was written.

50 shops and “what I’d build next” are still empty.

---

**User**

@prompts.readme:161-178 

---

**Cursor**

I'll fill the 50-shops and “where we stopped” README sections, then tighten the tree: no `Date.now()` in policy/send, drop dead code, and confirm `.gitignore`.

README now has the 50-shops story and an honest stop line. Hygiene and tighten are done.

**50 shops.** Same engine, 50 times: tenant isolation, per-shop `POLICY_CONFIG`, from-numbers on `OutboxPort`, cooldown keyed by `(shop, phone)`, staggered rollout, audit via `drafted_because` / `suppressed_because`. `evaluate(now)` stays a pure function of shop config + events + clock — not a rewrite.

**Where we stopped.** CLI not HTML; experimental `node:sqlite`; no quiet hours, webhooks, A/B, tech caps, real Twilio, or conversion ranking. Demo leftover: if Q-1012 was already sent, delete `followup.db` to replay.

**Tighten.** No `Date.now()` in policy/send (comments only). Dropped the SQLite-itself smoke test. Draft review no longer says “another send is in flight” about **its own** draft. README does not claim Twilio or a web UI.

**Git.** `.gitignore` has `prompts.readme`, `node_modules`, `*.db` plus WAL/SHM, `.env`, `outbox.jsonl`. No secrets in the tree. `followup.db` is untracked.

Conversation export (assignment requirement) is the remaining submit step.

---

**User**

Nice. Let's make a web ui on top of all of this work that is lightweight and easily resettable. Make sure there is a toggle at the top right for dark/light mode. We should be ablet to see quotes, and events in tables within the web-app. Single page. Make sure there is a restart button that appears once we start with the injest flow that let's us start the entire app fresh for retesting

---

**Cursor**

I'll add a single-page web UI with quotes/events tables, a dark/light toggle, and a reset control that shows after ingest. Checking the current server surface and how ingest is wired.

The app is a single page at **http://127.0.0.1:3456** (`npm start`). It starts empty; the engine logic is unchanged underneath.

**Header:** dark/light toggle on the right (saved in `localStorage`). **Restart** stays hidden until ingest has run, then wipes `followup-web.db` so you can retest from zero.

**On the page:** injected `now`, Ingest / Run engine, follow-ups, drafts (approve / send / reject), outbox, plus **Quotes** and **Events** tables (30 / 82 after ingest). Refused sends show a `REFUSED` banner.

Verified in the browser: ingest → quotes/events populate → Restart appears → engine drafts 10 → approve/send writes one outbox row → theme flips to dark → Restart clears everything and hides itself again. CLI still uses `npm run cli`; the web DB is separate from `followup.db`.

---

**User**

Nice. Let's cleanup the codebase for anything unused, and tidy up the readme now that we have the web

---

**Cursor**

I'll scan for unused modules and exports, then rewrite the README so the web UI is the main way to run the app.

Removing the leftover CLI surface, collapsing to one database path, and tightening exports and the README around the web app.

Removed the leftover CLI (`src/app.ts`, `src/display.ts`, and the `ingest` / `policy` / `engine` / `cli` scripts). The app is web-only: `npm start` → http://127.0.0.1:3456.

The UI and default `openDb()` now share one file, `followup.db`. **Restart** wipes that plus `outbox.jsonl`. Helpers that nothing imported (`formatAmount`, `parseNow`, `SIGNAL_RANK`, `matchSignals`, and a few projection internals) are no longer exported.

README is web-first: install/test/start, the Q-1012 demo on the page, policy, 50 shops, and next. CLI commands and the dual-database note are gone.

`npx tsc --noEmit` and `npm test` (39 tests) both pass.

---

**User**

should @prompts.readme be a .md file? 

---

**Cursor**

Yes, if you want it to preview like Markdown. It already *is* Markdown (`#` headings, lists, `---` breaks). `.readme` is just an unusual suffix, so most editors and GitHub treat it as plain text.

Keep the name `prompts.readme` if you like it as a private working file that is not the project README. It is already gitignored, so reviewers never see it either way.

I would not rename it unless you care about preview. The take-home README is `README.md`; this file is the prompt series, not a deliverable.

