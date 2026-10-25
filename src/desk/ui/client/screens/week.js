// Weekly review: one ISO week, one page. Where the money went, what it bought, how the forecasts did, what is in doubt, what drifted, and at most three changes worth making.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, table, footnote, pill } from "../lib/ui.js";
import { usd, pct, int } from "../lib/fmt.js";

export const usesRange = false;

const signed = (m) => `${m < 0 ? "-" : "+"}${usd(Math.abs(m))}`;

export async function render(ctx) {
  const params = ctx.params && ctx.params.week ? { week: ctx.params.week } : {};
  const d = await ctx.api("/api/week", params);
  if (d.state === "empty") return h("div", null, head("Weekly review", "Nothing to review yet"), emptyState(d));
  const r = d.review;
  const change = r.spend.previousMicros ? ` The week before: ${usd(r.spend.previousMicros)} (${signed(r.spend.micros - r.spend.previousMicros)}).` : "";
  const picker = h(
    "p",
    { class: "note weeks" },
    "Week: ",
    ...d.weeks.map((w) => h("a", { href: ctx.link("week", { week: w }), "aria-current": w === r.week.label ? "page" : null }, w)),
  );
  return h(
    "div",
    null,
    head("Weekly review", r.week.label, `${r.week.start} to ${r.week.end}, UTC. What the week cost, what it bought, and the changes it earns.`),
    picker,
    ...r.notes.map((n) => h("div", { class: "state" }, h("p", null, n))),
    section(
      "The week",
      "list-price estimates",
      h(
        "div",
        { class: "stats" },
        stat("Spend", usd(r.spend.micros), `${int(r.spend.calls)} calls on ${r.daysWithData} day${r.daysWithData === 1 ? "" : "s"}.${change}`),
        stat("Landed", usd(r.landing.landedMicros), "merged or kept"),
        stat("Not tied to a commit", usd(r.landing.unlinkedMicros), r.landing.lowConfidenceMicros > 0 ? `${usd(r.landing.lowConfidenceMicros)} rests on a weak link that is not counted` : "unknown, not waste"),
        stat("Waste a rule can see", r.wasteShare === null ? "n/a" : pct(r.wasteShare), "idle, loops and cache misses"),
      ),
    ),
    section(
      "By workflow",
      "kind of task",
      r.workflows.length === 0
        ? h("p", { class: "note" }, "No tasks in this week.")
        : table(
            "Workflows",
            [
              { label: "Type", render: (w) => w.type },
              { label: "Tasks", num: true, render: (w) => int(w.tasks) },
              { label: "Spend", num: true, render: (w) => usd(w.spendMicros) },
              { label: "Landed", num: true, render: (w) => usd(w.landedMicros) },
              { label: "Not tied", num: true, render: (w) => usd(w.unlinkedMicros) },
            ],
            r.workflows,
            { maxh: true },
          ),
    ),
    section(
      "Cost per landed task",
      "estimated, the last four weeks",
      table(
        "Trend",
        [
          { label: "Week", render: (t) => t.label },
          { label: "Spend", num: true, render: (t) => usd(t.spendMicros) },
          { label: "Landed", num: true, render: (t) => usd(t.landedMicros) },
          { label: "Landed tasks", num: true, render: (t) => int(t.landedTasks) },
          { label: "Each", num: true, render: (t) => (t.costPerLandedTaskMicros === null ? "none landed" : usd(t.costPerLandedTaskMicros)) },
        ],
        r.trend,
      ),
    ),
    section(
      "How the forecasts did",
      "scorecard",
      h("p", null, r.forecast ? `The pre-run estimate's range held the real cost of ${int(r.forecast.held)} of ${int(r.forecast.n)} later tasks (${pct(r.forecast.held / r.forecast.n)}; it aims at 80%).` : "Not enough tasks to test the estimate yet."),
      h("p", { class: "note" }, r.calibration),
    ),
    section(
      "In doubt",
      "owner questions, what an answer is worth is an estimate",
      r.questions.open === 0
        ? h("p", { class: "note" }, "No open question.")
        : h(
            "div",
            null,
            h("p", null, `${int(r.questions.open)} open question${r.questions.open === 1 ? "" : "s"} about which session a commit came from. Answer them with `, h("code", null, "desk questions"), "."),
            h(
              "p",
              { class: "note", "data-questions-worth": "true" },
              r.questions.moving === 0
                ? "None would move a headline figure if answered yes: each is about a commit that is only committed, so they wait here and the Desk does not interrupt you for them."
                : `${int(r.questions.moving)} of them would move a headline figure if answered yes, the most worth ${usd(r.questions.topEvoiMicros)} (the dollars it would move times the chance it is yes). The rest wait here; the Desk interrupts you only for a question worth more than the interruption.`,
            ),
            r.questions.held > 0 ? h("p", { class: "note", "data-questions-held": "true" }, `${int(r.questions.held)} ${r.questions.held === 1 ? "was" : "were"} held back from interrupting you this week because the answer was worth less than the interruption.`) : null,
          ),
    ),
    section(
      "What changed",
      "against the week before",
      r.drift.length === 0 ? h("p", { class: "note" }, "Nothing moved against the week before.") : h("ul", { class: "list" }, ...r.drift.map((x) => h("li", null, pill(x.kind.replace("_", " "), ""), " ", x.text))),
    ),
    section(
      "Approvals",
      "how they were made",
      r.approvals === null
        ? h("p", { class: "note" }, "Not read: no approval record exists yet. `desk approvals` shows what is waiting and how decisions were made.")
        : h("div", null, ...r.approvalLines.map((l) => h("p", null, l))),
    ),
    section(
      "Changes worth making",
      "at most three",
      r.suggestions.length === 0
        ? h("p", { class: "note" }, "None: no rule shows a saving in this week's calls.")
        : h(
            "ol",
            { class: "list" },
            ...r.suggestions.map((s) =>
              h(
                "li",
                null,
                h("strong", null, s.text),
                h("p", { class: "note" }, `It cost ${usd(s.windowMicros)} this week; the part a change could avoid is ${usd(s.addressableMicros)}${s.interval ? ` (usually ${usd(s.interval.lowMicros)} to ${usd(s.interval.highMicros)} a window in your own history)` : s.basis === "heuristic_estimate" ? " at most: an upper bound, because the logs cannot say how much is avoidable" : ""}. ${s.note}`),
              ),
            ),
          ),
    ),
    footnote("Every figure is a list-price estimate from logged tokens, not an invoice. A suggestion appears only when a rule can show its saving in your own calls; none is a promise."),
  );
}
