import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findJsonlLogs } from "./ingest/discover.ts";
import { openLedger } from "./ledger/db.ts";
import { ingestClaudeCode } from "./ledger/ingest.ts";
import { formatUsd } from "./money.ts";
import { loadSnapshot } from "./pricing/pricebook.ts";

const DEFAULT_SNAPSHOT = "data/prices/anthropic-litellm-2026-10-22.json";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string", default: "data/desk/ledger.db" },
    "claude-dir": { type: "string", default: join(homedir(), ".claude", "projects") },
    prices: { type: "string", default: DEFAULT_SNAPSHOT },
    since: { type: "string" },
    until: { type: "string" },
  },
});

const command = positionals[0] ?? "bill";
const db = openLedger(values.db);

if (command === "ingest") {
  const files = findJsonlLogs(values["claude-dir"]);
  const started = Date.now();
  const r = await ingestClaudeCode(db, files, loadSnapshot(values.prices));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`read ${r.files} files, ${r.linesRead} lines in ${seconds}s`);
  console.log(`calls: ${r.callsNew} new, ${r.callsMerged} extra content-block lines merged, ${r.usageConflicts} input/cache conflicts, ${r.outputRegressions} output regressions`);
  console.log(`skipped: ${r.malformedLines} malformed lines, ${r.truncatedTails} unfinished last lines`);
  if (r.unpricedCalls > 0) console.log(`unpriced: ${r.unpricedCalls} calls on ${Object.entries(r.unpricedModels).map(([m, why]) => `${m} (${why})`).join(", ")}`);
} else if (command === "bill") {
  const since = values.since ?? "0000-00-00";
  const until = values.until ?? "9999-99-99";
  const rows = db
    .prepare(
      `SELECT model, SUM(calls) calls, SUM(input_tokens) i, SUM(output_tokens) o, SUM(cache_read_tokens) cr, SUM(cache_write_tokens) cw,
              SUM(estimated_micros) micros, SUM(unpriced_calls) unpriced
       FROM v_cost_by_day_model WHERE day >= ? AND day <= ? GROUP BY model ORDER BY micros DESC`,
    )
    .all(since, until) as { model: string; calls: number; i: number; o: number; cr: number; cw: number; micros: number | null; unpriced: number }[];
  let total = 0;
  for (const r of rows) {
    total += r.micros ?? 0;
    const cost = r.micros === null ? "unpriced" : formatUsd(r.micros);
    console.log(`${r.model.padEnd(22)} ${String(r.calls).padStart(7)} calls  in ${r.i}  out ${r.o}  cache-read ${r.cr}  cache-write ${r.cw}  ${cost}${r.unpriced > 0 && r.micros !== null ? `  (+${r.unpriced} unpriced)` : ""}`);
  }
  console.log(`estimated list-price total: ${formatUsd(total)}  (an estimate from logged tokens, not a bill)`);
} else {
  console.error(`unknown command "${command}". Use: ingest | bill`);
  process.exitCode = 2;
}
db.close();
