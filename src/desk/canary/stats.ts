/**
 * Distribution functions and the clustered estimate used by the canary statistic (spec 8.6).
 * Written from the standard definitions (regularised incomplete beta by continued fraction,
 * Lanczos log-gamma) and checked against SciPy in tests/desk/canary/stats.test.ts.
 */
import { Rng, seedFromString } from "./rng.ts";

export function lnGamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let a = c[0] as number;
  const t = y + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += (c[i] as number) / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularised incomplete beta function I_x(a, b). */
export function betaIncReg(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(x, a, b)) / a;
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

export function tCdf(t: number, df: number): number {
  if (!(df > 0)) throw new RangeError("degrees of freedom must be positive");
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t);
  const tail = 0.5 * betaIncReg(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

const tCache = new Map<string, number>();

/** The p-quantile of Student's t with `df` degrees of freedom, by bisection on the CDF. */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("p must be in (0, 1)");
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  const key = `${p}|${df}`;
  const hit = tCache.get(key);
  if (hit !== undefined) return hit;
  let lo = 0;
  let hi = 1;
  while (tCdf(hi, df) < p) {
    hi *= 2;
    if (hi > 1e12) break;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13 * Math.max(1, hi)) break;
  }
  const q = (lo + hi) / 2;
  tCache.set(key, q);
  return q;
}

function erfc(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 2.5) {
    let sum = ax;
    let term = ax;
    for (let n = 1; n < 100; n += 1) {
      term *= (-ax * ax) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    r = 1 - (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    let f = 0;
    for (let k = 60; k >= 1; k -= 1) f = k / 2 / (ax + f);
    r = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
  }
  return x >= 0 ? r : 2 - r;
}

export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Standard normal quantile: a rational start (Acklam) refined by Halley steps. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("p must be in (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  for (let i = 0; i < 3; i += 1) {
    const e = normalCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

/** The p-quantile of Beta(a, b), by bisection. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (betaIncReg(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact (Clopper-Pearson) two-sided interval for a binomial proportion; `level` is the coverage, for example 0.95. */
export function clopperPearson(successes: number, trials: number, level = 0.95): { low: number; high: number } {
  if (trials <= 0 || successes < 0 || successes > trials) throw new RangeError("invalid counts");
  const a = (1 - level) / 2;
  const low = successes === 0 ? 0 : betaQuantile(a, successes, trials - successes + 1);
  const high = successes === trials ? 1 : betaQuantile(1 - a, successes + 1, trials - successes);
  return { low, high };
}

export interface ClusterItem {
  value: number;
  cluster: string;
}

export interface ClusterEstimate {
  /** Mean of the item values. */
  mean: number;
  /** Cluster-robust standard error with the G/(G-1) correction. NaN when there are fewer than two clusters. */
  se: number;
  /** Items. */
  k: number;
  /** Clusters. */
  g: number;
}

/**
 * Mean of per-item values with a cluster-robust standard error:
 * SE^2 = G/(G-1) * sum_g (sum_{i in g}(v_i - mean))^2 / K^2 (Miller's G/(G-1) correction, spec 8.6).
 */
export function clusterMean(items: readonly ClusterItem[]): ClusterEstimate {
  const k = items.length;
  if (k === 0) return { mean: NaN, se: NaN, k: 0, g: 0 };
  let total = 0;
  for (const it of items) total += it.value;
  const mean = total / k;
  const sums = new Map<string, number>();
  for (const it of items) sums.set(it.cluster, (sums.get(it.cluster) ?? 0) + (it.value - mean));
  const g = sums.size;
  if (g < 2) return { mean, se: NaN, k, g };
  let ss = 0;
  for (const s of sums.values()) ss += s * s;
  return { mean, se: Math.sqrt(((g / (g - 1)) * ss) / (k * k)), k, g };
}

/** With fewer than four clusters the task is the cluster (spec 8.6). */
export function effectiveClusters(items: readonly ClusterItem[]): ClusterItem[] {
  const g = new Set(items.map((i) => i.cluster)).size;
  return g < 4 ? items.map((i, n) => ({ value: i.value, cluster: `task-${n}` })) : [...items];
}

export type IntervalMethod = "t" | "bootstrap_t";

export interface Interval {
  low: number;
  high: number;
  method: IntervalMethod;
  /** The t quantile used by the t method; NaN for the bootstrap. */
  crit: number;
  /** Clusters the interval rests on. */
  g: number;
  se: number;
  mean: number;
}

/** Interval for a clustered mean at coverage `level` (for example 0.99). Null when it cannot be formed. */
export function clusterInterval(items: readonly ClusterItem[], level: number, method: IntervalMethod, bootstrapB = 999): Interval | null {
  const use = effectiveClusters(items);
  const est = clusterMean(use);
  if (!Number.isFinite(est.se) || est.g < 2) return null;
  if (method === "t") {
    const crit = tQuantile(1 - (1 - level) / 2, est.g - 1);
    return { low: est.mean - crit * est.se, high: est.mean + crit * est.se, method, crit, g: est.g, se: est.se, mean: est.mean };
  }
  const byCluster = new Map<string, ClusterItem[]>();
  for (const it of use) byCluster.set(it.cluster, [...(byCluster.get(it.cluster) ?? []), it]);
  const groups = [...byCluster.values()];
  const rng = new Rng(seedFromString(use.map((u) => `${u.cluster}:${u.value.toFixed(9)}`).join("|")));
  const ts: number[] = [];
  for (let b = 0; b < bootstrapB; b += 1) {
    const sample: ClusterItem[] = [];
    for (let j = 0; j < groups.length; j += 1) {
      const grp = groups[rng.int(0, groups.length - 1)] as ClusterItem[];
      for (const it of grp) sample.push({ value: it.value, cluster: `b${j}` });
    }
    const e = clusterMean(sample);
    if (!Number.isFinite(e.se) || e.se < 1e-12) continue;
    ts.push((e.mean - est.mean) / e.se);
  }
  if (ts.length < 50) return null;
  ts.sort((x, y) => x - y);
  const qLow = ts[Math.max(0, Math.floor(((1 - level) / 2) * ts.length))] as number;
  const qHigh = ts[Math.min(ts.length - 1, Math.ceil((1 - (1 - level) / 2) * ts.length) - 1)] as number;
  return { low: est.mean - qHigh * est.se, high: est.mean - qLow * est.se, method, crit: NaN, g: est.g, se: est.se, mean: est.mean };
}

/** z for 80% power, as in the pre-registered rule the canary adopts (spec 8.6). */
export const Z_POWER_80 = 0.8416212335729143;

/** Normal-approximation MDE: (t + z_power) * SE. Kept for comparison; the product reports the noncentral-t value. */
export function mdeFromSe(se: number, g: number, level = 0.99, zPower = Z_POWER_80): number {
  return (tQuantile(1 - (1 - level) / 2, Math.max(1, g - 1)) + zPower) * se;
}

/** P(T' > c) for a noncentral t with `df` degrees of freedom and noncentrality `delta`, by quadrature over the chi scale. */
export function noncentralTUpper(c: number, df: number, delta: number): number {
  // T' = (Z + delta) / S with S = sqrt(V / df), V ~ chi-square(df). P(T' > c) = E_S[ 1 - Phi(c * S - delta) ].
  const logNorm = (df / 2) * Math.log(df) - ((df / 2 - 1) * Math.LN2 + lnGamma(df / 2));
  const sMax = 1 + 10 / Math.sqrt(df);
  const n = 4000;
  const h = sMax / n;
  let sum = 0;
  for (let i = 0; i <= n; i += 1) {
    const s = i * h;
    let f = 0;
    if (s > 0) f = Math.exp(logNorm + (df - 1) * Math.log(s) - (df * s * s) / 2) * (1 - normalCdf(c * s - delta));
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    sum += w * f;
  }
  return (sum * h) / 3;
}

/**
 * Minimum detectable effect for one window: the smallest true change that the `level` interval would exclude
 * zero for with probability `power`, using the noncentral t with the estimated standard error as the scale.
 * The normal-approximation rule underestimates it when clusters are few (the standard error is itself noisy);
 * the simulation in docs/verification/canary-simulation.md compares both with the simulated 80% point.
 */
export function mdeNoncentral(se: number, g: number, level = 0.99, power = 0.8): number {
  const df = Math.max(1, g - 1);
  const crit = tQuantile(1 - (1 - level) / 2, df);
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (noncentralTUpper(crit, df, mid) < power) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * se;
}
