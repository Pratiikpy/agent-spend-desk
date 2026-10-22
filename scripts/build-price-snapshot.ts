/**
 * Build the committed price snapshot from LiteLLM's public price file (MIT licence, credit:
 * BerriAI/litellm, model_prices_and_context_window.json). Only first-party Anthropic entries are
 * kept. Prices are list prices per token upstream; here they become integer micro-USD per million
 * tokens. The snapshot is dated, hashed and sourced; it is an estimate of list price, not a bill.
 *
 *   npx tsx scripts/build-price-snapshot.ts [path-to-downloaded-json]   (downloads when no path is given)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { hashModels, type PriceRow } from "../src/desk/pricing/pricebook.ts";

const URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

async function loadUpstream(path: string | undefined): Promise<string> {
  if (path) return readFileSync(path, "utf8");
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return await res.text();
}

function perMTokMicros(perToken: unknown, what: string): number {
  if (typeof perToken !== "number" || !(perToken >= 0)) throw new Error(`missing or invalid price: ${what}`);
  return Math.round(perToken * 1e12);
}

const raw = await loadUpstream(process.argv[2]);
const upstream = JSON.parse(raw) as Record<string, Record<string, unknown>>;
const models: Record<string, PriceRow> = {};
for (const [name, entry] of Object.entries(upstream)) {
  if (entry["litellm_provider"] !== "anthropic" || !name.startsWith("claude")) continue;
  const input = entry["input_cost_per_token"];
  const output = entry["output_cost_per_token"];
  const read = entry["cache_read_input_token_cost"];
  const write5m = entry["cache_creation_input_token_cost"];
  if (input === undefined || output === undefined || read === undefined || write5m === undefined) continue; // incomplete upstream entry: stays unpriced
  const write1h = entry["cache_creation_input_token_cost_above_1hr"] ?? write5m;
  models[name] = {
    inputPerMTokMicros: perMTokMicros(input, `${name} input`),
    outputPerMTokMicros: perMTokMicros(output, `${name} output`),
    cacheReadPerMTokMicros: perMTokMicros(read, `${name} cache read`),
    cacheWrite5mPerMTokMicros: perMTokMicros(write5m, `${name} cache write 5m`),
    cacheWrite1hPerMTokMicros: perMTokMicros(write1h, `${name} cache write 1h`),
  };
}

const date = new Date().toISOString().slice(0, 10);
const snapshot = {
  snapshotId: `litellm-anthropic-${date}`,
  source: "BerriAI/litellm model_prices_and_context_window.json (first-party Anthropic entries)",
  sourceUrl: URL,
  fetchedAt: new Date().toISOString(),
  license: "MIT (BerriAI/litellm)",
  upstreamSha256: createHash("sha256").update(raw).digest("hex"),
  note: "List price estimates in integer micro-USD per million tokens. Not a billing receipt: plan discounts, batch rates and long-context tiers are not applied.",
  contentHash: hashModels(models),
  models,
};
mkdirSync("data/prices", { recursive: true });
const out = `data/prices/anthropic-litellm-${date}.json`;
writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`${Object.keys(models).length} models written to ${out}`);
