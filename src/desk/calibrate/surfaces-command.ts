import { existsSync, readFileSync } from "node:fs";

import type { CaptureDb } from "../capture/store.ts";
import type { Ledger } from "../ledger/db.ts";
import { renderReliability, type SurfaceResult } from "./surface.ts";
import { attributionSurface, auditorSurface, forecastSurface, judgeSurface } from "./surfaces.ts";
import type { FateTruth } from "./attribution.ts";

export function saveSurface(store: CaptureDb, r: SurfaceResult, now: () => Date = () => new Date()): number {
  const res = store.prepare("INSERT INTO calibration_metrics (surface, created_at, n, status, reason, ece, brier, threshold, precision_at_threshold, coverage_at_threshold, abstain_always) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(r.surface, now().toISOString(), r.n, r.status, r.reason, r.calibration?.ece ?? null, r.calibration?.brier ?? null, r.threshold, r.precisionAtThreshold, r.coverageAtThreshold, r.abstainAlways ? 1 : 0);
  const id = Number(res.lastInsertRowid);
  r.calibration?.bins.forEach((b, i) => {
    if (b.n > 0) store.prepare("INSERT INTO calibration_curves (metric_id, bin, low, high, n, mean_predicted, observed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, i, b.low, b.high, b.n, b.meanPredicted, b.observed);
  });
  return id;
}

/** `desk calibrate surfaces`: the same calibration for each place the Desk states a confidence, from the data it keeps. */
export async function surfacesCommand(o: { db: Ledger; truthPath: string; store: CaptureDb | null; now?: () => Date }): Promise<string> {
  const out: string[] = ["Does a stated confidence mean what it says? For each surface, ten equal-width bins, the expected calibration error, and the confidence below which the Desk should abstain (the lowest at which answers were right 80% of the time; with fewer than 50 pairs a default is used and said so)."];
  const results: SurfaceResult[] = [];
  if (existsSync(o.truthPath)) results.push(attributionSurface(o.db, (JSON.parse(readFileSync(o.truthPath, "utf8")) as { sessions: FateTruth[] }).sessions));
  else out.push(`attribution: not read, because ${o.truthPath} (the constructed sample's planted truth) is missing. Run: desk --sample`);
  const forecast = forecastSurface();
  if (forecast) results.push(forecast);
  else out.push("forecast: not read, because the recorded wind-tunnel study is missing.");
  if (o.store) results.push(judgeSurface(o.store));
  else out.push("judge_panel: not read, because there is no capture store yet. `desk judge admit` makes the pairs it is calibrated on.");
  try {
    results.push(await auditorSurface(o.db));
  } catch (e) {
    out.push(`auditor: not read, because ${(e as Error).message}.`);
  }
  for (const r of results) {
    out.push("", renderReliability(r));
    if (o.store) saveSurface(o.store, r, o.now);
  }
  if (o.store) out.push("", "Saved to the capture store (calibration_metrics, calibration_curves).");
  return out.join("\n");
}
