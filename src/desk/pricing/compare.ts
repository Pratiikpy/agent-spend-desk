import type { BasePrices, PriceSnapshot } from "./pricebook.ts";

/**
 * A second source of list prices, to check the first against. Portkey keeps an open price database (MIT,
 * https://github.com/Portkey-AI/models, served at https://configs.portkey.ai/pricing/{provider}.json) that is maintained
 * apart from LiteLLM's, so where the two disagree one of them is wrong, late or describes another plan, and the person
 * reading a bill should be told. This module reads Portkey's file into the same units as our price book and compares.
 * Portkey states a price in US cents per token; the price book holds integer micro-dollars per million tokens, so a
 * Portkey price times 1e10, rounded, is the same quantity.
 */
export type PartialPrices = Partial<BasePrices>;

export interface ForeignRow {
  base: PartialPrices;
  longPrompt?: { overPromptTokens: number; base: PartialPrices };
}

const FIELDS = ["inputPerMTokMicros", "outputPerMTokMicros", "cacheReadPerMTokMicros", "cacheWrite5mPerMTokMicros", "cacheWrite1hPerMTokMicros"] as const;

const LABEL: Record<(typeof FIELDS)[number] | "overPromptTokens", string> = {
  inputPerMTokMicros: "input",
  outputPerMTokMicros: "output",
  cacheReadPerMTokMicros: "cache read",
  cacheWrite5mPerMTokMicros: "cache write (5 minutes)",
  cacheWrite1hPerMTokMicros: "cache write (1 hour)",
  overPromptTokens: "long-prompt threshold",
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function centsToMicros(node: unknown): number | undefined {
  if (!isObject(node)) return undefined;
  const price = node["price"];
  return typeof price === "number" && Number.isFinite(price) && price >= 0 ? Math.round(price * 1e10) : undefined;
}

function readPayAsYouGo(node: unknown): PartialPrices {
  if (!isObject(node)) return {};
  const units = node["additional_units"];
  const out: PartialPrices = {};
  const set = <K extends keyof BasePrices>(key: K, value: number | undefined): void => {
    if (value !== undefined) out[key] = value;
  };
  set("inputPerMTokMicros", centsToMicros(node["request_token"]));
  set("outputPerMTokMicros", centsToMicros(node["response_token"]));
  set("cacheReadPerMTokMicros", centsToMicros(node["cache_read_input_token"]));
  set("cacheWrite5mPerMTokMicros", centsToMicros(node["cache_write_input_token"]));
  set("cacheWrite1hPerMTokMicros", isObject(units) ? centsToMicros(units["cache_write_1h"]) : undefined);
  return out;
}

function readLongTier(custom: unknown): ForeignRow["longPrompt"] {
  if (!isObject(custom) || !isObject(custom["context_tier_map"])) return undefined;
  const thresholds = Object.entries(custom["context_tier_map"])
    .map(([from, name]) => [Number(from), name] as const)
    .filter(([from, name]) => Number.isFinite(from) && from > 0 && typeof name === "string")
    .sort((a, b) => a[0] - b[0]);
  const first = thresholds[0];
  if (!first) return undefined;
  const regions = custom["regions"];
  const standard = isObject(regions) && isObject(regions["default"]) && isObject(regions["default"]["execution_modes"]) ? regions["default"]["execution_modes"]["standard"] : undefined;
  const tiers = isObject(standard) ? standard["context_tiers"] : undefined;
  const tier = isObject(tiers) ? tiers[first[1] as string] : undefined;
  const config = isObject(tier) && isObject(tier["pricing_config"]) ? tier["pricing_config"]["pay_as_you_go"] : undefined;
  const base = readPayAsYouGo(config);
  return Object.keys(base).length === 0 ? undefined : { overPromptTokens: first[0], base };
}

/** Portkey's file for one provider, as parsed JSON. Models with no token prices are left out. */
export function parsePortkey(raw: unknown): Record<string, ForeignRow> {
  if (!isObject(raw)) throw new TypeError("Portkey's price file must be a JSON object keyed by model");
  const out: Record<string, ForeignRow> = {};
  for (const [model, record] of Object.entries(raw)) {
    if (model === "default" || !isObject(record)) continue;
    const config = record["pricing_config"];
    const base = isObject(config) ? readPayAsYouGo(config["pay_as_you_go"]) : {};
    if (base.inputPerMTokMicros === undefined && base.outputPerMTokMicros === undefined) continue;
    const longPrompt = readLongTier(record["custom_pricing"]);
    out[model] = longPrompt ? { base, longPrompt } : { base };
  }
  return out;
}

export interface Disagreement {
  model: string;
  field: (typeof FIELDS)[number] | "overPromptTokens";
  tier: "base" | "long";
  ours: number;
  theirs: number;
  /** The gap as a share of the larger value. */
  relative: number;
}

export interface PriceComparison {
  /** Models both sources price, sorted. */
  compared: string[];
  /** Prices both give, and that match within the tolerance. */
  agreeing: number;
  disagreements: Disagreement[];
  /** Prices ours has and the other source leaves out, for models both list. */
  notGiven: number;
  onlyOurs: string[];
  onlyTheirs: string[];
  /** Models where ours prices long prompts higher and the other source states no such tier, and the reverse. */
  tierOnlyOurs: string[];
  tierOnlyTheirs: string[];
  /** For each model our price book prices by prompt length, the length above which the higher prices apply. */
  tierThresholds: Record<string, number>;
  tolerance: number;
}

export function comparePrices(ours: PriceSnapshot, theirs: Readonly<Record<string, ForeignRow>>, opts: { tolerance?: number } = {}): PriceComparison {
  const tolerance = opts.tolerance ?? 0.001;
  const compared = Object.keys(ours.models).filter((m) => m in theirs).sort();
  const disagreements: Disagreement[] = [];
  const tierOnlyOurs: string[] = [];
  const tierOnlyTheirs: string[] = [];
  const tierThresholds: Record<string, number> = {};
  let agreeing = 0;
  let notGiven = 0;

  const judge = (model: string, tier: "base" | "long", field: Disagreement["field"], a: number, b: number | undefined): void => {
    if (b === undefined) {
      notGiven += 1;
      return;
    }
    const relative = a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
    if (relative <= tolerance) agreeing += 1;
    else disagreements.push({ model, field, tier, ours: a, theirs: b, relative });
  };

  for (const model of compared) {
    const mine = ours.models[model]!;
    const other = theirs[model]!;
    if (mine.longPrompt) tierThresholds[model] = mine.longPrompt.overPromptTokens;
    for (const f of FIELDS) judge(model, "base", f, mine[f], other.base[f]);
    if (mine.longPrompt && other.longPrompt) {
      if (mine.longPrompt.overPromptTokens !== other.longPrompt.overPromptTokens) {
        disagreements.push({ model, field: "overPromptTokens", tier: "long", ours: mine.longPrompt.overPromptTokens, theirs: other.longPrompt.overPromptTokens, relative: Math.abs(mine.longPrompt.overPromptTokens - other.longPrompt.overPromptTokens) / Math.max(mine.longPrompt.overPromptTokens, other.longPrompt.overPromptTokens) });
      }
      for (const f of FIELDS) judge(model, "long", f, mine.longPrompt[f], other.longPrompt.base[f]);
    } else if (mine.longPrompt) tierOnlyOurs.push(model);
    else if (other.longPrompt) tierOnlyTheirs.push(model);
  }
  return {
    compared,
    agreeing,
    disagreements,
    notGiven,
    onlyOurs: Object.keys(ours.models).filter((m) => !(m in theirs)).sort(),
    onlyTheirs: Object.keys(theirs).filter((m) => !(m in ours.models)).sort(),
    tierOnlyOurs,
    tierOnlyTheirs,
    tierThresholds,
    tolerance,
  };
}

function names(list: readonly string[]): string {
  return list.length <= 8 ? list.join(", ") : `${list.slice(0, 8).join(", ")} and ${list.length - 8} more`;
}

function dollars(micros: number): string {
  const s = (micros / 1e6).toFixed(4).replace(/0+$/, "");
  return `$${s.endsWith(".") ? `${s}00` : s.split(".")[1]!.length === 1 ? `${s}0` : s}`;
}

export function renderComparison(c: PriceComparison, labels: { ours: string; theirs: string }): string {
  const lines: string[] = [];
  const total = c.agreeing + c.disagreements.length;
  lines.push(`${c.compared.length} models are priced by both ${labels.ours} and ${labels.theirs}: ${c.agreeing} of ${total} prices agree (tolerance ${Math.round(c.tolerance * 1000) / 10}%)${c.notGiven > 0 ? `; ${c.notGiven} are given by ${labels.ours} only` : ""}.`);
  if (c.disagreements.length === 0) lines.push("No disagreement.");
  for (const d of c.disagreements) {
    const unit = d.field === "overPromptTokens" ? (n: number) => `${n.toLocaleString("en-US")} tokens` : (n: number) => `${dollars(n)} per million tokens`;
    lines.push(`- ${d.model}${d.tier === "long" ? " (prompts over the long-prompt threshold)" : ""}, ${LABEL[d.field]}: ${unit(d.ours)} in ${labels.ours}, ${unit(d.theirs)} in ${labels.theirs} (${Math.round(d.relative * 100)}% apart).`);
  }
  if (c.tierOnlyOurs.length > 0) lines.push(`Long-prompt prices in ${labels.ours} only: ${names(c.tierOnlyOurs)}.`);
  if (c.tierOnlyTheirs.length > 0) lines.push(`Long-prompt prices in ${labels.theirs} only: ${names(c.tierOnlyTheirs)}.`);
  if (c.onlyOurs.length > 0) lines.push(`Only in ${labels.ours}: ${names(c.onlyOurs)}.`);
  if (c.onlyTheirs.length > 0) lines.push(`Only in ${labels.theirs}: ${names(c.onlyTheirs)}.`);
  lines.push("A disagreement does not say which is right. Settle it against the vendor's own pricing page and an invoice, and until then treat the cost of the affected tokens as uncertain by the gap shown.");
  return lines.join("\n");
}
