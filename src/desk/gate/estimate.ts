import { TOKENS_PER_MTOK, type Micros } from "../money.ts";
import { resolvePrice, type PriceSnapshot } from "../pricing/pricebook.ts";

/** Used when a request names no max_tokens (spec 10.5, the LiteLLM default). */
export const DEFAULT_MAX_TOKENS = 16_384;
/** A request cannot ask for more output than this; larger values are clamped, and the clamp is recorded. */
export const MAX_TOKENS_CEILING = 1_000_000;
export const MAX_INPUT_TOKENS = 4_000_000_000;

export interface EstimateInput {
  model: string;
  inputTokens: number | null;
  maxTokens: number | null;
  n: number;
  explicitMicros: Micros | null;
  /** Owner-set flat reservation for a model the price book cannot price (spec 10.5, the Helicone-style exception). */
  unpricedReserveMicros?: Readonly<Record<string, Micros>>;
}

export type Estimate =
  | { ok: true; micros: Micros; basis: Record<string, unknown> }
  | { ok: false; code: "unpriced_model" | "no_estimate"; reason: string };

/**
 * Worst-case reservation (spec 10.5): counted input tokens at the input rate, plus max_tokens at the
 * output rate (reasoning is billed as output), times n. Integer arithmetic through BigInt so that a large
 * request cannot lose precision; the sum is rounded half up once. An explicit amount can raise the
 * reservation but never lower it below the computed one.
 */
export function worstCaseReservation(snapshot: PriceSnapshot, input: EstimateInput): Estimate {
  const resolved = resolvePrice(snapshot, input.model);
  const haveTokens = input.inputTokens !== null || input.maxTokens !== null;
  if (resolved.kind === "unpriced") {
    const flat = input.unpricedReserveMicros?.[input.model];
    if (flat !== undefined && Number.isSafeInteger(flat) && flat > 0) {
      return {
        ok: true,
        micros: Math.max(flat, input.explicitMicros ?? 0),
        basis: { method: "owner_flat_reserve_for_unpriced_model", model: input.model, flatMicros: flat, unpricedReason: resolved.reason },
      };
    }
    return {
      ok: false,
      code: "unpriced_model",
      reason: `unpriced model "${input.model}" (${resolved.reason}); the gate refuses it unless the owner sets a flat per-model reservation`,
    };
  }
  if (!haveTokens) {
    if (input.explicitMicros !== null && input.explicitMicros > 0) {
      return { ok: true, micros: input.explicitMicros, basis: { method: "explicit_micros", explicitMicros: input.explicitMicros, matchedAs: resolved.matchedAs } };
    }
    return { ok: false, code: "no_estimate", reason: "the request names neither token counts nor an estimate_micros; there is nothing to reserve" };
  }
  const inTok = BigInt(input.inputTokens ?? 0);
  const requested = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const outTok = BigInt(Math.min(requested, MAX_TOKENS_CEILING));
  const numerator = inTok * BigInt(resolved.row.inputPerMTokMicros) + BigInt(input.n) * outTok * BigInt(resolved.row.outputPerMTokMicros);
  const denominator = BigInt(TOKENS_PER_MTOK);
  const q = numerator / denominator;
  const rounded = (numerator - q * denominator) * 2n >= denominator ? q + 1n : q;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, code: "no_estimate", reason: "the worst-case reservation does not fit in a safe integer; the request is refused" };
  }
  const computed = Number(rounded);
  const micros = Math.max(computed, input.explicitMicros ?? 0, 1);
  return {
    ok: true,
    micros,
    basis: {
      method: "worst_case",
      matchedAs: resolved.matchedAs,
      ladderStep: resolved.ladderStep,
      inputTokens: input.inputTokens ?? 0,
      maxTokens: Math.min(requested, MAX_TOKENS_CEILING),
      maxTokensDefaulted: input.maxTokens === null,
      maxTokensClamped: requested > MAX_TOKENS_CEILING,
      n: input.n,
      inputPerMTokMicros: resolved.row.inputPerMTokMicros,
      outputPerMTokMicros: resolved.row.outputPerMTokMicros,
      computedMicros: computed,
      explicitMicros: input.explicitMicros,
      snapshotId: snapshot.snapshotId,
    },
  };
}
