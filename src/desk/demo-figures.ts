import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAutopsyCalls } from "./autopsy/load.ts";
import { readRows, buildSeries } from "./canary/store.ts";
import { DEFAULT_CONFIG, evaluateAt, makeContext } from "./canary/verdict.ts";
import type { RunRow } from "./canary/runner.ts";
import { runCard } from "./card/run.ts";
import { openLedger } from "./ledger/db.ts";
import { loadSnapshot } from "./pricing/pricebook.ts";
import { routeReplay } from "./route/replay.ts";
import { buildSample, DEFAULT_SAMPLE } from "./sample/gen.ts";
import { wasteCommand } from "./waste/command.ts";

/**
 * The numbers the demo's scenes stand on, computed from a sample and a canary file, so that the same scenes can be run again on a changed sample and every figure that depends on the
 * change can be seen to move (DF-019). Nothing here is stored: each call recomputes from the files.
 */
export interface Figure {
  id: string;
  scene: string;
  label: string;
  value: string;
}

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
const pts = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} points`;

export function canaryFigures(rows: readonly RunRow[]): Figure[] {
  const series = buildSeries(rows);
  if (!series) return [{ id: "canary.verdict", scene: "2", label: "canary verdict", value: "no usable runs" }];
  const v = evaluateAt(makeContext(series), series.days);
  const out: Figure[] = [{ id: "canary.verdict", scene: "2", label: `canary verdict, day ${series.days}`, value: v.verdict }];
  if (v.delta !== null && v.ci) out.push({ id: "canary.delta", scene: "2", label: "change against the baseline (99% interval)", value: `${pts(v.delta)} (${pts(v.ci.low)} to ${pts(v.ci.high)})` });
  const route = routeReplay(rows, { tolerance: 0.1 });
  if (!route) out.push({ id: "route.delta", scene: "3", label: "cheaper route, pass-rate change", value: "not computed: the file holds one served model, so there is no second route to compare" });
  else out.push({ id: "route.delta", scene: "3", label: `cheaper route (${route.cheapModel}) against ${route.strongModel}, pass-rate change (95% interval)`, value: `${pts(route.delta)} (${pts(route.interval.low)} to ${pts(route.interval.high)}); ${route.clusters.filter((c) => c.routable).length} of ${route.clusters.length} kinds of task routable` });
  return out;
}

export async function ledgerFigures(sampleDir: string, prices: string): Promise<Figure[]> {
  await runCard({ mode: "sample", claudeDir: "", dbPath: "", pricesPath: prices, outDir: join(sampleDir, "card"), sampleDir, days: 14, hours: 5, repos: [], color: false, width: 100 });
  const db = openLedger(join(sampleDir, "ledger.db"));
  try {
    const snapshot = loadSnapshot(prices);
    const calls = loadAutopsyCalls(db, snapshot, "0000", "9999");
    const total = calls.reduce((s, c) => s + (c.micros ? c.micros.input + c.micros.output + c.micros.read + c.micros.write5m + c.micros.write1h : 0), 0);
    const waste = wasteCommand(db, snapshot, "0000", "9999");
    const big = [...waste.events].sort((a, b) => b.micros - a.micros)[0];
    const sure = waste.events.filter((e) => e.confidence === "high").reduce((s, e) => s + e.micros, 0);
    const out: Figure[] = [
      { id: "bill.total", scene: "0", label: "estimated spend over the sample (priced calls only, not an invoice)", value: `${usd(total)} over ${calls.length.toLocaleString("en-US")} calls` },
      { id: "waste.total", scene: "0", label: "estimated waste found by rules that read the log directly", value: usd(sure) },
    ];
    out.push(big ? { id: "waste.biggest", scene: "1", label: "biggest waste block", value: `${big.rule}, ${usd(big.micros)}, ${big.calls.length} calls in session ${big.sessionId.slice(0, 8)}` } : { id: "waste.biggest", scene: "1", label: "biggest waste block", value: "none found" });
    return out;
  } finally {
    db.close();
  }
}

/** A copy of the canary rows in which the model never changed: every row after the baseline takes the score its task had on the matching day of the baseline. */
export function steadyRows(rows: readonly RunRow[]): RunRow[] {
  const base = DEFAULT_CONFIG.baselineDays;
  const key = (r: RunRow): string => `${r.arm}|${r.taskId}`;
  const byDay = new Map<string, RunRow[]>();
  for (const r of rows) {
    const k = `${key(r)}|${r.day}`;
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.day <= base) return r;
    const pick = byDay.get(`${key(r)}|${((r.day - 1) % base) + 1}`) ?? [];
    const idx = (seen.get(`${key(r)}|${r.day}`) ?? 0);
    seen.set(`${key(r)}|${r.day}`, idx + 1);
    const from = pick[idx % Math.max(pick.length, 1)];
    return from ? { ...r, score: from.score, servedModel: from.servedModel, error: from.error, replySha: from.replySha } : r;
  });
}

export interface Comparison {
  seed: number;
  rows: { id: string; scene: string; label: string; recorded: string; changed: string; moved: boolean }[];
}

/** The same figures on the recorded sample and on a changed one: another seed with the planted tool change left out, and a canary file in which the model never changed. */
export async function compareDemo(o: { sampleDir: string; prices: string; runsPath: string; seed: number }): Promise<Comparison> {
  const recorded = [...(await ledgerFigures(o.sampleDir, o.prices)), ...canaryFigures(readRows(o.runsPath).rows)];
  const dir = mkdtempSync(join(tmpdir(), "desk-demo-mutate-"));
  try {
    buildSample({ ...DEFAULT_SAMPLE, seed: o.seed, changeAtMs: null, outDir: dir });
    const changed = [...(await ledgerFigures(dir, o.prices)), ...canaryFigures(steadyRows(readRows(o.runsPath).rows))];
    return { seed: o.seed, rows: recorded.map((f) => {
      const g = changed.find((x) => x.id === f.id);
      return { id: f.id, scene: f.scene, label: f.label, recorded: f.value, changed: g?.value ?? "not computed", moved: g?.value !== f.value };
    }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderComparison(c: Comparison): string {
  const lines = [`Every figure the scenes stand on, on the recorded sample and on a changed one (seed ${c.seed}, no planted tool change, and a canary file in which the model never changed).`];
  for (const r of c.rows) lines.push(`  scene ${r.scene}  ${r.label}`, `      recorded: ${r.recorded}`, `      changed:  ${r.changed}${r.moved ? "" : "   (did not move)"}`);
  const moved = c.rows.filter((r) => r.moved).length;
  lines.push(`${moved} of ${c.rows.length} figures moved. A figure that did not move is one the change does not touch; a figure that moved was computed again from the changed files.`);
  return lines.join("\n");
}
