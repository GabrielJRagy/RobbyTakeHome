/**
 * Follow-up ranking and suppression.
 * evaluate(now) only — never Date.now(). Cooldown uses customer_phone.
 * Policy never enqueues sends.
 */
import { hoursBetween, type Now } from "./clock.ts";
import { POLICY_CONFIG, type PolicyConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { listDrafts } from "./drafts.ts";
import { listOutbox } from "./outbox.ts";
import {
  customerIndex,
  projectAsOf,
  readEvents,
  readQuotes,
} from "./project.ts";
import type { Draft, OutboxRow, Quote, QuoteProjection, Signal } from "./types.ts";

export type { Signal };

export const SIGNAL_RANK: Record<Signal, number> = {
  C: 0,
  A: 1,
  D: 2,
  B: 3,
};

export type SuppressReason = "cooldown" | "in_flight";

export type Candidate = {
  quote_id: string;
  phone: string;
  amount: number;
  reasons: Signal[];
  primary: Signal;
  last_viewed_at: string | null;
};

export type RankedCandidate = Candidate & {
  suppressed: false;
};

export type SuppressedCandidate = Candidate & {
  suppressed: true;
  suppressedBecause: SuppressReason[];
};

export type PolicyResult = {
  now: Now;
  actionable: RankedCandidate[];
  suppressed: SuppressedCandidate[];
};

export function isMessageable(projection: QuoteProjection): boolean {
  return projection.status === "open";
}

export function matchSignals(
  quote: Quote,
  projection: QuoteProjection,
  now: Now,
  config: PolicyConfig = POLICY_CONFIG,
): Signal[] {
  const reasons: Signal[] = [];
  const viewed = projection.last_viewed_at;
  const outbound = projection.last_outbound_at;
  const reply = projection.last_customer_reply_at;

  if (reply && !happenedAfter(outbound, reply)) {
    reasons.push("C");
  }

  if (
    viewed &&
    withinHours(now, viewed, config.viewWindowHours) &&
    !happenedAfter(outbound, viewed)
  ) {
    reasons.push("A");
  }

  if (
    projection.view_count >= config.repeatViewCount &&
    viewed &&
    !happenedAfter(outbound, viewed)
  ) {
    reasons.push("D");
  }

  if (quote.amount >= config.largeAmount && isLargeStale(quote, projection, now, config)) {
    reasons.push("B");
  }

  return reasons;
}

function isLargeStale(
  quote: Quote,
  projection: QuoteProjection,
  now: Now,
  config: PolicyConfig,
): boolean {
  const zeroActivity =
    projection.view_count === 0 &&
    projection.last_customer_reply_at == null &&
    projection.last_outbound_at == null;

  if (
    zeroActivity &&
    !isAtLeastHoursOld(now, quote.created_at, config.minAgeHours)
  ) {
    return false;
  }

  const lastTouch = projection.last_outbound_at ?? projection.first_sent_at;
  if (lastTouch == null) return true;
  return isAtLeastHoursOld(now, lastTouch, config.staleDays * 24);
}

export function evaluate(input: {
  quotes: Quote[];
  projections: Map<string, QuoteProjection>;
  drafts?: Draft[];
  outbox?: OutboxRow[];
  now: Now;
  config?: PolicyConfig;
}): PolicyResult {
  const config = input.config ?? POLICY_CONFIG;
  const drafts = input.drafts ?? [];
  const outbox = input.outbox ?? [];
  const index = customerIndex(input.quotes, input.projections);
  const quotesById = new Map(input.quotes.map((quote) => [quote.id, quote]));

  const matched: Candidate[] = [];
  for (const quote of input.quotes) {
    const projection = input.projections.get(quote.id);
    if (!projection || !isMessageable(projection)) continue;
    const reasons = matchSignals(quote, projection, input.now, config);
    if (reasons.length === 0) continue;
    matched.push({
      quote_id: quote.id,
      phone: quote.customer_phone,
      amount: quote.amount,
      reasons,
      primary: reasons[0] as Signal,
      last_viewed_at: projection.last_viewed_at,
    });
  }

  matched.sort(compareCandidates);

  const actionable: RankedCandidate[] = [];
  const suppressed: SuppressedCandidate[] = [];

  for (const candidate of matched) {
    const why: SuppressReason[] = [];
    const lastOut = lastPhoneOutbound(
      candidate.phone,
      index.lastOutboundForPhone.get(candidate.phone) ?? null,
      outbox,
    );
    if (lastOut && withinHours(input.now, lastOut, config.cooldownHours)) {
      why.push("cooldown");
    }
    if (phoneHasInFlight(candidate.phone, quotesById, drafts, outbox)) {
      why.push("in_flight");
    }
    if (why.length > 0) {
      suppressed.push({ ...candidate, suppressed: true, suppressedBecause: why });
    } else {
      actionable.push({ ...candidate, suppressed: false });
    }
  }

  return { now: input.now, actionable, suppressed };
}

export function evaluateFromDb(
  db: Db,
  now: Now,
  extras: { drafts?: Draft[]; outbox?: OutboxRow[]; config?: PolicyConfig } = {},
): PolicyResult {
  const quotes = readQuotes(db);
  const events = readEvents(db);
  const projections = projectAsOf(quotes, events, now);
  return evaluate({
    quotes,
    projections,
    drafts: extras.drafts ?? listDrafts(db),
    outbox: extras.outbox ?? listOutbox(db),
    now,
    config: extras.config,
  });
}

function lastPhoneOutbound(
  phone: string,
  projected: string | null,
  outbox: OutboxRow[],
): string | null {
  const fromOutbox = outbox
    .filter(
      (row) =>
        row.to === phone &&
        (row.status === "queued" ||
          row.status === "sending" ||
          row.status === "sent"),
    )
    .map((row) => row.created_at)
    .filter((value): value is string => value != null);
  const stamps = [projected, ...fromOutbox].filter(
    (value): value is string => value != null,
  );
  if (stamps.length === 0) return null;
  return stamps.reduce((best, value) => (value > best ? value : best));
}

function phoneHasInFlight(
  phone: string,
  quotesById: Map<string, Quote>,
  drafts: Draft[],
  outbox: OutboxRow[],
): boolean {
  const openDraft = drafts.some((draft) => {
    if (draft.status !== "drafted" && draft.status !== "approved") return false;
    if (draft.phone === phone) return true;
    return quotesById.get(draft.quote_id)?.customer_phone === phone;
  });
  if (openDraft) return true;
  return outbox.some(
    (row) =>
      row.to === phone &&
      (row.status === "queued" || row.status === "sending"),
  );
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const rank = SIGNAL_RANK[a.primary] - SIGNAL_RANK[b.primary];
  if (rank !== 0) return rank;
  if (b.amount !== a.amount) return b.amount - a.amount;
  const viewA = a.last_viewed_at ?? "";
  const viewB = b.last_viewed_at ?? "";
  if (viewA !== viewB) return viewB.localeCompare(viewA);
  return a.quote_id.localeCompare(b.quote_id);
}

function happenedAfter(later: string | null, earlier: string): boolean {
  return later != null && later > earlier;
}

function withinHours(now: Now, at: string, hours: number): boolean {
  const delta = hoursBetween(now, at);
  return delta >= 0 && delta <= hours;
}

function isAtLeastHoursOld(now: Now, at: string, hours: number): boolean {
  return hoursBetween(now, at) >= hours;
}
