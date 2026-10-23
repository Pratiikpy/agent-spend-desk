import type { Precedent } from "../ask/ask.ts";

/**
 * Finding the earlier questions most like this one. A question is reduced to its shape first: dates, months, model names
 * and numbers are replaced by a placeholder, so "spend between 2026-09-02 and 2026-09-30" and "spend between 2026-10-05
 * and 2026-10-20" are the same shape. Similarity is the overlap of the words and word pairs that remain.
 */
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";

export function shapeOf(question: string): string {
  return question
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " <date> ")
    .replace(new RegExp(`\\b(?:${MONTHS})\\b(?:\\s+\\d{4})?`, "g"), " <month> ")
    .replace(/\b(?:claude|gpt|nemotron|gemini|llama)[a-z0-9._-]*/g, " <model> ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " <n> ")
    .replace(/[^a-z<>\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function features(question: string): Set<string> {
  const words = shapeOf(question).split(" ").filter(Boolean);
  const out = new Set<string>(words);
  for (let i = 0; i + 1 < words.length; i += 1) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export function similarity(a: string, b: string): number {
  const fa = features(a);
  const fb = features(b);
  if (fa.size === 0 || fb.size === 0) return 0;
  let common = 0;
  for (const f of fa) if (fb.has(f)) common += 1;
  return common / (fa.size + fb.size - common);
}

export const MIN_SIMILARITY = 0.5;

/** The `k` earlier questions closest in shape to `question`, none below the similarity floor, nearest first. A question is never its own precedent. */
export function nearest(question: string, pool: readonly Precedent[], k = 2): Precedent[] {
  return pool
    .filter((p) => p.question !== question)
    .map((p) => ({ p, s: similarity(question, p.question) }))
    .filter((x) => x.s >= MIN_SIMILARITY)
    .sort((x, y) => y.s - x.s || x.p.id.localeCompare(y.p.id))
    .slice(0, k)
    .map((x) => x.p);
}
