// Evidence: what the Desk has measured about itself, read from what is recorded. Each block says when it is not recorded.
import { h } from "../lib/dom.js";
import { head, section, stat, table, footnote, pill } from "../lib/ui.js";
import { usd } from "../lib/fmt.js";

export const usesRange = false;

const pc = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const pts = (x) => `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} points`;
const missing = (b) => h("p", { class: "note" }, b.hint);

function bench(b) {
  if (b.state !== "ok") return missing(b);
  const row = (arm) => ({ A0: "One call", A1: "Tool agent", A2: "The Desk" })[arm] || arm;
  const blocks = [];
  if (b.setA) {
    blocks.push(
      table("Set A, 60 questions, one run each (the Desk is the current version; the first version is in the results folder)", [{ label: "Arm", render: (r) => row(r.arm) }, { label: "Exact", num: true, render: (r) => `${r.exact} of ${r.n}` }], b.setA),
    );
  }
  if (b.setB) {
    blocks.push(
      table("Set B, 60 new questions, 7 from templates the Desk was not built around", [{ label: "Arm", render: (r) => row(r.arm) }, { label: "Exact, greedy", num: true, render: (r) => `${r.exact} of ${r.n}` }, { label: "pass^3, repeats", num: true, render: (r) => (r.pass3 === null ? "n/a" : pc(r.pass3)) }], b.setB),
    );
  }
  return blocks.length > 0 ? h("div", null, ...blocks) : h("p", { class: "note" }, "No results recorded yet.");
}

export async function render(ctx) {
  const d = await ctx.api("/api/evidence");
  return h(
    "div",
    null,
    head("Evidence", "What the Desk measured about itself", d.sample ? "Constructed scenario: the checks compare the Desk with what was planted." : "Recorded runs. A block that has not been recorded says so."),
    section("Head to head", "same model on three arms", bench(d.benchmark)),
    section(
      "Routing",
      "cheaper model, replayed",
      d.route.state !== "ok"
        ? missing(d.route)
        : h(
            "div",
            null,
            h("div", { class: "stats" }, stat("Pass rate on the cheaper route", pts(d.route.delta), `95% interval ${pts(d.route.low)} to ${pts(d.route.high)}`, d.route.delta < -0.1), stat("Kinds of task routable", `${d.route.clusters.filter((c) => c.routable).length} of ${d.route.clusters.length}`, "held up on both halves of the tasks")),
            table("By kind of task", [{ label: "Kind", render: (r) => r.cluster }, { label: "Tasks", num: true, render: (r) => r.tasks }, { label: "Chosen half", num: true, render: (r) => (r.chosenDrop === null ? "n/a" : pts(r.chosenDrop)) }, { label: "Confirming half", num: true, render: (r) => (r.confirmedDrop === null ? "n/a" : pts(r.confirmedDrop)) }, { label: "Route", render: (r) => (r.routable ? pill("yes", "live") : pill("no")) }], d.route.clusters),
            h("p", { class: "note" }, `Dollars need a price you supply: ${d.route.strongModel} against ${d.route.cheapModel}, ${Math.round(d.route.tokens.tokensPerCallStrong)} against ${Math.round(d.route.tokens.tokensPerCallCheap)} tokens a call.`),
          ),
    ),
    section(
      "Seats",
      "estimated, beyond the people who landed work",
      d.seats.state !== "ok"
        ? missing(d.seats)
        : h("div", null, table(`Last ${d.seats.windowDays} days`, [{ label: "Team", render: (r) => r.team }, { label: "Plan", render: (r) => r.plan }, { label: "Seats", num: true, render: (r) => r.seats }, { label: "Landed work", num: true, render: (r) => r.active }, { label: "Beyond", num: true, render: (r) => r.idle }, { label: "A month", num: true, render: (r) => (r.idleUsd === null ? "no price" : usd(r.idleUsd * 1_000_000)) }], d.seats.lines), h("p", { class: "note" }, "A seat count, not a verdict on anyone: a person can hold a seat for work that does not show as a commit.")),
    ),
    section(
      "Calibration",
      "does confidence mean what it says",
      d.links.state !== "ok"
        ? missing(d.links)
        : h(
            "div",
            null,
            table("Link confidence against the planted truth", [{ label: "Level", render: (r) => r.level }, { label: "Sessions", num: true, render: (r) => r.n }, { label: "Right", num: true, render: (r) => (r.n === 0 ? "none" : pc(r.rate, 1)) }, { label: "95% interval", num: true, render: (r) => (r.n === 0 ? "" : `${pc(r.low, 1)} to ${pc(r.high, 1)}`) }], d.links.levels),
            h("p", { class: "note" }, d.links.ordered ? "The levels are ordered as their names say." : "The levels are NOT ordered as their names say."),
          ),
      d.tunnel.state !== "ok"
        ? missing(d.tunnel)
        : table("Wind-tunnel one-month range, 90% nominal", [{ label: "Samples", render: (r) => (r.control ? "No change planted (control)" : "A change of tool version and model mix planted") }, { label: "Held", num: true, render: (r) => `${r.inside} of ${r.trials} (${pc(r.coverage)})` }, { label: "95% interval", num: true, render: (r) => `${pc(r.low)} to ${pc(r.high)}` }, { label: "Drift flagged", num: true, render: (r) => r.drift }, { label: "Chance of blocking landed work: calibration error", num: true, render: (r) => (r.eceRaw === null ? "n/a" : `${r.eceRaw.toFixed(2)} resampled, ${r.eceSmoothed.toFixed(2)} smoothed`) }], [d.tunnel.planted, d.tunnel.control].filter(Boolean)),
    ),
    section(
      "Decisions",
      "forecast, then scored (estimated) on the month that followed",
      d.regret.state !== "ok"
        ? missing(d.regret)
        : h(
            "div",
            null,
            ...d.regret.decisions.map((x) =>
              table(`${x.id.slice(0, 12)}, ${x.decision}, made ${new Date(x.decidedAtMs).toISOString().slice(0, 10)}`, [{ label: "Option", render: (r) => `${r.option}: ${r.label}` }, { label: "Expected a month", num: true, render: (r) => (r.low === null ? "none" : `${usd(r.low)} to ${usd(r.high)}`) }, { label: "Month saved", num: true, render: (r) => (r.status === "scored" ? usd(r.realised) : "pending") }, { label: "Landed blocked", num: true, render: (r) => (r.status === "scored" ? r.blocked : "") }, { label: "Range held", render: (r) => (r.inside === null ? "" : r.inside ? pill("inside", "live") : pill("outside", "risk")) }, { label: "Regret", num: true, render: (r) => (r.regret === null ? "" : usd(r.regret)) }], x.options),
            ),
          ),
    ),
    section(
      "Learning",
      "from its own mistakes",
      d.learning.state !== "ok"
        ? missing(d.learning)
        : h(
            "div",
            null,
            h("p", { class: "note" }, `${d.learning.mistakes} mistakes on the training questions; a verified plan was found for ${d.learning.resolved}. As tests: ${d.learning.regression.exact} of ${d.learning.regression.n} pass.`),
            table("Held-out questions answered exactly, by round", [{ label: "Round", num: true, render: (r) => r.round }, { label: "Lessons added", num: true, render: (r) => r.lessons }, { label: "Exact", num: true, render: (r) => `${r.exact} of ${r.n}` }, { label: "Change in exact answers since round 0", num: true, render: (r) => (r.round === 0 ? "" : `${pts(-r.change.change)} (${pts(-r.change.high)} to ${pts(-r.change.low)})`) }, { label: "", render: (r) => (r.reverted ? pill("reverted", "risk") : "") }], d.learning.rounds),
            h("p", { class: "note" }, "No model weights change. A lesson changes only which earlier plans the Planner is shown."),
          ),
    ),
    footnote("Every block is read from a recorded file or a check run now. Nothing here is estimated by the model. Dollar figures are list-price estimates, not an invoice.", "The commands: desk bench report, route, seats, calibrate, regret, lessons report."),
  );
}
