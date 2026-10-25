import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OwnerMemory } from "../../../src/desk/engines/memory.ts";
import { walk, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** A question about what the owner told the Desk is answered with the owner's words quoted beside the checked sentences, labelled as not being claims of the Desk. */
let ui: RichUi;
const QUESTION = "What did I tell you about landed work?";
const NOTE = "Work on the billing module counts as landed once it is merged and the checks are green.";
beforeAll(async () => {
  ui = await startRichUi();
  const memory = await OwnerMemory.open({ persistDir: join(ui.dir, "memory") });
  memory.remember({ content: NOTE, kind: "note" });
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

describe("the Ask screen's recalled words", () => {
  it("carries the owner's note in the answer's data and keeps it out of the checked sentences", async () => {
    const res = await fetch(`${ui.server.origin}/api/ask?q=${encodeURIComponent(QUESTION)}`, { headers: { "x-desk-token": ui.token } });
    const a = (await res.json()) as { status: string; sentences: { text: string }[]; yourWords: { id: string; recordedOn: string; text: string }[] };
    expect(a.status).toBe("answered");
    expect(a.yourWords.map((w) => w.text)).toEqual([NOTE]);
    expect(a.sentences.map((s) => s.text).join(" ")).not.toContain("billing module");
  });

  it("is drawn as a quotation under a label that says it is not a claim of the Desk", async () => {
    const { screens } = await renderAllScreens(ui, { q: QUESTION });
    const ask = screens.find((s) => s.id === "ask")!;
    const nodes = [...walk(ask.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
    const block = nodes.find((n) => n.getAttribute("data-your-words") === "true");
    expect(block, "the answer shows the owner's words").toBeDefined();
    expect(block!.textContent).toContain("Your words, quoted. These are not claims of the Desk.");
    expect(block!.textContent).toContain(NOTE);
    expect(nodes.some((n) => n.tagName.toLowerCase() === "q" && n.textContent === NOTE)).toBe(true);
  });

  it("shows no such block for a question that uses no note", async () => {
    const { screens } = await renderAllScreens(ui, { q: "How much did we spend?" });
    const ask = screens.find((s) => s.id === "ask")!;
    const nodes = [...walk(ask.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
    expect(nodes.some((n) => n.getAttribute("data-your-words") === "true")).toBe(false);
  });
});
