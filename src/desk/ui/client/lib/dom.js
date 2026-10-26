// Tiny element builders. Text always goes in as text nodes, never as markup, so a string that came from a log
// (a folder name, a branch) cannot inject anything into the page.
const SVG_NS = "http://www.w3.org/2000/svg";

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    if (c instanceof Node) el.append(c);
    else if (typeof c === "string" && c.includes("`") && el.tagName !== "CODE" && el.tagName !== "PRE") {
      // A word between backticks in prose is a command or a name: show it as code, not with the backticks.
      c.split(/`([^`]+)`/).forEach((part, i) => { if (part !== "") el.append(i % 2 === 1 ? Object.assign(document.createElement("code"), { textContent: part }) : document.createTextNode(part)); });
    } else el.append(document.createTextNode(String(c)));
  }
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
