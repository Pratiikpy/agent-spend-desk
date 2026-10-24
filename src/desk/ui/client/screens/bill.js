// Month bill: the dollars, honest about what kind of dollars they are, and what they bought.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, table, hbars, footnote, money, share, pill, PROV } from "../lib/ui.js";
import { num } from "../lib/prov.js";
import { usd, pct, int, STATE_LABEL, STATE_NOTE, CAUSE_LABEL } from "../lib/fmt.js";
import { stackedBar, dailyBars, swatch } from "../lib/charts.js";

export const usesRange = true;

const STATUS_PILL = { reconciled: "live", partial: "", unreconciled: "risk" };

// Billed against estimated against reported, per vendor and month. The status is a comparison with a tolerance, never a claim that either figure is right.
function reconciliationTable(rows) {
  if (!rows || rows.length === 0) return null;
  return table(
    "Billed against estimated",
    [
      { label: "Month", render: (r) => `${r.vendor} ${r.period}` },
      { label: "Billed", num: true, render: (r) => (r.billedMicros === null ? "none" : r.currency === "USD" ? usd(r.billedMicros) : `${r.currency} ${(r.billedMicros / 1e6).toFixed(2)}`) },
      { label: "Estimated", num: true, render: (r) => usd(r.estimatedMicros) },
      { label: "Reported", num: true, render: (r) => (r.reportedMicros === null ? "n/a" : usd(r.reportedMicros)) },
      { label: "Status", render: (r) => pill(r.status, STATUS_PILL[r.status]) },
      { label: "Why", render: (r) => r.reason },
    ],
    rows,
    { maxh: true },
  );
}

// Which pricing rules applied in this period, and any repricing: a price that was corrected or a snapshot that came later changed what the ledger says, and both versions are kept.
function pricingNote(p) {
  if (!p) return null;
  const parts = [];
  const applied = p.rules.filter((r) => !r.note);
  const notes = p.rules.filter((r) => r.note);
  if (applied.length) parts.push(h("p", { class: "note", "data-pricing-rules": "true" }, `Pricing rules in this period: ${applied.map((r) => `${int(r.calls)} calls ${r.label}`).join("; ")}.`));
  if (notes.length) parts.push(h("p", { class: "note" }, `Recorded, not guessed: ${notes.map((r) => `${int(r.calls)} calls ${r.label}`).join("; ")}.`));
  if (p.repricings.length) {
    const r = p.repricings[0];
    parts.push(h("p", { class: "note", "data-repriced": "true" }, `Repriced on ${r.at.slice(0, 10)}: ${int(r.calls)} calls moved to ${r.snapshot}, ${r.deltaMicros < 0 ? "-" : "+"}${usd(Math.abs(r.deltaMicros))} (${r.reason}). Every earlier cost is kept; \`desk prices history\` lists them.`));
  }
  return parts.length ? h("div", null, ...parts) : null;
}

export async function render(ctx) {
  const d = await ctx.api("/api/bill", { range: ctx.range });
  if (d.state === "empty") return h("div", null, head("Month bill", "Nothing billed yet"), emptyState(d));
  const rows = d.landing.rows;
  const landed = rows.filter((r) => r.state === "kept" || r.state === "merged").reduce((s, r) => s + r.micros, 0);
  const reverted = rows.find((r) => r.state === "reverted");
  const unlinked = rows.find((r) => r.state === "unlinked");
  const total = d.landing.totalMicros;
  // A figure opens the sessions behind it: the same period, narrowed to what the figure is about.
  const open = (extra, window) => h("a", { href: ctx.link("sessions", { from: (window || d.window).from, to: (window || d.window).to, ...(extra || {}) }) }, "See the sessions behind this");
  const dayWindow = (day) => ({ from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z` });

  return h(
    "div",
    null,
    head("Month bill", usd(d.totals.estimatedMicros), `${d.span.days === "all" ? "Everything in the ledger" : `The last ${d.span.days} days`}, as an estimate from logged tokens at list price. Not an invoice.`),
    section(
      "Headline",
      "estimated",
      h(
        "div",
        { class: "stats" },
        stat("Estimated spend", money(d.totals.estimatedMicros, d.snapshotId, { Rows: open() }), `${int(d.totals.pricedCalls)} priced calls`),
        stat("Landed", d.landing.linked ? share(total > 0 ? landed / total : 0, "spend in the period", { Definition: "merged or kept" }) : "unknown", d.landing.linked ? usd(landed) : "no repository linked"),
        stat("Per landed session", d.costPerLandedSession === null ? "n/a" : money(d.costPerLandedSession, d.snapshotId), `${int(d.landedSessions)} sessions landed`),
        stat("Reverted", reverted ? money(reverted.micros, d.snapshotId) : usd(0), "work that was undone", Boolean(reverted && total > 0 && reverted.micros / total >= 0.05)),
      ),
      d.priceBand
        ? h(
            "p",
            { class: "note", "data-price-band": "true" },
            `Price check: ${d.priceBand.source} (fetched ${d.priceBand.fetchedAt}) disagrees with our price book on ${d.priceBand.items.map((i) => `${i.model} ${i.price}${i.longPrompts ? " for long prompts" : ""} (${int(i.tokens)} tokens)`).join(", ")}. The estimate is ${usd(d.priceBand.estimateMicros)} on our prices and would be ${d.priceBand.highMicros > d.priceBand.estimateMicros ? `up to ${usd(d.priceBand.highMicros)}` : ""}${d.priceBand.highMicros > d.priceBand.estimateMicros && d.priceBand.lowMicros < d.priceBand.estimateMicros ? " or as low as " : ""}${d.priceBand.lowMicros < d.priceBand.estimateMicros ? usd(d.priceBand.lowMicros) : ""} on theirs. ${d.priceBand.note}`,
          )
        : null,
      pricingNote(d.pricing),
    ),
    section(
      "Kinds of dollars",
      "the class of each figure",
      h("p", { "data-coverage": "true" }, d.coverageLine),
      h("ul", { class: "list" }, ...d.classes.map((c) => h("li", null, pill(c.cls, c.cls === "estimated" ? "ink" : ""), " ", c.processes !== undefined ? (c.processes > 0 ? `${int(c.processes)} processes, ${usd(c.micros)}. ` : "none. ") : c.invoices > 0 ? `${int(c.invoices)} invoice${c.invoices === 1 ? "" : "s"}, ${usd(c.micros)}. ` : c.calls > 0 ? `${int(c.calls)} calls${c.micros ? `, ${usd(c.micros)}` : ""}. ` : "none. ", c.note))),
      reconciliationTable(d.reconciliations),
      d.reconciliation
        ? h("p", { class: "note" }, `Against the tool's own figure: ${int(d.reconciliation.match)} of ${int(d.reconciliation.processes)} processes agree. The tool recorded ${usd(d.reconciliation.reportedMicros)} and this estimate is ${usd(d.reconciliation.estimatedMicros)} for the same calls.${d.reconciliation.withSubAgents.processes > 0 ? ` ${int(d.reconciliation.withSubAgents.processes)} used sub-agents, where the tool's counter is known to fall behind (${usd(d.reconciliation.withSubAgents.reportedMicros)} recorded against ${usd(d.reconciliation.withSubAgents.estimatedMicros)} estimated).` : ""} ${d.reconciliation.toleranceNote}`)
        : null,
    ),
    section(
      "What it bought",
      "by landing state",
      d.landing.linked
        ? h(
            "div",
            { class: "pair wide" },
            h("div", null, stackedBar(rows, total), h("p", { class: "note" }, `${usd(d.landing.lowConfidenceMicros)} of linked spend rests on weak evidence and is not counted as landed.`)),
            table(
              "Landing states",
              [
                { label: "State", render: (r) => h("span", null, swatch(r.state), STATE_LABEL[r.state]) },
                { label: "Sessions", num: true, render: (r) => int(r.sessions) },
                { label: "Spend", num: true, render: (r) => num(usd(r.micros), PROV.estimated(d.snapshotId, { Note: STATE_NOTE[r.state], Rows: open({ state: r.state }) })) },
                { label: "Share", num: true, render: (r) => pct(r.share) },
              ],
              rows,
            ),
          )
        : h("p", { class: "note" }, "No repository is linked, so every session is unlinked and nothing can be called landed. Run `desk landing` with your repositories."),
      unlinked && unlinked.micros > 0 ? h("p", { class: "note" }, `Unlinked is ${pct(unlinked.share)} of spend. It means the sources cannot tie the session to a commit: unknowable, not waste.`) : null,
    ),
    section("By day", "spend", h("div", { class: "pair" }, dailyBars(d.daily), table("Last days", [{ label: "Day", render: (r) => r.day }, { label: "Calls", num: true, render: (r) => int(r.calls) }, { label: "Spend", num: true, render: (r) => num(usd(r.micros), PROV.estimated(d.snapshotId, { Rows: open({}, dayWindow(r.day)) })) }], d.daily.slice(-14).reverse(), { maxh: true }))),
    section(
      "Where it went",
      "by cause",
      h("div", { class: "pair wide" }, hbars(d.causes.map((c) => ({ name: CAUSE_LABEL[c.cause] || c.cause, share: c.share, value: `${pct(c.share)}  ${usd(c.micros)}` }))), h("p", { class: "note" }, `Cache misses alone cost about ${usd(d.missSavingMicros)} more than a cache hit would have.`)),
    ),
    section(
      "By model and project",
      "estimated",
      h(
        "div",
        { class: "cards" },
        table("Models", [{ label: "Model", id: true, render: (r) => r.model }, { label: "Calls", num: true, render: (r) => int(r.calls) }, { label: "Spend", num: true, render: (r) => (r.micros === null ? "unpriced" : num(usd(r.micros), PROV.estimated(d.snapshotId, { Rows: open({ model: r.model }) }))) }], d.byModel),
        table("Projects", [{ label: "Project", id: true, render: (r) => r.project }, { label: "Sessions", num: true, render: (r) => int(r.sessions) }, { label: "Spend", num: true, render: (r) => num(usd(r.micros), PROV.estimated(d.snapshotId, { Rows: open({ project: r.project }) })) }], d.byProject),
      ),
    ),
    footnote(`List price times logged tokens, with the price snapshot ${d.snapshotId}.`, "A flat plan does not charge per token; this is what the same tokens would cost at list price."),
  );
}
