import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "../../runtime/canonical.ts";

/** Prices are integer micro-USD per million tokens, dated and sourced (spec 4.3). */
export interface BasePrices {
  inputPerMTokMicros: number;
  outputPerMTokMicros: number;
  cacheReadPerMTokMicros: number;
  cacheWrite5mPerMTokMicros: number;
  cacheWrite1hPerMTokMicros: number;
}

/**
 * Higher prices for a request whose prompt is over a length. Anthropic prices Claude Haiku 5.5 this way: a request whose
 * prompt (fresh input, cache reads and cache writes together) is over 100,000 tokens pays the higher prices on all of
 * its tokens, each request on its own. Every other current model has one set of prices.
 */
export interface LongPromptTier extends BasePrices {
  overPromptTokens: number;
}

export interface PriceRow extends BasePrices {
  longPrompt?: LongPromptTier;
}

/** The length of a request's prompt: every input token, whether fresh, read from cache or written to it. */
export function promptTokens(t: { inputTokens: number; cacheReadTokens: number; cacheWrite5mTokens: number; cacheWrite1hTokens: number }): number {
  return t.inputTokens + t.cacheReadTokens + t.cacheWrite5mTokens + t.cacheWrite1hTokens;
}

export interface PriceSnapshot {
  snapshotId: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  license: string;
  upstreamSha256: string;
  note: string;
  contentHash: string;
  models: Readonly<Record<string, PriceRow>>;
}

export type PriceResolution =
  | { kind: "priced"; row: PriceRow; matchedAs: string; ladderStep: "exact" | "date-suffix" | "at-suffix" | "case" }
  | { kind: "unpriced"; reason: "alias-without-version" | "unknown-model" | "empty-model" };

const ALIASES_WITHOUT_VERSION = new Set(["sonnet", "haiku", "opus", "fable", "mythos"]);

const PRICE_FIELDS: readonly (keyof BasePrices)[] = [
  "inputPerMTokMicros",
  "outputPerMTokMicros",
  "cacheReadPerMTokMicros",
  "cacheWrite5mPerMTokMicros",
  "cacheWrite1hPerMTokMicros",
];

export function hashModels(models: Readonly<Record<string, PriceRow>>): string {
  return createHash("sha256").update(canonicalJson(models)).digest("hex");
}

export function parseSnapshot(raw: unknown): PriceSnapshot {
  if (typeof raw !== "object" || raw === null) throw new TypeError("price snapshot must be an object");
  const o = raw as Record<string, unknown>;
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v.length === 0) throw new TypeError(`price snapshot field ${k} must be a non-empty string`);
    return v;
  };
  const modelsRaw = o["models"];
  if (typeof modelsRaw !== "object" || modelsRaw === null) throw new TypeError("price snapshot models must be an object");
  const models: Record<string, PriceRow> = {};
  for (const [name, rowRaw] of Object.entries(modelsRaw as Record<string, unknown>)) {
    const row = rowRaw as Record<string, unknown>;
    const parsed = {} as PriceRow;
    const readPrices = (from: Record<string, unknown>, label: string): BasePrices => {
      const out = {} as BasePrices;
      for (const f of PRICE_FIELDS) {
        const v = from[f];
        if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
          throw new TypeError(`price snapshot model ${label}: ${f} must be a non-negative integer`);
        }
        out[f] = v;
      }
      return out;
    };
    Object.assign(parsed, readPrices(row, name));
    const tier = row["longPrompt"];
    if (tier !== undefined) {
      if (typeof tier !== "object" || tier === null || Array.isArray(tier)) throw new TypeError(`price snapshot model ${name}: longPrompt must be an object`);
      const t = tier as Record<string, unknown>;
      const over = t["overPromptTokens"];
      if (typeof over !== "number" || !Number.isSafeInteger(over) || over < 1) throw new TypeError(`price snapshot model ${name}: longPrompt.overPromptTokens must be a positive integer`);
      parsed.longPrompt = { overPromptTokens: over, ...readPrices(t, `${name} longPrompt`) };
    }
    models[name] = parsed;
  }
  const snapshot: PriceSnapshot = {
    snapshotId: str("snapshotId"),
    source: str("source"),
    sourceUrl: str("sourceUrl"),
    fetchedAt: str("fetchedAt"),
    license: str("license"),
    upstreamSha256: str("upstreamSha256"),
    note: str("note"),
    contentHash: str("contentHash"),
    models,
  };
  if (hashModels(models) !== snapshot.contentHash) {
    throw new Error(`price snapshot ${snapshot.snapshotId}: contentHash does not match its models (file was edited)`);
  }
  return snapshot;
}

/** Prompt-length tiers read from a vendor's pricing page, with where they came from. */
export interface TierSupplement {
  supplementId: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  /** SHA-256 of the page text the tiers were read from. */
  pageSha256: string;
  tiers: Readonly<Record<string, LongPromptTier>>;
}

/**
 * A new snapshot that is the given one plus prompt-length tiers. The id says both parts, the content hash is recomputed, and
 * the note names the page the tiers were read from, so a figure priced with them can be traced to a source. The base
 * snapshot is left exactly as it was: snapshots are dated and never edited.
 */
export function applyTiers(base: PriceSnapshot, sup: TierSupplement): PriceSnapshot {
  const models: Record<string, PriceRow> = { ...base.models };
  for (const [name, tier] of Object.entries(sup.tiers)) {
    const row = models[name];
    if (!row) throw new Error(`tier supplement ${sup.supplementId} names ${name}, which snapshot ${base.snapshotId} does not price`);
    models[name] = { ...row, longPrompt: tier };
  }
  return parseSnapshot({
    snapshotId: `${base.snapshotId}+${sup.supplementId}`,
    source: `${base.source}; prompt-length tiers from ${sup.source}`,
    sourceUrl: base.sourceUrl,
    fetchedAt: base.fetchedAt,
    license: base.license,
    upstreamSha256: base.upstreamSha256,
    note: `${base.note} Prompt-length tiers from ${sup.source} (${sup.sourceUrl}), page text sha256 ${sup.pageSha256}, read ${sup.fetchedAt}: a request whose prompt is over the stated length pays the higher prices on all its tokens.`,
    contentHash: hashModels(models),
    models,
  });
}

export function loadSnapshot(path: string): PriceSnapshot {
  return parseSnapshot(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Resolve a logged model name to a price row. The ladder is exact, then a trailing
 * `-YYYYMMDD` date, then an `@version` suffix, then lower case. A bare alias such as
 * "sonnet" is never guessed into a version: it is unpriced with that reason, so the
 * tokens are still counted and the screen says why (spec 6.1, 6.3).
 */
export function resolvePrice(snapshot: PriceSnapshot, model: string | null | undefined): PriceResolution {
  const name = (model ?? "").trim();
  if (name.length === 0) return { kind: "unpriced", reason: "empty-model" };
  const tries: { candidate: string; step: "exact" | "date-suffix" | "at-suffix" | "case" }[] = [
    { candidate: name, step: "exact" },
    { candidate: name.replace(/-\d{8}$/, ""), step: "date-suffix" },
    { candidate: name.replace(/@.*$/, ""), step: "at-suffix" },
    { candidate: name.toLowerCase(), step: "case" },
  ];
  for (const t of tries) {
    const row = snapshot.models[t.candidate];
    if (row) return { kind: "priced", row, matchedAs: t.candidate, ladderStep: t.step };
  }
  if (ALIASES_WITHOUT_VERSION.has(name.toLowerCase())) return { kind: "unpriced", reason: "alias-without-version" };
  return { kind: "unpriced", reason: "unknown-model" };
}
