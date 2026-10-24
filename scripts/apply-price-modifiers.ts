/**
 * Add fast-mode prices and the US-only model list read from a vendor's pricing page to a dated price snapshot, writing a new snapshot.
 * Usage: npx tsx scripts/apply-price-modifiers.ts <base snapshot> <modifier supplement> <output snapshot>
 * The base file is not changed. See data/prices/official-modifiers-*.json for what a supplement holds.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { applyModifiers, loadSnapshot, type ModifierSupplement } from "../src/desk/pricing/pricebook.ts";

const [basePath, supplementPath, outPath] = process.argv.slice(2);
if (!basePath || !supplementPath || !outPath) {
  console.error("Usage: apply-price-modifiers.ts <base snapshot> <modifier supplement> <output snapshot>");
  process.exit(2);
}
const supplement = JSON.parse(readFileSync(supplementPath, "utf8")) as ModifierSupplement;
const next = applyModifiers(loadSnapshot(basePath), supplement);
writeFileSync(outPath, `${JSON.stringify(next, null, 2)}\n`);
const rows = Object.values(next.models);
console.log(`wrote ${outPath}: ${next.snapshotId}, ${rows.filter((m) => m.fast).length} model(s) with fast-mode prices, ${rows.filter((m) => m.usOnly).length} with the US-only multiplier`);
