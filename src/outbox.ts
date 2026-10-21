/**
 * OutboxPort: enqueue + provider send.
 * Production: Twilio/email with the same idempotency key as the outbox row
 * (draft_id). Do not call Date.now() here for cooldown/stale-draft; take `now`.
 */
export {};
