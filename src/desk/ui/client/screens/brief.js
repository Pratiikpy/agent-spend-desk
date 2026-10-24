// Morning brief: yesterday in a minute. One recommended action, with the evidence for it.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, hbars, footnote, money, share, PROV, pill } from "../lib/ui.js";
import { num } from "../lib/prov.js";
import { usd, pct, int, dayLabel, CAUSE_LABEL, STATE_LABEL } from "../lib/fmt.js";
import { stackedBar, swatch } from "../lib/charts.js";

export const usesRange = false;

export async function render(ctx) {
  const d = await ctx.api("/api/brief");
  if (d.state === "empty") return h("div", null, head("Morning brief", "Nothing to brief yet"), emptyState(d));
  const snap = d.snapshotId || "the price book";
  const delta = d.previousSpend.estimatedMicros > 0 ? (d.spend.estimatedMicros - d.previousSpend.estimatedMicros) / d.previousSpend.estimatedMicros : null;
  const landed = d.landing.rows.filter((r) => r.state === "kept" || r.state === "merged").reduce((s, r) => s + r.micros, 0);
  const landedShare = d.landing.totalMicros > 0 ? landed / d.landing.totalMicros : 0;
  const waste = d.causes.filter((c) => ["idle", "loops", "cache_misses"].includes(c.cause)).reduce((s, c) => s + c.share, 0);
  const a = d.action;

  return h(
    "div",
    null,
    head("Morning brief", dayLabel(d.day), "Yesterday's spend, what it bought, and the one change worth making."),
    d.runway && d.runway.length > 0
      ? section(
          "Plan limits",
          "from the tool's own readings",
          h(
            "div",
            { class: "cards", "data-runway": "true" },
            ...d.runway.map((r) =>
              h(
                "div",
                { class: "card" },
                h("h3", null, r.label),
                r.usedPct === null ? null : hbars([{ name: "used", share: Math.min(1, r.usedPct / 100), value: `${Math.round(r.usedPct)}%` }]),
                h("p", { class: "note" }, r.head.charAt(0).toUpperCase() + r.head.slice(1) + "."),
                h("p", null, r.detail),
              ),
            ),
          ),
          h("p", { class: "note" }, "The outlook is how past windows of the same plan and length ended when they stood where this one does. It is checked against that plan's own history (docs/verification/runway-2026-10-24.md) and is not a promise."),
        )
      : null,
    section(
      "Yesterday",
      "list-price estimates",
      h(
        "div",
        { class: "stats" },
        stat("Estimated spend", money(d.spend.estimatedMicros, snap), delta === null ? "no earlier day to compare" : `${delta >= 0 ? "up" : "down"} ${pct(Math.abs(delta))} on the day before`),
        stat("Landed", d.landing.linked ? share(landedShare, "the day's spend", { Definition: "sessions merged or kept" }) : "unknown", d.landing.linked ? "of the day's spend reached a merge" : "no repository is linked yet"),
        stat("Idle, loops and cache misses", share(waste, "the day's spend"), "causes a rule can see without judgement", waste >= 0.25),
      ),
    ),
    section(
      "Where it went",
      "by cause",
      hbars(d.causes.map((c) => ({ name: CAUSE_LABEL[c.cause] || c.cause, share: c.share, value: `${pct(c.share)}  ${usd(c.micros)}` }))),
      h("p", { class: "note" }, "A cause is a part of the day's cost, not a verdict. Re-reading the conversation is normal; a loop is not."),
    ),
    section(
      "What it bought",
      d.landing.linked ? "by landing state" : "repositories not linked",
      d.landing.linked
        ? h(
            "div",
            { class: "pair" },
            stackedBar(d.landing.rows, d.landing.totalMicros),
            h("ul", { class: "list" }, ...d.landing.rows.filter((r) => r.micros > 0).map((r) => h("li", null, swatch(r.state), `${STATE_LABEL[r.state]}: `, num(usd(r.micros), PROV.estimated(snap, { Sessions: int(r.sessions) })), ` across ${int(r.sessions)} sessions`))),
          )
        : h("p", { class: "note" }, "Point the Desk at your repositories and each session is tied to the commit it produced. Until then nothing here can say what the money bought."),
    ),
    section(
      "Projects and models",
      "yesterday",
      h(
        "div",
        { class: "cards" },
        h("div", { class: "card s" }, h("h3", null, "By project"), h("ul", { class: "list" }, ...d.projects.slice(0, 6).map((p) => h("li", null, `${p.project}: `, num(usd(p.micros), PROV.estimated(snap)))))),
        h("div", { class: "card s" }, h("h3", null, "By model"), h("ul", { class: "list" }, ...d.models.slice(0, 6).map((m) => h("li", null, `${m.model}: `, m.micros === null ? "unpriced" : num(usd(m.micros), PROV.estimated(snap, { Calls: int(m.calls) })), ` over ${int(m.calls)} calls`)))),
      ),
    ),
    section(
      "One change",
      a ? (a.interval ? "measured on your own windows" : "an upper bound") : "nothing to change",
      a
        ? h(
            "div",
            { class: "card" },
            h("h3", null, a.fix),
            h("p", { class: "note" }, a.interval ? `This cause cost ${usd(a.interval.lowMicros)} to ${usd(a.interval.highMicros)} per window across ${a.windowsUsed} of your windows (80% interval).` : `At most ${usd(a.addressableMicros)} in the heaviest window; the logs do not show how much was avoidable.`),
            h("p", { class: "controls" }, pill(a.basis === "own_history" ? "measured" : "heuristic estimate", a.basis === "own_history" ? "live" : ""), h("a", { class: "btn", href: ctx.link("autopsy", {}) }, "See the autopsy"), h("a", { class: "btn", href: ctx.link("policy", {}) }, "Check it as a policy")),
          )
        : h("p", { class: "note" }, "No cause is large enough to call out a fix."),
    ),
    footnote("Every figure is a list-price estimate from logged tokens, not an invoice.", "Click a figure to see where it comes from."),
  );
}
