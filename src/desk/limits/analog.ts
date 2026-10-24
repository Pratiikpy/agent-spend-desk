import type { Ledger } from "../ledger/db.ts";
import { modelsOfTool } from "./fit.ts";

/**
 * Where a plan window will end, from how past windows that looked like this one ended. A "moment" is one reading inside
 * a past window: how far through the window it was, the percent then, how hard the last hour was being used, and the
 * percent the window ended at (its last reading). The forecast for a new reading is the final percents of the past
 * windows whose moments lie closest to it, one moment per window so that a long window does not count many times.
 *
 * It replaced a projection that assumed the last hour's pace would continue to the reset. Tested against 110 real
 * windows that projection's range held the final percent in 2 of 26 cases (it was meant to hold 80%), because use comes
 * in bursts; this one is checked the same way with `leaveOneWindowOut`, window by window.
 */
export interface Moment {
  /** Which window the moment belongs to (its reset time). */
  window: number;
  /** Share of the window that had passed, 0 to 1. */
  elapsed: number;
  pct: number;
  /** Tokens used in the hour before the reading, or null when it could not be counted. */
  burnPerHour: number | null;
  /** The percent the window ended at. */
  final: number;
}

export interface MomentOptions {
  tool: string;
  windowMinutes: number;
  /** `null` takes readings with no plan; leave it out for every plan. */
  planType?: string | null;
  burnMinutes?: number;
  /** Only windows that had reset by this time (epoch ms) and readings made by then. A window still running has no final percent yet and is not a past window. */
  completedBefore?: number;
}

export function buildMoments(db: Ledger, opts: MomentOptions): Moment[] {
  const where = ["tool = ?", "window_minutes = ?"];
  const args: (string | number)[] = [opts.tool, opts.windowMinutes];
  if (opts.planType === null) where.push("plan_type IS NULL");
  else if (opts.planType !== undefined) {
    where.push("plan_type = ?");
    args.push(opts.planType);
  }
  if (opts.completedBefore !== undefined) {
    where.push("resets_at <= ?", "ts <= ?");
    args.push(Math.floor(opts.completedBefore / 1000), new Date(opts.completedBefore).toISOString());
  }
  const rows = db
    .prepare(`SELECT ts, used_percent AS pct, resets_at AS resetsAt, kind FROM limit_sample WHERE ${where.join(" AND ")} ORDER BY resets_at, kind, ts`)
    .all(...args) as unknown as { ts: string; pct: number; resetsAt: number; kind: string }[];
  const calls = db
    .prepare("SELECT m.ts AS ts, m.model AS model, m.input_tokens AS i, m.cache_read_tokens AS c, m.output_tokens AS o FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE s.tool = ? ORDER BY m.ts")
    .all(opts.tool) as unknown as { ts: string; model: string; i: number; c: number; o: number }[];
  const wanted = modelsOfTool(opts.tool);
  const times: number[] = [];
  const sizes: number[] = [];
  for (const c of calls) {
    if (!wanted(c.model)) continue;
    times.push(Date.parse(c.ts));
    sizes.push(c.i + c.c + c.o);
  }
  const prefix = [0];
  for (const s of sizes) prefix.push((prefix[prefix.length - 1] as number) + s);
  // First index with times[i] > t.
  const upper = (t: number): number => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((times[mid] as number) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const burnMs = (opts.burnMinutes ?? 60) * 60_000;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.kind}|${r.resetsAt}`, [...(groups.get(`${r.kind}|${r.resetsAt}`) ?? []), r]);
  const windowMs = opts.windowMinutes * 60_000;
  const out: Moment[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const last = list[list.length - 1] as (typeof rows)[number];
    for (const r of list) {
      const t = Date.parse(r.ts);
      const elapsed = Math.min(1, Math.max(0, 1 - (r.resetsAt * 1000 - t) / windowMs));
      const tokens = (prefix[upper(t)] as number) - (prefix[upper(t - burnMs)] as number);
      out.push({ window: r.resetsAt, elapsed, pct: r.pct, burnPerHour: (tokens * 3_600_000) / burnMs, final: last.pct });
    }
  }
  return out;
}

export interface Query {
  elapsed: number;
  pct: number;
  burnPerHour?: number | null;
}

export interface ForecastOptions {
  /** How many past windows to look at. */
  neighbours?: number;
  /** Whether the last hour's use counts in what "looks like this one" means. */
  useBurn?: boolean;
  /** A past window is left out when it is this one (the backtest). */
  excludeWindow?: number;
  /** At least this many past windows are needed to say anything. */
  minWindows?: number;
  /** Only these windows may be consulted (the backtest uses it to look only at earlier windows). */
  pool?: ReadonlySet<number>;
  /** The windows that may be consulted for a given window; takes the place of `pool`. */
  poolFor?: (window: number) => ReadonlySet<number>;
}

export interface Forecast {
  /** The past windows consulted. */
  windows: number;
  /** Their final percents, ascending. */
  finals: number[];
  abstained: boolean;
}

const ELAPSED_SCALE = 0.12;
const PCT_SCALE = 10;
const BURN_SCALE = 1.2;

function distance(m: Moment, q: Query, useBurn: boolean): number {
  let d = ((m.elapsed - q.elapsed) / ELAPSED_SCALE) ** 2 + ((m.pct - q.pct) / PCT_SCALE) ** 2;
  if (useBurn && q.burnPerHour !== undefined && q.burnPerHour !== null && m.burnPerHour !== null) {
    d += ((Math.log1p(m.burnPerHour / 100_000) - Math.log1p(q.burnPerHour / 100_000)) / BURN_SCALE) ** 2;
  }
  return d;
}

export function forecast(moments: readonly Moment[], q: Query, opts: ForecastOptions = {}): Forecast {
  const useBurn = opts.useBurn ?? false;
  const best = new Map<number, { d: number; final: number }>();
  for (const m of moments) {
    if (m.window === opts.excludeWindow) continue;
    if (opts.pool !== undefined && !opts.pool.has(m.window)) continue;
    const d = distance(m, q, useBurn);
    const have = best.get(m.window);
    if (have === undefined || d < have.d) best.set(m.window, { d, final: m.final });
  }
  const minWindows = opts.minWindows ?? 20;
  if (best.size < minWindows) return { windows: best.size, finals: [], abstained: true };
  const nearest = [...best.values()].sort((a, b) => a.d - b.d).slice(0, opts.neighbours ?? 20);
  return { windows: nearest.length, finals: nearest.map((x) => x.final).sort((a, b) => a - b), abstained: false };
}

/** The share of the consulted windows that ended at or above `threshold` percent. */
export function chanceAtLeast(f: Forecast, threshold: number): number | null {
  return f.abstained || f.finals.length === 0 ? null : f.finals.filter((x) => x >= threshold).length / f.finals.length;
}

export function finalQuantile(f: Forecast, q: number): number | null {
  if (f.abstained || f.finals.length === 0) return null;
  const pos = (f.finals.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (f.finals[lo] as number) + ((f.finals[hi] as number) - (f.finals[lo] as number)) * (pos - lo);
}

export interface Backtest {
  queries: number;
  windows: number;
  /** Brier score of the forecast chance of ending at the threshold or above, and of the base rate alone; lower is better. */
  brier: number;
  baseBrier: number;
  /** Per predicted-chance band: how many queries, and how many of them ended at the threshold or above. */
  reliability: { band: string; queries: number; reached: number }[];
  /** Share of queries whose final percent fell between the forecast's 10th and 90th percentile (aimed at 80%). */
  inside80: number;
  threshold: number;
}

/**
 * Check the forecast window by window: each window in turn is left out, and its readings are forecast from the rest.
 * Only readings with a window already started (elapsed between `from` and `to`) and with room to move (percent under the
 * threshold) are asked about, because a window already at the threshold needs no forecast.
 */
export function leaveOneWindowOut(moments: readonly Moment[], opts: ForecastOptions & { threshold?: number; from?: number; to?: number; every?: number; /** Only ask about these windows. */ ask?: ReadonlySet<number> } = {}): Backtest {
  const threshold = opts.threshold ?? 95;
  const from = opts.from ?? 0.1;
  const to = opts.to ?? 0.9;
  const every = Math.max(1, opts.every ?? 3);
  const byWindow = new Map<number, Moment[]>();
  for (const m of moments) byWindow.set(m.window, [...(byWindow.get(m.window) ?? []), m]);
  let queries = 0;
  let brier = 0;
  let baseBrier = 0;
  let inside = 0;
  const bands = [
    { band: "under 20%", lo: 0, hi: 0.2, queries: 0, reached: 0 },
    { band: "20% to 50%", lo: 0.2, hi: 0.5, queries: 0, reached: 0 },
    { band: "50% to 80%", lo: 0.5, hi: 0.8, queries: 0, reached: 0 },
    { band: "80% and over", lo: 0.8, hi: 1.0001, queries: 0, reached: 0 },
  ];
  for (const [w, list] of byWindow) {
    if (opts.ask !== undefined && !opts.ask.has(w)) continue;
    const pool = opts.poolFor ? opts.poolFor(w) : opts.pool;
    const others = moments.filter((m) => m.window !== w && (pool === undefined || pool.has(m.window)));
    const finalsOthers = new Map<number, number>();
    for (const m of others) finalsOthers.set(m.window, m.final);
    const base = [...finalsOthers.values()].filter((x) => x >= threshold).length / Math.max(1, finalsOthers.size);
    let n = 0;
    for (const m of list) {
      if (m.elapsed < from || m.elapsed > to || m.pct >= threshold) continue;
      n += 1;
      if (n % every !== 0) continue;
      const f = forecast(moments, { elapsed: m.elapsed, pct: m.pct, burnPerHour: m.burnPerHour }, { ...opts, ...(pool === undefined ? {} : { pool }), excludeWindow: w });
      const p = chanceAtLeast(f, threshold);
      if (p === null) continue;
      const hit = m.final >= threshold ? 1 : 0;
      queries += 1;
      brier += (p - hit) ** 2;
      baseBrier += (base - hit) ** 2;
      const band = bands.find((b) => p >= b.lo && p < b.hi) as (typeof bands)[number];
      band.queries += 1;
      band.reached += hit;
      const lo = finalQuantile(f, 0.1) as number;
      const hi = finalQuantile(f, 0.9) as number;
      if (m.final >= lo - 1e-9 && m.final <= hi + 1e-9) inside += 1;
    }
  }
  return {
    queries,
    windows: byWindow.size,
    brier: queries === 0 ? NaN : brier / queries,
    baseBrier: queries === 0 ? NaN : baseBrier / queries,
    reliability: bands.map(({ band, queries: q, reached }) => ({ band, queries: q, reached })),
    inside80: queries === 0 ? NaN : inside / queries,
    threshold,
  };
}

/**
 * Check the forecast the way the product is used: it only ever has the past. Each window, in time order, is forecast from
 * the windows before it (all of them, or only the most recent `recent`), and only windows with at least `minPrior`
 * windows before them are asked about. Unlike leaving windows out at random this does not let a window be forecast from
 * its own era, so it shows what a change in how the plan is used does to the forecast.
 */
export function rollingOrigin(moments: readonly Moment[], opts: ForecastOptions & { recent?: number | null; minPrior?: number; threshold?: number; from?: number; to?: number; every?: number } = {}): Backtest {
  const order = [...new Set(moments.map((m) => m.window))].sort((a, b) => a - b);
  const minPrior = opts.minPrior ?? 30;
  const ask = new Set(order.slice(minPrior));
  const poolFor = (w: number): ReadonlySet<number> => {
    const before = order.filter((x) => x < w);
    return new Set(opts.recent === undefined || opts.recent === null ? before : before.slice(-opts.recent));
  };
  return leaveOneWindowOut(moments, { ...opts, poolFor, ask });
}
