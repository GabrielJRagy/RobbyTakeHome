/**
 * Wall clock for policy, cooldown, min-age, and stale-draft checks.
 * Pass `now` in. Do not call Date.now() in policy or send.
 */
export type Now = string;

/** After the latest seed event (quote_viewed Q-1026 at 2026-08-16T16:00:00Z). */
export const DEMO_NOW: Now = "2026-08-16T18:00:00Z";

export function parseNow(now: Now): Date {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid now: ${now}`);
  }
  return date;
}

export function hoursBetween(later: Now, earlier: Now): number {
  return (parseNow(later).getTime() - parseNow(earlier).getTime()) / 3_600_000;
}
