import type { Db } from "./db.ts";
import type { Quote, QuoteProjection, QuoteStatus, StoredEvent } from "./types.ts";

export function readQuotes(db: Db): Quote[] {
  const rows = db.prepare(`SELECT * FROM quotes`).all() as Array<{
    id: string;
    customer_name: string;
    customer_phone: string;
    tech_name: string;
    amount: number;
    status: QuoteStatus;
    created_at: string;
    last_contact_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    tech_name: row.tech_name,
    amount: row.amount,
    status: row.status,
    created_at: row.created_at,
    last_contact_at: row.last_contact_at,
  }));
}

export function readEvents(db: Db): StoredEvent[] {
  const rows = db.prepare(
    `SELECT event_id, quote_id, type, timestamp, channel, direction FROM events`,
  ).all() as Array<{
    event_id: string;
    quote_id: string | null;
    type: string;
    timestamp: string;
    channel: string | null;
    direction: string | null;
  }>;
  return rows.map((row) => {
    const event: StoredEvent = {
      event_id: row.event_id,
      quote_id: row.quote_id,
      type: row.type,
      timestamp: row.timestamp,
    };
    if (row.channel) event.channel = row.channel;
    if (row.direction) event.direction = row.direction;
    return event;
  });
}

function resolveStatus(
  jsonStatus: QuoteStatus,
  events: StoredEvent[],
): QuoteStatus {
  if (jsonStatus === "dismissed") return "dismissed";
  const acceptedEvent = events.some((event) => event.type === "quote_accepted");
  if (jsonStatus === "accepted" || acceptedEvent) return "accepted";
  return "open";
}

function projectQuote(quote: Quote, events: StoredEvent[]): QuoteProjection {
  const mine = events.filter(
    (event) => event.quote_id === quote.id,
  );
  const sent = timestamps(mine, "quote_sent");
  const viewed = timestamps(mine, "quote_viewed");
  const replies = timestamps(mine, "customer_replied");
  const outbound = timestamps(mine, "message_sent");
  const accepted = timestamps(mine, "quote_accepted");

  return {
    quote_id: quote.id,
    status: resolveStatus(quote.status, mine),
    first_sent_at: minIso(sent),
    last_viewed_at: maxIso(viewed),
    view_count: viewed.length,
    last_customer_reply_at: maxIso(replies),
    last_outbound_at: maxIso(outbound),
    last_accepted_at: maxIso(accepted),
  };
}

function projectAll(
  quotes: Quote[],
  events: StoredEvent[],
): Map<string, QuoteProjection> {
  const map = new Map<string, QuoteProjection>();
  for (const quote of quotes) {
    map.set(quote.id, projectQuote(quote, events));
  }
  return map;
}

export function projectFromDb(db: Db): Map<string, QuoteProjection> {
  return projectAll(readQuotes(db), readEvents(db));
}

/** Drop events after `now` so a backdated clock cannot see the future. */
export function projectAsOf(
  quotes: Quote[],
  events: StoredEvent[],
  now: string,
): Map<string, QuoteProjection> {
  return projectAll(
    quotes,
    events.filter((event) => event.timestamp <= now),
  );
}

export type CustomerIndex = {
  quotesForPhone: Map<string, string[]>;
  lastOutboundForPhone: Map<string, string | null>;
};

export function customerIndex(
  quotes: Quote[],
  projections: Map<string, QuoteProjection>,
): CustomerIndex {
  const quotesForPhone = new Map<string, string[]>();
  const lastOutboundForPhone = new Map<string, string | null>();

  for (const quote of quotes) {
    const ids = quotesForPhone.get(quote.customer_phone) ?? [];
    ids.push(quote.id);
    quotesForPhone.set(quote.customer_phone, ids);

    const outbound = projections.get(quote.id)?.last_outbound_at ?? null;
    const current = lastOutboundForPhone.get(quote.customer_phone) ?? null;
    lastOutboundForPhone.set(
      quote.customer_phone,
      maxIso([current, outbound].filter((value): value is string => value != null)),
    );
  }

  for (const ids of quotesForPhone.values()) {
    ids.sort();
  }

  return { quotesForPhone, lastOutboundForPhone };
}

export function customerIndexFromDb(db: Db): CustomerIndex {
  const quotes = readQuotes(db);
  return customerIndex(quotes, projectAll(quotes, readEvents(db)));
}

function timestamps(events: StoredEvent[], type: string): string[] {
  return events
    .filter((event) => event.type === type)
    .map((event) => event.timestamp);
}

function minIso(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((best, value) => (value < best ? value : best));
}

function maxIso(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((best, value) => (value > best ? value : best));
}
