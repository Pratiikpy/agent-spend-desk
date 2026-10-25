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

const ORACLE = { strong: ["strong", "live"], weak: ["weak", "risk"], none: ["none", "fail"] };
const SWAP = { equivalent: ["as good", "pass"], worse: ["worse", "fail"], inconclusive: ["no call", ""], withheld: ["withheld", ""] };

/**
 * Your own tasks: the work from your history that the Desk could turn into a fixed set of tasks to measure a model on, how well the tests decide each one, and what was run on
 * them. This screen only reads. Accepting a task is a command, so that nothing in a browser changes what the Desk will measure.
 */
function yourTasks(t) {
  if (!t) return null;
  if (t.state !== "ok") return section("Your own tasks", "from your history", h("p", { class: "note" }, t.hint));
  const count = (k) => t.counts[k] || 0;
  return section(
    "Your own tasks",
    "from your history",
    h(
      "div",
      { class: "stats" },
      stat("Accepted", String(count("accepted")), `${t.families.length} ${t.families.length === 1 ? "family" : "families"} of work`),
      stat("Waiting for a look", String(count("computed")), "tests run, not yet accepted or rejected"),
      stat("Candidates", String(count("candidate")), `${count("ineligible")} set aside, ${count("rejected")} rejected`),
    ),
    t.accepted.length > 0
      ? table(
          "Accepted tasks",
          [
            { label: "Kind", render: (r) => r.kind },
            { label: "Area", render: (r) => r.area },
            { label: "Repository", render: (r) => r.repo },
            { label: "Tests decide it", render: (r) => pill(...(ORACLE[r.oracle] || ["unknown", ""])) },
            { label: "Change", num: true, render: (r) => `${r.diffLines} lines` },
            { label: "Held out", render: (r) => (r.heldOut === null ? "" : r.heldOut ? "yes" : "no") },
          ],
          t.accepted,
          { maxh: true },
        )
      : h("p", { class: "note" }, "None accepted yet. desk capture show TASK shows one; desk capture accept TASK keeps it. Only a task with a test that failed before the work and passed after it can be accepted without saying why."),
    t.suites.length > 0
      ? h("p", { class: "note" }, `Frozen suites: ${t.suites.map((s) => `${s.hash.slice(0, 12)} (${s.tasks} tasks, ${s.heldOut} held out, ${s.families} families, ${s.createdAt.slice(0, 10)})`).join("; ")}. A frozen suite is not edited: its name is a hash of every task in it.`)
      : null,
    t.swaps.length > 0
      ? table(
          "Models compared on your tasks",
          [
            { label: "Run", id: true, render: (r) => r.runId },
            { label: "Date", render: (r) => r.createdAt.slice(0, 10) },
            { label: "Baseline", render: (r) => r.baseline },
            { label: "Candidate", render: (r) => r.candidate },
            { label: "Call", render: (r) => (r.verdict ? pill(...(SWAP[r.verdict] || [r.verdict, ""])) : pill(r.status)) },
            { label: "Why", render: (r) => r.why || "" },
          ],
          t.swaps,
          { maxh: true },
        )
      : null,
    h("p", { class: "note" }, "A task is the work as it was asked, with the tests that decide it, copied to a folder and run. Nothing here is sent anywhere; the model that is compared is the one you name."),
  );
}

export async function render(ctx) {
  const d = await ctx.api("/api/canary");
  if (d.state === "empty") return h("div", null, head("Canary", "No runs yet"), emptyState(d), yourTasks(d.yourTasks));
  const [word, kind] = VERDICT[d.verdict] || [d.verdict, ""];
  const change = d.served[0];
  return h(
    "div",
    null,
    head("Canary", word, `Day ${d.days}. ${d.tasks} tasks, one real run a day on each arm. ${d.sample ? "Constructed: the model behind the primary arm was switched on purpose, so there is a regression to find. Dates are assigned." : ""}`),
    section(
      "The call",
      REASON[d.reason] || d.reason,
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
      h("p", { class: "note legend" }, h("span", { class: "keyline" }), "primary arm", h("span", { class: "keyline dash" }), "control arm", h("span", null, "Shaded: the frozen baseline. Dotted rule: the served model changed.")),
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
        d.flip ? h("li", { "data-flip": "true" }, `What would flip this verdict: ${d.flip}`) : null,
        h("li", null, `Harness ${d.harnessUnchanged ? "unchanged" : "CHANGED"}; ${d.errorRate === null ? "" : `${pct(d.errorRate)} of attempts produced no score.`}`),
        h("li", null, "The statistic's false-alarm rate and power are measured on simulated data (docs/verification/canary-simulation.md). Real tasks that are noisier widen the interval."),
        h("li", null, "A switch of served model is a possible cause, never a proven one."),
        ...d.notes.map((n) => h("li", null, n)),
      ),
    ),
    yourTasks(d.yourTasks),
    footnote("The tasks are checked by code that reads text. No model output is executed.", "Each row is one real model call; nothing is simulated in this series."),
  );
}
