import { describe, expect, it } from "vitest";

import { parseVirtualPrices, withVirtualPrices } from "../../src/desk/pricing/virtual.ts";
import { parseSnapshot, resolvePrice } from "../../src/desk/pricing/pricebook.ts";
import { testSnapshot } from "./helpers.ts";

describe("prices that are set by the owner, for a model with no list price", () => {
  it("adds a row in micro-dollars per million tokens and leaves every real price as it was", () => {
    const base = testSnapshot();
    const next = withVirtualPrices(base, { "nvidia/nemotron": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 } });
    const r = resolvePrice(next, "nvidia/nemotron");
    expect(r).toMatchObject({ kind: "priced", row: { inputPerMTokMicros: 500_000, outputPerMTokMicros: 2_500_000, cacheReadPerMTokMicros: 500_000, cacheWrite5mPerMTokMicros: 500_000, cacheWrite1hPerMTokMicros: 500_000 } });
    expect(next.models["claude-opus-5"]).toEqual(base.models["claude-opus-5"]);
    expect(resolvePrice(base, "nvidia/nemotron").kind).toBe("unpriced");
  });

  it("says in the snapshot that these prices are set by the owner and are not a vendor's list", () => {
    const next = withVirtualPrices(testSnapshot(), { m: { inputUsdPerMTok: 1, outputUsdPerMTok: 2 } });
    expect(next.snapshotId).toBe("test-snapshot+owner-prices");
    expect(next.note).toMatch(/set by the owner/i);
    expect(next.source).toMatch(/owner/i);
  });

  it("produces a snapshot that the price reader accepts, hash included", () => {
    const next = withVirtualPrices(testSnapshot(), { m: { inputUsdPerMTok: 1, outputUsdPerMTok: 2 } });
    expect(() => parseSnapshot(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it("refuses a model that already has a list price, and a price that is not a plain non-negative number", () => {
    expect(() => withVirtualPrices(testSnapshot(), { "claude-opus-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 1 } })).toThrow(/already has a price/);
    expect(() => withVirtualPrices(testSnapshot(), { m: { inputUsdPerMTok: -1, outputUsdPerMTok: 1 } })).toThrow(/non-negative/);
    expect(() => withVirtualPrices(testSnapshot(), { m: { inputUsdPerMTok: Number.NaN, outputUsdPerMTok: 1 } })).toThrow(/non-negative/);
    expect(() => withVirtualPrices(testSnapshot(), { m: { inputUsdPerMTok: 1e12, outputUsdPerMTok: 1 } })).toThrow(/too large/);
  });

  it("reads MODEL=IN,OUT pairs from the command line", () => {
    expect(parseVirtualPrices(["a/b=0.5,2.5", "c=1,4"])).toEqual({ "a/b": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 }, c: { inputUsdPerMTok: 1, outputUsdPerMTok: 4 } });
    expect(parseVirtualPrices(undefined)).toEqual({});
    expect(() => parseVirtualPrices(["bad"])).toThrow(/MODEL=IN,OUT/);
    expect(() => parseVirtualPrices(["a=1"])).toThrow(/MODEL=IN,OUT/);
    expect(() => parseVirtualPrices(["a=x,1"])).toThrow(/MODEL=IN,OUT/);
  });
});
