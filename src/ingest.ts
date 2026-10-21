import { readFileSync } from "node:fs";
import { DEMO_NOW } from "./clock.ts";
import type { Db } from "./db.ts";
import { EVENTS_PATH, QUOTES_PATH } from "./paths.ts";
import type { Quote, QuoteStatus, StoredEvent } from "./types.ts";

const KNOWN_EVENT_TYPES = new Set([
  "quote_viewed",
  "quote_sent",
  "customer_replied",
  "message_sent",
  "quote_accepted",
]);

export class JsonlParseError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
    this.name = "JsonlParseError";
  }
}

export type ParsedEventLine = {
  line: number;
  event: StoredEvent;
  warnings: string[];
};

export function parseEventsJsonl(text: string): ParsedEventLine[] {
  const rows: ParsedEventLine[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new JsonlParseError(lineNo, "invalid JSON");
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new JsonlParseError(lineNo, "expected a JSON object");
    }

    const obj = value as Record<string, unknown>;
    const warnings: string[] = [];
    const event_id = requiredString(obj, "event_id", lineNo);
    const type = requiredString(obj, "type", lineNo);
    const timestamp = requiredString(obj, "timestamp", lineNo);

    let quote_id: string | null = null;
    if (obj.quote_id == null || obj.quote_id === "") {
      warnings.push(`line ${lineNo}: missing quote_id (event_id=${event_id})`);
    } else if (typeof obj.quote_id !== "string") {
      throw new JsonlParseError(lineNo, "quote_id must be a string");
    } else {
      quote_id = obj.quote_id;
    }

    if (!KNOWN_EVENT_TYPES.has(type)) {
      warnings.push(`line ${lineNo}: unknown type ${type} (event_id=${event_id})`);
    }

    const event: StoredEvent = {
      event_id,
      quote_id,
      type,
      timestamp,
    };
    if (typeof obj.channel === "string") event.channel = obj.channel;
    if (typeof obj.direction === "string") event.direction = obj.direction;

    rows.push({ line: lineNo, event, warnings });
  }

  return rows;
}

function requiredString(
  obj: Record<string, unknown>,
  key: string,
  lineNo: number,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") {
    throw new JsonlParseError(lineNo, `missing ${key}`);
  }
  return value;
}

export type LoadSeedResult = {
  quotes: number;
  eventLines: number;
  eventsInserted: number;
  uniqueEventIds: number;
  warnings: string[];
};

export function loadSeed(
  db: Db,
  options: {
    quotesPath?: string;
    eventsPath?: string;
    ingestedAt?: string;
    onWarning?: (message: string) => void;
  } = {},
): LoadSeedResult {
  const quotesPath = options.quotesPath ?? QUOTES_PATH;
  const eventsPath = options.eventsPath ?? EVENTS_PATH;
  const ingestedAt = options.ingestedAt ?? DEMO_NOW;
  const quotes = parseQuotes(readFileSync(quotesPath, "utf8"));
  const parsed = parseEventsJsonl(readFileSync(eventsPath, "utf8"));
  const warnings = parsed.flatMap((row) => row.warnings);

  const insertQuote = db.prepare(`
    INSERT INTO quotes (
      id, customer_name, customer_phone, tech_name, amount, status,
      created_at, last_contact_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_name = excluded.customer_name,
      customer_phone = excluded.customer_phone,
      tech_name = excluded.tech_name,
      amount = excluded.amount,
      status = excluded.status,
      created_at = excluded.created_at,
      last_contact_at = excluded.last_contact_at
  `);

  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events (
      event_id, quote_id, type, timestamp, channel, direction, ingested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const quoteIds = new Set(quotes.map((q) => q.id));

  db.exec("BEGIN");
  try {
    for (const quote of quotes) {
      insertQuote.run(
        quote.id,
        quote.customer_name,
        quote.customer_phone,
        quote.tech_name,
        quote.amount,
        quote.status,
        quote.created_at,
        quote.last_contact_at,
      );
    }

    let eventsInserted = 0;
    for (const row of parsed) {
      if (row.event.quote_id && !quoteIds.has(row.event.quote_id)) {
        const msg = `line ${row.line}: quote_id ${row.event.quote_id} is not in the catalog (event kept, quote not invented)`;
        warnings.push(msg);
      }
      const result = insertEvent.run(
        row.event.event_id,
        row.event.quote_id,
        row.event.type,
        row.event.timestamp,
        row.event.channel ?? null,
        row.event.direction ?? null,
        ingestedAt,
      );
      if (result.changes > 0) eventsInserted += 1;
    }
    db.exec("COMMIT");

    for (const msg of warnings) options.onWarning?.(msg);

    const uniqueEventIds = (
      db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }
    ).n;

    return {
      quotes: quotes.length,
      eventLines: parsed.length,
      eventsInserted,
      uniqueEventIds,
      warnings,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseQuotes(text: string): Quote[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) {
    throw new Error("quotes.json: expected an array");
  }
  return value.map((row, i) => {
    if (row === null || typeof row !== "object") {
      throw new Error(`quotes.json[${i}]: expected an object`);
    }
    const obj = row as Record<string, unknown>;
    const status = obj.status;
    if (status !== "open" && status !== "accepted" && status !== "dismissed") {
      throw new Error(`quotes.json[${i}]: invalid status`);
    }
    return {
      id: stringField(obj, "id", i),
      customer_name: stringField(obj, "customer_name", i),
      customer_phone: stringField(obj, "customer_phone", i),
      tech_name: stringField(obj, "tech_name", i),
      amount: numberField(obj, "amount", i),
      status: status as QuoteStatus,
      created_at: stringField(obj, "created_at", i),
      last_contact_at:
        obj.last_contact_at === null
          ? null
          : stringField(obj, "last_contact_at", i),
    };
  });
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
  index: number,
): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`quotes.json[${index}]: ${key} must be a string`);
  }
  return value;
}

function numberField(
  obj: Record<string, unknown>,
  key: string,
  index: number,
): number {
  const value = obj[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`quotes.json[${index}]: ${key} must be a number`);
  }
  return value;
}
