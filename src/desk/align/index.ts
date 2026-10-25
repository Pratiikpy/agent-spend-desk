import { alignJson, PASS_AT, type AlignOptions, type Alignment } from "./json.ts";
import { tokenConfidence, type TokenConfidence, type TokenLogprob } from "./confidence.ts";

export { alignJson, parseJsonLoose, PASS_AT, KEY_WEIGHT, VALUE_WEIGHT, type Alignment, type AlignedField, type AlignOptions } from "./json.ts";
export { assign, type Assignment } from "./hungarian.ts";
export { tokenConfidence, LOGPROB_FLOOR, type TokenConfidence, type TokenLogprob } from "./confidence.ts";
export { editDistance, sequenceSimilarity, textSimilarity, wordSimilarity, numberSimilarity } from "./similarity.ts";

export interface ToolOutputScore {
  alignment: Alignment;
  confidence: TokenConfidence;
  /** The label stored with the score: `low` when the output was compared as words or cut out of text, and when the model was unsure of most of what it wrote. */
  label: "high" | "low";
}

/**
 * Score one tool output against its reference: how much of the reference is in it, and what the model said about its own tokens. The score is the alignment alone; the
 * logprobs never move it, they only tell a reader how much weight the output can bear.
 */
export function scoreToolOutput(o: { reference: unknown; observed: unknown; logprobs?: readonly (TokenLogprob | number)[] | null } & AlignOptions): ToolOutputScore {
  const alignment = alignJson(o.reference, o.observed, { threshold: o.threshold ?? PASS_AT, ...(o.coerceNumericStrings !== undefined ? { coerceNumericStrings: o.coerceNumericStrings } : {}), ...(o.orderedLists !== undefined ? { orderedLists: o.orderedLists } : {}) });
  const confidence = tokenConfidence(o.logprobs);
  const unsure = confidence.tokens > 0 && confidence.doubtful / confidence.tokens > 0.5;
  return { alignment, confidence, label: alignment.confidence === "low" || unsure ? "low" : "high" };
}
