/**
 * Cooldown is keyed by customer_phone, not quote id, so one human is not
 * texted twice in the window. Follow-up *reasons* still attach to the quote
 * that matched (Q-1025 can be "viewed recently" while Q-1003 is quiet).
 */
export const COOLDOWN_HOURS = 72;

/** Karen Nguyen: two open quotes, one phone. Fixture for phone-level cooldown. */
export const KAREN_PHONE = "+19175552003";
export const KAREN_QUOTE_IDS = ["Q-1003", "Q-1025"] as const;

/**
 * A: last view within this window, and no follow-up send after that view.
 * 48h covers "looked this morning / yesterday" without catching Q-1012's
 * older burst (last view ~72h before demo now).
 */
export const VIEW_WINDOW_HOURS = 48;

/**
 * B: amount at or above this is "large" in this seed (spread is $420–$22k;
 * $10k sits above the mid cluster of $5.2k and below the $12.5k+ jobs).
 */
export const LARGE_AMOUNT = 10_000;

/** B: no follow-up (or no quote send) in this many days, or never followed up. */
export const STALE_DAYS = 3;

/**
 * Do not B-spam a quote that has no views/replies/follow-ups yet and is
 * younger than this. Owners already just created it.
 */
export const MIN_AGE_HOURS = 24;

/** D: Q-1012 is the fixture (six views). */
export const REPEAT_VIEW_COUNT = 3;

/** SMS default; templates must stay at or under this. */
export const SMS_MAX_CHARS = 320;

/** Engine creates at most this many missing drafts per run. */
export const ENGINE_TOP_N = 10;

export const POLICY_CONFIG = {
  cooldownHours: COOLDOWN_HOURS,
  viewWindowHours: VIEW_WINDOW_HOURS,
  largeAmount: LARGE_AMOUNT,
  staleDays: STALE_DAYS,
  minAgeHours: MIN_AGE_HOURS,
  repeatViewCount: REPEAT_VIEW_COUNT,
} as const;

export type PolicyConfig = typeof POLICY_CONFIG;

/*
 * Signals we would add with more data, not implemented:
 * - quiet hours / customer timezone
 * - inbound sentiment ("stop" / price objection)
 * - delivery failure / bounce from the provider
 * - per-tech daily send cap
 * - time-to-accept conversion by amount band
 * - shop-specific "don't text this job type"
 */
