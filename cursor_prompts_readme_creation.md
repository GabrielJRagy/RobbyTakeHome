# Prompts readme creation
_Exported on 10/26/2026 at 13:34:21 EDT from Cursor (3.20.21)_

---

**User**

Create a new file called prompts.readme
You will first injest @Robby Takehome Assignment_Final.pdf, look at @quotes.json and @events.jsonl, and come up with a series of prompts from 0-100, to start the project, all the way to ending it.
Add a gitignore and make sure we don't commit that prompts.readme file ever

---

**Cursor**

I'll start by reading the assignment PDF and the two data files, then write a 0–100 prompt series and a gitignore that keeps `prompts.readme` out of git.

I have the assignment and seed data. Next I’ll write `prompts.readme` as a 0–100 build sequence and add a `.gitignore` so that file never gets committed.

Created `prompts.readme` (prompts **0–100**) and `.gitignore` so that file is never committed.

The series is ordered for this take-home:

- **0–10** — Read the seed, lock the 3-hour cut, types, clock, identity (phone-level cooldown for Karen Nguyen on Q-1003 / Q-1025)
- **11–25** — Ingest: duplicate `event_id`s, out-of-order timestamps, `quote_sent` (in events, not the PDF), events vs `last_contact_at` (Q-1005)
- **26–45** — Policy: open-only, the two PDF signals plus reply-unanswered and repeat-views (Q-1012), ranking, suppress-not-hide
- **46–60** — Draft → approve → send, outbox port, no auto-send
- **61–75** — Guardrails: no double-send, no messaging accepted/dismissed, stale-draft if they reply after draft
- **76–85** — One demo surface (localhost or CLI)
- **86–95** — Tests on the risky bits only
- **96–100** — README (policy, 50-shop scale, stop line, submit)

`.gitignore` contains only `prompts.readme`. I did not commit anything.

---

**User**

Ok it doesn't actually have to be 100 prompts. It needs to have prompts that get us from 0% to 100% of the way there. Consolidate the prompts into 25ish prompts

---

**Cursor**

Eighteen is a bit tight for “25ish.” I’ll split the heavier steps so the path is about 24 prompts without going back to a hundred.

Consolidated `prompts.readme` from 101 steps down to **24 prompts** that still run 0% → submit.

Each step is a full slice of work (ingest, policy, HITL, tests, README) instead of a micro-task. Seed quirks are still called out: duplicate events, `quote_sent`, Q-1005 last-contact mismatch, Karen Nguyen on two quotes, accepted/dismissed never messaged.

`.gitignore` still excludes `prompts.readme`.

---

**User**

Ok in simple terms, what do I need to do - injest, filter, normalize, use some kind of AI processing to classify, etc... what else?

---

**Cursor**

You do **not** need an AI classifier. The job is a small **decision + draft + human-approve-then-send** loop on messy quote/event data.

In order:

1. **Ingest**  
   Load `quotes.json` and `events.jsonl` into storage. Events are messy on purpose: duplicates, out of order, extra types like `quote_sent`.

2. **Normalize / project**  
   Deduplicate by `event_id`. Sort by timestamp. Build a per-quote picture: last view, view count, last reply, last outbound message, accepted or not. Trust **events** more than `last_contact_at` on the quote (they disagree, e.g. Q-1005).

3. **Filter (hard rules, not ML)**  
   Never follow up if the quote is **accepted** or **dismissed**. Never text the same **phone** twice inside a cooldown (Karen Nguyen has two quotes, one number). Don’t double-send if you rerun the engine or retry a failed send.

4. **Score / prioritize (rules, not AI)**  
   For a given “now”, rank **open** quotes with a reason, e.g.  
   - viewed recently, nobody replied  
   - big quote, silent for N days  
   - they texted you, you didn’t answer  
   - viewed many times, then went quiet  

5. **Draft**  
   Fill a short SMS template from the reason + name + amount. A real LLM is optional and not the point.

6. **Human in the loop**  
   Draft → human approves (or rejects/edits) → **then** “send”. Sending = write to an outbox/file/table, as if Twilio were behind an interface.

7. **Show it**  
   Localhost or CLI: list candidates, approve, send, see the outbox.

8. **Tests + README**  
   Tests on the scary bits (dupes, double-send, accepted quotes). README: how to run, why the policy, what changes at 50 shops, what you’d do with another day.

That’s the whole MVP: **ingest → clean events → rule-based who/when → template draft → approve → fake send**, with guardrails so you never spam or double-text.

---

**User**

Cool. What do you suggest I start with? I would like this to be a ts project. Do I need to setup any infra on AWS/GCP? Maybe create microservices or a monolith service that does this processing?

---

**Cursor**

Start local, as **one TypeScript process**. Do not set up AWS/GCP, and do not split this into microservices.

The assignment is a 3-hour MVP. They say localhost is fine and they are **not** grading deployment, auth, or framework choice. Cloud and services would burn the whole budget on plumbing.

**What to build:** a small monolith — ingest, policy, drafts, approve/send, and a tiny UI or CLI in the same Node app. SQLite (or even JSON files) on disk. “Send” writes to an outbox table/file behind an interface, as if Twilio existed.

**Suggested start (in order):**

1. `npm init` + TypeScript + a test runner (Vitest or Node’s test runner).
2. Folders like `src/ingest`, `src/policy`, `src/drafts`, `src/outbox`, `src/app`.
3. Load `quotes.json` / `events.jsonl`, dedupe events, project per-quote state.
4. Then policy → drafts → approve → send. UI last, and keep it ugly.

That’s enough architecture: one service, one database, one `now` you inject for the policy. The seams they care about later (50 shops) are a config object and an `OutboxPort`, not ECS/Lambda/PubSub.

If someone asks “why not cloud?”: you’d add a queue and a provider in production; for this take-home, a function + a table is the same design with none of the ops.

---

**User**

Are these all supposed to be folders? Why?

---

**Cursor**

No. Those names are **modules** (separate pieces of logic), not a requirement to make five folders.

I listed `ingest`, `policy`, `drafts`, `outbox`, `app` so you don’t dump everything in one 800-line file — and so the “send” interface stays separate from “who to contact.” For this take-home, **files are enough**:

```
src/ingest.ts
src/policy.ts
src/drafts.ts
src/outbox.ts
src/app.ts
```

Folders only help if a module grows (`policy/signals.ts`, `policy/rank.ts`). You will not get there in 3 hours.

Why split at all: ingest (messy events), policy (who/when), drafts (HITL), outbox (fake Twilio) are the four things they grade. Separate files make that obvious in the README and in review. One `src/index.ts` that does all four is still a valid monolith — just harder to defend.

