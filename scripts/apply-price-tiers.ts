/**
 * Add prompt-length tiers read from a vendor's pricing page to a dated price snapshot, writing a new snapshot.
 * Usage: node scripts/apply-price-tiers.ts <base snapshot> <tier supplement> <output snapshot>
 * The base file is not changed. See data/prices/official-tiers-*.json for what a supplement holds.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { applyTiers, loadSnapshot, type TierSupplement } from "../src/desk/pricing/pricebook.ts";

const [basePath, supplementPath, outPath] = process.argv.slice(2);
if (!basePath || !supplementPath || !outPath) {
  console.error("Usage: apply-price-tiers.ts <base snapshot> <tier supplement> <output snapshot>");
  process.exit(2);
}
const supplement = JSON.parse(readFileSync(supplementPath, "utf8")) as TierSupplement;
const next = applyTiers(loadSnapshot(basePath), supplement);
writeFileSync(outPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`wrote ${outPath}: ${next.snapshotId}, ${Object.values(next.models).filter((m) => m.longPrompt).length} model(s) with a prompt-length tier`);
