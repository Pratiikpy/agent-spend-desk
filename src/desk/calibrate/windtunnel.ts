import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findJsonlLogs } from "../ingest/discover.ts";
import { openLedger } from "../ledger/db.ts";
import { ingestClaudeCode } from "../ledger/ingest.ts";
import { linkOutcomes } from "../outcomes/link.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { replayPolicy } from "../replay/policy-replay.ts";
import { windTunnel } from "../replay/wind-tunnel.ts";
import { buildSample, sampleLogsDir, sampleReposDir } from "../sample/gen.ts";
import { TEAM_OF_REPO } from "../silo/seed.ts";
import { wilson } from "./attribution.ts";

/**
 * Does the wind tunnel's interval mean what it says? For each of many constructed samples (one seed each), the tunnel
 * is built from the first 30 days only, and asked for the range of a single month. The second 30 days are then replayed
 * for real. The tunnel's own range for one month is nominally 90%, so about nine seeds in ten should land inside it.
 * The constructed scenario plants a change of tool version and model mix in the middle of the second month, which is a
 * regime change the tunnel was never promised to see; the study reports it as it comes.
 */
export interface TunnelTrial {
  seed: number;
  historySessions: number;
  predictedLowMicros: number;
  predictedHighMicros: number;
  predictedMeanMicros: number;
  realizedMicros: number;
  inside: boolean;
  driftFlagged: boolean;
  /** The tunnel's chance of blocking at least one landed session next month: resampled, and with a zero count not taken for zero. */
  pBlockedRaw: number;
  pBlockedSmoothed: number;
  /** How many landed sessions the policy blocked in the month that followed. */
  blockedLandedRealized: number;
}

/** A reliability table for a stated probability against what happened: the bins, the expected calibration error and the Brier score. */
export interface Calibration {
  n: number;
  bins: { low: number; high: number; n: number; meanPredicted: number; observed: number }[];
  /** Weighted mean gap between the stated probability and the observed rate, over equal-width bins. */
  ece: number;
  brier: number;
  /** The share of trials in which the event happened. */
  baseRate: number;
}

export const CALIBRATION_BINS = 5;

export function calibrationOf(predicted: readonly number[], happened: readonly boolean[], bins = CALIBRATION_BINS): Calibration {
  const n = predicted.length;
  const out: Calibration["bins"] = [];
  let ece = 0;
  for (let b = 0; b < bins; b += 1) {
    const low = b / bins;
    const high = (b + 1) / bins;
    const idx = predicted.map((_p, i) => i).filter((i) => (b === bins - 1 ? predicted[i]! >= low && predicted[i]! <= high : predicted[i]! >= low && predicted[i]! < high));
    if (idx.length === 0) {
      out.push({ low, high, n: 0, meanPredicted: 0, observed: 0 });
      continue;
    }
    const meanPredicted = idx.reduce((a, i) => a + predicted[i]!, 0) / idx.length;
    const observed = idx.filter((i) => happened[i]).length / idx.length;
    out.push({ low, high, n: idx.length, meanPredicted, observed });
    ece += (idx.length / n) * Math.abs(meanPredicted - observed);
  }
  const brier = n === 0 ? 0 : predicted.reduce((a, p, i) => a + (p - (happened[i] ? 1 : 0)) ** 2, 0) / n;
  return { n, bins: out, ece, brier, baseRate: n === 0 ? 0 : happened.filter(Boolean).length / n };
}

export interface TunnelCoverage {
  policy: string;
  /** True when the samples had no change of tool version or model mix planted. */
  control?: boolean;
  trials: TunnelTrial[];
  inside: number;
  coverage: number;
  low: number;
  high: number;
  driftFlagged: number;
  /** Of the trials whose history the tunnel did not flag as drifting, how many landed inside. */
  insideWhenUnflagged: { inside: number; n: number };
  /** The stated chance of blocking landed work against whether the month blocked any, as the tunnel gives it and with a zero count not taken for zero. */
  probability?: { raw: Calibration; smoothed: Calibration };
}

export function summarise(policy: string, trials: TunnelTrial[]): TunnelCoverage {
  const inside = trials.filter((t) => t.inside).length;
  const unflagged = trials.filter((t) => !t.driftFlagged);
  const w = wilson(inside, trials.length);
  const happened = trials.map((t) => t.blockedLandedRealized > 0);
  return {
    policy,
    trials,
    inside,
    coverage: trials.length === 0 ? 0 : inside / trials.length,
    low: w.low,
    high: w.high,
    driftFlagged: trials.filter((t) => t.driftFlagged).length,
    insideWhenUnflagged: { inside: unflagged.filter((t) => t.inside).length, n: unflagged.length },
    probability: { raw: calibrationOf(trials.map((t) => t.pBlockedRaw), happened), smoothed: calibrationOf(trials.map((t) => t.pBlockedSmoothed), happened) },
  };
}

const DAY = 86_400_000;

export async function windTunnelTrial(o: { seed: number; policyFile: string; pricesPath: string; engineers?: number; /** Plant no change of tool version or model mix: a control month. */ noChange?: boolean }): Promise<TunnelTrial> {
  const dir = mkdtempSync(join(tmpdir(), "desk-calibrate-"));
  try {
    buildSample({ outDir: dir, seed: o.seed, months: 2, engineers: o.engineers ?? 6, start: "2026-09-01", ...(o.noChange ? { changeAtMs: null } : {}) });
    const db = openLedger(join(dir, "ledger.db"));
    try {
      await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(dir)), loadSnapshot(o.pricesPath));
      linkOutcomes(db, Object.keys(TEAM_OF_REPO).map((n) => join(sampleReposDir(dir), n)), Date.now());
      const sessions = replaySessionsFromLedger(db, loadSnapshot(o.pricesPath), "0000", "9999", { personFromBranch: true });
      const t0 = Math.min(...sessions.map((s) => s.startMs));
      const history = sessions.filter((s) => s.startMs < t0 + 30 * DAY);
      const next = sessions.filter((s) => s.startMs >= t0 + 30 * DAY && s.startMs < t0 + 60 * DAY);
      const policy = parsePolicyYaml(readFileSync(o.policyFile, "utf8"));
      const tunnel = windTunnel(policy, history);
      const realizedRun = replayPolicy(policy, next);
      const realized = realizedRun.savedMicros;
      return { seed: o.seed, historySessions: history.length, predictedLowMicros: tunnel.savedMonthSpread.p05, predictedHighMicros: tunnel.savedMonthSpread.p95, predictedMeanMicros: tunnel.savedMicros.mid, realizedMicros: realized, inside: realized >= tunnel.savedMonthSpread.p05 && realized <= tunnel.savedMonthSpread.p95, driftFlagged: tunnel.historyMayNotPredict, pBlockedRaw: tunnel.pBlockedLanded.mid, pBlockedSmoothed: tunnel.pBlockedLandedSmoothed, blockedLandedRealized: realizedRun.landedBlocked.length };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderCoverage(c: TunnelCoverage): string {
  const out = [`Wind tunnel coverage${c.control ? " (control: no change planted)" : ""}: ${c.trials.length} constructed samples, policy ${c.policy}`];
  out.push(`  the tunnel's 90% range for one month held the realized month in ${c.inside} of ${c.trials.length} (${(c.coverage * 100).toFixed(0)}%; 95% interval ${(c.low * 100).toFixed(0)}% to ${(c.high * 100).toFixed(0)}%)`);
  out.push(`  it flagged the history as drifting in ${c.driftFlagged} of ${c.trials.length}; inside the range when not flagged: ${c.insideWhenUnflagged.inside} of ${c.insideWhenUnflagged.n}`);
  if (c.probability) {
    const line = (name: string, k: Calibration): string => `  ${name}: expected calibration error ${k.ece.toFixed(3)}, Brier score ${k.brier.toFixed(3)} (the month blocked landed work in ${(k.baseRate * 100).toFixed(0)}% of ${k.n} trials)`;
    out.push("  The tunnel's chance of blocking at least one landed session next month, against whether it did:");
    out.push(line("as resampled from the history", c.probability.raw));
    out.push(line("with a zero count not taken for zero", c.probability.smoothed));
  }
  out.push(c.control ? "  Nothing shifts between the two months, so a miss here is the method's own error." : "  The scenario plants a change of tool version and model mix in the second month, which the tunnel was not promised to foresee.");
  return out.join("\n");
}
