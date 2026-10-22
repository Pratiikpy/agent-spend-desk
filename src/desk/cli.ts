import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findJsonlLogs } from "./ingest/discover.ts";
import { renderAutopsyText } from "./autopsy/card.ts";
import { buildAutopsy, heaviestWindow } from "./autopsy/engine.ts";
import { loadAutopsyCalls } from "./autopsy/load.ts";
import { openLedger } from "./ledger/db.ts";
import { landingBreakdown } from "./outcomes/breakdown.ts";
import { findRepoRoot } from "./outcomes/git.ts";
import { linkOutcomes } from "./outcomes/link.ts";
import { ingestClaudeCode } from "./ledger/ingest.ts";
import { formatUsd } from "./money.ts";
import { loadSnapshot } from "./pricing/pricebook.ts";
import { readFileSync } from "node:fs";
import { parsePolicyYaml } from "./policy/parse.ts";
import { replaySessionsFromLedger } from "./replay/from-ledger.ts";
import { replayPolicy } from "./replay/policy-replay.ts";
import { windTunnel } from "./replay/wind-tunnel.ts";

const DEFAULT_SNAPSHOT = "data/prices/anthropic-litellm-2026-10-22.json";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string", default: "data/desk/ledger.db" },
    "claude-dir": { type: "string", default: join(homedir(), ".claude", "projects") },
    prices: { type: "string", default: DEFAULT_SNAPSHOT },
    since: { type: "string" },
    until: { type: "string" },
    hours: { type: "string", default: "5" },
    repo: { type: "string", multiple: true },
    days: { type: "string", default: "14" },
    policy: { type: "string", multiple: true },
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
} else if (command === "autopsy") {
  const snapshot = loadSnapshot(values.prices);
  const until = values.until ?? new Date().toISOString();
  const since = values.since ?? new Date(Date.parse(until) - Number(values.days) * 86_400_000).toISOString();
  const calls = loadAutopsyCalls(db, snapshot, since, until);
  const window = heaviestWindow(calls, Number(values.hours));
  if (!window) {
    console.log("No priced calls in that period, so there is nothing to explain yet.");
  } else {
    console.log(renderAutopsyText(buildAutopsy(calls, window.startMs, window.endMs)));
  }
} else if (command === "landing") {
  let repos = values.repo ?? [];
  if (repos.length === 0) {
    // No repository given: find the git roots of the folders the sessions ran in.
    const folders = db.prepare("SELECT DISTINCT project_path FROM session WHERE project_path IS NOT NULL").all() as unknown as { project_path: string }[];
    const roots = new Set<string>();
    for (const f of folders) {
      const root = findRepoRoot(f.project_path);
      if (root) roots.add(root);
    }
    repos = [...roots];
    console.log(`found ${repos.length} repositories from session folders`);
  }
  const report = linkOutcomes(db, repos, Date.now());
  console.log(`read ${report.repos} repositories, ${report.commits} commits; ${report.sessions} sessions, ${report.links} links`);
  const since = values.since ?? "0000-00-00";
  const until = values.until ?? "9999-99-99";
  const b = landingBreakdown(db, since, until);
  for (const state of ["kept", "merged", "committed", "reverted", "unlinked"] as const) {
    const x = b.byState[state];
    const share = b.totalMicros === 0 ? 0 : (x.micros / b.totalMicros) * 100;
    const note = state === "unlinked" ? "  (cannot be tied to a commit from these sources: unknowable, not waste)" : "";
    console.log(`${state.padEnd(10)} ${String(x.sessions).padStart(6)} sessions  ${formatUsd(x.micros).padStart(12)}  ${share.toFixed(1).padStart(5)}%${note}`);
  }
  console.log(`estimated list-price total ${formatUsd(b.totalMicros)}; weakly linked (low confidence): ${formatUsd(b.lowConfidenceMicros)}`);
} else if (command === "replay" || command === "tunnel") {
  const since = values.since ?? "0000-00-00";
  const until = values.until ?? "9999-99-99";
  const sessions = replaySessionsFromLedger(db, loadSnapshot(values.prices), since, until);
  for (const file of values.policy ?? []) {
    const policy = parsePolicyYaml(readFileSync(file, "utf8"));
    if (command === "replay") {
      const r = replayPolicy(policy, sessions);
      console.log(`${file}: ${sessions.length} sessions, total ${formatUsd(r.totalMicros)}; upper bound on spend avoided ${formatUsd(r.savedMicros)}, assuming a paused session does nothing more (${r.totalMicros === 0 ? 0 : ((r.savedMicros / r.totalMicros) * 100).toFixed(1)}%)`);
      console.log(`  paused ${r.paused.length} sessions, asked ${r.askedCalls} times; landed sessions that would have been paused: ${r.landedBlocked.length} of ${r.landedTotal}`);
    } else {
      const t = windTunnel(policy, sessions);
      if (t.status !== "ok") {
        console.log(`${file}: ${t.sessions} sessions is too little history to simulate`);
        continue;
      }
      const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
      console.log(`${file}: ${t.simulatedMonths} simulated months from ${t.sessions} sessions`);
      console.log(`  upper bound on spend avoided ${formatUsd(t.savedMicros.mid)} a month (90% interval ${formatUsd(t.savedMicros.low)} to ${formatUsd(t.savedMicros.high)}); blocks landed work in ${pct(t.pBlockedLanded.mid)} of months (${pct(t.pBlockedLanded.low)} to ${pct(t.pBlockedLanded.high)})`);
      if (t.historyMayNotPredict) console.log("  warning: the last four weeks differ from the earlier history; this month may not look like the past");
    }
  }
} else {
  console.error(`unknown command "${command}". Use: ingest | bill | autopsy | landing | replay | tunnel`);
  process.exitCode = 2;
}
db.close();
