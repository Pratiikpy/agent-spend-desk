// Hand-written SVG charts. Colour is never the only signal: each landing state and call cause has a distinct
// fill or hatch, a legend with words, and a table beside it.
import { h, s } from "./dom.js";
import { usd, int } from "./fmt.js";

/** One hidden SVG that holds the hatch patterns every chart and swatch refers to by id. */
export function patternDefs() {
  const hatch = (id, cls, flip) =>
    s("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${flip ? 135 : 45})` }, s("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: cls }));
  const svg = s("svg", { width: 0, height: 0, "aria-hidden": "true", focusable: "false" }, s("defs", null, hatch("p-merged", "pat-line", false), hatch("p-unlinked", "pat-weak", true)));
  svg.style.position = "absolute";
  return svg;
}

const LANDING_CLASS = { kept: "seg-kept", merged: "seg-merged", committed: "seg-committed", reverted: "seg-reverted", unlinked: "seg-unlinked" };
const CAUSE_CLASS = { ordinary: "tl-ordinary", idle: "tl-idle", loops: "tl-loops", subagents: "tl-subagents", cache_miss: "tl-cache_miss" };

/** A small legend swatch for a landing state or a call cause. */
export function swatch(kind) {
  const cls = LANDING_CLASS[kind] || CAUSE_CLASS[kind] || "tl-ordinary";
  return h("span", { class: "sw", "aria-hidden": "true" }, s("svg", { width: 16, height: 14, viewBox: "0 0 16 14" }, s("rect", { x: 0.5, y: 0.5, width: 15, height: 13, rx: 2, class: cls })));
}

/** The stacked bar of dollars by landing state. */
export function stackedBar(rows, total) {
  const W = 760;
  const H = 52;
  const label = `Spend by landing state: ${rows.map((r) => `${r.state} ${(r.share * 100).toFixed(0)} percent`).join(", ")}`;
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  let x = 0;
  for (const r of rows) {
    const w = r.share * W;
    if (w <= 0) continue;
    svg.append(s("rect", { x: x.toFixed(2), y: 0, width: Math.max(w, 1.5).toFixed(2), height: H, class: `seg-${r.state}` }, s("title", null, `${r.state}: ${usd(r.micros)} of ${usd(total)}`)));
    x += w;
  }
  return svg;
}

/** Daily spend bars. Labels are the first and last day and the busiest day's value. */
export function dailyBars(days) {
  const W = 760;
  const H = 190;
  const padL = 8;
  const padB = 24;
  const padT = 20;
  const max = Math.max(1, ...days.map((d) => d.micros || 0));
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Daily spend over ${days.length} days, highest ${usd(max)}` });
  svg.append(s("line", { class: "axis", x1: padL, x2: W - 4, y1: H - padB, y2: H - padB }));
  const slot = (W - padL - 4) / Math.max(1, days.length);
  days.forEach((d, i) => {
    const bh = ((d.micros || 0) / max) * (H - padB - padT);
    svg.append(s("rect", { class: "bar-ink", x: (padL + i * slot + slot * 0.12).toFixed(2), y: (H - padB - bh).toFixed(2), width: Math.max(1, slot * 0.76).toFixed(2), height: bh.toFixed(2) }, s("title", null, `${d.day}: ${usd(d.micros)}`)));
  });
  svg.append(s("text", { x: padL, y: 11 }, `peak ${usd(max)}`));
  if (days.length > 0) {
    svg.append(s("text", { x: padL, y: H - 6 }, days[0].day));
    svg.append(s("text", { x: W - 4, y: H - 6, "text-anchor": "end" }, days[days.length - 1].day));
  }
  return svg;
}

/** One session as ticks on a time axis: height follows cost, fill follows cause. */
export function timeline(calls, spanSec) {
  const W = 900;
  const H = 130;
  const padB = 24;
  const max = Math.max(1, ...calls.map((c) => c.micros || 0));
  const span = Math.max(1, spanSec);
  const label = `Timeline of ${calls.length} model calls over ${Math.round(span / 60)} minutes; tick height is cost, fill is cause`;
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  svg.append(s("line", { class: "axis", x1: 0, x2: W, y1: H - padB, y2: H - padB }));
  const tick = Math.max(1.6, (W / Math.max(calls.length, 60)) * 0.7);
  for (const c of calls) {
    const x = (c.offsetSec / span) * (W - 4);
    const bh = Math.max(2, Math.sqrt((c.micros || 0) / max) * (H - padB - 8));
    svg.append(s("rect", { class: `tl-${c.cause}`, x: x.toFixed(2), y: (H - padB - bh).toFixed(2), width: tick.toFixed(2), height: bh.toFixed(2) }));
  }
  svg.append(s("text", { x: 0, y: H - 6 }, "start"));
  svg.append(s("text", { x: W - 2, y: H - 6, "text-anchor": "end" }, `${int(Math.round(span / 60))} min`));
  return svg;
}

/** Pass rate per day for two arms. The baseline days are shaded, a switch of served model is a vertical rule, and the
 * last two windows are bracketed. Line style, not colour, tells the arms apart. */
export function passLines(primary, control, opts) {
  const W = 860;
  const H = 260;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const n = primary.length;
  const x = (day) => padL + ((day - 1) / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (r) => padT + (1 - r) * (H - padT - padB);
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Pass rate by day for the primary arm${control ? " and the control arm" : ""}, ${n} days. ${opts.label || ""}` });
  svg.append(s("rect", { class: "band", x: x(1), y: padT, width: x(opts.baselineDays) - x(1), height: H - padT - padB }));
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(s("line", { class: "axis", x1: padL, x2: W - padR, y1: y(t), y2: y(t) }));
    svg.append(s("text", { x: padL - 6, y: y(t) + 4, "text-anchor": "end" }, `${Math.round(t * 100)}%`));
  }
  const path = (pts) => {
    let d = "";
    let pen = false;
    for (const p of pts) {
      if (p.rate === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p.rate).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  };
  if (control) svg.append(s("path", { class: "ln-control", d: path(control) }));
  svg.append(s("path", { class: "ln-primary", d: path(primary) }));
  for (const sw of opts.switches || []) {
    svg.append(s("line", { class: "rule-risk", x1: x(sw.day), x2: x(sw.day), y1: padT, y2: H - padB }));
    svg.append(s("text", { class: "rl", x: x(sw.day) + 6, y: padT + 12 }, `served model changed, day ${sw.day}`));
  }
  const step = Math.max(1, Math.round(n / 8));
  for (let d = 1; d <= n; d += step) svg.append(s("text", { x: x(d), y: H - 14, "text-anchor": "middle" }, String(d)));
  svg.append(s("text", { x: W - padR, y: H - 2, "text-anchor": "end" }, "day"));
  svg.append(s("text", { x: x(1) + 4, y: H - padB - 6 }, "baseline"));
  return svg;
}
