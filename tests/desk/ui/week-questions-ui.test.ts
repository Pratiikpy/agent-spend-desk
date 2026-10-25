import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { walk, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** What the weekly review says about the owner's questions (DF-107): how many an answer would move a figure for, and how many were held back from interrupting. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

const get = async (path: string): Promise<{ review: { questions: { open: number; moving: number; topEvoiMicros: number; held: number } } }> => (await fetch(`${ui.server.origin}${path}`, { headers: { "x-desk-token": ui.token } })).json() as never;

describe("the weekly review's open questions", () => {
  it("carries what an answer would move and how many were held back, and draws them in words under the count", async () => {
    const week = ((await (await fetch(`${ui.server.origin}/api/week`, { headers: { "x-desk-token": ui.token } })).json()) as { review: { week: { label: string } } }).review.week.label;
    const d = await get(`/api/week?week=${week}`);
    const q = d.review.questions;
    expect(q.open).toBeGreaterThan(0);
    expect(q.moving).toBeGreaterThanOrEqual(0);
    expect(q.held).toBe(0); // nothing has asked this ledger a question through the governor yet
    const { screens } = await renderAllScreens(ui, { week });
    const root = screens.find((s) => s.id === "week")!.root;
    const note = [...walk(root)].map((w) => w.node).find((n): n is ShimElement => n instanceof ShimElement && n.getAttribute("data-questions-worth") === "true");
    expect(note, "the note under the count of open questions").toBeDefined();
    const text = note!.textContent;
    if (q.moving === 0) expect(text.startsWith("None would move a headline figure if answered yes")).toBe(true);
    else expect(text.startsWith(`${q.moving} of them would move a headline figure if answered yes, the most worth $`)).toBe(true);
    expect([...walk(root)].some((w) => w.node instanceof ShimElement && w.node.getAttribute("data-questions-held") === "true")).toBe(false);
  });
});
