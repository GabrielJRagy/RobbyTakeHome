import { COOLDOWN_HOURS } from "./config.ts";
import type { Draft, OutboxRow } from "./types.ts";
import type { EngineResult } from "./engine.ts";
import type { PolicyResult, Signal, SuppressReason } from "./policy.ts";

const SIGNAL_LABEL: Record<Signal, string> = {
  C: "they replied and nobody answered",
  A: "they viewed recently with no follow-up after",
  D: "they opened the quote several times, then went quiet",
  B: "large quote with no recent touch",
};

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

export function renderFollowUps(policy: PolicyResult): string {
  const lines = [
    `SCREEN 1  ranked follow-ups   now=${policy.now}`,
    "",
    "ACTIONABLE",
    row(["quote", "phone", "amount", "why"]),
    ...policy.actionable.map((c) =>
      row([
        c.quote_id,
        c.phone,
        String(c.amount),
        `${c.primary}: ${c.reasons.map((r) => SIGNAL_LABEL[r]).join("; ")}`,
      ]),
    ),
    policy.actionable.length === 0 ? "(none)" : "",
    "SUPPRESSED (still listed, not omitted)",
    row(["quote", "phone", "amount", "why held"]),
    ...policy.suppressed.map((c) =>
      row([
        c.quote_id,
        c.phone,
        String(c.amount),
        `${c.reasons.join("+")} / ${c.suppressedBecause.map(suppressEnglish).join("; ")}`,
      ]),
    ),
    policy.suppressed.length === 0 ? "(none)" : "",
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

export function renderDrafts(
  drafts: Draft[],
  policy: PolicyResult,
): string {
  const lines = [
    `SCREEN 2  draft review   now=${policy.now}`,
    "",
  ];
  if (drafts.length === 0) {
    lines.push("(no drafts — run: npm run engine -- --now=" + policy.now + ")");
    return lines.join("\n");
  }
  for (const draft of drafts) {
    lines.push("-".repeat(72));
    lines.push(`id=${draft.id}  quote=${draft.quote_id}  ${draft.phone}  status=${draft.status}`);
    lines.push(`reasons: ${draft.reasons.join(", ")} (${reasonEnglish(draft.reasons as Signal[])})`);
    lines.push(`body: ${draft.body}`);
    const warning = draftWarning(draft, policy);
    if (warning) {
      lines.push(`WARNING: ${warning}`);
    }
  }
  return lines.join("\n");
}

export function renderOutbox(rows: OutboxRow[]): string {
  const lines = [
    "SCREEN 3  outbox log",
    "",
    row(["status", "to", "draft", "at"]),
  ];
  if (rows.length === 0) lines.push("(empty)");
  for (const item of rows) {
    lines.push(
      row([
        item.status,
        item.to,
        item.draft_id.slice(0, 8),
        item.created_at ?? "",
      ]),
    );
    lines.push(`  ${item.body}`);
    if (item.error) lines.push(`  error: ${item.error}`);
  }
  return lines.join("\n");
}

export function renderEngineHelp(now: string, result?: EngineResult): string {
  const lines = [
    "SCREEN 4  run engine (injected clock, not wall clock)",
    "",
    `  npm run engine -- --now=${now}`,
    "  npm run engine -- --now=2026-08-14T12:00:00Z --top=10",
    "",
    "Creates missing drafts for top N. Never auto-approves or auto-sends.",
  ];
  if (result) {
    lines.push("");
    lines.push("drafted_because:");
    for (const row of result.drafted_because) {
      lines.push(
        `  ${row.quote_id}  ${row.created ? "NEW" : "exists"}  ${row.primary} ${row.reasons.join("+")}`,
      );
    }
    lines.push("suppressed_because:");
    if (result.suppressed_because.length === 0) lines.push("  (none)");
    for (const row of result.suppressed_because) {
      lines.push(
        `  ${row.quote_id}  ${row.suppressedBecause.map(suppressEnglish).join("; ")}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderRefused(code: string, message: string): string {
  return [
    "!!!!!!!!!!  SEND REFUSED  !!!!!!!!!!",
    `code: ${code}`,
    sendEnglish(code, message),
    `detail: ${message}`,
  ].join("\n");
}

export function draftWarning(draft: Draft, policy: PolicyResult): string | null {
  const onList = [...policy.actionable, ...policy.suppressed].some(
    (row) => row.quote_id === draft.quote_id || row.phone === draft.phone,
  );
  const suppressed = policy.suppressed.find(
    (row) => row.quote_id === draft.quote_id || row.phone === draft.phone,
  );
  if (suppressed?.suppressedBecause.includes("cooldown")) {
    return `We already contacted ${draft.phone} in the last ${COOLDOWN_HOURS} hours. Sending now would double-text this person (cooldown is by phone, not quote).`;
  }
  if (
    suppressed?.suppressedBecause.includes("in_flight") &&
    suppressed.quote_id !== draft.quote_id
  ) {
    return `Another draft or queued send is already in flight for ${draft.phone}. Finish or reject that one first.`;
  }
  if (draft.status === "approved" && !onList) {
    return "This quote is no longer a follow-up candidate at this --now. Re-check before sending.";
  }
  if (draft.status === "drafted") {
    return `Approve does not send. After approve: send ${draft.id}`;
  }
  return null;
}

function reasonEnglish(reasons: Signal[]): string {
  return reasons.map((r) => SIGNAL_LABEL[r] ?? r).join("; ");
}

function suppressEnglish(reason: SuppressReason): string {
  if (reason === "cooldown") {
    return `already contacted this phone within ${COOLDOWN_HOURS}h`;
  }
  return "a draft or send is already in flight for this phone";
}

function sendEnglish(code: string, message: string): string {
  switch (code) {
    case "cooldown":
      return `Stopped. This customer was already contacted within ${COOLDOWN_HOURS} hours.`;
    case "stale_draft":
      return "Stopped. They replied after this draft was written. Make a new draft.";
    case "not_open":
      return "Stopped. This quote is accepted or dismissed. We never SMS those.";
    case "not_approved":
      return "Stopped. Send only works on approved drafts. Approve first.";
    case "bad_phone":
      return "Stopped. Phone number is not E.164-ish (expected + and digits).";
    case "in_flight":
      return "Stopped. Another message for this phone is already in flight.";
    default:
      return message;
  }
}

function row(cols: string[]): string {
  const widths = [10, 16, 10, 48];
  return cols.map((col, i) => pad(col, widths[i] ?? 16)).join(" ");
}
