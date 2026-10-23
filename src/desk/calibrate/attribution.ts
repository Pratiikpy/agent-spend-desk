import type { Ledger } from "../ledger/db.ts";

/**
 * Does a link's stated confidence mean what it says? The Desk ties a session to a commit and calls the link high,
 * medium or low. Against the planted truth of the constructed sample, this reads off how often a link at each level
 * is right, with a 95% Wilson interval, and whether the levels are ordered as their names promise. It is a
 * reliability table, not an ECE: the levels are words, not probabilities, and the Desk does not pretend they are.
 */
export interface FateTruth {
  id: string;
  fate: "landed" | "unlanded" | "reverted";
}

export interface Reliability {
  level: "high" | "medium" | "low" | "unlinked";
  n: number;
  /** For a link: the session truly produced a commit. For unlinked: it truly produced none. */
  right: number;
  rate: number;
  low: number;
  high: number;
}

export interface AttributionReport {
  levels: Reliability[];
  /** Linked sessions whose landing state matches the planted fate (merged or kept for landed, reverted for reverted). */
  stateRight: number;
  stateTotal: number;
  /** High is at least as reliable as medium, and medium as low. */
  ordered: boolean;
}

/** Wilson score interval for k successes in n trials, at 95%. */
export function wilson(k: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export function attributionReliability(db: Ledger, truth: readonly FateTruth[]): AttributionReport {
  const fate = new Map(truth.map((t) => [t.id, t.fate]));
  const rows = db.prepare("SELECT session_id AS id, state, best_confidence AS conf FROM session_outcome").all() as unknown as { id: string; state: string; conf: string | null }[];
  const tally = new Map<Reliability["level"], { n: number; right: number }>(["high", "medium", "low", "unlinked"].map((l) => [l as Reliability["level"], { n: 0, right: 0 }]));
  let stateRight = 0;
  let stateTotal = 0;
  for (const r of rows) {
    const f = fate.get(r.id);
    if (!f) continue;
    const producedCommit = f === "landed" || f === "reverted";
    const level: Reliability["level"] = r.state === "unlinked" || r.conf === null ? "unlinked" : (r.conf as "high" | "medium" | "low");
    const t = tally.get(level)!;
    t.n += 1;
    if (level === "unlinked" ? !producedCommit : producedCommit) t.right += 1;
    if (level !== "unlinked") {
      stateTotal += 1;
      const stateOk = f === "reverted" ? r.state === "reverted" : f === "landed" ? r.state === "merged" || r.state === "kept" : false;
      if (stateOk) stateRight += 1;
    }
  }
  const levels = [...tally.entries()].map(([level, t]) => ({ level, n: t.n, right: t.right, rate: t.n === 0 ? 0 : t.right / t.n, ...wilson(t.right, t.n) }));
  const rate = (l: string): number | null => {
    const x = levels.find((y) => y.level === l);
    return x && x.n > 0 ? x.rate : null;
  };
  const [h, m, lo] = [rate("high"), rate("medium"), rate("low")];
  const ordered = (h === null || m === null || h >= m) && (m === null || lo === null || m >= lo) && (h === null || lo === null || h >= lo);
  return { levels, stateRight, stateTotal, ordered };
}

export function renderAttribution(r: AttributionReport): string {
  const out = ["Link confidence against the planted truth (constructed sample)"];
  for (const l of r.levels) {
    const what = l.level === "unlinked" ? "truly produced no commit" : "truly produced a commit";
    out.push(`  ${l.level.padEnd(9)} ${String(l.n).padStart(4)} sessions   ${(l.rate * 100).toFixed(1).padStart(5)}% ${what}   (95% interval ${(l.low * 100).toFixed(1)}% to ${(l.high * 100).toFixed(1)}%)`);
  }
  out.push(`  of the linked sessions, ${r.stateRight} of ${r.stateTotal} carry the landing state the truth gives`);
  out.push(r.ordered ? "  The levels are ordered as their names say: a higher level is at least as often right." : "  The levels are NOT ordered as their names say.");
  return out.join("\n");
}
