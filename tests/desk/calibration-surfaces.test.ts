import { describe, expect, it } from "vitest";

import type { ModelRequest, ModelResponse } from "../../src/desk/agents/model.ts";
import { calibrateSurface, DEFAULT_THRESHOLDS, renderReliability, type Sample } from "../../src/desk/calibrate/surface.ts";
import { attributionSurface, judgeSurface } from "../../src/desk/calibrate/surfaces.ts";
import { saveSurface, surfacesCommand } from "../../src/desk/calibrate/surfaces-command.ts";
import { openCapture } from "../../src/desk/capture/store.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { runAdmission, type LabelFile } from "../../src/desk/judge/run.ts";
import type { Judge } from "../../src/desk/judge/panel.ts";

/** Calibration across the surfaces (DF-106): ten bins, the error, the abstain threshold, and the default that says it is one. */
const samples = (spec: [number, number, number][]): Sample[] => spec.flatMap(([p, n, right]) => Array.from({ length: n }, (_, i) => ({ p, right: i < right })));

describe("one surface", () => {
  it("uses the default and says so when it has fewer than fifty pairs", () => {
    const r = calibrateSurface("judge_panel", samples([[0.9, 40, 36]]));
    expect(r).toMatchObject({ status: "uncalibrated_default", threshold: DEFAULT_THRESHOLDS.judge_panel, n: 40, precisionAtThreshold: null });
    expect(r.reason).toMatch(/40 pairs; tuning needs at least 50, so the default threshold 0.85 is used/);
    expect(calibrateSurface("auditor", [])).toMatchObject({ status: "uncalibrated_default", calibration: null, threshold: 0.8 });
  });

  it("makes ten bins, a near-zero error for a confidence that is right as often as it says, and a large one for a confidence that is not", () => {
    const good = calibrateSurface("auditor", samples([[0.9, 100, 90], [0.6, 100, 60]]));
    expect(good.calibration!.bins).toHaveLength(10);
    expect(good.calibration!.ece).toBeLessThan(1e-9);
    const over = calibrateSurface("auditor", samples([[0.95, 100, 55]]));
    expect(over.calibration!.ece).toBeCloseTo(0.4, 6);
  });

  it("puts the abstain threshold at the lowest confidence whose answers were right 80% of the time", () => {
    // Wrong half the time at 0.5, right 70% at 0.7, right 90% at 0.9: from 0.7 up the answers are (70*0.7+90*0.9)/160 = 81%.
    const r = calibrateSurface("judge_panel", samples([[0.5, 80, 40], [0.7, 80, 56], [0.9, 80, 72]]));
    expect(r.status).toBe("calibrated");
    expect(r.threshold).toBe(0.7);
    expect(r.precisionAtThreshold).toBeCloseTo((56 + 72) / 160, 9);
    expect(r.coverageAtThreshold).toBeCloseTo(160 / 240, 9);
    expect(r.abstainAlways).toBe(false);
  });

  it("abstains throughout when no confidence reaches the target, and does not trust a few lucky answers at the top", () => {
    const none = calibrateSurface("judge_panel", samples([[0.6, 100, 55], [0.9, 100, 60]]));
    expect(none).toMatchObject({ abstainAlways: true, threshold: 1, precisionAtThreshold: null });
    expect(none.reason).toMatch(/no threshold reaches 80% precision/);
    const lucky = calibrateSurface("judge_panel", [...samples([[0.6, 99, 40]]), ...samples([[1, 3, 3]])]);
    expect(lucky.abstainAlways).toBe(true);
  });

  it("reads a forecast by the side it favours: a 5% chance that did not happen is a confident right call", () => {
    const r = calibrateSurface("forecast", samples([[0.05, 60, 3], [0.95, 60, 57]]), { event: true });
    expect(r.threshold).toBe(0.95);
    expect(r.precisionAtThreshold).toBeCloseTo(0.95, 9);
    expect(r.calibration!.ece).toBeLessThan(1e-9);
  });

  it("draws the reliability diagram with each bin's stated and observed rate", () => {
    const text = renderReliability(calibrateSurface("auditor", samples([[0.9, 100, 90]])));
    expect(text).toMatch(/^auditor: 100 pairs, calibrated\n {2}expected calibration error 0\.000, Brier 0\.0\d\d, right 90% overall\n {2}0\.9-1\.0 {2}n= 100 {2}said {2}90% {2}right {2}90% {2}#{18}\.\.\n {2}abstain below 0\.90: 90% right/);
    expect(renderReliability(calibrateSurface("auditor", samples([[0.9, 3, 3]])))).toMatch(/UNCALIBRATED DEFAULT/);
  });
});

describe("the surfaces", () => {
  it("reads link confidence by level against the planted fate, and abstains below the lowest level that is right 80% of the time", () => {
    const db = openLedger(":memory:");
    const truth: { id: string; fate: "landed" | "unlanded" | "reverted" }[] = [];
    const add = (id: string, conf: "high" | "medium" | "low", fate: "landed" | "unlanded") => {
      db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, 'merged', ?, 1, 'x')").run(id, conf);
      truth.push({ id, fate });
    };
    for (let i = 0; i < 40; i += 1) add(`h${i}`, "high", i < 39 ? "landed" : "unlanded");
    for (let i = 0; i < 30; i += 1) add(`m${i}`, "medium", i < 18 ? "landed" : "unlanded");
    for (let i = 0; i < 20; i += 1) add(`l${i}`, "low", i < 6 ? "landed" : "unlanded");
    const r = attributionSurface(db, truth);
    // From low up the links are right 63 of 90 times (70%); from medium up, 57 of 70 (81%).
    expect(r).toMatchObject({ status: "calibrated", n: 90, thresholdLabel: "medium", threshold: 2 });
    expect(r.precisionAtThreshold).toBeCloseTo(57 / 70, 9);
    expect(r.coverageAtThreshold).toBeCloseTo(70 / 90, 9);
    expect(attributionSurface(db, truth.slice(0, 20))).toMatchObject({ status: "uncalibrated_default", thresholdLabel: "high" });
  });

  const judge = (id: string, family: string, pick: (t: string) => "first" | "second" | "tie"): Judge => ({
    id, family, model: `m-${id}`,
    port: { async complete(req: ModelRequest): Promise<ModelResponse> {
      return { content: JSON.stringify({ winner: pick(req.messages[1]!.content), reason: "x" }), toolCalls: [], servedBy: "other", servedModel: `m-${id}`, source: "live", usage: null };
    } },
  });
  const prefersWork = (t: string): "first" | "second" | "tie" => {
    const first = t.slice(t.indexOf("First change:"), t.indexOf("Second change:"));
    const second = t.slice(t.indexOf("Second change:"));
    return first.includes("+work") && !second.includes("+work") ? "first" : second.includes("+work") && !first.includes("+work") ? "second" : "tie";
  };

  it("keeps what a panel said about each labelled pair and the share of judges behind it, and calibrates the panel on them", async () => {
    const store = openCapture(":memory:");
    const panel = [judge("a", "x", prefersWork), judge("b", "y", prefersWork), judge("c", "y", (t) => (t.includes("odd") ? "tie" : prefersWork(t)))];
    const labels: LabelFile[] = Array.from({ length: 24 }, (_, i) => ({ id: `l${i}`, task: i % 4 === 0 ? "odd task" : "task", a: "+work", b: "", owner: i < 20 ? "A" : "B" }));
    await runAdmission(store, panel, labels, ["other"]);
    const rows = store.prepare("SELECT owner, decision, agreeing_share AS s FROM judge_label ORDER BY label_id").all() as { owner: string; decision: string; s: number }[];
    expect(rows).toHaveLength(24);
    expect(rows.filter((r) => r.s === 1).length).toBeGreaterThan(0);
    const r = judgeSurface(store);
    expect(r.n).toBe(24);
    expect(r.status).toBe("uncalibrated_default");
    expect(r.calibration!.bins).toHaveLength(10);
  });

  it("saves a calibration and its curve, and the command prints each surface and says what it could not read", async () => {
    const store = openCapture(":memory:");
    const id = saveSurface(store, calibrateSurface("auditor", samples([[0.9, 100, 90], [0.6, 100, 60]])), () => new Date("2026-10-25T00:00:00Z"));
    expect(store.prepare("SELECT surface, status, n, abstain_always AS a FROM calibration_metrics WHERE metric_id = ?").get(id)).toEqual({ surface: "auditor", status: "calibrated", n: 200, a: 0 });
    expect((store.prepare("SELECT COUNT(*) n FROM calibration_curves WHERE metric_id = ?").get(id) as { n: number }).n).toBe(2);
    const text = await surfacesCommand({ db: openLedger(":memory:"), truthPath: "no-such-truth.json", store: null });
    expect(text).toMatch(/attribution: not read, because no-such-truth\.json/);
    expect(text).toMatch(/judge_panel: not read, because there is no capture store yet/);
    expect(text).toMatch(/auditor: not read, because the ledger is empty\./);
  });
});
