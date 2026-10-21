/**
 * Cooldown is keyed by customer_phone, not quote id, so one human is not
 * texted twice in the window. Follow-up *reasons* still attach to the quote
 * that matched (Q-1025 can be "viewed recently" while Q-1003 is quiet).
 */
export const COOLDOWN_HOURS = 72;

/** Karen Nguyen: two open quotes, one phone. Fixture for phone-level cooldown. */
export const KAREN_PHONE = "+19175552003";
export const KAREN_QUOTE_IDS = ["Q-1003", "Q-1025"] as const;
