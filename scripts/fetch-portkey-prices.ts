/**
 * Save a dated copy of Portkey's open price file for one provider, to compare against our own price book.
 * Usage: node scripts/fetch-portkey-prices.ts <provider> <output file>
 * Portkey's price database is MIT licensed (https://github.com/Portkey-AI/models). The file is stored whole, under
 * `models`, with where and when it was fetched and its hash; nothing is changed. Read it with `desk prices compare`.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const [provider, outPath] = process.argv.slice(2);
if (!provider || !outPath || !/^[a-z0-9-]+$/.test(provider)) {
  console.error("Usage: fetch-portkey-prices.ts <provider> <output file>");
  process.exit(2);
}
const url = `https://configs.portkey.ai/pricing/${provider}.json`;
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  console.error(`${url} answered ${response.status}`);
  process.exit(1);
}
const body = await response.text();
const models = JSON.parse(body) as unknown;
const snapshot = {
  snapshotId: `portkey-${provider}-${new Date().toISOString().slice(0, 10)}`,
  source: "Portkey-AI/models open price database",
  sourceUrl: url,
  fetchedAt: new Date().toISOString(),
  license: "MIT (Portkey-AI/models)",
  upstreamSha256: createHash("sha256").update(body).digest("hex"),
  note: "Prices are US cents per token, as Portkey states them. Kept whole and unchanged; desk prices compare converts the units.",
  models,
};
writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`wrote ${outPath}: ${Object.keys(models as object).length} entries, sha256 ${snapshot.upstreamSha256.slice(0, 12)}`);
