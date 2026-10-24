import { describe, expect, it } from "vitest";

import { estimateTask, inRepo, MIN_TASKS, pastTasks, quantiles, renderEstimate, scorecardOf, taskType, weightedQuantile, weightsFor, type PastTask } from "../../src/desk/estimate/estimate.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { assignTasks } from "../../src/desk/tasks/assign.ts";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const DAY = 86_400_000;
const D = 1_000_000; // one dollar, in micros

let seq = 0;
const task = (over: Partial<PastTask> & { dollars: number }): PastTask => ({
  taskId: `t${seq++}`, method: "branch", label: "fix/x", projectPath: "C:/w/shop", type: "fix", lastMs: NOW - 5 * DAY, micros: over.dollars * D, ...over,
});

describe("a task's type", () => {
  it("is the branch's first part, a ticket's project key, the text before a colon in a label, or the label", () => {
    expect(taskType("branch", "fix/cart-total")).toBe("fix");
    expect(taskType("branch", "Feat/New")).toBe("feat");
    expect(taskType("branch", "cart-total")).toBe("branch");
    expect(taskType("ticket", "SHOP-142")).toBe("shop");
    expect(taskType("explicit", "fix: cart bug")).toBe("fix");
    expect(taskType("explicit", "checkout-rewrite")).toBe("checkout-rewrite");
    expect(taskType("pull_request", "#9")).toBe("pull_request");
    expect(taskType("session", "ab12cd34")).toBe("session");
  });
});

describe("weighted percentiles", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const equal = values.map(() => 1);
  it("takes the smallest value whose cumulative weight reaches the fraction", () => {
    expect([0.1, 0.5, 0.9].map((q) => weightedQuantile(values, equal, q))).toEqual([1, 5, 9]);
    expect(weightedQuantile([4], [1], 0.9)).toBe(4);
  });

  it("moves toward the heavier values", () => {
    expect(weightedQuantile(values, [1, 1, 1, 1, 1, 1, 1, 1, 1, 21], 0.5)).toBe(10);
  });

  it("counts every task equally up to five tasks, and halves a task's weight for every 30 days after that", () => {
    const five = [1, 2, 3, 4, 5].map((n) => task({ dollars: n, lastMs: NOW - 90 * DAY }));
    expect(weightsFor(five, NOW)).toEqual([1, 1, 1, 1, 1]);
    const six = [...five, task({ dollars: 6, lastMs: NOW })];
    const w = weightsFor(six, NOW);
    expect(w[0]).toBeCloseTo(0.125, 9); // 90 days is three half-lives
    expect(w[5]).toBe(1);
    expect(weightsFor([task({ dollars: 1, lastMs: NOW - 30 * DAY }), ...six.slice(1)], NOW)[0]).toBeCloseTo(0.5, 9);
  });

  it("gives the 10th, 50th and 90th percentile of a cohort", () => {
    const ten = values.map((n) => task({ dollars: n }));
    expect(quantiles(ten, NOW)).toEqual({ p10: 1 * D, p50: 5 * D, p90: 9 * D });
  });
});

describe("an estimate", () => {
  const many = (n: number, over: Partial<PastTask> = {}, base = 1) => Array.from({ length: n }, (_, i) => task({ dollars: base + i, ...over }));

  it("is no estimate, with the reason and what each comparison had, when no cohort has ten tasks", () => {
    const e = estimateTask(many(9), { type: "fix", repo: "C:/w/shop", nowMs: NOW });
    expect(e.range).toBeNull();
    expect(e.used).toBeNull();
    expect(e.reason).toMatch(/no estimate: fewer than 10 similar tasks \(the most any comparison had is 9\)/);
    expect(e.considered.map((c) => c.n)).toEqual([9, 9, 9, 9]);
    expect(renderEstimate(e)).toMatch(/A range from fewer tasks would be a guess; nothing is shown in its place\./);
    expect(renderEstimate(e)).not.toMatch(/Likely between/);
  });

  it("is no estimate for an empty ledger", () => {
    expect(estimateTask([], { nowMs: NOW }).reason).toMatch(/the most any comparison had is 0/);
  });

  it("uses the narrowest comparison that has ten tasks, and shows the ones it passed over", () => {
    const tasks = [...many(4), ...many(8, { projectPath: "C:/w/other" }), ...many(3, { type: "feat" })];
    const e = estimateTask(tasks, { type: "fix", repo: "C:/w/shop", nowMs: NOW });
    expect(e.considered).toEqual([
      { name: 'type "fix" in this repository', n: 4 },
      { name: 'type "fix" anywhere', n: 12 },
      { name: "any type in this repository", n: 7 },
      { name: "any task", n: 15 },
    ]);
    expect(e.used).toMatchObject({ name: 'type "fix" anywhere', n: 12 });
    expect(renderEstimate(e)).toMatch(/type "fix" anywhere: 12 tasks {2}<- used/);
  });

  it("falls to the repository, then to any task, when the type is unknown", () => {
    const tasks = many(10);
    expect(estimateTask(tasks, { type: "docs", repo: "C:/w/shop", nowMs: NOW }).used?.name).toBe("any type in this repository");
    expect(estimateTask(tasks, { type: "docs", repo: "C:/w/elsewhere", nowMs: NOW }).used?.name).toBe("any task");
    expect(estimateTask(tasks, { nowMs: NOW }).used?.name).toBe("any task");
  });

  it("keeps the tail: one very costly task stays in, and shows in the chance of crossing a cap", () => {
    const tasks = [...many(9), task({ dollars: 1000 })];
    const e = estimateTask(tasks, { nowMs: NOW, capMicros: 500 * D });
    expect(e.range?.p90).toBe(9 * D);
    expect(e.chanceOverCap).toBeCloseTo(0.1, 9);
    expect(renderEstimate(e)).toMatch(/Against the cap of \$500\.00: 10% of those tasks cost more than that\./);
    expect(renderEstimate(e)).toMatch(/One task in ten has cost more than the top of it, and the top of the range is not a ceiling/);
  });

  it("weights newer tasks more when it has more than five, so an old expensive habit fades", () => {
    const old = many(6, { lastMs: NOW - 240 * DAY }, 100); // $100 to $105, eight half-lives ago
    const recent = many(6, { lastMs: NOW - DAY }, 1); // $1 to $6
    const e = estimateTask([...old, ...recent], { nowMs: NOW });
    expect(e.range?.p50).toBeLessThanOrEqual(6 * D);
  });

  it("is a range, never a point, and says where it came from", () => {
    const e = estimateTask(many(12), { nowMs: NOW });
    const text = renderEstimate(e);
    expect(text).toMatch(/Likely between \$2\.00 and \$11\.00; the middle is \$6\.00\./);
    expect(text).toMatch(/10th to the 90th percentile of 12 tasks finished 2026-10-19 to 2026-10-19/);
  });
});

describe("the scorecard", () => {
  it("has nothing to say for ten tasks or fewer, and counts how often the range held the next task after that", () => {
    expect(scorecardOf(Array.from({ length: MIN_TASKS }, () => task({ dollars: 5 })), NOW)).toBeNull();
    const steady = Array.from({ length: 13 }, (_, i) => task({ dollars: 5, lastMs: NOW - (20 - i) * DAY }));
    expect(scorecardOf(steady, NOW)).toEqual({ n: 3, held: 3 });
    const spike = [...steady.slice(0, 12), task({ dollars: 500, lastMs: NOW - DAY })];
    expect(scorecardOf(spike, NOW)).toEqual({ n: 3, held: 2 });
  });

  it("is shown with its sample size, and called a small sample under twenty", () => {
    const steady = Array.from({ length: 13 }, (_, i) => task({ dollars: 5, lastMs: NOW - (20 - i) * DAY }));
    expect(renderEstimate(estimateTask(steady, { nowMs: NOW }))).toMatch(/held the real cost in 3 of 3 later tasks \(100%; about 80% is what it is meant to hold\)\. That is a small sample\./);
  });
});

describe("repositories", () => {
  it("match by folder, below or at it, in either path style, and not by a longer name", () => {
    const t = task({ dollars: 1, projectPath: "C:\\Work\\Shop\\api" });
    expect(inRepo(t, "c:/work/shop")).toBe(true);
    expect(inRepo(t, "C:\\Work\\Shop\\api\\")).toBe(true);
    expect(inRepo(t, "C:/work/shop-admin")).toBe(false);
    expect(inRepo(task({ dollars: 1, projectPath: null }), "C:/work/shop")).toBe(false);
  });
});

describe("tasks read from the ledger", () => {
  it("costs a task as the sum of the estimated cost of its sessions' calls, and leaves out a task with no priced call", () => {
    const db = openLedger(":memory:");
    db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at) VALUES ('a', 'claude_code', 'C:/w/shop', 'fix/cart', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'), ('b', 'claude_code', 'C:/w/shop', 'fix/cart', '2026-10-21T10:00:00.000Z', '2026-10-21T11:00:00.000Z'), ('c', 'claude_code', 'C:/w/shop', 'feat/x', '2026-10-22T10:00:00.000Z', '2026-10-22T11:00:00.000Z')").run();
    db.prepare("INSERT INTO price_snapshot (snapshot_id, source, source_url, fetched_at, license, upstream_sha256, content_hash, note) VALUES ('p', 's', 'u', 't', 'l', 'h', 'h', 'n')").run();
    const add = db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, 'm', 0, 1, 1, 0, 0, 0, 0, 'reported', 0, 0)");
    const cost = db.prepare("INSERT INTO cost_event (call_id, class, snapshot_id, total_micros, input_micros, output_micros, cache_read_micros, cache_write_5m_micros, cache_write_1h_micros) VALUES (?, 'estimated', 'p', ?, ?, 0, 0, 0, 0)");
    add.run("c1", "a", "2026-10-20T10:30:00.000Z");
    cost.run("c1", 3 * D, 3 * D);
    add.run("c2", "b", "2026-10-21T10:30:00.000Z");
    cost.run("c2", 4 * D, 4 * D);
    add.run("c3", "c", "2026-10-22T10:30:00.000Z");
    db.prepare("INSERT INTO cost_event (call_id, class, unpriced_reason) VALUES ('c3', 'unpriced', 'unknown-model')").run();
    assignTasks(db, []);
    expect(pastTasks(db).map((t) => [t.type, t.micros, new Date(t.lastMs).toISOString()])).toEqual([["fix", 7 * D, "2026-10-21T10:30:00.000Z"]]);
    db.close();
  });
});
