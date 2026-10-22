import { replayPolicy, type ReplaySession } from "./policy-replay.ts";
import type { Policy } from "../policy/types.ts";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** A fixed 30-day simulated month, so day and month cap windows behave the same in every simulation. */
const SIM_START = Date.UTC(2001, 0, 1);
const SIM_DAYS = 30;

export interface TunnelOptions {
  /** Inner simulated months per resampled history. */
  innerSims: number;
  /** Resampled histories; the spread across them is the interval for the headline numbers. */
  outerReps: number;
  seed: number;
  /** Fewer sessions than this: refuse, because a simulation of too little history is a guess. */
  minSessions: number;
}

export const DEFAULT_TUNNEL: TunnelOptions = { innerSims: 25, outerReps: 24, seed: 1, minSessions: 60 };

export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface TunnelResult {
  status: "ok" | "too_little_history";
  sessions: number;
  simulatedMonths: number;
  /** Chance that a month blocks at least one landed task, with a 90% interval across resampled histories. */
  pBlockedLanded: Range;
  /** Dollars not spent per month: the mean, with a 90% interval across histories, and the 5th/95th percentile month. */
  savedMicros: Range;
  savedMonthSpread: { p05: number; p95: number };
  /** Drift between the last four weeks and the whole history, from a two-sample test on cost per session. */
  drift: { p: number; flagged: boolean } | null;
  historyMayNotPredict: boolean;
}

/** Small seeded generator (mulberry32) so a run is reproducible from its seed. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

function range(values: readonly number[]): Range {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return { low: quantile(sorted, 0.05), mid: mean, high: quantile(sorted, 0.95) };
}

interface Block {
  startMs: number;
  sessions: readonly ReplaySession[];
}

function toBlocks(sessions: readonly ReplaySession[]): Block[] {
  const t0 = Math.min(...sessions.map((s) => s.startMs));
  const weeks = new Map<number, ReplaySession[]>();
  for (const s of sessions) {
    const w = Math.floor((s.startMs - t0) / WEEK);
    const list = weeks.get(w) ?? [];
    list.push(s);
    weeks.set(w, list);
  }
  return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([w, list]) => ({ startMs: t0 + w * WEEK, sessions: list }));
}

/** One simulated month: five week-slots, each filled with a randomly chosen week of the history, shifted to its slot. */
function simulateMonth(blocks: readonly Block[], rand: () => number): ReplaySession[] {
  const out: ReplaySession[] = [];
  for (let slot = 0; slot * WEEK < SIM_DAYS * DAY; slot += 1) {
    const block = blocks[Math.floor(rand() * blocks.length)]!;
    const shift = SIM_START + slot * WEEK - block.startMs;
    for (const s of block.sessions) {
      const startMs = s.startMs + shift;
      if (startMs - SIM_START >= SIM_DAYS * DAY) continue;
      out.push({ ...s, startMs });
    }
  }
  return out;
}

/** Kolmogorov-Smirnov two-sample p-value (asymptotic). */
export function ksPValue(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 1;
  const xs = [...a].sort((x, y) => x - y);
  const ys = [...b].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < xs.length && j < ys.length) {
    const x = xs[i]!;
    const y = ys[j]!;
    if (x <= y) i += 1;
    if (y <= x) j += 1;
    d = Math.max(d, Math.abs(i / xs.length - j / ys.length));
  }
  const lambda = (Math.sqrt((xs.length * ys.length) / (xs.length + ys.length)) + 0.12 + 0.11 / Math.sqrt((xs.length * ys.length) / (xs.length + ys.length))) * d;
  if (lambda < 0.2) return 1;
  let sum = 0;
  for (let k = 1; k <= 100; k += 1) sum += (k % 2 === 1 ? 1 : -1) * Math.exp(-2 * k * k * lambda * lambda);
  return Math.min(1, Math.max(0, 2 * sum));
}

function sessionCost(s: ReplaySession): number {
  return s.calls.reduce((t, c) => t + c.costMicros, 0);
}

/**
 * The policy wind tunnel (spec 26.1, DF-123): resample the owner's own weeks into simulated months and
 * run the proposed policy through each. The intervals come from an outer bootstrap over weeks, so they
 * reflect how little history there is, not just simulation noise. The method assumes the future
 * resembles the past; a two-sample test of the last four weeks against the rest flags when it does not.
 */
export function windTunnel(policy: Policy, history: readonly ReplaySession[], options: Partial<TunnelOptions> = {}): TunnelResult {
  const o = { ...DEFAULT_TUNNEL, ...options };
  if (history.length < o.minSessions) {
    return { status: "too_little_history", sessions: history.length, simulatedMonths: 0, pBlockedLanded: { low: 0, mid: 0, high: 0 }, savedMicros: { low: 0, mid: 0, high: 0 }, savedMonthSpread: { p05: 0, p95: 0 }, drift: null, historyMayNotPredict: true };
  }
  const blocks = toBlocks(history);
  const rand = seeded(o.seed);
  const pByRep: number[] = [];
  const savedByRep: number[] = [];
  const allSaved: number[] = [];
  for (let rep = 0; rep < o.outerReps; rep += 1) {
    const resampled: Block[] = Array.from({ length: blocks.length }, () => blocks[Math.floor(rand() * blocks.length)]!);
    let blocked = 0;
    let savedSum = 0;
    for (let k = 0; k < o.innerSims; k += 1) {
      const month = simulateMonth(resampled, rand);
      const r = replayPolicy(policy, month);
      if (r.landedBlocked.length > 0) blocked += 1;
      savedSum += r.savedMicros;
      allSaved.push(r.savedMicros);
    }
    pByRep.push(blocked / o.innerSims);
    savedByRep.push(savedSum / o.innerSims);
  }
  allSaved.sort((a, b) => a - b);

  const lastStart = Math.max(...history.map((s) => s.startMs)) - 4 * WEEK;
  const recent = history.filter((s) => s.startMs >= lastStart).map(sessionCost);
  const earlier = history.filter((s) => s.startMs < lastStart).map(sessionCost);
  const drift = earlier.length >= 20 && recent.length >= 20 ? (() => { const p = ksPValue(recent, history.map(sessionCost)); return { p, flagged: p < 0.01 }; })() : null;

  return {
    status: "ok",
    sessions: history.length,
    simulatedMonths: o.outerReps * o.innerSims,
    pBlockedLanded: range(pByRep),
    savedMicros: range(savedByRep),
    savedMonthSpread: { p05: quantile(allSaved, 0.05), p95: quantile(allSaved, 0.95) },
    drift,
    historyMayNotPredict: drift?.flagged === true,
  };
}

export interface Candidate {
  name: string;
  policy: Policy;
}

export interface Ranked {
  name: string;
  eligible: boolean;
  result: TunnelResult;
}

/**
 * Rank candidate policies: those whose chance of blocking landed work is within the owner's tolerance
 * (default 5%) come first, ordered by the low end of the saving; the rest are listed after, with why.
 */
export function rankPolicies(candidates: readonly Candidate[], history: readonly ReplaySession[], tolerance = 0.05, options: Partial<TunnelOptions> = {}): Ranked[] {
  const ranked = candidates.map((c) => {
    const result = windTunnel(c.policy, history, options);
    return { name: c.name, eligible: result.status === "ok" && result.pBlockedLanded.mid <= tolerance, result };
  });
  return ranked.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.result.savedMicros.low - a.result.savedMicros.low);
}
