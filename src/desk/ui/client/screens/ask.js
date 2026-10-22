// Ask the Desk: a question about the ledger, answered only from claims the Auditor has checked, with the way it
// was checked shown. Turn an engine off and the same question gets a different answer.
import { h, clear } from "../lib/dom.js";
import { head, section, footnote, pill, loading } from "../lib/ui.js";

export const usesRange = false;

const ENGINE_NOTE = {
  world_model: "History: what changed, and when",
  markovian: "Long ranges read in bounded chunks",
  hmem: "Your own definitions and corrections",
};

function eventLine(e) {
  const d = e.detail;
  if (e.event === "desk.engine") return `engine ${d.engine}: ${d.impl}, conformance ${d.conformance}${d.ablated ? ", OFF for this run" : ""}`;
  if (e.event === "desk.step") return `step ${d.id} ${d.op}: ${d.rows} rows, query ${String(d.query_hash).slice(0, 19)}`;
  if (e.event === "desk.audit") return `Auditor, attempt ${d.attempt}: ${d.accepted} accepted, ${d.rejected.length} rejected${d.rejected.length ? ` (${d.rejected.map((x) => x.reason).join(", ")})` : ""}`;
  if (e.event === "revision.applied") return "the Explainer revised after a rejection";
  if (e.event === "fallback.used") return `fallback: ${d.reason}`;
  if (e.event === "desk.route") return `route ${d.route}${d.flags && d.flags.length ? `, flags ${d.flags.join(", ")}` : ""}`;
  if (e.event === "desk.plan") return `plan: ${d.intent ? `rules (${d.intent})` : "from the model"}, ops ${(d.ops || []).join(", ")}`;
  return e.event;
}

export async function render(ctx) {
  const q = ctx.params.get("q") || "";
  const ablate = (ctx.params.get("ablate") || "").split(",").filter(Boolean);
  const first = await ctx.api("/api/ask", { q: "" });
  const box = h("input", { id: "q", class: "askbox", type: "text", maxlength: "500", placeholder: "How much of our spend landed?", "aria-label": "Your question", value: q, autocomplete: "off" });
  const checks = first.engines.map((name) => {
    const cb = h("input", { type: "checkbox", id: `eng-${name}`, checked: ablate.includes(name) ? "checked" : undefined });
    cb.checked = ablate.includes(name);
    return { name, cb };
  });
  const out = h("div", { "aria-live": "polite" });
  const go = () => {
    const off = checks.filter((c) => c.cb.checked).map((c) => c.name).join(",");
    ctx.navigate("ask", { q: box.value, ...(off ? { ablate: off } : {}) });
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  const submit = h("button", { type: "button", class: "btn ink" }, "Ask");
  submit.addEventListener("click", go);

  const page = h(
    "div",
    null,
    head("Ask the Desk", "Ask the ledger", "Answers state only what a check on the ledger supports. If the Desk cannot know, it says so."),
    section(
      "Question",
      "read-only",
      h("div", { class: "controls" }, box, submit),
      h("div", { class: "controls" }, ...first.suggestions.slice(0, 5).map((s) => h("a", { class: "btn", href: ctx.link("ask", { q: s, ...(ablate.length ? { ablate: ablate.join(",") } : {}) }) }, s))),
      h("p", { class: "note" }, "Engines. Switch one off and ask again: the answer changes, and the change is the proof the engine does something."),
      h("div", { class: "controls" }, ...checks.map((c) => h("label", { for: `eng-${c.name}` }, c.cb, `off: ${c.name.replace("_", " ")} (${ENGINE_NOTE[c.name]})`))),
    ),
    out,
  );
  if (q.trim() === "") return page;

  out.append(loading("Asking"));
  try {
    const a = await ctx.api("/api/ask", { q, ablate: ablate.join(",") });
    clear(out);
    const verdict = a.status === "answered" ? pill("answered", "live") : a.status === "refused" ? pill("not answered", "risk") : pill("unknowable", "ink");
    out.append(
      section(
        "Answer",
        a.status,
        h("p", { class: "controls" }, verdict, a.ablated.length ? pill(`off: ${a.ablated.join(", ")}`, "risk") : null),
        a.sentences.length > 0 ? h("ul", { class: "list" }, ...a.sentences.map((s) => h("li", null, s.text))) : null,
        a.note ? h("p", { class: "note" }, a.status === "answered" ? `Note: ${a.note}` : a.note) : null,
      ),
      section(
        "How this was checked",
        "the trace",
        h("p", { class: "note" }, `Route ${a.route}. Planner: ${a.planner}. Explainer: ${a.explainer}.${a.servedModel ? ` Model ${a.servedModel}.` : ""} ${a.modelRoute}.`),
        h("ul", { class: "list" }, ...a.events.map((e) => h("li", { class: "traceline" }, eventLine(e)))),
        h("p", { class: "note" }, "Every figure above comes from a typed step run read-only against the ledger. Check an answer again with `desk verify-answer`."),
      ),
    );
  } catch (e) {
    clear(out);
    out.append(h("div", { class: "state error", role: "alert" }, h("span", { class: "kicker" }, "Could not answer"), h("p", null, e.message)));
  }
  page.append(footnote("Ask never changes caps, routes or seats. A change goes through a drafted policy and the approval gate."));
  return page;
}
