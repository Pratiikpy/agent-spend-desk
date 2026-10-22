/**
 * Money is an integer count of micro-US-dollars (1 USD = 1,000,000 micros). Floating point
 * money appears nowhere in the Desk: prices are integer micros per million tokens and a cost
 * is computed as one exact integer numerator divided once (spec 4.1, 6.2).
 */
export type Micros = number;

export const MICROS_PER_USD = 1_000_000;
export const TOKENS_PER_MTOK = 1_000_000;

export function assertSafeInt(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative safe integer, got ${String(value)}`);
  }
}

/** Round-half-up integer division for non-negative integers. */
export function divRound(numerator: number, denominator: number): number {
  assertSafeInt(numerator, "numerator");
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`denominator must be a positive safe integer, got ${String(denominator)}`);
  }
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

/**
 * Split `total` across parts in proportion to their exact numerators so that the rounded
 * parts sum to the rounded total exactly (largest remainder, ties by index). `numerators`
 * are exact integers whose sum divided by `denominator` rounds to `total`.
 */
export function allocateExact(numerators: readonly number[], denominator: number, total: number): number[] {
  const floors = numerators.map((n) => Math.floor(n / denominator));
  const remainders = numerators.map((n, i) => ({ i, r: n - (floors[i] ?? 0) * denominator }));
  let missing = total - floors.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  const out = [...floors];
  for (const { i } of remainders) {
    if (missing <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    missing -= 1;
  }
  return out;
}

export function formatUsd(micros: Micros): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  const dollars = Math.floor(abs / MICROS_PER_USD);
  const cents = Math.floor((abs % MICROS_PER_USD) / 10_000);
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
}
