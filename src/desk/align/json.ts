import { assign } from "./hungarian.ts";
import { numberSimilarity, textSimilarity, wordSimilarity } from "./similarity.ts";

/**
 * Scoring a structured tool output against a reference by what is in it and not by how it is laid out (DF-101). Equality of two JSON texts says no when the keys come in another
 * order, when a list of results comes back sorted differently, or when one string differs by a letter; a score between 0 and 1 says how much of the reference is there.
 *
 * Objects: every field of the reference is paired with a field of the output so that the pairs score as much as they can together (Kuhn-Munkres). A pair scores 0.3 for the
 * same key and 0.7 for how alike the values are, so a field renamed with its value kept scores 0.7 and a field with the right key and a wrong value scores 0.3. Lists are
 * matched the same way by the value alone, in any order. A field or element with no partner scores 0 and counts against the whole, in the reference or in the output, so an
 * output that adds fields is worse than one that does not. Strings are compared by characters, numbers by distance against the larger, and anything of a different type is 0.
 *
 * What is not JSON is compared by words and marked as low confidence, because a score of how alike two pieces of prose are says little about whether the output is right.
 */
export const KEY_WEIGHT = 0.3;
export const VALUE_WEIGHT = 0.7;
export const PASS_AT = 0.85;
/** Comparisons of one value with another, counting the ones made to choose pairs, before the comparison is given up as too large to score as structure. */
export const MAX_NODES = 2_000_000;
/** The most elements in one list that are matched by assignment; a longer list is matched in order. */
export const MAX_ASSIGN = 400;
const MAX_DEPTH = 64;
const MAX_DETAILS = 200;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface AlignedField {
  /** Where in the reference, as a path like `items[2].name`. */
  path: string;
  /** `matched` with the score it earned, `missing` from the output, `extra` in the output only, `mismatch` for a different type. */
  kind: "matched" | "missing" | "extra" | "mismatch";
  score: number;
  /** Set when the key of the output differed from the reference's (a renamed field). */
  observedKey?: string;
}

export interface Alignment {
  score: number;
  pass: boolean;
  mode: "structured" | "text";
  /** Low when the comparison fell back to words, or the output had to be cut out of text around it. */
  confidence: "high" | "low";
  note: string | null;
  details: AlignedField[];
  detailsTruncated: boolean;
}

export interface AlignOptions {
  /** The score at or above which the output counts as right. Default 0.85. */
  threshold?: number;
  /** Treat a number and the same number written as a string as the same. Default off: a string where a number was asked for is a different answer. */
  coerceNumericStrings?: boolean;
  /** Compare lists in order, for a list whose order is the answer (steps, a ranking). Default off. */
  orderedLists?: boolean;
}

interface Ctx {
  nodes: number;
  details: AlignedField[];
  truncated: boolean;
  coerce: boolean;
  ordered: boolean;
  tooLarge: boolean;
}

function typeOf(v: Json): "null" | "boolean" | "number" | "string" | "array" | "object" {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v as "boolean" | "number" | "string" | "object";
}

function note(ctx: Ctx, f: AlignedField): void {
  if (ctx.details.length >= MAX_DETAILS) {
    ctx.truncated = true;
    return;
  }
  ctx.details.push(f);
}

/** How alike two values are, 0 to 1, with the fields of each noted at `path`. Nothing in it throws. */
function sim(ref: Json, obs: Json, path: string, ctx: Ctx, depth: number, record: boolean): number {
  ctx.nodes += 1;
  if (ctx.nodes > MAX_NODES || depth > MAX_DEPTH) {
    ctx.tooLarge = true;
    return 0;
  }
  const tr = typeOf(ref);
  const to = typeOf(obs);
  if (tr !== to) {
    const text = tr === "string" ? (ref as string) : to === "string" ? (obs as string) : null;
    const number = tr === "number" ? (ref as number) : to === "number" ? (obs as number) : null;
    if (ctx.coerce && text !== null && number !== null && text.trim() !== "" && Number.isFinite(Number(text))) {
      const s = numberSimilarity(number, Number(text));
      if (record) note(ctx, { path, kind: "matched", score: s });
      return s;
    }
    if (record) note(ctx, { path, kind: "mismatch", score: 0 });
    return 0;
  }
  let s: number;
  switch (tr) {
    case "null":
      s = 1;
      break;
    case "boolean":
      s = ref === obs ? 1 : 0;
      break;
    case "number":
      s = numberSimilarity(ref as number, obs as number);
      break;
    case "string":
      s = textSimilarity(ref as string, obs as string);
      break;
    case "array":
      return listSim(ref as Json[], obs as Json[], path, ctx, depth, record);
    default:
      return objectSim(ref as { [key: string]: Json }, obs as { [key: string]: Json }, path, ctx, depth, record);
  }
  if (record) note(ctx, { path, kind: "matched", score: s });
  return s;
}

function listSim(ref: Json[], obs: Json[], path: string, ctx: Ctx, depth: number, record: boolean): number {
  const longest = Math.max(ref.length, obs.length);
  if (longest === 0) return 1;
  if (ref.length === 0 || obs.length === 0) {
    if (record) for (let i = 0; i < ref.length; i += 1) note(ctx, { path: `${path}[${i}]`, kind: "missing", score: 0 });
    if (record) for (let j = 0; j < obs.length; j += 1) note(ctx, { path: `${path}[${j}]`, kind: "extra", score: 0 });
    return 0;
  }
  let pairs: [number, number][];
  if (ctx.ordered || longest > MAX_ASSIGN) {
    pairs = Array.from({ length: Math.min(ref.length, obs.length) }, (_, i) => [i, i] as [number, number]);
  } else {
    const matrix = ref.map((r, i) => obs.map((o) => sim(r, o, `${path}[${i}]`, ctx, depth + 1, false)));
    pairs = assign(matrix).pairs;
  }
  let total = 0;
  const matchedRef = new Set<number>();
  const matchedObs = new Set<number>();
  for (const [i, j] of pairs) {
    total += sim(ref[i] as Json, obs[j] as Json, `${path}[${i}]`, ctx, depth + 1, record);
    matchedRef.add(i);
    matchedObs.add(j);
  }
  if (record) {
    for (let i = 0; i < ref.length; i += 1) if (!matchedRef.has(i)) note(ctx, { path: `${path}[${i}]`, kind: "missing", score: 0 });
    for (let j = 0; j < obs.length; j += 1) if (!matchedObs.has(j)) note(ctx, { path: `${path}[${j}]`, kind: "extra", score: 0 });
  }
  return total / longest;
}

function objectSim(ref: { [key: string]: Json }, obs: { [key: string]: Json }, path: string, ctx: Ctx, depth: number, record: boolean): number {
  const rk = Object.keys(ref);
  const ok = Object.keys(obs);
  const longest = Math.max(rk.length, ok.length);
  if (longest === 0) return 1;
  const at = (k: string): string => (path === "" ? k : `${path}.${k}`);
  const matrix = rk.map((a) => ok.map((b) => (a === b ? KEY_WEIGHT : 0) + VALUE_WEIGHT * sim(ref[a] as Json, obs[b] as Json, at(a), ctx, depth + 1, false)));
  const { pairs } = assign(matrix);
  let total = 0;
  const matchedRef = new Set<number>();
  const matchedObs = new Set<number>();
  for (const [i, j] of pairs) {
    const a = rk[i] as string;
    const b = ok[j] as string;
    const value = sim(ref[a] as Json, obs[b] as Json, at(a), ctx, depth + 1, record);
    total += (a === b ? KEY_WEIGHT : 0) + VALUE_WEIGHT * value;
    matchedRef.add(i);
    matchedObs.add(j);
    if (record && a !== b) note(ctx, { path: at(a), kind: "matched", score: VALUE_WEIGHT * value, observedKey: b });
  }
  if (record) {
    for (let i = 0; i < rk.length; i += 1) if (!matchedRef.has(i)) note(ctx, { path: at(rk[i] as string), kind: "missing", score: 0 });
    for (let j = 0; j < ok.length; j += 1) if (!matchedObs.has(j)) note(ctx, { path: at(ok[j] as string), kind: "extra", score: 0 });
  }
  return total / longest;
}

/** Parse a tool output given as JSON text, or cut out of text around it: a fenced block, or the first complete object or list. */
export function parseJsonLoose(text: string): { value: Json; cut: boolean } | null {
  const t = text.trim();
  try {
    return { value: JSON.parse(t) as Json, cut: false };
  } catch {
    /* looked for inside the text */
  }
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(t);
  if (fence) {
    try {
      return { value: JSON.parse((fence[1] as string).trim()) as Json, cut: true };
    } catch {
      /* the fence did not hold JSON */
    }
  }
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const open = t[start] as string;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < t.length; i += 1) {
    const c = t[i] as string;
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(t.slice(start, i + 1)) as Json, cut: true };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const asValue = (x: unknown): { value: Json; cut: boolean } | null => {
  if (typeof x === "string") return parseJsonLoose(x);
  if (x === undefined) return null;
  return { value: x as Json, cut: false };
};

/** Score an output against a reference. Either may be a value or JSON text. */
export function alignJson(reference: unknown, observed: unknown, options: AlignOptions = {}): Alignment {
  const threshold = options.threshold ?? PASS_AT;
  const ref = asValue(reference);
  const obs = asValue(observed);
  const fallback = (why: string): Alignment => {
    const a = typeof reference === "string" ? reference : JSON.stringify(reference) ?? "";
    const b = typeof observed === "string" ? observed : JSON.stringify(observed) ?? "";
    const s = wordSimilarity(a, b);
    return { score: s, pass: s >= threshold, mode: "text", confidence: "low", note: why, details: [], detailsTruncated: false };
  };
  if (ref === null) return fallback("the reference is not JSON, so the two were compared by their words");
  if (obs === null) return fallback("the output is not JSON, so the two were compared by their words");
  const ctx: Ctx = { nodes: 0, details: [], truncated: false, coerce: options.coerceNumericStrings === true, ordered: options.orderedLists === true, tooLarge: false };
  const score = sim(ref.value, obs.value, "", ctx, 0, true);
  if (ctx.tooLarge) return fallback("the structure is too large or too deep to match field by field, so the two were compared by their words");
  return {
    score,
    pass: score >= threshold,
    mode: "structured",
    confidence: obs.cut ? "low" : "high",
    note: obs.cut ? "the JSON was cut out of text around it" : null,
    details: ctx.details,
    detailsTruncated: ctx.truncated,
  };
}

