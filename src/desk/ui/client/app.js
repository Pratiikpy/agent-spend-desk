// The shell: launch token, theme, navigation by hash, the global range, and loading and error states.
// No framework and no build step. Screens are modules under /screens, loaded by name from the server's list.
import { h, clear } from "./lib/dom.js";
import { patternDefs } from "./lib/charts.js";
import { closeProvenance } from "./lib/prov.js";
import { errorState, loading } from "./lib/ui.js";

const query = new URLSearchParams(location.search);
const TOKEN = query.get("t") || "";
if (query.has("t")) history.replaceState(null, "", location.pathname + location.hash);

const RANGES = [
  ["7", "Last 7 days"],
  ["14", "Last 14 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["all", "All time"],
];

export async function api(path, params = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { headers: { "x-desk-token": TOKEN }, cache: "no-store" });
  } catch {
    throw new Error("The Desk server did not answer. Is `desk ui` still running in your terminal?");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body && body.message ? body.message : `The server answered ${res.status}.`);
  return body;
}

function readTheme() {
  try {
    return localStorage.getItem("desk-theme");
  } catch {
    return null;
  }
}

function currentTheme() {
  const saved = document.documentElement.getAttribute("data-theme");
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("desk-theme", theme);
  } catch {
    /* a blocked store only means the choice is not remembered */
  }
}

const saved = readTheme();
if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [name, qs] = raw.split("?");
  return { name: name || "brief", params: new URLSearchParams(qs || "") };
}

function link(screen, params) {
  const qs = params.toString();
  return `#/${screen}${qs ? "?" + qs : ""}`;
}

function logo() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const bar = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: 2, y: 11, width: 15, height: 6, fill: "currentColor" })) bar.setAttribute(k, v);
  const disc = document.createElementNS(NS, "circle");
  for (const [k, v] of Object.entries({ cx: 24, cy: 20, r: 5, fill: "currentColor" })) disc.setAttribute(k, v);
  svg.append(bar, disc);
  return svg;
}

async function boot() {
  const app = document.getElementById("app");
  app.append(patternDefs());
  if (!TOKEN) {
    app.append(h("main", { id: "main" }, h("div", { class: "pad" }, errorState("This page needs the launch address that `desk ui` printed in your terminal. It carries a one-time token."))));
    return;
  }
  let meta;
  try {
    meta = await api("/api/meta");
  } catch (e) {
    app.append(h("main", { id: "main" }, errorState(e.message, () => location.reload())));
    return;
  }

  const nav = h("ul", { class: "nav" });
  const rangeSel = h("select", { id: "range", "aria-label": "Time range" }, ...RANGES.map(([v, t]) => h("option", { value: v }, t)));
  const themeBtn = h("button", { type: "button", class: "btn", "aria-pressed": String(currentTheme() === "dark") }, "Dark mode");
  themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    themeBtn.setAttribute("aria-pressed", String(next === "dark"));
  });
  const rangeLabel = h("label", { for: "range" }, "Range");
  const bar = h(
    "header",
    { class: "bar" },
    h(
      "div",
      { class: "bar-in" },
      h("a", { class: "mark", href: "#/brief", "aria-label": "desk., morning brief" }, logo(), h("span", null, "desk.")),
      h("nav", { "aria-label": "Screens" }, nav),
      h("div", { class: "tools" }, rangeLabel, rangeSel, themeBtn),
    ),
  );
  const banners = h("div", null);
  if (meta.mode === "sample") {
    banners.append(h("div", { class: "banner" }, h("div", { class: "banner-in" }, h("span", { class: "kicker" }, "Sample"), h("span", null, "A constructed scenario with planted waste, not a real team's history. Every figure is computed from it by the same code that reads your logs."))));
  }
  if (meta.chainProblem) {
    banners.append(h("div", { class: "banner risk", role: "alert" }, h("div", { class: "banner-in" }, h("span", { class: "kicker" }, "Ledger chain broken"), h("span", null, meta.chainProblem))));
  }
  if (meta.gate && meta.gate.hookInstalled && !meta.gate.reachable) {
    banners.append(h("div", { class: "banner risk", role: "alert" }, h("div", { class: "banner-in" }, h("span", { class: "kicker" }, "Enforcement down"), h("span", null, `The spend hook is installed and the gate is not answering at ${meta.gate.url}, so every tool call it guards is being blocked. Start the gate with \`desk gate serve\`, or open it for 30 minutes with \`desk gate open --for 30m\` (owner only; the opening is signed and every call it lets through is logged).`))));
  }
  if (meta.price && meta.price.stale) {
    banners.append(h("div", { class: "banner risk", role: "status" }, h("div", { class: "banner-in" }, h("span", { class: "kicker" }, "Stale"), h("span", null, `The price list is ${meta.price.ageDays} days old, so every estimate on these screens rests on prices that may have changed. Rebuild it with scripts/build-price-snapshot.ts.`))));
  }
  if (meta.ledgerProblem) {
    banners.append(h("div", { class: "banner risk", role: "alert" }, h("div", { class: "banner-in" }, h("span", { class: "kicker" }, "Ledger"), h("span", null, meta.ledgerProblem))));
  }
  const main = h("main", { id: "main", tabindex: "-1" });
  app.append(bar, banners, main);
  for (const sc of meta.screens) nav.append(h("li", null, h("a", { href: `#/${sc.id}`, "data-screen": sc.id }, h("span", { class: "n" }, sc.number), h("span", null, sc.title))));

  let token = 0;
  let first = true;
  async function render() {
    const { name, params } = parseHash();
    const def = meta.screens.find((x) => x.id === name) || meta.screens.find((x) => x.id === "brief");
    const mine = ++token;
    closeProvenance();
    for (const a of nav.querySelectorAll("a")) {
      if (a.dataset.screen === def.id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = `${def.title} · desk.`;
    clear(main);
    main.append(loading());
    let mod;
    try {
      mod = await import(`./screens/${def.id}.js`);
    } catch (e) {
      clear(main);
      main.append(errorState(`The ${def.title} screen could not be loaded.`));
      return;
    }
    const range = params.get("range") || "30";
    rangeSel.disabled = !mod.usesRange;
    rangeLabel.style.opacity = mod.usesRange ? "1" : "0.5";
    rangeSel.value = RANGES.some(([v]) => v === range) ? range : "30";
    const ctx = {
      api,
      params,
      meta,
      range,
      link: (screen, extra) => {
        const p = new URLSearchParams(extra || {});
        return link(screen, p);
      },
      navigate: (screen, extra) => {
        location.hash = link(screen, new URLSearchParams(extra || {}));
      },
      rerender: () => render(),
    };
    try {
      const node = await mod.render(ctx);
      if (mine !== token) return;
      clear(main);
      main.append(node);
      if (!first) main.focus({ preventScroll: true });
      first = false;
      window.scrollTo(0, 0);
    } catch (e) {
      if (mine !== token) return;
      clear(main);
      main.append(errorState(e.message || "Something went wrong.", () => render()));
    }
  }

  rangeSel.addEventListener("change", () => {
    const { name, params } = parseHash();
    params.set("range", rangeSel.value);
    location.hash = link(name, params);
  });
  window.addEventListener("hashchange", render);
  await render();
}

boot();
