import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { comparePrices, parsePortkey } from "../../src/desk/pricing/compare.ts";
import { costBand, priceSensitivity, renderSensitivity } from "../../src/desk/pricing/sensitivity.ts";
import { hashModels, parseSnapshot, type PriceRow, type PriceSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const row = (i: number, o: number, r: number, w5: number, w1: number): PriceRow => ({ inputPerMTokMicros: i, outputPerMTokMicros: o, cacheReadPerMTokMicros: r, cacheWrite5mPerMTokMicros: w5, cacheWrite1hPerMTokMicros: w1 });
const snapshot = (models: Record<string, PriceRow>): PriceSnapshot =>
  parseSnapshot({ snapshotId: "ours", source: "test", sourceUrl: "https://example.invalid/p.json", fetchedAt: "2026-10-24T00:00:00.000Z", license: "test", upstreamSha256: "0".repeat(64), note: "test", contentHash: hashModels(models), models });

const SONNET = row(2_000_000, 10_000_000, 100_000, 2_500_000, 4_000_000);
const HAIKU: PriceRow = { ...row(100_000, 500_000, 10_000, 125_000, 200_000), longPrompt: { overPromptTokens: 100_000, ...row(500_000, 2_500_000, 50_000, 625_000, 1_000_000) } };
const ours = snapshot({ "claude-sonnet-5-5": SONNET, "claude-haiku-5-5": HAIKU, "claude-opus-5": row(5_000_000, 25_000_000, 500_000, 6_250_000, 10_000_000) });

/** Portkey's units: cents per token. */
const cents = (microsPerMTok: number): number => microsPerMTok / 1e10;
const theirRecord = (r: PriceRow, over: Partial<PriceRow> = {}, tier?: PriceRow) => {
  const p = { ...r, ...over };
  return {
    pricing_config: { pay_as_you_go: { request_token: { price: cents(p.inputPerMTokMicros) }, response_token: { price: cents(p.outputPerMTokMicros) }, cache_read_input_token: { price: cents(p.cacheReadPerMTokMicros) }, cache_write_input_token: { price: cents(p.cacheWrite5mPerMTokMicros) }, additional_units: { cache_write_1h: { price: cents(p.cacheWrite1hPerMTokMicros) } } } },
    ...(tier
      ? { custom_pricing: { context_tier_map: { "0": "lte", "100000": "gt" }, regions: { default: { execution_modes: { standard: { context_tiers: { gt: { pricing_config: { pay_as_you_go: { request_token: { price: cents(tier.inputPerMTokMicros) }, response_token: { price: cents(tier.outputPerMTokMicros) }, cache_read_input_token: { price: cents(tier.cacheReadPerMTokMicros) }, cache_write_input_token: { price: cents(tier.cacheWrite5mPerMTokMicros) }, additional_units: { cache_write_1h: { price: cents(tier.cacheWrite1hPerMTokMicros) } } } } } } } } } } } }
      : {}),
  };
};

let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  db.close();
  dir.dispose();
});

async function load(lines: string[]): Promise<void> {
  await ingestClaudeCode(db, [dir.file("s.jsonl", lines)], ours);
}

describe("what a price disagreement does to the cost estimate", () => {
  it("multiplies the tokens a disputed price applies to by the gap, per model and kind of token", async () => {
    await load([
      assistantLine({ id: "a", model: "claude-sonnet-5-5", read: 3_000_000, input: 10, output: 5 }),
      assistantLine({ id: "b", model: "claude-sonnet-5-5", read: 1_000_000, input: 10, output: 5, ts: "2026-10-21T10:00:00.000Z" }),
      assistantLine({ id: "c", model: "claude-opus-5", read: 9_000_000, input: 10, output: 5 }),
    ]);
    const theirs = parsePortkey({ "claude-sonnet-5-5": theirRecord(SONNET, { cacheReadPerMTokMicros: 200_000 }), "claude-opus-5": theirRecord(ours.models["claude-opus-5"]!) });
    const s = priceSensitivity(db, comparePrices(ours, theirs));
    expect(s).toEqual([{ model: "claude-sonnet-5-5", field: "cacheReadPerMTokMicros", tier: "base", tokens: 4_000_000, gapPerMTokMicros: 100_000, deltaMicros: 400_000 }]);
  });

  it("limits itself to a window when one is given, and to calls that were priced", async () => {
    await load([
      assistantLine({ id: "a", model: "claude-sonnet-5-5", read: 3_000_000, ts: "2026-10-20T10:00:00.000Z" }),
      assistantLine({ id: "b", model: "claude-sonnet-5-5", read: 1_000_000, ts: "2026-10-22T10:00:00.000Z" }),
      assistantLine({ id: "x", model: "claude-unheard-of-9", read: 7_000_000, ts: "2026-10-22T10:00:00.000Z" }),
    ]);
    const c = comparePrices(ours, parsePortkey({ "claude-sonnet-5-5": theirRecord(SONNET, { cacheReadPerMTokMicros: 200_000 }) }));
    expect(priceSensitivity(db, c)[0]?.tokens).toBe(4_000_000);
    expect(priceSensitivity(db, c, { since: "2026-10-22T00:00:00.000Z" })[0]?.tokens).toBe(1_000_000);
    expect(priceSensitivity(db, c, { until: "2026-10-22T00:00:00.000Z" })[0]?.tokens).toBe(3_000_000);
  });

  it("applies a long-prompt gap only to calls whose prompt is over the threshold", async () => {
    await load([
      assistantLine({ id: "short", model: "claude-haiku-5-5", read: 90_000, input: 5, output: 1 }),
      assistantLine({ id: "edge", model: "claude-haiku-5-5", read: 99_995, input: 5, output: 1 }),
      assistantLine({ id: "long", model: "claude-haiku-5-5", read: 200_000, input: 5, output: 1 }),
    ]);
    const theirs = parsePortkey({ "claude-haiku-5-5": theirRecord(HAIKU, {}, { ...(HAIKU.longPrompt as PriceRow), cacheReadPerMTokMicros: 100_000 }) });
    const s = priceSensitivity(db, comparePrices(ours, theirs));
    expect(s).toEqual([{ model: "claude-haiku-5-5", field: "cacheReadPerMTokMicros", tier: "long", tokens: 200_000, gapPerMTokMicros: 50_000, deltaMicros: 10_000 }]);
  });

  it("is empty when the sources agree", async () => {
    await load([assistantLine({ id: "a", model: "claude-sonnet-5-5", read: 3_000_000 })]);
    expect(priceSensitivity(db, comparePrices(ours, parsePortkey({ "claude-sonnet-5-5": theirRecord(SONNET) })))).toEqual([]);
  });

  it("turns the gaps into a band around the estimate: a lower price can lower it as well as raise it", () => {
    const band = costBand(10_000_000, [
      { model: "m1", field: "cacheReadPerMTokMicros", tier: "base", tokens: 1, gapPerMTokMicros: 1, deltaMicros: 2_000_000 },
      { model: "m2", field: "inputPerMTokMicros", tier: "base", tokens: 1, gapPerMTokMicros: -1, deltaMicros: -500_000 },
    ]);
    expect(band).toEqual({ estimateMicros: 10_000_000, lowMicros: 9_500_000, highMicros: 12_000_000 });
    expect(costBand(5, [])).toEqual({ estimateMicros: 5, lowMicros: 5, highMicros: 5 });
  });

  it("says in words what the gap is worth, naming the model and the price, and stays silent when there is none", async () => {
    await load([assistantLine({ id: "a", model: "claude-sonnet-5-5", read: 3_000_000 })]);
    const c = comparePrices(ours, parsePortkey({ "claude-sonnet-5-5": theirRecord(SONNET, { cacheReadPerMTokMicros: 200_000 }) }));
    const text = renderSensitivity(priceSensitivity(db, c), { ours: "our price book", theirs: "Portkey" });
    expect(text).toMatch(/claude-sonnet-5-5/);
    expect(text).toMatch(/cache read/);
    expect(text).toMatch(/3,000,000 tokens/);
    expect(text).toMatch(/\$0\.30 more/);
    expect(text).toMatch(/Portkey/);
    expect(renderSensitivity([], { ours: "a", theirs: "b" })).toBe("");
  });
});
