// Shared pieces: screen header, sections with the narrow meta column, stat cards, states, tables, bars.
import { h } from "./dom.js";
import { num } from "./prov.js";
import { pct, usd } from "./fmt.js";

export function head(kicker, title, lead) {
  return h("header", { class: "head" }, h("div", { class: "meta kicker" }, kicker), h("div", null, h("h1", null, title), lead ? h("p", { class: "lead" }, lead) : null));
}

export function section(label, sub, ...body) {
  // The label is the section's heading, so a screen reader can list and jump between the sections; it is drawn as the small label it always was.
  return h("section", { class: "sec" }, h("h2", { class: "meta" }, label, sub ? h("span", { class: "sub" }, sub) : null), h("div", { class: "body" }, ...body));
}

export function stat(label, value, foot, risk) {
  return h("div", { class: "stat" }, h("div", { class: "label" }, label), h("div", { class: `value${risk ? " risk" : ""}` }, value), foot ? h("div", { class: "foot" }, foot) : null);
}

export function pill(text, kind) {
  return h("span", { class: `pill${kind ? " " + kind : ""}` }, text);
}

export function loading(message) {
  return h("div", { class: "loading", role: "status", "aria-live": "polite" }, h("span", { class: "kicker" }, message || "Reading the ledger"), h("div", { class: "skel w1" }), h("div", { class: "skel w2" }), h("div", { class: "skel w3" }));
}

export function emptyState(data) {
  return h("div", { class: "state", role: "status" }, h("span", { class: "kicker" }, "Nothing here yet"), h("p", null, data.reason || "There is nothing to show."), data.hint ? h("p", { class: "hint" }, data.hint) : null);
}

export function errorState(message, retry) {
  return h("div", { class: "state error", role: "alert" }, h("span", { class: "kicker" }, "Could not load"), h("p", null, message), retry ? h("div", null, h("button", { type: "button", class: "btn", onclick: retry }, "Try again")) : null);
}

/** A table in a focusable, scrollable wrapper. `cols` is [{label, num?, id?, render(row)}]. */
export function table(caption, cols, rows, opts = {}) {
  const t = h(
    "table",
    null,
    h("caption", { class: "kicker" }, caption),
    h("thead", null, h("tr", null, ...cols.map((c) => h("th", { scope: "col", class: c.num ? "num" : "" }, c.label)))),
    h("tbody", null, ...rows.map((r) => h("tr", null, ...cols.map((c) => h("td", { class: `${c.num ? "num" : ""}${c.id ? " id" : ""}`.trim(), "data-label": c.label }, c.render(r)))))),
  );
  return h("div", { class: `tablewrap${opts.maxh ? " maxh" : ""}`, tabindex: "0", role: "region", "aria-label": caption }, t);
}

/** Horizontal bars as html: name, value and share, with a track. `rows` is [{name, share, value}]. */
export function hbars(rows) {
  return h(
    "div",
    { class: "hbars" },
    ...rows.map((r) => {
      const fill = h("span", { class: "fill" });
      fill.style.width = `${Math.max(r.share > 0 ? 0.6 : 0, r.share * 100)}%`;
      return h("div", { class: "hb" }, h("span", { class: "name" }, r.name), h("span", { class: "vals" }, r.value), h("span", { class: "track", "aria-hidden": "true" }, fill));
    }),
  );
}

export function footnote(...bits) {
  return h("div", { class: "footnote" }, h("span", { class: "barmark", "aria-hidden": "true" }), ...bits.map((b) => h("span", null, b)));
}

/** Provenance presets, so every screen says the same true thing about the same kind of figure. */
export const PROV = {
  estimated: (snapshotId, extra) => ({ Class: "estimated: list price times logged tokens", Not: "an invoice or a bill", Snapshot: snapshotId, ...extra }),
  share: (of, extra) => ({ Class: "share", Of: of, ...extra }),
  count: (source, extra) => ({ Class: "count", Source: source, ...extra }),
  computed: (how, extra) => ({ Class: "computed", How: how, ...extra }),
};

export function money(micros, snapshotId, extra) {
  return num(usd(micros), PROV.estimated(snapshotId, extra));
}

export function share(value, of, extra) {
  return num(pct(value), PROV.share(of, extra));
}
