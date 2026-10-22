// Provenance popovers: every figure can say where it came from. A number is a real button, so the popover is
// reachable by keyboard (Enter or Space opens it, Escape closes it) and announced as a dialog.
import { h } from "./dom.js";

let open = null;

function close() {
  if (!open) return;
  open.pop.remove();
  open.btn.setAttribute("aria-expanded", "false");
  open = null;
}

function place(pop, btn) {
  const r = btn.getBoundingClientRect();
  const width = pop.offsetWidth;
  let left = r.left + window.scrollX;
  const max = window.scrollX + document.documentElement.clientWidth - width - 12;
  if (left > max) left = Math.max(window.scrollX + 12, max);
  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;
}

function show(btn, info) {
  if (open && open.btn === btn) return close();
  close();
  const rows = [];
  for (const [k, v] of Object.entries(info)) {
    if (v === undefined || v === null || v === "") continue;
    rows.push(h("dt", null, k), h("dd", null, v));
  }
  const pop = h("div", { class: "prov", role: "dialog", "aria-label": "Where this number comes from", tabindex: "-1" }, h("span", { class: "kicker" }, "Provenance"), h("dl", null, ...rows));
  document.body.append(pop);
  place(pop, btn);
  btn.setAttribute("aria-expanded", "true");
  open = { pop, btn };
  pop.focus({ preventScroll: true });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && open) {
    const btn = open.btn;
    close();
    btn.focus();
  }
});
document.addEventListener("click", (e) => {
  if (open && !open.pop.contains(e.target) && !open.btn.contains(e.target)) close();
});
window.addEventListener("hashchange", close);
window.addEventListener("resize", close);

/** A number with its provenance. `text` is what is shown; `info` is a record of label to value. */
export function num(text, info, className) {
  const btn = h("button", { type: "button", class: `num${className ? " " + className : ""}`, "aria-haspopup": "dialog", "aria-expanded": "false" }, text);
  btn.addEventListener("click", () => show(btn, info));
  return btn;
}

export function closeProvenance() {
  close();
}
