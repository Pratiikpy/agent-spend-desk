// Policy: the rules in force, the restrict-only check against another version, a replay on recorded sessions,
// and the wind tunnel. A policy is checked before it is proposed, never after.
import { h, clear } from "../lib/dom.js";
import { head, section, stat, emptyState, table, footnote, pill, loading } from "../lib/ui.js";
import { usd, pct, int } from "../lib/fmt.js";

export const usesRange = true;

export async function render(ctx) {
  const d = await ctx.api("/api/policy", { range: ctx.range, from: ctx.params.get("from") || "", to: ctx.params.get("to") || "" });
  if (d.state === "empty") return h("div", null, head("Policy", "No policy yet"), emptyState(d));
  const names = d.files.map((f) => f.name);
  const pick = (label, key, value, withNone) => {
    const el = h("select", { id: `pol-${key}`, "aria-label": label }, withNone ? h("option", { value: "" }, "none") : null, ...names.map((n) => h("option", { value: n }, n)));
    el.value = value || "";
    el.addEventListener("change", () => ctx.navigate("policy", { from: key === "from" ? el.value : d.selected.from || "", to: key === "to" ? el.value : d.selected.to, range: ctx.range }));
    return h("label", null, label, el);
  };
  const cur = d.files.find((f) => f.name === d.selected.to);
  const r = d.restrict;
  const rp = d.replay;
  const tunnelBox = h("div", null);
  const runTunnel = h("button", { type: "button", class: "btn ink" }, "Run the wind tunnel");
  runTunnel.addEventListener("click", async () => {
    clear(tunnelBox);
    tunnelBox.append(loading("Resampling the history"));
    try {
      const t = await ctx.api("/api/policy/tunnel", { policy: d.selected.to, range: ctx.range });
      clear(tunnelBox);
      if (t.status === "too_little_history") {
        tunnelBox.append(h("div", { class: "state" }, h("span", { class: "kicker" }, "Too little history"), h("p", null, `${int(t.sessions)} sessions are too few to resample a month. The wind tunnel needs more history before it will give a number.`)));
        return;
      }
      tunnelBox.append(
        h(
          "div",
          { class: "stats" },
          stat("Chance a month blocks landed work", pct(t.pBlockedLanded.mid), `90% interval ${pct(t.pBlockedLanded.low)} to ${pct(t.pBlockedLanded.high)}`, t.pBlockedLanded.mid > 0.05),
          stat("Saved per month", usd(t.savedMicros.mid), `90% interval ${usd(t.savedMicros.low)} to ${usd(t.savedMicros.high)}`),
          stat("Drift", t.drift ? (t.drift.flagged ? "flagged" : "none") : "n/a", t.drift ? `p ${t.drift.p.toFixed(3)}; the last four weeks ${t.drift.flagged ? "differ from" : "match"} the earlier history` : "too little history to test", Boolean(t.drift && t.drift.flagged)),
        ),
        h("p", { class: "note" }, `${int(t.simulatedMonths)} simulated months from ${int(t.sessions)} sessions. The method assumes next month looks like the past. A new model, a new team or a new tool breaks that, and the drift flag only catches some of it.`),
        t.measured ? h("p", { class: "note" }, `Measured on constructed samples with a change planted in the second month: the 90% one-month range held the realized month in ${t.measured.inside} of ${t.measured.trials} (${pct(t.measured.coverage)}, 95% interval ${pct(t.measured.low)} to ${pct(t.measured.high)}), so read it as a screen rather than a promise.${t.measured.eceRaw !== null ? ` Its chance of blocking landed work had a calibration error of ${t.measured.eceRaw.toFixed(2)}.` : ""}`) : null,
      );
    } catch (e) {
      clear(tunnelBox);
      tunnelBox.append(h("div", { class: "state error", role: "alert" }, h("span", { class: "kicker" }, "Could not run"), h("p", null, e.message)));
    }
  });

  return h(
    "div",
    null,
    head("Policy", d.selected.to, "A spend policy is a short document. Forbid, permit, route. The check below tells you whether a change only narrows the old one."),
    section(
      "Choose",
      "files in policies/",
      h("div", { class: "controls" }, pick("Candidate", "to", d.selected.to, false), pick("Compare with", "from", d.selected.from, true)),
      d.valid ? null : h("div", { class: "state error", role: "alert" }, h("span", { class: "kicker" }, "Invalid policy"), h("p", null, d.error)),
    ),
    section(
      "Rules",
      cur ? `version of ${cur.name}` : "",
      cur && cur.rules.length > 0
        ? h("div", null, ...cur.rules.map((x) => h("div", { class: "rule" }, h("span", { class: "id" }, x.id), pill(x.kind, x.kind === "forbid" ? "risk" : x.kind === "route" ? "ink" : ""), h("span", { class: "what" }, x.summary))))
        : h("p", { class: "note" }, "This file has no rules."),
      cur ? h("details", null, h("summary", { class: "kicker" }, "Source"), h("pre", { class: "src" }, cur.source)) : null,
    ),
    section(
      "Restrict-only check",
      r ? `against ${r.from}` : "needs a second version",
      r
        ? h(
            "div",
            null,
            h("div", { class: r.narrows ? "bigverdict pass" : "bigverdict fail" }, r.narrows ? `Narrows only, checked over all ${int(r.gridSize)} cells.` : "This change widens the policy."),
            r.widening ? h("p", { class: "note" }, `Counterexample: ${r.widening}`) : null,
            r.routeChanges > 0 ? h("p", { class: "note" }, `${int(r.routeChanges)} route changes alter behaviour. They are not narrowings and need their own approval.`) : null,
            r.outsideFragment ? h("p", { class: "note" }, "The grid was too large to check exhaustively here. A stronger checker must run before this is applied.") : null,
          )
        : h("p", { class: "note" }, "Choose a second policy to compare. The check proves, over every combination of the dimensions the rules name, that the candidate permits nothing the other denied."),
    ),
    section(
      "Replay",
      "recorded sessions, counterfactual",
      rp
        ? h(
            "div",
            null,
            h(
              "div",
              { class: "stats" },
              stat("Sessions paused", int(rp.pausedSessions), `of ${int(rp.sessions)} in the period`),
              stat("Not spent", usd(rp.savedMicros), "an upper bound: a paused session is assumed to do nothing more"),
              stat("Landed work blocked", `${int(rp.landedBlocked)} of ${int(rp.landedTotal)}`, "sessions that reached a merge and would have been paused", rp.landedBlocked > 0),
            ),
            rp.pausedByDefaultDeny > 0 ? h("p", { class: "note" }, `${int(rp.pausedByDefaultDeny)} of the paused sessions were stopped because no permit matched, not by a rule written to stop waste.`) : null,
          )
        : h("p", { class: "note" }, "Nothing to replay."),
      h("p", { class: "note" }, "A replay re-runs recorded sessions through the policy. It cannot say a paused task would have finished, or that the owner would have approved an ask."),
    ),
    section("Wind tunnel", "how a month could go", h("div", { class: "controls" }, runTunnel), tunnelBox),
    footnote("The interpreter that decides here is the one the gate uses.", "Nothing on this page changes a policy."),
  );
}
