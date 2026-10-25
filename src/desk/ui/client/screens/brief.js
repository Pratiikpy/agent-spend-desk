// Morning brief: yesterday in a minute. What the gate did while you were away, the canary, the spend and what it bought, and one
// recommended action, by rule, with its evidence. Every figure opens the rows behind it.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, hbars, footnote, money, share, PROV, pill } from "../lib/ui.js";
import { num } from "../lib/prov.js";
import { usd, pct, int, dayLabel, stamp, CAUSE_LABEL, STATE_LABEL } from "../lib/fmt.js";
import { stackedBar, swatch } from "../lib/charts.js";

export const usesRange = false;

const KIND_LABEL = {
  denied: "denied",
  paused: "paused",
  asked: "asked for approval",
  shadow_would_deny: "would have been denied",
  bypass_opened: "bypass opened",
  bypass_allowed: "let through under a bypass",
  expired: "reservation ran out",
};

export async function render(ctx) {
  const asked = ctx.params.get("day");
  const d = await ctx.api("/api/brief", asked ? { day: asked } : {});
  if (d.state === "empty") return h("div", null, head("Morning brief", "Nothing to brief yet"), emptyState(d));
  const snap = d.snapshotId || "the price book";
  const delta = d.previousSpend.estimatedMicros > 0 ? (d.spend.estimatedMicros - d.previousSpend.estimatedMicros) / d.previousSpend.estimatedMicros : null;
  const landed = d.landing.rows.filter((r) => r.state === "kept" || r.state === "merged").reduce((s, r) => s + r.micros, 0);
  const landedShare = d.landing.totalMicros > 0 ? landed / d.landing.totalMicros : 0;
  const waste = d.causes.filter((c) => ["idle", "loops", "cache_misses"].includes(c.cause)).reduce((s, c) => s + c.share, 0);
  const a = d.action;
  // A figure opens the sessions behind it: the same window, narrowed to what the figure is about.
  const rows = (extra, label) => h("a", { href: ctx.link("sessions", { from: d.window.from, to: d.window.to, ...(extra || {}) }) }, label || "See the sessions behind this");
  const stale = (d.sources || []).filter((s) => s.stale);

  return h(
    "div",
    null,
    head("Morning brief", dayLabel(d.day), `${d.noCallOn ? `No call was logged on ${dayLabel(d.noCallOn)}, so this is the last day that has one. ` : ""}Yesterday's spend, what it bought, and the one change worth making. Days are ${d.timeZone === "UTC" ? "UTC" : `in ${d.timeZone}`}.`),
    h(
      "p",
      { class: "controls", "aria-label": "Step through days" },
      d.earlierDay ? h("a", { class: "btn", href: ctx.link("brief", { day: d.earlierDay }) }, `Earlier: ${dayLabel(d.earlierDay)}`) : null,
      d.laterDay ? h("a", { class: "btn", href: ctx.link("brief", { day: d.laterDay }) }, `Later: ${dayLabel(d.laterDay)}`) : null,
      asked ? h("a", { class: "btn", href: ctx.link("brief", {}) }, "Back to yesterday") : null,
    ),
    ...stale.map((s) =>
      h("div", { class: "state", role: "status" }, h("p", null, `${s.label} were last read ${stamp(s.lastReadAt)}, ${Math.round(s.ageHours)} hours ago. Anything since then is missing from this brief. Run `, h("code", null, "desk ingest"), " to read it.")),
    ),
    d.dayIsToday ? h("div", { class: "state", role: "status" }, h("p", null, "The latest calls are from today, so this day is not finished.")) : null,
    section(
      "Overnight",
      "the gate",
      d.gate.state === "not_read"
        ? h("p", { class: "note" }, d.gate.note)
        : h(
            "div",
            null,
            h("p", null, d.gate.line),
            d.gate.events.length > 0
              ? h(
                  "ul",
                  { class: "list" },
                  ...d.gate.events.map((e) =>
                    h("li", null, pill(KIND_LABEL[e.kind] || e.kind, e.kind === "denied" || e.kind === "paused" ? "risk" : ""), ` ${stamp(e.ts)}${e.project ? `, ${e.project}` : ""}${e.model ? `, ${e.model}` : ""}${e.tool ? `, ${e.tool}` : ""}${e.reason ? `: ${e.reason}` : ""}${e.kind === "asked" ? (e.answered ? " (answered)" : " (not answered)") : ""}`),
                  ),
                )
              : null,
            d.gate.total > d.gate.events.length ? h("p", { class: "note" }, `Showing the latest ${d.gate.events.length} of ${int(d.gate.total)}.`) : null,
          ),
    ),
    section(
      "Canary",
      "is the agent still as good",
      d.canary.state === "none"
        ? h("p", { class: "note" }, d.canary.reason)
        : h(
            "div",
            { class: "card", "data-canary": d.canary.verdict },
            h("h3", null, d.canary.words),
            h("p", null, `${d.canary.because.charAt(0).toUpperCase()}${d.canary.because.slice(1)}.`),
            d.canary.changed ? h("p", null, pill("changed", "risk"), ` It was "${d.canary.previous.words}" the run before.`) : d.canary.previous ? h("p", { class: "note" }, `Same as the run before (${d.canary.previous.words}).`) : null,
            d.canary.flip ? h("p", { class: "note", "data-flip": "true" }, `What would flip it: ${d.canary.flip}`) : null,
            d.canary.eligibleFrom ? h("p", { class: "note" }, `A call becomes possible from ${d.canary.eligibleFrom}.`) : null,
            d.canary.notRunning ? h("p", null, pill("not running", "risk"), ` The last run was ${d.canary.lastRun}, ${d.canary.daysSinceRun} days ago.`) : d.canary.lastRun ? h("p", { class: "note" }, `Last run ${d.canary.lastRun}.`) : null,
            d.canary.skipped ? h("p", { class: "note", "data-canary-skipped": "true" }, `Skipped on ${d.canary.skipped.date}: ${d.canary.skipped.reason}`) : null,
            h("p", { class: "controls" }, h("a", { class: "btn", href: ctx.link("canary", {}) }, "Open the canary")),
          ),
    ),
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
                h("p", { class: "note" }, pill("from the tool's own reading", "live"), " ", r.head.charAt(0).toUpperCase() + r.head.slice(1) + "."),
                h("p", null, r.detail),
                r.linear ? h("p", { class: "note", "data-linear": "true" }, r.linear.note) : null,
                r.local ? h("p", { class: "note", "data-local": "true" }, pill("local count", ""), " ", r.local.note) : null,
              ),
            ),
          ),
          h("p", { class: "note" }, "The outlook is how past windows of the same plan and length ended when they stood where this one does. It is checked against that plan's own history (docs/verification/runway-2026-10-24.md) and is not a promise."),
        )
      : null,
    d.quota && d.quota.length > 0
      ? section(
          "Where the next task should go",
          "a plan is close to a limit",
          h(
            "div",
            { class: "cards", "data-quota": "true" },
            ...d.quota.map((q) =>
              h(
                "div",
                { class: "card" },
                h("h3", null, q.action === "route" ? `${q.fromLabel} to ${q.toLabel}` : q.action === "wait" ? `${q.fromLabel}: wait` : `${q.fromLabel}: no room`),
                h("p", null, q.text[0]),
                h("ul", { class: "list" }, ...q.text.slice(1).map((line) => h("li", { class: "note" }, line.trim()))),
                q.costsMoney ? h("p", { class: "note" }, pill("costs money", "risk"), " This route is paid by the token.") : null,
              ),
            ),
          ),
          h("p", { class: "note" }, "A suggestion, not an action: the Desk does not start work in another tool. It never moves work between two accounts of one vendor to get past a limit. desk quota next --from <plan> writes the handoff."),
        )
      : null,
    section(
      "Yesterday",
      "list-price estimates",
      h(
        "div",
        { class: "stats" },
        stat("Estimated spend", money(d.spend.estimatedMicros, snap, { Rows: rows() }), delta === null ? "no earlier day to compare" : `${delta >= 0 ? "up" : "down"} ${pct(Math.abs(delta))} on the day before`),
        stat(
          "Landed",
          d.landing.linked ? share(landedShare, "the day's spend", { Definition: "sessions merged or kept", Rows: rows({ state: "landed" }) }) : "unknown",
          d.landing.linked ? "of the day's spend reached a merge" : "no repository is linked yet",
        ),
        stat("Idle, loops and cache misses", share(waste, "the day's spend", { Rows: rows({}, "See the day's sessions; each timeline marks the calls by cause") }), "causes a rule can see without judgement", waste >= 0.25),
      ),
    ),
    section(
      "Where it went",
      "estimated, by cause",
      hbars(d.causes.map((c) => ({ name: CAUSE_LABEL[c.cause] || c.cause, share: c.share, value: `${pct(c.share)}  ${usd(c.micros)}` }))),
      h("p", { class: "note" }, "A cause is a part of the day's cost, not a verdict. Re-reading the conversation is normal; a loop is not. ", rows({}, "The calls are in the day's sessions.")),
    ),
    section(
      "What it bought",
      d.landing.linked ? "estimated, by landing state" : "repositories not linked",
      d.landing.linked
        ? h(
            "div",
            { class: "pair" },
            stackedBar(d.landing.rows, d.landing.totalMicros),
            h(
              "ul",
              { class: "list" },
              ...d.landing.rows
                .filter((r) => r.micros > 0)
                .map((r) => h("li", null, swatch(r.state), `${STATE_LABEL[r.state]}: `, num(usd(r.micros), PROV.estimated(snap, { Sessions: int(r.sessions), Rows: rows({ state: r.state }) })), ` across ${int(r.sessions)} session${r.sessions === 1 ? "" : "s"}`)),
            ),
          )
        : h("p", { class: "note" }, "Point the Desk at your repositories and each session is tied to the commit it produced. Until then nothing here can say what the money bought."),
    ),
    section(
      "Projects and models",
      "estimated, yesterday",
      h(
        "div",
        { class: "cards" },
        h("div", { class: "card s" }, h("h3", null, "By project"), h("ul", { class: "list" }, ...d.projects.slice(0, 6).map((p) => h("li", null, `${p.project}: `, num(usd(p.micros), PROV.estimated(snap, { Rows: rows({ project: p.project }) })))))),
        h(
          "div",
          { class: "card s" },
          h("h3", null, "By model"),
          h(
            "ul",
            { class: "list" },
            ...d.models.slice(0, 6).map((m) => h("li", null, `${m.model}: `, m.micros === null ? "unpriced" : num(usd(m.micros), PROV.estimated(snap, { Calls: int(m.calls), Rows: rows({ model: m.model }) })), ` over ${int(m.calls)} calls`)),
          ),
        ),
      ),
    ),
    section(
      "One change",
      a ? (a.kind === "canary" ? "the canary moved" : "measured on your own windows") : "nothing to change",
      a && a.kind === "canary"
        ? h("div", { class: "card" }, h("h3", null, a.title), h("p", { class: "note" }, a.detail), h("p", { class: "controls" }, pill("canary", "risk"), h("a", { class: "btn", href: ctx.link("canary", {}) }, "Open the canary")))
        : a
          ? h(
              "div",
              { class: "card" },
              h("h3", null, a.fix),
              h("p", { class: "note" }, a.interval ? `This cause cost ${usd(a.interval.lowMicros)} to ${usd(a.interval.highMicros)} per window across ${a.windowsUsed} of your windows (80% interval).` : `At most ${usd(a.addressableMicros)} in the heaviest window.`),
              h("p", { class: "controls" }, pill("measured", "live"), h("a", { class: "btn", href: ctx.link("autopsy", {}) }, "See the autopsy"), h("a", { class: "btn", href: ctx.link("week", {}) }, "See the week")),
            )
          : h("p", { class: "note" }, d.noActionBecause || "No cause is large enough to call out a fix."),
    ),
    footnote("Every figure is a list-price estimate from logged tokens, not an invoice.", "Click a figure to see where it comes from and the rows behind it."),
  );
}
