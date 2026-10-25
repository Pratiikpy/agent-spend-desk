/**
 * Simulator for the canary statistic (spec 16.5). It generates canary histories with per-task success
 * rates, cluster effects, error rates and a control arm, injects regressions of known size, and feeds the
 * result to the same `evaluateAt` the product runs. Assumptions are listed in
 * docs/verification/canary-simulation.md next to the results; they are assumptions, not measurements of
 * any real agent.
 */
import { eProcessOverArm, taskWatchOverArm } from "./eprocess.ts";
import { Rng } from "./rng.ts";
import { EMPTY_CELL, type ArmSeries, type Cell, type Series } from "./series.ts";
import { clopperPearson, tQuantile } from "./stats.ts";
import { DEFAULT_CONFIG, compareWindow, evaluateAt, makeContext, type Verdict, type VerdictConfig } from "./verdict.ts";
import { Prefix } from "./series.ts";

export interface SimParams {
  tasks: number;
  clusters: number;
  repeats: number;
  days: number;
  beta: readonly [number, number];
  pLow: number;
  pHigh: number;
  /** Standard deviation, on the logit scale, of a shock shared by all tasks of a cluster for one 7-day block. */
  shockSd: number;
  /** Share of attempts that fail for reasons that are not the agent's (infra, refusals, grader). */
  errorRate: number;
  control: { tasks: number; repeats: number; shockSd: number } | null;
  drop: Injection | null;
}

export interface Injection {
  /** First day on which the drop applies (day 15 is the first day after the baseline). */
  start: number;
  /** Size in score points on tasks that are hit. */
  size: number;
  /** Share of primary tasks hit. */
  fraction: number;
  /** Size of the drop injected on the control arm too (a platform event). */
  controlSize: number;
  /** Hit exactly one task, hard (to near zero). */
  oneTask: boolean;
}

export const DEFAULT_SIM: SimParams = {
  tasks: 52,
  clusters: 13,
  repeats: 1,
  days: 90,
  beta: [3.6, 2.4],
  pLow: 0.2,
  pHigh: 0.85,
  shockSd: 0.3,
  errorRate: 0.01,
  control: { tasks: 26, repeats: 1, shockSd: 0.3 },
  drop: null,
};

const expit = (x: number): number => 1 / (1 + Math.exp(-x));
const logit = (p: number): number => Math.log(p / (1 - p));

function drawBase(rng: Rng, p: SimParams): number {
  for (;;) {
    const x = rng.beta(p.beta[0], p.beta[1]);
    if (x >= p.pLow && x <= p.pHigh) return x;
  }
}

function hitTasks(n: number, fraction: number, oneTask: boolean): Set<number> {
  const hit = new Set<number>();
  if (oneTask) {
    hit.add(0);
    return hit;
  }
  for (let i = 0; i < n; i += 1) if ((i * 0.6180339887498949) % 1 < fraction) hit.add(i);
  return hit;
}

function makeArm(prefix: string, rng: Rng, tasks: number, clusters: number, repeats: number, days: number, shockSd: number, errorRate: number, p: SimParams, drop: { start: number; size: number; hit: Set<number>; hard: boolean } | null): ArmSeries {
  const base = Array.from({ length: tasks }, () => drawBase(rng, p));
  const blocks = Math.ceil(days / 7);
  const shocks = Array.from({ length: clusters }, () => Array.from({ length: blocks }, () => rng.normal() * shockSd));
  const cells: Cell[][] = [];
  for (let i = 0; i < tasks; i += 1) {
    const row: Cell[] = [];
    const g = i % clusters;
    for (let day = 1; day <= days; day += 1) {
      let pe = expit(logit(base[i] as number) + (shocks[g]![Math.floor((day - 1) / 7)] as number));
      if (drop && day >= drop.start && drop.hit.has(i)) pe = drop.hard ? 0.02 : Math.max(0.01, pe - drop.size);
      const err = rng.binomial(repeats, errorRate);
      const scored = repeats - err;
      const succ = rng.binomial(scored, pe);
      row.push({ ...EMPTY_CELL, n: scored, sum: succ, sumSq: succ, err, total: repeats, passes: succ });
    }
    cells.push(row);
  }
  return {
    taskIds: Array.from({ length: tasks }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`),
    cluster: Array.from({ length: tasks }, (_, i) => `g${i % clusters}`),
    held: Array.from({ length: tasks }, (_, i) => Math.floor(i / clusters) % 2 === 1),
    cells,
  };
}

export function simulateHistory(params: SimParams, rng: Rng): Series {
  const d = params.drop;
  const hit = d ? hitTasks(params.tasks, d.fraction, d.oneTask) : new Set<number>();
  const primary = makeArm("t", rng.child(1), params.tasks, params.clusters, params.repeats, params.days, params.shockSd, params.errorRate, params, d ? { start: d.start, size: d.size, hit, hard: d.oneTask } : null);
  let control: ArmSeries | null = null;
  if (params.control) {
    const c = params.control;
    const chit = hitTasks(c.tasks, 1, false);
    control = makeArm("c", rng.child(2), c.tasks, c.tasks, c.repeats, params.days, c.shockSd, params.errorRate, params, d && d.controlSize > 0 ? { start: d.start, size: d.controlSize, hit: chit, hard: false } : null);
  }
  return { primary, control, days: params.days, harnessUnchanged: true, agentVersionUnchanged: true };
}

export function historyRng(seed: number, index: number): Rng {
  return new Rng((Math.imul(seed >>> 0, 1000003) + Math.imul(index, 2654435761)) >>> 0);
}

// ---------------------------------------------------------------------------------------------
// Studies
// ---------------------------------------------------------------------------------------------

export interface CoverageResult {
  clusters: number;
  method: string;
  replications: number;
  trueDelta: number;
  coverage: number;
  /** Exact 95% interval for the coverage itself. */
  coverageCi: { low: number; high: number };
  meanHalfWidth: number;
}

/** Coverage of the 99% interval for one window against the baseline, truth = minus the injected size on all tasks. */
export function coverageStudy(opts: { clusters: number; method: VerdictConfig["ciMethod"]; replications: number; seed: number; size: number; params?: Partial<SimParams> }): CoverageResult {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ciMethod: opts.method };
  const params: SimParams = { ...DEFAULT_SIM, ...opts.params, clusters: opts.clusters, days: 21, control: null, drop: opts.size > 0 ? { start: 15, size: opts.size, fraction: 1, controlSize: 0, oneTask: false } : null };
  let covered = 0;
  let done = 0;
  let hw = 0;
  for (let r = 0; r < opts.replications; r += 1) {
    const s = simulateHistory(params, historyRng(opts.seed, r));
    const prefix = new Prefix(s.primary, s.days);
    const cmp = compareWindow(prefix, s.primary, 15, 21, cfg);
    if (!cmp) continue;
    done += 1;
    if (cmp.ci.low <= -opts.size && -opts.size <= cmp.ci.high) covered += 1;
    hw += (cmp.ci.high - cmp.ci.low) / 2;
  }
  return { clusters: opts.clusters, method: opts.method, replications: done, trueDelta: -opts.size, coverage: covered / done, coverageCi: clopperPearson(covered, done), meanHalfWidth: hw / done };
}

export interface FalseAlarmResult {
  histories: number;
  days: number;
  regressed: number;
  improved: number;
  harnessOrPlatform: number;
  /** Histories with a `regressed` verdict at some daily evaluation. */
  regressedUpper95: number;
  oneTask: number;
  steadyShare: number;
}

export function falseAlarmStudy(opts: { histories: number; seed: number; cfg?: Partial<VerdictConfig>; params?: Partial<SimParams> }): FalseAlarmResult {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: null };
  let reg = 0;
  let imp = 0;
  let hp = 0;
  let one = 0;
  let steady = 0;
  let evals = 0;
  for (let h = 0; h < opts.histories; h += 1) {
    const s = simulateHistory(params, historyRng(opts.seed, h));
    const ctx = makeContext(s);
    let r = false;
    let i = false;
    let p = false;
    let o = false;
    for (let t = 28; t <= s.days; t += 1) {
      const v = evaluateAt(ctx, t, cfg);
      evals += 1;
      if (v.verdict === "steady") steady += 1;
      if (v.verdict === "regressed") r = true;
      if (v.verdict === "improved") i = true;
      if (v.verdict === "harness_or_platform") p = true;
      if (v.reason === "rests_on_one_task") o = true;
    }
    if (r) reg += 1;
    if (i) imp += 1;
    if (p) hp += 1;
    if (o) one += 1;
  }
  return { histories: opts.histories, days: params.days, regressed: reg, improved: imp, harnessOrPlatform: hp, regressedUpper95: clopperPearson(reg, opts.histories).high, oneTask: one, steadyShare: steady / evals };
}

export interface SteadyRow {
  size: number;
  fraction: number;
  evaluations: number;
  steady: number;
  inconclusive: number;
  regressed: number;
  harnessOrPlatform: number;
}

/**
 * What the verdict says on each day from day 28 when a change of a known size is, or is not, real. `steady` is a claim that no change at least as large as the
 * detectable change is compatible with the data; counting how often it is said while a change is real shows what that claim costs.
 */
export function steadyStudy(opts: { cases: readonly { size: number; fraction: number }[]; histories: number; seed: number; cfg?: Partial<VerdictConfig>; params?: Partial<SimParams> }): SteadyRow[] {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  return opts.cases.map(({ size, fraction }) => {
    const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: size === 0 ? null : { start: 15, size, fraction, controlSize: 0, oneTask: false } };
    const count = { steady: 0, inconclusive: 0, regressed: 0, harness_or_platform: 0, improved: 0 };
    let evaluations = 0;
    for (let h = 0; h < opts.histories; h += 1) {
      const s = simulateHistory(params, historyRng(opts.seed, h));
      const ctx = makeContext(s);
      for (let t = 28; t <= s.days; t += 1) {
        count[evaluateAt(ctx, t, cfg).verdict] += 1;
        evaluations += 1;
      }
    }
    const share = (n: number): number => n / evaluations;
    return { size, fraction, evaluations, steady: share(count.steady), inconclusive: share(count.inconclusive), regressed: share(count.regressed), harnessOrPlatform: share(count.harness_or_platform) };
  });
}

export interface PowerRow {
  size: number;
  fraction: number;
  /** True mean change across all tasks, in points. */
  trueDelta: number;
  histories: number;
  /** Share of histories called `regressed` at the earliest possible call, day 28. */
  calledDay28: number;
  calledByDay42: number;
  calledByDay90: number;
  /** Median day (after onset at day 15) of the first `regressed`, over detected histories. */
  medianDaysFromOnset: number | null;
  /** Share whose first primary signal was downgraded to harness_or_platform by a control that did not move for real. */
  downgradedByControl: number;
  meanMde: number;
  meanMdeVerdict: number;
  meanMdeFormula: number;
}

export function powerStudy(opts: { sizes: readonly number[]; fractions: readonly number[]; histories: number; seed: number; cfg?: Partial<VerdictConfig>; params?: Partial<SimParams> }): PowerRow[] {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  const rows: PowerRow[] = [];
  for (const fraction of opts.fractions) {
    for (const size of opts.sizes) {
      const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: { start: 15, size, fraction, controlSize: 0, oneTask: false } };
      let d28 = 0;
      let d42 = 0;
      let d90 = 0;
      let down = 0;
      let primaryFired = 0;
      const days: number[] = [];
      let mde = 0;
      let mdev = 0;
      let mdef = 0;
      let mdeN = 0;
      for (let h = 0; h < opts.histories; h += 1) {
        const s = simulateHistory(params, historyRng(opts.seed, h));
        const ctx = makeContext(s);
        const noControl = makeContext({ ...s, control: null });
        let first: number | null = null;
        let firstPrimary: number | null = null;
        for (let t = 28; t <= s.days; t += 1) {
          if (firstPrimary === null) {
            const pv = evaluateAt(noControl, t, { ...cfg, requireControl: false });
            if (pv.verdict === "regressed") firstPrimary = t;
          }
          const v = evaluateAt(ctx, t, cfg);
          if (t === 28) {
            mde += v.mde ?? 0;
            mdev += v.mdeVerdict ?? 0;
            mdef += v.mdeFormula ?? 0;
            mdeN += 1;
          }
          if (v.verdict === "regressed" && first === null) first = t;
          if (first !== null && firstPrimary !== null) break;
        }
        if (first !== null) {
          if (first === 28) d28 += 1;
          if (first <= 42) d42 += 1;
          d90 += 1;
          days.push(first - 14);
        }
        if (firstPrimary !== null) {
          primaryFired += 1;
          const v = evaluateAt(ctx, firstPrimary, cfg);
          if (v.verdict === "harness_or_platform") down += 1;
        }
      }
      days.sort((a, b) => a - b);
      rows.push({
        size,
        fraction,
        trueDelta: -size * fraction,
        histories: opts.histories,
        calledDay28: d28 / opts.histories,
        calledByDay42: d42 / opts.histories,
        calledByDay90: d90 / opts.histories,
        medianDaysFromOnset: days.length ? (days[Math.floor(days.length / 2)] as number) : null,
        downgradedByControl: primaryFired === 0 ? 0 : down / primaryFired,
        meanMde: mde / mdeN,
        meanMdeVerdict: mdev / mdeN,
        meanMdeFormula: mdef / mdeN,
      });
    }
  }
  return rows;
}

export interface SingleWindowRow {
  size: number;
  histories: number;
  /** Share of histories whose latest 99% window interval excludes zero (day 21, first window). */
  excludesZero: number;
  meanMde: number;
  meanMdeFormula: number;
}

/** Power of one window alone, to check the published single-window MDE against its 80% definition. */
export function singleWindowStudy(opts: { sizes: readonly number[]; histories: number; seed: number; cfg?: Partial<VerdictConfig>; params?: Partial<SimParams> }): SingleWindowRow[] {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  const out: SingleWindowRow[] = [];
  for (const size of opts.sizes) {
    const params: SimParams = { ...DEFAULT_SIM, ...opts.params, days: 21, control: null, drop: { start: 15, size, fraction: 1, controlSize: 0, oneTask: false } };
    let ex = 0;
    let mde = 0;
    let mdef = 0;
    let n = 0;
    for (let h = 0; h < opts.histories; h += 1) {
      const s = simulateHistory(params, historyRng(opts.seed, h));
      const cmp = compareWindow(new Prefix(s.primary, s.days), s.primary, 15, 21, cfg);
      if (!cmp) continue;
      n += 1;
      if (cmp.ci.high < 0) ex += 1;
      mde += cmp.mde;
      mdef += cmp.mdeFormula;
    }
    out.push({ size, histories: n, excludesZero: ex / n, meanMde: mde / n, meanMdeFormula: mdef / n });
  }
  return out;
}

export interface PlatformRow {
  size: number;
  histories: number;
  /** Histories where the primary signal alone would have called `regressed`. */
  primaryFired: number;
  /** Of those, the share the control arm turned into harness_or_platform at the first firing. */
  labelledPlatform: number;
  /** Of those, the share still called `regressed` at the first firing (the control missed the platform event). */
  stillRegressed: number;
}

export function platformStudy(opts: { sizes: readonly number[]; histories: number; seed: number; cfg?: Partial<VerdictConfig>; params?: Partial<SimParams> }): PlatformRow[] {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  const rows: PlatformRow[] = [];
  for (const size of opts.sizes) {
    const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: { start: 15, size, fraction: 1, controlSize: size, oneTask: false } };
    let fired = 0;
    let plat = 0;
    let still = 0;
    for (let h = 0; h < opts.histories; h += 1) {
      const s = simulateHistory(params, historyRng(opts.seed, h));
      const ctx = makeContext(s);
      const noControl = makeContext({ ...s, control: null });
      for (let t = 28; t <= s.days; t += 1) {
        const pv = evaluateAt(noControl, t, { ...cfg, requireControl: false });
        if (pv.verdict === "regressed") {
          fired += 1;
          const v = evaluateAt(ctx, t, cfg);
          if (v.verdict === "harness_or_platform") plat += 1;
          if (v.verdict === "regressed") still += 1;
          break;
        }
      }
    }
    rows.push({ size, histories: opts.histories, primaryFired: fired, labelledPlatform: fired ? plat / fired : NaN, stillRegressed: fired ? still / fired : NaN });
  }
  return rows;
}

export interface OneTaskRow {
  histories: number;
  regressedEver: number;
  oneTaskAtDay28: number;
  oneTaskByDay42: number;
}

export function oneTaskStudy(opts: { histories: number; seed: number; cfg?: Partial<VerdictConfig>; params?: Partial<SimParams> }): OneTaskRow {
  const cfg: VerdictConfig = { ...DEFAULT_CONFIG, ...opts.cfg };
  const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: { start: 15, size: 0.9, fraction: 0, controlSize: 0, oneTask: true } };
  let reg = 0;
  let d28 = 0;
  let d42 = 0;
  for (let h = 0; h < opts.histories; h += 1) {
    const s = simulateHistory(params, historyRng(opts.seed, h));
    const ctx = makeContext(s);
    let seen42 = false;
    for (let t = 28; t <= s.days; t += 1) {
      const v: Verdict = evaluateAt(ctx, t, cfg);
      if (v.verdict === "regressed") {
        reg += 1;
        break;
      }
      if (t === 28 && v.reason === "rests_on_one_task") d28 += 1;
      if (t <= 42 && v.reason === "rests_on_one_task") seen42 = true;
    }
    if (seen42) d42 += 1;
  }
  return { histories: opts.histories, regressedEver: reg, oneTaskAtDay28: d28, oneTaskByDay42: d42 };
}

// --- e-process studies -----------------------------------------------------------------------

export interface EProcessNullResult {
  histories: number;
  days: number;
  flagged: number;
  upper95: number;
}

/** The pure martingale null: daily differences with mean exactly zero and a known baseline, `days` days long. */
export function eProcessKnownBaselineNull(opts: { histories: number; days: number; seed: number }): EProcessNullResult {
  let flagged = 0;
  for (let h = 0; h < opts.histories; h += 1) {
    const rng = historyRng(opts.seed, h);
    const p = 0.6;
    const n = 120;
    let wealth = 1;
    let count = 0;
    let mean = 0;
    let m2 = 0;
    let hit = false;
    for (let day = 1; day <= opts.days; day += 1) {
      const succ = rng.binomial(n, p);
      const d = p - succ / n;
      const variance = count >= 2 ? m2 / (count - 1) : NaN;
      const lambda = Number.isFinite(variance) ? Math.min(0.5, Math.max(0, mean / (variance + 1e-3))) : 0;
      wealth *= 1 + lambda * d;
      count += 1;
      const delta = d - mean;
      mean += delta / count;
      m2 += delta * (d - mean);
      if (day >= 7 && wealth >= 20) {
        hit = true;
        break;
      }
    }
    if (hit) flagged += 1;
  }
  return { histories: opts.histories, days: opts.days, flagged, upper95: clopperPearson(flagged, opts.histories).high };
}

export function eProcessEstimatedBaselineNull(opts: { histories: number; seed: number; params?: Partial<SimParams> }): EProcessNullResult & { taskFlagHistories: number } {
  const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: null };
  let flagged = 0;
  let taskFlagged = 0;
  for (let h = 0; h < opts.histories; h += 1) {
    const s = simulateHistory(params, historyRng(opts.seed, h));
    if (eProcessOverArm(s.primary, s.days).some((st) => st.watch)) flagged += 1;
    if (taskWatchOverArm(s.primary, s.days).some((w) => w.flagged.length > 0)) taskFlagged += 1;
  }
  return { histories: opts.histories, days: params.days, flagged, upper95: clopperPearson(flagged, opts.histories).high, taskFlagHistories: taskFlagged };
}

export interface EProcessPowerRow {
  size: number;
  histories: number;
  flagged: number;
  medianDay: number | null;
}

export function eProcessPower(opts: { sizes: readonly number[]; histories: number; seed: number; params?: Partial<SimParams> }): EProcessPowerRow[] {
  const rows: EProcessPowerRow[] = [];
  for (const size of opts.sizes) {
    const params: SimParams = { ...DEFAULT_SIM, ...opts.params, drop: { start: 15, size, fraction: 1, controlSize: 0, oneTask: false } };
    const days: number[] = [];
    for (let h = 0; h < opts.histories; h += 1) {
      const s = simulateHistory(params, historyRng(opts.seed, h));
      const w = eProcessOverArm(s.primary, s.days).find((st) => st.watch);
      if (w) days.push(w.day);
    }
    days.sort((a, b) => a - b);
    rows.push({ size, histories: opts.histories, flagged: days.length, medianDay: days.length ? (days[Math.floor(days.length / 2)] as number) : null });
  }
  return rows;
}

/** Helper used by the report: the exact t critical value at the clusters in play. */
export function critical(g: number, level = 0.99): number {
  return tQuantile(1 - (1 - level) / 2, g - 1);
}
