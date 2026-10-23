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
}

export interface TunnelCoverage {
  policy: string;
  trials: TunnelTrial[];
  inside: number;
  coverage: number;
  low: number;
  high: number;
  driftFlagged: number;
  /** Of the trials whose history the tunnel did not flag as drifting, how many landed inside. */
  insideWhenUnflagged: { inside: number; n: number };
}

export function summarise(policy: string, trials: TunnelTrial[]): TunnelCoverage {
  const inside = trials.filter((t) => t.inside).length;
  const unflagged = trials.filter((t) => !t.driftFlagged);
  const w = wilson(inside, trials.length);
  return { policy, trials, inside, coverage: trials.length === 0 ? 0 : inside / trials.length, low: w.low, high: w.high, driftFlagged: trials.filter((t) => t.driftFlagged).length, insideWhenUnflagged: { inside: unflagged.filter((t) => t.inside).length, n: unflagged.length } };
}

const DAY = 86_400_000;

export async function windTunnelTrial(o: { seed: number; policyFile: string; pricesPath: string; engineers?: number }): Promise<TunnelTrial> {
  const dir = mkdtempSync(join(tmpdir(), "desk-calibrate-"));
  try {
    buildSample({ outDir: dir, seed: o.seed, months: 2, engineers: o.engineers ?? 6, start: "2026-09-01" } as never);
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
      const realized = replayPolicy(policy, next).savedMicros;
      return { seed: o.seed, historySessions: history.length, predictedLowMicros: tunnel.savedMonthSpread.p05, predictedHighMicros: tunnel.savedMonthSpread.p95, predictedMeanMicros: tunnel.savedMicros.mid, realizedMicros: realized, inside: realized >= tunnel.savedMonthSpread.p05 && realized <= tunnel.savedMonthSpread.p95, driftFlagged: tunnel.historyMayNotPredict };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderCoverage(c: TunnelCoverage): string {
  const out = [`Wind tunnel coverage: ${c.trials.length} constructed samples, policy ${c.policy}`];
  out.push(`  the tunnel's 90% range for one month held the realized month in ${c.inside} of ${c.trials.length} (${(c.coverage * 100).toFixed(0)}%; 95% interval ${(c.low * 100).toFixed(0)}% to ${(c.high * 100).toFixed(0)}%)`);
  out.push(`  it flagged the history as drifting in ${c.driftFlagged} of ${c.trials.length}; inside the range when not flagged: ${c.insideWhenUnflagged.inside} of ${c.insideWhenUnflagged.n}`);
  out.push("  The scenario plants a change of tool version and model mix in the second month, which the tunnel was not promised to foresee.");
  return out.join("\n");
}
