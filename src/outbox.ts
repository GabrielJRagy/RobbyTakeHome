import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hoursBetween, type Now } from "./clock.ts";
import { COOLDOWN_HOURS } from "./config.ts";
import type { Db } from "./db.ts";
import { getDraft, listDrafts, markDraftSent } from "./drafts.ts";
import { customerIndex, projectAsOf, readEvents, readQuotes } from "./project.ts";
import type { Channel, OutboxRow, OutboxStatus } from "./types.ts";

/**
 * Provider behind the outbox.
 *
 * Production: enqueue (this table) → worker calls Twilio/email with
 * `idempotencyKey` = draft_id → store provider id on success → delivery
 * webhooks become later events. Retry uses the same key so the provider
 * also dedups. Do not Date.now() for cooldown/stale-draft; take `now`.
 */
export type OutboxPort = {
  send(request: {
    idempotencyKey: string;
    to: string;
    channel: Channel;
    body: string;
  }): { providerMessageId: string };
};

export class MemoryProvider implements OutboxPort {
  attempts = 0;
  successes = 0;
  private failRemaining = 0;
  private readonly succeeded = new Map<string, string>();

  failNext(times = 1): void {
    this.failRemaining += times;
  }

  send(request: {
    idempotencyKey: string;
    to: string;
    channel: Channel;
    body: string;
  }): { providerMessageId: string } {
    this.attempts += 1;
    const prior = this.succeeded.get(request.idempotencyKey);
    if (prior) return { providerMessageId: prior };
    if (this.failRemaining > 0) {
      this.failRemaining -= 1;
      throw new Error("provider down");
    }
    this.successes += 1;
    const providerMessageId = `mem:${request.idempotencyKey}`;
    this.succeeded.set(request.idempotencyKey, providerMessageId);
    return { providerMessageId };
  }
}

/** Append-only success log. Failures are not written. */
export class FileProvider implements OutboxPort {
  constructor(
    private readonly path: string,
    private readonly inner: OutboxPort = new MemoryProvider(),
  ) {}

  send(request: {
    idempotencyKey: string;
    to: string;
    channel: Channel;
    body: string;
  }): { providerMessageId: string } {
    const result = this.inner.send(request);
    appendFileSync(
      this.path,
      `${JSON.stringify({ ...request, ...result })}\n`,
    );
    return result;
  }
}

export class SendError extends Error {
  constructor(
    readonly code:
      | "not_approved"
      | "not_open"
      | "cooldown"
      | "in_flight"
      | "bad_phone"
      | "stale_draft"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "SendError";
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;

export function listOutbox(db: Db): OutboxRow[] {
  const rows = db
    .prepare(`SELECT * FROM outbox ORDER BY created_at, id`)
    .all() as OutboxDbRow[];
  return rows.map(fromOutboxRow);
}

export function getOutboxByDraft(db: Db, draftId: string): OutboxRow | undefined {
  const row = db
    .prepare(`SELECT * FROM outbox WHERE idempotency_key = ?`)
    .get(draftId) as OutboxDbRow | undefined;
  return row ? fromOutboxRow(row) : undefined;
}

export type SendOutcome = {
  noop: boolean;
  outbox: OutboxRow;
};

export function sendDraft(
  db: Db,
  draftId: string,
  now: Now,
  provider: OutboxPort,
): SendOutcome {
  const draft = getDraft(db, draftId);
  if (!draft) throw new SendError("not_found", `draft not found: ${draftId}`);

  const existing = getOutboxByDraft(db, draft.id);
  if (existing?.status === "sent") {
    return { noop: true, outbox: existing };
  }

  if (draft.status !== "approved") {
    throw new SendError("not_approved", `send requires approved, got ${draft.status}`);
  }

  const quotes = readQuotes(db);
  const projections = projectAsOf(quotes, readEvents(db), now);
  const quote = quotes.find((row) => row.id === draft.quote_id);
  const projection = projections.get(draft.quote_id);
  if (!quote || !projection || projection.status !== "open") {
    throw new SendError("not_open", `${draft.quote_id} is not open`);
  }

  if (!E164.test(draft.phone)) {
    throw new SendError("bad_phone", `phone is not E.164-ish: ${draft.phone}`);
  }

  if (
    projection.last_customer_reply_at &&
    projection.last_customer_reply_at > draft.created_at
  ) {
    throw new SendError(
      "stale_draft",
      `customer replied at ${projection.last_customer_reply_at} after draft ${draft.created_at}`,
    );
  }

  const index = customerIndex(quotes, projections);
  const lastOut = maxStamp(
    index.lastOutboundForPhone.get(draft.phone) ?? null,
    sentOutboxStamps(db, draft.phone, draft.id),
  );
  if (lastOut != null) {
    const delta = hoursBetween(now, lastOut);
    if (delta >= 0 && delta < COOLDOWN_HOURS) {
      throw new SendError("cooldown", `phone ${draft.phone} contacted ${lastOut}`);
    }
  }

  if (hasOtherInFlight(db, draft.phone, draft.id)) {
    throw new SendError("in_flight", `another send is in flight for ${draft.phone}`);
  }

  const outboxId = existing?.id ?? randomUUID();
  db.exec("BEGIN");
  try {
    if (existing) {
      db.prepare(
        `UPDATE outbox SET status = 'sending', error = NULL WHERE id = ?`,
      ).run(outboxId);
    } else {
      db.prepare(
        `INSERT INTO outbox (
           id, draft_id, idempotency_key, status, to_phone, channel, body, created_at
         ) VALUES (?, ?, ?, 'sending', ?, ?, ?, ?)`,
      ).run(
        outboxId,
        draft.id,
        draft.id,
        draft.phone,
        draft.channel,
        draft.body,
        now,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  let providerMessageId: string;
  try {
    ({ providerMessageId } = provider.send({
      idempotencyKey: draft.id,
      to: draft.phone,
      channel: draft.channel,
      body: draft.body,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      `UPDATE outbox SET status = 'failed', error = ? WHERE id = ?`,
    ).run(message, outboxId);
    const failed = getOutboxByDraft(db, draft.id);
    if (!failed) throw error;
    throw error;
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE outbox SET status = 'sent', provider_message_id = ?, error = NULL WHERE id = ?`,
    ).run(providerMessageId, outboxId);
    markDraftSent(db, draft.id);
    db.prepare(
      `INSERT OR IGNORE INTO events (
         event_id, quote_id, type, timestamp, channel, direction, ingested_at
       ) VALUES (?, ?, 'message_sent', ?, ?, 'outbound', ?)`,
    ).run(`send:${draft.id}`, draft.quote_id, now, draft.channel, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const outbox = getOutboxByDraft(db, draft.id);
  if (!outbox) throw new Error("outbox row missing after send");
  return { noop: false, outbox };
}

function hasOtherInFlight(db: Db, phone: string, draftId: string): boolean {
  const otherDraft = listDrafts(db).some(
    (draft) =>
      draft.id !== draftId &&
      draft.phone === phone &&
      (draft.status === "drafted" || draft.status === "approved"),
  );
  if (otherDraft) return true;
  const row = db
    .prepare(
      `SELECT id FROM outbox
       WHERE to_phone = ? AND idempotency_key != ?
         AND status IN ('queued', 'sending')
       LIMIT 1`,
    )
    .get(phone, draftId) as { id: string } | undefined;
  return row != null;
}

function sentOutboxStamps(db: Db, phone: string, exceptDraftId: string): string | null {
  const row = db
    .prepare(
      `SELECT MAX(created_at) AS at FROM outbox
       WHERE to_phone = ? AND idempotency_key != ? AND status = 'sent'`,
    )
    .get(phone, exceptDraftId) as { at: string | null };
  return row.at;
}

function maxStamp(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

type OutboxDbRow = {
  id: string;
  draft_id: string;
  idempotency_key: string;
  status: OutboxStatus;
  to_phone: string;
  channel: Channel;
  body: string;
  created_at: string;
  provider_message_id: string | null;
  error: string | null;
};

function fromOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    draft_id: row.draft_id,
    idempotency_key: row.idempotency_key,
    status: row.status,
    to: row.to_phone,
    channel: row.channel,
    body: row.body,
    created_at: row.created_at,
    ...(row.provider_message_id
      ? { provider_message_id: row.provider_message_id }
      : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}
