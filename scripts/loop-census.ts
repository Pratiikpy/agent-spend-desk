// Count how many calls of each waste rule the replay bridge produces for a date range, and the money in them.
import { openLedger } from "../src/desk/ledger/db.ts";
import { loadSnapshot } from "../src/desk/pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../src/desk/replay/from-ledger.ts";

const [since = "2026-10-01", db = "data/desk/ledger.db"] = process.argv.slice(2);
const sessions = replaySessionsFromLedger(openLedger(db), loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"), since, "9999");
const by = new Map<string, { calls: number; micros: number }>();
let total = 0;
for (const s of sessions) for (const c of s.calls) {
  total += c.costMicros;
  const e = by.get(c.wasteRule) ?? { calls: 0, micros: 0 };
  e.calls += 1;
  e.micros += c.costMicros;
  by.set(c.wasteRule, e);
}
for (const [rule, e] of [...by].sort((a, b) => b[1].micros - a[1].micros)) console.log(rule.padEnd(12), String(e.calls).padStart(7), "calls", `$${(e.micros / 1e6).toFixed(2)}`.padStart(12), `${((e.micros / total) * 100).toFixed(1)}%`);
console.log("sessions", sessions.length, "total", `$${(total / 1e6).toFixed(2)}`);
