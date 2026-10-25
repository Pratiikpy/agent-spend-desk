import { Rng } from "../canary/rng.ts";

/**
 * A paired difference between two routes with an interval that resamples clusters, and the verdict read from it (DF-042). Each pair is one task's pass rate on route A and on
 * route B, in the cluster the task belongs to. A cluster is a group of tasks whose results move together (the tasks of one family, or one task when tasks are independent), so a
 * resample takes whole clusters with replacement, and the interval is as wide as the evidence is, not as wide as the number of tasks would say.
 *
 * The verdict is fixed in advance and not chosen after the numbers are seen. With a margin of m points:
 * - `worse`: the whole interval is below minus m;
 * - `better`: the whole interval is above m;
 * - `equivalent`: the whole interval lies inside minus m to m;
 * - `inconclusive`: it reaches across either edge, and the tasks cannot say.
 * "As good as" is therefore only ever said of an interval that shows it.
 */
export interface Pair {
  cluster: string;
  a: number;
  b: number;
}

export interface Delta {
  /** B minus A, in points, over all pairs. */
  points: number;
  low: number;
  high: number;
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The 97.5th percentile of Student's t with `df` degrees of freedom: exact for the small ones, the Cornish-Fisher expansion about the normal beyond them. */
const T975 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086];
export function tQuantile975(df: number): number {
  if (df < 1) return Number.POSITIVE_INFINITY;
  if (df <= 20) return T975[df] as number;
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

export interface BootstrapOptions {
  /**
   * Widen the interval for the number of clusters. A percentile bootstrap of a few clusters is too narrow (about 92% of its intervals cover the truth when 95% should, with a dozen
   * clusters), because the resamples can only be as varied as the clusters are. The distance of each end from the estimate is scaled by the ratio of Student's t quantile, with one
   * fewer degree of freedom than clusters, to the normal's 1.96. One cluster says nothing about spread and gets the whole range, minus 100 to 100 points.
   */
  smallSample?: boolean;
}

export function pairedBootstrap(pairs: readonly Pair[], resamples: number, seed: number, options: BootstrapOptions = {}): Delta | null {
  if (pairs.length === 0) return null;
  const clusters = new Map<string, { a: number; b: number }[]>();
  for (const p of pairs) clusters.set(p.cluster, [...(clusters.get(p.cluster) ?? []), p]);
  const groups = [...clusters.keys()].sort().map((k) => clusters.get(k) as { a: number; b: number }[]);
  const diff = (list: readonly { a: number; b: number }[]): number => mean(list.map((p) => p.b - p.a)) * 100;
  const rng = new Rng(seed);
  const draws: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const picked: { a: number; b: number }[] = [];
    for (let g = 0; g < groups.length; g += 1) picked.push(...(groups[Math.floor(rng.next() * groups.length)] as { a: number; b: number }[]));
    draws.push(diff(picked));
  }
  draws.sort((x, y) => x - y);
  const points = diff(pairs);
  const low = draws[Math.floor(0.025 * resamples)] as number;
  const high = draws[Math.min(resamples - 1, Math.floor(0.975 * resamples))] as number;
  if (!options.smallSample) return { points, low, high };
  if (groups.length < 2) return { points, low: -100, high: 100 };
  const k = tQuantile975(groups.length - 1) / 1.959964;
  return { points, low: Math.max(-100, points - (points - low) * k), high: Math.min(100, points + (high - points) * k) };
}

export type PairedVerdict = "worse" | "better" | "equivalent" | "inconclusive";

export function judgeDelta(delta: Delta, margin: number): { verdict: PairedVerdict; why: string } {
  const range = `${delta.low.toFixed(1)} to ${delta.high.toFixed(1)}`;
  if (delta.high < -margin) return { verdict: "worse", why: `the candidate loses tasks: ${delta.points.toFixed(1)} points, interval ${range}, all below minus ${margin}` };
  if (delta.low > margin) return { verdict: "better", why: `the candidate wins tasks: ${delta.points.toFixed(1)} points, interval ${range}, all above ${margin}` };
  if (delta.low >= -margin && delta.high <= margin) return { verdict: "equivalent", why: `the interval, ${range} points, lies inside plus or minus ${margin}` };
  return { verdict: "inconclusive", why: `the interval, ${range} points, reaches past plus or minus ${margin}: the tasks cannot say` };
}
