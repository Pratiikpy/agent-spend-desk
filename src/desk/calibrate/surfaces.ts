import { existsSync, readFileSync } from "node:fs";

import { CassettePort } from "../agents/model.ts";
import { runA2 } from "../bench/arms.ts";
import { CASSETTES_E } from "../bench/command.ts";
import { buildQuestions } from "../bench/questions.ts";
import { score } from "../bench/score.ts";
import type { CaptureDb } from "../capture/store.ts";
import type { Ledger } from "../ledger/db.ts";
import { attributionReliability, type FateTruth } from "./attribution.ts";
import { calibrateSurface, DEFAULT_THRESHOLDS, MIN_SAMPLES, TARGET_PRECISION, type Sample, type SurfaceResult } from "./surface.ts";
import type { TunnelCoverage } from "./windtunnel.ts";

/**
 * The four surfaces of the Desk's judgement, each read from the data it already keeps, then calibrated alike (DF-106): link confidence against the planted fate of the sample,
 * the wind tunnel's stated chance of blocking landed work against what the realised month did, a judge panel's agreement with itself against the owner's own labels, and the
 * Auditor's share of cited claims that were needed against whether the answer was right.
 */
export const COVERAGE_FILE = "docs/verification/calibration/windtunnel.json";
const SET_E_SEED = 20261028;

const RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

export function attributionSurface(db: Ledger, truth: readonly FateTruth[]): SurfaceResult {
  const report = attributionReliability(db, truth);
  const linked = report.levels.filter((l) => l.level !== "unlinked");
  const n = linked.reduce((s, l) => s + l.n, 0);
  const base: SurfaceResult = { surface: "attribution", n, status: "uncalibrated_default", reason: null, calibration: null, threshold: DEFAULT_THRESHOLDS.attribution, precisionAtThreshold: null, coverageAtThreshold: null, abstainAlways: false };
  if (n < MIN_SAMPLES) return { ...base, reason: `${n} links with a known fate; tuning needs at least ${MIN_SAMPLES}, so the default threshold (high only) is used`, threshold: RANK["high"] as number, thresholdLabel: "high" };
  // The levels are words, so no calibration curve is made: the lowest level at which links are right at the target rate is found, counting from the top.
  let chosen: { level: string; precision: number; n: number } | null = null;
  for (const level of ["low", "medium", "high"]) {
    const at = linked.filter((l) => RANK[l.level]! >= RANK[level]!);
    const total = at.reduce((s, l) => s + l.n, 0);
    const right = at.reduce((s, l) => s + l.right, 0);
    if (total >= 10 && right / total >= TARGET_PRECISION) {
      chosen = { level, precision: right / total, n: total };
      break;
    }
  }
  if (!chosen) return { ...base, status: "calibrated", reason: `no level reaches ${Math.round(TARGET_PRECISION * 100)}% on these links`, threshold: 4, thresholdLabel: "none", abstainAlways: true };
  return { ...base, status: "calibrated", threshold: RANK[chosen.level] as number, thresholdLabel: chosen.level, precisionAtThreshold: chosen.precision, coverageAtThreshold: chosen.n / n };
}

export function forecastSurface(file: string = COVERAGE_FILE): SurfaceResult | null {
  if (!existsSync(file)) return null;
  const stored = JSON.parse(readFileSync(file, "utf8")) as TunnelCoverage;
  const samples: Sample[] = stored.trials.filter((t) => typeof t.pBlockedSmoothed === "number").map((t) => ({ p: t.pBlockedSmoothed, right: t.blockedLandedRealized > 0 }));
  return calibrateSurface("forecast", samples, { event: true });
}

export function judgeSurface(store: CaptureDb): SurfaceResult {
  const rows = store.prepare("SELECT owner, decision, agreeing_share AS share FROM judge_label WHERE decision IS NOT NULL AND agreeing_share IS NOT NULL").all() as { owner: string; decision: string; share: number }[];
  return calibrateSurface("judge_panel", rows.map((r) => ({ p: r.share, right: r.decision === r.owner })));
}

export async function auditorSurface(db: Ledger): Promise<SurfaceResult> {
  const questions = buildQuestions(db, SET_E_SEED, "E");
  const port = new CassettePort(CASSETTES_E);
  const samples: Sample[] = [];
  for (const q of questions) {
    const out = await runA2({ db, port, question: q.text });
    if (out.error || !out.faithfulness || out.faithfulness.essentialShare === null) continue;
    samples.push({ p: out.faithfulness.essentialShare, right: score(q, out.answer).exact });
  }
  return calibrateSurface("auditor", samples);
}
