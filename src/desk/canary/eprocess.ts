/**
 * Anytime-valid watch flag (spec 8.6 "faster, coarser detector" and 22.12). A test supermartingale bets on a
 * daily drop in score against the frozen baseline. By Ville's inequality the chance that its wealth ever
 * reaches 1/alpha under "no drop" is at most alpha, however often it is looked at. It only raises a `watch`
 * flag that schedules more repeats; it never gives a verdict.
 *
 * Direction: the spec writes D_t as candidate minus baseline and bets on D >= 0, which would bet on an
 * improvement. Here D_t = baseline mean minus the day's mean, so a positive D is a drop and the null is
 * E[D_t | past] <= 0. With a bet lambda_t in [0, 0.5] that depends only on earlier days and |D_t| <= 1, the
 * factor S_t = 1 + lambda_t * D_t is at least 0.5 and has expectation at most 1 under the null.
 *
 * One approximation is stated rather than hidden: the baseline mean is itself estimated from 14 days, so the
 * guarantee holds conditional on the baseline being right. The simulation measures what that does to the
 * false-alarm rate (docs/verification/canary-simulation.md).
 */
import { Prefix, type ArmSeries } from "./series.ts";

export interface EConfig {
  alpha: number;
  /** No flag before this many monitored days (22.12: 7). */
  minDays: number;
  lambdaMax: number;
  epsilon: number;
}

export const DEFAULT_E_CONFIG: EConfig = { alpha: 0.05, minDays: 7, lambdaMax: 0.5, epsilon: 1e-3 };

export interface EState {
  /** Monitored days so far (days with a score, plus days skipped as failed runs). */
  days: number;
  wealth: number;
  /** Running mean and sum of squared deviations of the observed D values (Welford). */
  count: number;
  mean: number;
  m2: number;
  firstTriggerDay: number | null;
}

export interface EStep {
  day: number;
  /** The bet placed before seeing today's D. */
  lambda: number;
  /** The factor 1 + lambda * D (1 when the run failed). */
  factor: number;
  d: number | null;
  wealth: number;
  watch: boolean;
}

export function newEState(): EState {
  return { days: 0, wealth: 1, count: 0, mean: 0, m2: 0, firstTriggerDay: null };
}

/**
 * Advance one day. `d` is the baseline mean minus today's mean, or null if the run failed (infra) or produced
 * no scores: the factor is then exactly 1 so wealth is unchanged and no alert can come from missing data.
 */
export function stepE(state: EState, d: number | null, cfg: EConfig = DEFAULT_E_CONFIG): EStep {
  state.days += 1;
  const variance = state.count >= 2 ? state.m2 / (state.count - 1) : NaN;
  const lambda = Number.isFinite(variance) ? Math.min(cfg.lambdaMax, Math.max(0, state.mean / (variance + cfg.epsilon))) : 0;
  let factor = 1;
  if (d !== null && Number.isFinite(d)) {
    if (d < -1 || d > 1) throw new RangeError("a daily score difference must lie in [-1, 1]");
    factor = 1 + lambda * d;
    state.count += 1;
    const delta = d - state.mean;
    state.mean += delta / state.count;
    state.m2 += delta * (d - state.mean);
  }
  state.wealth *= factor;
  const watch = state.days >= cfg.minDays && state.wealth >= 1 / cfg.alpha;
  if (watch && state.firstTriggerDay === null) state.firstTriggerDay = state.days;
  return { day: state.days, lambda, factor, d, wealth: state.wealth, watch };
}

/** Run the process over a series: daily pooled score against the pooled baseline of days 1..baselineDays. */
export function eProcessOverArm(arm: ArmSeries, days: number, baselineDays = 14, cfg: EConfig = DEFAULT_E_CONFIG): EStep[] {
  const prefix = new Prefix(arm, days);
  let bn = 0;
  let bs = 0;
  for (let i = 0; i < prefix.tasks; i += 1) {
    const w = prefix.window(i, 1, baselineDays);
    bn += w.n;
    bs += w.sum;
  }
  if (bn === 0) return [];
  const baseMean = bs / bn;
  const state = newEState();
  const out: EStep[] = [];
  for (let day = baselineDays + 1; day <= days; day += 1) {
    let n = 0;
    let s = 0;
    for (let i = 0; i < prefix.tasks; i += 1) {
      const w = prefix.window(i, day, day);
      n += w.n;
      s += w.sum;
    }
    out.push(stepE(state, n === 0 ? null : baseMean - s / n, cfg));
  }
  return out;
}

/**
 * e-BH (Wang and Ramdas 2022, from memory, NOT VERIFIED against the paper): reject the k hypotheses with the
 * largest e-values where k is the largest index with e_(k) >= m / (alpha * k). The simulation measures the
 * false-discovery rate it gives on these per-task processes.
 */
export function eBH(eValues: readonly number[], alpha = 0.05): number[] {
  const m = eValues.length;
  const order = eValues.map((e, i) => ({ e, i })).sort((a, b) => b.e - a.e);
  let k = 0;
  for (let j = 1; j <= m; j += 1) if ((order[j - 1] as { e: number }).e >= m / (alpha * j)) k = j;
  return order.slice(0, k).map((o) => o.i);
}

export interface TaskWatch {
  day: number;
  /** Indexes of the tasks e-BH flags. */
  flagged: number[];
  wealth: number[];
}

/** Per-task processes (each task against its own baseline mean) with e-BH across tasks each day. */
export function taskWatchOverArm(arm: ArmSeries, days: number, baselineDays = 14, cfg: EConfig = DEFAULT_E_CONFIG): TaskWatch[] {
  const prefix = new Prefix(arm, days);
  const states = arm.taskIds.map(() => newEState());
  const base = arm.taskIds.map((_, i) => {
    const w = prefix.window(i, 1, baselineDays);
    return w.n > 0 ? w.sum / w.n : null;
  });
  const out: TaskWatch[] = [];
  for (let day = baselineDays + 1; day <= days; day += 1) {
    const wealth: number[] = [];
    for (let i = 0; i < states.length; i += 1) {
      const w = prefix.window(i, day, day);
      const b = base[i] ?? null;
      const d = b === null || w.n === 0 ? null : b - w.sum / w.n;
      stepE(states[i] as EState, d, cfg);
      wealth.push((states[i] as EState).wealth);
    }
    const monitored = day - baselineDays >= cfg.minDays;
    out.push({ day: day - baselineDays, flagged: monitored ? eBH(wealth, cfg.alpha) : [], wealth });
  }
  return out;
}

/** The threshold wealth at which the flag is raised. */
export function threshold(cfg: EConfig = DEFAULT_E_CONFIG): number {
  return 1 / cfg.alpha;
}
