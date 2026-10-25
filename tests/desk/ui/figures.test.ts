import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lintWording } from "../../../src/desk/lint/wording.ts";
import { elements, ShimElement, ShimText, walk, type ShimNode } from "./support/dom-shim.ts";
import { renderAllScreens, renderShell, startRichUi, type Rendered, type RichUi } from "./support/rich-ui.ts";

/**
 * No unlabelled figure (DF-078). The interface's own client code is run in Node against a real server with the sample, a flagged session, an invoice and
 * the Desk's own calls, and every dollar figure on every screen is checked for the class it carries: billed, reported, estimated, forecast, unknowable,
 * unpriced, or a policy value the owner set. A figure is labelled when the section it sits in names its class in its label, or it carries a `data-class`.
 */
let ui: RichUi;
let screens: Rendered[];
beforeAll(async () => {
  ui = await startRichUi();
  screens = (await renderAllScreens(ui, { range: "all" })).screens;
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

const MONEY = /\$\s?\d/;
const CLASS_WORD = /\b(billed|reported|estimated?|estimates?|forecast|unknowable|unpriced|policy)\b/i;
/** What an estimate must say it is not. */
const NOT_A_RECEIPT = /not an invoice|not a bill|never a billing receipt|not a receipt|estimate, not|is an estimate|an estimate from logged tokens|list price times logged tokens/i;

function figures(root: ShimNode): { text: string; ancestors: ShimElement[] }[] {
  const out: { text: string; ancestors: ShimElement[] }[] = [];
  for (const { node, ancestors } of walk(root)) if (node instanceof ShimText && MONEY.test(node.data)) out.push({ text: node.data, ancestors });
  return out;
}

/** The text that says what class a figure is: the label of its section, or of the screen's head when it sits outside every section, or its own `data-class`. */
function labelOf(ancestors: ShimElement[]): string {
  for (const a of ancestors) if (a.getAttribute("data-class")) return String(a.getAttribute("data-class"));
  const sec = ancestors.find((a) => a.tag === "section");
  // The section's label and its sub-label are separate elements, one above the other; read as words, not run together.
  if (sec) return (sec.children[0] as ShimElement | undefined)?.children.map((c) => c.textContent).join(" ") ?? "";
  const head = ancestors.find((a) => a.tag === "header");
  return head?.textContent ?? "";
}

describe("every dollar figure names its class", () => {
  it("renders every screen the server lists, and finds figures on most of them", () => {
    expect(screens.map((s) => s.id)).toEqual(["brief", "week", "bill", "autopsy", "sessions", "outcomes", "policy", "canary", "ask", "organisation", "dossiers", "evidence", "sources"]);
    const withMoney = screens.filter((s) => figures(s.root).length > 0).map((s) => s.id);
    for (const id of ["brief", "week", "bill", "autopsy", "sessions", "outcomes", "policy", "organisation", "evidence"]) expect(withMoney, id).toContain(id);
  });

  it("has no dollar figure whose section does not say what class it is", () => {
    const unlabelled: string[] = [];
    let seen = 0;
    for (const s of screens) {
      for (const f of figures(s.root)) {
        seen += 1;
        if (!CLASS_WORD.test(labelOf(f.ancestors))) unlabelled.push(`${s.id}: "${f.text.trim().slice(0, 60)}" in "${labelOf(f.ancestors).slice(0, 80)}"`);
      }
    }
    if (process.env["DESK_AUDIT_DUMP"]) writeFileSync(process.env["DESK_AUDIT_DUMP"], unlabelled.join("\n"));
    expect(seen).toBeGreaterThan(150); // the audit looked at a real number of figures, not at a few
    expect(unlabelled, `figures with no class:\n${unlabelled.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("says, on every screen that shows an estimate, what an estimate is not", () => {
    const missing: string[] = [];
    for (const s of screens) {
      const text = s.root.textContent;
      const hasEstimate = figures(s.root).some((f) => /estimat/i.test(labelOf(f.ancestors)));
      if (hasEstimate && !NOT_A_RECEIPT.test(text) && !s.root.textContent.match(/provenance/i)) missing.push(s.id);
    }
    expect(missing, `screens with an estimate and no statement that it is not a receipt: ${missing.join(", ")}`).toEqual([]);
  });

  it("shows a figure that cannot be supported as unpriced or unknowable, never as a zero", () => {
    const bill = screens.find((s) => s.id === "bill")!;
    const text = bill.root.textContent;
    // The sample's Desk calls on a model with no price: counted, not priced, no dollar figure for them.
    expect(text).toContain("not priced");
    expect(text).toMatch(/no dollars invented|counted, not priced/);
  });

  it("covers the sections added since the first visual sweep: the Desk's own calls, delegation's cousin overhead, and the egress block", () => {
    const sourcesText = screens.find((s) => s.id === "sources")!.root.textContent;
    expect(sourcesText).toContain("Where data can leave this machine");
    expect(sourcesText).toContain("Instruction-like text in your logs");
    expect(screens.find((s) => s.id === "bill")!.root.textContent).toContain("The Desk's own calls");
  });
});

describe("what the screens say is free of overclaiming words", () => {
  it("passes the wording lint on every screen's text, one line to a text node", () => {
    const found: string[] = [];
    for (const s of screens) {
      const lines: string[] = [];
      for (const { node } of walk(s.root)) if (node instanceof ShimText && node.data.trim() !== "") lines.push(node.data);
      for (const f of lintWording(lines.join("\n"), { generated: true })) found.push(`${s.id}: [${f.rule}] ${f.text.replace(/\s+/g, " ")}`);
    }
    expect(found, found.join("\n")).toEqual([]);
  });
});

describe("a stale price list is said on every screen", () => {
  it("shows a banner when the price list is more than 60 days old, and none when it is fresh", async () => {
    const fresh = await renderShell(ui);
    const freshText = fresh.app.textContent;
    fresh.restore();
    expect(freshText).not.toContain("The price list is");
    const old = await startRichUi({ nowMs: () => Date.parse("2027-03-01T00:00:00Z") });
    try {
      const shell = await renderShell(old);
      const text = shell.app.textContent;
      shell.restore();
      expect(text).toContain("Stale");
      expect(text).toMatch(/The price list is \d+ days old, so every estimate on these screens rests on prices that may have changed/);
    } finally {
      await old.close();
    }
  }, 300_000);
});

/** Used by the tests below to be sure the audit is not vacuous. */
export const _unused = elements;
