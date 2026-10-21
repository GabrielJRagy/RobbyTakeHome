import { randomUUID } from "node:crypto";
import type { Now } from "./clock.ts";
import type { Db } from "./db.ts";
import { draftFor, type DraftTarget } from "./drafting.ts";
import type { Channel, Draft, DraftStatus, Quote, Signal } from "./types.ts";

export function listDrafts(db: Db): Draft[] {
  const rows = db.prepare(`SELECT * FROM drafts ORDER BY created_at, id`).all() as DraftRow[];
  return rows.map(fromRow);
}

export function getDraft(db: Db, id: string): Draft | undefined {
  const row = db.prepare(`SELECT * FROM drafts WHERE id = ?`).get(id) as
    | DraftRow
    | undefined;
  return row ? fromRow(row) : undefined;
}

export function latestDraftForQuote(db: Db, quoteId: string): Draft | undefined {
  const row = db
    .prepare(
      `SELECT * FROM drafts WHERE quote_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(quoteId) as DraftRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function openDraftForQuote(db: Db, quoteId: string): Draft | undefined {
  const row = db
    .prepare(
      `SELECT * FROM drafts
       WHERE quote_id = ? AND status IN ('drafted', 'approved', 'failed')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(quoteId) as DraftRow | undefined;
  return row ? fromRow(row) : undefined;
}

/** One open draft per quote. Reruns return the existing row. */
export function ensureDraft(
  db: Db,
  quote: Quote,
  candidate: DraftTarget,
  now: Now,
): { draft: Draft; created: boolean } {
  const existing = openDraftForQuote(db, quote.id);
  if (existing) return { draft: existing, created: false };

  const content = draftFor(candidate, now, quote);
  const draft: Draft = {
    id: randomUUID(),
    quote_id: quote.id,
    phone: quote.customer_phone,
    body: content.body,
    channel: content.channel,
    reasons: candidate.reasons,
    created_at: now,
    status: "drafted",
  };
  insertDraft(db, draft);
  return { draft, created: true };
}

export function editDraft(db: Db, id: string, body: string): Draft {
  const draft = requireDraft(db, id);
  if (draft.status === "sent") {
    throw new Error("cannot edit a sent draft");
  }
  if (draft.status === "rejected") {
    throw new Error("cannot edit a rejected draft");
  }
  db.prepare(`UPDATE drafts SET body = ?, status = 'drafted' WHERE id = ?`).run(
    body,
    id,
  );
  return requireDraft(db, id);
}

export function approveDraft(db: Db, id: string): Draft {
  const draft = requireDraft(db, id);
  if (draft.status !== "drafted") {
    throw new Error(`cannot approve draft in status ${draft.status}`);
  }
  db.prepare(`UPDATE drafts SET status = 'approved' WHERE id = ?`).run(id);
  return requireDraft(db, id);
}

export function rejectDraft(db: Db, id: string): Draft {
  const draft = requireDraft(db, id);
  if (draft.status === "sent") {
    throw new Error("cannot reject a sent draft");
  }
  db.prepare(`UPDATE drafts SET status = 'rejected' WHERE id = ?`).run(id);
  return requireDraft(db, id);
}

export function markDraftSent(db: Db, id: string): void {
  db.prepare(`UPDATE drafts SET status = 'sent' WHERE id = ?`).run(id);
}

function insertDraft(db: Db, draft: Draft): void {
  db.prepare(
    `INSERT INTO drafts (id, quote_id, phone, body, channel, reasons, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    draft.id,
    draft.quote_id,
    draft.phone,
    draft.body,
    draft.channel,
    JSON.stringify(draft.reasons),
    draft.created_at,
    draft.status,
  );
}

function requireDraft(db: Db, id: string): Draft {
  const draft = getDraft(db, id);
  if (!draft) throw new Error(`draft not found: ${id}`);
  return draft;
}

type DraftRow = {
  id: string;
  quote_id: string;
  phone: string;
  body: string;
  channel: Channel;
  reasons: string;
  created_at: string;
  status: DraftStatus;
};

function fromRow(row: DraftRow): Draft {
  return {
    id: row.id,
    quote_id: row.quote_id,
    phone: row.phone,
    body: row.body,
    channel: row.channel,
    reasons: JSON.parse(row.reasons) as Signal[],
    created_at: row.created_at,
    status: row.status,
  };
}

