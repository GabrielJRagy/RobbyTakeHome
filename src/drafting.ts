import type { Now } from "./clock.ts";
import { SMS_MAX_CHARS } from "./config.ts";
import type { Quote, Signal } from "./types.ts";

export type DraftTarget = {
  quote_id: string;
  phone: string;
  primary: Signal;
  reasons: Signal[];
};

export type DraftContent = {
  body: string;
  channel: "sms";
};

/**
 * Deterministic SMS templates keyed by primary signal.
 * `quote` must be the candidate's quote — never another row's name/amount.
 */
export function draftFor(
  candidate: DraftTarget,
  now: Now,
  quote: Quote,
): DraftContent {
  void now;
  if (quote.id !== candidate.quote_id) {
    throw new Error(
      `draftFor refused: candidate ${candidate.quote_id} != quote ${quote.id}`,
    );
  }
  if (quote.customer_phone !== candidate.phone) {
    throw new Error(
      `draftFor refused: phone mismatch for ${quote.id}`,
    );
  }

  const first = firstName(quote.customer_name);
  const tech = quote.tech_name;
  const amount = formatAmount(quote.amount);
  const body = template(candidate.primary, first, tech, amount);

  if (body.length > SMS_MAX_CHARS) {
    throw new Error(`draft exceeds ${SMS_MAX_CHARS} chars`);
  }

  return { body, channel: "sms" };
}

function template(
  primary: Signal,
  first: string,
  tech: string,
  amount: string,
): string {
  switch (primary) {
    case "C":
      return `Hi ${first}, it's ${tech}. Got your note on the ${amount} quote — tell me what you need and I'll answer. Reply here.`;
    case "A":
      return `Hi ${first}, it's ${tech}. Saw you opened the ${amount} quote. Questions? Reply YES and I'll walk you through it.`;
    case "D":
      return `Hi ${first}, it's ${tech}. You've looked at the ${amount} quote a few times. Want me to hold the slot or tweak the scope? Reply YES.`;
    case "B":
      return `Hi ${first}, it's ${tech}. Checking in on the ${amount} quote. Still want this on the schedule? Reply YES and I'll lock it in.`;
  }
}

export function firstName(customerName: string): string {
  return customerName.trim().split(/\s+/)[0] ?? "there";
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
