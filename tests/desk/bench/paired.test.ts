import { describe, expect, it } from "vitest";

import { mcnemarExact, pairedAgainst } from "../../../src/desk/bench/paired.ts";
import type { BenchRow } from "../../../src/desk/bench/run.ts";

const row = (qid: string, arm: BenchRow["arm"], exact: boolean, over: Partial<BenchRow> = {}): BenchRow => ({
  qid, trial: 0, arm, category: "lookup", split: "dev", answer: "", error: null, exact, close: exact, abstained: false, resisted: null, rejectedPremise: null, extraFigures: 0, modelCalls: 1, tokensIn: 1, tokensOut: 1, servedModel: null, ms: 1, detail: "", ...over,
});

describe("the exact McNemar p-value", () => {
  it("is 1 when nothing differs or the split is even, and matches the binomial for uneven splits", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(3, 3)).toBe(1);
    expect(mcnemarExact(5, 0)).toBeCloseTo(0.0625, 10);
    expect(mcnemarExact(0, 5)).toBeCloseTo(0.0625, 10);
    expect(mcnemarExact(10, 0)).toBeCloseTo(2 / 1024, 10);
    // n = 10, P(X <= 3) = 176/1024, doubled.
    expect(mcnemarExact(7, 3)).toBeCloseTo(0.34375, 10);
    expect(mcnemarExact(3, 7)).toBeCloseTo(0.34375, 10);
  });

  it("does not overflow for a large number of differing questions, and is never above 1", () => {
    expect(mcnemarExact(400, 380)).toBeLessThanOrEqual(1);
    expect(mcnemarExact(400, 380)).toBeGreaterThan(0.3);
    expect(mcnemarExact(1000, 0)).toBeLessThan(1e-100);
  });
});

describe("one arm against a reference", () => {
  it("counts the four kinds of pair and the share of the differing questions the reference won", () => {
    const rows = [
      ...["q1", "q2", "q3"].flatMap((q) => [row(q, "A2", true), row(q, "A4", true)]),
      ...["q4", "q5", "q6", "q7"].flatMap((q) => [row(q, "A2", true), row(q, "A4", false)]),
      row("q8", "A2", false), row("q8", "A4", true),
      row("q9", "A2", false), row("q9", "A4", false),
    ];
    const p = pairedAgainst(rows, "A2", "A4");
    expect(p).toMatchObject({ pairs: 9, excluded: 0, both: 3, onlyReference: 4, onlyArm: 1, neither: 1 });
    expect(p.p).toBeCloseTo(mcnemarExact(4, 1), 10);
    expect(p.referenceShare?.value).toBeCloseTo(0.8, 10);
    expect(p.referenceShare!.low).toBeLessThan(0.8);
    expect(p.referenceShare!.high).toBeGreaterThan(0.8);
  });

  it("leaves out a question either arm could not answer, and says how many", () => {
    const rows = [row("q1", "A2", true), row("q1", "A3", true), row("q2", "A2", true), row("q2", "A3", false, { error: "model unavailable" }), row("q3", "A2", true)];
    const p = pairedAgainst(rows, "A2", "A3");
    expect(p).toMatchObject({ pairs: 1, excluded: 2, both: 1 });
  });

  it("has no share and a p-value of 1 when the arms never differ, and ignores sampled trials", () => {
    const rows = [row("q1", "A2", true), row("q1", "A5", true), row("q1", "A5", false, { trial: 1 })];
    const p = pairedAgainst(rows, "A2", "A5");
    expect(p.referenceShare).toBeNull();
    expect(p.p).toBe(1);
    expect(p.pairs).toBe(1);
  });

  it("can compare on another outcome than exactness", () => {
    const rows = [row("q1", "A2", true, { resisted: true }), row("q1", "A4", true, { resisted: false }), row("q2", "A2", true, { resisted: true }), row("q2", "A4", true, { resisted: true })];
    const p = pairedAgainst(rows, "A2", "A4", (r) => r.resisted === true);
    expect(p).toMatchObject({ both: 1, onlyReference: 1, onlyArm: 0 });
  });
});
