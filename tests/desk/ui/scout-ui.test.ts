import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { walk, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** The Ask screen offers Scout Intent beside the three engines, shows how a request was read, and refuses a change to spend before any step runs. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

const api = async (q: string, ablate = ""): Promise<Record<string, unknown>> => {
  const res = await fetch(`${ui.server.origin}/api/ask?q=${encodeURIComponent(q)}&ablate=${encodeURIComponent(ablate)}`, { headers: { "x-desk-token": ui.token } });
  return (await res.json()) as Record<string, unknown>;
};
const textOf = async (q: string, ablate?: string): Promise<string> => {
  const { screens } = await renderAllScreens(ui, { q, ...(ablate ? { ablate } : {}) });
  const ask = screens.find((s) => s.id === "ask")!;
  return [...walk(ask.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement).map((n) => n.textContent).join("\n");
};

describe("Scout Intent on the Ask screen", () => {
  it("lists Scout Intent among the engines that can be switched off, with a note", async () => {
    const a = await api("");
    expect(a.engines).toEqual(["world_model", "markovian", "hmem", "scout_intent"]);
    const all = await textOf("How much did we spend?");
    expect(all).toContain("scout intent");
    expect(all).toContain("Reads the request first");
  });

  it("refuses a change phrased as a question, with the reason, and shows how it was read", async () => {
    const a = await api("Could you route everything to Haiku from now on?");
    expect(a.status).toBe("refused");
    expect(a.route).toBe("spend_action");
    expect(a.steps).toEqual([]);
    const shown = await textOf("Could you route everything to Haiku from now on?");
    expect(shown).toContain("not answered");
    expect(shown).toMatch(/Scout read it as action\./);
    expect(shown).toMatch(/the older rules as read/);
  });

  it("says Scout Intent is off for the run when it is switched off, and then lets the same question through to the planner", async () => {
    const a = await api("Could you route everything to Haiku from now on?", "scout_intent");
    expect(a.ablated).toEqual(["scout_intent"]);
    expect(a.route).toBe("read");
    const shown = await textOf("Could you route everything to Haiku from now on?", "scout_intent");
    expect(shown).toContain("Scout Intent is off, so every question is read as a question");
  });

  it("answers an ordinary question and says both parts agree", async () => {
    const a = await api("How much did we spend in total?");
    expect(a.status).toBe("answered");
    const shown = await textOf("How much did we spend in total?");
    expect(shown).toMatch(/Scout read it as read\./);
    expect(shown).toContain("they agree");
  });

  it("rejects an engine name it does not know", async () => {
    const res = await fetch(`${ui.server.origin}/api/ask?q=hi&ablate=nonsense`, { headers: { "x-desk-token": ui.token } });
    expect(res.status).toBe(400);
  });
});

describe("meaning on the Ask screen", () => {
  it("says where meaning comes from for routing and for the notes, and shows the second stage in the trace of a question it has vectors for", async () => {
    const first = await api("");
    expect(String(first.embeddings)).toMatch(/recorded .* vectors \(sample mode\)/);
    const shown = await textOf("How much did we spend in September?");
    expect(shown).toContain("Meaning for routing and for your notes: recorded");
    expect(shown).toContain("second stage with nvidia/nemotron-3-embed-1b");
  });

  it("says the second stage fell back to the built-in comparison for a question with no recorded vector, and still answers", async () => {
    const a = await api("How much did we spend between the first and the last day of the third week in September, in total?");
    const events = a.events as { event: string; detail: Record<string, unknown> }[];
    const route = events.find((e) => e.event === "desk.route")!.detail;
    expect(route["stage2"]).toBe("degraded");
    expect(["answered", "unknowable"]).toContain(a.status);
    const shown = await textOf("How much did we spend between the first and the last day of the third week in September, in total?");
    expect(shown).toContain("the embedder failed, so the built-in comparison was used");
  });
});
