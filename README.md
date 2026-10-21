# Follow-up engine

MVP for ranking quote follow-ups, drafting SMS, and sending only after human approval. “Send” writes to a local outbox (SQLite + `outbox.jsonl`). There is no Twilio call.

Requires **Node 22** (`node:sqlite` with `--experimental-sqlite`). The demo clock is **`2026-08-16T18:00:00Z`** (the `now` field on the page). Policy and send never call `Date.now()`.

## How to run

```bash
npm install
npm test
npm start
```

Open **http://127.0.0.1:3456**. The page starts empty. **Ingest seed** loads `quotes.json` + `events.jsonl` (30 quotes, 88 JSONL lines → 82 unique `event_id`s). **Run engine** drafts the top 10 ranked quotes and does not approve or send. **Restart** wipes `followup.db` so you can retest from scratch. Theme toggle is top right.

Ingest is rerunnable. Change `now` to replay the same seed against an earlier clock; events after that instant are invisible to policy.

**Not tested, and why:** CSS/theme chrome; SQLite itself; a real SMS provider; auth/deploy. Guardrail tests cover ingest duplicates, projections, cooldown, stale drafts, and provider retries instead.

## Demo script (under 3 minutes)

Stable candidate: **Q-1012** (Carl Dawson, $18,000, six views). **Q-1004** is accepted and must never be messaged.

```bash
npm install && npm start
```

Open http://127.0.0.1:3456 → **Ingest seed** → **Run engine** → Approve, then Send Q-1012 twice (second is a no-op) → **Restart** to wipe and retest.

What you should see:

1. **Ingest** — 30 quotes, 82 unique events. Quotes and events tables fill in.
2. **Ranked follow-ups** — Q-1012 on the list (D+B: repeat views + large/stale). After a draft exists it may sit under SUPPRESSED as in-flight; that is still listed, not dropped. Q-1004 (accepted) and Q-1009 (dismissed) are not on the queue even after later views/replies.
3. **Run engine** — drafts top 10, does not approve or send. Q-1012 already drafted is not duplicated.
4. **Approve Q-1012** — draft status `approved`. No outbox row yet.
5. **Send Q-1012** — one `sent` outbox row to `+19175552012`.
6. **Send Q-1012** again — `"noop": true`, still one outbox row.
7. **Policy after send** — Q-1012 is not actionable; a new send to that phone would hit the 72h cooldown.

Approve / send resolve a quote id (`Q-1012`) to its open draft.

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

The seams already in this repo are the whole expansion. `POLICY_CONFIG` is already one object: clone it per shop. `evaluate(now)` and `run(now)` stay pure functions of that config plus that shop’s events. `OutboxPort` is where Twilio (or email) and the from-number live; the engine still only writes an outbox row with `draft_id` as the idempotency key. The injected clock is how quiet hours and “run Monday 8am shop-local” attach later without `Date.now()` leaking in. Audit is the decision log (`drafted_because` / `suppressed_because`) plus append-only sent rows. Tenant is a column (or a database) around those tables, not a new policy language.

## What I'd build next

Honest leftovers: SQLite is Node’s experimental `node:sqlite`; the UI is one local page, not shop admin. Quiet hours, delivery webhooks (`delivered` / `bounced` as events), template A/B, per-tech daily send caps, a real Twilio `OutboxPort`, and ranking by historic conversion are a day of work on the same seams — I would not start them by forking `evaluate`.

Incomplete on purpose: no auth, no deploy, no 100% coverage, no tests of the page chrome or SQLite itself. Use **Restart** to replay a send.
