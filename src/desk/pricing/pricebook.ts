import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "../../runtime/canonical.ts";

/** Prices are integer micro-USD per million tokens, dated and sourced (spec 4.3). */
export interface PriceRow {
  inputPerMTokMicros: number;
  outputPerMTokMicros: number;
  cacheReadPerMTokMicros: number;
  cacheWrite5mPerMTokMicros: number;
  cacheWrite1hPerMTokMicros: number;
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

const PRICE_FIELDS: readonly (keyof PriceRow)[] = [
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
    for (const f of PRICE_FIELDS) {
      const v = row[f];
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
        throw new TypeError(`price snapshot model ${name}: ${f} must be a non-negative integer`);
      }
      parsed[f] = v;
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
