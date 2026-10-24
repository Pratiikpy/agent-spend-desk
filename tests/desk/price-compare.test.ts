import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { comparePrices, parsePortkey, renderComparison } from "../../src/desk/pricing/compare.ts";
import { hashModels, loadSnapshot, parseSnapshot, type PriceRow } from "../../src/desk/pricing/pricebook.ts";

/** Portkey states prices in US cents per token. */
const portkey = (models: Record<string, unknown>) => ({ default: { pricing_config: { pay_as_you_go: { request_token: { price: 0 } } } }, ...models });
const rec = (inCents: number, outCents: number, read?: number, write5m?: number, write1h?: number) => ({
  pricing_config: {
    pay_as_you_go: {
      request_token: { price: inCents },
      response_token: { price: outCents },
      ...(write5m === undefined ? {} : { cache_write_input_token: { price: write5m } }),
      ...(read === undefined ? {} : { cache_read_input_token: { price: read } }),
      ...(write1h === undefined ? {} : { additional_units: { cache_write_1h: { price: write1h } } }),
    },
  },
});
const testSnapshot = (models: Record<string, PriceRow>) =>
  parseSnapshot({ snapshotId: "test", source: "test", sourceUrl: "https://example.invalid/prices.json", fetchedAt: "2026-10-24T00:00:00.000Z", license: "test", upstreamSha256: "0".repeat(64), note: "test", contentHash: hashModels(models), models });
const row = (i: number, o: number, r: number, w5: number, w1: number): PriceRow => ({ inputPerMTokMicros: i, outputPerMTokMicros: o, cacheReadPerMTokMicros: r, cacheWrite5mPerMTokMicros: w5, cacheWrite1hPerMTokMicros: w1 });

describe("reading Portkey's price file", () => {
  it("turns cents per token into micro-dollars per million tokens, exactly", () => {
    const m = parsePortkey(portkey({ a: rec(0.0002, 0.001, 0.00002, 0.00025, 0.0004), h: rec(0.00001, 0.00005, 0.000001, 0.0000125, 0.00002) }));
    expect(m["a"]?.base).toEqual({ inputPerMTokMicros: 2_000_000, outputPerMTokMicros: 10_000_000, cacheReadPerMTokMicros: 200_000, cacheWrite5mPerMTokMicros: 2_500_000, cacheWrite1hPerMTokMicros: 4_000_000 });
    expect(m["h"]?.base).toEqual({ inputPerMTokMicros: 100_000, outputPerMTokMicros: 500_000, cacheReadPerMTokMicros: 10_000, cacheWrite5mPerMTokMicros: 125_000, cacheWrite1hPerMTokMicros: 200_000 });
  });

  it("leaves out the default entry, keeps a model that gives no cache prices without inventing zeros, and skips one with no token prices", () => {
    const m = parsePortkey(portkey({ plain: rec(0.0001, 0.0002), empty: { pricing_config: {} }, junk: 7 }));
    expect(Object.keys(m)).toEqual(["plain"]);
    expect(m["plain"]?.base).toEqual({ inputPerMTokMicros: 1_000_000, outputPerMTokMicros: 2_000_000 });
  });

  it("reads the price tier for long prompts", () => {
    const withTier = {
      ...rec(0.00001, 0.00005, 0.000001, 0.0000125, 0.00002),
      custom_pricing: {
        context_tier_map: { "0": "lte-100k", "100000": "gt-100k" },
        regions: { default: { execution_modes: { standard: { context_tiers: { "gt-100k": { pricing_config: { pay_as_you_go: { request_token: { price: 0.00005 }, response_token: { price: 0.00025 }, cache_read_input_token: { price: 0.000005 } } } } } } } } },
      },
    };
    const m = parsePortkey(portkey({ h: withTier }));
    expect(m["h"]?.longPrompt).toEqual({ overPromptTokens: 100_000, base: { inputPerMTokMicros: 500_000, outputPerMTokMicros: 2_500_000, cacheReadPerMTokMicros: 50_000 } });
  });

  it("refuses a file that is not an object", () => {
    expect(() => parsePortkey(null)).toThrow(/object/);
    expect(() => parsePortkey([1])).toThrow(/object/);
    expect(() => parsePortkey("x")).toThrow(/object/);
  });
});

describe("comparing two price sources", () => {
  const ours = testSnapshot({ "m-same": row(1_000_000, 5_000_000, 100_000, 1_250_000, 2_000_000), "m-read": row(2_000_000, 10_000_000, 100_000, 2_500_000, 4_000_000), "m-only-ours": row(1, 1, 1, 1, 1) });

  it("counts agreeing prices, names each disagreement with both values and the size of the gap, and lists models only one source has", () => {
    const theirs = parsePortkey(portkey({ "m-same": rec(0.0001, 0.0005, 0.00001, 0.000125, 0.0002), "m-read": rec(0.0002, 0.001, 0.00002, 0.00025, 0.0004), "m-only-theirs": rec(0.0001, 0.0001) }));
    const c = comparePrices(ours, theirs);
    expect(c.compared).toEqual(["m-read", "m-same"]);
    expect(c.disagreements).toEqual([{ model: "m-read", field: "cacheReadPerMTokMicros", tier: "base", ours: 100_000, theirs: 200_000, relative: 0.5 }]);
    expect(c.agreeing).toBe(9);
    expect(c.onlyOurs).toEqual(["m-only-ours"]);
    expect(c.onlyTheirs).toEqual(["m-only-theirs"]);
  });

  it("does not call a price missing from the other source a disagreement, and counts it as not given", () => {
    const c = comparePrices(ours, parsePortkey(portkey({ "m-same": rec(0.0001, 0.0005) })));
    expect(c.disagreements).toEqual([]);
    expect(c.agreeing).toBe(2);
    expect(c.notGiven).toBe(3);
  });

  it("tolerates a rounding difference below the tolerance and reports one above it", () => {
    const near = parsePortkey(portkey({ "m-same": rec(0.0001000001, 0.0005, 0.00001, 0.000125, 0.0002) }));
    expect(comparePrices(ours, near).disagreements).toEqual([]);
    const off = parsePortkey(portkey({ "m-same": rec(0.00011, 0.0005, 0.00001, 0.000125, 0.0002) }));
    expect(comparePrices(ours, off).disagreements).toHaveLength(1);
    expect(comparePrices(ours, off, { tolerance: 0.2 }).disagreements).toEqual([]);
  });

  it("compares the long-prompt tier too, and reports a tier only one source has", () => {
    const tiered = testSnapshot({ h: { ...row(100_000, 500_000, 10_000, 125_000, 200_000), longPrompt: { overPromptTokens: 100_000, ...row(500_000, 2_500_000, 50_000, 625_000, 1_000_000) } } });
    const tier = (read: number) => ({
      ...rec(0.00001, 0.00005, 0.000001, 0.0000125, 0.00002),
      custom_pricing: { context_tier_map: { "0": "lte-100k", "100000": "gt-100k" }, regions: { default: { execution_modes: { standard: { context_tiers: { "gt-100k": { pricing_config: { pay_as_you_go: { request_token: { price: 0.00005 }, response_token: { price: 0.00025 }, cache_read_input_token: { price: read } } } } } } } } } },
    });
    expect(comparePrices(tiered, parsePortkey(portkey({ h: tier(0.000005) }))).disagreements).toEqual([]);
    const bad = comparePrices(tiered, parsePortkey(portkey({ h: tier(0.00001) })));
    expect(bad.disagreements).toEqual([{ model: "h", field: "cacheReadPerMTokMicros", tier: "long", ours: 50_000, theirs: 100_000, relative: 0.5 }]);
    const noTier = comparePrices(tiered, parsePortkey(portkey({ h: rec(0.00001, 0.00005, 0.000001, 0.0000125, 0.00002) })));
    expect(noTier.tierOnlyOurs).toEqual(["h"]);
    expect(noTier.tierOnlyTheirs).toEqual([]);
  });

  it("writes a report that states the dollars, the gap and the sources, and says plainly that a disagreement does not say which is right", () => {
    const theirs = parsePortkey(portkey({ "m-read": rec(0.0002, 0.001, 0.00002, 0.00025, 0.0004) }));
    const text = renderComparison(comparePrices(ours, theirs), { ours: "LiteLLM snapshot", theirs: "Portkey" });
    expect(text).toMatch(/m-read/);
    expect(text).toMatch(/cache read/i);
    expect(text).toMatch(/\$0\.10.*\$0\.20/);
    expect(text).toMatch(/50%/);
    expect(text).toMatch(/does not say which is right/i);
    expect(text).toMatch(/LiteLLM snapshot/);
    const agree = renderComparison(comparePrices(ours, parsePortkey(portkey({ "m-same": rec(0.0001, 0.0005, 0.00001, 0.000125, 0.0002) }))), { ours: "a", theirs: "b" });
    expect(agree).toMatch(/no disagreement/i);
  });
});

describe("the two committed price files", () => {
  const live = "data/prices/anthropic-2026-10-24.json";
  const other = "data/prices/portkey-anthropic-2026-10-24.json";
  it.skipIf(!existsSync(other))("agree on every price but the ones the report lists, and the report names Sonnet 5.5's cache read", () => {
    const wrapper = JSON.parse(readFileSync(other, "utf8")) as { models: unknown; license: string; sourceUrl: string; fetchedAt: string };
    expect(wrapper.license).toMatch(/MIT/);
    expect(wrapper.sourceUrl).toMatch(/^https:\/\/configs\.portkey\.ai\/pricing\/anthropic\.json$/);
    const c = comparePrices(loadSnapshot(live), parsePortkey(wrapper.models));
    expect(c.compared.length).toBeGreaterThan(10);
    expect(c.agreeing).toBeGreaterThan(c.disagreements.length * 3);
    expect(c.disagreements.find((d) => d.model === "claude-sonnet-5-5" && d.field === "cacheReadPerMTokMicros")).toMatchObject({ ours: 100_000, theirs: 200_000 });
  });
});
