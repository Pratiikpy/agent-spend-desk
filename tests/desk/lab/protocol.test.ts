import { describe, expect, it } from "vitest";

import type { RunRecord } from "../../../src/desk/lab/runner.ts";
import { evaluateProtocol, renderProtocol, spearman } from "../../../src/desk/lab/protocol.ts";

const run = (taskId: string, outcome: RunRecord["outcome"], over: Partial<RunRecord["accounting"]> = {}): RunRecord =>
  ({ taskId, outcome, wallMs: 1000, accounting: { calls: 5, retries: 0, promptTokens: 100, completionTokens: 10, receipts: 5, cacheHits: 0, modelErrors: 0, ...over } }) as unknown as RunRecord;

/** `n` runs of one task, `pass` of them passing. */
const task = (id: string, pass: number, n = 5): RunRecord[] => Array.from({ length: n }, (_, i) => run(id, i < pass ? "pass" : "fail"));

describe("the spike's go criteria", () => {
  it("says go when enough tasks are in the 20 to 80 percent band, infrastructure failures are few, receipts are there and no defect is open", () => {
    const records = [...task("a", 1), ...task("b", 3), ...task("c", 4), ...task("d", 5), ...task("e", 5), ...task("f", 0), ...task("g", 5), ...task("h", 5), ...task("i", 5), ...task("j", 2)];
    const r = evaluateProtocol(records, { openTaskDefects: 0 });
    expect(r.criteria.find((c) => c.id === "informative")).toMatchObject({ ok: true });
    expect(r.criteria.find((c) => c.id === "infrastructure")).toMatchObject({ ok: true });
    expect(r.criteria.find((c) => c.id === "receipts")).toMatchObject({ ok: true });
    expect(r.criteria.find((c) => c.id === "task_defects")).toMatchObject({ ok: true });
    expect(r.criteria.find((c) => c.id === "reproduction")?.ok).toBeNull();
    expect(r.verdict).toBe("pending_reproduction");
  });

  it("says no-go on too few informative tasks, naming the count and what to change", () => {
    const records = [...task("a", 5), ...task("b", 5), ...task("c", 5), ...task("d", 5), ...task("e", 0), ...task("f", 5), ...task("g", 5), ...task("h", 5), ...task("i", 5), ...task("j", 3)];
    const r = evaluateProtocol(records, { openTaskDefects: 0 });
    const c = r.criteria.find((x) => x.id === "informative")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/1 of 10/);
    expect(r.verdict).toBe("no_go");
    expect(r.next).toMatch(/change the tasks/i);
  });

  it("counts infrastructure failures against the limit and keeps them in the denominator", () => {
    const records = [...task("a", 2), ...task("b", 3), ...task("c", 2), ...Array.from({ length: 6 }, () => run("a", "infra", { calls: 0, receipts: 0 }))];
    const r = evaluateProtocol(records, { openTaskDefects: 0 });
    const c = r.criteria.find((x) => x.id === "infrastructure")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/6 of 21/);
    expect(r.verdict).toBe("no_go");
  });

  it("is not satisfied with receipts on only some runs that called the model", () => {
    const records = [...task("a", 2), ...task("b", 3), ...task("c", 2)].map((x, i) => (i % 2 === 0 ? { ...x, accounting: { ...x.accounting, receipts: 0 } } : x));
    expect(evaluateProtocol(records, { openTaskDefects: 0 }).criteria.find((c) => c.id === "receipts")?.ok).toBe(false);
  });

  it("will not call a spike a go while a task defect found in a failed run is still open", () => {
    const records = [...task("a", 2), ...task("b", 3), ...task("c", 2)];
    const r = evaluateProtocol(records, { openTaskDefects: 1 });
    expect(r.criteria.find((c) => c.id === "task_defects")?.ok).toBe(false);
    expect(r.verdict).toBe("no_go");
  });

  it("decides reproduction from a second batch: overall rates within 15 points and a rank correlation of at least 0.6", () => {
    const day1 = [...task("a", 1), ...task("b", 2), ...task("c", 3), ...task("d", 4), ...task("e", 5)];
    const day2 = [...task("a", 0), ...task("b", 2), ...task("c", 3), ...task("d", 5), ...task("e", 5)];
    const ok = evaluateProtocol(day1, { openTaskDefects: 0, second: day2 });
    expect(ok.criteria.find((c) => c.id === "reproduction")?.ok).toBe(true);
    expect(ok.verdict).toBe("go");
    const shuffled = [...task("a", 5), ...task("b", 4), ...task("c", 3), ...task("d", 2), ...task("e", 1)];
    const bad = evaluateProtocol(day1, { openTaskDefects: 0, second: shuffled });
    expect(bad.criteria.find((c) => c.id === "reproduction")?.ok).toBe(false);
    expect(bad.verdict).toBe("no_go");
  });

  it("reads an empty batch as nothing to judge", () => {
    expect(evaluateProtocol([], { openTaskDefects: 0 }).verdict).toBe("no_data");
  });
});

describe("rank correlation", () => {
  it("is 1 for the same order, -1 for the opposite, and handles ties", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
    expect(spearman([1, 2, 2, 4], [1, 2, 2, 4])).toBeCloseTo(1, 10);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

describe("reading the verdict", () => {
  it("lists each criterion with its evidence and ends with what to do next", () => {
    const text = renderProtocol(evaluateProtocol([...task("a", 2), ...task("b", 3), ...task("c", 2)], { openTaskDefects: 0 }));
    expect(text).toMatch(/informative/i);
    expect(text).toMatch(/infrastructure/i);
    expect(text).toMatch(/Next:/);
  });
});
