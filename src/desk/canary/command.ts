import { existsSync } from "node:fs";
import { basename } from "node:path";

import type { ModelPort } from "../agents/model.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { buildSeries, readRows, servedChanges } from "./store.ts";
import { DEFAULT_CONFIG, earliestCallDay, evaluateAt, makeContext, type Verdict } from "./verdict.ts";
import { appendSkip, archiveBaseline, decide, DEFAULT_DAILY_BUDGET_USD, DEFAULT_REPEATS, estimateRunCost, MIN_SCORED_SHARE, planReadings, skipsPathFor, type SkipKind } from "./schedule.ts";
import { controlTasks, harnessHash, TASKS, type CanaryTask } from "./tasks.ts";
import type { RunRow } from "./runner.ts";

export const SAMPLE_RUNS = "data/sample/canary/runs.jsonl";
export const OWN_RUNS = "data/desk/canary/runs.jsonl";

const pts = (x: number): string => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} points`;
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

export const WORDS: Record<Verdict["verdict"], string> = {
  regressed: "Regressed",
  improved: "Improved",
  steady: "Steady",
  inconclusive: "No call",
  harness_or_platform: "The platform or the harness moved, not the model",
};

export const REASONS: Record<string, string> = {
  too_early: "too early to call",
  too_few_tasks: "too few tasks have scores",
  no_comparison: "nothing to compare yet",
  invalid_data: "the data is not usable",
  error_rate: "too many attempts produced no score",
  regression_rule_met: "every condition of the regression rule held in two consecutive windows",
  improvement_rule_met: "every condition of the improvement rule held in two consecutive windows",
  harness_or_agent_version_changed: "the harness or the agent version changed, so scores are not comparable",
  control_arm_moved: "the control arm moved too, which points at the platform",
  no_control_arm: "no control arm, so a platform event cannot be ruled out",
  rests_on_one_task: "the change rests on one task",
  interval_wide: "the interval is too wide to call",
  below_minimum_effect: "the change is smaller than the smallest change that can be called",
  within_detectable_range: "the change is within what noise could produce",
  not_in_both_windows: "the change did not show in both windows",
  held_out_half_disagrees: "the held-out half of the tasks disagrees",
};

export interface CanaryReport {
  text: string;
  verdict: Verdict | null;
}

/** Read stored runs and say what the statistic says, with what it cannot say. */
export function canaryCommand(o: { runsPath: string; sample: boolean; day?: number }): CanaryReport {
  if (!existsSync(o.runsPath)) {
    return { verdict: null, text: `No canary runs yet at ${o.runsPath}.\nA canary needs ${DEFAULT_CONFIG.baselineDays} baseline days and two ${DEFAULT_CONFIG.windowDays}-day windows before it can call anything: day ${earliestCallDay()} at the earliest, then it speaks. Run \`desk canary run\` daily, or SAMPLE_MODE=true to read the recorded scenario.` };
  }
  const { rows, skipped } = readRows(o.runsPath);
  const series = buildSeries(rows);
  if (!series) return { verdict: null, text: "The canary file holds no usable runs." };
  const ctx = makeContext(series);
  const day = Math.min(o.day ?? series.days, series.days);
  const v = evaluateAt(ctx, day);
  const lines: string[] = [];
  const dates = new Map(rows.map((r) => [r.day, r.date]));
  const at = dates.get(day) ?? "";
  lines.push(`Canary, day ${day}${at ? ` (${at})` : ""}: ${WORDS[v.verdict]}`);
  lines.push(`  ${REASONS[v.reason] ?? v.reason}`);
  if (v.delta !== null && v.ci) {
    lines.push(`  change against the baseline: ${pts(v.delta)} (99% interval ${pts(v.ci.low)} to ${pts(v.ci.high)}) on ${v.tasksUsed} tasks`);
    if (v.mde !== null && v.mdeVerdict !== null) lines.push(`  smallest change one window can detect (80% power): ${(v.mde * 100).toFixed(1)} points; for a two-window call: ${(v.mdeVerdict * 100).toFixed(1)} points`);
  }
  if (v.control.length > 0) {
    const last = v.control[v.control.length - 1]!.reading;
    lines.push(`  control arm: ${last.moved ? `MOVED ${pts(last.delta)} (${last.tasks} tasks)` : `flat (${pts(last.delta)}, 95% interval ${pts(last.low)} to ${pts(last.high)}, ${last.tasks} tasks)`}`);
  } else lines.push(series.control ? "  control arm: not read, the rule stopped before it was needed" : "  control arm: none in this data");
  lines.push(`  harness: ${v.harnessUnchanged ? "unchanged" : "CHANGED"} (${harnessHash().slice(0, 19)}); error rate ${v.errorRate === null ? "n/a" : pct(v.errorRate)}`);
  const signs = v.heldOutSigns.filter((s): s is number => s !== null).map((s) => (s < 0 ? "down" : s > 0 ? "up" : "flat"));
  if (signs.length > 0) lines.push(`  held-out half of the tasks: ${signs.join(", ")}`);
  if (v.flip.checked) lines.push(`  one-task check: ${v.flip.holdsWithout ? "the call holds without the most influential task" : `the call rests on ${v.flip.task}`}`);
  const changes = servedChanges(rows, "primary");
  if (changes.length > 0) {
    const c = changes[0]!;
    lines.push(`  consistent with, not caused by: the served model id reported by the endpoint changed on day ${c.day}${c.date ? ` (${c.date})` : ""} from ${c.from} to ${c.to}`);
  }
  const ctl = servedChanges(rows, "control");
  if (ctl.length > 0) lines.push(`  the control arm's served model also changed on day ${ctl[0]!.day}`);
  if (v.reason === "too_early") {
    // Say on which day the first call becomes possible, not only how many days after the pin: "the baseline completes on 3 November".
    const first = dates.get(1);
    const ms = first ? Date.parse(`${first}T00:00:00Z`) : NaN;
    if (!Number.isNaN(ms)) {
      const when = new Date(ms + (v.earliestCallDay - 1) * 86_400_000).toISOString().slice(0, 10);
      lines.push(`  the first call is possible on ${when} (day ${v.earliestCallDay}), if a run is recorded each day until then`);
    }
  }
  for (const n of v.notes) lines.push(`  note: ${n}`);

  // The score line the verdict rests on, so the card can be read without the statistic.
  const mean = (arm: RunRow["arm"], from: number, to: number): string => {
    const r = rows.filter((x) => x.arm === arm && x.day >= from && x.day <= to && x.score !== null);
    return r.length === 0 ? "n/a" : pct(r.reduce((s, x) => s + (x.score as number), 0) / r.length);
  };
  const b = DEFAULT_CONFIG.baselineDays;
  const w = DEFAULT_CONFIG.windowDays;
  lines.push("");
  lines.push("  pass rate        baseline (days 1-" + b + ")   window before   latest window");
  for (const arm of ["primary", "control"] as const) {
    lines.push(`  ${arm.padEnd(16)} ${mean(arm, 1, b).padEnd(24)} ${mean(arm, day - 2 * w + 1, day - w).padEnd(15)} ${mean(arm, day - w + 1, day)}`);
  }
  lines.push("");
  lines.push(`${TASKS.length} tasks, one real run per day and arm; dates are assigned.${o.sample ? " Constructed scenario: the primary arm's model was switched on purpose while recording, so there is a regression to find." : ""}`);
  if (skipped > 0) lines.push(`${skipped} unreadable lines in the file were skipped.`);
  lines.push(`A new regression cannot be called before day ${earliestCallDay()} after the baseline is pinned. The statistic and its measured false-alarm rate and power: docs/verification/canary-simulation.md.`);
  return { text: lines.join("\n"), verdict: v };
}

export interface CanaryRunOptions {
  runsPath: string;
  env: Record<string, string | undefined>;
  /** Today in UTC as YYYY-MM-DD. */
  today: string;
  /** The ledger, read for the owner's plan readings. Without it the plan guard cannot apply and the run says so. */
  db?: Ledger | null;
  /** Prices, for the budget guard. */
  snapshot?: PriceSnapshot | null;
  /** The hourly mode: apply the guards (plan window, budget), record why a day was skipped, retry at the next call. A manual run ignores the guards but never mixes a changed harness into an old series. */
  ifDue?: boolean;
  /** Say what would happen and change nothing. */
  preview?: boolean;
  nowMs?: number;
  /** Test hook: where the model comes from. */
  makePort?: (model: string) => ModelPort;
  /** Pause before an attempt is repeated, in milliseconds (default 3000). */
  retryPauseMs?: number;
}

export interface CanaryRunResult {
  text: string;
  /** What was done: run, skipped, done (already run), baseline (a new series was started and run), or nothing (no model). */
  outcome: "run" | "skipped" | "done" | "no_model" | "preview";
}

const repeatsFrom = (raw: string | undefined, def: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : def;
};

/**
 * Run today's pack: the primary arm on the model the owner's agents use (five repeats of every task), and a control arm when a second
 * model is named (three tasks, three repeats). Day 1 is the first day of a series; a day that already has rows is not run twice. The
 * guards and the reasons for skipping are in schedule.ts.
 */
export async function canaryRunCommand(o: CanaryRunOptions): Promise<CanaryRunResult> {
  const baseUrl = o.env["MODEL_BASE_URL"] ?? o.env["NVIDIA_BASE_URL"];
  const apiKey = o.env["MODEL_API_KEY"] ?? o.env["NVIDIA_API_KEY"];
  const primary = o.env["NEMOTRON_MODEL"] ?? o.env["NVIDIA_MODEL"];
  const skipsPath = skipsPathFor(o.runsPath);
  const nowIso = new Date(o.nowMs ?? Date.now()).toISOString();
  const skip = (kind: SkipKind, reason: string): void => {
    if (o.ifDue && !o.preview) appendSkip(skipsPath, { date: o.today, at: nowIso, kind, reason });
  };
  if (!o.makePort && (!baseUrl || !apiKey || !primary)) {
    const reason = "The canary needs a model to run: set MODEL_BASE_URL, MODEL_API_KEY and NEMOTRON_MODEL (or the NVIDIA_ names). It never runs without one and never invents a score.";
    skip("no_model", reason);
    return { outcome: "no_model", text: reason };
  }
  const control = o.env["CANARY_CONTROL_MODEL"];
  const primaryModel = primary ?? "primary";
  const repeats = { primary: repeatsFrom(o.env["CANARY_REPEATS"], DEFAULT_REPEATS.primary), control: repeatsFrom(o.env["CANARY_CONTROL_REPEATS"], DEFAULT_REPEATS.control) };
  const existing = readRows(o.runsPath).rows;
  const plannedRows = TASKS.length * repeats.primary + (control ? controlTasks().length * repeats.control : 0);
  const capEnv = o.env["CANARY_DAILY_BUDGET_USD"];
  const capMicros = capEnv === "none" ? null : Number.isFinite(Number(capEnv ?? DEFAULT_DAILY_BUDGET_USD)) && capEnv !== "" ? Math.round(Number(capEnv ?? DEFAULT_DAILY_BUDGET_USD) * 1e6) : Math.round(DEFAULT_DAILY_BUDGET_USD * 1e6);
  const guards = o.ifDue === true;
  const decision = decide({
    today: o.today,
    rows: existing,
    plan: guards && o.db ? planReadings(o.db, o.nowMs ?? Date.now()) : { fiveHourPct: null, weeklyPct: null },
    budget: { capMicros: guards ? capMicros : null, estimateMicros: guards && o.snapshot ? estimateRunCost(existing.filter((r) => r.arm === "primary"), plannedRows, o.snapshot, primaryModel) : null },
  });
  if (o.preview) return { outcome: "preview", text: `Canary, preview for ${o.today}: ${decision.action === "skip" ? `would skip (${decision.kind}). ${decision.reason}` : decision.action === "run" ? `would run ${TASKS.length * repeats.primary} primary rows${control ? ` and ${controlTasks().length * repeats.control} control rows` : ""}. ${decision.note ? `Note: ${decision.note}.` : ""}` : decision.action === "new_baseline" ? `would start a new baseline. ${decision.reason}` : decision.reason}`.trim() };
  if (decision.action === "done") return { outcome: "done", text: decision.reason };
  if (decision.action === "skip") {
    skip(decision.kind, decision.reason);
    return { outcome: "skipped", text: `Canary skipped for ${o.today}. ${decision.reason}${o.ifDue ? " The reason is recorded." : ""}` };
  }
  const lines: string[] = [];
  if (decision.action === "new_baseline") {
    const kept = archiveBaseline(o.runsPath, o.today);
    lines.push(`${decision.reason}${kept ? ` The old runs are kept as ${basename(kept)}.` : ""}`);
  }
  const rows = decision.action === "new_baseline" ? [] : existing;
  const first = rows.length === 0 ? o.today : rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0]!.date);
  const day = Math.round((Date.parse(o.today) - Date.parse(first)) / 86_400_000) + 1;
  if (!(day >= 1)) return { outcome: "skipped", text: `Today (${o.today}) is before the first canary day (${first}).` };
  const { OpenAiPort } = await import("../agents/model.ts");
  const { runPack, probeCache } = await import("./runner.ts");
  const { appendRows } = await import("./store.ts");
  const portFor = (model: string): ModelPort => (o.makePort ? o.makePort(model) : new OpenAiPort({ baseUrl: baseUrl as string, apiKey: apiKey as string, model }));
  const arms: [RunRow["arm"], string, readonly CanaryTask[], number][] = [["primary", primaryModel, TASKS, repeats.primary], ...(control ? ([["control", control, controlTasks(), repeats.control]] as [RunRow["arm"], string, readonly CanaryTask[], number][]) : [])];
  const done = new Set(rows.filter((r) => r.day === day).map((r) => r.arm));
  const todo = arms.filter(([a]) => !done.has(a));
  const results: RunRow[][] = [];
  const stopped: string[] = [];
  for (const [arm, model, tasks, rep] of todo) {
    const port = portFor(model);
    // A cache in front of the endpoint would make the run a measurement of the replay: look before spending a day on it.
    const probe = await probeCache(port);
    if (!probe.fresh) {
      const reason = `${arm} arm not run: ${probe.why}.`;
      skip(arm === "primary" ? "cache" : "endpoint", reason);
      stopped.push(reason);
      continue;
    }
    results.push(await runPack({ port, arm, day, date: o.today, tasks, repeats: rep, concurrency: 3, ...(o.retryPauseMs !== undefined ? { retryPauseMs: o.retryPauseMs } : {}) }));
  }
  for (const rowsOfArm of results) {
    const scored = rowsOfArm.filter((r) => r.score !== null);
    const arm = rowsOfArm[0]!.arm;
    if (scored.length < MIN_SCORED_SHARE * rowsOfArm.length) {
      const reason = `${arm} arm not recorded: the endpoint gave no score for ${rowsOfArm.length - scored.length} of ${rowsOfArm.length} attempts (${[...new Set(rowsOfArm.map((r) => r.error).filter(Boolean))].slice(0, 2).join("; ")}). A failure of the harness must not look like a regression, so nothing was written; the next hourly run tries again.`;
      skip("endpoint", reason);
      stopped.push(reason);
      continue;
    }
    appendRows(o.runsPath, rowsOfArm);
    lines.push(`${arm}: ${scored.filter((r) => r.score === 1).length} of ${scored.length} passed${scored.length < rowsOfArm.length ? `, ${rowsOfArm.length - scored.length} attempts produced no score` : ""}; served ${[...new Set(rowsOfArm.map((r) => r.servedModel).filter(Boolean))].join(", ") || "unknown"}`);
  }
  lines.push(...stopped);
  const recorded = lines.length - stopped.length > 0 && results.some((rs) => rs.filter((r) => r.score !== null).length >= MIN_SCORED_SHARE * rs.length);
  return {
    outcome: recorded ? "run" : "skipped",
    text: `Canary day ${day} (${o.today})\n${lines.join("\n")}${control ? "" : "\nNo control arm: set CANARY_CONTROL_MODEL so a platform event can be told from a model change."}${decision.action === "run" && decision.note ? `\nNote: ${decision.note}.` : ""}`,
  };
}

/** The command that runs the canary every hour for the system's own scheduler, which does the retrying: a day that failed is tried again at the next hour. Printed, never installed. */
export function canaryScheduleSnippet(repoRoot: string, platform: NodeJS.Platform): string {
  const root = repoRoot.split("\\").join("/").replace(/\/$/, "");
  const note = "This only prints the command: desk does not install it. It needs MODEL_BASE_URL, MODEL_API_KEY and NEMOTRON_MODEL in the environment of the job or in .env. Remove it with the matching delete command.";
  if (platform === "win32") {
    return ["Windows (Task Scheduler), every hour:", `schtasks /Create /SC HOURLY /TN "desk canary" /TR "cmd /c cd /d ${root.replace(/\//g, "\\")} && npm run desk --silent -- canary run --if-due"`, 'Remove it with: schtasks /Delete /TN "desk canary" /F', note].join("\n");
  }
  if (platform === "darwin") {
    return [
      "macOS (launchd). Save as ~/Library/LaunchAgents/desk.canary.plist, then run: launchctl load ~/Library/LaunchAgents/desk.canary.plist",
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      "  <key>Label</key><string>desk.canary</string>",
      `  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>cd ${root} &amp;&amp; npm run desk --silent -- canary run --if-due</string></array>`,
      "  <key>StartInterval</key><integer>3600</integer>",
      "</dict></plist>",
      note,
    ].join("\n");
  }
  return ["Linux (cron), every hour. Add this line with crontab -e:", `0 * * * * cd ${root} && npm run desk --silent -- canary run --if-due`, note].join("\n");
}
