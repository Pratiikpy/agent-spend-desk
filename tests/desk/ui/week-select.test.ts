import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { elements } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** The weekly review's week links: choosing another week shows that week. The screen once read the choice from the wrong place, so every link showed the newest week. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

describe("the weekly review's week links", () => {
  it("show the week they name", async () => {
    const first = (await (await fetch(`${ui.server.origin}/api/week`, { headers: { "x-desk-token": ui.token } })).json()) as { weeks: string[]; review: { week: { label: string } } };
    expect(first.weeks.length).toBeGreaterThan(2);
    const older = first.weeks.find((w) => w !== first.review.week.label) as string;
    const { screens } = await renderAllScreens(ui, { week: older });
    const root = screens.find((s) => s.id === "week")!.root;
    const heading = elements(root).find((e) => e.el.tag === "h1")!.el.textContent;
    expect(heading).toContain(older);
    expect(heading).not.toContain(first.review.week.label);
  });
});
