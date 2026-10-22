// Sessions: the list, and one session in detail, as a timeline of calls with the cause of each and what it landed as.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, table, footnote, pill, PROV } from "../lib/ui.js";
import { num } from "../lib/prov.js";
import { usd, int, stamp, duration, CAUSE_LABEL, STATE_LABEL, STATE_NOTE } from "../lib/fmt.js";
import { timeline, swatch } from "../lib/charts.js";

export const usesRange = true;

function statePill(state) {
  return pill(STATE_LABEL[state] || state, state === "kept" || state === "merged" ? "live" : state === "reverted" ? "risk" : "");
}

export async function render(ctx) {
  const id = ctx.params.get("id");
  return id ? detail(ctx, id) : list(ctx);
}

async function list(ctx) {
  const sort = ctx.params.get("sort") || "cost";
  const offset = Number(ctx.params.get("offset") || "0");
  const d = await ctx.api("/api/sessions", { range: ctx.range, sort, limit: "50", offset: String(offset) });
  if (d.state === "empty") return h("div", null, head("Sessions", "No sessions yet"), emptyState(d));
  const sel = h("select", { id: "sort", "aria-label": "Sort sessions" }, h("option", { value: "cost" }, "Most expensive"), h("option", { value: "recent" }, "Most recent"), h("option", { value: "calls" }, "Most calls"));
  sel.value = sort;
  sel.addEventListener("change", () => ctx.navigate("sessions", { sort: sel.value, range: ctx.range }));
  const pager = h(
    "div",
    { class: "controls" },
    offset > 0 ? h("a", { class: "btn", href: ctx.link("sessions", { sort, range: ctx.range, offset: String(Math.max(0, offset - d.limit)) }) }, "Newer") : null,
    offset + d.limit < d.total ? h("a", { class: "btn", href: ctx.link("sessions", { sort, range: ctx.range, offset: String(offset + d.limit) }) }, "More") : null,
    h("span", { class: "muted mono" }, `${int(offset + 1)} to ${int(Math.min(d.total, offset + d.limit))} of ${int(d.total)}`),
  );
  return h(
    "div",
    null,
    head("Sessions", `${int(d.total)} sessions`, "Each row is one agent session. Open one to see its calls, what each cost and why."),
    section(
      "List",
      "estimated",
      h("div", { class: "controls" }, h("label", null, "Sort", sel)),
      table(
        "Sessions",
        [
          { label: "Session", id: true, render: (r) => h("a", { href: ctx.link("sessions", { id: r.id, range: ctx.range }) }, r.id.length > 22 ? r.id.slice(0, 20) + "..." : r.id) },
          { label: "Project", render: (r) => r.project },
          { label: "Started", render: (r) => stamp(r.start) },
          { label: "Calls", num: true, render: (r) => int(r.calls) },
          { label: "Spend", num: true, render: (r) => usd(r.micros) },
          { label: "Landed as", render: (r) => statePill(r.state) },
        ],
        d.rows,
      ),
      pager,
    ),
    footnote("Spend is a list-price estimate. Sub-agent calls are counted inside the session that started them."),
  );
}

async function detail(ctx, id) {
  const d = await ctx.api("/api/session", { id });
  if (d.state === "empty") return h("div", null, head("Session", "Not found"), emptyState(d), h("p", null, h("a", { class: "btn", href: ctx.link("sessions", {}) }, "Back to the list")));
  const spanSec = Math.max(1, Math.round((Date.parse(d.endIso) - Date.parse(d.startIso)) / 1000));
  const total = d.calls.reduce((s, c) => s + (c.micros || 0), 0);
  const causes = Object.entries(d.byCause).sort((a, b) => b[1].micros - a[1].micros);
  const unpriced = d.calls.filter((c) => c.class === "unpriced").length;
  return h(
    "div",
    null,
    head("Session", d.project, `${stamp(d.startIso)}, ${duration(spanSec)}, ${int(d.callCount)} calls${d.tool ? `, ${d.tool}${d.toolVersion ? " " + d.toolVersion : ""}` : ""}${d.branch ? `, branch ${d.branch}` : ""}.`),
    section(
      "Summary",
      "estimated",
      h(
        "div",
        { class: "stats" },
        stat("Estimated spend", num(usd(total), PROV.estimated(d.snapshotId)), `${int(d.callCount)} calls`),
        stat("Landed as", STATE_LABEL[d.landing.state] || d.landing.state, STATE_NOTE[d.landing.state] || ""),
        stat("Unpriced calls", int(unpriced), unpriced > 0 ? "no price row: tokens counted, no dollars invented" : "every call priced", unpriced > 0),
      ),
    ),
    section(
      "Timeline",
      "height is cost",
      timeline(d.calls, spanSec),
      h("ul", { class: "list" }, ...Object.keys(CAUSE_LABEL).filter((k) => ["ordinary", "idle", "loops", "subagents", "cache_miss"].includes(k)).map((k) => h("li", null, swatch(k), CAUSE_LABEL[k]))),
      d.truncated ? h("p", { class: "note" }, "Only the first 3,000 calls are drawn.") : null,
    ),
    section(
      "By cause",
      "this session",
      table("Causes", [{ label: "Cause", render: (r) => CAUSE_LABEL[r[0]] || r[0] }, { label: "Calls", num: true, render: (r) => int(r[1].calls) }, { label: "Spend", num: true, render: (r) => usd(r[1].micros) }], causes),
    ),
    section(
      "Commits",
      d.landing.commits.length === 0 ? "none tied" : "how the link was made",
      d.landing.commits.length === 0
        ? h("p", { class: "note" }, "No commit can be tied to this session from the sources available. That is unknowable, not waste.")
        : table("Commits", [{ label: "Commit", id: true, render: (r) => r.sha }, { label: "Repository", render: (r) => r.repo }, { label: "Evidence", render: (r) => `${r.method.replace("_", " ")}, ${r.confidence}` }, { label: "State", render: (r) => (r.reverted ? pill("reverted", "risk") : r.merged ? pill("merged", "live") : pill("committed")) }], d.landing.commits),
    ),
    section(
      "Calls",
      "in order",
      table(
        "Model calls",
        [
          { label: "At", num: true, render: (c) => `${c.offsetSec}s` },
          { label: "Model", id: true, render: (c) => c.model },
          { label: "Cause", render: (c) => h("span", null, swatch(c.cause), CAUSE_LABEL[c.cause] || c.cause) },
          { label: "In", num: true, render: (c) => int(c.tokens.input + c.tokens.read) },
          { label: "Out", num: true, render: (c) => int(c.tokens.output) },
          { label: "Cost", num: true, render: (c) => (c.micros === null ? "unpriced" : num(usd(c.micros), PROV.estimated(c.snapshotId || d.snapshotId, { Call: c.id }))) },
        ],
        d.calls.slice(0, 400),
        { maxh: true },
      ),
      d.calls.length > 400 ? h("p", { class: "note" }, `Showing the first 400 of ${int(d.calls.length)} calls.`) : null,
    ),
    h("p", null, h("a", { class: "btn", href: ctx.link("sessions", {}) }, "Back to the list")),
    footnote(`price snapshot ${d.snapshotId}`),
  );
}
