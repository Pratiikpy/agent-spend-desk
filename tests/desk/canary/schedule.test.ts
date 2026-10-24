import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { ModelPort, ModelRequest, ModelResponse } from "../../../src/desk/agents/model.ts";
import { ModelError } from "../../../src/desk/agents/model.ts";
import { canaryRunCommand, canaryScheduleSnippet } from "../../../src/desk/canary/command.ts";
import type { RunRow } from "../../../src/desk/canary/runner.ts";
import { appendSkip, decide, estimateRunCost, planReadings, readSkips, skipsPathFor, PLAN_SKIP, type PlanReadings } from "../../../src/desk/canary/schedule.ts";
import { canaryCard } from "../../../src/desk/canary/card.ts";
import { readRows } from "../../../src/desk/canary/store.ts";
import { controlTasks, harnessHash, TASKS } from "../../../src/desk/canary/tasks.ts";
import { openLedger } from "../../../src/desk/ledger/db.ts";
import { testSnapshot } from "../helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "desk-canary-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const row = (day: number, date: string, over: Partial<RunRow> = {}): RunRow => ({ day, date, arm: "primary", taskId: TASKS[0]!.id, servedModel: "m", score: 1, error: null, latencyMs: 5, tokensIn: 50, tokensOut: 5, replySha: "x", harness: harnessHash(), cacheBypass: true, ...over });
const NONE: PlanReadings = { fiveHourPct: null, weeklyPct: null };
const NO_BUDGET = { capMicros: null, estimateMicros: null };

describe("when the canary runs", () => {
  it("does not run twice in a day", () => {
    expect(decide({ today: "2026-10-24", rows: [row(1, "2026-10-24")], plan: NONE, budget: NO_BUDGET })).toMatchObject({ action: "done" });
    expect(decide({ today: "2026-10-25", rows: [row(1, "2026-10-24")], plan: NONE, budget: NO_BUDGET }).action).toBe("run");
    // A control row alone is not the day's run.
    expect(decide({ today: "2026-10-24", rows: [row(1, "2026-10-24", { arm: "control" })], plan: NONE, budget: NO_BUDGET }).action).toBe("run");
  });

  it("starts a new baseline when the harness changed, and says why", () => {
    const d = decide({ today: "2026-10-25", rows: [row(1, "2026-10-24", { harness: "v2:sha256:" + "0".repeat(64) })], plan: NONE, budget: NO_BUDGET });
    expect(d).toMatchObject({ action: "new_baseline" });
    expect((d as { reason: string }).reason).toMatch(/cannot be compared.*kept apart/);
  });

  it("leaves the rest of the plan to the owner: at 75% of the week or 60% of five hours it does not run, and just under it does", () => {
    const at = (p: PlanReadings) => decide({ today: "2026-10-25", rows: [], plan: p, budget: NO_BUDGET });
    expect(at({ fiveHourPct: 59.9, weeklyPct: 74.9 }).action).toBe("run");
    expect(at({ fiveHourPct: 60, weeklyPct: 10 })).toMatchObject({ action: "skip", kind: "plan_limit" });
    expect(at({ fiveHourPct: 10, weeklyPct: 75 })).toMatchObject({ action: "skip", kind: "plan_limit" });
    expect((at({ fiveHourPct: 10, weeklyPct: 82 }) as { reason: string }).reason).toBe("Your plan's weekly window is 82% used (the canary does not run at 75% or more), so it left the rest for your work.");
    expect(PLAN_SKIP).toEqual({ fiveHourPct: 60, weeklyPct: 75 });
  });

  it("stays inside its own budget, and says so when it cannot tell", () => {
    expect(decide({ today: "2026-10-25", rows: [], plan: NONE, budget: { capMicros: 1_000_000, estimateMicros: 1_000_001 } })).toMatchObject({ action: "skip", kind: "budget" });
    expect(decide({ today: "2026-10-25", rows: [], plan: NONE, budget: { capMicros: 1_000_000, estimateMicros: 1_000_000 } }).action).toBe("run");
    const unpriced = decide({ today: "2026-10-25", rows: [], plan: { fiveHourPct: 1, weeklyPct: 1 }, budget: { capMicros: 1_000_000, estimateMicros: null } });
    expect(unpriced).toMatchObject({ action: "run", note: "the model has no price, so the budget guard could not apply" });
    expect(decide({ today: "2026-10-25", rows: [], plan: NONE, budget: NO_BUDGET })).toMatchObject({ action: "run", note: "no recent plan reading, so the plan guard did not apply" });
  });

  it("checks done first, then the harness, then the plan, then the budget", () => {
    const all = { today: "2026-10-24", rows: [row(1, "2026-10-24", { harness: "other" })], plan: { fiveHourPct: 99, weeklyPct: 99 }, budget: { capMicros: 1, estimateMicros: 99 } };
    expect(decide(all).action).toBe("done");
    expect(decide({ ...all, today: "2026-10-25" }).action).toBe("new_baseline");
    expect(decide({ ...all, today: "2026-10-25", rows: [] })).toMatchObject({ action: "skip", kind: "plan_limit" });
    expect(decide({ ...all, today: "2026-10-25", rows: [], plan: NONE })).toMatchObject({ action: "skip", kind: "budget" });
  });
});

describe("what the owner's plan says", () => {
  it("takes the fullest reading of each window among recent readings and ignores old ones", () => {
    const db = openLedger(":memory:");
    expect(planReadings(db, NOW)).toEqual({ fiveHourPct: null, weeklyPct: null } satisfies PlanReadings); // a ledger with the table and no reading
    db.prepare("INSERT OR IGNORE INTO session (session_id, tool) VALUES ('a', 'codex'), ('b', 'claude_code')").run();
    const put = db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES (?, ?, ?, 'primary', ?, ?, ?, 'plus', NULL)");
    const ago = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
    put.run("codex", "a", ago(1), 300, 40, 0);
    put.run("claude_code", "b", ago(0.5), 300, 55, 0);
    put.run("codex", "a", ago(5), 300, 99, 0); // five hours old: not used
    put.run("codex", "a", ago(2), 10_080, 61, 0);
    put.run("codex", "a", ago(2.1), 1_440, 99, 0); // a window the guard does not read
    expect(planReadings(db, NOW)).toEqual({ fiveHourPct: 55, weeklyPct: 61 });
    expect(planReadings(db, NOW + 24 * 3_600_000)).toEqual({ fiveHourPct: null, weeklyPct: null });
    db.exec("DROP TABLE limit_sample");
    expect(planReadings(db, NOW)).toEqual({ fiveHourPct: null, weeklyPct: null });
  });
});

describe("what a day's run would cost", () => {
  const snap = testSnapshot();
  it("prices the tokens of the last run's rows, or an upper bound before any, and says nothing about a model with no price", () => {
    const prev = [row(1, "2026-10-23", { tokensIn: 100_000, tokensOut: 1_000 }), row(1, "2026-10-23", { tokensIn: 100_000, tokensOut: 3_000 })];
    // Opus: $5 in and $25 out per million. Mean row: 100,000 in and 2,000 out = $0.50 + $0.05 = $0.55; times 10 rows.
    expect(estimateRunCost(prev, 10, snap, "claude-opus-5")).toBe(5_500_000);
    const first = estimateRunCost([], 260, snap, "claude-opus-5") as number;
    expect(first).toBeGreaterThan(260 * 400 * 25); // at least the whole allowed reply, priced
    expect(estimateRunCost(prev, 10, snap, "nvidia/nemotron-x")).toBeNull();
  });
});

describe("why a day was skipped is written down once", () => {
  it("records one line a day for each reason, and ignores a half-written line", () => {
    const path = join(tmp, "skips", "skips.jsonl");
    expect(skipsPathFor("data/desk/canary/runs.jsonl").replaceAll("\\", "/")).toBe("data/desk/canary/skips.jsonl");
    expect(appendSkip(path, { date: "2026-10-24", at: "t", kind: "plan_limit", reason: "a" })).toBe(true);
    expect(appendSkip(path, { date: "2026-10-24", at: "t2", kind: "plan_limit", reason: "b" })).toBe(false);
    expect(appendSkip(path, { date: "2026-10-24", at: "t3", kind: "budget", reason: "c" })).toBe(true);
    expect(appendSkip(path, { date: "2026-10-25", at: "t4", kind: "plan_limit", reason: "d" })).toBe(true);
    writeFileSync(path, readFileSync(path, "utf8") + '{"date":"2026-10-2');
    expect(readSkips(path).map((s) => s.reason)).toEqual(["a", "c", "d"]);
    expect(readSkips(join(tmp, "none.jsonl"))).toEqual([]);
  });
});

class Port implements ModelPort {
  calls: ModelRequest[] = [];
  constructor(private readonly o: { stale?: boolean; fail?: boolean } = {}) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.calls.push(r);
    if (this.o.fail && r.role !== "canary_probe") throw new ModelError("transient", "boom", 503);
    const text = r.messages.at(-1)!.content;
    const content = r.role === "canary_probe" ? (this.o.stale ? "old code 0000000000" : (text.match(/: ([0-9a-f]{10})$/)?.[1] ?? "")) : "0";
    return { content, toolCalls: [], servedBy: "other", servedModel: "served-model", source: "live", usage: { inputTokens: 10, outputTokens: 2, reasoningTokens: 0 } };
  }
}

const base = (name: string, over: Record<string, unknown> = {}) => {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return { runsPath: join(dir, "runs.jsonl"), dir, env: { MODEL_BASE_URL: "http://x", MODEL_API_KEY: "k", NEMOTRON_MODEL: "primary-model", CANARY_CONTROL_MODEL: "control-model" } as Record<string, string>, today: "2026-10-24", nowMs: NOW, retryPauseMs: 0, makePort: () => new Port(), ...over };
};

describe("a day's run", () => {
  it("makes five repeats of every task for the primary arm and three tasks three times for the control, and does not run twice", async () => {
    const o = base("full");
    const r = await canaryRunCommand(o as never);
    expect(r.outcome).toBe("run");
    const rows = readRows(o.runsPath).rows;
    expect(rows.filter((x) => x.arm === "primary")).toHaveLength(TASKS.length * 5);
    expect(rows.filter((x) => x.arm === "control")).toHaveLength(9);
    expect(new Set(rows.filter((x) => x.arm === "control").map((x) => x.taskId))).toEqual(new Set(controlTasks().map((t) => t.id)));
    expect(rows.every((x) => x.day === 1 && x.date === "2026-10-24" && x.harness === harnessHash() && x.cacheBypass)).toBe(true);
    expect(r.text).toMatch(/^Canary day 1 \(2026-10-24\)\nprimary: \d+ of 260 passed.*\ncontrol: \d+ of 9 passed/);
    expect((await canaryRunCommand(o as never)).outcome).toBe("done");
    expect(readRows(o.runsPath).rows).toHaveLength(TASKS.length * 5 + 9);
    // The next day is day 2.
    await canaryRunCommand({ ...o, today: "2026-10-25" } as never);
    expect(Math.max(...readRows(o.runsPath).rows.map((x) => x.day))).toBe(2);
  });

  it("says what it would do in a preview and changes nothing", async () => {
    const o = base("preview");
    const r = await canaryRunCommand({ ...o, preview: true, ifDue: true } as never);
    expect(r).toMatchObject({ outcome: "preview" });
    expect(r.text).toBe("Canary, preview for 2026-10-24: would run 260 primary rows and 9 control rows. Note: no recent plan reading, so the plan guard did not apply; the model has no price, so the budget guard could not apply.");
    expect(existsSync(o.runsPath)).toBe(false);
    expect(existsSync(skipsPathFor(o.runsPath))).toBe(false);
  });

  it("skips when the plan is nearly spent, records why once, and runs when asked by hand", async () => {
    const o = base("plan");
    const db = openLedger(join(o.dir, "ledger.db"));
    db.prepare("INSERT OR IGNORE INTO session (session_id, tool) VALUES ('a', 'codex')").run();
    db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', 'a', ?, 'primary', 10080, 82, 0, 'plus', NULL)").run(new Date(NOW - 600_000).toISOString());
    const r = await canaryRunCommand({ ...o, db, ifDue: true } as never);
    expect(r.outcome).toBe("skipped");
    expect(r.text).toBe("Canary skipped for 2026-10-24. Your plan's weekly window is 82% used (the canary does not run at 75% or more), so it left the rest for your work. The reason is recorded.");
    await canaryRunCommand({ ...o, db, ifDue: true } as never); // the next hour: still skipped, not written again
    expect(readSkips(skipsPathFor(o.runsPath))).toHaveLength(1);
    expect(existsSync(o.runsPath)).toBe(false);
    expect((await canaryRunCommand({ ...o, db } as never)).outcome).toBe("run"); // by hand, the owner chose
    db.close();
  });

  it("does not record a day on which the endpoint failed, says so, and tries again at the next call", async () => {
    const o = base("endpoint");
    const bad = await canaryRunCommand({ ...o, ifDue: true, makePort: () => new Port({ fail: true }) } as never);
    expect(bad.outcome).toBe("skipped");
    expect(bad.text).toMatch(/primary arm not recorded: the endpoint gave no score for 260 of 260 attempts \(transient 503 after 3 of 3 attempts\)\. A failure of the harness must not look like a regression/);
    expect(existsSync(o.runsPath)).toBe(false);
    expect(readSkips(skipsPathFor(o.runsPath)).map((s) => s.kind)).toEqual(["endpoint"]);
    const good = await canaryRunCommand({ ...o, ifDue: true } as never);
    expect(good.outcome).toBe("run");
    expect(readRows(o.runsPath).rows.filter((x) => x.arm === "primary")).toHaveLength(260);
  });

  it("does not run through a cache: a probe that comes back without its own fresh code stops the arm", async () => {
    const o = base("cache");
    const r = await canaryRunCommand({ ...o, ifDue: true, makePort: () => new Port({ stale: true }) } as never);
    expect(r.outcome).toBe("skipped");
    expect(r.text).toContain("primary arm not run: the probe asked for a code invented a moment ago and the answer did not contain it, so the endpoint may be replaying answers.");
    expect(existsSync(o.runsPath)).toBe(false);
    expect(readSkips(skipsPathFor(o.runsPath))[0]).toMatchObject({ kind: "cache" });
    // A stale control endpoint alone leaves the primary arm recorded and says the control was not run.
    const o2 = base("cache-control");
    const r2 = await canaryRunCommand({ ...o2, makePort: (m: string) => new Port({ stale: m === "control-model" }) } as never);
    expect(r2.outcome).toBe("run");
    expect(r2.text).toContain("control arm not run: the probe asked for a code");
    expect(readRows(o2.runsPath).rows.every((x) => x.arm === "primary")).toBe(true);
  });

  it("keeps the old runs apart and starts a new baseline when the harness changed", async () => {
    const o = base("baseline");
    writeFileSync(o.runsPath, JSON.stringify(row(1, "2026-10-20", { harness: "v2:sha256:" + "f".repeat(64) })) + String.fromCharCode(10) + JSON.stringify(row(2, "2026-10-21", { harness: "v2:sha256:" + "f".repeat(64) })) + String.fromCharCode(10));
    const r = await canaryRunCommand({ ...o, today: "2026-10-24" } as never);
    expect(r.outcome).toBe("run");
    expect(r.text).toMatch(/The tasks or their checkers changed since the stored runs.*The old runs are kept as runs\.2026-10-24\.superseded\.jsonl\./);
    expect(readdirSync(o.dir).filter((f) => f.startsWith("runs.2026-10-24.superseded"))).toHaveLength(1);
    const rows = readRows(o.runsPath).rows;
    expect(new Set(rows.map((x) => x.day))).toEqual(new Set([1]));
    expect(rows.every((x) => x.harness === harnessHash())).toBe(true);
    expect(readRows(join(o.dir, "runs.2026-10-24.superseded.jsonl")).rows).toHaveLength(2);
  });

  it("will not run without a model, says so, and records it only in the hourly mode", async () => {
    const o = base("nomodel", { env: {}, makePort: undefined });
    const manual = await canaryRunCommand(o as never);
    expect(manual).toMatchObject({ outcome: "no_model" });
    expect(manual.text).toMatch(/never invents a score/);
    expect(existsSync(skipsPathFor(o.runsPath))).toBe(false);
    await canaryRunCommand({ ...o, ifDue: true } as never);
    expect(readSkips(skipsPathFor(o.runsPath))[0]).toMatchObject({ kind: "no_model" });
  });

  it("without a control model, runs the primary arm and says a platform event cannot then be told apart", async () => {
    const o = base("nocontrol");
    delete o.env["CANARY_CONTROL_MODEL"];
    const r = await canaryRunCommand(o as never);
    expect(r.text).toMatch(/No control arm: set CANARY_CONTROL_MODEL/);
    expect(readRows(o.runsPath).rows.every((x) => x.arm === "primary")).toBe(true);
  });
});

describe("the schedule", () => {
  it("prints an hourly command for each system and installs nothing", () => {
    expect(canaryScheduleSnippet("D:\\work\\desk", "win32")).toContain('schtasks /Create /SC HOURLY /TN "desk canary" /TR "cmd /c cd /d D:\\work\\desk && npm run desk --silent -- canary run --if-due"');
    expect(canaryScheduleSnippet("/srv/desk", "linux")).toContain("0 * * * * cd /srv/desk && npm run desk --silent -- canary run --if-due");
    expect(canaryScheduleSnippet("/srv/desk", "darwin")).toContain("<key>StartInterval</key><integer>3600</integer>");
    for (const p of ["win32", "linux", "darwin"] as const) expect(canaryScheduleSnippet("/srv/desk", p)).toMatch(/desk does not install it/);
  });
});

describe("the card says why the canary did not run", () => {
  it("shows the latest skip since the last run, as of the day looked at, and calls three quiet days not running", () => {
    const dir = join(tmp, "card");
    mkdirSync(dir, { recursive: true });
    const runs = join(dir, "runs.jsonl");
    writeFileSync(runs, JSON.stringify(row(1, "2026-10-20")) + String.fromCharCode(10));
    appendSkip(skipsPathFor(runs), { date: "2026-10-21", at: "a", kind: "plan_limit", reason: "the weekly window was 80% used" });
    appendSkip(skipsPathFor(runs), { date: "2026-10-23", at: "b", kind: "budget", reason: "over the day's budget" });
    const day = (d: string) => Date.parse(`${d}T12:00:00Z`);
    expect(canaryCard(runs, day("2026-10-23"), false)).toMatchObject({ state: "ok", skipped: { date: "2026-10-23", kind: "budget" }, notRunning: true, daysSinceRun: 3 });
    expect(canaryCard(runs, day("2026-10-23"), false, "2026-10-22").skipped).toMatchObject({ date: "2026-10-21", kind: "plan_limit" });
    expect(canaryCard(runs, day("2026-10-21"), false, "2026-10-20").skipped).toBeNull();
    const late = canaryCard(runs, day("2026-10-24"), false);
    expect(late).toMatchObject({ notRunning: true, daysSinceRun: 4, lastRun: "2026-10-20" });
    expect(late.skipped?.reason).toBe("over the day's budget");
    expect(canaryCard(runs, day("2026-10-22"), false)).toMatchObject({ notRunning: false });
  });
});
