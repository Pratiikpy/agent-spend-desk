import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOrExit } from "./args.ts";

import { findJsonlLogs } from "./ingest/discover.ts";
import { renderAutopsyText } from "./autopsy/card.ts";
import { buildAutopsy, heaviestWindow } from "./autopsy/engine.ts";
import { loadAutopsyCalls } from "./autopsy/load.ts";
import { openLedger } from "./ledger/db.ts";
import { landingBreakdown } from "./outcomes/breakdown.ts";
import { commandNames, helpText } from "./help.ts";
import { baseRef, commitsInRange, findRepoRoot } from "./outcomes/git.ts";
import { answerQuestion, askLoop, openQuestions, renderQuestion } from "./outcomes/questions.ts";
import { prCost, renderPr } from "./pr/cost.ts";
import { linkOutcomes } from "./outcomes/link.ts";
import { ingestClaudeCode } from "./ledger/ingest.ts";
import { formatUsd } from "./money.ts";
import { comparePrices, parsePortkey, renderComparison } from "./pricing/compare.ts";
import { readCleanupDays, renderRetention, retentionReport, scanLogs, scheduleSnippets } from "./retention/retention.ts";
import { priceSensitivity, renderSensitivity } from "./pricing/sensitivity.ts";
import { loadSnapshot } from "./pricing/pricebook.ts";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { recordApproval, regretCommand } from "./regret/command.ts";
import { lessonsCommand } from "./lessons/command.ts";
import { startUiServer } from "./ui/server.ts";
import { formatLine, prove, summarise } from "./prove/run.ts";
import { demo } from "./demo.ts";
import { canaryCommand, canaryRunCommand, canaryScheduleSnippet, OWN_RUNS, SAMPLE_RUNS } from "./canary/command.ts";
import { benchCommand } from "./bench/command.ts";
import { seatsCommand } from "./seats/command.ts";
import { routeCommand } from "./route/command.ts";
import { calibrateCommand } from "./calibrate/command.ts";
import { renderFeatureStatus, summariseFeatures, type FeatureRow } from "./status/features.ts";
import { openCodeAgent } from "./lab/agents.ts";
import { ingestCodex } from "./ledger/ingest-codex.ts";
import { ingestOpenCode } from "./ledger/ingest-opencode.ts";
import { ingestStatusline } from "./ledger/ingest-statusline.ts";
import { gauge, installSnippet, readSamples, statuslineLogPath } from "./statusline/statusline.ts";
import { fitLimit, groupLabel, leaveOneOut, limitGroups, observeWindows, renderLeaveOneOut, renderLimitFit } from "./limits/fit.ts";
import { renderRunway, runwayFromLedger } from "./limits/runway.ts";
import { reconcile, renderReconciliation, summariseReconciliation } from "./reconcile/reconcile.ts";
import { auditTask, renderAudit, writeExpected } from "./lab/audit.ts";
import { readRecords, runBatch } from "./lab/batch.ts";
import { evaluateProtocol, renderProtocol } from "./lab/protocol.ts";
import { renderSummary, summarise as summariseRuns } from "./lab/stats.ts";
import { loadTasks, type LabTask } from "./lab/task.ts";
import { forgetLedger, forgetPreview } from "./security/forget.ts";
import { invoicesCommand } from "./billing/command.ts";
import { alertsAdmin, runCheck, scheduleSnippet } from "./alerts/command.ts";
import { realDeps } from "./alerts/deliver.ts";
import { parseAmount } from "./billing/amounts.ts";
import { estimateTask, pastTasks, renderEstimate } from "./estimate/estimate.ts";
import { buildGauge, gaugeLine, renderGauge } from "./gauge/gauge.ts";
import { buildReview, renderReview, weekRange } from "./review/review.ts";
import { closeCommand } from "./close/command.ts";
import { billCommand } from "./bill/command.ts";
import { gatewayCommand } from "./gateway/command.ts";
import { otelCommand } from "./otel/command.ts";
import { discoverSources, renderSources } from "./adapters/registry.ts";
import { plansView, renderPlans } from "./limits/plans.ts";
import { approvalsCommand } from "./approvals/command.ts";
import { readHabit } from "./ui/queries.ts";
import { gaugeCachePath, newestMtimeMs, watchLogs, writeGaugeCache } from "./gauge/watch.ts";
import { backfillClaudeCodeFields } from "./ledger/backfill.ts";
import { wasteCommand } from "./waste/command.ts";
import { delegationCommand } from "./delegation/command.ts";
import { overheadCommand } from "./overhead/command.ts";
import { ladder, readResults, recordResults, renderLadder, TOOLS } from "./enforce/ladder.ts";
import { installedVersions } from "./enforce/version.ts";
import { testGatewayDoor, testHookContract, testHookLive } from "./enforce/selftest.ts";
import { costVersions, listRepricings, renderRepricing, repriceLedger } from "./pricing/reprice.ts";
import { refreshTasks } from "./tasks/assign.ts";
import { taskCommand } from "./tasks/command.ts";
import { appendMarker, defaultMarkerPath, readMarkers } from "./tasks/markers.ts";
import { summariseEgress } from "./security/egress.ts";

const regretPath = (): string => (sampleMode ? join(values.out, "regret.db") : "data/desk/regret.db");
const DOSSIER_PATHS = { dbPath: "data/desk/dossier.db", pendingDir: "data/desk/pending", outDir: "data/desk/dossiers" };
// The dated snapshot the sample, the benchmark and the recorded replays were built on; it is never edited.
const DEFAULT_SNAPSHOT = "data/prices/anthropic-litellm-2026-10-22.json";
// The snapshot for real logs: the same list prices plus the prompt-length tier Anthropic lists for Claude Haiku 5.5.
const LIVE_SNAPSHOT = "data/prices/anthropic-2026-10-24-modifiers.json";

// The gate has its own flags, so it takes the arguments before the general parser sees them.
if (process.argv[2] === "gate") {
  process.exit(await runGateCli(process.argv.slice(3)));
}

const { values, positionals } = parseOrExit({
  allowPositionals: true,
  options: {
    db: { type: "string", default: "data/desk/ledger.db" },
    "claude-dir": { type: "string", default: join(homedir(), ".claude", "projects") },
    "codex-dir": { type: "string", default: join(homedir(), ".codex", "sessions") },
    prices: { type: "string" },
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
    window: { type: "string", default: "21" },
    backtest: { type: "string" },
    "round-size": { type: "string" },
    rounds: { type: "string" },
    attempts: { type: "string" },
    "as-of": { type: "string" },
    tolerance: { type: "string", default: "0.1" },
    "price-strong": { type: "string" },
    "price-cheap": { type: "string" },
    set: { type: "string" },
    trials: { type: "string" },
    only: { type: "string" },
    results: { type: "string" },
    concurrency: { type: "string" },
    project: { type: "string" },
    before: { type: "string" },
    all: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    tasks: { type: "string", default: "lab/tasks/spike" },
    task: { type: "string" },
    write: { type: "boolean", default: false },
    repeats: { type: "string" },
    agent: { type: "string" },
    "lab-out": { type: "string", default: "data/lab" },
    name: { type: "string" },
    debug: { type: "boolean", default: false },
    second: { type: "string" },
    portkey: { type: "string" },
    reason: { type: "string" },
    vendor: { type: "string" },
    currency: { type: "string" },
    period: { type: "string" },
    month: { type: "string" },
    landed: { type: "string" },
    live: { type: "boolean", default: false },
    export: { type: "string" },
    "if-due": { type: "boolean", default: false },
    output: { type: "string" },
    sign: { type: "boolean", default: false },
    "ask-approval": { type: "boolean", default: false },
    by: { type: "string" },
    preview: { type: "boolean", default: false },
    call: { type: "string" },
    backfill: { type: "boolean", default: false },
    line: { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
    session: { type: "string" },
    type: { type: "string" },
    cap: { type: "string" },
    person: { type: "string" },
    limit: { type: "string" },
    week: { type: "string" },
    "gate-db": { type: "string", default: "data/desk/gate.db" },
    desktop: { type: "boolean", default: false },
    webhook: { type: "string" },
    "notify-command": { type: "string" },
    horizon: { type: "string", default: "7" },
    base: { type: "string" },
    head: { type: "string" },
    markdown: { type: "boolean", default: false },
    "no-ingest": { type: "boolean", default: false },
    at: { type: "string" },
    "opencode-db": { type: "string", default: join(homedir(), ".local", "share", "opencode", "opencode.db") },
    defects: { type: "string", default: "0" },
    "timeout-sec": { type: "string", default: "900" },
  },
});

const command = positionals[0] ?? "card";

/** A named location that is not there is an error, not an empty history. */
function requireLocation(path: string, where: string, flag: string): void {
  if (existsSync(path)) return;
  console.error(`desk ingest: nothing at ${path}. ${where}; ${flag} names another place.`);
  process.exit(1);
}

const NO_LIMIT_READINGS = "No plan-limit readings in this ledger. Codex: desk ingest --agent codex. Claude Code: desk statusline install, then desk ingest --agent statusline.";
const toolName = (tool: string): string => (tool === "claude_code" ? "Claude Code" : tool === "codex" ? "Codex" : tool);
/** The tools that have plan-limit readings: the one named with --agent, or every one that has any. */
function toolsWithLimits(ledger: ReturnType<typeof openLedger>, agent: string | undefined): string[] {
  const all = (ledger.prepare("SELECT DISTINCT tool FROM limit_sample ORDER BY tool").all() as unknown as { tool: string }[]).map((r) => r.tool);
  return agent === undefined ? all : all.filter((t) => t === agent);
}
const sampleMode = values.sample || process.env.SAMPLE_MODE === "true";
const pricesPath = values.prices ?? (sampleMode ? DEFAULT_SNAPSHOT : LIVE_SNAPSHOT);
const ledgerPath = sampleMode && !process.argv.includes("--db") && command !== "card" ? join(values.out, "ledger.db") : values.db;
// Commands that read the sample ledger build it first when it is not there, so `--sample` works from a fresh clone.
if (sampleMode && ["propose", "silos", "ask", "ui", "verify-answer", "bench", "seats", "calibrate", "regret", "lessons", "close"].includes(command) && !existsSync(ledgerPath)) {
  await runCard({ mode: "sample", claudeDir: "", dbPath: "", pricesPath: pricesPath, outDir: values["card-dir"], sampleDir: values.out, days: 14, hours: 5, repos: [], color: false, onProgress: (m) => console.error(m) });
}
const db = command === "card" || command === "status" || command === "lab" ? openLedger(":memory:") : openLedger(ledgerPath);

if (command === "help") {
  console.log(helpText());
} else if (command === "close") {
  if (!sampleMode && !values["no-ingest"] && existsSync(values["claude-dir"])) {
    const files = findJsonlLogs(values["claude-dir"]);
    console.error(`Reading what is new in ${files.length} log file${files.length === 1 ? "" : "s"}...`);
    await ingestClaudeCode(db, files, loadSnapshot(pricesPath));
  }
  loadDotenv(".env");
  const closed = await closeCommand({
    dbPath: ledgerPath,
    pricesPath,
    pricesDir: "data/prices",
    ...(values.month ? { month: values.month } : {}),
    now: new Date(),
    ...(values.policy?.[0] ? { policyPath: values.policy[0] } : {}),
    sign: values.sign,
    askApproval: values["ask-approval"],
    canaryRunsPath: sampleMode ? SAMPLE_RUNS : OWN_RUNS,
    sample: sampleMode,
    dossierDir: sampleMode ? join(values.out, "dossiers") : DOSSIER_PATHS.outDir,
    propose: { minUsd: values["min-usd"], cassetteDir: values.cassettes, record: values.record, sampleMode, personFromBranch: values["person-from-branch"], outDir: sampleMode ? join(values.out, "proposals") : "data/desk/proposals", env: process.env },
    proposeDossier: DOSSIER_PATHS,
    regretPath: regretPath(),
  });
  console.log(closed.text);
  if (!closed.ok) process.exitCode = 1;
} else if (command === "review") {
  if (values.week !== undefined) weekRange(values.week, 0); // a week that is not a week is refused before anything else is said
  const last = (db.prepare("SELECT MAX(ts) t FROM model_call").get() as { t: string | null }).t;
  if (last === null) console.log("Nothing to review: the ledger has no call. Run desk ingest first.");
  else {
    // The week asked for, else the last complete one; a ledger that ends before it is shown the week it ends in. A sample is dated in the future, so its week is where the sample ends.
    let range = weekRange(values.week, sampleMode ? Date.parse(last) + 7 * 86_400_000 : Date.now());
    if (values.week === undefined && Date.parse(last) < range.startMs) range = weekRange(undefined, Date.parse(last) + 7 * 86_400_000);
    const habit = sampleMode ? null : readHabit(DOSSIER_PATHS.dbPath, range.startMs, range.endMs, Date.now());
    console.log(renderReview(buildReview({ db, snapshot: loadSnapshot(pricesPath), range, markers: sampleMode ? [] : readMarkers(defaultMarkerPath()), approvals: habit }), values.markdown));
  }
} else if (command === "questions") {
  const sub = positionals[1];
  const relink = (): string => {
    const roots = (db.prepare("SELECT root FROM repo").all() as unknown as { root: string }[]).map((r) => r.root).filter((r) => existsSync(r));
    if (roots.length === 0) return "Landing is recomputed the next time it runs (desk landing).";
    linkOutcomes(db, roots, Date.now());
    return `Landing recomputed for ${roots.length} repositor${roots.length === 1 ? "y" : "ies"}.`;
  };
  if (sub === "answer") {
    const [id, a] = [positionals[2], positionals[3]?.toLowerCase()];
    if (!id || (a !== "yes" && a !== "no")) throw new Error("Use: desk questions answer <id> yes|no   (a skipped question stays open; just do not answer it)");
    const r = answerQuestion(db, id, a);
    console.log(r.kind === "unknown" ? `No single question matches ${id}. desk questions lists them.` : `Recorded: ${a}. ${relink()}`);
  } else if (sub === "ask") {
    const r = await askLoop(db, process.stdin, process.stdout);
    if (r.answered > 0) console.log(relink());
  } else {
    const limit = Number(values.limit ?? 10);
    const qs = openQuestions(db, 100_000);
    if (qs.length === 0) console.log("No open question. Nothing the Desk linked is in doubt.");
    else {
      console.log(`${qs.length} open question${qs.length === 1 ? "" : "s"} (the session that cost the most first):`);
      for (const [i, q] of qs.slice(0, limit).entries()) console.log(`
${renderQuestion(q, i + 1, qs.length)}`);
      console.log(`
Answer one with: desk questions answer <id> yes|no. Or go through them: desk questions ask. A skipped question stays open.`);
    }
  }
} else if (command === "alerts") {
  const sub = positionals[1];
  if (sub === "schedule") console.log(scheduleSnippet(process.cwd(), process.platform, values.policy?.[0] ? `--policy ${values.policy[0]}` : ""));
  else if (sub === "check") {
    const snapshot = loadSnapshot(pricesPath);
    const policyPath = values.policy?.[0];
    console.log(
      await runCheck({
        db, snapshot, now: new Date(), canaryRunsPath: sampleMode ? SAMPLE_RUNS : OWN_RUNS,
        gate: policyPath ? { policyPath, dbPath: values["gate-db"], person: values.person ?? process.env["USERNAME"] ?? process.env["USER"] ?? "owner" } : null,
        statusSamples: readSamples(statuslineLogPath()),
        channels: { terminal: true, desktop: values.desktop, ...(values.webhook ? { webhook: values.webhook } : {}), ...(values["notify-command"] ? { command: values["notify-command"].split(" ").filter((x) => x !== "") } : {}) },
        deps: realDeps(),
      }),
    );
  } else console.log(alertsAdmin(sub, positionals[2], db));
} else if (command === "estimate") {
  const cap = values.cap === undefined ? null : parseAmount(values.cap);
  if (values.cap !== undefined && (cap === null || cap.micros < 0)) throw new Error("--cap must be an amount in dollars, such as 25 or 25.50");
  // With no --repo the repository the person is in, if any, is the one asked about.
  const repo = values.repo?.[0] ?? findRepoRoot(process.cwd()) ?? undefined;
  console.log(renderEstimate(estimateTask(pastTasks(db, sampleMode ? [] : readMarkers(defaultMarkerPath())), { ...(values.type ? { type: values.type } : {}), ...(repo ? { repo } : {}), ...(cap ? { capMicros: cap.micros } : {}), nowMs: Date.now() })));
} else if (command === "gauge") {
  const snapshot = loadSnapshot(pricesPath);
  const hours = Number(values.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) throw new Error("--hours must be a number of hours between 0 and 168");
  const draw = async (): Promise<void> => {
    // A gauge of stale logs would say the work stopped. Read what was appended since the last read first (a few seconds), unless told not to.
    if (!sampleMode && !values["no-ingest"] && existsSync(values["claude-dir"])) {
      const files = findJsonlLogs(values["claude-dir"]);
      if (!values.watch) console.error(`Reading what is new in ${files.length} log file${files.length === 1 ? "" : "s"}...`);
      await ingestClaudeCode(db, files, snapshot);
    }
    const g = buildGauge(db, snapshot, { nowMs: Date.now(), hours, ...(values.session ? { sessionId: values.session } : {}), statusSamples: readSamples(statuslineLogPath()) });
    writeGaugeCache(gaugeCachePath(), g);
    if (values.watch && process.stdout.isTTY) process.stdout.write(String.fromCharCode(27) + "[2J" + String.fromCharCode(27) + "[H");
    console.log(values.line ? gaugeLine(g) : renderGauge(g));
  };
  if (values.watch) {
    requireLocation(values["claude-dir"], "Claude Code keeps its logs in ~/.claude/projects", "--claude-dir");
    let stop = false;
    process.on("SIGINT", () => {
      stop = true;
    });
    await watchLogs({ poll: () => newestMtimeMs(findJsonlLogs(values["claude-dir"])), refresh: draw, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs: 3000, shouldStop: () => stop });
  } else await draw();
} else if (command === "invoices") {
  console.log(
    invoicesCommand(positionals.slice(1), db, {
      ...(values.vendor ? { vendor: values.vendor } : {}),
      ...(values.currency ? { currency: values.currency } : {}),
      ...(values.period ? { period: values.period } : {}),
      ...(values.month ? { month: values.month } : {}),
      ...(values.by ? { by: values.by } : {}),
      ...(values.reason ? { reason: values.reason } : {}),
      ...(values.tolerance !== "0.1" ? { tolerancePct: Number(values.tolerance) } : {}),
    }),
  );
} else if (command === "task") {
  const markerPath = defaultMarkerPath();
  if (positionals[1] === "run") {
    const [label, ...program] = positionals.slice(2);
    if (label === undefined || program.length === 0) throw new Error("Use: desk task run <label> -- <command>");
    // The label is in force for sessions the command starts, in this folder, and ends when the command does.
    appendMarker(markerPath, { ts: new Date().toISOString(), label, project: process.cwd() });
    const run = spawnSync(program[0]!, program.slice(1), { stdio: "inherit", env: { ...process.env, DESK_TASK: label }, shell: process.platform === "win32" });
    appendMarker(markerPath, { ts: new Date().toISOString(), label: null, project: process.cwd() });
    process.exitCode = run.status ?? 1;
  } else {
    const markCommand = `node "${join(dirname(fileURLToPath(import.meta.url)), "tasks", "mark.ts")}"`;
    console.log(taskCommand(positionals.slice(1), { markerPath, cwd: process.cwd(), nowIso: new Date().toISOString(), env: process.env, db, markCommand }));
  }
} else if (command === "retention") {
  if (positionals[1] === "schedule") {
    console.log(scheduleSnippets(process.cwd(), process.platform));
  } else if (sampleMode) {
    console.log("Retention checks how old your own Claude Code log files are. The constructed sample's logs are generated when it is built, so there is nothing to check; run it without --sample on your own machine.");
  } else {
    const setting = readCleanupDays(join(homedir(), ".claude", "settings.json"));
    console.log(renderRetention(retentionReport({ files: scanLogs(values["claude-dir"]), db, retentionDays: setting.days, retentionSource: setting.source, now: new Date(), horizonDays: Number(values.horizon) })));
  }
} else if (command === "prices" && positionals[1] === "reprice") {
  const snapshot = loadSnapshot(pricesPath);
  const report = repriceLedger(db, snapshot, {
    reason: values.reason ?? `repriced to ${snapshot.snapshotId}`,
    ...(values.since ? { fromIso: new Date(values.since).toISOString() } : {}),
    ...(values.until ? { untilIso: new Date(values.until).toISOString() } : {}),
    preview: values.preview,
  });
  console.log(renderRepricing(report, values.preview));
} else if (command === "prices" && positionals[1] === "history") {
  if (values.call) {
    const versions = costVersions(db, values.call);
    if (versions.length === 0) console.log(`No cost for call ${values.call}.`);
    for (const v of versions) console.log(`${v.supersededBy === null ? "stands now " : `replaced ${v.supersededAt?.slice(0, 10)} (repricing ${v.supersededBy})`}  ${v.snapshotId ?? "no snapshot"}  ${v.class === "estimated" ? formatUsd(v.totalMicros ?? 0) : `unpriced: ${v.unpricedReason}`}${v.ruleIds.length > 0 ? `  rules: ${v.ruleIds.join(", ")}` : ""}`);
  } else {
    const rows = listRepricings(db, 20);
    if (rows.length === 0) console.log("No repricing yet. Every call still costs what the price book said when it was read.");
    for (const r of rows) console.log(`#${r.repricingId}  ${r.at.slice(0, 16).replace("T", " ")}  to ${r.toSnapshot}  ${r.callsChanged.toLocaleString("en-US")} calls  ${r.deltaMicros < 0 ? "-" : "+"}${formatUsd(Math.abs(r.deltaMicros))}  ${r.reason}`);
  }
} else if (command === "prices" && positionals[1] !== "compare") {
  throw new Error("Use: desk prices compare | reprice [--prices FILE] [--since D] [--until D] [--reason TEXT] [--preview] | history [--call ID]");
} else if (command === "prices") {
  const other = values.portkey ?? "data/prices/portkey-anthropic-2026-10-24.json";
  const body = JSON.parse(readFileSync(other, "utf8")) as { snapshotId?: string; fetchedAt?: string; models: unknown };
  const mine = loadSnapshot(pricesPath);
  console.log(`Our price book: ${mine.snapshotId}. Portkey: ${body.snapshotId ?? other}, fetched ${body.fetchedAt?.slice(0, 10) ?? "on an unknown date"}.`);
  const comparison = comparePrices(mine, parsePortkey(body.models));
  console.log(renderComparison(comparison, { ours: "our price book", theirs: "Portkey" }));
  const sensitivity = renderSensitivity(priceSensitivity(db, comparison), { ours: "our price book", theirs: "Portkey" });
  if (sensitivity !== "") console.log(`
${sensitivity}`);
} else if (command === "statusline") {
  if (positionals[1] === "install") {
    console.log("Add this to ~/.claude/settings.json (this command never edits Claude Code's settings). Claude Code then runs it for each status line update and sends the plan limits it knows:");
    console.log(installSnippet(process.cwd()));
    console.log(`Readings are kept in ${statuslineLogPath()} and read into the ledger with: desk ingest --agent statusline`);
  } else {
    const samples = readSamples(statuslineLogPath());
    const last = samples[samples.length - 1];
    console.log(last ? `${samples.length} readings in ${statuslineLogPath()}; the last: ${gauge(last, new Date(last.ts))} at ${last.ts}` : `No readings in ${statuslineLogPath()} yet. Turn the status line on with: desk statusline install`);
  }
} else if (command === "ingest" && values.agent === "statusline") {
  const r = ingestStatusline(db, readSamples(statuslineLogPath()));
  console.log(`read ${r.samples} status line samples; ${r.limitSamples} new plan-limit readings`);
} else if (command === "ingest" && values.agent === "opencode") {
  requireLocation(values["opencode-db"], "OpenCode keeps its history in a database at ~/.local/share/opencode/opencode.db", "--opencode-db");
  const r = await ingestOpenCode(db, values["opencode-db"], loadSnapshot(pricesPath));
  const skipped = Object.entries(r.skipped).map(([why, n]) => `${n} ${why}`).join(", ");
  console.log(`read ${r.messages} OpenCode messages; ${r.callsNew} new calls${skipped ? ` (left out: ${skipped})` : ""}`);
  console.log(`reasoning tokens counted apart from output: ${r.reasoningInOutput.confirmed} confirmed by the message's step totals, ${r.reasoningInOutput.contradicted} contradicted, ${r.reasoningInOutput.unchecked} not checkable`);
  if (r.unpricedCalls > 0) console.log(`unpriced: ${r.unpricedCalls} calls on ${Object.entries(r.unpricedModels).map(([m, why]) => `${m} (${why})`).join(", ")}`);
} else if (command === "ingest" && values.agent === "codex") {
  requireLocation(values["codex-dir"], "Codex keeps its sessions in ~/.codex/sessions", "--codex-dir");
  const files = findJsonlLogs(values["codex-dir"]);
  const r = await ingestCodex(db, files, loadSnapshot(pricesPath));
  console.log(`read ${r.files} Codex files (${r.unchangedFiles} unchanged, ${r.skippedFiles} with no session)`);
  console.log(`calls: ${r.callsNew} new, ${r.mergedRequests} stand for more than one request; ${r.replayedCalls} replayed from a parent session left out (${r.replayedTokens} tokens); ${r.limitSamples} plan-limit readings`);
  if (r.unpricedCalls > 0) console.log(`unpriced: ${r.unpricedCalls} calls on ${Object.entries(r.unpricedModels).map(([m, why]) => `${m} (${why})`).join(", ")}`);
} else if (command === "limits") {
  const tools = toolsWithLimits(db, values.agent);
  if (tools.length === 0) console.log(NO_LIMIT_READINGS);
  // Each plan and window length is its own limit: a free plan's monthly window and a paid plan's five-hour window are not pooled.
  for (const tool of tools) {
    for (const g of limitGroups(db, tool)) {
      const obs = observeWindows(db, { tool, windowMinutes: g.windowMinutes, planType: g.planType });
      const fit = fitLimit(obs);
      console.log(renderLimitFit(fit, `${toolName(tool)}, ${groupLabel(g)}`));
      if (!fit.abstained) console.log(renderLeaveOneOut(leaveOneOut(obs)));
    }
  }
} else if (command === "plans") {
  const at = values.at ? new Date(values.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("--at must be a date and time such as 2026-10-24T12:00:00Z");
  console.log(renderPlans(plansView(db, at, values.agent ? { tool: values.agent } : {})));
} else if (command === "runway") {
  const at = values.at ? new Date(values.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("--at must be a date and time such as 2026-10-24T12:00:00Z");
  const tools = toolsWithLimits(db, values.agent);
  if (tools.length === 0) console.log(NO_LIMIT_READINGS);
  for (const tool of tools) {
    // The plan in use is the plan of the newest reading; every window length that plan has is shown.
    const groups = limitGroups(db, tool, at);
    const current = groups[0];
    if (!current) continue;
    for (const g of groups.filter((x) => x.planType === current.planType).sort((a, b) => a.windowMinutes - b.windowMinutes)) {
      console.log(renderRunway(runwayFromLedger(db, { tool, windowMinutes: g.windowMinutes, planType: g.planType, now: at }), `${toolName(tool)}, ${groupLabel(g)}`));
    }
  }
} else if (command === "ingest" && values.backfill) {
  requireLocation(values["claude-dir"], "Claude Code keeps its logs in ~/.claude/projects", "--claude-dir");
  const r = await backfillClaudeCodeFields(db, findJsonlLogs(values["claude-dir"]));
  console.log(`read ${r.files} files, ${r.callsSeen} calls; filled inference_geo on ${r.inferenceGeoFilled} calls, the hash and truncation mark of ${r.resultFactsFilled} tool results, the client version of ${r.toolVersionFilled} calls and ${r.compactionsFilled} compactions, ${r.delegationsFilled} delegations, ${r.workflowsFilled} workflow runs and the agent of ${r.agentsNamed} logs. Nothing else was changed. Run desk prices reprice to price calls that say US-only.`);
} else if (command === "ingest") {
  requireLocation(values["claude-dir"], "Claude Code keeps its logs in ~/.claude/projects", "--claude-dir");
  const files = findJsonlLogs(values["claude-dir"]);
  const started = Date.now();
  const r = await ingestClaudeCode(db, files, loadSnapshot(pricesPath));
  refreshTasks(db, { useLabels: !sampleMode, markerPath: defaultMarkerPath() });
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
    pricesPath: pricesPath,
    outDir: values["card-dir"],
    sampleDir: values.out,
    days: Number(values.days),
    hours: Number(values.hours),
    repos: values.repo ?? [],
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    ...(process.stdout.columns ? { width: process.stdout.columns } : {}),
    // Progress goes to stderr so that the card on stdout can still be piped or saved.
    onProgress: (m) => console.error(m),
  });
  console.log(r.text);
  if (r.files.length > 0) console.log(`
written: ${r.files.join(", ")}`);
} else if (command === "propose") {
  loadDotenv(".env");
  console.log(
    await proposeCommand({
      dbPath: ledgerPath,
      pricesPath: pricesPath,
      policyPath: values.policy?.[0] ?? "policies/daily-cap.yaml",
      ...(values.split ? { split: values.split } : {}),
      minUsd: values["min-usd"],
      cassetteDir: values.cassettes,
      record: values.record,
      sampleMode,
      personFromBranch: values["person-from-branch"],
      outDir: "data/desk/proposals",
      ...(values.dossier ? { dossier: DOSSIER_PATHS, regretPath: regretPath() } : {}),
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
} else if (command === "sources") {
  console.log(renderSources(discoverSources(process.env)));
  console.log(String.fromCharCode(10) + "To try the Desk on a constructed month instead of your own logs: desk --sample");
} else if (command === "otel") {
  const r = otelCommand(db, positionals[1], positionals[2], loadSnapshot(pricesPath), { ...(values.since ? { since: values.since } : {}), ...(values.until ? { until: values.until } : {}), ...(values.output ? { output: values.output } : {}) });
  console.log(r.text);
  if (!r.ok) process.exitCode = 1;
} else if (command === "gateway") {
  const r = gatewayCommand(db, positionals[1], positionals[2], loadSnapshot(pricesPath));
  console.log(r.text);
  if (!r.ok) process.exitCode = 1;
} else if (command === "approvals") {
  const r = approvalsCommand(positionals[1], positionals[2], { dbPath: DOSSIER_PATHS.dbPath }, process.argv.includes("--days") ? { days: Number(values.days) } : {});
  console.log(r.text);
  if (!r.ok) process.exitCode = 1;
} else if (command === "approve") {
  const r = approve(positionals[1] ?? "", positionals[2] ?? "", DOSSIER_PATHS);
  if (r.ok) recordApproval(regretPath(), positionals[1] ?? "");
  console.log(r.text);
  if (!r.ok) process.exitCode = 1;
} else if (command === "ui") {
  const ui = await startUiServer({ ledgerPath: ledgerPath, pricesPath: pricesPath, policiesDir: "policies", port: Number(values.port), mode: sampleMode ? "sample" : "own_logs", ...(values.at ? { nowMs: () => new Date(values.at as string).getTime() } : {}), otherPricesPath: values.portkey ?? "data/prices/portkey-anthropic-2026-10-24.json" });
  console.log(`desk ui is running. Open this address (it carries a one-time token):
  ${ui.url}
Ctrl+C stops it.`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await ui.close();
} else if (command === "canary") {
  if (positionals[1] === "schedule") {
    console.log(canaryScheduleSnippet(process.cwd(), process.platform));
  } else if (positionals[1] === "run") {
    loadDotenv(".env");
    const ran = await canaryRunCommand({ runsPath: OWN_RUNS, env: process.env, today: new Date().toISOString().slice(0, 10), db, snapshot: loadSnapshot(pricesPath), ifDue: values["if-due"], preview: values.preview });
    console.log(ran.text);
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
  await demo({ sampleDir: values.out, prices: pricesPath, cassetteDir: values.cassettes, out: (t) => console.log(t) });
} else if (command === "seats") {
  loadDotenv(".env");
  console.log(await seatsCommand({ dbPath: ledgerPath, pricesPath: pricesPath, cassetteDir: values.cassettes, sampleMode, record: values.record, env: process.env, windowDays: Number(values.window), ...(values["as-of"] ? { asOf: values["as-of"] } : {}) }));
} else if (command === "regret") {
  loadDotenv(".env");
  console.log(await regretCommand({ dbPath: ledgerPath, pricesPath: pricesPath, policyPath: values.policy?.[0] ?? "policies/daily-cap.yaml", cassetteDir: values.cassettes, sampleMode, record: values.record, env: process.env, personFromBranch: values["person-from-branch"], regretPath: regretPath(), minUsd: values["min-usd"], ...(values.backtest ? { backtest: values.backtest } : {}) }));
} else if (command === "lessons") {
  loadDotenv(".env");
  console.log(
    await lessonsCommand({
      sub: positionals[1] ?? "",
      dbPath: ledgerPath,
      sampleMode,
      record: values.record,
      env: process.env,
      log: (line) => console.error(line),
      config: { ...(values["round-size"] ? { roundSize: Number(values["round-size"]) } : {}), ...(values.rounds ? { maxRounds: Number(values.rounds) } : {}), ...(values.attempts ? { attempts: Number(values.attempts) } : {}), ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}) },
    }),
  );
} else if (command === "route") {
  console.log(routeCommand({ runsPath: sampleMode ? SAMPLE_RUNS : OWN_RUNS, tolerance: Number(values.tolerance), ...(values["price-strong"] ? { priceStrong: values["price-strong"] } : {}), ...(values["price-cheap"] ? { priceCheap: values["price-cheap"] } : {}) }));
} else if (command === "calibrate") {
  console.log(calibrateCommand({ dbPath: ledgerPath, truthPath: join(values.out, "truth.json") }));
} else if (command === "bench") {
  loadDotenv(".env");
  console.log(await benchCommand({ sub: positionals[1] ?? "", dbPath: ledgerPath, sampleMode, record: values.record, arms: values.arm, split: values.split, set: values.set, trials: values.trials, only: values.only, results: values.results, concurrency: values.concurrency, env: process.env, log: (l) => console.error(l) }));
} else if (command === "bill") {
  const result = billCommand({
    db,
    snapshot: loadSnapshot(pricesPath),
    mode: sampleMode ? "sample" : "own_logs",
    ...(values.month ? { month: values.month } : {}),
    ...(values.since ? { since: values.since } : {}),
    ...(values.until ? { until: values.until } : {}),
    ...(values.export ? { exportAs: values.export as "csv" | "json" } : {}),
    ...(values.output ? { out: values.output } : {}),
  });
  console.log(result.text);
  if (!result.ok) process.exitCode = 1;
} else if (command === "enforcement") {
  const resultsPath = "data/desk/enforcement.json";
  if (positionals[1] === "test") {
    const prices = loadSnapshot(pricesPath);
    console.log("Running the surface tests: the hook against a real gate, and both gateway doors against a stand-in model endpoint.");
    const fresh = [await testHookContract(prices), await testGatewayDoor(prices, "openai"), await testGatewayDoor(prices, "anthropic")];
    if (values.live) {
      console.log("Running the real Claude Code three times (a few cents on the cheapest model).");
      fresh.push(await testHookLive(prices));
    }
    recordResults(resultsPath, fresh);
    for (const r of fresh) {
      console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.surface}${r.tool ? ` (${r.tool}${r.toolVersion ? ` ${r.toolVersion}` : ""})` : ""}, ${r.mode}`);
      for (const c of r.checks) console.log(`      ${c.passed ? "pass" : "FAIL"}  ${c.name}: ${c.detail}`);
    }
    if (fresh.some((r) => !r.passed)) process.exitCode = 1;
    console.log("");
  }
  const versions: Record<string, string> = {};
  for (const t of TOOLS) if (t.versionCommand) versions[t.tool] = t.versionCommand;
  console.log(renderLadder(ladder(readResults(resultsPath).results, installedVersions(versions))));
} else if (command === "overhead") {
  const result = overheadCommand({ db, snapshot: loadSnapshot(pricesPath), ...(values.month ? { month: values.month } : {}), ...(values.since ? { since: values.since } : {}), ...(values.until ? { until: values.until } : {}), ...(values.landed ? { landed: values.landed } : {}) });
  console.log(result.text);
  if (!result.ok) process.exitCode = 1;
} else if (command === "delegation") {
  const until = values.until ?? new Date().toISOString();
  const since = values.since ?? new Date(Date.parse(until) - Number(values.days) * 86_400_000).toISOString();
  const result = delegationCommand(db, { sinceIso: since, untilIso: until, ...(values.session ? { session: values.session } : {}) });
  console.log(result.text);
  if (!result.ok) process.exitCode = 1;
} else if (command === "waste") {
  const until = values.until ?? new Date().toISOString();
  const since = values.since ?? new Date(Date.parse(until) - Number(values.days) * 86_400_000).toISOString();
  console.log(wasteCommand(db, loadSnapshot(pricesPath), since, until).text);
} else if (command === "autopsy") {
  const snapshot = loadSnapshot(pricesPath);
  const until = values.until ?? new Date().toISOString();
  const since = values.since ?? new Date(Date.parse(until) - Number(values.days) * 86_400_000).toISOString();
  const calls = loadAutopsyCalls(db, snapshot, since, until);
  const window = heaviestWindow(calls, Number(values.hours));
  if (!window) {
    console.log("No priced calls in that period, so there is nothing to explain yet.");
  } else {
    console.log(renderAutopsyText(buildAutopsy(calls, window.startMs, window.endMs)));
  }
} else if (command === "pr") {
  const root = findRepoRoot(values.repo?.[0] ?? process.cwd());
  if (!root) throw new Error("not inside a git repository; run it in the repository or pass --repo <folder>");
  const base = values.base ?? baseRef(root);
  const head = values.head ?? "HEAD";
  const shas = commitsInRange(root, base, head);
  // Read what is new in the agents' logs and in the repository, so the change is tied to sessions that ended a minute ago.
  if (!values["no-ingest"]) await ingestClaudeCode(db, findJsonlLogs(values["claude-dir"]), loadSnapshot(pricesPath));
  linkOutcomes(db, [root], Date.now());
  const result = prCost(db, root, shas);
  console.log(values.markdown ? renderPr(result) : renderPr(result).replaceAll("**", "").replace(/^### /, ""));
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
  const sessions = replaySessionsFromLedger(db, loadSnapshot(pricesPath), since, until, { personFromBranch: sampleMode || values["person-from-branch"] });
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
      console.log(`  with a zero count not taken for zero, the chance a month blocks landed work is ${pct(t.pBlockedLandedSmoothed)}`);
      const covFile = "docs/verification/calibration/windtunnel.json";
      if (existsSync(covFile)) {
        const c = JSON.parse(readFileSync(covFile, "utf8")) as { trials: unknown[]; inside: number; coverage: number; low: number; high: number };
        console.log(`  measured on constructed samples with a change planted: the 90% range held the realized month in ${c.inside} of ${c.trials.length} (${pct(c.coverage)}, 95% interval ${pct(c.low)} to ${pct(c.high)}); read it as a screen, not a promise`);
      }
    }
  }
} else if (command === "reconcile") {
  const tolerance = process.argv.includes("--tolerance") ? Number(values.tolerance) : 0.02;
  const rows = reconcile(db, { tolerance });
  console.log(renderReconciliation(rows, summariseReconciliation(rows), { tolerance }));
} else if (command === "lab") {
  const sub = positionals[1] ?? "audit";
  if (sub === "audit") {
    const all = loadTasks(values.tasks);
    const picked = values.task ? all.filter((t) => t.id === values.task) : all;
    if (picked.length === 0) {
      console.error(values.task ? `no task named ${values.task} in ${values.tasks}` : `no tasks in ${values.tasks}`);
      process.exitCode = 2;
    } else {
      const results = picked.map((t) => auditTask(t));
      console.log(renderAudit(results));
      if (values.write) {
        for (const [i, r] of results.entries()) if (r.ok && r.expected) writeExpected(picked[i] as LabTask, r.expected);
        console.log(`wrote expected.json for ${results.filter((r) => r.ok).length} task(s)`);
      }
      if (results.some((r) => !r.ok)) process.exitCode = 1;
    }
  } else if (sub === "run") {
    loadDotenv(".env");
    const base = process.env["MODEL_BASE_URL"] ?? process.env["NVIDIA_BASE_URL"];
    const key = process.env["MODEL_API_KEY"] ?? process.env["NVIDIA_API_KEY"];
    const model = process.env["NEMOTRON_MODEL"];
    if (!base || !key || !model) {
      console.error("model not configured: set MODEL_BASE_URL, MODEL_API_KEY and NEMOTRON_MODEL in .env");
      process.exitCode = 2;
    } else if (!values.name) {
      console.error("give the batch a name with --name (it names the output folder and the run ids)");
      process.exitCode = 2;
    } else {
      const all = loadTasks(values.tasks);
      const picked = values.task ? all.filter((t) => values.task?.split(",").includes(t.id)) : all;
      const agent = openCodeAgent({ cacheDir: join(values["lab-out"], "agent-cache"), debug: values.debug });
      const done = await runBatch({
        name: values.name,
        tasks: picked,
        repeats: Number(values.repeats ?? 1),
        arm: values.arm ?? "baseline",
        agent,
        model,
        seed: Number(values.seed ?? 20261024),
        outDir: join(values["lab-out"], values.name),
        timeoutMs: Number(values["timeout-sec"]) * 1000,
        concurrency: Number(values.concurrency ?? 1),
        endpoint: { upstream: base, apiKey: key },
        log: (line) => console.log(line),
        retryInfra: values.yes,
      });
      const recorded = readRecords(join(values["lab-out"], values.name, "runs.jsonl"));
      console.log(`${done.length} runs this time; ${recorded.length} recorded in all`);
      console.log(renderSummary(summariseRuns(recorded)));
    }
  } else if (sub === "report") {
    if (!values.name) {
      console.error("give the batch name with --name");
      process.exitCode = 2;
    } else {
      const recorded = readRecords(join(values["lab-out"], values.name, "runs.jsonl"));
      console.log(recorded.length === 0 ? "no runs recorded under that name" : renderSummary(summariseRuns(recorded)));
      if (recorded.length > 0) {
        const second = values.second ? readRecords(join(values["lab-out"], values.second, "runs.jsonl")) : undefined;
        console.log("");
        console.log(renderProtocol(evaluateProtocol(recorded, { openTaskDefects: Number(values.defects), ...(second ? { second } : {}) })));
      }
    }
  } else {
    console.error("Use: lab audit | lab run --name <batch> | lab report --name <batch>");
    process.exitCode = 2;
  }
} else if (command === "forget") {
  const scope = { ...(values.project ? { project: values.project } : {}), ...(values.before ? { before: values.before } : {}), ...(values.all ? { all: true } : {}) };
  try {
    const would = forgetPreview(db, scope);
    if (!values.yes) {
      console.log(`forget would remove ${would.sessions} sessions and ${would.calls} model calls from ${ledgerPath}${values.all ? ", the cards, the egress log, the status line readings, the task labels and the gauge cache" : ""}. Nothing was changed. Add --yes to do it.`);
    } else {
      const done = forgetLedger(db, scope);
      if (values.all) {
        rmSync(values["card-dir"], { recursive: true, force: true });
        rmSync(process.env["DESK_EGRESS_LOG"] ?? "data/desk/egress.jsonl", { force: true });
        // The Desk's own files beside the ledger hold the same kinds of data: plan readings, the labels you set, the gauge.
        for (const f of [statuslineLogPath(), defaultMarkerPath(), gaugeCachePath()]) rmSync(f, { force: true });
      }
      console.log(`forgot ${done.sessions} sessions and ${done.calls} model calls from ${ledgerPath}${values.all ? "; removed the cards, the egress log, the status line readings, the task labels and the gauge cache" : ""}. The file was compacted, so removed text is not left in free pages.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  }
} else if (command === "egress") {
  const s = summariseEgress(process.env["DESK_EGRESS_LOG"] ?? "data/desk/egress.jsonl");
  if (s.requests === 0) console.log("No request has left this machine for a model since the egress log began (or it does not exist yet). Offline and sample runs send nothing.");
  else {
    console.log(`${s.requests} requests to a model, ${(s.bytes / 1024).toFixed(1)} KiB in all, from ${s.first} to ${s.last}; ${s.redactions} secret-shaped strings masked before sending.`);
    for (const h of s.hosts) console.log(`  ${h.host}: ${h.requests} requests, ${(h.bytes / 1024).toFixed(1)} KiB`);
    console.log(`  by role: ${s.roles.map((r) => `${r.role} ${r.requests}`).join(", ")}`);
    console.log("  The log holds a size and a hash for each request, never the text.");
  }
} else if (command === "status") {
  const rows = (JSON.parse(readFileSync("docs/design/desk/feature-status.json", "utf8")) as { features: FeatureRow[] }).features;
  const listing = [...readFileSync("docs/design/desk/02-feature-list.md", "utf8").matchAll(/^### (DF-\d{3}) (.+)$/gm)].map((m) => ({ id: m[1] as string, title: (m[2] as string).trim() }));
  const sum = summariseFeatures(rows);
  if (positionals[1] === "write") {
    writeFileSync("docs/design/desk/07-feature-status.md", renderFeatureStatus(rows, listing));
    console.log(`wrote docs/design/desk/07-feature-status.md: ${sum.built} built, ${sum.partial} partial, ${sum.absent} absent of ${rows.length}`);
  } else {
    console.log(`${sum.built} built, ${sum.partial} partial, ${sum.absent} absent of ${rows.length} specified features. The table is docs/design/desk/feature-status.json; "desk status write" writes the page.`);
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
  console.error(`unknown command "${command}". These are the commands: ${commandNames().join(" | ")}. "desk help" explains each.`);
  process.exitCode = 2;
}
db.close();
