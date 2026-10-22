// Canary: did the agent get worse on a fixed set of tasks? The call, its interval, the control arm and what the
// call cannot say. A verdict is only ever as good as its data, so the data is drawn above it.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, table, footnote, pill } from "../lib/ui.js";
import { pct } from "../lib/fmt.js";
import { passLines } from "../lib/charts.js";

export const usesRange = false;

const VERDICT = {
  regressed: ["Regressed", "fail"],
  improved: ["Improved", "pass"],
  steady: ["Steady", "pass"],
  inconclusive: ["No call", ""],
  harness_or_platform: ["The platform or the harness moved, not the model", "fail"],
};

const REASON = {
  too_early: "Too early: a call needs a 14-day baseline and two 7-day windows.",
  too_few_tasks: "Too few tasks have scores.",
  no_comparison: "Nothing to compare yet.",
  invalid_data: "The data is not usable.",
  error_rate: "Too many attempts produced no score.",
  regression_rule_met: "Every condition of the regression rule held in two consecutive windows.",
  improvement_rule_met: "Every condition of the improvement rule held in two consecutive windows.",
  harness_or_agent_version_changed: "The harness or the agent version changed, so scores are not comparable.",
  control_arm_moved: "The control arm moved too, which points at the platform.",
  no_control_arm: "No control arm, so a platform event cannot be ruled out.",
  rests_on_one_task: "The change rests on one task.",
  interval_wide: "The interval is too wide to call.",
  below_minimum_effect: "The change is smaller than the smallest change that can be called.",
  within_detectable_range: "The change is within what noise could produce.",
  not_in_both_windows: "The change did not show in both windows.",
  held_out_half_disagrees: "The held-out half of the tasks disagrees.",
};

const pts = (x) => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} points`;

export async function render(ctx) {
  const d = await ctx.api("/api/canary");
  if (d.state === "empty") return h("div", null, head("Canary", "No runs yet"), emptyState(d));
  const [word, kind] = VERDICT[d.verdict] || [d.verdict, ""];
  const change = d.served[0];
  return h(
    "div",
    null,
    head("Canary", word, `Day ${d.days}. ${d.tasks} tasks, one real run a day on each arm. ${d.sample ? "Constructed: the model behind the primary arm was switched on purpose, so there is a regression to find. Dates are assigned." : ""}`),
    section(
      "The call",
      REASON[d.reason] || d.reason,
      h("div", { class: kind === "fail" ? "bigverdict fail" : kind === "pass" ? "bigverdict pass" : "bigverdict" }, word),
      d.delta !== null && d.ci
        ? h(
            "div",
            { class: "stats" },
            stat("Change against the baseline", pts(d.delta), `99% interval ${pts(d.ci.low)} to ${pts(d.ci.high)}, on ${d.tasksUsed} tasks`, d.verdict === "regressed"),
            stat("Smallest change it can see", `${(d.mde * 100).toFixed(1)} points`, `one window, 80% power; for a two-window call ${(d.mdeVerdict * 100).toFixed(1)} points`),
            stat("Control arm", d.control ? (d.control.moved ? "moved" : "flat") : d.controlRan ? "not read" : "none", d.control ? `${pts(d.control.delta)}, 95% interval ${pts(d.control.low)} to ${pts(d.control.high)}` : d.controlRan ? "the rule stopped before the control arm was needed" : "a platform event cannot be ruled out", Boolean(d.control && d.control.moved)),
          )
        : null,
      change ? h("p", { class: "note" }, `Consistent with, not caused by: the served model id the endpoint reported changed on day ${change.day}${change.date ? ` (${change.date})` : ""}, from ${change.from} to ${change.to}.`) : null,
      d.controlServed.length > 0 ? h("p", { class: "note" }, `The control arm's served model also changed, on day ${d.controlServed[0].day}.`) : null,
    ),
    section(
      "Pass rate by day",
      "the data behind the call",
      h("p", { class: "note" }, h("span", { class: "keyline" }), "primary arm ", h("span", { class: "keyline dash" }), "control arm. Shaded: the frozen baseline. Dotted rule: the served model changed."),
      passLines(d.primary, d.controlArm, { baselineDays: d.baselineDays, switches: d.served, label: `Baseline ${pct(d.baselineMean.primary ?? 0)}, latest window ${pct(d.latestMean.primary ?? 0)}.` }),
      h("p", { class: "note" }, `Primary: ${pct(d.baselineMean.primary ?? 0)} in the baseline, ${pct(d.latestMean.primary ?? 0)} in the latest window.${d.controlArm ? ` Control: ${pct(d.baselineMean.control ?? 0)} and ${pct(d.latestMean.control ?? 0)}.` : ""}`),
    ),
    section(
      "By task",
      "baseline against the latest window",
      table(
        "Primary arm",
        [
          { label: "Task", id: true, render: (r) => r.id },
          { label: "Kind", render: (r) => r.cluster },
          { label: "Baseline", num: true, render: (r) => (r.baseline === null ? "n/a" : pct(r.baseline)) },
          { label: "Latest window", num: true, render: (r) => (r.latest === null ? "n/a" : pct(r.latest)) },
          { label: "Change", render: (r) => (r.baseline === null || r.latest === null ? "" : r.latest < r.baseline - 0.2 ? pill("down", "risk") : r.latest > r.baseline + 0.2 ? pill("up", "live") : pill("flat")) },
        ],
        d.perTask,
        { maxh: true },
      ),
    ),
    section(
      "What this cannot say",
      "every time",
      h(
        "ul",
        { class: "list" },
        h("li", null, `A new regression cannot be called before day ${d.earliestCallDay} after the baseline is pinned.`),
        h("li", null, `Harness ${d.harnessUnchanged ? "unchanged" : "CHANGED"}; ${d.errorRate === null ? "" : `${pct(d.errorRate)} of attempts produced no score.`}`),
        h("li", null, "The statistic's false-alarm rate and power are measured on simulated data (docs/verification/canary-simulation.md). Real tasks that are noisier widen the interval."),
        h("li", null, "A switch of served model is a possible cause, never a proven one."),
        ...d.notes.map((n) => h("li", null, n)),
      ),
    ),
    footnote("The tasks are checked by code that reads text. No model output is executed.", "Each row is one real model call; nothing is simulated in this series."),
  );
}
