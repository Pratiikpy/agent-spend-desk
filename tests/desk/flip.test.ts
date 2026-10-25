import { describe, expect, it } from "vitest";

import { decideStatus, type PeriodReconciliation } from "../../src/desk/billing/reconcile.ts";
import { reconciliationFlips } from "../../src/desk/billing/flip.ts";
import { canaryFlips } from "../../src/desk/canary/flip.ts";
import type { RunRow } from "../../src/desk/canary/runner.ts";
import { buildSeries } from "../../src/desk/canary/store.ts";
import { harnessHash, TASKS } from "../../src/desk/canary/tasks.ts";
import { DEFAULT_CONFIG, evaluateAt, makeContext } from "../../src/desk/canary/verdict.ts";
import { describeFlip } from "../../src/desk/flip.ts";
import type { Sensitivity } from "../../src/desk/pricing/sensitivity.ts";
import { seeded } from "../../src/desk/replay/wind-tunnel.ts";

function row(over: Partial<RunRow>): RunRow {
  return { day: 1, date: "2026-09-30", arm: "primary", taskId: TASKS[0]!.id, servedModel: "model-a", score: 1, error: null, latencyMs: 1, tokensIn: 1, tokensOut: 1, replySha: "x", harness: harnessHash(), cacheBypass: true, ...over };
}

/** A canary history: pass probability `p(arm, day, taskIndex)` drawn per task and day from a seeded generator. */
function history(days: number, p: (arm: RunRow["arm"], day: number, i: number) => number): RunRow[] {
  const rand = seeded(11);
  const rows: RunRow[] = [];
  for (let day = 1; day <= days; day += 1) {
    for (const arm of ["primary", "control"] as const) {
      TASKS.forEach((t, i) => rows.push(row({ day, arm, taskId: t.id, score: rand() < p(arm, day, i) ? 1 : 0, date: `2026-10-${String(day).padStart(2, "0")}` })));
    }
  }
  return rows;
}

describe("what would flip the canary's verdict", () => {
  it("names the control arm as the one fact a clear regression rests on, and no task", () => {
    const ctx = makeContext(buildSeries(history(30, (arm, day) => (arm === "primary" && day >= 15 ? 0.3 : 0.9)))!);
    const cert = canaryFlips(ctx, 30);
    expect(cert.verdict).toBe("regressed");
    expect(cert.completeness).toBe("complete");
    expect(cert.tried).toBe(TASKS.length + 1);
    expect(cert.smallest).toMatchObject({ kind: "remove_control_arm", from: "regressed", to: "inconclusive" });
    expect(cert.smallest?.because).toMatch(/no control arm ran/);
    expect(cert.flips.filter((f) => f.kind === "remove_task")).toEqual([]);
    expect(describeFlip(cert)).toMatch(/^Leave the control arm out, and the verdict goes from regressed to inconclusive/);
  });

  it("finds the one task a call rests on and says what the verdict becomes without it", () => {
    const ctx = makeContext(buildSeries(history(30, (arm, day, i) => (arm === "primary" && day >= 15 && i === 0 ? 0 : 0.97)))!);
    const base = evaluateAt(ctx, 30);
    expect(base.verdict).toBe("inconclusive");
    expect(base.reason).toBe("rests_on_one_task");
    const cert = canaryFlips(ctx, 30);
    expect(cert.smallest).toMatchObject({ kind: "remove_task", subject: TASKS[0]!.id, from: "inconclusive", to: "steady" });
    expect(cert.smallest?.because).toMatch(/within what the data can detect/);
    // It is the task that moved, and no other task flips it.
    expect(cert.flips.map((f) => f.subject)).toEqual([TASKS[0]!.id]);
  });

  it("says that no single change flips a steady verdict, and how many it tried", () => {
    const ctx = makeContext(buildSeries(history(30, () => 0.8))!);
    const cert = canaryFlips(ctx, 30);
    expect(cert.verdict).toBe("steady");
    expect(cert.smallest).toBeNull();
    expect(cert.completeness).toBe("complete");
    expect(describeFlip(cert)).toBe(`No single change flips this steady verdict. All ${TASKS.length + 1} candidate changes were tried.`);
  });

  it("says it did not finish when the time ran out, and does not call that 'no flip exists'", () => {
    const ctx = makeContext(buildSeries(history(30, () => 0.8))!);
    let t = 0;
    const cert = canaryFlips(ctx, 30, DEFAULT_CONFIG, { budgetMs: 250, nowMs: () => (t += 100) });
    expect(cert.completeness).toBe("partial");
    expect(cert.tried).toBeLessThan(cert.candidates);
    expect(describeFlip(cert)).toMatch(/before the time ran out, so a flip may exist that was not found/);
  });

  it("tries the task that moved most first, so a short search looks where a flip is likeliest", () => {
    const ctx = makeContext(buildSeries(history(30, (arm, day, i) => (arm === "primary" && day >= 15 && i === 5 ? 0 : 0.97)))!);
    let t = 0;
    // The budget lets exactly the first candidate through (the clock moves 100 ms per reading and the limit is 150).
    const cert = canaryFlips(ctx, 30, DEFAULT_CONFIG, { budgetMs: 150, nowMs: () => (t += 100) });
    expect(cert.tried).toBe(1);
    expect(cert.smallest?.subject).toBe(TASKS[5]!.id);
  });

  it("is the same on every run for the same data", () => {
    const ctx = makeContext(buildSeries(history(30, (arm, day, i) => (arm === "primary" && day >= 15 && i === 0 ? 0 : 0.97)))!);
    expect(canaryFlips(ctx, 30)).toEqual(canaryFlips(ctx, 30));
  });

  it("leaves the verdict unchanged when no task is dropped, and drops only the one named", () => {
    const ctx = makeContext(buildSeries(history(30, (arm, day, i) => (arm === "primary" && day >= 15 && i === 0 ? 0 : 0.97)))!);
    expect(evaluateAt(ctx, 30, DEFAULT_CONFIG, {})).toEqual(evaluateAt(ctx, 30));
    expect(evaluateAt(ctx, 30, DEFAULT_CONFIG, { dropTask: 0 }).verdict).not.toBe(evaluateAt(ctx, 30).verdict);
    expect(evaluateAt(ctx, 30, DEFAULT_CONFIG, { dropTask: 1 }).verdict).toBe(evaluateAt(ctx, 30).verdict);
  });
});

describe("the status of a month against an invoice, as a function of its figures", () => {
  const base = { billed: 100_000_000, estimated: 100_000_000, tol: 0.02, full: true, covered: [{ start: "2026-10-01", end: "2026-10-31" }], unmatchedBilled: 0, unmatchedEstimated: 0, unpriced: 0 };

  it("reconciles within the tolerance with a whole month and matching models, and treats exactly the tolerance as within it", () => {
    expect(decideStatus(base).status).toBe("reconciled");
    expect(decideStatus({ ...base, estimated: 98_000_000 }).status).toBe("reconciled");
    expect(decideStatus({ ...base, estimated: 97_999_999 }).status).toBe("unreconciled");
  });

  it("is partial for a part month or models that do not match, even when the totals agree", () => {
    expect(decideStatus({ ...base, full: false }).reason).toMatch(/covers 2026-10-01 to 2026-10-31, not the whole month/);
    expect(decideStatus({ ...base, unmatchedBilled: 5 }).status).toBe("partial");
    expect(decideStatus({ ...base, unmatchedEstimated: 5 }).status).toBe("partial");
  });

  it("names the calls with no price when they could explain a gap", () => {
    expect(decideStatus({ ...base, estimated: 50_000_000, unpriced: 1 }).reason).toMatch(/1 call in the month has no price and are not in the estimate|1 call in the month have no price/);
  });

  it("handles a zero invoice", () => {
    expect(decideStatus({ ...base, billed: 0, estimated: 0 }).status).toBe("reconciled");
    expect(decideStatus({ ...base, billed: 0, estimated: 5 }).status).toBe("unreconciled");
  });
});

describe("what would flip a month's reconciliation", () => {
  const month = (over: Partial<PeriodReconciliation> = {}): PeriodReconciliation => ({
    vendor: "anthropic",
    period: "2026-10",
    currency: "USD",
    billedMicros: 100_000_000,
    estimatedMicros: 110_000_000,
    reportedMicros: null,
    gapMicros: -10_000_000,
    status: "unreconciled",
    reason: "the estimate differs",
    unmatchedBilledMicros: 0,
    unmatchedEstimatedMicros: 0,
    invoices: ["INV-1"],
    basis: { tol: 0.02, full: true, covered: [{ start: "2026-10-01", end: "2026-10-31" }], unpriced: 0 },
    ...over,
  });
  const sens = (model: string, deltaMicros: number): Sensitivity => ({ model, field: "outputPerMTokMicros", tier: "base", tokens: 1_000_000, gapPerMTokMicros: deltaMicros, deltaMicros });

  it("names the model whose other price would make the month reconcile, and what the month becomes", () => {
    const cert = reconciliationFlips(month(), [sens("claude-opus-5", -9_000_000)], "Portkey");
    expect(cert.smallest).toMatchObject({ kind: "swap_price", subject: "claude-opus-5", from: "unreconciled", to: "reconciled" });
    expect(cert.smallest?.change).toBe("Price claude-opus-5 as Portkey does (-$9.00 on this month's estimate)");
    expect(describeFlip(cert)).toMatch(/^Price claude-opus-5 as Portkey does/);
  });

  it("finds a flip only when the disputed prices are all taken together", () => {
    const cert = reconciliationFlips(month({ estimatedMicros: 110_000_000 }), [sens("claude-opus-5", -5_000_000), sens("claude-sonnet-5-5", -5_000_000)], "Portkey");
    expect(cert.flips.map((f) => f.subject)).toEqual(["every disputed price"]);
    expect(cert.candidates).toBe(3);
    expect(cert.tried).toBe(3);
  });

  it("orders flips by how small the change is, so the smallest comes first", () => {
    const cert = reconciliationFlips(month({ estimatedMicros: 103_000_000 }), [sens("claude-opus-5", -2_000_000), sens("claude-sonnet-5-5", -1_500_000)], "Portkey");
    expect(cert.smallest?.subject).toBe("claude-sonnet-5-5");
    expect(cert.flips.length).toBeGreaterThanOrEqual(2);
  });

  it("can flip a reconciled month the other way", () => {
    const cert = reconciliationFlips(month({ status: "reconciled", estimatedMicros: 100_500_000 }), [sens("claude-opus-5", 6_000_000)], "Portkey");
    expect(cert.smallest).toMatchObject({ from: "reconciled", to: "unreconciled" });
  });

  it("says no single change flips it when the disputed prices are too small to matter", () => {
    const cert = reconciliationFlips(month(), [sens("claude-opus-5", -100_000)], "Portkey");
    expect(cert.smallest).toBeNull();
    expect(describeFlip(cert)).toBe("No single change flips this unreconciled verdict. The one candidate change was tried.");
  });

  it("has nothing to flip when there is no invoice or no disputed price", () => {
    expect(reconciliationFlips(month({ billedMicros: null }), [sens("claude-opus-5", -9_000_000)], "Portkey").candidates).toBe(0);
    expect(reconciliationFlips(month(), [], "Portkey")).toMatchObject({ smallest: null, candidates: 0, completeness: "complete" });
  });
});
