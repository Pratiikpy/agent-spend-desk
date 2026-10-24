import { divRound, type Micros } from "../money.ts";
import { promptTokens, resolvePrice, type PriceRow, type PriceSnapshot } from "../pricing/pricebook.ts";
import { listPriceCost, type CostComponents, type TokenCounts } from "./cost.ts";

/**
 * The price of one logged call, with the rules that decided it (DF-026). A rule that changed the price is named by its id;
 * a thing the log did not say, or that the price book cannot price, is recorded as a note beginning `note:` and priced at
 * the standard rate, never guessed.
 *
 *   long_prompt  a model priced by prompt length, and this request's prompt is over the line (strictly more than it)
 *   fast_mode    the log says speed "fast" and the model has fast-mode prices
 *   us_only      the log says inference_geo "us" and the model takes the 1.1x US-only multiplier
 *
 *   note:fast_mode_unpriced  the log says fast, but the price book has no fast price for this model
 *   note:speed_unrecorded    the model has a fast mode and the call carries no speed
 *   note:us_only_unpriced    the log says US-only, but the price book does not list this model for the multiplier
 *   note:geo_unrecorded      the model takes the multiplier and the call carries no inference_geo
 *
 * Cache prices follow the vendor's rule that the caching multipliers apply on top of fast mode and of the US-only multiplier.
 */
export interface CallFacts {
  model: string;
  tokens: TokenCounts;
  speed: string | null;
  inferenceGeo: string | null;
}

export type PricedCall =
  | { kind: "priced"; totalMicros: Micros; components: CostComponents; matchedAs: string; ladderStep: string; ruleIds: string[] }
  | { kind: "unpriced"; reason: string; ruleIds: string[] };

/** Caching multipliers on the input price, in hundredths: reads 0.1x, 5-minute writes 1.25x, 1-hour writes 2x. */
const READ_PCT = 10;
const WRITE_5M_PCT = 125;
const WRITE_1H_PCT = 200;

function fastRow(row: PriceRow): PriceRow {
  const fast = row.fast!;
  const input = fast.inputPerMTokMicros;
  const { longPrompt: _long, ...rest } = row;
  void _long;
  return {
    ...rest,
    inputPerMTokMicros: input,
    outputPerMTokMicros: fast.outputPerMTokMicros,
    cacheReadPerMTokMicros: divRound(input * READ_PCT, 100),
    cacheWrite5mPerMTokMicros: divRound(input * WRITE_5M_PCT, 100),
    cacheWrite1hPerMTokMicros: divRound(input * WRITE_1H_PCT, 100),
  };
}

const scale = (n: number): number => divRound(n * 11, 10);

function usOnlyRow(row: PriceRow): PriceRow {
  const out: PriceRow = {
    ...row,
    inputPerMTokMicros: scale(row.inputPerMTokMicros),
    outputPerMTokMicros: scale(row.outputPerMTokMicros),
    cacheReadPerMTokMicros: scale(row.cacheReadPerMTokMicros),
    cacheWrite5mPerMTokMicros: scale(row.cacheWrite5mPerMTokMicros),
    cacheWrite1hPerMTokMicros: scale(row.cacheWrite1hPerMTokMicros),
  };
  if (row.longPrompt) {
    out.longPrompt = {
      overPromptTokens: row.longPrompt.overPromptTokens,
      inputPerMTokMicros: scale(row.longPrompt.inputPerMTokMicros),
      outputPerMTokMicros: scale(row.longPrompt.outputPerMTokMicros),
      cacheReadPerMTokMicros: scale(row.longPrompt.cacheReadPerMTokMicros),
      cacheWrite5mPerMTokMicros: scale(row.longPrompt.cacheWrite5mPerMTokMicros),
      cacheWrite1hPerMTokMicros: scale(row.longPrompt.cacheWrite1hPerMTokMicros),
    };
  }
  return out;
}

/**
 * The prices that apply to a call given what the log (or the request) says about its speed and where it ran, and the rules
 * that changed them. The prompt-length tier is left to `listPriceCost`, which chooses it per request from the tokens.
 */
export function effectiveRow(base: PriceRow, speedRaw: string | null, inferenceGeo: string | null): { row: PriceRow; ids: string[] } {
  let row = base;
  const ids: string[] = [];

  const speed = (speedRaw ?? "").trim().toLowerCase();
  if (base.fast !== undefined) {
    if (speed === "fast") {
      row = fastRow(row);
      ids.push("fast_mode");
    } else if (speed === "") ids.push("note:speed_unrecorded");
  } else if (speed === "fast") ids.push("note:fast_mode_unpriced");

  const geo = (inferenceGeo ?? "").trim().toLowerCase();
  if (geo === "us") {
    if (base.usOnly === true) {
      row = usOnlyRow(row);
      ids.push("us_only");
    } else ids.push("note:us_only_unpriced");
  } else if (geo === "" && base.usOnly === true) ids.push("note:geo_unrecorded");
  return { row, ids };
}

export function priceCall(snapshot: PriceSnapshot, facts: CallFacts): PricedCall {
  const resolved = resolvePrice(snapshot, facts.model);
  if (resolved.kind === "unpriced") return { kind: "unpriced", reason: resolved.reason, ruleIds: [] };
  const { row, ids } = effectiveRow(resolved.row, facts.speed, facts.inferenceGeo);
  if (row.longPrompt && promptTokens(facts.tokens) > row.longPrompt.overPromptTokens) ids.unshift("long_prompt");

  const cost = listPriceCost(facts.tokens, row);
  return { kind: "priced", totalMicros: cost.totalMicros, components: cost.components, matchedAs: resolved.matchedAs, ladderStep: resolved.ladderStep, ruleIds: ids };
}
