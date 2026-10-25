import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { walk, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** The Bill screen says what a prompt in another script costs over English when the period holds any, and says nothing when it holds none. */
let withLang: RichUi;
let without: RichUi;
beforeAll(async () => {
  withLang = await startRichUi({ withLanguage: true });
  without = await startRichUi();
}, 600_000);
afterAll(async () => {
  await withLang?.close();
  await without?.close();
});

const bill = async (ui: RichUi): Promise<{ language: null | { cells: { language: string; model: string; status: string; ratio: number | null; why: string | null }[]; baselines: unknown[]; totalExtraMicros: number } }> => {
  const res = await fetch(`${ui.server.origin}/api/bill?since=2026-10-01T00:00:00.000Z&until=2026-10-31T23:59:59.999Z`, { headers: { "x-desk-token": ui.token } });
  return (await res.json()) as never;
};
const nodesOf = async (ui: RichUi): Promise<ShimElement[]> => {
  const { screens } = await renderAllScreens(ui, { since: "2026-10-01T00:00:00.000Z", until: "2026-10-31T23:59:59.999Z" });
  const screen = screens.find((s) => s.id === "bill")!;
  return [...walk(screen.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
};

describe("the Language section of the Bill screen", () => {
  it("carries a cell for each language on each model that was found, with a ratio for the ones that have enough prompts and none for the rest", async () => {
    const b = await bill(withLang);
    expect(b.language).not.toBeNull();
    const shown = b.language!.cells.filter((c) => c.status === "shown");
    const refused = b.language!.cells.filter((c) => c.status !== "shown");
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(refused.length).toBeGreaterThanOrEqual(3);
    for (const c of shown) expect(c.ratio).toBeGreaterThan(1.5);
    for (const c of refused) {
      expect(c.ratio).toBeNull();
      expect(c.why).toMatch(/at least 20/);
    }
    expect(b.language!.totalExtraMicros).toBeGreaterThan(0);
  });

  it("is drawn as a table with the ratio against English, a pill that says not enough data where there is none, and a note on what the figure is", async () => {
    const nodes = await nodesOf(withLang);
    const block = nodes.find((n) => n.getAttribute("data-language") === "true");
    expect(block, "the Language section is on the page").toBeDefined();
    const all = nodes.map((n) => n.textContent).join("\n");
    expect(all).toContain("Tokens per character, against English on the same model");
    expect(all).toMatch(/Japanese \(kana\)/);
    expect(all).toMatch(/\d\.\d\dx/);
    expect(all).toContain("too few");
    expect(all).toContain("C-LANG");
    expect(all).toMatch(/at least 20/);
    expect(all).toMatch(/the language may be the one the work needs/i);
  });

  it("is not on the page at all when the period holds no prompt in another script", async () => {
    expect((await bill(without)).language).toBeNull();
    const nodes = await nodesOf(without);
    expect(nodes.some((n) => n.getAttribute("data-language") === "true")).toBe(false);
  });
});
