import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ModelError } from "../../src/desk/agents/model.ts";
import { call, measured, Scripted, solver, taskId, type Script } from "./support/toy-swap.ts";

import { runItem } from "../../src/desk/replay/agent.ts";
import { reportSwap, renderSwap } from "../../src/desk/replay/report.ts";
import { itemsOf, recomputeReport, runSwap, taskForReplay } from "../../src/desk/replay/run.ts";
import { judgeDelta, pairedBootstrap } from "../../src/desk/stats/paired.ts";

/**
 * Replaying a task on a route (DF-042): the loop a model works in, grading by the tests that decided the task, the stop for what could change the world, what a swap reports, and
 * the statistics under the verdict. The models here are scripted, so each behaviour is made on purpose: one that does the work, one that does nothing, one that asks for a push,
 * one that never stops, one that fails, one that tries to pass by writing its own test.
 */
describe("one task on one route", () => {
  it("passes a model that reads, changes the file and runs the tests, graded by tests it was never shown", async () => {
    const { tasks, gold } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    expect(task.failToPass.length).toBeGreaterThan(0);
    const r = await runItem({ task, route: { name: "strong", model: "m" }, repeat: 1, port: new Scripted(solver(gold)) });
    expect(r).toMatchObject({ status: "pass", turns: 4, modelCalls: 4, tokensIn: 400, tokensOut: 200, divergence: null, error: null, stopped: null });
    expect(r.tool).toMatchObject({ executed: 3, diverged: 0 });
    expect(r.touched).toEqual(["src/inc.js"]);
    expect(r.patch).toContain("--- a/src/inc.js");
    expect(r.patch).toContain("+++ b/src/inc.js");
    expect(r.patch).toContain("-exports.inc = () => null;");
    expect(r.patch).toContain("+exports.inc = (x) => x + 1;");
    expect(r.failToPassPassed).toBe(r.failToPassTotal);
  }, 60_000);

  it("fails a model that stops without doing the work, and one that does the wrong work", async () => {
    const { tasks } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    const lazy = await runItem({ task, route: { name: "lazy", model: "m" }, repeat: 1, port: new Scripted(() => ({ content: "I think it is fine." })) });
    expect(lazy).toMatchObject({ status: "fail", turns: 1, failToPassPassed: 0 });
    const wrong = await runItem({ task, route: { name: "wrong", model: "m" }, repeat: 1, port: new Scripted((_r, turn) => (turn === 0 ? { toolCalls: [call("c", "Write", { file_path: "src/inc.js", content: "exports.inc = (x) => x + 2;\n" })] } : { content: "done" })) });
    expect(wrong.status).toBe("fail");
    expect(wrong.failToPassPassed).toBeLessThan(wrong.failToPassTotal);
  }, 60_000);

  it("cannot pass by writing its own test: the tests that decided the task are laid over what it wrote", async () => {
    const { tasks } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    const r = await runItem({ task, route: { name: "cheat", model: "m" }, repeat: 1, port: new Scripted((_r, turn) => (turn === 0 ? { toolCalls: [call("c", "Write", { file_path: "test/hidden.test.js", content: 'require("node:test")("always", () => {});\n' })] } : { content: "done" })) });
    expect(r.touched).toEqual(["test/hidden.test.js"]);
    expect(r.status).toBe("fail");
  }, 60_000);

  it("stops at a call that could change the world and was not recorded, runs nothing, and says the item is not comparable", async () => {
    const { tasks } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    const r = await runItem({ task, route: { name: "push", model: "m" }, repeat: 1, port: new Scripted((_r, turn) => (turn === 0 ? { toolCalls: [call("c", "Bash", { command: "git push origin main" })] } : { content: "never reached" })) });
    expect(r.status).toBe("diverged");
    expect(r.divergence).toMatch(/asked for Bash with "git push origin main"/);
    expect(r.tool.diverged).toBe(1);
    expect(r.turns).toBe(1);
    expect(r.failToPassPassed).toBe(0);
  }, 60_000);

  it("is stopped at the turn limit and the token limit, and graded as the work stands", async () => {
    const { tasks, gold } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    const loop = await runItem({ task, route: { name: "loop", model: "m" }, repeat: 1, port: new Scripted(() => ({ toolCalls: [call("c", "LS", {})] })), limits: { maxTurns: 3 } });
    expect(loop).toMatchObject({ status: "over_budget", turns: 3 });
    expect(loop.stopped).toMatch(/limit of 3 turns/);
    const tokens = await runItem({ task, route: { name: "tok", model: "m" }, repeat: 1, port: new Scripted(() => ({ toolCalls: [call("c", "LS", {})] })), limits: { maxTokens: 250 } });
    expect(tokens.stopped).toMatch(/limit of 250 tokens/);
    expect(tokens.turns).toBe(2);
    // Out of turns but with the work done when the limit came: graded as it stands, and it stands as a pass.
    const late = await runItem({ task, route: { name: "late", model: "m" }, repeat: 1, port: new Scripted(solver(gold)), limits: { maxTurns: 3 } });
    expect(late.status).toBe("pass");
    expect(late.stopped).toMatch(/limit of 3 turns/);
  }, 90_000);

  it("is an error, with no score, when the model fails or says nothing, and the reason is kept", async () => {
    const { tasks } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    const down = await runItem({ task, route: { name: "down", model: "m" }, repeat: 1, port: new Scripted(() => ({ throws: new ModelError("transient", "the endpoint answered 503", 503) })) });
    expect(down).toMatchObject({ status: "error" });
    expect(down.error).toMatch(/transient 503/);
    const empty = await runItem({ task, route: { name: "empty", model: "m" }, repeat: 1, port: new Scripted(() => ({ content: "" })) });
    expect(empty).toMatchObject({ status: "error", error: "the model gave an empty reply" });
  }, 60_000);

  it("leaves no sandbox behind, and the repository the task came from is untouched", async () => {
    const { tasks, gold } = await measured(1);
    const task = taskForReplay(tasks[0]!);
    const before = readFileSync(join(task.repoPath, "src", "inc.js"), "utf8");
    await runItem({ task, route: { name: "s", model: "m" }, repeat: 1, port: new Scripted(solver(gold)) });
    expect(readFileSync(join(task.repoPath, "src", "inc.js"), "utf8")).toBe(before);
  }, 60_000);
});

describe("a swap of two routes", () => {
  it("runs both on every task, stores each item, and finds the lazy route worse than the one that does the work", async () => {
    const { store, tasks, gold } = await measured(3);
    const seen: string[] = [];
    const out = await runSwap({ store, tasks, baseline: { name: "strong", model: "s", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "l", port: new Scripted(() => ({ content: "no" })) }, repeats: 2, onItem: (r) => seen.push(`${r.route}:${r.status}`), resamples: 2000 });
    expect(out.items).toHaveLength(12);
    expect(seen.filter((s) => s === "strong:pass")).toHaveLength(6);
    expect(seen.filter((s) => s === "lazy:fail")).toHaveLength(6);
    expect(out.report).toMatchObject({ verdict: "worse", tasksPaired: 3, partial: false });
    expect(out.report.gate).toMatchObject({ rate: 1, met: true });
    expect(out.report.delta!.points).toBe(-100);
    expect(out.report.tokens.baseline).toBeGreaterThan(out.report.tokens.candidate!);
    expect(itemsOf(store, out.runId)).toHaveLength(12);
    expect(store.prepare("SELECT status FROM replay_run WHERE run_id = ?").get(out.runId)).toEqual({ status: "complete" });
    const text = renderSwap(out.report);
    expect(text).toContain("verdict: worse");
    expect(text).toContain("reproduction: strong passed 100.0%");
  }, 240_000);

  it("calls a candidate that does the same work equivalent only with enough clusters of tasks behind it, and not on a few", async () => {
    const { store, tasks, gold } = await measured(8);
    const many = await runSwap({ store, tasks, baseline: { name: "a", model: "a", port: new Scripted(solver(gold)) }, candidate: { name: "b", model: "b", port: new Scripted(solver(gold)) }, repeats: 1, resamples: 2000 });
    expect(many.report.delta).toMatchObject({ points: 0 });
    expect(many.report).toMatchObject({ verdict: "equivalent", clusters: { by: "task", count: 8 } });
    const few = await measured(4);
    const four = await runSwap({ store: few.store, tasks: few.tasks, baseline: { name: "a", model: "a", port: new Scripted(solver(few.gold)) }, candidate: { name: "b", model: "b", port: new Scripted(solver(few.gold)) }, repeats: 1, resamples: 2000 });
    expect(four.report.verdict).toBe("inconclusive");
    expect(four.report.why).toMatch(/only 4 clusters of tasks stand behind it and equivalence needs at least 8/);
    const single = await measured(1);
    const one = await runSwap({ store: single.store, tasks: single.tasks, baseline: { name: "a", model: "a", port: new Scripted(solver(single.gold)) }, candidate: { name: "b", model: "b", port: new Scripted(solver(single.gold)) }, repeats: 1, resamples: 2000 });
    expect(one.report.delta).toMatchObject({ low: -100, high: 100 });
    expect(one.report.verdict).toBe("inconclusive");
  }, 480_000);

  it("withholds the comparison when the baseline does not reproduce the work, and says so", async () => {
    const { store, tasks, gold } = await measured(2);
    const out = await runSwap({ store, tasks, baseline: { name: "weak", model: "w", port: new Scripted(() => ({ content: "no" })) }, candidate: { name: "strong", model: "s", port: new Scripted(solver(gold)) }, repeats: 1, resamples: 2000 });
    expect(out.report.verdict).toBe("withheld");
    expect(out.report.why).toMatch(/passed 0\.0% of the 2 scored runs/);
    expect(store.prepare("SELECT status FROM replay_run WHERE run_id = ?").get(out.runId)).toEqual({ status: "withheld" });
  }, 120_000);

  it("keeps a task whose route diverged out of the pairs, counts it, and does not turn it into a failure or a pass", async () => {
    const { store, tasks, gold } = await measured(3);
    const picky: Script = (req, turn) => (taskId(req) === "dbl" && turn === 0 ? { toolCalls: [call("c", "Bash", { command: "make deploy" })] } : solver(gold)(req, turn));
    const out = await runSwap({ store, tasks, baseline: { name: "strong", model: "s", port: new Scripted(solver(gold)) }, candidate: { name: "picky", model: "p", port: new Scripted(picky) }, repeats: 1, resamples: 2000 });
    expect(out.report.notComparable).toMatchObject({ diverged: 1, tasksWithoutAPair: 1 });
    expect(out.report.tasksPaired).toBe(2);
    expect(out.report.routes.find((r) => r.route === "picky")).toMatchObject({ diverged: 1, scored: 2, rate: 1 });
    expect(renderSwap(out.report)).toMatch(/not comparable: 1 diverged, 0 errors, 0 not run, 1 task without a score on both routes/);
  }, 240_000);

  it("stops starting runs at the cap on live calls, reports a partial cohort as partial, and a resumed run makes only what it lacks", async () => {
    const { store, tasks, gold } = await measured(3);
    const live = new Scripted(solver(gold), "live");
    const first = await runSwap({ store, tasks, baseline: { name: "strong", model: "s", port: live }, candidate: { name: "lazy", model: "l", port: new Scripted(() => ({ content: "no" }), "live") }, repeats: 1, maxLiveCalls: 3, concurrency: 1, resamples: 2000 });
    expect(first.report.partial).toBe(true);
    expect(first.items.length).toBeLessThan(6);
    expect(store.prepare("SELECT status FROM replay_run WHERE run_id = ?").get(first.runId)).toEqual({ status: "partial" });
    const done = first.items.length;
    const again = await runSwap({ store, tasks, runId: first.runId, baseline: { name: "strong", model: "s", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "l", port: new Scripted(() => ({ content: "no" })) }, repeats: 1, resamples: 2000 });
    expect(again.items).toHaveLength(6);
    expect(again.report.partial).toBe(false);
    expect(again.items.length - done).toBe(6 - done);
    expect(itemsOf(store, first.runId)).toHaveLength(6);
  }, 240_000);

  it("stops at a spend cap when a price is given, and counts tokens only when it is not", async () => {
    const { store, tasks, gold } = await measured(3);
    const out = await runSwap({ store, tasks, baseline: { name: "strong", model: "s", port: new Scripted(solver(gold)), price: { inPerM: 1000, outPerM: 1000 } }, candidate: { name: "lazy", model: "l", port: new Scripted(() => ({ content: "no" })) }, repeats: 1, budgetUsd: 0.5, concurrency: 1, resamples: 2000 });
    expect(out.report.partial).toBe(true);
    expect(out.estimatedUsd).toBeGreaterThan(0.5);
    const free = await runSwap({ store, tasks, baseline: { name: "strong", model: "s", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "l", port: new Scripted(() => ({ content: "no" })) }, repeats: 1, resamples: 2000 });
    expect(free.estimatedUsd).toBeNull();
  }, 240_000);

  it("refuses two routes of one name, and a run to resume that is not there", async () => {
    const { store, tasks, gold } = await measured(1);
    const route = { name: "same", model: "s", port: new Scripted(solver(gold)) };
    await expect(runSwap({ store, tasks, baseline: route, candidate: route, repeats: 1 })).rejects.toThrow(/different names/);
    await expect(runSwap({ store, tasks, runId: "run-nope", baseline: route, candidate: { ...route, name: "other" }, repeats: 1 })).rejects.toThrow(/no run run-nope/);
  }, 60_000);
});

describe("the statistics under the verdict", () => {
  const rows = (route: string, passRates: number[], seed: number, repeats = 3) => {
    let s = seed >>> 0;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    return passRates.flatMap((p, t) => Array.from({ length: repeats }, (_, r) => ({ taskId: `t${t}`, route, repeat: r + 1, status: (rnd() < p ? "pass" : "fail") as "pass" | "fail", failToPassPassed: 0, failToPassTotal: 1, passToPassPassed: 0, passToPassTotal: 0, turns: 5, modelCalls: 5, tokensIn: 1000, tokensOut: 200, ms: 1000, tool: { executed: 1, recording: 0, stub: 0, refused: 0, diverged: 0 }, touched: [], divergence: null, error: null, servedModel: "m", stopped: null, patch: "" })));
  };

  it("has intervals that cover zero when a route is run against itself, in at least 93% of 200 replays", () => {
    const truth = Array.from({ length: 24 }, (_, i) => 0.15 + 0.7 * ((i * 7) % 24) / 24);
    const metas = truth.map((_, i) => ({ taskId: `t${i}`, kind: ["bugfix", "feature", "refactor"][i % 3] as string, area: `a${i % 4}`, oracle: "strong" as const }));
    let covered = 0;
    for (let rep = 0; rep < 200; rep += 1) {
      const items = [...rows("a", truth, 1000 + rep * 2), ...rows("b", truth, 1001 + rep * 2)];
      const r = reportSwap({ tasks: metas, items, baseline: "a", candidate: "b", planned: items.length, resamples: 400, gate: 0 });
      if (r.delta && r.delta.low <= 0 && r.delta.high >= 0) covered += 1;
    }
    expect(covered / 200).toBeGreaterThanOrEqual(0.93);
  }, 120_000);

  it("calls a route that is known to be worse worse, and one that is better better", () => {
    const truth = Array.from({ length: 20 }, () => 0.9);
    const metas = truth.map((_, i) => ({ taskId: `t${i}`, kind: ["bugfix", "feature", "refactor"][i % 3] as string, area: `a${i % 4}`, oracle: "strong" as const }));
    const worse = reportSwap({ tasks: metas, items: [...rows("a", truth, 5), ...rows("b", truth.map(() => 0.3), 6)], baseline: "a", candidate: "b", planned: 120, resamples: 2000 });
    expect(worse.verdict).toBe("worse");
    const better = reportSwap({ tasks: metas, items: [...rows("a", truth.map(() => 0.92), 7), ...rows("b", truth.map(() => 0.3), 8)].map((x) => ({ ...x, route: x.route === "a" ? "b" : "a" })), baseline: "a", candidate: "b", planned: 120, resamples: 2000, gate: 0 });
    expect(better.verdict).toBe("better");
  });

  it("reads the verdict from the interval alone: inside the margin is equivalent, across an edge is inconclusive", () => {
    expect(judgeDelta({ points: 0, low: -3, high: 4 }, 5).verdict).toBe("equivalent");
    expect(judgeDelta({ points: 2, low: -8, high: 12 }, 5).verdict).toBe("inconclusive");
    expect(judgeDelta({ points: 0, low: -6, high: 3 }, 5).verdict).toBe("inconclusive");
    expect(judgeDelta({ points: -20, low: -30, high: -10 }, 5).verdict).toBe("worse");
    expect(judgeDelta({ points: 20, low: 10, high: 30 }, 5).verdict).toBe("better");
    expect(pairedBootstrap([], 100, 1)).toBeNull();
    const same = pairedBootstrap([{ cluster: "a", a: 1, b: 1 }, { cluster: "b", a: 0, b: 0 }], 500, 1)!;
    expect(same).toMatchObject({ points: 0, low: 0, high: 0 });
  });

  it("keeps the weak-oracle tasks apart, out of the headline", () => {
    const metas = [{ taskId: "t0", kind: "bugfix", area: "a", oracle: "strong" as const }, { taskId: "t1", kind: "bugfix", area: "a", oracle: "weak" as const }];
    const items = [...rows("a", [1, 1], 1, 1), ...rows("b", [1, 0], 2, 1)];
    const r = reportSwap({ tasks: metas, items, baseline: "a", candidate: "b", planned: 4, resamples: 200, gate: 0 });
    expect(r.tasksPaired).toBe(1);
    expect(r.weak).toMatchObject({ tasks: 1 });
    expect(renderSwap(r)).toContain("weak oracle, apart: 1 task");
  });
});

describe("a report is a function of the stored items", () => {
  it("is made again from them, replacing one that disagreed (a run that two processes wrote to), and leaves a run still going alone", async () => {
    const { store, tasks, gold } = await measured(2);
    const out = await runSwap({ store, tasks, baseline: { name: "strong", model: "m-s", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "m-l", port: new Scripted(() => ({ content: "no" })) }, repeats: 2, resamples: 200 });
    const stored = (): { report_json: string } => store.prepare("SELECT report_json FROM replay_run WHERE run_id = ?").get(out.runId) as { report_json: string };
    const honest = stored().report_json;
    // One stored pass is lost from the report, as if a second writer had finished last with a smaller view of the run.
    const stale = JSON.parse(honest);
    stale.routes[0].passes -= 1;
    store.prepare("UPDATE replay_run SET report_json = ? WHERE run_id = ?").run(JSON.stringify(stale), out.runId);
    const again = recomputeReport(store, out.runId);
    expect(again?.routes[0]?.passes).toBe(out.report.routes[0]?.passes);
    expect(JSON.parse(stored().report_json).routes[0].passes).toBe(out.report.routes[0]?.passes);
    store.prepare("UPDATE replay_run SET status = 'running' WHERE run_id = ?").run(out.runId);
    expect(recomputeReport(store, out.runId)).toBeNull();
    expect(recomputeReport(store, "run-none")).toBeNull();
  }, 120_000);
});
