import type { Ledger } from "../ledger/db.ts";
import type { LandingState } from "./attribute.ts";

export interface LandingBreakdown {
  totalMicros: number;
  byState: Record<LandingState, { sessions: number; micros: number }>;
  /** Spend on sessions linked only by weak evidence (low confidence). Shown beside the headline, never folded into it. */
  lowConfidenceMicros: number;
}

/**
 * Estimated list-price spend split by how far each session's work got. `unlinked` is the share of money
 * that cannot be tied to any commit from the data we have; it is reported as unknowable, not as waste.
 */
export function landingBreakdown(db: Ledger, sinceIso: string, untilIso: string): LandingBreakdown {
  const out: LandingBreakdown = {
    totalMicros: 0,
    byState: { unlinked: { sessions: 0, micros: 0 }, committed: { sessions: 0, micros: 0 }, merged: { sessions: 0, micros: 0 }, kept: { sessions: 0, micros: 0 }, reverted: { sessions: 0, micros: 0 } },
    lowConfidenceMicros: 0,
  };
  const rows = db
    .prepare(
      `SELECT COALESCE(o.state, 'unlinked') AS state, o.best_confidence AS conf, m.session_id AS session_id, SUM(c.total_micros) AS micros
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.session_id`,
    )
    .all(sinceIso, untilIso) as unknown as { state: LandingState; conf: string | null; session_id: string; micros: number }[];
  for (const r of rows) {
    out.byState[r.state].sessions += 1;
    out.byState[r.state].micros += r.micros;
    out.totalMicros += r.micros;
    if (r.conf === "low") out.lowConfidenceMicros += r.micros;
  }
  return out;
}
