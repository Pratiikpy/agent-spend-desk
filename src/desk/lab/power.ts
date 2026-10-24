import { seededRandom } from "../stats/random.ts";

/**
 * Sample size for a Lab experiment, by simulation from a pilot. The unit of analysis is the task: repeats of one task
 * are not independent samples, so each task's pass rate under each arm is one pair, and the arms are compared by a
 * paired t test across tasks. The simulation draws each task's repeats from its pilot pass rate (and the same rate plus
 * the effect under the new arm), runs the same test, and reports how often it rejects. With no effect that is the
 * false-alarm rate, which must sit near the level; with the smallest effect worth acting on it is the power.
 */

function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const ci of c) {
    y += 1;
    s += ci / y;
  }
  return -t + Math.log((2.5066282746310005 * s) / x);
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

/** Regularised incomplete beta function I_x(a, b). */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, x);
  return t >= 0 ? 1 - tail : tail;
}

export interface PairedResult {
  meanDifference: number;
  t: number;
  df: number;
  /** Two-sided. */
  pValue: number;
}

/** Paired t test of a against b, one pair per task. */
export function pairedTest(a: readonly number[], b: readonly number[]): PairedResult {
  if (a.length !== b.length) throw new RangeError("a and b must have the same length");
  const n = a.length;
  if (n < 2) throw new RangeError("a paired test needs at least two pairs");
  const d = a.map((x, i) => x - (b[i] as number));
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const variance = d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  if (variance === 0) return { meanDifference: mean, t: mean === 0 ? 0 : Infinity, df: n - 1, pValue: mean === 0 ? 1 : 0 };
  const t = mean / Math.sqrt(variance / n);
  return { meanDifference: mean, t, df: n - 1, pValue: Math.min(1, 2 * (1 - studentTCdf(Math.abs(t), n - 1))) };
}

export interface PowerInput {
  /** Each task's pass rate under the baseline, from a pilot. One entry per task in the experiment. */
  baselineRates: readonly number[];
  repeats: number;
  /** The change in pass rate under the new arm, as an absolute share (0.1 is ten points). Zero measures the false-alarm rate. */
  effect: number;
  trials: number;
  seed: number;
  alpha?: number;
}

export interface PowerResult {
  tasks: number;
  repeats: number;
  effect: number;
  trials: number;
  /** The share of simulated experiments in which the test rejected: power when the effect is real, the false-alarm rate when it is zero. */
  rejectionRate: number;
}

function binomial(rand: () => number, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (rand() < p) k += 1;
  return k;
}

export function simulatePower(input: PowerInput): PowerResult {
  const { baselineRates, repeats, effect, trials } = input;
  if (baselineRates.length < 2) throw new RangeError("a simulation needs at least two tasks");
  if (baselineRates.some((r) => !Number.isFinite(r) || r < 0 || r > 1)) throw new RangeError("pass rates must lie between 0 and 1");
  const alpha = input.alpha ?? 0.05;
  const rand = seededRandom(input.seed);
  let rejected = 0;
  for (let k = 0; k < trials; k += 1) {
    const base: number[] = [];
    const next: number[] = [];
    for (const p of baselineRates) {
      const q = Math.min(1, Math.max(0, p + effect));
      base.push(binomial(rand, repeats, p) / repeats);
      next.push(binomial(rand, repeats, q) / repeats);
    }
    if (pairedTest(next, base).pValue < alpha) rejected += 1;
  }
  return { tasks: baselineRates.length, repeats, effect, trials, rejectionRate: rejected / trials };
}

export interface RequiredTasksInput {
  /** The pilot's per-task pass rates; larger experiments reuse them in turn. */
  baselineRates: readonly number[];
  repeats: number;
  effect: number;
  targetPower: number;
  maxTasks: number;
  trials: number;
  seed: number;
}

/** The smallest number of tasks (in steps of two) at which the simulated power reaches the target, or null if the maximum does not. */
export function requiredTasks(input: RequiredTasksInput): { tasks: number | null; power: number } {
  let last = 0;
  for (let n = 4; n <= input.maxTasks; n += 2) {
    const rates = Array.from({ length: n }, (_, i) => input.baselineRates[i % input.baselineRates.length] as number);
    last = simulatePower({ baselineRates: rates, repeats: input.repeats, effect: input.effect, trials: input.trials, seed: input.seed + n }).rejectionRate;
    if (last >= input.targetPower) return { tasks: n, power: last };
  }
  return { tasks: null, power: last };
}
