import { describe, expect, it } from "vitest";

import { listPriceCost } from "../../src/desk/cost/cost.ts";
import { allocateExact, divRound, formatUsd } from "../../src/desk/money.ts";
import { hashModels, parseSnapshot, resolvePrice } from "../../src/desk/pricing/pricebook.ts";
import { OPUS5, testSnapshot } from "./helpers.ts";

describe("money", () => {
  it("rounds half up and rejects bad input", () => {
    expect(divRound(587_415_500_000, 1_000_000)).toBe(587_416);
    expect(divRound(1, 2)).toBe(1);
    expect(divRound(0, 7)).toBe(0);
    expect(() => divRound(-1, 2)).toThrow(RangeError);
    expect(() => divRound(1.5, 2)).toThrow(RangeError);
    expect(() => divRound(1, 0)).toThrow(RangeError);
  });

  it("allocates parts so they sum to the total exactly", () => {
    const parts = allocateExact([10_000_000, 12_675_000_000, 16_290_500_000, 0, 558_440_000_000], 1_000_000, 587_416);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(587_416);
    expect(parts).toEqual([10, 12_675, 16_291, 0, 558_440]);
  });

  it("formats dollars without floating point", () => {
    expect(formatUsd(587_416)).toBe("$0.58");
    expect(formatUsd(4_812_000_000)).toBe("$4,812.00");
  });
});

describe("list price cost", () => {
  // The call below is the shape and size of a real logged call (opus-5, 1-hour cache write).
  // Expected value computed by hand: 10,000,000 + 12,675,000,000 + 16,290,500,000 + 558,440,000,000
  // = 587,415,500,000 numerator, divided by 1,000,000 and rounded half up = 587,416 micro-dollars.
  it("matches a hand-computed call and its components sum to the total", () => {
    const r = listPriceCost(
      { inputTokens: 2, outputTokens: 507, cacheReadTokens: 32_581, cacheWrite5mTokens: 0, cacheWrite1hTokens: 55_844 },
      OPUS5,
    );
    expect(r.totalMicros).toBe(587_416);
    const c = r.components;
    expect(c.input + c.output + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h).toBe(r.totalMicros);
    expect(c.cacheWrite1h).toBe(558_440);
  });

  it("prices the 5-minute and 1-hour cache writes differently", () => {
    const five = listPriceCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 1_000_000, cacheWrite1hTokens: 0 }, OPUS5);
    const hour = listPriceCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 1_000_000 }, OPUS5);
    expect(five.totalMicros).toBe(6_250_000);
    expect(hour.totalMicros).toBe(10_000_000);
  });

  it("is zero for an empty call and rejects negative or fractional tokens", () => {
    expect(listPriceCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, OPUS5).totalMicros).toBe(0);
    expect(() => listPriceCost({ inputTokens: -1, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, OPUS5)).toThrow(RangeError);
    expect(() => listPriceCost({ inputTokens: 0.5, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, OPUS5)).toThrow(RangeError);
  });

  it("refuses a numerator that would overflow a safe integer", () => {
    expect(() =>
      listPriceCost({ inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, OPUS5),
    ).toThrow(RangeError);
  });
});

describe("price book", () => {
  const snap = testSnapshot();

  it("resolves exact, dated and case variants and never guesses a bare alias", () => {
    expect(resolvePrice(snap, "claude-opus-5")).toMatchObject({ kind: "priced", ladderStep: "exact" });
    expect(resolvePrice(snap, "claude-opus-5-20261001")).toMatchObject({ kind: "priced", matchedAs: "claude-opus-5", ladderStep: "date-suffix" });
    expect(resolvePrice(snap, "claude-opus-5@default")).toMatchObject({ kind: "priced", ladderStep: "at-suffix" });
    expect(resolvePrice(snap, "Claude-Opus-5")).toMatchObject({ kind: "priced", ladderStep: "case" });
    expect(resolvePrice(snap, "sonnet")).toEqual({ kind: "unpriced", reason: "alias-without-version" });
    expect(resolvePrice(snap, "gpt-9")).toEqual({ kind: "unpriced", reason: "unknown-model" });
    expect(resolvePrice(snap, "")).toEqual({ kind: "unpriced", reason: "empty-model" });
    expect(resolvePrice(snap, null)).toEqual({ kind: "unpriced", reason: "empty-model" });
  });

  it("detects an edited snapshot", () => {
    const edited = {
      snapshotId: "x", source: "x", sourceUrl: "x", fetchedAt: "x", license: "x", upstreamSha256: "x", note: "x",
      contentHash: hashModels({ "claude-opus-5": OPUS5 }),
      models: { "claude-opus-5": { ...OPUS5, inputPerMTokMicros: 1 } },
    };
    expect(() => parseSnapshot(edited)).toThrow(/contentHash/);
  });

  it("rejects non-integer or negative prices", () => {
    const models = { m: { ...OPUS5, inputPerMTokMicros: 1.5 } };
    expect(() => parseSnapshot({ snapshotId: "x", source: "x", sourceUrl: "x", fetchedAt: "x", license: "x", upstreamSha256: "x", note: "x", contentHash: "x", models })).toThrow(/integer/);
  });
});
