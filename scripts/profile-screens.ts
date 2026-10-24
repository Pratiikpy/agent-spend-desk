/**
 * Time the parts of the Bill and Brief screens on a ledger, to find what makes a large one slow to open.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/profile-screens.ts <ledger>
 */
import { openLedger } from "../src/desk/ledger/db.ts";
import { loadAutopsyCalls } from "../src/desk/autopsy/load.ts";
import { buildAutopsy } from "../src/desk/autopsy/engine.ts";
import { landingBreakdown } from "../src/desk/outcomes/breakdown.ts";
import { reconcile, summariseReconciliation } from "../src/desk/reconcile/reconcile.ts";
import { loadSnapshot } from "../src/desk/pricing/pricebook.ts";
import * as q from "../src/desk/ui/queries.ts";

const [ledger] = process.argv.slice(2);
if (!ledger) {
  console.error("Usage: profile-screens.ts <ledger>");
  process.exit(2);
}
const db = openLedger(ledger);
const snapshot = loadSnapshot("data/prices/anthropic-2026-10-24.json");
const ctx = { db, snapshot, policiesDir: "policies", mode: "own_logs" as const, ledgerName: "x", env: {}, nowMs: Date.now };

function timed<T>(label: string, fn: () => T): T {
  const t = performance.now();
  const out = fn();
  console.log(`${label.padEnd(34)} ${Math.round(performance.now() - t)} ms`);
  return out;
}

const span = q.parseRange("30", db);
console.log(`span ${span.sinceIso} to ${span.untilIso}`);
const calls = timed("loadAutopsyCalls (30 days)", () => loadAutopsyCalls(db, snapshot, span.sinceIso, span.untilIso));
console.log(`  ${calls.length} calls`);
timed("buildAutopsy", () => buildAutopsy(calls, Date.parse(span.sinceIso), Date.parse(span.untilIso)));
timed("landingBreakdown", () => landingBreakdown(db, span.sinceIso, span.untilIso));
const rows = timed("reconcile (all processes)", () => reconcile(db));
timed("summariseReconciliation", () => summariseReconciliation(rows));
timed("q.bill (whole)", () => q.bill(ctx, span));
timed("q.brief (whole)", () => q.brief(ctx));
