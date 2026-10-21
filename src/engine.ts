import type { Now } from "./clock.ts";
import { ENGINE_TOP_N } from "./config.ts";
import type { Db } from "./db.ts";
import { ensureDraft } from "./drafts.ts";
import { loadSeed } from "./ingest.ts";
import { evaluateFromDb, type SuppressReason } from "./policy.ts";
import { readQuotes } from "./project.ts";
import type { Signal } from "./types.ts";

export type EngineResult = {
  now: Now;
  drafted_because: Array<{
    quote_id: string;
    draft_id: string;
    created: boolean;
    primary: Signal;
    reasons: Signal[];
  }>;
  suppressed_because: Array<{
    quote_id: string;
    reasons: Signal[];
    suppressedBecause: SuppressReason[];
  }>;
};

/**
 * Ingest if needed, rank, draft top N. Never approve or send.
 */
export function run(
  db: Db,
  now: Now,
  options: { topN?: number } = {},
): EngineResult {
  loadSeed(db);
  const topN = options.topN ?? ENGINE_TOP_N;
  const policy = evaluateFromDb(db, now);
  const quotes = new Map(readQuotes(db).map((quote) => [quote.id, quote]));

  const drafted_because: EngineResult["drafted_because"] = [];
  for (const candidate of policy.actionable.slice(0, topN)) {
    const quote = quotes.get(candidate.quote_id);
    if (!quote) continue;
    const { draft, created } = ensureDraft(db, quote, candidate, now);
    drafted_because.push({
      quote_id: candidate.quote_id,
      draft_id: draft.id,
      created,
      primary: candidate.primary,
      reasons: candidate.reasons,
    });
  }

  return {
    now,
    drafted_because,
    suppressed_because: policy.suppressed.map((row) => ({
      quote_id: row.quote_id,
      reasons: row.reasons,
      suppressedBecause: row.suppressedBecause,
    })),
  };
}

