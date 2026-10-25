import type { Flip, FlipCertificate } from "../flip.ts";
import { formatUsd } from "../money.ts";
import type { Sensitivity } from "../pricing/sensitivity.ts";
import { decideStatus, type PeriodReconciliation } from "./reconcile.ts";

/**
 * What would flip a month's reconciliation status: each model priced as the other source prices it, one at a time, and all the disputed prices at once. The status is a
 * function of the invoice, the estimate, the tolerance and the coverage (`decideStatus`), so each candidate is that function asked again with the estimate moved by what
 * the other source's price is worth in this month's tokens. A month with no invoice, or whose estimate rests on no disputed price, has nothing to flip.
 */
export function reconciliationFlips(r: PeriodReconciliation, sensitivity: readonly Sensitivity[], otherSource: string): FlipCertificate {
  const none = (why: string): FlipCertificate => ({ subject: `${r.vendor} ${r.period}`, verdict: r.status, flips: [], smallest: null, tried: 0, candidates: 0, completeness: "complete", noneBecause: why });
  if (r.billedMicros === null || r.basis === undefined) return none("no invoice for this month");
  const billed = r.billedMicros;
  const byModel = new Map<string, number>();
  for (const s of sensitivity) byModel.set(s.model, (byModel.get(s.model) ?? 0) + s.deltaMicros);
  const flips: (Flip & { size: number })[] = [];
  const statusWith = (delta: number): { status: string; reason: string } =>
    decideStatus({ billed, estimated: r.estimatedMicros + delta, tol: r.basis!.tol, full: r.basis!.full, covered: r.basis!.covered, unmatchedBilled: r.unmatchedBilledMicros, unmatchedEstimated: r.unmatchedEstimatedMicros, unpriced: r.basis!.unpriced });
  const consider = (subject: string, change: string, delta: number): void => {
    const next = statusWith(delta);
    if (next.status !== r.status) flips.push({ kind: "swap_price", subject, change, from: r.status, to: next.status, because: next.reason, size: Math.abs(delta) });
  };
  const sign = (n: number): string => `${n >= 0 ? "+" : "-"}${formatUsd(Math.abs(n))}`;
  for (const [model, delta] of byModel) consider(model, `Price ${model} as ${otherSource} does (${sign(delta)} on this month's estimate)`, delta);
  const all = [...byModel.values()].reduce((s, d) => s + d, 0);
  if (byModel.size > 1) consider("every disputed price", `Price every disputed model as ${otherSource} does (${sign(all)} on this month's estimate)`, all);
  flips.sort((a, b) => a.size - b.size);
  const strip = (f: Flip & { size: number }): Flip => ({ kind: f.kind, subject: f.subject, change: f.change, from: f.from, to: f.to, because: f.because });
  const candidates = byModel.size + (byModel.size > 1 ? 1 : 0);
  if (candidates === 0) return none("no price the two sources disagree on applies to this month");
  return { subject: `${r.vendor} ${r.period}`, verdict: r.status, flips: flips.map(strip), smallest: flips[0] === undefined ? null : strip(flips[0]), tried: candidates, candidates, completeness: "complete" };
}
