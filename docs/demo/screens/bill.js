// Month bill: the dollars, honest about what kind of dollars they are, and what they bought.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, table, hbars, footnote, money, share, pill, PROV } from "../lib/ui.js";
import { num } from "../lib/prov.js";
import { usd, pct, int, STATE_LABEL, STATE_NOTE, CAUSE_LABEL } from "../lib/fmt.js";
import { stackedBar, dailyBars, swatch } from "../lib/charts.js";

export const usesRange = true;

const STATUS_PILL = { reconciled: "live", partial: "", unreconciled: "risk" };

// The owner's time on the questions the gate asked, from the gate's own record and at the owner's own rate. It is not model spend and is never added to it.
function reviewSection(r) {
  const minutes = r.seconds / 60;
  return section(
    "Your review time",
    "reported by the gate, at your rate",
    h(
      "p",
      { "data-review-time": "true" },
      `${int(r.approvals)} question${r.approvals === 1 ? "" : "s"} the gate asked ${r.approvals === 1 ? "was" : "were"} answered, after ${minutes < 1 ? `${Math.round(r.seconds)} seconds` : `${minutes.toFixed(1)} minutes`} of waiting in all: ${usd(r.micros)} of your time at $${r.usdPerHour} an hour.${r.unanswered > 0 ? ` ${int(r.unanswered)} more ${r.unanswered === 1 ? "has" : "have"} no answer yet and cost${r.unanswered === 1 ? "s" : ""} nothing until ${r.unanswered === 1 ? "it is" : "they are"} answered.` : ""}`,
    ),
    h("p", { class: "note" }, "The wait from a request to its approval, not the time spent reading it: a request left unread for an hour counts as an hour. It is a reading of your attention, not part of what the models cost."),
  );
}

// What a prompt in another script costs over the same length of English on the same model. A cell with too few tasks is said to have too few, with its counts, and has no figure.
function languageSection(l) {
  return section(
    "Language",
    "estimated, from logged tokens",
    h("p", { "data-language": "true" }, `Prompts in another script cost more tokens than the same length of English, on the same model. A language is compared only where it has at least ${int(l.minTasks)} prompts on a model and English has at least ${int(l.minTasks)} on the same one.`),
    table(
      "Tokens per character, against English on the same model",
      [
        { label: "Language", render: (r) => r.language },
        { label: "Model", id: true, render: (r) => r.model },
        { label: "Prompts", num: true, render: (r) => int(r.tasks) },
        { label: "Tokens / char", num: true, render: (r) => (r.status === "shown" ? r.tokensPerChar.toFixed(3) : "") },
        { label: "x English", num: true, render: (r) => (r.status === "shown" ? `${r.ratio.toFixed(2)}x` : "") },
        { label: "Extra tokens", num: true, render: (r) => (r.status === "shown" ? int(r.extraTokens) : "") },
        { label: "List price", num: true, render: (r) => (r.status === "shown" ? usd(r.extraMicros) : "") },
        { label: "", render: (r) => (r.status === "shown" ? (r.ratio >= l.wasteRatio ? pill("C-LANG", "risk") : "") : pill("too few", "")) },
      ],
      l.cells,
      { maxh: true },
    ),
    l.cells.some((c) => c.status !== "shown") ? h("p", { class: "note" }, l.cells.filter((c) => c.status !== "shown").map((c) => `${c.language} on ${c.model}: ${c.why}.`).join(" ")) : null,
    h("p", { class: "note" }, `Total above the English rate: ${usd(l.totalExtraMicros)} at list price. A rate is the median tokens newly read by the first call after a prompt, less the harness text that every English prompt carries, per character; the same harness text is assumed for every language. The language may be the one the work needs: this is a cost to know about, and from ${l.wasteRatio} times English it is listed by desk waste as C-LANG.`),
  );
}

// Where the month is likely to end, as a range from the owner's own past forecasts, and how such ranges have done. A straight line says it is one and gives no range.
function monthEndSection(m, snapshotId) {
  const range = m.lowMicros !== null && m.highMicros !== null ? `${usd(m.lowMicros)} to ${usd(m.highMicros)} (${Math.round(m.level * 100)}%)` : null;
  return section(
    "Where the month ends",
    "forecast, from your own history",
    m.daysLeft === 0
      ? h("p", { "data-month-end": "true" }, `${m.month}: ${usd(m.spentMicros)}, the month is over.`)
      : h(
          "div",
          { "data-month-end": "true" },
          h("div", { class: "stats" }, stat(`${m.month} so far`, money(m.spentMicros, snapshotId), `through ${m.asOf}, ${int(m.daysLeft)} days to go`), stat("Likely by the end", range ?? usd(m.pointMicros), m.method === "linear" ? "a straight line, no range" : `most likely ${usd(m.pointMicros)}`)),
          m.note ? h("p", { class: "note" }, m.note) : null,
        ),
    m.cohorts.some((c) => c.n > 0)
      ? h("ul", { class: "list", "data-scorecard": "true" }, ...m.cohorts.map((c) => h("li", null, `${c.label}: ${c.n === 0 ? "none checked yet" : `${int(c.covered)} of ${int(c.n)} held (${Math.round(c.coverage * 100)}%)`}`)))
      : h("p", { class: "note" }, "No forecast of this kind has been checked yet: it takes about twelve weeks of days before the first one can be."),
    h("p", { class: "note" }, `Each past day's forecast is made with only what was known then and checked afterwards; a range meant to hold ${Math.round(m.level * 100)}% of the time that held under 70% of the last 20 is widened, and says so. A forecast of list-price estimates, not an invoice and not a limit.`),
  );
}

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
      // Only when a second price source was read: without one there is no change to test, and an empty column would only be noise.
      ...(rows.some((r) => r.flip) ? [{ label: "What would flip it", render: (r) => r.flip || "" }] : []),
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

// What the tool that watches spend spent itself: its planner, drafter, explainer and canary calls, priced like any other and kept apart from the agents' figures.
function deskOwnSection(o) {
  if (!o) return null;
  return section(
    "The Desk's own calls",
    "estimated, kept apart from the agents' spend",
    h("p", null, `${int(o.calls)} model call${o.calls === 1 ? "" : "s"}, ${int(o.tokensIn)} tokens in and ${int(o.tokensOut)} out: ${o.priced === 0 ? "no call was priced" : `${usd(o.micros)} estimated on ${int(o.priced)} priced call${o.priced === 1 ? "" : "s"}`}.${o.unpriced > 0 ? ` ${int(o.unpriced)} ran on a model with no price: counted, not priced.` : ""}${o.failed > 0 ? ` ${int(o.failed)} failed; whether they were billed is not known.` : ""}`),
    table("By role", [{ label: "Role", id: true, render: (r) => r.role }, { label: "Calls", num: true, render: (r) => int(r.calls) }, { label: "Estimated", num: true, render: (r) => (r.priced === 0 ? "not priced" : usd(r.micros)) }], o.byRole),
    h("p", { class: "note" }, o.dailyCapMicros === null ? "No daily limit is set for the Desk's own calls (DESK_OWN_DAILY_CAP_USD); each run is still bounded in calls and seconds." : `Today ${usd(o.spentTodayMicros)} of a daily limit of ${usd(o.dailyCapMicros)}; a call that could pass it is refused before it is sent.`),
  );
}

const BAR_WORDS = { kept: "kept", merged: "merged", committed: "committed" };

// Idle work and spend no project owns, shared among the projects that landed work, in proportion to what each landed.
function overheadSection(o) {
  if (!o || o.state !== "ok") return null;
  const lead = `${usd(o.overheadMicros)} of the period is overhead no project owns: idle work ${usd(o.idleMicros)}${o.sharedMicros > 0 ? `, sessions with no project folder ${usd(o.sharedMicros)}` : ""}.`;
  if (o.overheadMicros === 0) return section("Shared overhead", "nothing to share", h("p", { class: "note" }, "No idle work and no unowned spend in this period."));
  if (o.rows.length === 0) {
    const wider = o.alternatives.filter((a) => a.projects > 0 && a.bar !== o.bar);
    return section(
      "Shared overhead",
      "estimated, unallocated",
      h("p", null, lead),
      h("p", { class: "note" }, `Nothing is allocated: no project has work that reached "${BAR_WORDS[o.bar]}", so ${usd(o.unallocatedMicros)} stays unallocated rather than being divided by guess.${wider.length > 0 ? ` At a lower bar it would be shared: ${wider.map((a) => `"${a.bar}" among ${a.projects} project${a.projects === 1 ? "" : "s"}`).join("; ")}.` : " Few commits are linked, and a missing link is unknown, not proof that nothing landed."}`),
    );
  }
  return section(
    "Shared overhead",
    `estimated, among projects that ${BAR_WORDS[o.bar]} work`,
    h("p", null, lead),
    table(
      "Overhead by project",
      [
        { label: "Project", id: true, render: (r) => r.project },
        { label: "Landed", num: true, render: (r) => usd(r.directMicros) },
        { label: "Share", num: true, render: (r) => `${(r.weight * 100).toFixed(1)}%` },
        { label: "Overhead", num: true, render: (r) => usd(r.allocatedMicros) },
        { label: "With overhead", num: true, render: (r) => usd(r.directMicros + r.allocatedMicros) },
      ],
      o.rows,
    ),
    o.moreRows > 0 ? h("p", { class: "note" }, `And ${int(o.moreRows)} more projects, counted in the total.`) : null,
    h("p", { class: "note" }, `The shares add up to the overhead exactly${o.residualMicros > 0 ? `; ${int(o.residualMicros)} micro-dollar${o.residualMicros === 1 ? "" : "s"} left over by rounding went to ${o.residualTo}, the project with the most landed spend` : ""}. A project that landed nothing bears none of it. ${int(o.landedSessions)} of ${int(o.sessions)} sessions reached "${BAR_WORDS[o.bar]}"; a commit missing from the ledger is unknown, not proof that nothing landed.`),
  );
}

export async function render(ctx) {
  const [d, oh] = await Promise.all([ctx.api("/api/bill", { range: ctx.range }), ctx.api("/api/overhead", { range: ctx.range })]);
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
    d.monthEnd ? monthEndSection(d.monthEnd, d.snapshotId) : null,
    d.reviewTime && (d.reviewTime.approvals > 0 || d.reviewTime.unanswered > 0) ? reviewSection(d.reviewTime) : null,
    d.language ? languageSection(d.language) : null,
    section(
      "Kinds of dollars",
      "billed, reported and estimated: the class of each figure",
      h("p", { "data-coverage": "true" }, d.coverageLine),
      h("ul", { class: "list" }, ...d.classes.map((c) => h("li", null, pill(c.cls, c.cls === "estimated" ? "ink" : ""), " ", c.processes !== undefined ? (c.processes > 0 ? `${int(c.processes)} processes, ${usd(c.micros)}. ` : "none. ") : c.invoices > 0 ? `${int(c.invoices)} invoice${c.invoices === 1 ? "" : "s"}, ${usd(c.micros)}. ` : c.calls > 0 ? `${int(c.calls)} calls${c.micros ? `, ${usd(c.micros)}` : ""}. ` : "none. ", c.note))),
      reconciliationTable(d.reconciliations),
      d.reconciliation
        ? h("p", { class: "note" }, `Against the tool's own figure: ${int(d.reconciliation.match)} of ${int(d.reconciliation.processes)} processes agree. The tool recorded ${usd(d.reconciliation.reportedMicros)} and this estimate is ${usd(d.reconciliation.estimatedMicros)} for the same calls.${d.reconciliation.withSubAgents.processes > 0 ? ` ${int(d.reconciliation.withSubAgents.processes)} used sub-agents, where the tool's counter is known to fall behind (${usd(d.reconciliation.withSubAgents.reportedMicros)} recorded against ${usd(d.reconciliation.withSubAgents.estimatedMicros)} estimated).` : ""} ${d.reconciliation.toleranceNote}`)
        : null,
    ),
    section(
      "What it bought",
      "estimated, by landing state",
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
    section("By day", "estimated spend", h("div", { class: "pair" }, dailyBars(d.daily), table("Last days", [{ label: "Day", render: (r) => r.day }, { label: "Calls", num: true, render: (r) => int(r.calls) }, { label: "Spend", num: true, render: (r) => num(usd(r.micros), PROV.estimated(d.snapshotId, { Rows: open({}, dayWindow(r.day)) })) }], d.daily.slice(-14).reverse(), { maxh: true }))),
    section(
      "Where it went",
      "estimated, by cause",
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
    overheadSection(oh),
    deskOwnSection(d.deskOwn),
    footnote(`List price times logged tokens, with the price snapshot ${d.snapshotId}.`, "A flat plan does not charge per token; this is what the same tokens would cost at list price."),
  );
}
