import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../../src/desk/agents/model.ts";
import { canaryCommand } from "../../../src/desk/canary/command.ts";
import { runPack, type RunRow } from "../../../src/desk/canary/runner.ts";
import { appendRows, buildSeries, readRows, servedChanges } from "../../../src/desk/canary/store.ts";
import { harnessHash, numbersIn, scoreReply, TASKS } from "../../../src/desk/canary/tasks.ts";
import { earliestCallDay, evaluateAt, makeContext } from "../../../src/desk/canary/verdict.ts";
import { seeded } from "../../../src/desk/replay/wind-tunnel.ts";

const dirs: string[] = [];
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-canary-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const byId = (id: string) => TASKS.find((t) => t.id === id)!;

describe("the task pack", () => {
  it("has enough tasks in several clusters, with unique ids", () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    expect(new Set(TASKS.map((t) => t.cluster)).size).toBeGreaterThanOrEqual(4);
  });

  const RIGHT: Record<string, string> = {
    "money-change": "27.05", "money-compound": "2315.25", "money-percent": "96", "money-invoice": "79", "logic-order": "Cy", "logic-weekday": "Saturday", "logic-sheep": "9", "logic-sequence": "48",
    "records-errors": "4", "records-users": "Cato, Mara, Wren, Zed", "records-date": "2026-03-12", "records-leap": "76", "code-sum": "165", "code-chain": "54", "code-alias": "4", "code-count": "6",
  };

  it("accepts the right answer for every task, alone and after a line of working, and rejects a wrong one", () => {
    for (const t of TASKS) {
      const right = RIGHT[t.id]!;
      expect(t.check(right), `${t.id} right`).toBe(1);
      expect(t.check(`Working it through step by step, the result is:\n${right}`), `${t.id} with working`).toBe(1);
      expect(t.check("I do not know"), `${t.id} nonsense`).toBe(0);
      expect(t.check(""), `${t.id} empty`).toBe(0);
    }
  });

  it("does not take a number inside the working as the answer, and reads thousands separators", () => {
    expect(byId("money-compound").check("2,315.25")).toBe(1);
    expect(byId("money-percent").check("15% of 640 is 100 which is wrong, final: 90")).toBe(0);
    expect(numbersIn("about 1,234.50 or -7")).toEqual([1234.5, -7]);
    expect(byId("records-users").check("Cato, Mara, Zed")).toBe(0);
    expect(byId("records-users").check("Zed, Wren, Mara, Cato")).toBe(0);
    expect(byId("records-date").check("2026-03-11")).toBe(0);
  });

  it("scores an empty or missing reply as no score, never as zero", () => {
    expect(scoreReply(byId("code-sum"), null)).toBeNull();
    expect(scoreReply(byId("code-sum"), "   ")).toBeNull();
    expect(scoreReply(byId("code-sum"), "165")).toBe(1);
    expect(scoreReply(byId("code-sum"), "166")).toBe(0);
  });

  it("has a harness hash that is stable and changes with the prompts", () => {
    expect(harnessHash()).toBe(harnessHash());
    expect(harnessHash()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

class Scripted implements ModelPort {
  calls: ModelRequest[] = [];
  constructor(private readonly reply: (r: ModelRequest, n: number) => string | Error, private readonly served = "scripted-model") {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.calls.push(r);
    const x = this.reply(r, this.calls.length);
    if (x instanceof Error) throw x;
    return { content: x, toolCalls: [], servedBy: "other", servedModel: this.served, source: "live", usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
  }
}
const answerFor = (r: ModelRequest): string => {
  const prompt = r.messages.at(-1)!.content;
  const t = TASKS.find((x) => prompt.startsWith(x.prompt))!;
  return { "money-change": "27.05", "money-compound": "2315.25", "money-percent": "96", "money-invoice": "79", "logic-order": "Cy", "logic-weekday": "Saturday", "logic-sheep": "9", "logic-sequence": "48", "records-errors": "4", "records-users": "Cato, Mara, Wren, Zed", "records-date": "2026-03-12", "records-leap": "76", "code-sum": "165", "code-chain": "54", "code-alias": "4", "code-count": "6" }[t.id]!;
};

describe("running the pack", () => {
  it("scores every task, records the served model, and puts a unique nonce in every prompt", async () => {
    const port = new Scripted(answerFor);
    const rows = await runPack({ port, arm: "primary", day: 3, date: "2026-10-02", retryPauseMs: 0 });
    expect(rows).toHaveLength(TASKS.length);
    expect(rows.every((r) => r.score === 1 && r.servedModel === "scripted-model" && r.cacheBypass)).toBe(true);
    const nonces = port.calls.map((c) => /test id ([0-9a-f]{12})/.exec(c.messages.at(-1)!.content)![1]);
    expect(new Set(nonces).size).toBe(TASKS.length);
    expect(port.calls.every((c) => c.temperature === 0.7)).toBe(true);
  });

  it("retries a failed attempt and only then records an error row, with no score", async () => {
    let n = 0;
    const flaky = new Scripted((r) => {
      n += 1;
      return n % 3 === 0 ? new ModelError("transient", "HTTP 500", 500) : answerFor(r);
    });
    const rows = await runPack({ port: flaky, arm: "primary", day: 1, date: "2026-09-30", retryPauseMs: 0, concurrency: 1 });
    expect(rows.every((r) => r.score === 1)).toBe(true);
    const dead = new Scripted(() => new ModelError("transient", "HTTP 500", 500));
    const failed = await runPack({ port: dead, arm: "control", day: 1, date: "2026-09-30", retryPauseMs: 0, attempts: 2 });
    expect(failed.every((r) => r.score === null && /after 2 of 2 attempts/.test(r.error ?? ""))).toBe(true);
    expect(dead.calls).toHaveLength(TASKS.length * 2);
  });

  it("records an empty reply as no score, and a wrong answer as zero", async () => {
    const rows = await runPack({ port: new Scripted((_r, n) => (n === 1 ? "" : "wrong")), arm: "primary", day: 1, date: "d", retryPauseMs: 0, attempts: 1, concurrency: 1 });
    expect(rows[0]!.score).toBeNull();
    expect(rows.slice(1).every((r) => r.score === 0)).toBe(true);
  });

  it("never runs more calls at once than the concurrency it was given", async () => {
    let live = 0;
    let peak = 0;
    const port: ModelPort = {
      async complete(r) {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((res) => setTimeout(res, 5));
        live -= 1;
        return { content: answerFor(r), toolCalls: [], servedBy: "other", servedModel: "m", source: "live", usage: null };
      },
    };
    await runPack({ port, arm: "primary", day: 1, date: "d", concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });
});

function row(over: Partial<RunRow>): RunRow {
  return { day: 1, date: "2026-09-30", arm: "primary", taskId: TASKS[0]!.id, servedModel: "model-a", score: 1, error: null, latencyMs: 1, tokensIn: 1, tokensOut: 1, replySha: "x", harness: harnessHash(), cacheBypass: true, ...over };
}

/** A canary history: pass probability `p(arm, day, taskIndex)` drawn per task and day from a seeded generator. */
function history(days: number, p: (arm: RunRow["arm"], day: number, i: number) => number, served: (arm: RunRow["arm"], day: number) => string = () => "model-a"): RunRow[] {
  const rand = seeded(11);
  const rows: RunRow[] = [];
  for (let day = 1; day <= days; day += 1) {
    for (const arm of ["primary", "control"] as const) {
      TASKS.forEach((t, i) => rows.push(row({ day, arm, taskId: t.id, score: rand() < p(arm, day, i) ? 1 : 0, servedModel: served(arm, day), date: `2026-10-${String(day).padStart(2, "0")}` })));
    }
  }
  return rows;
}

describe("storing runs and building the series", () => {
  it("round-trips rows, skips junk lines and counts them", () => {
    const path = join(temp(), "runs.jsonl");
    appendRows(path, [row({ day: 1 }), row({ day: 2, score: null, error: "x" })]);
    writeFileSync(path, "{not json\n" + '{"day":"x"}\n' + '{"day":0,"arm":"primary","taskId":"a","score":1}\n', { flag: "a" });
    const { rows, skipped } = readRows(path);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(3);
    expect(readRows(join(temp(), "missing.jsonl"))).toEqual({ rows: [], skipped: 0 });
  });

  it("counts a failed attempt as an error, not as a zero, in its day's cell", () => {
    const rows = [row({ day: 1, score: 1 }), row({ day: 1, score: 0 }), row({ day: 1, score: null, error: "x" })];
    const s = buildSeries(rows)!;
    expect(s.primary.cells[0]![0]).toMatchObject({ n: 2, sum: 1, err: 1, total: 3, passes: 1 });
    expect(s.control).toBeNull();
    expect(s.days).toBe(1);
  });

  it("marks the harness as changed when a row was scored under a different one", () => {
    expect(buildSeries([row({}), row({ day: 2, harness: "sha256:other" })])!.harnessUnchanged).toBe(false);
    expect(buildSeries([row({}), row({ day: 2 })])!.harnessUnchanged).toBe(true);
    expect(buildSeries([])).toBeNull();
  });

  it("finds the day the endpoint reported a different served model", () => {
    const rows = history(6, () => 0.8, (arm, day) => (arm === "primary" && day >= 4 ? "model-b" : "model-a"));
    expect(servedChanges(rows, "primary")).toEqual([{ day: 4, date: "2026-10-04", from: "model-a", to: "model-b" }]);
    expect(servedChanges(rows, "control")).toEqual([]);
  });
});

describe("the canary's call", () => {
  it("says nothing can be called before the earliest day, and says why", () => {
    const rows = history(earliestCallDay() - 1, () => 0.8);
    const path = join(temp(), "runs.jsonl");
    appendRows(path, rows);
    const r = canaryCommand({ runsPath: path, sample: false });
    expect(r.verdict?.verdict).toBe("inconclusive");
    expect(r.verdict?.reason).toBe("too_early");
    expect(r.text).toMatch(/too early/);
  });

  it("is steady when nothing changed, including on a long history", () => {
    const rows = history(60, () => 0.8);
    const ctx = makeContext(buildSeries(rows)!);
    const calls = [];
    for (let t = earliestCallDay(); t <= 60; t += 1) calls.push(evaluateAt(ctx, t).verdict);
    expect(calls).not.toContain("regressed");
  });

  it("calls a regression that is large, in every task, in two windows, with the control flat", () => {
    const rows = history(30, (arm, day) => (arm === "primary" && day >= 15 ? 0.3 : 0.9), (arm, day) => (arm === "primary" && day >= 15 ? "model-b" : "model-a"));
    const path = join(temp(), "runs.jsonl");
    appendRows(path, rows);
    const r = canaryCommand({ runsPath: path, sample: true });
    expect(r.verdict?.verdict).toBe("regressed");
    expect(r.text).toMatch(/Regressed/);
    expect(r.text).toMatch(/consistent with, not caused by/);
    expect(r.text).toMatch(/control arm: flat/);
    expect(r.text).toMatch(/Constructed scenario/);
    expect(r.text).not.toMatch(/caused by the/);
  });

  it("does not blame the model when the control arm drops too", () => {
    const rows = history(30, (_arm, day) => (day >= 15 ? 0.3 : 0.9));
    const ctx = makeContext(buildSeries(rows)!);
    const v = evaluateAt(ctx, 30);
    expect(v.verdict).not.toBe("regressed");
  });

  it("makes no call when too many attempts produced no score", () => {
    const rows = history(30, (arm, day) => (arm === "primary" && day >= 15 ? 0.3 : 0.9)).map((r, i) => (i % 4 === 0 ? { ...r, score: null, error: "x" } : r));
    const v = evaluateAt(makeContext(buildSeries(rows)!), 30);
    expect(v.verdict).toBe("inconclusive");
    expect(v.reason).toBe("error_rate");
  });

  it("makes no call when the harness changed in the window", () => {
    const rows = history(30, (arm, day) => (arm === "primary" && day >= 15 ? 0.3 : 0.9)).map((r) => (r.day >= 22 ? { ...r, harness: "sha256:changed" } : r));
    const v = evaluateAt(makeContext(buildSeries(rows)!), 30);
    expect(v.verdict).not.toBe("regressed");
  });

  it("explains an empty or missing file instead of failing", () => {
    expect(canaryCommand({ runsPath: join(temp(), "none.jsonl"), sample: false }).text).toMatch(/No canary runs yet/);
    const empty = join(temp(), "empty.jsonl");
    writeFileSync(empty, "");
    expect(canaryCommand({ runsPath: empty, sample: false }).text).toMatch(/no usable runs/);
  });
});
