import { existsSync, readFileSync } from "node:fs";

import type { AutopsyCall } from "../autopsy/engine.ts";

/**
 * The two other forms of context bloat the specification names (C-BLOAT, section 7.4), measured and not billed. They are measures because neither says that a
 * dollar was wasted: a short prompt on a large context is often a continuation that needs it ("yes", "go on"), and a call near the window is the model working
 * where it is meant to. What they show is how often it happens and what the reads cost, so that an owner who sees a great deal of it can look.
 *
 *  short prompt  a call right after a person's prompt, whose input was at least `minContext` tokens and in which the new content (what was not read from the cache) was
 *                under `newShare` of it: the "14,900 tokens on a greeting" pattern
 *  near window   a call whose whole input was at least `fillShare` of the model's context window, for the models whose window the owner has said; a model with no
 *                window is listed, never guessed at
 */
export const CONTEXT_PARAMS = { minContext: 10_000, newShare: 0.02, fillShare: 0.85 } as const;

/** Where the owner says what each model's context window is, in tokens. The price list does not carry it and the Desk does not guess. */
export const DEFAULT_WINDOWS = "data/desk/model-windows.json";
export type Windows = Record<string, number>;

export function readWindows(path: string = DEFAULT_WINDOWS): Windows {
  if (!existsSync(path)) return {};
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as { windows?: Record<string, unknown> };
    const out: Windows = {};
    for (const [model, tokens] of Object.entries(j.windows ?? {})) if (typeof tokens === "number" && Number.isInteger(tokens) && tokens >= 1_000 && tokens <= 100_000_000) out[model] = tokens;
    return out;
  } catch {
    return {};
  }
}

export interface ContextMeasure {
  shortPrompt: { calls: number; sessions: number; contextTokens: number; readMicros: number; unpricedCalls: number };
  nearWindow: { calls: number; sessions: number; models: Record<string, number> } | null;
  /** Models with calls in the period and no window the owner has given. */
  modelsWithoutWindow: string[];
  callsRead: number;
}

const newTokens = (c: AutopsyCall): number => c.tokens.input + c.tokens.write5m + c.tokens.write1h;
const totalTokens = (c: AutopsyCall): number => newTokens(c) + c.tokens.read;

export function contextMeasures(calls: readonly AutopsyCall[], windows: Windows = {}): ContextMeasure {
  const short = calls.filter((c) => c.humanPromptBefore && !c.isSidechain && totalTokens(c) >= CONTEXT_PARAMS.minContext && newTokens(c) < CONTEXT_PARAMS.newShare * totalTokens(c));
  const models = [...new Set(calls.map((c) => c.model))].sort();
  const known = Object.keys(windows).length > 0;
  const near = known ? calls.filter((c) => windows[c.model] !== undefined && totalTokens(c) >= CONTEXT_PARAMS.fillShare * (windows[c.model] as number)) : [];
  const byModel: Record<string, number> = {};
  for (const c of near) byModel[c.model] = (byModel[c.model] ?? 0) + 1;
  return {
    callsRead: calls.length,
    shortPrompt: {
      calls: short.length,
      sessions: new Set(short.map((c) => c.sessionId)).size,
      contextTokens: short.reduce((s, c) => s + totalTokens(c), 0),
      readMicros: short.reduce((s, c) => s + (c.micros?.read ?? 0), 0),
      unpricedCalls: short.filter((c) => c.micros === null).length,
    },
    nearWindow: known ? { calls: near.length, sessions: new Set(near.map((c) => c.sessionId)).size, models: byModel } : null,
    modelsWithoutWindow: known ? models.filter((m) => windows[m] === undefined) : models,
  };
}
