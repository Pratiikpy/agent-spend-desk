import { analyseCalls, buildAutopsy, CAUSES, type Autopsy, type AutopsyCall, type Cause } from "../autopsy/engine.ts";

/**
 * The cause-ranked fix list (spec DF-113). Each cause maps to a concrete change. The saving is what that cause
 * cost per window in the owner's own past windows, as an 80% interval (10th to 90th percentile), and only when
 * at least three comparable windows exist. With fewer, or for causes whose avoidable part cannot be read from
 * the logs, the figure is an upper bound labelled `heuristic_estimate` and carries no interval.
 *
 * "Saving" means money the cause took in a window, not money a fix is promised to return: the follow-up check
 * (`desk check-fixes`) is what tests whether a fix worked.
 */
export const FIX_CONFIG = {
  /** A cause below this share of the window is not called out. */
  minShare: 0.05,
  minWindowsForInterval: 3,
  /** A past window needs this many priced calls to count as a comparable window. */
  minCallsPerWindow: 10,
  intervalLow: 0.1,
  intervalHigh: 0.9,
} as const;

export type FixBasis = "own_history" | "heuristic_estimate";

export interface Fix {
  cause: Cause;
  fix: string;
  basis: FixBasis;
  /** Money this cause took in the window shown on the card. */
  windowMicros: number;
  /** Avoidable part of the window figure when it can be read from the logs, else the whole cause. */
  addressableMicros: number;
  /** 80% interval of the addressable amount per window across past windows; null without enough windows or for heuristic causes. */
  interval: { lowMicros: number; highMicros: number } | null;
  windowsUsed: number;
  /** Why the figure is what it is, in one line. */
  note: string;
}

const FIX_TEXT: Partial<Record<Cause, string>> = {
  idle: "Stop or lengthen background polling and heartbeat jobs that call the model with nobody at the keyboard.",
  loops: "Set a per-session cap so the same failing command cannot be retried more than twice; make the agent change approach after that.",
  cache_misses: "Keep the tool list and its schemas frozen across turns, avoid switching models mid-session, and avoid edits that change the start of the context.",
  subagents: "Cap how many sub-agents one task may start and how much each may spend.",
  tool_output: "Filter or page large tool results (file dumps, long diffs, directory trees) before they go back to the model.",
  history_rereads: "Compact the conversation earlier, at about 60% of the context rather than 85%, or start a fresh session at a task boundary.",
};

/** Causes whose avoidable part is read from the logs, with the function that reads it. Others report an upper bound. */
const ADDRESSABLE: Partial<Record<Cause, (a: Autopsy) => number>> = {
  idle: (a) => a.causes.idle.micros,
  loops: (a) => a.causes.loops.micros,
  cache_misses: (a) => a.missEvents.reduce((s, e) => s + e.savingMicros, 0),
};

/** Nearest-rank percentile of a sorted array; `p` between 0 and 1. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Consecutive windows of `hours` from the first priced call to `endMs`, each with its autopsy; sparse windows are left out. */
export function pastWindows(calls: readonly AutopsyCall[], hours: number, endMs: number): Autopsy[] {
  const priced = calls.filter((c) => c.micros !== null && c.tsMs <= endMs);
  if (priced.length === 0) return [];
  const span = hours * 3_600_000;
  const analysis = analyseCalls(calls);
  let first = priced[0]!.tsMs;
  for (const c of priced) if (c.tsMs < first) first = c.tsMs;
  const buckets = new Map<number, number>();
  for (const c of priced) buckets.set(Math.floor((c.tsMs - first) / span), (buckets.get(Math.floor((c.tsMs - first) / span)) ?? 0) + 1);
  const out: Autopsy[] = [];
  for (const [i, n] of [...buckets].sort((a, b) => a[0] - b[0])) {
    if (n < FIX_CONFIG.minCallsPerWindow) continue;
    out.push(buildAutopsy(calls, first + i * span, first + (i + 1) * span - 1, analysis));
  }
  return out;
}

export function rankFixes(current: Autopsy, past: readonly Autopsy[]): Fix[] {
  const fixes: Fix[] = [];
  const total = Math.max(1, current.totalMicros);
  for (const cause of CAUSES) {
    const text = FIX_TEXT[cause];
    if (!text) continue;
    const windowMicros = current.causes[cause].micros;
    if (windowMicros / total < FIX_CONFIG.minShare) continue;
    const reader = ADDRESSABLE[cause];
    const enough = past.length >= FIX_CONFIG.minWindowsForInterval;
    if (reader) {
      const addressable = reader(current);
      const perWindow = past.map(reader).sort((a, b) => a - b);
      fixes.push({
        cause,
        fix: text,
        basis: enough ? "own_history" : "heuristic_estimate",
        windowMicros,
        addressableMicros: addressable,
        interval: enough ? { lowMicros: percentile(perWindow, FIX_CONFIG.intervalLow), highMicros: percentile(perWindow, FIX_CONFIG.intervalHigh) } : null,
        windowsUsed: past.length,
        note: enough ? `what this cause cost per window in ${past.length} of your own windows` : `fewer than ${FIX_CONFIG.minWindowsForInterval} comparable windows, so no interval`,
      });
    } else if (cause === "subagents") {
      // Sub-agent spend above the typical window is the part a cap would remove.
      const perWindow = past.map((a) => a.causes.subagents.micros);
      const typical = median(perWindow);
      const addressable = Math.max(0, windowMicros - typical);
      const excess = perWindow.map((m) => Math.max(0, m - typical)).sort((a, b) => a - b);
      fixes.push({
        cause,
        fix: text,
        basis: enough ? "own_history" : "heuristic_estimate",
        windowMicros,
        addressableMicros: enough ? addressable : windowMicros,
        interval: enough ? { lowMicros: percentile(excess, FIX_CONFIG.intervalLow), highMicros: percentile(excess, FIX_CONFIG.intervalHigh) } : null,
        windowsUsed: past.length,
        note: enough ? `sub-agent spend above your typical window, over ${past.length} windows` : "fewer than 3 comparable windows: shown as an upper bound",
      });
    } else {
      fixes.push({
        cause,
        fix: text,
        basis: "heuristic_estimate",
        windowMicros,
        addressableMicros: windowMicros,
        interval: null,
        windowsUsed: past.length,
        note: "an upper bound: the logs do not show how much of this was avoidable",
      });
    }
  }
  // Measured fixes (an interval from the owner's own windows) rank above upper bounds, because an upper bound is
  // the whole cause and would otherwise outrank anything measured. A fix with nothing to remove is not listed.
  const key = (f: Fix): number => (f.interval ? (f.interval.lowMicros + f.interval.highMicros) / 2 : f.addressableMicros);
  const worthListing = (f: Fix): boolean => f.addressableMicros > 0 || (f.interval !== null && f.interval.highMicros > 0);
  return fixes
    .filter(worthListing)
    .sort((a, b) => Number(b.interval !== null) - Number(a.interval !== null) || key(b) - key(a) || a.cause.localeCompare(b.cause));
}
