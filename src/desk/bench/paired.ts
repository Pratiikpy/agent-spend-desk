import { clopperPearson } from "../canary/stats.ts";
import type { ArmId } from "./arms.ts";
import type { BenchRow } from "./run.ts";

/**
 * One arm against a reference on the same questions. Both arms answered every question, so the comparison is paired: only the questions on which they differ say anything
 * about the difference. `onlyReference` counts the questions the reference got right and the arm did not, `onlyArm` the reverse.
 */
export interface Paired {
  reference: ArmId;
  arm: ArmId;
  /** Questions both arms produced an answer for; one with an error in either arm is left out and counted in `excluded`. */
  pairs: number;
  excluded: number;
  both: number;
  onlyReference: number;
  onlyArm: number;
  neither: number;
  /** Exact two-sided McNemar p-value: the chance of a split at least this uneven among the differing questions if the two arms were equally likely to be right. */
  p: number;
  /** Among the questions on which the arms differ, the share the reference got right, with an exact 95% interval; null when none differ. */
  referenceShare: { value: number; low: number; high: number } | null;
}

/** P(X <= k) for X ~ Binomial(n, 1/2), summed exactly in log space so a large n cannot overflow. */
function binomialCdfHalf(k: number, n: number): number {
  let lg = 0;
  const logChoose: number[] = [0];
  for (let i = 1; i <= n; i += 1) {
    lg += Math.log(i);
    logChoose[i] = lg;
  }
  const lc = (j: number): number => (logChoose[n] as number) - (logChoose[j] as number) - (logChoose[n - j] as number);
  let sum = 0;
  for (let j = 0; j <= k; j += 1) sum += Math.exp(lc(j) - n * Math.LN2);
  return Math.min(1, sum);
}

/** The exact two-sided McNemar p-value from the two discordant counts. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomialCdfHalf(Math.min(b, c), n));
}

export function pairedAgainst(rows: readonly BenchRow[], reference: ArmId, arm: ArmId, outcome: (r: BenchRow) => boolean = (r) => r.exact): Paired {
  const byQuestion = (a: ArmId): Map<string, BenchRow> => new Map(rows.filter((r) => r.arm === a && r.trial === 0).map((r) => [r.qid, r]));
  const ref = byQuestion(reference);
  const other = byQuestion(arm);
  let both = 0;
  let onlyReference = 0;
  let onlyArm = 0;
  let neither = 0;
  let excluded = 0;
  for (const [qid, r] of ref) {
    const o = other.get(qid);
    if (!o || r.error || o.error) {
      excluded += 1;
      continue;
    }
    const x = outcome(r);
    const y = outcome(o);
    if (x && y) both += 1;
    else if (x) onlyReference += 1;
    else if (y) onlyArm += 1;
    else neither += 1;
  }
  const differing = onlyReference + onlyArm;
  const ci = differing === 0 ? null : clopperPearson(onlyReference, differing, 0.95);
  return { reference, arm, pairs: both + onlyReference + onlyArm + neither, excluded, both, onlyReference, onlyArm, neither, p: mcnemarExact(onlyReference, onlyArm), referenceShare: ci === null ? null : { value: onlyReference / differing, low: ci.low, high: ci.high } };
}
