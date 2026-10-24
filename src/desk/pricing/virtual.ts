import { hashModels, type PriceRow, type PriceSnapshot } from "./pricebook.ts";

/**
 * Prices the owner sets for a model that has no list price: a model served free or through a plan, whose calls a budget
 * should still count. The numbers are the owner's, not a vendor's, and say so in the snapshot, so a cap in dollars on
 * such a model is a cap on tokens at the rates the owner chose. Cached and cache-written input are priced as input.
 */
export interface OwnerPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

const MAX_USD_PER_MTOK = 1_000_000;

export function withVirtualPrices(base: PriceSnapshot, prices: Readonly<Record<string, OwnerPrice>>): PriceSnapshot {
  const names = Object.keys(prices);
  if (names.length === 0) return base;
  const models: Record<string, PriceRow> = { ...base.models };
  for (const name of names) {
    const p = prices[name] as OwnerPrice;
    if (name in base.models) throw new RangeError(`${name} already has a price in ${base.snapshotId}; owner prices are for models without one`);
    for (const [label, v] of [["input", p.inputUsdPerMTok], ["output", p.outputUsdPerMTok]] as const) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new RangeError(`the ${label} price for ${name} must be a non-negative number of dollars per million tokens`);
      if (v > MAX_USD_PER_MTOK) throw new RangeError(`the ${label} price for ${name} is too large`);
    }
    const input = Math.round(p.inputUsdPerMTok * 1_000_000);
    models[name] = { inputPerMTokMicros: input, outputPerMTokMicros: Math.round(p.outputUsdPerMTok * 1_000_000), cacheReadPerMTokMicros: input, cacheWrite5mPerMTokMicros: input, cacheWrite1hPerMTokMicros: input };
  }
  return {
    ...base,
    snapshotId: `${base.snapshotId}+owner-prices`,
    source: `${base.source}; prices for ${names.length} model${names.length === 1 ? "" : "s"} set by the owner`,
    note: `${base.note} Rows for ${names.join(", ")} were set by the owner and are not a vendor's list prices.`,
    contentHash: hashModels(models),
    models,
  };
}

/** `MODEL=IN,OUT` pairs, in dollars per million tokens. */
export function parseVirtualPrices(pairs: readonly string[] | undefined): Record<string, OwnerPrice> {
  const out: Record<string, OwnerPrice> = {};
  for (const pair of pairs ?? []) {
    const m = /^(.+)=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(pair);
    if (m === null) throw new Error(`cannot read --price "${pair}"; use MODEL=IN,OUT in dollars per million tokens, for example nvidia/nemotron=0.5,2.5`);
    out[m[1] as string] = { inputUsdPerMTok: Number(m[2]), outputUsdPerMTok: Number(m[3]) };
  }
  return out;
}
