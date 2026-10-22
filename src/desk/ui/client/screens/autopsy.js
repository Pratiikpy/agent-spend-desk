// Limit autopsy: where did the window go, and which fix is worth making. The same figures as `desk card`.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, hbars, footnote, pill, share } from "../lib/ui.js";
import { usd, pct, dayLabel, timeLabel, CAUSE_LABEL } from "../lib/fmt.js";
import { num } from "../lib/prov.js";

export const usesRange = false;

export async function render(ctx) {
  const hours = ctx.params.get("hours") || "5";
  const days = ctx.params.get("days") || "14";
  const d = await ctx.api("/api/autopsy", { hours, days });
  if (d.state === "empty") return h("div", null, head("Limit autopsy", "Nothing to explain yet"), emptyState(d));
  const c = d.card;
  const select = (label, name, value, options) => {
    const el = h("select", { id: name, "aria-label": label }, ...options.map(([v, t]) => h("option", { value: v }, t)));
    el.value = value;
    el.addEventListener("change", () => ctx.navigate("autopsy", { hours: name === "hours" ? el.value : hours, days: name === "days" ? el.value : days }));
    return h("label", null, label, el);
  };
  return h(
    "div",
    null,
    head("Limit autopsy", "Where did the window go?", `${dayLabel(c.window.startIso)}, ${timeLabel(c.window.startIso)} to ${timeLabel(c.window.endIso)}. The heaviest ${c.window.hours}-hour window in the last ${c.period.days} days.`),
    section(
      "Window",
      "list-price estimates",
      h("div", { class: "controls" }, select("Window", "hours", hours, [["1", "1 hour"], ["5", "5 hours"], ["24", "24 hours"]]), select("Look back", "days", days, [["7", "7 days"], ["14", "14 days"], ["30", "30 days"]])),
      h(
        "div",
        { class: "stats" },
        stat("Estimated cost", num(usd(c.totals.estimatedMicros), { Class: "estimated", Not: "an invoice or a bill", Calls: String(c.totals.pricedCalls) }), `${c.totals.pricedCalls.toLocaleString("en-US")} priced calls`),
        stat("Burn per hour", usd(c.burnMicrosPerHour), "over the window"),
        stat("Idle, loops and cache misses", share(c.wasteShare, "the window's cost"), "causes a rule can see without judgement", c.wasteShare >= 0.25),
      ),
    ),
    section("Causes", "every cost sits in exactly one", hbars(c.causes.map((x) => ({ name: CAUSE_LABEL[x.cause] || x.label, share: x.share, value: `${pct(x.share)}  ${usd(x.micros)}` })))),
    section(
      "Fixes",
      "ranked by what the cause cost",
      c.fixes.length === 0
        ? h("p", { class: "note" }, "No cause is large enough (5% of the window) to call out a fix.")
        : h(
            "div",
            null,
            ...c.fixes.slice(0, 5).map((f, i) =>
              h(
                "div",
                { class: "fix" },
                h("span", { class: "idx" }, String(i + 1).padStart(2, "0")),
                h("div", null, h("div", null, f.fix), h("div", { class: "saving" }, f.interval ? `${usd(f.interval.lowMicros)} to ${usd(f.interval.highMicros)} per window, 80% interval over ${f.windowsUsed} of your windows` : `up to ${usd(f.addressableMicros)} in this window, an upper bound`), pill(f.basis === "own_history" ? "measured on your history" : "heuristic estimate", f.basis === "own_history" ? "live" : "")),
              ),
            ),
          ),
    ),
    section("What I could not know", "said every time", h("ul", { class: "list" }, ...c.couldNotKnow.map((t) => h("li", null, t)))),
    footnote(`figures ${c.figuresHash.slice(0, 19)}`, "The same card is written by `desk card`."),
  );
}
