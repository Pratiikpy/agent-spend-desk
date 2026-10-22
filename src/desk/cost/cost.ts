import { allocateExact, assertSafeInt, divRound, TOKENS_PER_MTOK, type Micros } from "../money.ts";
import type { PriceRow } from "../pricing/pricebook.ts";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}

export interface CostComponents {
  input: Micros;
  output: Micros;
  cacheRead: Micros;
  cacheWrite5m: Micros;
  cacheWrite1h: Micros;
}

export interface CostResult {
  totalMicros: Micros;
  components: CostComponents;
}

/**
 * Per-call list-price cost (spec 6.2). Each component's exact numerator is tokens times the
 * integer micro price per million tokens; the total is the sum of numerators divided once
 * and rounded half up; the components are then split by largest remainder so that they sum
 * to the total exactly. Reasoning tokens are a share of output tokens and are not billed
 * twice: they are recorded elsewhere, never added here.
 */
export function listPriceCost(tokens: TokenCounts, price: PriceRow): CostResult {
  const parts = [
    ["input", tokens.inputTokens, price.inputPerMTokMicros],
    ["output", tokens.outputTokens, price.outputPerMTokMicros],
    ["cacheRead", tokens.cacheReadTokens, price.cacheReadPerMTokMicros],
    ["cacheWrite5m", tokens.cacheWrite5mTokens, price.cacheWrite5mPerMTokMicros],
    ["cacheWrite1h", tokens.cacheWrite1hTokens, price.cacheWrite1hPerMTokMicros],
  ] as const;
  const numerators = parts.map(([name, count, rate]) => {
    assertSafeInt(count, `${name} tokens`);
    const n = count * rate;
    if (!Number.isSafeInteger(n)) throw new RangeError(`${name} cost numerator overflows a safe integer`);
    return n;
  });
  const total = divRound(
    numerators.reduce((a, b) => a + b, 0),
    TOKENS_PER_MTOK,
  );
  const [input = 0, output = 0, cacheRead = 0, cacheWrite5m = 0, cacheWrite1h = 0] = allocateExact(numerators, TOKENS_PER_MTOK, total);
  return { totalMicros: total, components: { input, output, cacheRead, cacheWrite5m, cacheWrite1h } };
}
