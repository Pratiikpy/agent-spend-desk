/**
 * What the model itself said about the output it gave (DF-101). A token the model gave at under 1% probability was a coin it nearly did not toss; a few of them in an
 * otherwise sure output are where it went wrong or guessed, and counting them with the rest pulls the confidence of every token towards the middle. They are left out of the
 * mean and counted apart, so a reader sees both the confidence of what the model was sure of and how many tokens it was not.
 */
export const LOGPROB_FLOOR = Math.log(0.01);

export interface TokenLogprob {
  token?: string;
  logprob: number;
}

export interface TokenConfidence {
  tokens: number;
  /** Tokens given at under 1% probability, left out of the mean. */
  doubtful: number;
  /** The mean probability of the other tokens, 0 to 1; null when no token carried a usable logprob. */
  mean: number | null;
}

export function tokenConfidence(logprobs: readonly (TokenLogprob | number)[] | null | undefined): TokenConfidence {
  if (!logprobs || logprobs.length === 0) return { tokens: 0, doubtful: 0, mean: null };
  let sum = 0;
  let kept = 0;
  let doubtful = 0;
  let tokens = 0;
  for (const t of logprobs) {
    const lp = typeof t === "number" ? t : t.logprob;
    if (typeof lp !== "number" || Number.isNaN(lp) || lp > 0) continue;
    tokens += 1;
    if (lp < LOGPROB_FLOOR) {
      doubtful += 1;
      continue;
    }
    sum += Math.exp(lp);
    kept += 1;
  }
  return { tokens, doubtful, mean: kept === 0 ? null : sum / kept };
}
