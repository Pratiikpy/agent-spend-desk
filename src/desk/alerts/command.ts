import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { computeReconciliations } from "../billing/reconcile.ts";
import { DEFAULT_CONFIG, evaluateAt, makeContext } from "../canary/verdict.ts";
import { buildSeries, readRows } from "../canary/store.ts";
import { buildGauge } from "../gauge/gauge.ts";
import { Gate } from "../gate/gate.ts";
import { filePolicy } from "../gate/policy-source.ts";
import type { Ledger } from "../ledger/db.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import type { StatuslineSample } from "../statusline/statusline.ts";
import { deliver, type Channels, type DeliveryDeps } from "./deliver.ts";
import { applyResults, history, listStates, recordDelivery, setPaused, type RuleResult } from "./engine.ts";
import { canaryRules, capRules, idleRule, pauseRules, reconciliationRules, type CapStanding } from "./rules.ts";

export interface GateSource {
  policyPath: string;
  dbPath: string;
  person: string;
}

/** The caps and pauses the gate holds for one person, with the warn and ask fractions the policy sets (the lowest of its caps). */
export function readGateView(src: GateSource, prices: PriceSnapshot): { standings: CapStanding[]; people: { person: string; paused: boolean }[] } | null {
  if (!existsSync(src.dbPath) || !existsSync(src.policyPath)) return null;
  const db = new DatabaseSync(src.dbPath);
  try {
    const gate = new Gate({ db, prices, policy: filePolicy(src.policyPath), person: src.person });
    const policy = parsePolicyYaml(readFileSync(src.policyPath, "utf8"));
    const fractions = (window: "day" | "month"): { warnAt: number; askAt: number } | null => {
      const caps = policy.rules.flatMap((r) => (r.kind === "permit" && r.cap?.window === window ? [r.cap] : []));
      return caps.length === 0 ? null : { warnAt: Math.min(...caps.map((c) => c.warnAt)), askAt: Math.min(...caps.map((c) => c.askAt)) };
    };
    const standing = gate.budgetLeft({ person: src.person }).standing;
    const standings: CapStanding[] = standing.map((s) => ({ person: src.person, window: s.window as "day" | "month", limitMicros: s.limitMicros, spentMicros: s.spentMicros, reservedMicros: s.reservedMicros, ...(fractions(s.window as "day" | "month") ?? {}) }));
    return { standings, people: [{ person: src.person, paused: gate.isPaused(src.person) }] };
  } finally {
    db.close();
  }
}

export interface CheckInputs {
  db: Ledger;
  snapshot: PriceSnapshot;
  now: Date;
  canaryRunsPath: string;
  gate: GateSource | null;
  statusSamples?: readonly StatuslineSample[];
}

/** Every rule the Desk has, with what it could and could not read. */
export function collectRules(i: CheckInputs): { rules: RuleResult[]; notes: string[] } {
  const rules: RuleResult[] = [];
  const notes: string[] = [];
  if (i.gate === null) notes.push("Caps and pauses: not checked. Say where the gate is with --policy FILE (and --gate-db FILE if it is not data/desk/gate.db).");
  else {
    const view = readGateView(i.gate, i.snapshot);
    if (view === null) notes.push(`Caps and pauses: not checked, because ${i.gate.policyPath} or ${i.gate.dbPath} does not exist.`);
    else rules.push(...capRules(view.standings), ...pauseRules(view.people));
  }
  rules.push(idleRule(buildGauge(i.db, i.snapshot, { nowMs: i.now.getTime(), hours: 1, ...(i.statusSamples ? { statusSamples: i.statusSamples } : {}) })));

  const { rows } = readRows(i.canaryRunsPath);
  const series = buildSeries(rows);
  const verdict = series ? evaluateAt(makeContext(series), series.days, DEFAULT_CONFIG) : null;
  const lastRunDate = rows.length === 0 ? null : rows.map((r) => r.date).filter((d) => d !== "").sort().pop() ?? null;
  rules.push(...canaryRules({ verdict, lastRunDate, now: i.now }));

  const hasInvoices = (i.db.prepare("SELECT COUNT(*) n FROM invoice").get() as { n: number }).n > 0;
  if (hasInvoices) {
    const twoMonthsAgo = new Date(i.now.getTime() - 62 * 86_400_000).toISOString().slice(0, 7);
    rules.push(...reconciliationRules(computeReconciliations(i.db, { now: i.now }).filter((r) => r.period >= twoMonthsAgo)));
  }
  return { rules, notes };
}

export interface CheckOptions extends CheckInputs {
  channels: Channels;
  deps: DeliveryDeps;
}

/** One round: read every rule, decide what is worth saying, deliver it, and report. */
export async function runCheck(o: CheckOptions): Promise<string> {
  const { rules, notes } = collectRules(o);
  const r = applyResults(o.db, rules, o.now);
  const lines: string[] = [];
  for (const a of r.fired) {
    const delivered = await deliver(a, o.channels, o.deps);
    recordDelivery(o.db, a.alertId, delivered);
    for (const d of delivered) if (!d.ok) lines.push(`  ${d.channel} delivery failed: ${d.detail}`);
  }
  const unhealthy = rules.filter((x) => x.state === "WARNING" || x.state === "ALERT").length;
  lines.unshift(`${rules.length} rules checked: ${unhealthy} unhealthy, ${r.fired.length} alert${r.fired.length === 1 ? "" : "s"} sent${r.heldBack.length > 0 ? `, ${r.heldBack.length} held back by the once-a-day limit for a suite` : ""}${r.recovered.length > 0 ? `, ${r.recovered.length} recovered` : ""}${r.paused.length > 0 ? `, ${r.paused.length} paused` : ""}.`);
  for (const n of notes) lines.push(`  ${n}`);
  return lines.join("\n");
}

/** The text of `desk alerts list`, `history`, `pause` and `resume`. */
export function alertsAdmin(sub: string | undefined, arg: string | undefined, db: Ledger, now: Date = new Date()): string {
  if (sub === "pause" || sub === "resume") {
    if (!arg) throw new Error(`Use: desk alerts ${sub} <rule key>   (see desk alerts list for the keys)`);
    setPaused(db, arg, sub === "pause", now);
    return sub === "pause" ? `${arg} is paused: it is not evaluated and says nothing until resumed.` : `${arg} is resumed.`;
  }
  if (sub === "history") {
    const rows = history(db, 30);
    if (rows.length === 0) return "No alert has been decided yet. Run desk alerts check.";
    return rows.map((r) => `${r.ts.slice(0, 16).replace("T", " ")}  ${r.disposition.padEnd(22)} ${r.state.padEnd(7)} ${r.title}${r.delivered.length > 0 ? `  [${r.delivered.map((d) => `${d.channel}${d.ok ? "" : " FAILED"}`).join(", ")}]` : ""}`).join("\n");
  }
  if (sub === undefined || sub === "list") {
    const states = listStates(db);
    if (states.length === 0) return "No rule has been checked yet. Run desk alerts check.";
    return states.map((s) => `${s.state.padEnd(8)} ${s.key.padEnd(40)} since ${s.since.slice(0, 16).replace("T", " ")}${s.paused ? "  PAUSED" : ""}`).join("\n");
  }
  throw new Error("Use: desk alerts check [--policy FILE] [--desktop] [--webhook URL] [--notify-command PROGRAM] | list | history | pause KEY | resume KEY | schedule");
}

/** The command that runs the alerts every fifteen minutes, for the system's own scheduler. Printed, never installed. */
export function scheduleSnippet(repoRoot: string, platform: NodeJS.Platform, extraArgs = ""): string {
  const root = repoRoot.split("\\").join("/").replace(/\/$/, "");
  const args = extraArgs === "" ? "" : ` ${extraArgs}`;
  const note = "This only prints the command: desk does not install it. Run it yourself, and remove it with the matching delete command.";
  if (platform === "win32") {
    return [
      "Windows (Task Scheduler), every 15 minutes:",
      `schtasks /Create /SC MINUTE /MO 15 /TN "desk alerts" /TR "cmd /c cd /d ${root.replace(/\//g, "\\")} && npm run desk --silent -- alerts check${args}"`,
      'Remove it with: schtasks /Delete /TN "desk alerts" /F',
      note,
    ].join("\n");
  }
  if (platform === "darwin") {
    return [
      "macOS (launchd). Save as ~/Library/LaunchAgents/desk.alerts.plist, then run: launchctl load ~/Library/LaunchAgents/desk.alerts.plist",
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      "  <key>Label</key><string>desk.alerts</string>",
      `  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>cd ${root} &amp;&amp; npm run desk --silent -- alerts check${args}</string></array>`,
      "  <key>StartInterval</key><integer>900</integer>",
      "</dict></plist>",
      note,
    ].join("\n");
  }
  return ["Linux (cron), every 15 minutes. Add this line with crontab -e:", `*/15 * * * * cd ${root} && npm run desk --silent -- alerts check${args}`, note].join("\n");
}
