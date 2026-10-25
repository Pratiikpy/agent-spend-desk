import { describe, expect, it } from "vitest";

import { runSwap } from "../../src/desk/replay/run.ts";
import { judgeRun, latestAdmission, readLabels, renderJudged, runAdmission, type LabelFile } from "../../src/desk/judge/run.ts";
import { panelId, PanelConfigError, type Judge } from "../../src/desk/judge/panel.ts";
import type { ModelRequest, ModelResponse } from "../../src/desk/agents/model.ts";
import { fresh, measured, put, Scripted, solver } from "./support/toy-swap.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The panel at work on a swap: refused until it has been checked against labels, advisory without them, and scored with them. */
const judge = (id: string, family: string, model: string, pick: (text: string) => "first" | "second" | "tie"): Judge => ({
  id, family, model,
  port: { async complete(req: ModelRequest): Promise<ModelResponse> {
    return { content: JSON.stringify({ winner: pick(req.messages[1]!.content), reason: "x" }), toolCalls: [], servedBy: "other", servedModel: model, source: "live", usage: null };
  } },
});
/** Prefers the change that contains a real edit (a plus line) over one that is empty. */
const prefersWork = (text: string): "first" | "second" | "tie" => {
  const first = text.slice(text.indexOf("First change:"), text.indexOf("Second change:"));
  const second = text.slice(text.indexOf("Second change:"));
  const f = first.includes("+exports");
  const s = second.includes("+exports");
  return f && !s ? "first" : s && !f ? "second" : "tie";
};
const panel = (): Judge[] => [judge("j1", "nvidia", "judge-m1", prefersWork), judge("j2", "google", "judge-m2", prefersWork), judge("j3", "google", "judge-m3", prefersWork)];

function labels(n: number, ownerAgrees: number): LabelFile[] {
  const work = "--- a/src/x.js\n+++ b/src/x.js\n-exports.x = () => null;\n+exports.x = (x) => x + 1;";
  return Array.from({ length: n }, (_, i) => {
    const aWins = i % 3 === 0;
    const bWins = i % 3 === 1;
    const a = aWins ? work : "";
    const b = bWins ? work : "";
    const truth = aWins ? "A" : bWins ? "B" : "tie";
    const owner = i < ownerAgrees ? truth : truth === "A" ? "B" : "A";
    return { id: `l${i}`, task: "Implement x(x) so that it adds one.", a, b, owner: owner as LabelFile["owner"] };
  });
}

describe("a panel put to work on a swap", () => {
  it("scores nothing until it has been checked against the owner's labels, can be looked at as advisory, and is scored once admitted", async () => {
    const { store, tasks, gold } = await measured(3);
    const swap = await runSwap({ store, tasks, baseline: { name: "strong", model: "route-strong", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "route-lazy", port: new Scripted(() => ({ content: "no" })) }, repeats: 1, resamples: 500 });
    const under = ["route-strong", "route-lazy"];
    const spec = { baseline: "strong", candidate: "lazy", underTest: under };
    await expect(judgeRun(store, swap.runId, panel(), spec)).rejects.toThrow(/has not been checked against your labels, so it scores nothing/);

    const look = await judgeRun(store, swap.runId, panel(), { ...spec, advisory: true });
    expect(look).toMatchObject({ advisory: true, admission: "none", undecided: 0 });
    expect(look.pairs).toHaveLength(3);
    expect(look.baselineWinRate).toBe(1);
    expect(renderJudged(look)).toMatch(/^ADVISORY: panel .* none of this is a score/);
    expect(store.prepare("SELECT COUNT(*) n, MIN(advisory) a FROM judge_pair").get()).toEqual({ n: 3, a: 1 });

    const bad = await runAdmission(store, panel(), labels(20, 12), under);
    expect(bad.status).toBe("excluded");
    await expect(judgeRun(store, swap.runId, panel(), spec)).rejects.toThrow(/was excluded when it was checked/);

    const good = await runAdmission(store, panel(), labels(20, 18), under);
    expect(good).toMatchObject({ status: "admitted", labels: 20 });
    expect(latestAdmission(store, panelId(panel()))).toMatchObject({ status: "admitted", labels: 20 });
    const scored = await judgeRun(store, swap.runId, panel(), spec);
    expect(scored).toMatchObject({ advisory: false, admission: "admitted", baselineWinRate: 1, baselineWinRateLengthNormalised: 1 });
    expect(store.prepare("SELECT MIN(advisory) a FROM judge_pair WHERE advisory = 0").get()).toEqual({ a: 0 });
  }, 480_000);

  it("will not start with the model under test among the judges", async () => {
    const { store, tasks, gold } = await measured(1);
    const swap = await runSwap({ store, tasks, baseline: { name: "strong", model: "judge-m1", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "route-lazy", port: new Scripted(() => ({ content: "no" })) }, repeats: 1, resamples: 200 });
    await expect(judgeRun(store, swap.runId, panel(), { baseline: "strong", candidate: "lazy", underTest: ["judge-m1", "route-lazy"], advisory: true })).rejects.toThrow(PanelConfigError);
    await expect(runAdmission(store, panel(), labels(20, 20), ["judge-m2"])).rejects.toThrow(/does not grade itself/);
  }, 120_000);

  it("reads the owner's labels from a file and refuses a malformed one", () => {
    const dir = fresh("labels");
    put(`${dir}/ok.json`, JSON.stringify({ labels: labels(2, 2) }));
    expect(readLabels(join(dir, "ok.json"))).toHaveLength(2);
    writeFileSync(join(dir, "bad.json"), JSON.stringify([{ id: "x", task: "t", a: "", b: "", owner: "maybe" }]));
    expect(() => readLabels(join(dir, "bad.json"))).toThrow(/owner verdict of A, B or tie/);
    writeFileSync(join(dir, "worse.json"), JSON.stringify({ nope: 1 }));
    expect(() => readLabels(join(dir, "worse.json"))).toThrow(/should be a list/);
  });
});
