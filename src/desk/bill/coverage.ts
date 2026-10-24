import { computeReconciliations } from "../billing/reconcile.ts";
import { vendorOf } from "../billing/import.ts";
import type { Ledger } from "../ledger/db.ts";

/**
 * Which kind of figure stands behind the dollars of a period (DF-004). The kinds are not parts of one total: an invoice, the tool's
 * own running cost and our estimate are three measurements of the same spend. So the mix says, of the estimated dollars, how many
 * fall in a month an invoice covers, how many in a process whose tool recorded its own cost, and how many have only our estimate.
 * A call is counted once, under the best kind available to it (an invoice, then the tool's own figure, then the estimate).
 */
export interface ClassCoverage {
  /** Estimated dollars of priced calls in the period. */
  totalMicros: number;
  /** In a vendor month with an imported invoice. */
  billedMicros: number;
  /** Not in such a month, but in a process that recorded its own cost. */
  reportedMicros: number;
  /** Everything else: only our list-price estimate stands behind it. */
  estimatedOnlyMicros: number;
  /** Calls on a model with no price. They have tokens and no dollars, and are not in any share. */
  unpricedCalls: number;
  calls: number;
}

const has = (db: Ledger, name: string): boolean => ((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { n: number }).n ?? 0) > 0;

export function classCoverage(db: Ledger, sinceIso: string, untilIso: string): ClassCoverage {
  const billedMonths = new Set<string>();
  if (has(db, "invoice")) for (const r of computeReconciliations(db)) if (r.billedMicros !== null) billedMonths.add(`${r.vendor}|${r.period}`);

  const total = new Map<string, number>();
  const rows = db
    .prepare(
      `SELECT substr(m.ts, 1, 7) period, m.model model, SUM(c.total_micros) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       WHERE m.ts >= ? AND m.ts <= ? GROUP BY period, m.model`,
    )
    .all(sinceIso, untilIso) as unknown as { period: string; model: string; micros: number }[];
  for (const r of rows) total.set(`${r.period}|${r.model}`, r.micros);

  const reported = new Map<string, number>();
  if (has(db, "reported_cost")) {
    const reads = db
      .prepare(
        `SELECT substr(m.ts, 1, 7) period, m.model model, SUM(c.total_micros) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
         WHERE m.ts >= ? AND m.ts <= ? AND m.session_id IN (SELECT session_id FROM reported_cost WHERE observed_ts >= ? AND observed_ts <= ?) GROUP BY period, m.model`,
      )
      .all(sinceIso, untilIso, sinceIso, untilIso) as unknown as { period: string; model: string; micros: number }[];
    for (const r of reads) reported.set(`${r.period}|${r.model}`, r.micros);
  }

  let totalMicros = 0;
  let billedMicros = 0;
  let reportedMicros = 0;
  for (const [key, micros] of total) {
    const [period, model] = key.split("|") as [string, string];
    totalMicros += micros;
    const vendor = vendorOf(model, undefined);
    if (vendor !== null && billedMonths.has(`${vendor}|${period}`)) billedMicros += micros;
    else reportedMicros += Math.min(micros, reported.get(key) ?? 0);
  }
  const counts = db
    .prepare("SELECT COUNT(*) calls, SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) unpriced FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ?")
    .get(sinceIso, untilIso) as unknown as { calls: number; unpriced: number | null };
  return { totalMicros, billedMicros, reportedMicros, estimatedOnlyMicros: totalMicros - billedMicros - reportedMicros, unpricedCalls: counts.unpriced ?? 0, calls: counts.calls };
}

/** The mix as one sentence, in the spec's order: billed, reported, estimated; unpriced calls are counted, never given a share. */
export function coverageLine(c: ClassCoverage, usd: (micros: number) => string): string {
  if (c.totalMicros === 0) return c.unpricedCalls > 0 ? `No priced call in the period; ${c.unpricedCalls} call${c.unpricedCalls === 1 ? "" : "s"} on a model with no price.` : "No call in the period.";
  const share = (m: number): string => `${((m / c.totalMicros) * 100).toFixed(1)}%`;
  const unpriced = c.unpricedCalls > 0 ? `; ${c.unpricedCalls} call${c.unpricedCalls === 1 ? " on a model with no price is" : "s on a model with no price are"} counted, not priced` : "";
  return `${usd(c.totalMicros)}: ${share(c.billedMicros)} in months an invoice covers, ${share(c.reportedMicros)} in processes that recorded their own cost, ${share(c.estimatedOnlyMicros)} only our estimate${unpriced}.`;
}
