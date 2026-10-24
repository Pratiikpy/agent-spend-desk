import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scriptedAgent, type AgentAdapter } from "../../../src/desk/lab/agents.ts";
import { readRecords, runBatch, runSeed } from "../../../src/desk/lab/batch.ts";
import type { Grade } from "../../../src/desk/lab/grade.ts";
import type { ProxyEntry } from "../../../src/desk/lab/proxy.ts";
import { accountFor, classify, runOnce, type RunRecord } from "../../../src/desk/lab/runner.ts";
import { clopperPearsonUpper, renderSummary, seededRandom, shuffled, summarise, wilson } from "../../../src/desk/lab/stats.ts";
import { loadTask, overlayGold, readExpected, type LabTask } from "../../../src/desk/lab/task.ts";
import { TempDir } from "../helpers.ts";

const TASK_DIR = "lab/tasks/spike/interval-merge";

let dir: TempDir;
let task: LabTask;
beforeEach(() => {
  dir = new TempDir();
  task = loadTask(TASK_DIR);
});
afterEach(() => dir.dispose());

const spec = (agent: AgentAdapter, over: { entries?: ProxyEntry[]; modelUrl?: string; timeoutMs?: number } = {}) => ({
  runId: "t-run",
  task,
  expected: readExpected(task)!,
  arm: "baseline",
  repeat: 1,
  seed: 7,
  agent,
  model: "test-model",
  modelUrl: over.modelUrl ?? "",
  entriesFor: () => over.entries ?? [],
  workDir: join(dir.path, "work"),
  timeoutMs: over.timeoutMs ?? 60_000,
});

const entry = (over: Partial<ProxyEntry> = {}): ProxyEntry => ({ ts: "2026-10-24T10:00:00Z", run: "t-run", path: "/chat/completions", status: 200, ms: 100, stream: true, toolCalls: 0, retries: 0, requestBytes: 10, responseBytes: 10, ...over });

describe("running one task", () => {
  it("passes an agent that applies the correct change and measures what it changed", async () => {
    const gold = scriptedAgent("gold", (ctx) => overlayGold(ctx.task, ctx.workspace));
    const r = await runOnce(spec(gold));
    expect(r.outcome).toBe("pass");
    expect(r.grade).toMatchObject({ verdict: "pass", f2pPassed: 12, ran: 12 });
    expect(r.diff.filesChanged).toBe(1);
    expect(r.diff.linesAdded).toBeGreaterThan(10);
    expect(r.diff.touchedProtected).toBe(false);
    expect(r.agent).toEqual({ name: "gold", version: "scripted" });
    expect(r.env.envHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.taskHash).toMatch(/^sha256:/);
  });

  it("fails an agent that does nothing", async () => {
    const r = await runOnce(spec(scriptedAgent("idle", () => undefined)));
    expect(r.outcome).toBe("fail");
    expect(r.diff.filesChanged).toBe(0);
    expect(r.grade.f2pPassed).toBe(0);
  });

  it("fails an agent that rewrites the tests to pass, and records that it touched them", async () => {
    const cheat = scriptedAgent("cheat", (ctx) => {
      writeFileSync(join(ctx.workspace, "test/visible.test.js"), "const t = require('node:test'); t('merges overlapping intervals', () => {}); t('returns an empty list for no intervals', () => {}); t('sorts the result by start', () => {});\n");
    });
    const r = await runOnce(spec(cheat));
    expect(r.outcome).toBe("fail");
    expect(r.diff.touchedProtected).toBe(true);
  });

  it("fails an agent that deletes the tests", async () => {
    const wipe = scriptedAgent("wipe", (ctx) => rmSync(join(ctx.workspace, "test"), { recursive: true, force: true }));
    const r = await runOnce(spec(wipe));
    expect(r.outcome).toBe("fail");
    expect(r.diff.touchedProtected).toBe(true);
  });

  it("gives each run its own workspace", async () => {
    const mark = scriptedAgent("mark", (ctx) => writeFileSync(join(ctx.workspace, "marker.txt"), "x"));
    const seen: string[] = [];
    const probe = scriptedAgent("probe", (ctx) => {
      seen.push(existsSync(join(ctx.workspace, "marker.txt")) ? "dirty" : "clean");
    });
    await runOnce({ ...spec(mark), runId: "run-a", keepWorkspace: true });
    await runOnce({ ...spec(probe), runId: "run-b" });
    expect(seen).toEqual(["clean"]);
  });

  it("refuses a work folder inside the repository, where an agent could walk up to the hidden tests", async () => {
    await expect(runOnce({ ...spec(scriptedAgent("a", () => undefined)), workDir: join(process.cwd(), "data", "lab-test-work") })).rejects.toThrow(/inside the repository/);
  });

  it("keeps the transcript and the patch in the artifacts folder, and keeps a failed workspace but not a passing one", async () => {
    const art = join(dir.path, "artifacts");
    const gold = await runOnce({ ...spec(scriptedAgent("gold", (ctx) => overlayGold(ctx.task, ctx.workspace))), runId: "ok-run", artifactsDir: art });
    expect(readFileSync(join(art, "ok-run.patch"), "utf8")).toContain("mergeIntervals");
    expect(gold.transcript).toBe(join(art, "ok-run.transcript.log"));
    expect(existsSync(join(dir.path, "work", "ok-run", "ws"))).toBe(false);
    const idle = await runOnce({ ...spec(scriptedAgent("idle", () => undefined)), runId: "bad-run", artifactsDir: art });
    expect(idle.outcome).toBe("fail");
    expect(existsSync(join(dir.path, "work", "bad-run", "ws"))).toBe(true);
  });

  it("records an adapter that throws as a run with no result, not as a crash of the batch", async () => {
    const broken: AgentAdapter = { name: "broken", version: () => "1", run: () => Promise.reject(new Error("boom")) };
    const r = await runOnce(spec(broken));
    expect(r.agentExit.code).toBeNull();
    expect(readFileSync(r.transcript, "utf8")).toContain("boom");
    expect(r.outcome).toBe("fail");
  });

  it("keeps the agent's printed output in a transcript file and only its size in the record", async () => {
    const chatty = scriptedAgent("chatty", () => undefined);
    const r = await runOnce(spec(chatty));
    expect(r.agentExit.outputBytes).toBe(Buffer.byteLength("chatty finished"));
    expect(JSON.stringify(r)).not.toContain("chatty finished");
    expect(readFileSync(r.transcript, "utf8")).toBe("chatty finished");
  });
});

describe("deciding the outcome", () => {
  const grade = (verdict: Grade["verdict"]): Grade => ({ verdict, f2pPassed: 0, f2pTotal: 1, p2pPassed: 0, p2pTotal: 0, ran: 1, expectedTotal: 1, failed: [], reason: "r", timedOut: false });
  const none = accountFor([]);
  const some = accountFor([entry()]);

  it("a passing grade is a pass whatever else happened", () => {
    expect(classify({ grade: grade("pass"), timedOut: true, exitCode: 1, accounting: some, lastEntry: entry({ status: 500 }), usesModel: true }).outcome).toBe("pass");
  });

  it("an agent that never called the model is an infrastructure failure, not a failed attempt", () => {
    expect(classify({ grade: grade("fail"), timedOut: false, exitCode: 1, accounting: none, lastEntry: undefined, usesModel: true })).toMatchObject({ outcome: "infra" });
    expect(classify({ grade: grade("fail"), timedOut: false, exitCode: 0, accounting: none, lastEntry: undefined, usesModel: true })).toMatchObject({ outcome: "infra" });
    expect(classify({ grade: grade("fail"), timedOut: false, exitCode: 0, accounting: none, lastEntry: undefined, usesModel: false }).outcome).toBe("fail");
  });

  it("a run whose last model call failed is an infrastructure failure", () => {
    const last = entry({ status: 429, error: "rate limited" });
    expect(classify({ grade: grade("fail"), timedOut: false, exitCode: 1, accounting: accountFor([entry(), last]), lastEntry: last, usesModel: true }).outcome).toBe("infra");
  });

  it("a run that ran out of time is a timeout, and a broken grader is infrastructure", () => {
    expect(classify({ grade: grade("fail"), timedOut: true, exitCode: null, accounting: some, lastEntry: entry(), usesModel: true }).outcome).toBe("timeout");
    expect(classify({ grade: grade("infra"), timedOut: false, exitCode: 0, accounting: some, lastEntry: entry(), usesModel: true }).outcome).toBe("infra");
  });

  it("totals tokens, retries, receipts and errors from the proxy's records", () => {
    const a = accountFor([entry({ promptTokens: 10, completionTokens: 2, retries: 1, receiptId: "r1" }), entry({ promptTokens: 5, completionTokens: 1, fromCache: true }), entry({ status: 502, error: "x" })]);
    expect(a).toEqual({ calls: 3, retries: 1, promptTokens: 15, completionTokens: 3, receipts: 1, cacheHits: 1, modelErrors: 1 });
  });
});

describe("running a batch", () => {
  const gold = scriptedAgent("gold", (ctx) => overlayGold(ctx.task, ctx.workspace));
  const idle = scriptedAgent("idle", () => undefined);
  const tasks = (): LabTask[] => ["interval-merge", "topo-sort"].map((id) => loadTask(`lab/tasks/spike/${id}`));

  const opts = (name: string, agent: AgentAdapter, repeats = 2) => ({
    name,
    tasks: tasks(),
    repeats,
    arm: "baseline",
    agent,
    model: "test-model",
    seed: 20261024,
    outDir: join(dir.path, "batch"),
    timeoutMs: 60_000,
    concurrency: 2,
    endpoint: null,
  });

  it("runs every task the requested number of times and records each run once", async () => {
    const rs = await runBatch(opts("b1", gold));
    expect(rs).toHaveLength(4);
    expect(rs.every((r) => r.outcome === "pass")).toBe(true);
    const file = readRecords(join(dir.path, "batch", "runs.jsonl"));
    expect(file.map((r) => r.runId).sort()).toEqual(["b1-interval-merge-baseline-r1", "b1-interval-merge-baseline-r2", "b1-topo-sort-baseline-r1", "b1-topo-sort-baseline-r2"]);
  });

  it("skips runs already recorded, so an interrupted batch can be resumed", async () => {
    await runBatch(opts("b2", gold, 1));
    const again = await runBatch(opts("b2", gold, 2));
    expect(again).toHaveLength(2);
    expect(readRecords(join(dir.path, "batch", "runs.jsonl"))).toHaveLength(4);
  });

  it("gives the same run order for the same seed and a different one for another seed", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `job${i}`);
    expect(shuffled(ids, 5)).toEqual(shuffled(ids, 5));
    expect(shuffled(ids, 5)).not.toEqual(shuffled(ids, 6));
    expect([...shuffled(ids, 5)].sort()).toEqual([...ids].sort());
    expect(runSeed(1, "a")).toBe(runSeed(1, "a"));
    expect(runSeed(1, "a")).not.toBe(runSeed(1, "b"));
  });

  it("summarises pass rates per task with intervals, and counts the tasks an intervention could move", async () => {
    await runBatch(opts("b3", idle, 2));
    const s = summarise(readRecords(join(dir.path, "batch", "runs.jsonl")));
    expect(s.runs).toBe(4);
    expect(s.overallRate).toBe(0);
    expect(s.neverPass).toBe(2);
    expect(s.informativeTasks).toBe(0);
    expect(renderSummary(s)).toContain("interval-merge");
  });
});

describe("the statistics", () => {
  it("gives a Wilson interval that is wide at small n, stays inside 0 and 1, and contains the estimate", () => {
    const a = wilson(0, 5);
    expect(a.low).toBe(0);
    expect(a.high).toBeGreaterThan(0.4);
    const b = wilson(5, 5);
    expect(b.high).toBe(1);
    expect(b.low).toBeLessThan(0.6);
    const c = wilson(3, 5);
    expect(c.low).toBeLessThan(0.6);
    expect(c.high).toBeGreaterThan(0.6);
    expect(wilson(50, 100).high - wilson(50, 100).low).toBeLessThan(c.high - c.low);
  });

  it("finds the exact one-sided 95% upper bound, matching an independent calculation", () => {
    expect(clopperPearsonUpper(0, 100)).toBeCloseTo(0.0295, 3);
    expect(clopperPearsonUpper(0, 59)).toBeCloseTo(0.0495, 3);
    expect(clopperPearsonUpper(5, 100)).toBeCloseTo(0.1023, 3);
    expect(clopperPearsonUpper(10, 10)).toBe(1);
  });

  it("produces a reproducible stream of numbers in [0, 1)", () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("measures how much of the outcome variance is between tasks", () => {
    const mk = (taskId: string, pass: number, n: number): RunRecord[] =>
      Array.from({ length: n }, (_, i) => ({ taskId, outcome: i < pass ? "pass" : "fail", wallMs: 1000, accounting: { calls: 1, promptTokens: 1, completionTokens: 1, receipts: 0, retries: 0, cacheHits: 0, modelErrors: 0 } }) as unknown as RunRecord);
    const separated = summarise([...mk("a", 5, 5), ...mk("b", 0, 5), ...mk("c", 5, 5), ...mk("d", 0, 5)]);
    expect(separated.betweenTaskShare).toBeGreaterThan(0.9);
    const mixed = summarise([...mk("a", 2, 5), ...mk("b", 3, 5), ...mk("c", 2, 5), ...mk("d", 3, 5)]);
    expect(mixed.betweenTaskShare).toBeLessThan(0.1);
    expect(mixed.informativeTasks).toBe(4);
  });
});

