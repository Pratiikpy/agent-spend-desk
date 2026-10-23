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
import { existsSync, readFileSync } from "node:fs";
import { parsePolicyYaml } from "./policy/parse.ts";
import { replaySessionsFromLedger } from "./replay/from-ledger.ts";
import { replayPolicy } from "./replay/policy-replay.ts";
import { windTunnel } from "./replay/wind-tunnel.ts";
import { buildSample, sampleLogsDir, sampleReposDir } from "./sample/gen.ts";
import { runCard } from "./card/run.ts";
import { loadDotenv } from "./env.ts";
import { proposeCommand } from "./propose/command.ts";
import { silosCommand, silosSeed } from "./silo/command.ts";
import { askCommand, rememberCommand, verifyAnswerCommand } from "./ask/command.ts";
import { runGateCli } from "./gate/cli.ts";
import { approve } from "./dossier/command.ts";
import { startUiServer } from "./ui/server.ts";
import { formatLine, prove, summarise } from "./prove/run.ts";
import { demo } from "./demo.ts";
import { canaryCommand, canaryRunCommand, OWN_RUNS, SAMPLE_RUNS } from "./canary/command.ts";
import { benchCommand } from "./bench/command.ts";

const DOSSIER_PATHS = { dbPath: "data/desk/dossier.db", pendingDir: "data/desk/pending", outDir: "data/desk/dossiers" };
const DEFAULT_SNAPSHOT = "data/prices/anthropic-litellm-2026-10-22.json";

// The gate has its own flags, so it takes the arguments before the general parser sees them.
if (process.argv[2] === "gate") {
  process.exit(await runGateCli(process.argv.slice(3)));
}

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
    out: { type: "string", default: "data/desk/sample" },
    seed: { type: "string" },
    months: { type: "string" },
    sample: { type: "boolean", default: false },
    "card-dir": { type: "string", default: "data/desk/card" },
    split: { type: "string" },
    "min-usd": { type: "string", default: "2.00" },
    cassettes: { type: "string", default: "data/sample/cassettes" },
    record: { type: "boolean", default: false },
    "person-from-branch": { type: "boolean", default: false },
    "no-zetaris": { type: "boolean", default: false },
    dossier: { type: "boolean", default: false },
    port: { type: "string", default: "0" },
    ablate: { type: "string" },
    "no-model": { type: "boolean", default: false },
    "memory-dir": { type: "string", default: "data/desk/memory" },
    outcome: { type: "boolean", default: false },
    arm: { type: "string" },
    only: { type: "string" },
    results: { type: "string" },
    concurrency: { type: "string" },
  },
});

const command = positionals[0] ?? "card";
const sampleMode = values.sample || process.env.SAMPLE_MODE === "true";
const ledgerPath = sampleMode && !process.argv.includes("--db") && command !== "card" ? join(values.out, "ledger.db") : values.db;
// Commands that read the sample ledger build it first when it is not there, so `--sample` works from a fresh clone.
if (sampleMode && ["propose", "silos", "ask", "ui", "verify-answer", "bench"].includes(command) && !existsSync(ledgerPath)) {
  await runCard({ mode: "sample", claudeDir: "", dbPath: "", pricesPath: values.prices, outDir: values["card-dir"], sampleDir: values.out, days: 14, hours: 5, repos: [], color: false });
}
const db = command === "card" ? openLedger(":memory:") : openLedger(ledgerPath);

if (command === "ingest") {
  const files = findJsonlLogs(values["claude-dir"]);
  const started = Date.now();
  const r = await ingestClaudeCode(db, files, loadSnapshot(values.prices));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`read ${r.files} files, ${r.linesRead} lines in ${seconds}s`);
  console.log(`calls: ${r.callsNew} new, ${r.callsMerged} extra content-block lines merged, ${r.usageConflicts} input/cache conflicts, ${r.outputRegressions} output regressions`);
  console.log(`skipped: ${r.malformedLines} malformed lines, ${r.truncatedTails} unfinished last lines`);
  if (r.unpricedCalls > 0) console.log(`unpriced: ${r.unpricedCalls} calls on ${Object.entries(r.unpricedModels).map(([m, why]) => `${m} (${why})`).join(", ")}`);
} else if (command === "card") {
  const r = await runCard({
    mode: sampleMode ? "sample" : "own_logs",
    claudeDir: values["claude-dir"],
    dbPath: values.db,
    pricesPath: values.prices,
    outDir: values["card-dir"],
    sampleDir: values.out,
    days: Number(values.days),
    hours: Number(values.hours),
    repos: values.repo ?? [],
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    ...(process.stdout.columns ? { width: process.stdout.columns } : {}),
  });
  console.log(r.text);
  if (r.files.length > 0) console.log(`
written: ${r.files.join(", ")}`);
} else if (command === "propose") {
  loadDotenv(".env");
  console.log(
    await proposeCommand({
      dbPath: ledgerPath,
      pricesPath: values.prices,
      policyPath: values.policy?.[0] ?? "policies/daily-cap.yaml",
      ...(values.split ? { split: values.split } : {}),
      minUsd: values["min-usd"],
      cassetteDir: values.cassettes,
      record: values.record,
      sampleMode,
      personFromBranch: values["person-from-branch"],
      outDir: "data/desk/proposals",
      ...(values.dossier ? { dossier: DOSSIER_PATHS } : {}),
      env: process.env,
    }),
  );
} else if (command === "silos") {
  loadDotenv(".env");
  if (positionals[1] === "seed") {
    console.log(silosSeed(ledgerPath, join(values.out, "silos")));
  } else {
    console.log(
      await silosCommand({ dbPath: ledgerPath, cassetteDir: values.cassettes, sampleMode, record: values.record, disabled: values["no-zetaris"], env: process.env }),
    );
  }
} else if (command === "ask") {
  loadDotenv(".env");
  console.log(
    await askCommand({ dbPath: ledgerPath, question: positionals.slice(1).join(" "), ablate: values.ablate, noModel: values["no-model"], record: values.record, sampleMode, cassetteDir: values.cassettes, memoryDir: values["memory-dir"], env: process.env }),
  );
} else if (command === "remember") {
  console.log(await rememberCommand({ memoryDir: values["memory-dir"], text: positionals.slice(1).join(" "), outcome: values.outcome }));
} else if (command === "verify-answer") {
  console.log(await verifyAnswerCommand(ledgerPath, positionals[1] ?? "", values["memory-dir"]));
} else if (command === "approve") {
  const r = approve(positionals[1] ?? "", positionals[2] ?? "", DOSSIER_PATHS);
  console.log(r.text);
  if (!r.ok) process.exitCode = 1;
} else if (command === "ui") {
  const ui = await startUiServer({ ledgerPath: ledgerPath, pricesPath: values.prices, policiesDir: "policies", port: Number(values.port), mode: sampleMode ? "sample" : "own_logs" });
  console.log(`desk ui is running. Open this address (it carries a one-time token):
  ${ui.url}
Ctrl+C stops it.`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await ui.close();
} else if (command === "canary") {
  if (positionals[1] === "run") {
    loadDotenv(".env");
    console.log(await canaryRunCommand({ runsPath: OWN_RUNS, env: process.env, today: new Date().toISOString().slice(0, 10) }));
  } else {
    console.log(canaryCommand({ runsPath: sampleMode ? SAMPLE_RUNS : OWN_RUNS, sample: sampleMode }).text);
  }
} else if (command === "prove") {
  const lines = await prove({ dir: "data/desk/prove", ...(positionals[1] ? { only: positionals[1] } : {}), log: (l) => console.log(formatLine(l)) });
  const t = summarise(lines);
  console.log(`
${t.pass} PASS, ${t.fail} FAIL, ${t.notRun} NOT RUN. NOT RUN is not a pass: it names a check the spec asks for that is not built or not recorded.`);
  process.exitCode = t.exit;
} else if (command === "demo") {
  await demo({ sampleDir: values.out, prices: values.prices, cassetteDir: values.cassettes, out: (t) => console.log(t) });
} else if (command === "bench") {
  loadDotenv(".env");
  console.log(await benchCommand({ sub: positionals[1] ?? "", dbPath: ledgerPath, sampleMode, record: values.record, arms: values.arm, split: values.split, only: values.only, results: values.results, concurrency: values.concurrency, env: process.env, log: (l) => console.error(l) }));
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
  const sessions = replaySessionsFromLedger(db, loadSnapshot(values.prices), since, until, { personFromBranch: sampleMode || values["person-from-branch"] });
  for (const file of values.policy ?? []) {
    const policy = parsePolicyYaml(readFileSync(file, "utf8"));
    if (command === "replay") {
      const r = replayPolicy(policy, sessions);
      console.log(`${file}: ${sessions.length} sessions, total ${formatUsd(r.totalMicros)}; upper bound on spend avoided ${formatUsd(r.savedMicros)}, assuming a paused session does nothing more (${r.totalMicros === 0 ? 0 : ((r.savedMicros / r.totalMicros) * 100).toFixed(1)}%)`);
      const byDefault = r.paused.filter((p) => p.verdictReason.includes("default deny")).length;
      console.log(`  paused ${r.paused.length} sessions (${byDefault} because no permit matched, ${r.paused.length - byDefault} by a rule), asked ${r.askedCalls} times; landed sessions that would have been paused: ${r.landedBlocked.length} of ${r.landedTotal}`);
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
} else if (command === "sample") {
  if (positionals[1] !== "build") {
    console.error("Use: sample build [--out dir] [--seed n] [--months n]");
    process.exit(2);
  }
  const started = Date.now();
  const truth = buildSample({ outDir: values.out, ...(values.seed ? { seed: Number(values.seed) } : {}), ...(values.months ? { months: Number(values.months) } : {}) });
  console.log(`built a constructed scenario: ${truth.sessions.length} sessions over ${truth.months} months in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`logs: ${sampleLogsDir(values.out)}`);
  console.log(`repos: ${sampleReposDir(values.out)}`);
} else {
  console.error(`unknown command "${command}". Use: card | propose | silos | ask | remember | verify-answer | gate | approve | ui | canary | bench | prove | demo | ingest | bill | autopsy | landing | replay | tunnel | sample build`);
  process.exitCode = 2;
}
db.close();
