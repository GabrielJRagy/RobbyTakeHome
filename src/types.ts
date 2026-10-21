/**
 * Quote catalog row. `status` is a one-way machine:
 *   open → accepted | dismissed
 * Views and replies never move status backward.
 */
export type QuoteStatus = "open" | "accepted" | "dismissed";

export type Quote = {
  id: string;
  customer_name: string;
  customer_phone: string;
  tech_name: string;
  amount: number;
  status: QuoteStatus;
  created_at: string;
  /** Stale hint. Activity comes from events, not this field. */
  last_contact_at: string | null;
};

export type Channel = "sms" | "email";
export type Direction = "inbound" | "outbound";

export type EventType =
  | "quote_viewed"
  | "quote_sent"
  | "customer_replied"
  | "message_sent"
  | "quote_accepted";

type EventBase = {
  event_id: string;
  quote_id: string;
  timestamp: string;
};

export type QuoteViewedEvent = EventBase & {
  type: "quote_viewed";
};

/** Seed type not listed in the PDF. Catalog delivery, not a follow-up send. */
export type QuoteSentEvent = EventBase & {
  type: "quote_sent";
};

export type CustomerRepliedEvent = EventBase & {
  type: "customer_replied";
  channel?: Channel;
};

export type MessageSentEvent = EventBase & {
  type: "message_sent";
  channel?: Channel;
  direction?: Direction;
};

export type QuoteAcceptedEvent = EventBase & {
  type: "quote_accepted";
};

export type KnownEvent =
  | QuoteViewedEvent
  | QuoteSentEvent
  | CustomerRepliedEvent
  | MessageSentEvent
  | QuoteAcceptedEvent;

/** Persisted webhook row. Unknown `type` is stored and not projected. */
export type StoredEvent = {
  event_id: string;
  quote_id: string | null;
  type: EventType | string;
  timestamp: string;
  channel?: string;
  direction?: string;
};

/**
 * Draft machine:
 *   drafted → approved | rejected
 *   approved → drafted (on edit) | sent | failed
 * Rejected is terminal for that row. Sent is frozen.
 */
export type DraftStatus =
  | "drafted"
  | "approved"
  | "rejected"
  | "sent"
  | "failed";

export type Draft = {
  id: string;
  quote_id: string;
  phone: string;
  body: string;
  channel: Channel;
  reasons: string[];
  created_at: string;
  status: DraftStatus;
};

/**
 * Outbox machine:
 *   queued → sending → sent | failed
 * Idempotency key = draft_id. Already sent is a no-op. Retry keeps the same key.
 */
export type OutboxStatus = "queued" | "sending" | "sent" | "failed";

export type OutboxRow = {
  id: string;
  draft_id: string;
  idempotency_key: string;
  status: OutboxStatus;
  to: string;
  channel: Channel;
  body: string;
  provider_message_id?: string;
  error?: string;
};
