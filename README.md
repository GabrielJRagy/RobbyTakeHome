# Follow-up engine

MVP for ranking quote follow-ups, drafting messages, and sending only after human approval. “Send” writes to a local outbox (SQLite + `outbox.jsonl`). There is no Twilio call.

Requires **Node 22** (`node:sqlite` is used with `--experimental-sqlite`). Demo clock is **`2026-08-16T18:00:00Z`** unless you pass `--now=`.

## How to run

Commands actually run for this submission:

```bash
npm install
npm test
npm run ingest
npm run policy
npm run engine
npm start
```

`npm start` loads the seed and prints all four screens. `npm run ingest` is rerunnable (second run inserts 0 extra events; 88 JSONL lines → 82 unique `event_id`s).

| Screen | Command |
| --- | --- |
| 1 Ranked follow-ups | `npm run policy -- --now=2026-08-16T18:00:00Z` |
| 2 Draft review | `npx tsx --experimental-sqlite src/app.ts drafts` |
| 3 Outbox | `npx tsx --experimental-sqlite src/app.ts outbox` |
| 4 Engine | `npm run engine -- --now=2026-08-16T18:00:00Z` |

`--now=` is the injected clock. Policy and send do not call `Date.now()`.

**Not tested, and why:** CLI table layout (`src/display.ts`); SQLite itself; the append-only `outbox.jsonl` file vs the table (the table is the source of truth); a real SMS provider; HTML/auth/deploy. Those are not where double-sends or accepted-quote texts hide. Guardrail tests cover ingest duplicates, projections, cooldown, stale drafts, and provider retries instead.

If you already completed the demo below, `followup.db` still has Q-1012 sent. Delete `followup.db` (and `outbox.jsonl`) to start clean.

## Demo script (under 3 minutes)

Stable candidate: **Q-1012** (Carl Dawson, $18,000, six views). Q-1004 is accepted and must refuse.

```bash
npm install
npm run ingest
npm run policy
npm run engine
npx tsx --experimental-sqlite src/app.ts drafts
npx tsx --experimental-sqlite src/app.ts approve Q-1012
npx tsx --experimental-sqlite src/app.ts send Q-1012
npx tsx --experimental-sqlite src/app.ts send Q-1012
npx tsx --experimental-sqlite src/app.ts outbox
npx tsx --experimental-sqlite src/app.ts draft Q-1004
npm run policy
```

What you should see:

1. **ingest** — 30 quotes, 82 unique events.
2. **policy** — Q-1012 on the list (D+B: repeat views + large/stale). After a draft exists it may sit under SUPPRESSED as in-flight; that is still “listed,” not dropped.
3. **engine** — drafts top 10, does not approve or send. Q-1012 already drafted is not duplicated.
4. **approve Q-1012** — status `approved`. No outbox row yet.
5. **send Q-1012** — one `sent` outbox row to `+19175552012`.
6. **send Q-1012** again — `"noop": true`, still one outbox row.
7. **draft Q-1004** — `SEND REFUSED` / `not_actionable`. Accepted quotes are never messaged. (Q-1009 dismissed is the same story.)
8. **policy** again — Q-1012 is not actionable; a new send to that phone would hit the 72h cooldown.

`approve` / `send` accept a quote id (`Q-1012`) or a draft UUID.

## Follow-up policy and why

Only **open** quotes are messageable. JSON status is the floor; a `quote_accepted` event can raise a quote to accepted. Views and replies never un-dismiss or un-accept. That is why **Q-1004** and **Q-1017** stay out of the queue even after later views, and **Q-1009** stays out after a later reply.

Activity comes from **events**, not `quotes.last_contact_at`. The catalog field is often null or a timestamp that is not in the stream (Q-1005 has `last_contact_at: null` and a `message_sent`). File order is ignored; timestamps are. `quote_sent` is the original quote delivery (`first_sent_at`). Follow-up outbound is `message_sent` (`last_outbound_at`). Cooling down on `quote_sent` would silence almost every new quote for 72h.

Four signals, every match attached, ranked **C > A > D > B**, then amount descending, then last view:

- **C — unanswered reply.** Highest cost of silence. In this seed: Q-1016, Q-1007, Q-1015. If we already `message_sent` after the reply, C does not fire.
- **A — viewed in the last 48h with no follow-up after that view.** 48h is “looked yesterday / this morning.” It still catches Q-1026’s view at 16:00 when `now` is 18:00 the same day, and it does **not** steal Q-1012’s older burst (~72h before demo `now`).
- **D — three or more views, still no follow-up after the last one.** Q-1012 has six views. Threshold 3 is “more than a couple of opens,” not a one-off tap.
- **B — amount ≥ $10,000 and last follow-up (or else first `quote_sent`) older than 3 days.** Seed amounts run $420–$22,000; $5,200 is the mid cluster, $10k is the start of the big jobs. Brand-new zero-activity quotes wait 24h so B does not spam a job the tech just wrote.

**Cooldown is the phone, not the quote, for 72h** after a follow-up send or a queued/sent outbox row. Karen Nguyen is Q-1003 and Q-1025 on `+19175552003`. Texting either one quiets the other. Reasons stay per quote (Q-1025 can still be “viewed recently”). Pending drafts are in-flight for that phone so the engine does not stack sends.

**Stale-draft:** if they reply after `draft.created_at`, send is refused. The text on screen is no longer the conversation they are in. Write a new draft.

Policy never enqueues a send. A human approves, then send runs the same guards again.

## 50 shops

A parent company with 50 shops is the same engine fifty times, not a rewrite. Each shop owns its quotes, customer phones, and opinion of “follow up” (48h vs 72h views, $10k vs $5k “large,” 72h vs 24h cooldown). Isolation is the first product rule: shop A’s events, drafts, and outbox never mix with shop B’s, and cooldown is `(shop_id, phone)` so two homeowners who happen to share a number across towns do not silence each other. From-numbers are per shop; a Daytona Beach line must not send as a Tampa line. Rollout is staggered (config + audit log on, auto-draft on, HITL send on) because a bad template at 50 shops is 50 complaint queues.

The seams already in this repo are the whole expansion. `POLICY_CONFIG` is already one object: clone it per shop. `evaluate(now)` and `run(now)` stay pure functions of that config plus that shop’s events. `OutboxPort` is where Twilio (or email) and the from-number live; the engine still only writes an outbox row with `draft_id` as the idempotency key. The injected clock is how quiet hours and “run Monday 8am shop-local” attach later without `Date.now()` leaking in. Audit is the decision log we already print (`drafted_because` / `suppressed_because`) plus append-only sent rows. Tenant is a column (or a database) around those tables, not a new policy language.

## What I'd build next

Honest leftovers: the surface is CLI tables, not a local HTML app; SQLite is Node’s experimental `node:sqlite`; `followup.db` is a single-shop file. Quiet hours, delivery webhooks (`delivered` / `bounced` as events), template A/B, per-tech daily send caps, a real Twilio `OutboxPort`, shop-admin config UI, and ranking by historic conversion are a day of work on the same seams — I would not start them by forking `evaluate`.

Incomplete on purpose: no auth, no deploy, no 100% coverage, no tests of the table formatter or SQLite itself. If a reviewer walks the README demo after a previous send, Q-1012 is already on cooldown until `followup.db` is deleted. That is the product behaving, not a bug.
