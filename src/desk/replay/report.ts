import { judgeDelta, pairedBootstrap, type Delta, type PairedVerdict } from "../stats/paired.ts";
import type { ItemResult, ItemStatus } from "./agent.ts";

/**
 * What a swap found (DF-042). The baseline route is run on the tasks first, and nothing is said about the candidate unless the baseline reproduces the work: on the tasks
 * whose recorded result was a pass, the baseline has to pass at least 90% of the time, or its failures say more about the tasks and the harness than about any route. Then each
 * task's pass rate on the two routes is compared, with an interval that resamples clusters of tasks, against a margin of 5 points, and the verdict is read from the interval.
 *
 * Every item that did not give a comparable score is counted and said: a model that asked for something that could change the world (`diverged`), a call that failed (`error`),
 * and an item that was not run because a cap was reached. They are never turned into passes or into failures, and a result that rests on a partial cohort says so.
 */
export const SWAP_PARAMS = { reproductionGate: 0.9, marginPoints: 5, resamples: 10_000, seed: 20261102, minClustersForEquivalence: 8 } as const;

export interface TaskMeta {
  taskId: string;
  kind: string;
  area: string;
  oracle: "strong" | "weak";
}

export interface RouteSummary {
  route: string;
  items: number;
  /** Items with a score: passed, failed, or ran out of a limit and were graded as they stood. */
  scored: number;
  passes: number;
  rate: number | null;
  diverged: number;
  errors: number;
  /** Mean tokens, in plus out, of a scored item. */
  tokensPerItem: number | null;
  turnsPerItem: number | null;
  secondsPerItem: number | null;
}

export interface KindRow {
  kind: string;
  tasks: number;
  baseline: number | null;
  candidate: number | null;
}

export interface SwapReport {
  baseline: string;
  candidate: string;
  margin: number;
  gate: { rate: number | null; scored: number; required: number; met: boolean };
  /** Whether the pairs were clustered by family or by task, and how many clusters there were. */
  clusters: { by: "family" | "task"; count: number };
  tasksPaired: number;
  delta: Delta | null;
  verdict: PairedVerdict | "withheld";
  why: string;
  routes: RouteSummary[];
  /** Mean tokens per scored item on each route, and the share the candidate saves, negative when it costs more. */
  tokens: { baseline: number | null; candidate: number | null; saved: number | null };
  byKind: KindRow[];
  /** Tasks whose pass criterion has no test that failed before the work: reported apart and never in the headline. */
  weak: { tasks: number; baseline: number | null; candidate: number | null };
  notComparable: { diverged: number; errors: number; notRun: number; tasksWithoutAPair: number };
  partial: boolean;
}

const SCORED: readonly ItemStatus[] = ["pass", "fail", "over_budget"];
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

function summarise(route: string, items: readonly ItemResult[]): RouteSummary {
  const scored = items.filter((i) => SCORED.includes(i.status));
  const passes = scored.filter((i) => i.status === "pass").length;
  return {
    route,
    items: items.length,
    scored: scored.length,
    passes,
    rate: scored.length === 0 ? null : passes / scored.length,
    diverged: items.filter((i) => i.status === "diverged").length,
    errors: items.filter((i) => i.status === "error").length,
    tokensPerItem: mean(scored.map((i) => i.tokensIn + i.tokensOut)),
    turnsPerItem: mean(scored.map((i) => i.turns)),
    secondsPerItem: mean(scored.map((i) => i.ms / 1000)),
  };
}

/** A task's pass rate on a route over its scored repeats, or null when none was scored. */
function taskRate(items: readonly ItemResult[], taskId: string): number | null {
  const mine = items.filter((i) => i.taskId === taskId && SCORED.includes(i.status));
  return mine.length === 0 ? null : mine.filter((i) => i.status === "pass").length / mine.length;
}

export function reportSwap(o: { tasks: readonly TaskMeta[]; items: readonly ItemResult[]; baseline: string; candidate: string; planned: number; margin?: number; gate?: number; resamples?: number; seed?: number }): SwapReport {
  const margin = o.margin ?? SWAP_PARAMS.marginPoints;
  const required = o.gate ?? SWAP_PARAMS.reproductionGate;
  const base = o.items.filter((i) => i.route === o.baseline);
  const cand = o.items.filter((i) => i.route === o.candidate);
  const strong = o.tasks.filter((t) => t.oracle === "strong");
  const weak = o.tasks.filter((t) => t.oracle === "weak");
  const strongIds = new Set(strong.map((t) => t.taskId));
  const baseStrong = base.filter((i) => strongIds.has(i.taskId));
  const candStrong = cand.filter((i) => strongIds.has(i.taskId));
  const rep = summarise(o.baseline, baseStrong);
  const gate = { rate: rep.rate, scored: rep.scored, required, met: rep.rate !== null && rep.rate >= required };

  const pairsRaw: { task: TaskMeta; a: number; b: number }[] = [];
  let withoutPair = 0;
  for (const t of strong) {
    const a = taskRate(baseStrong, t.taskId);
    const b = taskRate(candStrong, t.taskId);
    if (a === null || b === null) withoutPair += 1;
    else pairsRaw.push({ task: t, a, b });
  }
  const families = new Set(pairsRaw.map((p) => `${p.task.kind}/${p.task.area}`));
  const by: "family" | "task" = families.size >= 3 ? "family" : "task";
  const pairs = pairsRaw.map((p) => ({ cluster: by === "family" ? `${p.task.kind}/${p.task.area}` : p.task.taskId, a: p.a, b: p.b }));
  const delta = pairedBootstrap(pairs, o.resamples ?? SWAP_PARAMS.resamples, o.seed ?? SWAP_PARAMS.seed, { smallSample: true });

  let verdict: SwapReport["verdict"];
  let why: string;
  if (!gate.met) {
    verdict = "withheld";
    why = `the baseline route passed ${gate.rate === null ? "none of" : `${(100 * gate.rate).toFixed(1)}% of`} the ${gate.scored} scored runs of tasks whose recorded result was a pass, under the ${(100 * required).toFixed(0)}% a comparison needs, so a difference from it says more about the tasks and the harness than about the candidate`;
  } else if (delta === null) {
    verdict = "withheld";
    why = "no task has a score on both routes";
  } else {
    const j = judgeDelta(delta, margin);
    const groups = new Set(pairs.map((p) => p.cluster)).size;
    if (j.verdict === "equivalent" && groups < SWAP_PARAMS.minClustersForEquivalence) {
      verdict = "inconclusive";
      why = `the interval, ${delta.low.toFixed(1)} to ${delta.high.toFixed(1)} points, lies inside plus or minus ${margin}, but only ${groups} cluster${groups === 1 ? "" : "s"} of tasks stand behind it and equivalence needs at least ${SWAP_PARAMS.minClustersForEquivalence}: with so few, two routes that agree on every task so far could still differ on the next`;
    } else {
      verdict = j.verdict;
      why = j.why;
    }
  }

  const kinds = [...new Set(pairsRaw.map((p) => p.task.kind))].sort();
  const byKind: KindRow[] = kinds.map((k) => {
    const rows = pairsRaw.filter((p) => p.task.kind === k);
    return { kind: k, tasks: rows.length, baseline: mean(rows.map((r) => r.a)), candidate: mean(rows.map((r) => r.b)) };
  });
  const weakIds = new Set(weak.map((t) => t.taskId));
  const wb = o.items.filter((i) => i.route === o.baseline && weakIds.has(i.taskId));
  const wc = o.items.filter((i) => i.route === o.candidate && weakIds.has(i.taskId));
  const tb = rep.tokensPerItem;
  const tc = summarise(o.candidate, candStrong).tokensPerItem;
  const ran = o.items.length;
  return {
    baseline: o.baseline,
    candidate: o.candidate,
    margin,
    gate,
    clusters: { by, count: new Set(pairs.map((p) => p.cluster)).size },
    tasksPaired: pairs.length,
    delta,
    verdict,
    why,
    routes: [summarise(o.baseline, base), summarise(o.candidate, cand)],
    tokens: { baseline: tb, candidate: tc, saved: tb !== null && tc !== null && tb > 0 ? (tb - tc) / tb : null },
    byKind,
    weak: { tasks: weak.length, baseline: mean(wb.filter((i) => SCORED.includes(i.status)).map((i) => (i.status === "pass" ? 1 : 0))), candidate: mean(wc.filter((i) => SCORED.includes(i.status)).map((i) => (i.status === "pass" ? 1 : 0))) },
    notComparable: { diverged: o.items.filter((i) => i.status === "diverged").length, errors: o.items.filter((i) => i.status === "error").length, notRun: Math.max(0, o.planned - ran), tasksWithoutAPair: withoutPair },
    partial: ran < o.planned,
  };
}

const pct = (x: number | null): string => (x === null ? "no score" : `${(100 * x).toFixed(1)}%`);

export function renderSwap(r: SwapReport): string {
  const lines = [`Swap: ${r.candidate} against ${r.baseline}, on ${r.tasksPaired} task${r.tasksPaired === 1 ? "" : "s"} (clusters: ${r.clusters.count} by ${r.clusters.by}).`];
  lines.push(`reproduction: ${r.baseline} passed ${pct(r.gate.rate)} of ${r.gate.scored} scored runs; it needs ${(100 * r.gate.required).toFixed(0)}%: ${r.gate.met ? "met" : "NOT met"}.`);
  for (const s of r.routes) lines.push(`  ${s.route}: ${pct(s.rate)} of ${s.scored} scored (${s.items} run${s.items === 1 ? "" : "s"}; ${s.diverged} diverged, ${s.errors} errors); ${s.tokensPerItem === null ? "no tokens" : `${Math.round(s.tokensPerItem).toLocaleString("en-US")} tokens`} and ${s.turnsPerItem === null ? "no" : s.turnsPerItem.toFixed(1)} turns a run`);
  if (r.delta) lines.push(`difference, candidate minus baseline: ${r.delta.points.toFixed(1)} points, 95% interval ${r.delta.low.toFixed(1)} to ${r.delta.high.toFixed(1)} (clusters resampled, ${SWAP_PARAMS.resamples.toLocaleString("en-US")} draws, widened for the number of clusters)`);
  lines.push(`verdict: ${r.verdict}: ${r.why}`);
  if (r.tokens.saved !== null) lines.push(`tokens a run: ${Math.round(r.tokens.baseline as number).toLocaleString("en-US")} on the baseline, ${Math.round(r.tokens.candidate as number).toLocaleString("en-US")} on the candidate: ${r.tokens.saved >= 0 ? `${(100 * r.tokens.saved).toFixed(0)}% fewer` : `${(-100 * r.tokens.saved).toFixed(0)}% more`}`);
  for (const k of r.byKind) lines.push(`  ${k.kind}: ${k.tasks} task${k.tasks === 1 ? "" : "s"}; baseline ${pct(k.baseline)}, candidate ${pct(k.candidate)}`);
  if (r.weak.tasks > 0) lines.push(`weak oracle, apart: ${r.weak.tasks} task${r.weak.tasks === 1 ? "" : "s"}; baseline ${pct(r.weak.baseline)}, candidate ${pct(r.weak.candidate)} (no test failed before the work, so these say only that nothing broke)`);
  const n = r.notComparable;
  if (n.diverged + n.errors + n.notRun + n.tasksWithoutAPair > 0) lines.push(`not comparable: ${n.diverged} diverged, ${n.errors} errors, ${n.notRun} not run, ${n.tasksWithoutAPair} task${n.tasksWithoutAPair === 1 ? "" : "s"} without a score on both routes. They are not in the figures above.`);
  if (r.partial) lines.push("PARTIAL: a cap was reached before every run was made; the result rests on the cohort that was run.");
  return lines.join("\n");
}
