import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installDom, walk, ShimElement } from "./support/dom-shim.ts";
import { startRichUi, type RichUi } from "./support/rich-ui.ts";

/** Earned autonomy (DF-093) where an owner meets it: a section of the Policy screen, with the code that approves a promotion. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

const get = async (path: string): Promise<Record<string, any>> => (await (await fetch(`${ui.server.origin}${path}`, { headers: { "x-desk-token": ui.token } })).json()) as Record<string, any>;

async function policyScreen(): Promise<ShimElement> {
  const dom = installDom({ origin: ui.server.origin });
  try {
    const api = async (path: string, p: Record<string, string> = {}): Promise<unknown> => {
      const url = new URL(path, ui.server.origin);
      for (const [k, v] of Object.entries(p)) if (v !== "") url.searchParams.set(k, v);
      return (await fetch(url, { headers: { "x-desk-token": ui.token } })).json();
    };
    const meta = await api("/api/meta");
    const mod = (await import(pathToFileURL(resolve("src/desk/ui/client/screens/policy.js")).href)) as { render(ctx: unknown): Promise<ShimElement> };
    return await mod.render({ api, params: new URLSearchParams({ range: "all" }), meta, range: "all", link: (x: string) => `#/${x}`, navigate() {}, rerender() {} });
  } finally {
    dom.restore();
  }
}

describe("the Policy screen's earned autonomy", () => {
  it("carries, for each kind of work, its tier and the counts the tier rests on, and a promotion comes with the code that approves it", async () => {
    const rows = (await get("/api/policy?range=all"))["autonomy"] as { workflow: string; tier: string; finished: number; landed: number; failed: number; pending: number; unlinked: number; rate: number | null; lower: number | null; action: string; code: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["blocked", "supervised", "guarded_auto", "unassisted_auto"]).toContain(r.tier);
      expect(r.landed + r.failed).toBe(r.finished);
      if (r.finished > 0) expect(r.rate).toBeCloseTo(r.landed / r.finished, 10);
      if (r.finished < 30) expect(r.action).not.toBe("propose_promotion");
      expect(r.code === null || /^[0-9a-f]{8}$/.test(r.code)).toBe(true);
      expect(r.code !== null).toBe(r.action === "propose_promotion");
    }
  });

  it("is drawn as a table with its reading and the sentence that says how a kind earns a tier and what still stops it", async () => {
    const root = await policyScreen();
    const section = [...walk(root)].map((w) => w.node).find((n): n is ShimElement => n instanceof ShimElement && n.tag === "section" && n.textContent.includes("Earned autonomy"));
    expect(section, "the Earned autonomy section").toBeDefined();
    const text = section!.textContent;
    expect(text).toContain("What each kind of work has earned");
    expect(text).toContain("30 finished runs and a lower bound of 90% earn guarded auto, which you approve; a revert within 7 days takes it back at once");
    expect(text).toContain("A hard cap and a forbidden action stop a promoted kind as they stop any other");
    expect(text).toMatch(/Finished runs/);
  });
});
