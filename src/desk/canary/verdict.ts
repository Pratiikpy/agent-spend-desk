/**
 * The canary's regression statistic (spec 8.6), following the pre-registered rule it adopts:
 * per-task window-minus-baseline differences, a cluster-robust standard error, an interval from Student's t
 * (or a cluster bootstrap-t when there are few clusters), and a verdict of `regressed` only when every
 * condition holds in two consecutive windows. Which interval method and which control test are the defaults
 * was decided by the simulations in docs/verification/canary-simulation.md, not assumed.
 */
import { clusterInterval, clusterMean, effectiveClusters, mdeFromSe, normalQuantile, tQuantile, type ClusterItem, type Interval, type IntervalMethod, Z_POWER_80 } from "./stats.ts";
import { Prefix, type ArmSeries, type Cell, type Series } from "./series.ts";

export type VerdictKind = "steady" | "regressed" | "improved" | "inconclusive" | "harness_or_platform";

export type VerdictReason =
  | "too_early"
  | "too_few_tasks"
  | "no_comparison"
  | "invalid_data"
  | "error_rate"
  | "regression_rule_met"
  | "improvement_rule_met"
  | "harness_or_agent_version_changed"
  | "control_arm_moved"
  | "no_control_arm"
  | "rests_on_one_task"
  | "interval_wide"
  | "below_minimum_effect"
  | "within_detectable_range"
  | "not_in_both_windows"
  | "held_out_half_disagrees";

export interface VerdictConfig {
  /** Coverage of the interval, 0.99. */
  level: number;
  /** Smallest change that can be called, in score points (0.03 = 3 points). */
  minDelta: number;
  /** Errors (infra failures, refusals, grader failures) as a share of attempts; at or above this, no call. */
  errorRateMax: number;
  baselineDays: number;
  windowDays: number;
  /** Fewest tasks that may support a verdict (spec 8.2: 12 to 40 tasks). */
  minTasks: number;
  /** `auto` uses the cluster bootstrap-t when there are fewer than 10 clusters and t otherwise. */
  ciMethod: IntervalMethod | "auto";
  controlTest: "task_t" | "pooled_z";
  controlLevel: number;
  /** Without a control arm the platform confound cannot be excluded, so the strongest honest verdict is `inconclusive`. */
  requireControl: boolean;
  /** A task whose own change is at least this big in both windows, with every other task quiet, is reported as one-task. */
  oneTaskShift: number;
  /** z for the per-window power that makes a two-window call 80% likely: Phi^-1(sqrt(0.8)). */
  zPowerVerdict: number;
}

export const DEFAULT_CONFIG: VerdictConfig = {
  level: 0.99,
  minDelta: 0.03,
  errorRateMax: 0.05,
  baselineDays: 14,
  windowDays: 7,
  minTasks: 12,
  ciMethod: "t",
  controlTest: "task_t",
  controlLevel: 0.95,
  requireControl: true,
  oneTaskShift: 0.3,
  zPowerVerdict: normalQuantile(Math.sqrt(0.8)),
};

export interface WindowComparison {
  from: number;
  to: number;
  /** Tasks with scored samples in both the window and the baseline. */
  tasks: number;
  /** Per-task change, window mean minus baseline mean. */
  d: { task: number; id: string; cluster: string; value: number }[];
  delta: number;
  ci: Interval;
  /** Errors as a share of attempts in the window. */
  errorRate: number;
  /** Detectable change for one window at 80% power, from the observed standard error. */
  mde: number;
  /** Detectable change for a two-window call at 80% power. */
  mdeVerdict: number;
  /** The same quantity from the pre-registered Bernoulli variance formula, for comparison. */
  mdeFormula: number;
  /** Mean baseline score of the tasks used. */
  baselineMean: number;
}

export interface Context {
  series: Series;
  primary: Prefix;
  control: Prefix | null;
}

export function makeContext(series: Series): Context {
  return { series, primary: new Prefix(series.primary, series.days), control: series.control ? new Prefix(series.control, series.days) : null };
}

function mean(c: Cell): number {
  return c.n > 0 ? c.sum / c.n : NaN;
}

function methodFor(cfg: VerdictConfig, g: number): IntervalMethod {
  if (cfg.ciMethod === "auto") return g < 10 ? "bootstrap_t" : "t";
  return cfg.ciMethod;
}

/** Compare the window [from, to] with the frozen baseline days 1..baselineDays on the chosen tasks. */
export function compareWindow(prefix: Prefix, arm: ArmSeries, from: number, to: number, cfg: VerdictConfig, only?: ReadonlySet<number> | readonly number[], skip?: number): WindowComparison | null {
  const subset = only ? new Set(only) : null;
  const d: WindowComparison["d"] = [];
  let errW = 0;
  let totW = 0;
  let varSum = 0;
  let baseSum = 0;
  for (let i = 0; i < prefix.tasks; i += 1) {
    if (subset && !subset.has(i)) continue;
    if (skip === i) continue;
    const w = prefix.window(i, from, to);
    const b = prefix.window(i, 1, cfg.baselineDays);
    errW += w.err;
    totW += w.total;
    if (w.n === 0 || b.n === 0) continue;
    const mw = mean(w);
    const mb = mean(b);
    if (!Number.isFinite(mw) || !Number.isFinite(mb)) return null;
    d.push({ task: i, id: arm.taskIds[i] as string, cluster: arm.cluster[i] as string, value: mw - mb });
    const p = Math.min(1, Math.max(0, mb));
    varSum += p * (1 - p) * (1 / w.n + 1 / b.n);
    baseSum += mb;
  }
  if (d.length < 2) return null;
  const items: ClusterItem[] = d.map((x) => ({ value: x.value, cluster: x.cluster }));
  const g = effectiveClusters(items);
  const gCount = new Set(g.map((x) => x.cluster)).size;
  const ci = clusterInterval(items, cfg.level, methodFor(cfg, gCount));
  if (!ci) return null;
  const est = clusterMean(g);
  const tcrit = tQuantile(1 - (1 - cfg.level) / 2, Math.max(1, est.g - 1));
  return {
    from,
    to,
    tasks: d.length,
    d,
    delta: est.mean,
    ci,
    errorRate: totW === 0 ? 0 : errW / totW,
    mde: mdeFromSe(est.se, est.g, cfg.level, Z_POWER_80),
    mdeVerdict: mdeFromSe(est.se, est.g, cfg.level, cfg.zPowerVerdict),
    mdeFormula: (tcrit + Z_POWER_80) * Math.sqrt(varSum) / d.length,
    baselineMean: baseSum / d.length,
  };
}

export interface ControlReading {
  delta: number;
  low: number;
  high: number;
  tasks: number;
  /** True when the control moved in the given direction and its own interval excludes zero. */
  moved: boolean;
}

/** The control arm's change in a window, tested at `controlLevel`. */
export function controlReading(ctx: Context, from: number, to: number, direction: 1 | -1, cfg: VerdictConfig): ControlReading | null {
  if (!ctx.control || !ctx.series.control) return null;
  const arm = ctx.series.control;
  const ds: { value: number; cluster: string; v: number }[] = [];
  for (let i = 0; i < ctx.control.tasks; i += 1) {
    const w = ctx.control.window(i, from, to);
    const b = ctx.control.window(i, 1, cfg.baselineDays);
    if (w.n === 0 || b.n === 0) continue;
    const mw = w.sum / w.n;
    const mb = b.sum / b.n;
    const nAll = w.n + b.n;
    const pooledMean = (w.sum + b.sum) / nAll;
    const pooledVar = Math.max(0, (w.sumSq + b.sumSq) / nAll - pooledMean * pooledMean);
    ds.push({ value: mw - mb, cluster: arm.cluster[i] as string, v: pooledVar * (1 / w.n + 1 / b.n) });
  }
  if (ds.length < 2) return null;
  const k = ds.length;
  const delta = ds.reduce((s, x) => s + x.value, 0) / k;
  let se: number;
  let crit: number;
  if (cfg.controlTest === "task_t") {
    const est = clusterMean(ds.map((x, n) => ({ value: x.value, cluster: `c${n}` })));
    se = est.se;
    crit = tQuantile(1 - (1 - cfg.controlLevel) / 2, k - 1);
  } else {
    se = Math.sqrt(ds.reduce((s, x) => s + x.v, 0)) / k;
    crit = normalQuantile(1 - (1 - cfg.controlLevel) / 2);
  }
  if (!Number.isFinite(se)) return null;
  const low = delta - crit * se;
  const high = delta + crit * se;
  const excludes = direction === -1 ? high < 0 : low > 0;
  return { delta, low, high, tasks: k, moved: excludes && Math.sign(delta) === direction };
}

export interface Verdict {
  verdict: VerdictKind;
  reason: VerdictReason;
  /** Latest day the verdict is computed for (day 1 = first run after the pin). */
  day: number;
  /** The first day on which a call is possible after a pin: baselineDays + 2 windows. */
  earliestCallDay: number;
  delta: number | null;
  ci: { low: number; high: number } | null;
  mde: number | null;
  mdeVerdict: number | null;
  mdeFormula: number | null;
  windows: WindowComparison[];
  control: { window: number; reading: ControlReading }[];
  errorRate: number | null;
  harnessUnchanged: boolean;
  heldOutSigns: (number | null)[];
  flip: { checked: boolean; task: string | null; holdsWithout: boolean | null };
  tasksUsed: number;
  notes: string[];
}

function signOf(x: number): 1 | -1 | 0 {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function excludesZero(ci: { low: number; high: number }, dir: 1 | -1): boolean {
  return dir === -1 ? ci.high < 0 : ci.low > 0;
}

export function earliestCallDay(cfg: VerdictConfig = DEFAULT_CONFIG): number {
  return cfg.baselineDays + 2 * cfg.windowDays;
}

/** The verdict as of day `t` (1-based), from the window ending at t and the window before it. */
export function evaluateAt(ctx: Context, t: number, cfg: VerdictConfig = DEFAULT_CONFIG): Verdict {
  const earliest = earliestCallDay(cfg);
  const base: Verdict = {
    verdict: "inconclusive",
    reason: "too_early",
    day: t,
    earliestCallDay: earliest,
    delta: null,
    ci: null,
    mde: null,
    mdeVerdict: null,
    mdeFormula: null,
    windows: [],
    control: [],
    errorRate: null,
    harnessUnchanged: ctx.series.harnessUnchanged && ctx.series.agentVersionUnchanged,
    heldOutSigns: [],
    flip: { checked: false, task: null, holdsWithout: null },
    tasksUsed: 0,
    notes: [],
  };
  if (t < earliest) {
    base.notes.push(`No call is possible before day ${earliest} after a pin: ${cfg.baselineDays} baseline days plus two ${cfg.windowDays}-day windows. This is day ${t}.`);
    return base;
  }
  if (t > ctx.series.days) {
    base.reason = "no_comparison";
    base.notes.push(`Requested day ${t} but only ${ctx.series.days} days have data.`);
    return base;
  }
  const arm = ctx.series.primary;
  const w1 = compareWindow(ctx.primary, arm, t - cfg.windowDays + 1, t, cfg);
  const w0 = compareWindow(ctx.primary, arm, t - 2 * cfg.windowDays + 1, t - cfg.windowDays, cfg);
  if (!w1 || !w0) {
    base.reason = "no_comparison";
    base.notes.push("Fewer than two tasks have scored samples in both a window and the baseline.");
    return base;
  }
  const values = [w1.delta, w0.delta, w1.ci.low, w1.ci.high, w0.ci.low, w0.ci.high];
  if (values.some((v) => !Number.isFinite(v))) {
    base.reason = "invalid_data";
    base.notes.push("A non-finite value reached the statistic; no call is made.");
    return base;
  }
  base.windows = [w0, w1];
  base.delta = w1.delta;
  base.ci = { low: w1.ci.low, high: w1.ci.high };
  base.mde = w1.mde;
  base.mdeVerdict = w1.mdeVerdict;
  base.mdeFormula = w1.mdeFormula;
  base.errorRate = Math.max(w0.errorRate, w1.errorRate);
  base.tasksUsed = Math.min(w0.tasks, w1.tasks);
  if (base.tasksUsed < cfg.minTasks) {
    base.reason = "too_few_tasks";
    base.notes.push(`Only ${base.tasksUsed} tasks have scores in both windows; at least ${cfg.minTasks} are needed.`);
    return base;
  }
  if (base.errorRate >= cfg.errorRateMax) {
    base.reason = "error_rate";
    base.notes.push(`Errors (infra failures, refusals, grader failures) reached ${(base.errorRate * 100).toFixed(1)}% of attempts; the limit is ${cfg.errorRateMax * 100}%.`);
    return base;
  }

  const dir = signOf(w1.delta) === 0 ? signOf(w0.delta) : signOf(w1.delta);
  const sameDirection = dir !== 0 && signOf(w0.delta) === dir;
  const ciHolds = dir !== 0 && excludesZero(w1.ci, dir as 1 | -1) && excludesZero(w0.ci, dir as 1 | -1);
  const sizeHolds = Math.abs(w1.delta) >= cfg.minDelta && Math.abs(w0.delta) >= cfg.minDelta;

  // Held-out half: the sign must agree in both windows.
  const held = new Set<number>();
  arm.held.forEach((h, i) => {
    if (h) held.add(i);
  });
  const h1 = compareWindow(ctx.primary, arm, w1.from, w1.to, cfg, held);
  const h0 = compareWindow(ctx.primary, arm, w0.from, w0.to, cfg, held);
  base.heldOutSigns = [h0 ? signOf(h0.delta) : null, h1 ? signOf(h1.delta) : null];
  const heldHolds = !!h1 && !!h0 && signOf(h1.delta) === dir && signOf(h0.delta) === dir;

  const signal = dir !== 0 && sameDirection && ciHolds && sizeHolds;

  // One-task check: remove the task that pushes the change most and see whether the rule still holds.
  let oneTaskShifted: string | null = null;
  const shiftTasks = (w: WindowComparison): string[] => w.d.filter((x) => Math.abs(x.value) >= cfg.oneTaskShift).map((x) => x.id);
  const a1 = shiftTasks(w1);
  const a0 = shiftTasks(w0);
  if (a1.length === 1 && a0.length === 1 && a1[0] === a0[0]) {
    const sgn1 = signOf(w1.d.find((x) => x.id === a1[0])!.value);
    const sgn0 = signOf(w0.d.find((x) => x.id === a0[0])!.value);
    if (sgn1 === sgn0) oneTaskShifted = a1[0] as string;
  }

  if (!signal) {
    if (oneTaskShifted) {
      base.verdict = "inconclusive";
      base.reason = "rests_on_one_task";
      base.flip = { checked: true, task: oneTaskShifted, holdsWithout: false };
      base.notes.push(`Task ${oneTaskShifted} moved by ${cfg.oneTaskShift * 100} points or more in both windows while the others did not; one task alone is not a regression.`);
      return base;
    }
    const within = [w1, w0].every((w) => w.ci.low > -w.mde && w.ci.high < w.mde);
    if (within) {
      base.verdict = "steady";
      base.reason = "within_detectable_range";
    } else if (dir !== 0 && ciHolds && !sizeHolds) {
      base.verdict = "inconclusive";
      base.reason = "below_minimum_effect";
      base.notes.push(`The interval excludes zero but the change is under ${cfg.minDelta * 100} points in at least one window.`);
    } else if (dir !== 0 && excludesZero(w1.ci, dir as 1 | -1) && !excludesZero(w0.ci, dir as 1 | -1)) {
      base.verdict = "inconclusive";
      base.reason = "not_in_both_windows";
      base.notes.push("The latest window moved but the one before it did not: one window is not a call.");
    } else {
      base.verdict = "inconclusive";
      base.reason = "interval_wide";
    }
    return base;
  }

  // The primary signal holds. Now the conditions that can downgrade it.
  if (!heldHolds) {
    base.verdict = "inconclusive";
    base.reason = "held_out_half_disagrees";
    base.notes.push("The change does not hold in sign on the held-out half of the tasks.");
    return base;
  }

  // Flip check: drop the single task that contributes most in the direction and re-test both windows.
  const worst = (w: WindowComparison): number => {
    let best = w.d[0] as WindowComparison["d"][number];
    for (const x of w.d) if (x.value * dir < best.value * dir) best = x;
    return best.task;
  };
  const drop = worst(w1);
  const f1 = compareWindow(ctx.primary, arm, w1.from, w1.to, cfg, undefined, drop);
  const f0 = compareWindow(ctx.primary, arm, w0.from, w0.to, cfg, undefined, drop);
  const dropId = arm.taskIds[drop] as string;
  const holdsWithout = !!f1 && !!f0 && excludesZero(f1.ci, dir as 1 | -1) && excludesZero(f0.ci, dir as 1 | -1) && Math.abs(f1.delta) >= cfg.minDelta && Math.abs(f0.delta) >= cfg.minDelta;
  base.flip = { checked: true, task: dropId, holdsWithout };
  if (!holdsWithout) {
    base.verdict = "inconclusive";
    base.reason = "rests_on_one_task";
    base.notes.push(`Without task ${dropId} the rule no longer holds; the change rests on one task.`);
    return base;
  }

  if (!ctx.series.harnessUnchanged || !ctx.series.agentVersionUnchanged) {
    base.verdict = "harness_or_platform";
    base.reason = "harness_or_agent_version_changed";
    base.notes.push("The harness hash or the agent tool version differs from the baseline's, so a change cannot be put down to the model.");
    return base;
  }

  if (ctx.control) {
    const reads = [
      { window: 0, reading: controlReading(ctx, w0.from, w0.to, dir as 1 | -1, cfg) },
      { window: 1, reading: controlReading(ctx, w1.from, w1.to, dir as 1 | -1, cfg) },
    ];
    for (const r of reads) if (r.reading) base.control.push({ window: r.window, reading: r.reading });
    if (base.control.some((c) => c.reading.moved)) {
      base.verdict = "harness_or_platform";
      base.reason = "control_arm_moved";
      base.notes.push("The control arm moved the same way with its own interval excluding zero; the cause may be the harness or the platform.");
      return base;
    }
  } else if (cfg.requireControl) {
    base.verdict = "inconclusive";
    base.reason = "no_control_arm";
    base.notes.push("No control arm ran, so a platform or harness cause cannot be excluded.");
    return base;
  }

  base.verdict = dir === -1 ? "regressed" : "improved";
  base.reason = dir === -1 ? "regression_rule_met" : "improvement_rule_met";
  return base;
}
