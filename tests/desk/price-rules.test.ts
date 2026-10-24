import { describe, expect, it } from "vitest";

import { priceCall, type CallFacts } from "../../src/desk/cost/price-call.ts";
import { applyModifiers, hashModels, parseSnapshot, type ModifierSupplement, type PriceRow, type PriceSnapshot } from "../../src/desk/pricing/pricebook.ts";

// Opus 5.5 as the price book has it: $4 in, $20 out, reads 0.1x, 5-minute writes 1.25x, 1-hour writes 2x of the input price.
const OPUS55: PriceRow = { inputPerMTokMicros: 4_000_000, outputPerMTokMicros: 20_000_000, cacheReadPerMTokMicros: 400_000, cacheWrite5mPerMTokMicros: 5_000_000, cacheWrite1hPerMTokMicros: 8_000_000 };
const SONNET55: PriceRow = { inputPerMTokMicros: 2_000_000, outputPerMTokMicros: 10_000_000, cacheReadPerMTokMicros: 100_000, cacheWrite5mPerMTokMicros: 2_500_000, cacheWrite1hPerMTokMicros: 4_000_000 };
const HAIKU: PriceRow = {
  inputPerMTokMicros: 100_000, outputPerMTokMicros: 500_000, cacheReadPerMTokMicros: 10_000, cacheWrite5mPerMTokMicros: 125_000, cacheWrite1hPerMTokMicros: 200_000,
  longPrompt: { overPromptTokens: 100_000, inputPerMTokMicros: 500_000, outputPerMTokMicros: 2_500_000, cacheReadPerMTokMicros: 50_000, cacheWrite5mPerMTokMicros: 625_000, cacheWrite1hPerMTokMicros: 1_000_000 },
};
const OLD: PriceRow = { inputPerMTokMicros: 3_000_000, outputPerMTokMicros: 15_000_000, cacheReadPerMTokMicros: 300_000, cacheWrite5mPerMTokMicros: 3_750_000, cacheWrite1hPerMTokMicros: 6_000_000 };

const SUPPLEMENT: ModifierSupplement = {
  supplementId: "mods",
  source: "test page",
  sourceUrl: "https://example.invalid/pricing",
  fetchedAt: "2026-10-24T00:00:00.000Z",
  pageSha256: "0".repeat(64),
  fast: { "claude-opus-5-5": { inputPerMTokMicros: 8_000_000, outputPerMTokMicros: 40_000_000 } },
  usOnly: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
};

function snapshot(): PriceSnapshot {
  const models = { "claude-opus-5-5": OPUS55, "claude-sonnet-5-5": SONNET55, "claude-haiku-5-5": HAIKU, "claude-sonnet-4-5": OLD };
  const base = parseSnapshot({ snapshotId: "base", source: "test", sourceUrl: "https://example.invalid", fetchedAt: "2026-10-24T00:00:00.000Z", license: "test", upstreamSha256: "0".repeat(64), note: "n", contentHash: hashModels(models), models });
  return applyModifiers(base, SUPPLEMENT);
}

const T = (o: Partial<CallFacts["tokens"]>): CallFacts["tokens"] => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, ...o });
const call = (model: string, tokens: CallFacts["tokens"], speed: string | null = "standard", inferenceGeo: string | null = "global"): CallFacts => ({ model, tokens, speed, inferenceGeo });
const priced = (c: CallFacts) => {
  const p = priceCall(snapshot(), c);
  if (p.kind !== "priced") throw new Error("expected a price");
  return p;
};

describe("the price book's modifiers", () => {
  it("carries fast-mode prices and the US-only flag, and says where they came from", () => {
    const s = snapshot();
    expect(s.models["claude-opus-5-5"]?.fast).toEqual({ inputPerMTokMicros: 8_000_000, outputPerMTokMicros: 40_000_000 });
    expect(s.models["claude-opus-5-5"]?.usOnly).toBe(true);
    expect(s.models["claude-sonnet-4-5"]?.usOnly).toBeUndefined();
    expect(s.snapshotId).toBe("base+mods");
    expect(s.note).toMatch(/Fast-mode prices and US-only models from test page/);
  });

  it("refuses a supplement that names a model the base does not price", () => {
    const base = snapshot();
    expect(() => applyModifiers(base, { ...SUPPLEMENT, fast: { "claude-nope": { inputPerMTokMicros: 1, outputPerMTokMicros: 1 } } })).toThrowError(/does not price/);
    expect(() => applyModifiers(base, { ...SUPPLEMENT, usOnly: ["claude-nope"] })).toThrowError(/does not price/);
  });

  it("leaves a snapshot's hash alone when no model uses a modifier, so older snapshots still verify", () => {
    const models = { "claude-sonnet-4-5": OLD };
    const s = parseSnapshot({ snapshotId: "x", source: "s", sourceUrl: "u", fetchedAt: "t", license: "l", upstreamSha256: "0".repeat(64), note: "n", contentHash: hashModels(models), models });
    expect(s.models["claude-sonnet-4-5"]).toEqual(OLD);
  });
});

describe("priceCall, to the micro-dollar", () => {
  const tokens = T({ inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 10_000, cacheWrite5mTokens: 2_000, cacheWrite1hTokens: 1_000 });

  it("prices a standard call at the standard rates and names no rule", () => {
    // 1,000 x $4 + 500 x $20 + 10,000 x $0.40 + 2,000 x $5 + 1,000 x $8, per million = 4,000 + 10,000 + 4,000 + 10,000 + 8,000
    const p = priced(call("claude-opus-5-5", tokens));
    expect(p.totalMicros).toBe(36_000);
    expect(p.ruleIds).toEqual([]);
  });

  it("prices fast mode with the fast rates and the caching multipliers on the fast input price", () => {
    // fast input $8: reads $0.80, 5-minute writes $10, 1-hour writes $16; output $40
    const p = priced(call("claude-opus-5-5", tokens, "fast"));
    expect(p.components).toEqual({ input: 8_000, output: 20_000, cacheRead: 8_000, cacheWrite5m: 20_000, cacheWrite1h: 16_000 });
    expect(p.totalMicros).toBe(72_000);
    expect(p.ruleIds).toEqual(["fast_mode"]);
  });

  it("adds 1.1x on every price for a US-only call", () => {
    const p = priced(call("claude-sonnet-5-5", T({ inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 1_000 }), "standard", "us"));
    expect(p.totalMicros).toBe(13_310); // 12,100 x 1.1
    expect(p.ruleIds).toEqual(["us_only"]);
  });

  it("stacks fast mode and US-only", () => {
    const p = priced(call("claude-opus-5-5", T({ inputTokens: 1_000, outputTokens: 500 }), "fast", "us"));
    expect(p.totalMicros).toBe(30_800); // 28,000 x 1.1
    expect(p.ruleIds).toEqual(["fast_mode", "us_only"]);
  });

  it("applies the US-only multiplier to a long prompt's higher prices, and says both rules", () => {
    const p = priced(call("claude-haiku-5-5", T({ cacheReadTokens: 150_000, outputTokens: 1_000 }), "standard", "us"));
    expect(p.totalMicros).toBe(11_000); // 150,000 x $0.055 + 1,000 x $2.75, per million
    expect(p.ruleIds).toEqual(["long_prompt", "us_only"]);
  });

  it("uses the long-prompt line strictly: exactly 100,000 prompt tokens is still the short price", () => {
    expect(priced(call("claude-haiku-5-5", T({ cacheReadTokens: 100_000 }))).ruleIds).toEqual([]);
    expect(priced(call("claude-haiku-5-5", T({ cacheReadTokens: 100_001 }))).ruleIds).toEqual(["long_prompt"]);
  });

  it("prices at the standard rate and records a note, instead of guessing, when the log and the price book disagree or are silent", () => {
    const t = T({ inputTokens: 1_000, outputTokens: 1_000 });
    expect(priced(call("claude-sonnet-4-5", t, "fast")).ruleIds).toEqual(["note:fast_mode_unpriced"]);
    expect(priced(call("claude-opus-5-5", t, null)).ruleIds).toEqual(["note:speed_unrecorded"]);
    expect(priced(call("claude-sonnet-4-5", t, "standard", "us")).ruleIds).toEqual(["note:us_only_unpriced"]);
    expect(priced(call("claude-sonnet-5-5", t, "standard", null)).ruleIds).toEqual(["note:geo_unrecorded"]);
    expect(priced(call("claude-sonnet-5-5", t, "standard", "")).ruleIds).toEqual(["note:geo_unrecorded"]);
    // The vendor's own "not available" and the default "global" are standard pricing, not a gap.
    expect(priced(call("claude-sonnet-5-5", t, "standard", "not_available")).ruleIds).toEqual([]);
    expect(priced(call("claude-sonnet-5-5", t, "standard", "global")).ruleIds).toEqual([]);
    // A note does not change the price.
    expect(priced(call("claude-opus-5-5", t, null)).totalMicros).toBe(priced(call("claude-opus-5-5", t, "standard")).totalMicros);
  });

  it("reads the speed and the geography without regard to case or padding", () => {
    expect(priced(call("claude-opus-5-5", T({ outputTokens: 1_000 }), " FAST ", " US ")).ruleIds).toEqual(["fast_mode", "us_only"]);
  });

  it("passes an unpriced model through with its reason", () => {
    expect(priceCall(snapshot(), call("sonnet", T({ outputTokens: 1 })))).toEqual({ kind: "unpriced", reason: "alias-without-version", ruleIds: [] });
    expect(priceCall(snapshot(), call("gpt-9", T({ outputTokens: 1 })))).toMatchObject({ kind: "unpriced", reason: "unknown-model" });
  });

  it("never lets the fast path reuse a long-prompt tier, because fast mode is flat across the whole context", () => {
    const models = { "claude-x": { ...HAIKU, fast: { inputPerMTokMicros: 1_000_000, outputPerMTokMicros: 4_000_000 } } };
    const s = parseSnapshot({ snapshotId: "x", source: "s", sourceUrl: "u", fetchedAt: "t", license: "l", upstreamSha256: "0".repeat(64), note: "n", contentHash: hashModels(models), models });
    const p = priceCall(s, call("claude-x", T({ cacheReadTokens: 500_000, outputTokens: 1_000 }), "fast"));
    expect(p).toMatchObject({ kind: "priced", totalMicros: 54_000, ruleIds: ["fast_mode"] }); // 500,000 x $0.10 + 1,000 x $4
  });
});
