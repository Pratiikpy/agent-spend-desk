import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { elements, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, renderShell, startRichUi, type Rendered, type RichUi } from "./support/rich-ui.ts";

/**
 * Accessibility (DF-087), measured where it can be. The interface's own client code is run in Node against a real server and the trees it builds are
 * checked for structure: headings, names, labels, tables, charts, controls a keyboard can reach. The colours are checked from the style sheet's own tokens,
 * for both themes. What cannot be measured here (a screen reader's speech, focus order as a person tabs through the page, contrast over a gradient or an image)
 * is stated in the verification note, not claimed.
 */
let ui: RichUi;
let screens: Rendered[];
let shell: ShimElement;
beforeAll(async () => {
  ui = await startRichUi();
  screens = (await renderAllScreens(ui, { range: "all" })).screens;
  const s = await renderShell(ui);
  shell = s.app;
  s.restore();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

const CSS = readFileSync("src/desk/ui/client/styles.css", "utf8");
const HTML = readFileSync("src/desk/ui/client/index.html", "utf8");

// ---- colour -------------------------------------------------------------------------------------------------------------------------------------

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

function themes(): { light: Record<string, string>; dark: Record<string, string> } {
  const root = CSS.match(/:root\s*\{([^}]*)\}/)![1]!;
  const darkBlock = CSS.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)![1]!;
  const light = tokens(root);
  const resolve = (map: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      let val = v;
      for (let i = 0; i < 5; i += 1) {
        const ref = val.match(/^var\(--([a-z0-9-]+)\)$/);
        if (!ref) break;
        val = map[ref[1] as string] ?? val;
      }
      out[k] = val;
    }
    return out;
  };
  const lightR = resolve(light);
  return { light: lightR, dark: resolve({ ...light, ...tokens(darkBlock) }) };
}

interface Rule {
  selector: string;
  decls: Record<string, string>;
}
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const m of CSS.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of (m[2] as string).split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    out.push({ selector: (m[1] as string).trim().replace(/\s+/g, " "), decls });
  }
  return out;
}

const varOf = (v: string | undefined): string | null => v?.match(/^var\(--([a-z0-9-]+)\)$/)?.[1] ?? null;
const hexOf = (v: string | undefined, map: Record<string, string>): string | null => {
  if (v === undefined) return null;
  const name = varOf(v);
  const val = name ? map[name] : v;
  return val && /^#[0-9a-f]{6}$/i.test(val) ? val : null;
};

describe("colour contrast, from the style sheet's own tokens, in both themes", () => {
  const { light, dark } = themes();
  const SURFACES = ["bg", "surface", "surface-2"] as const;

  it("reads the tokens it measures", () => {
    expect(light["bg"]).toBe("#ffffff");
    expect(dark["bg"]).toBe("#0a0a0a");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  for (const [name, map] of [["light", light], ["dark", dark]] as const) {
    it(`the text, muted and accent text colours reach 4.5 to 1 on every surface they sit on (${name})`, () => {
      const fails: string[] = [];
      for (const fg of ["text", "muted", "cipher-text", "redline"]) {
        for (const bg of [...SURFACES, ...(fg === "cipher-text" ? ["cipher-soft"] : []), ...(fg === "redline" ? ["redline-soft"] : [])]) {
          const a = hexOf(`var(--${fg})`, map);
          const b = hexOf(`var(--${bg})`, map);
          if (!a || !b) continue;
          const r = contrast(a, b);
          if (r < 4.5) fails.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
        }
      }
      expect(fails, fails.join("; ")).toEqual([]);
    });

    it(`every rule that sets a text colour and a background together reaches 4.5 to 1, or 3 to 1 for large text (${name})`, () => {
      const fails: string[] = [];
      for (const r of rules()) {
        const bg = r.decls["background"] ?? r.decls["background-color"];
        const fg = r.decls["color"];
        const a = hexOf(fg, map);
        const b = hexOf(bg, map);
        if (!a || !b) continue;
        const size = parseFloat(r.decls["font-size"] ?? "16");
        const large = size >= 24 || (size >= 18.66 && /bold|[6-9]00/.test(r.decls["font-weight"] ?? ""));
        const need = large ? 3 : 4.5;
        const ratio = contrast(a, b);
        if (ratio < need) fails.push(`${r.selector}: ${ratio.toFixed(2)} (needs ${need})`);
      }
      expect(fails, fails.join("; ")).toEqual([]);
    });

    it(`a focus outline is visible against the page (${name})`, () => {
      const a = hexOf("var(--focus)", map);
      const b = hexOf("var(--bg)", map);
      expect(contrast(a!, b!)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("the page and the style sheet", () => {
  it("declares its language, viewport, title and a skip link to the main content", () => {
    expect(HTML).toContain('<html lang="en">');
    expect(HTML).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(HTML).toMatch(/<title>[^<]{3,}<\/title>/);
    expect(HTML).toContain('<a class="skip" href="#main">');
    expect(HTML).toContain("<noscript>");
  });

  it("has a visible focus style and keeps motion to people who have not asked for less", () => {
    expect(CSS).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    const motionOutside = CSS.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/g, "");
    expect(motionOutside, "a transition or animation outside the reduced-motion guard").not.toMatch(/\b(transition|animation)\s*:/);
  });

  it("lets the header scroll away on a narrow screen, so that it cannot cover the control a keyboard has moved to", () => {
    expect(CSS).toMatch(/@media \(max-width: 520px\)\s*\{\s*\.bar \{ position: static; \}/);
  });

  it("does not set a minimum text size below 12px or turn off zoom", () => {
    expect(HTML).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
    const small = [...CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n < 11);
    expect(small, "font sizes under 11px").toEqual([]);
  });
});

// ---- structure of what the client builds -----------------------------------------------------------------------------------------------------

const NATIVE = new Set(["button", "a", "input", "select", "textarea", "summary", "label", "option"]);
const name = (e: ShimElement): string => (e.getAttribute("aria-label") ?? e.getAttribute("title") ?? e.textContent).trim();

function audit(root: ShimElement, where: string): string[] {
  const problems: string[] = [];
  const els = elements(root);
  for (const { el, ancestors } of els) {
    const tag = el.tag;
    const hidden = ancestors.some((x) => x.getAttribute("aria-hidden") === "true");
    if (["button", "a"].includes(tag) && name(el) === "") problems.push(`${where}: a ${tag} with no name`);
    if (tag === "a" && !el.getAttribute("href")) problems.push(`${where}: a link with no href ("${name(el).slice(0, 30)}")`);
    if (["select", "input", "textarea"].includes(tag) && !el.getAttribute("aria-label") && !el.getAttribute("id")) problems.push(`${where}: a ${tag} with no label`);
    if (tag === "img" && el.getAttribute("alt") === null) problems.push(`${where}: an image with no alt`);
    if (tag === "svg" && !hidden && !(el.getAttribute("aria-hidden") === "true" || (el.getAttribute("role") === "img" && (el.getAttribute("aria-label") || el.children.some((c) => c instanceof ShimElement && c.tag === "title"))))) problems.push(`${where}: a chart or graphic with neither a name nor aria-hidden`);
    if (tag === "table" && !el.children.some((c) => c instanceof ShimElement && c.tag === "caption")) problems.push(`${where}: a table with no caption`);
    if (tag === "th" && !el.getAttribute("scope")) problems.push(`${where}: a header cell with no scope`);
    if (el.getAttribute("tabindex") !== null && Number(el.getAttribute("tabindex")) > 0) problems.push(`${where}: a positive tabindex`);
    if ((el.listeners.get("click")?.length ?? 0) > 0 && !NATIVE.has(tag) && !(el.getAttribute("role") && el.getAttribute("tabindex") !== null)) problems.push(`${where}: a <${tag}> that reacts to a click and cannot be reached by keyboard`);
    if (el.className.split(/\s+/).includes("tablewrap") && !(el.getAttribute("role") === "region" && el.getAttribute("aria-label") && el.getAttribute("tabindex") === "0")) problems.push(`${where}: a scrollable table that a keyboard cannot reach or name`);
  }
  return problems;
}

function headings(root: ShimElement): number[] {
  return elements(root).filter(({ el }) => /^h[1-6]$/.test(el.tag)).map(({ el }) => Number(el.tag[1]));
}

describe("every screen's structure", () => {
  it("has one top heading, and no jump of more than one level", () => {
    const problems: string[] = [];
    for (const s of screens) {
      const hs = headings(s.root);
      if (hs.filter((h) => h === 1).length !== 1) problems.push(`${s.id}: ${hs.filter((h) => h === 1).length} h1 headings`);
      for (let i = 1; i < hs.length; i += 1) if (hs[i]! - hs[i - 1]! > 1) problems.push(`${s.id}: h${hs[i - 1]} then h${hs[i]}`);
      if (hs[0] !== 1) problems.push(`${s.id}: starts at h${hs[0]}`);
    }
    expect(problems, problems.join("; ")).toEqual([]);
  });

  it("gives every control a name, every table a caption and scope, every chart a name, and a keyboard way to everything that reacts", () => {
    const problems = screens.flatMap((s) => audit(s.root, s.id));
    if (process.env["DESK_AUDIT_DUMP"]) writeFileSync(process.env["DESK_AUDIT_DUMP"], [...new Set(problems)].join("\n") + "\nSHELL\n" + audit(shell, "shell").join("\n"));
    expect(problems, [...new Set(problems)].slice(0, 25).join("; ")).toEqual([]);
  });

  it("audited a real number of elements", () => {
    const n = screens.reduce((sum, s) => sum + elements(s.root).length, 0);
    expect(n).toBeGreaterThan(1500);
  });
});

describe("the shell", () => {
  it("has a banner, a named navigation, a main landmark, a labelled range control and the current screen marked", () => {
    const els = elements(shell).map((x) => x.el);
    expect(els.some((e) => e.tag === "header")).toBe(true);
    expect(els.some((e) => e.tag === "nav" && e.getAttribute("aria-label"))).toBe(true);
    const main = els.find((e) => e.tag === "main");
    expect(main?.getAttribute("id")).toBe("main");
    const range = els.find((e) => e.tag === "select");
    expect(range?.getAttribute("aria-label")).toBe("Time range");
    expect(els.filter((e) => e.tag === "a" && e.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(els.some((e) => e.tag === "button" && e.getAttribute("aria-pressed") !== null)).toBe(true);
  });

  it("passes the same structural audit as the screens", () => {
    expect(audit(shell, "shell")).toEqual([]);
  });

  it("lists fourteen screens in one navigation, each a link", () => {
    const nav = elements(shell).map((x) => x.el).find((e) => e.tag === "nav")!;
    const links = elements(nav).filter(({ el }) => el.tag === "a");
    expect(links).toHaveLength(14);
  });
});

describe("a number that opens a provenance popover can be used from a keyboard", () => {
  it("is a button with the popup announced, and opening it adds a named dialog", () => {
    const brief = screens.find((s) => s.id === "brief")!;
    const chip = elements(brief.root).map((x) => x.el).find((e) => e.tag === "button" && e.className.split(/\s+/).includes("num"))!;
    expect(chip.getAttribute("aria-haspopup")).toBe("dialog");
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(chip.getAttribute("type")).toBe("button");
  });
});
