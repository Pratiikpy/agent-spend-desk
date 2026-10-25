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
  const block = ctx.params.get("block");
  return id ? (block ? blockDetail(ctx, id, block) : detail(ctx, id)) : list(ctx);
}

// What a link from another screen narrowed this list to. The same narrowing is sent to the API and kept by the sort and the pager.
const FILTERS = ["from", "to", "project", "model", "state"];
const FILTER_LABEL = { project: "project", model: "model", state: "landing state" };

async function list(ctx) {
  const sort = ctx.params.get("sort") || "cost";
  const offset = Number(ctx.params.get("offset") || "0");
  const filter = {};
  for (const k of FILTERS) if (ctx.params.get(k)) filter[k] = ctx.params.get(k);
  const d = await ctx.api("/api/sessions", { range: ctx.range, sort, limit: "50", offset: String(offset), ...filter });
  if (d.state === "empty") return h("div", null, head("Sessions", "No sessions yet"), emptyState(d));
  const sel = h("select", { id: "sort", "aria-label": "Sort sessions" }, h("option", { value: "cost" }, "Most expensive"), h("option", { value: "recent" }, "Most recent"), h("option", { value: "calls" }, "Most calls"));
  sel.value = sort;
  sel.addEventListener("change", () => ctx.navigate("sessions", { sort: sel.value, range: ctx.range, ...filter }));
  const pager = h(
    "div",
    { class: "controls" },
    offset > 0 ? h("a", { class: "btn", href: ctx.link("sessions", { sort, range: ctx.range, ...filter, offset: String(Math.max(0, offset - d.limit)) }) }, "Newer") : null,
    offset + d.limit < d.total ? h("a", { class: "btn", href: ctx.link("sessions", { sort, range: ctx.range, ...filter, offset: String(offset + d.limit) }) }, "More") : null,
    h("span", { class: "muted mono" }, d.total === 0 ? "none" : `${int(offset + 1)} to ${int(Math.min(d.total, offset + d.limit))} of ${int(d.total)}`),
  );
  const narrowed = Object.keys(filter).length > 0;
  const chips = narrowed
    ? h(
        "p",
        { class: "controls" },
        filter.from ? pill(`${stamp(filter.from)} to ${stamp(filter.to)}`, "") : null,
        ...Object.keys(FILTER_LABEL).filter((k) => filter[k]).map((k) => pill(`${FILTER_LABEL[k]}: ${k === "state" ? STATE_LABEL[filter[k]] || (filter[k] === "landed" ? "merged or kept" : filter[k]) : filter[k]}`, "")),
        h("a", { class: "btn", href: ctx.link("sessions", { sort, range: ctx.range }) }, "Show all"),
      )
    : null;
  return h(
    "div",
    null,
    head("Sessions", `${int(d.total)} sessions`, "Each row is one agent session. Open one to see its calls, what each cost and why."),
    section(
      "List",
      "estimated",
      chips,
      narrowed ? h("p", { class: "note" }, `These ${int(d.total)} session${d.total === 1 ? "" : "s"} add up to ${usd(d.spendMicros)}, the figure you came from.`) : null,
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
    footnote("Spend is a list-price estimate, not an invoice. Sub-agent calls are counted inside the session that started them."),
  );
}

const KIND_LABEL = {
  loops: "A failing command repeated",
  idle: "The agent on its own",
  subagents: "A delegated agent's run",
  cache_miss: "A cache lost",
  echo: "The same error again and again",
  truncation: "A cut-short result asked for again",
  churn: "One file edited again and again",
  reflection: "The model carrying on alone",
  orphan: "A delegated agent after its parent stopped",
};
const ROLE_LABEL = { assistant_text: "said", tool_use: "called", tool_result: "got back" };

function offset(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 120) return `+${s}s`;
  if (s < 7200) return `+${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `+${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const FLAG_NOTE = { deep_delegation_risk: "deeper than five levels", delegation_loop: "a loop in the logs", unlinked_delegation: "no log names who started these" };

function delegationLabel(n) {
  if (n.key === "main") return "The main thread";
  if (n.key === "unlinked") return "Agents no log names the starter of";
  if (n.key.startsWith("wf:")) return `Workflow ${n.name || n.key.slice(3, 11)}`;
  return `Agent ${n.key.slice(0, 8)}`;
}

function delegationSection(d) {
  const t = d.delegation;
  if (!t) return null;
  return section(
    "Delegation",
    "who started which",
    table(
      "Agents",
      [
        { label: "Who", render: (n) => h("span", { class: `depth depth-${Math.min(n.depth, 6)}` }, delegationLabel(n)) },
        { label: "Alone", num: true, render: (n) => usd(n.directMicros) },
        { label: "With its agents", num: true, render: (n) => usd(n.cumulativeMicros) },
        { label: "Calls", num: true, render: (n) => int(n.calls) },
        { label: "Flags", render: (n) => n.flags.map((f) => FLAG_NOTE[f] || f).join("; ") },
      ],
      t.nodes,
      { maxh: true },
    ),
    t.more ? h("p", { class: "note" }, `And ${int(t.more.nodes)} more, costing ${usd(t.more.directMicros)} on their own; they are counted in the totals.`) : null,
    h("p", { class: "note" }, `${int(t.agents)} delegated agent${t.agents === 1 ? "" : "s"}, ${t.maxDepth} level${t.maxDepth === 1 ? "" : "s"} deep, ${usd(t.totalMicros)} in all.${t.unlinkedMicros > 0 ? ` ${usd(t.unlinkedMicros)} sits under agents no log names the starter of: the cost is counted, the link is unknown.` : ""}`),
  );
}

const FIELD_NOTE = { project_path: "the folder", git_branch: "the branch", tool_version: "the client version", edited_path: "an edited file's path", model: "a model name" };
const KIND_NOTE = { ignore_instructions: "tells a reader to ignore its rules", role_markup: "carries markup that imitates a system message", persona_change: "tells a reader it is now someone else", reveal_secrets: "asks a reader to reveal secrets", jailbreak: "asks a reader to drop its limits", tool_call_syntax: "imitates a tool call" };

function clockNote(d) {
  if (!d.clock) return null;
  return h("p", { class: "note" }, `The log this session came from has ${int(d.clock.skewedLines)} line${d.clock.skewedLines === 1 ? "" : "s"} stamped more than a minute before the line above ${d.clock.skewedLines === 1 ? "it" : "them"}${d.clock.futureLines > 0 ? ` and ${int(d.clock.futureLines)} stamped in the future` : ""}: a clock that was set back or forward. Calls are shown in the order the log wrote them, not by their stamps, and spend by day uses the stamps as they are.`);
}

function untrustedSection(d) {
  if (!d.untrusted || d.untrusted.length === 0) return null;
  return section(
    "Instruction-like text in the log",
    "held back from every model request",
    table(
      "Found",
      [
        { label: "Where", render: (r) => FIELD_NOTE[r.field] || r.field },
        { label: "What it does", render: (r) => KIND_NOTE[r.kind] || r.kind },
        { label: "Excerpt", id: true, render: (r) => r.excerpt },
      ],
      d.untrusted,
    ),
    h("p", { class: "note" }, "A name that reads as an instruction is shown to a model as 'withheld', and nothing in a log decides a cost, an outcome or a cap, so this session's figures are unchanged. A harmless name can match too (a branch called ignore-all-lint-rules, say); the excerpt shows what matched."),
  );
}

function blocksSection(ctx, d) {
  if (!d.blocks || d.blocks.length === 0) return section("Waste blocks", "what a rule would have stopped", h("p", { class: "note" }, "No rule flags a block of calls in this session."));
  return section(
    "Waste blocks",
    "what a rule would have stopped",
    table(
      "Waste blocks",
      [
        { label: "What", render: (b) => h("a", { href: ctx.link("sessions", { id: d.id, block: b.id, range: ctx.range }) }, KIND_LABEL[b.kind] || b.kind) },
        { label: "Rule", id: true, render: (b) => (b.confidence === "low" ? `${b.rule} (heuristic)` : b.rule) },
        { label: "Stop point", num: true, render: (b) => offset(b.stopOffsetSec) },
        { label: "Calls", num: true, render: (b) => int(b.calls) },
        { label: "Cost", num: true, render: (b) => usd(b.micros) },
      ],
      d.blocks,
      { maxh: true },
    ),
    d.blockCount > d.blocks.length ? h("p", { class: "note" }, `Showing the ${d.blocks.length} costliest of ${int(d.blockCount)}.`) : null,
    h("p", { class: "note" }, "A block is a run of calls one rule flags together. Open one to see where the rule would have stopped it and why."),
  );
}

async function blockDetail(ctx, id, blockId) {
  const d = await ctx.api("/api/session/block", { id, block: blockId });
  const back = h("p", null, h("a", { class: "btn", href: ctx.link("sessions", { id, range: ctx.range }) }, "Back to the session"));
  if (d.state === "empty") return h("div", null, head("Waste block", "Not found"), emptyState(d), back);
  const b = d.block;
  const c = d.cascade;
  const l = d.lines;
  return h(
    "div",
    null,
    head("Waste block", b.title, `${d.project}, ${offset(b.startOffsetSec)} into the session, ${int(b.calls)} call${b.calls === 1 ? "" : "s"}, ${usd(b.micros)}.`),
    section(
      "Stop point",
      "where the rule would have acted",
      h(
        "div",
        { class: "stats" },
        stat("Stop at", offset(d.stop.offsetSec), d.stop.why),
        stat("Would have saved", num(usd(d.stop.savingMicros), PROV.estimated(d.snapshotId, { Basis: "the cost of the stop call and every later call of the block, at each call's own price snapshot" })), `${int(d.stop.callsAfter)} further call${d.stop.callsAfter === 1 ? "" : "s"} after it; an upper bound`),
        stat("Rule", d.rule.id, b.unpricedCalls > 0 ? `${int(b.unpricedCalls)} call${b.unpricedCalls === 1 ? "" : "s"} on a model with no price, not priced` : "every call priced"),
      ),
      h("ul", { class: "list", "data-sentences": "true" }, ...d.sentences.map((s) => h("li", null, s.text, h("span", { class: "note" }, ` (${s.basis})`)))),
    ),
    section(
      "The rule",
      "its own numbers",
      table(
        "Rule parameters and what was observed",
        [
          { label: "", render: (r) => r.kind },
          { label: "Name", id: true, render: (r) => r.name.replaceAll("_", " ") },
          { label: "Value", num: true, render: (r) => String(r.value) },
        ],
        [...Object.entries(d.rule.params).map(([name, value]) => ({ kind: "the rule's setting", name, value })), ...Object.entries(d.rule.observed).map(([name, value]) => ({ kind: "observed here", name, value }))],
      ),
      h("p", { class: "note" }, "The settings are design parameters of this rule, not tuned on your history."),
    ),
    section(
      "How it unfolded",
      "the failure cascade",
      h("p", null, pill(`confidence ${c.confidence}`, c.confidence === "low" ? "risk" : "live"), " ", c.why),
      c.steps.length === 0
        ? null
        : table(
            "Calls from the first break to the end of the block",
            [
              { label: "At", num: true, render: (s) => offset((s.atMs - (d.stop.atMs - d.stop.offsetSec * 1000)) / 1000) },
              { label: "Tools", render: (s) => s.tools.join(", ") || "none" },
              { label: "What", render: (s) => [s.callId === (c.firstBreak && c.firstBreak.callId) ? "first break" : null, s.repeatsFirstBreak ? "same failure again" : s.failed ? "a different failure" : "no failure", s.opaque ? `opaque: ${s.opaqueWhy}` : null].filter(Boolean).join("; ") },
            ],
            c.steps,
          ),
    ),
    section(
      "The lines",
      "redacted, from your own log",
      l.unreadable ? h("p", { class: "note" }, l.unreadable) : null,
      l.excerpts.length === 0 && !l.unreadable ? h("p", { class: "note" }, "No line was found for these calls in the log file.") : null,
      l.excerpts.length > 0
        ? table(
            "Log lines",
            [
              { label: "Call", id: true, render: (e) => e.callId.slice(-8) },
              { label: "Kind", render: (e) => `${ROLE_LABEL[e.role] || e.role}${e.tool ? ` ${e.tool}` : ""}${e.isError ? " (error)" : ""}` },
              { label: "Excerpt", render: (e) => h("span", { class: "traceline" }, e.text) },
            ],
            l.excerpts,
            { maxh: true },
          )
        : null,
      l.missingCalls.length > 0 && !l.unreadable ? h("p", { class: "note" }, `${int(l.missingCalls.length)} call${l.missingCalls.length === 1 ? "" : "s"} could not be found in the log: shown as a gap, not filled in.`) : null,
      l.missingResults.length > 0 && !l.unreadable ? h("p", { class: "note" }, `${int(l.missingResults.length)} tool use${l.missingResults.length === 1 ? "" : "s"} ha${l.missingResults.length === 1 ? "s" : "ve"} no result in the log: a gap.`) : null,
      h("p", { class: "note" }, "Credentials, paths and long random strings are masked and each line is cut short. Nothing here leaves this machine."),
    ),
    section(
      "Calls and what each cost",
      "price snapshot per call",
      table(
        "Calls",
        [
          { label: "At", num: true, render: (x) => offset(x.offsetSec) },
          { label: "Model", id: true, render: (x) => x.model },
          { label: "Tools", render: (x) => x.tools.join(", ") || "none" },
          { label: "Role", render: (x) => [x.isFirstBreak ? "first break" : null, x.isStop ? "stop point" : null, x.inBlock && !x.isStop ? "in the block" : null, !x.inBlock && !x.isFirstBreak ? "leading in" : null, x.sidechain ? "delegated" : null].filter(Boolean).join(", ") },
          { label: "Snapshot", id: true, render: (x) => x.snapshotId || "none" },
          { label: "Cost", num: true, render: (x) => (x.micros === null ? "unpriced" : usd(x.micros)) },
        ],
        d.calls,
        { maxh: true },
      ),
    ),
    section(
      "What the session landed",
      "from git",
      h("p", { "data-landing-statement": "true" }, d.landing.statement),
      d.landing.after.length > 0 ? table("Commits made after the block", [{ label: "Commit", id: true, render: (x) => x.sha }, { label: "At", render: (x) => stamp(x.authoredAt) }, { label: "Evidence", render: (x) => `${x.method.replace("_", " ")}, ${x.confidence}` }, { label: "State", render: (x) => (x.reverted ? "reverted" : x.merged ? "merged" : "committed") }], d.landing.after) : null,
    ),
    back,
    footnote(`price snapshot ${d.snapshotId}`, "A stop point is a counterfactual on a recorded session: it assumes nothing the agent did later was needed."),
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
    blocksSection(ctx, d),
    delegationSection(d),
    clockNote(d),
    untrustedSection(d),
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
