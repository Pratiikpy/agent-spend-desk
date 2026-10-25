import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { walk, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** The citation check on the Ask screen (DF-108): the answer says how many of its citations the sentences need, and marks a sentence that cites a claim it does not need. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

describe("the Ask screen's citations", () => {
  it("carries, in the answer's data, how many citations the sentences need, and which sentence cites a claim it does not", async () => {
    const res = await fetch(`${ui.server.origin}/api/ask?q=${encodeURIComponent("How much did we spend?")}`, { headers: { "x-desk-token": ui.token } });
    const a = (await res.json()) as { status: string; citations: string | null; sentences: { text: string; cites: string[]; decorative: string[] }[] };
    expect(a.status).toBe("answered");
    expect(a.citations).toMatch(/^\d+ of \d+ citations are needed by the sentence that makes them/);
    for (const s of a.sentences) {
      expect(s.cites.length).toBeGreaterThan(0);
      expect(Array.isArray(s.decorative)).toBe(true);
      for (const d of s.decorative) expect(s.cites).toContain(d);
    }
  });

  it("is drawn on the screen with the way it was tested, and a decorative claim is named beside its sentence", async () => {
    const { screens } = await renderAllScreens(ui, { q: "How much did we spend?" });
    const ask = screens.find((s) => s.id === "ask")!;
    const nodes = [...walk(ask.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
    const note = nodes.find((n) => n.getAttribute("data-citations") === "true");
    expect(note, "the answer's checks name its citations").toBeDefined();
    expect(note!.textContent).toMatch(/^Citations: \d+ of \d+ citations are needed by the sentence that makes them.*Each was tested by taking it away and asking the code Auditor again\.$/);
  });
});
