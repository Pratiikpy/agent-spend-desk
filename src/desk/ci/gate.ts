import { effectiveClusters, clusterInterval, clusterMean, type ClusterItem, type Interval } from "../canary/stats.ts";
import type { RunRow } from "../canary/runner.ts";
import { TASKS } from "../canary/tasks.ts";
import { resolvePrice, type PriceSnapshot } from "../pricing/pricebook.ts";

/**
 * The CI gate (DF-060): a pipeline step that fails a pull request when a change of prompt, model or harness worsens the canary suite, or raises what a
 * canary task costs past a bound, and that never declares either when the statistic does not support it.
 *
 * It compares two runs of the same tasks (the baseline, recorded on the main branch, and the candidate, run on the pull request) by paired per-task
 * differences, with the canary's own interval: tasks are the unit, clustered by the kind of skill, at the canary's 99% coverage.
 *
 *   quality   fail          the interval for the change in pass rate lies wholly below zero, the change is at least the smallest the canary calls (3 points),
 *                           and the held-out half of the tasks does not move the other way
 *             pass          the interval's lower end is above minus the smallest change that can be called: a drop that size is ruled out at 99%
 *             inconclusive  anything else: too few tasks, too many attempts with no score, a changed harness, an interval too wide to call either way
 *   cost      fail          the interval for the relative change in cost per attempt lies wholly above the bound
 *             pass          the interval lies wholly at or below the bound
 *             inconclusive  anything else, and not evaluated when a model has no price
 *
 * Exit codes: 0 pass, 1 fail, 2 could not run (bad input), 3 inconclusive. Inconclusive is never a pass.
 */
export interface CiOptions {
  baseline: readonly RunRow[];
  candidate: readonly RunRow[];
  /** Smallest drop in pass rate that counts as a regression, 0 to 1. Default 0.03. */
  minDelta?: number;
  /** Interval coverage. Default 0.99, the canary's. */
  level?: number;
  /** Attempts with no score as a share of the candidate's; at or above this, no call. Default 0.05. */
  errorRateMax?: number;
  /** Fewest tasks that may support a verdict. Default 12. */
  minTasks?: number;
  /** Largest relative rise in cost per attempt that is allowed, for example 0.10; null leaves cost ungated. */
  maxCostIncrease?: number | null;
  /** To price tokens. Without it cost is not evaluated. */
  snapshot?: PriceSnapshot | null;
}

export type CiVerdict = "pass" | "fail" | "inconclusive";

export interface TaskDelta {
  id: string;
  cluster: string;
  baseline: number;
  candidate: number;
  delta: number;
  held: boolean;
}

export interface QualityReading {
  verdict: CiVerdict;
  reason: string;
  /** Mean change in pass rate over the paired tasks, candidate minus baseline. */
  delta: number | null;
  ci: { low: number; high: number } | null;
  tasks: number;
  baselineMean: number | null;
  candidateMean: number | null;
  heldOutDelta: number | null;
  errorRate: number;
  servedModels: { baseline: string[]; candidate: string[] };
  perTask: TaskDelta[];
}

export interface CostReading {
  verdict: CiVerdict | "not_evaluated";
  reason: string;
  /** Relative change in mean cost per attempt, candidate against baseline. */
  change: number | null;
  ci: { low: number; high: number } | null;
  baselineMicros: number | null;
  candidateMicros: number | null;
  bound: number | null;
}

export interface CiResult {
  verdict: CiVerdict;
  exitCode: 0 | 1 | 3;
  quality: QualityReading;
  cost: CostReading;
  headline: string;
  notes: string[];
}

const CLUSTER_OF = new Map(TASKS.map((t) => [t.id, t.cluster as string]));
const POSITION_OF = new Map(TASKS.map((t, i) => [t.id, i]));

const primary = (rows: readonly RunRow[]): RunRow[] => rows.filter((r) => r.arm === "primary");

/** Mean score of a task over its scored attempts; null when none was scored. */
function taskMeans(rows: readonly RunRow[]): Map<string, { mean: number; n: number; total: number }> {
  const acc = new Map<string, { sum: number; n: number; total: number }>();
  for (const r of rows) {
    const a = acc.get(r.taskId) ?? { sum: 0, n: 0, total: 0 };
    a.total += 1;
    if (r.score !== null) {
      a.sum += r.score;
      a.n += 1;
    }
    acc.set(r.taskId, a);
  }
  const out = new Map<string, { mean: number; n: number; total: number }>();
  for (const [id, a] of acc) if (a.n > 0) out.set(id, { mean: a.sum / a.n, n: a.n, total: a.total });
  return out;
}

function rowCostMicros(r: RunRow, snapshot: PriceSnapshot): number | null {
  if (r.tokensIn === null || r.tokensOut === null || r.servedModel === null) return null;
  const p = resolvePrice(snapshot, r.servedModel);
  if (p.kind !== "priced") return null;
  return (r.tokensIn * p.row.inputPerMTokMicros + r.tokensOut * p.row.outputPerMTokMicros) / 1_000_000;
}

const ci = (i: Interval): { low: number; high: number } => ({ low: i.low, high: i.high });
const pts = (x: number): string => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} points`;

function quality(o: Required<Pick<CiOptions, "minDelta" | "level" | "errorRateMax" | "minTasks">> & { baseline: RunRow[]; candidate: RunRow[] }): QualityReading {
  const b = primary(o.baseline);
  const c = primary(o.candidate);
  const base = taskMeans(b);
  const cand = taskMeans(c);
  const models = (rows: RunRow[]): string[] => [...new Set(rows.map((r) => r.servedModel).filter((m): m is string => m !== null))].sort();
  const errorRate = c.length === 0 ? 0 : c.filter((r) => r.score === null).length / c.length;
  const perTask: TaskDelta[] = [];
  for (const [id, cm] of cand) {
    const bm = base.get(id);
    if (!bm) continue;
    const pos = POSITION_OF.get(id);
    perTask.push({ id, cluster: CLUSTER_OF.get(id) ?? id, baseline: bm.mean, candidate: cm.mean, delta: cm.mean - bm.mean, held: pos !== undefined && pos % 2 === 1 });
  }
  perTask.sort((x, y) => x.delta - y.delta || x.id.localeCompare(y.id));
  const empty = (verdict: CiVerdict, reason: string, extra: Partial<QualityReading> = {}): QualityReading => ({
    verdict, reason, delta: null, ci: null, tasks: perTask.length, baselineMean: null, candidateMean: null, heldOutDelta: null, errorRate, servedModels: { baseline: models(b), candidate: models(c) }, perTask, ...extra,
  });
  if (b.length === 0) return empty("inconclusive", "the baseline holds no primary-arm runs, so there is nothing to compare with");
  if (c.length === 0) return empty("inconclusive", "the candidate holds no primary-arm runs");
  const harnessB = new Set(b.map((r) => r.harness));
  const novel = [...new Set(c.map((r) => r.harness))].filter((h) => !harnessB.has(h));
  if (novel.length > 0) return empty("inconclusive", "the harness changed between the baseline and the candidate (the tasks or their checks differ), so the scores are not comparable");
  if (errorRate >= o.errorRateMax) return empty("inconclusive", `${(errorRate * 100).toFixed(0)}% of the candidate's attempts produced no score (at ${(o.errorRateMax * 100).toFixed(0)}% or more there is no call)`);
  if (perTask.length < o.minTasks) return empty("inconclusive", `only ${perTask.length} task${perTask.length === 1 ? " has" : "s have"} scores on both sides; ${o.minTasks} are the fewest that can support a call`);
  const items: ClusterItem[] = perTask.map((t) => ({ value: t.delta, cluster: t.cluster }));
  const interval = clusterInterval(items, o.level, "t");
  if (!interval) return empty("inconclusive", "the interval for the change cannot be formed from these tasks");
  const est = clusterMean(effectiveClusters(items));
  const delta = est.mean;
  const baselineMean = perTask.reduce((s, t) => s + t.baseline, 0) / perTask.length;
  const candidateMean = perTask.reduce((s, t) => s + t.candidate, 0) / perTask.length;
  const held = perTask.filter((t) => t.held);
  const heldOutDelta = held.length === 0 ? null : held.reduce((s, t) => s + t.delta, 0) / held.length;
  const reading = (verdict: CiVerdict, reason: string): QualityReading => ({ verdict, reason, delta, ci: ci(interval), tasks: perTask.length, baselineMean, candidateMean, heldOutDelta, errorRate, servedModels: { baseline: models(b), candidate: models(c) }, perTask });
  if (interval.high < 0 && delta <= -o.minDelta) {
    if (heldOutDelta !== null && heldOutDelta >= 0) return reading("inconclusive", `the pass rate fell ${pts(delta)}, but the held-out half of the tasks did not fall with it (${pts(heldOutDelta)}), so the call is not made`);
    return reading("fail", `the pass rate fell ${pts(delta)} (interval ${pts(interval.low)} to ${pts(interval.high)}), at least the smallest change that can be called (${pts(-o.minDelta)}), and the held-out half of the tasks fell too`);
  }
  if (interval.low >= -o.minDelta) {
    return reading("pass", interval.low > 0 ? `the pass rate rose ${pts(delta)} (interval ${pts(interval.low)} to ${pts(interval.high)})` : `no drop of ${(o.minDelta * 100).toFixed(0)} points or more: the interval for the change is ${pts(interval.low)} to ${pts(interval.high)}`);
  }
  return reading("inconclusive", `the change is ${pts(delta)} with an interval of ${pts(interval.low)} to ${pts(interval.high)}: it reaches below ${pts(-o.minDelta)}, so a drop that size is not ruled out, and it does not show one either`);
}

function cost(o: { baseline: RunRow[]; candidate: RunRow[]; level: number; minTasks: number; maxCostIncrease: number | null; snapshot: PriceSnapshot | null }): CostReading {
  const none = (reason: string, verdict: CostReading["verdict"] = "not_evaluated"): CostReading => ({ verdict, reason, change: null, ci: null, baselineMicros: null, candidateMicros: null, bound: o.maxCostIncrease });
  if (o.maxCostIncrease === null) return none("no cost bound was set");
  if (o.snapshot === null) return none("no price list was given, so tokens cannot be priced");
  const price = (rows: RunRow[]): Map<string, { sum: number; n: number }> | null => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const r of primary(rows)) {
      if (r.score === null) continue;
      const v = rowCostMicros(r, o.snapshot as PriceSnapshot);
      if (v === null) return null;
      const a = m.get(r.taskId) ?? { sum: 0, n: 0 };
      a.sum += v;
      a.n += 1;
      m.set(r.taskId, a);
    }
    return m;
  };
  const b = price(o.baseline);
  const c = price(o.candidate);
  if (b === null || c === null) return none("a model in these runs has no price or a run has no token count, so its cost is not priced and not guessed");
  const rows: { id: string; cluster: string; base: number; cand: number }[] = [];
  for (const [id, cm] of c) {
    const bm = b.get(id);
    if (bm) rows.push({ id, cluster: CLUSTER_OF.get(id) ?? id, base: bm.sum / bm.n, cand: cm.sum / cm.n });
  }
  if (rows.length < o.minTasks) return none(`only ${rows.length} tasks have a cost on both sides`, "inconclusive");
  const baseMean = rows.reduce((s, r) => s + r.base, 0) / rows.length;
  const candMean = rows.reduce((s, r) => s + r.cand, 0) / rows.length;
  if (!(baseMean > 0)) return none("the baseline cost is zero, so a relative change is not defined", "inconclusive");
  // The relative change in the mean, with an interval from the per-task differences scaled by the baseline mean.
  const items: ClusterItem[] = rows.map((r) => ({ value: (r.cand - r.base) / baseMean, cluster: r.cluster }));
  const interval = clusterInterval(items, o.level, "t");
  if (!interval) return none("the interval for the change in cost cannot be formed", "inconclusive");
  const change = candMean / baseMean - 1;
  const pct = (x: number): string => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)}%`;
  const reading = (verdict: CiVerdict, reason: string): CostReading => ({ verdict, reason, change, ci: ci(interval), baselineMicros: baseMean, candidateMicros: candMean, bound: o.maxCostIncrease });
  if (interval.low > o.maxCostIncrease) return reading("fail", `cost per attempt rose ${pct(change)} (interval ${pct(interval.low)} to ${pct(interval.high)}), wholly past the bound of ${pct(o.maxCostIncrease)}`);
  if (interval.high <= o.maxCostIncrease) return reading("pass", `cost per attempt changed ${pct(change)} (interval ${pct(interval.low)} to ${pct(interval.high)}), within the bound of ${pct(o.maxCostIncrease)}`);
  return reading("inconclusive", `cost per attempt changed ${pct(change)} with an interval of ${pct(interval.low)} to ${pct(interval.high)}: it reaches past the bound of ${pct(o.maxCostIncrease)} without showing that it does`);
}

export function ciGate(opts: CiOptions): CiResult {
  const minDelta = opts.minDelta ?? 0.03;
  const level = opts.level ?? 0.99;
  const errorRateMax = opts.errorRateMax ?? 0.05;
  const minTasks = opts.minTasks ?? 12;
  const baseline = [...opts.baseline];
  const candidate = [...opts.candidate];
  const q = quality({ baseline, candidate, minDelta, level, errorRateMax, minTasks });
  const k = cost({ baseline, candidate, level, minTasks, maxCostIncrease: opts.maxCostIncrease ?? null, snapshot: opts.snapshot ?? null });
  const notes: string[] = [];
  const bm = q.servedModels.baseline.join(", ") || "unknown";
  const cm = q.servedModels.candidate.join(", ") || "unknown";
  if (bm !== cm) notes.push(`the model served changed: ${bm} in the baseline, ${cm} in the candidate`);
  if (k.verdict === "not_evaluated") notes.push(`cost not evaluated: ${k.reason}`);
  const verdict: CiVerdict = q.verdict === "fail" || k.verdict === "fail" ? "fail" : q.verdict === "inconclusive" || k.verdict === "inconclusive" ? "inconclusive" : "pass";
  const parts: string[] = [];
  if (q.verdict === "fail") parts.push(`quality: ${q.reason}`);
  if (k.verdict === "fail") parts.push(`cost: ${k.reason}`);
  if (verdict === "inconclusive") for (const [name, r] of [["quality", q], ["cost", k]] as const) if (r.verdict === "inconclusive") parts.push(`${name}: ${r.reason}`);
  if (verdict === "pass") parts.push(`quality: ${q.reason}`, ...(k.verdict === "pass" ? [`cost: ${k.reason}`] : []));
  return { verdict, exitCode: verdict === "pass" ? 0 : verdict === "fail" ? 1 : 3, quality: q, cost: k, headline: `${verdict.toUpperCase()}: ${parts.join(" | ")}`, notes };
}
