import { existsSync } from "node:fs";

import { buildSeries, readRows, servedChanges } from "./store.ts";
import { DEFAULT_CONFIG, earliestCallDay, evaluateAt, makeContext, type Verdict } from "./verdict.ts";
import { harnessHash, TASKS } from "./tasks.ts";
import type { RunRow } from "./runner.ts";

export const SAMPLE_RUNS = "data/sample/canary/runs.jsonl";
export const OWN_RUNS = "data/desk/canary/runs.jsonl";

const pts = (x: number): string => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} points`;
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

const WORDS: Record<Verdict["verdict"], string> = {
  regressed: "Regressed",
  improved: "Improved",
  steady: "Steady",
  inconclusive: "No call",
  harness_or_platform: "The platform or the harness moved, not the model",
};

const REASONS: Record<string, string> = {
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
}

/**
 * Run today's pack: the primary arm on the model the owner's agents use, and a control arm when a second model is
 * named. Day 1 is the first day ever run; a day that already has rows is not run twice.
 */
export async function canaryRunCommand(o: CanaryRunOptions): Promise<string> {
  const baseUrl = o.env["MODEL_BASE_URL"] ?? o.env["NVIDIA_BASE_URL"];
  const apiKey = o.env["MODEL_API_KEY"] ?? o.env["NVIDIA_API_KEY"];
  const primary = o.env["NEMOTRON_MODEL"] ?? o.env["NVIDIA_MODEL"];
  if (!baseUrl || !apiKey || !primary) return "The canary needs a model to run: set MODEL_BASE_URL, MODEL_API_KEY and NEMOTRON_MODEL (or the NVIDIA_ names). It never runs without one and never invents a score.";
  const control = o.env["CANARY_CONTROL_MODEL"];
  const { OpenAiPort } = await import("../agents/model.ts");
  const { runPack } = await import("./runner.ts");
  const { appendRows } = await import("./store.ts");
  const existing = readRows(o.runsPath).rows;
  const first = existing.length === 0 ? o.today : existing.reduce((a, r) => (r.date < a ? r.date : a), existing[0]!.date);
  const day = Math.round((Date.parse(o.today) - Date.parse(first)) / 86_400_000) + 1;
  if (!(day >= 1)) return `Today (${o.today}) is before the first canary day (${first}).`;
  const done = new Set(existing.filter((r) => r.day === day).map((r) => r.arm));
  const arms: [RunRow["arm"], string][] = [["primary", primary], ...(control ? ([["control", control]] as [RunRow["arm"], string][]) : [])];
  const todo = arms.filter(([a]) => !done.has(a));
  if (todo.length === 0) return `Day ${day} (${o.today}) is already recorded.`;
  const results = await Promise.all(todo.map(([arm, model]) => runPack({ port: new OpenAiPort({ baseUrl, apiKey, model }), arm, day, date: o.today, concurrency: 3 })));
  const lines: string[] = [];
  for (const rows of results) {
    appendRows(o.runsPath, rows);
    const scored = rows.filter((r) => r.score !== null);
    lines.push(`${rows[0]!.arm}: ${scored.filter((r) => r.score === 1).length} of ${scored.length} passed${scored.length < rows.length ? `, ${rows.length - scored.length} attempts produced no score` : ""}; served ${rows.find((r) => r.servedModel)?.servedModel ?? "unknown"}`);
  }
  return `Canary day ${day} (${o.today})\n${lines.join("\n")}${control ? "" : "\nNo control arm: set CANARY_CONTROL_MODEL so a platform event can be told from a model change."}`;
}
