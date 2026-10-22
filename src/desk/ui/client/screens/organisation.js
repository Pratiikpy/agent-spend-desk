// Organisation: three sources of different kinds (a file of invoices, a CI database, a roster service) that one
// Zetaris statement joins. Shows what the bill and the landing facts look like with and without them.
import { h } from "../lib/dom.js";
import { head, section, stat, table, footnote, pill } from "../lib/ui.js";
import { usd, pct, int } from "../lib/fmt.js";

export const usesRange = false;

const KIND = { live: "live", cassette: "recorded", fallback: "fallback" };
const NAMES = { invoices: "Invoices (files in a bucket)", prs: "Pull requests (CI database)", roster: "Roster (REST service)", headline: "Joined statement" };

export async function render(ctx) {
  const d = await ctx.api("/api/silos");
  const served = h(
    "div",
    { class: "cards" },
    ...Object.entries(d.served).map(([k, v]) => h("div", { class: "card s" }, h("h3", null, NAMES[k]), h("p", null, pill(KIND[v] || v, v === "live" ? "live" : v === "fallback" ? "risk" : "ink")))),
  );
  if (!d.available) {
    return h(
      "div",
      null,
      head("Organisation", "Local sources only", "Zetaris is not answering and no recording exists, so the bill is estimated from logs and landing stops at what git shows."),
      section("Sources", "status", served, h("ul", { class: "list" }, ...d.reasons.map((r) => h("li", null, r)))),
      section("Without Zetaris", "what changes", h("ul", { class: "list" }, h("li", null, `Every dollar is an estimate: ${usd(d.classes.estimatedOnlyMicros)}. Nothing is billed.`), h("li", null, "Landing stops at committed, merged and kept: whether the checks passed is not known."), h("li", null, "No spend per landed pull request by team."))),
      footnote("Start the three silos and set ZETARIS_REST_URL, ZETARIS_API_KEY and ZETARIS_ORG_ID, or open the sample."),
    );
  }
  const c = d.classes;
  return h(
    "div",
    null,
    head("Organisation", "One statement, three sources", d.sample ? "Recorded from a live run on the local Zetaris instance; replayed byte for byte." : "Read live from the local Zetaris instance."),
    section("Sources", "how each was read", served, d.reasons.length ? h("ul", { class: "list" }, ...d.reasons.map((r) => h("li", null, r))) : null, h("p", { class: "note" }, "All silo data is synthetic, derived from the constructed sample.")),
    section(
      "Spend per landed pull request",
      "by team",
      d.headline.length === 0
        ? h("p", { class: "note" }, "The joined statement returned no rows.")
        : table("Teams", [
            { label: "Team", render: (r) => r.team },
            { label: "Seats", num: true, render: (r) => int(r.seats) },
            { label: "Plan", render: (r) => r.seatPlan },
            { label: "Landed PRs", num: true, render: (r) => int(r.landedPrs) },
            { label: "Billed", num: true, render: (r) => (r.billedUsd === null ? "n/a" : usd(Math.round(r.billedUsd * 1_000_000))) },
            { label: "Per landed PR", num: true, render: (r) => (r.usdPerLandedPr === null ? "n/a" : usd(Math.round(r.usdPerLandedPr * 1_000_000))) },
          ], d.headline),
      h("p", { class: "note" }, "A landed pull request is merged, green on CI and not reverted. A team with no seats does not appear: spend with no seat holder is a finding in itself."),
    ),
    section(
      "The bill, billed and estimated",
      "kinds of dollars",
      h("div", { class: "stats" }, stat("Billed", usd(c.billedMicros), `covers ${pct(c.billedShare)} of the ledger`), stat("Estimated only", usd(c.estimatedOnlyMicros), "no invoice behind it"), stat("Ledger estimate", usd(c.ledgerEstimatedMicros), "list price times logged tokens")),
      c.estimatedOfBilledMicros > 0 ? h("p", { class: "note" }, `Where an invoice exists it is ${c.billedMicros >= c.estimatedOfBilledMicros ? "above" : "below"} the list-price estimate by ${pct(Math.abs(c.billedMicros - c.estimatedOfBilledMicros) / c.estimatedOfBilledMicros)}. The invoice is the dollar; the estimate is how the Desk priced the same tokens.`) : null,
    ),
    section(
      "Landing, with CI",
      "what git alone cannot say",
      d.ci
        ? h("div", { class: "stats" }, stat("Landed sessions", int(d.ci.landedWithCi + d.ci.landedNoPr), `${int(d.ci.landedWithCi)} have a pull request row`), stat("Merged on green", int(d.ci.landedGreen), "checks passed at merge"), stat("Merged on red", int(d.ci.landedRed), "merged although checks failed", d.ci.landedRed > 0))
        : h("p", { class: "note" }, "No pull request rows, so landing stops at what git shows."),
    ),
    section(
      "Trace",
      "one line per statement",
      h("ul", { class: "list" }, ...d.trace.map((t) => h("li", { class: "traceline" }, `desk.ingest port ${t.port}, op ${t.op}, ${t.servedFrom}${t.rows !== undefined ? `, ${t.rows} rows` : ""}, request ${String(t.reqHash).slice(0, 19)}`))),
    ),
    footnote("Stop the Zetaris container and this screen changes: nothing is billed and landing stops at merged."),
  );
}
