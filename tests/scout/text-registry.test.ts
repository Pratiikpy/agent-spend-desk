import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { IntentRegistry, RegistryError } from "../../src/scout-intent/registry.ts";
import { contentStems, hasInvisible, ngrams, normalize, stem, tokenize } from "../../src/scout-intent/text.ts";
import type { Intent } from "../../src/scout-intent/types.ts";

const FIXTURE = "evals/scout/fixtures/intents.json";
const work = mkdtempSync(join(tmpdir(), "scout-reg-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const intent = (o: Partial<Intent> = {}): Intent => ({
  id: "deal.query", category: "deal", description: "Read-only lookup of a deal.", parameters: { type: "object", properties: {} }, capabilities: ["world.query"], riskClass: "low", surfaces: ["chat"], roles: ["ae"], examples: ["Show me the Acme deal"], version: 1, ...o,
});

describe("text", () => {
  it("removes hidden and direction-changing characters and collapses whitespace", () => {
    const messy = ["ab", String.fromCharCode(0x202e), "c", String.fromCharCode(0x200b), "d", "  \n\t e"].join("");
    expect(normalize(messy)).toBe("ab c d e");
    expect(hasInvisible(messy)).toBe(true);
    expect(hasInvisible("plain text")).toBe(false);
  });

  it("folds plain inflections together and leaves short words alone", () => {
    expect(stem("deals")).toBe(stem("deal"));
    expect(stem("recovering")).toBe(stem("recover"));
    expect(stem("stuck")).toBe("stuck");
    expect(stem("is")).toBe("is");
  });

  it("marks a capitalised word that is not the first of its sentence as a name, and numbers as not content", () => {
    const t = tokenize("Show me the Acme deal over $100k in 2026");
    expect(t.find((x) => x.raw === "acme")?.proper).toBe(true);
    expect(t.find((x) => x.raw === "show")?.proper).toBe(false);
    const words = contentStems(t).map((c) => c.stem);
    expect(words).toContain("deal");
    expect(words).not.toContain("acme");
    expect(words.some((w) => /\d/.test(w))).toBe(false);
  });

  it("builds unigrams, bigrams and trigrams over the content words with their spans", () => {
    const g = ngrams([{ stem: "a", start: 0, end: 1 }, { stem: "b", start: 2, end: 3 }, { stem: "c", start: 4, end: 5 }]);
    expect(g.map((x) => x.gram)).toEqual(["a", "b", "c", "a b", "b c", "a b c"]);
    expect(g[5]).toMatchObject({ n: 3, start: 0, end: 5 });
  });
});

describe("the intent registry", () => {
  it("loads the harness registry, with the fallback and its version", () => {
    const r = IntentRegistry.fromFile(FIXTURE);
    expect(r.intents.length).toBeGreaterThanOrEqual(13);
    expect(r.has("GENERAL")).toBe(true);
    expect(r.get("deal.recover")?.riskClass).toBe("medium");
    expect(r.registryVersion).toBe(1);
  });

  it("adds the safe fallback when a registry has none", () => {
    const r = IntentRegistry.fromObject({ version: 3, intents: [intent()] });
    expect(r.intents.map((i) => i.id)).toEqual(["GENERAL", "deal.query"]);
    expect(r.registryVersion).toBe(3);
  });

  it.each([
    ["an intent with no examples", intent({ examples: [] }), /needs examples/],
    ["an id that is not category.name", intent({ id: "Deal Query" }), /GENERAL or category.name/],
    ["a category that is not the id's first part", intent({ category: "email" }), /not the first part of its id/],
    ["an unknown risk class", intent({ riskClass: "extreme" as never }), /riskClass/],
    ["no surfaces", intent({ surfaces: [] }), /at least one surface/],
    ["no roles", intent({ roles: [] }), /at least one role/],
    ["a version that is not an integer", intent({ version: 0 }), /integer version/],
    ["a blank example", intent({ examples: ["  "] }), /needs examples/],
  ])("refuses %s", (_name, i, why) => {
    expect(() => IntentRegistry.fromObject({ intents: [i] })).toThrow(why);
  });

  it("refuses an intent declared twice", () => {
    expect(() => IntentRegistry.fromObject({ intents: [intent(), intent()] })).toThrow(/declared twice/);
  });

  it("composes registries, takes the highest version, and refuses a clash instead of overriding", () => {
    const a = IntentRegistry.fromObject({ version: 2, intents: [intent()] });
    const b = IntentRegistry.fromObject({ version: 5, intents: [intent({ id: "deal.update", riskClass: "high" })] });
    const c = IntentRegistry.compose([a, b]);
    expect(c.intents.map((i) => i.id).sort()).toEqual(["GENERAL", "deal.query", "deal.update"]);
    expect(c.registryVersion).toBe(5);
    expect(() => IntentRegistry.compose([a, a])).toThrow(/more than one registry/);
  });

  it("loads a folder of one intent per file, in json or yaml, and says when a path is not there", () => {
    const dir = join(work, "intents");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.json"), JSON.stringify(intent({ version: 2 })));
    writeFileSync(join(dir, "b.yaml"), "id: deal.update\ncategory: deal\ndescription: Change a deal.\nparameters: {type: object, properties: {}}\ncapabilities: [world.assert]\nriskClass: high\nsurfaces: [chat]\nroles: [ae]\nexamples: [Move the deal to closed-won]\nversion: 4\n");
    writeFileSync(join(dir, "notes.txt"), "not an intent");
    const r = IntentRegistry.fromDirectory(dir);
    expect(r.intents.map((i) => i.id).sort()).toEqual(["GENERAL", "deal.query", "deal.update"]);
    expect(r.registryVersion).toBe(4);
    expect(() => IntentRegistry.fromDirectory(join(work, "nowhere"))).toThrow(RegistryError);
    expect(() => IntentRegistry.fromFile(join(work, "nowhere.json"))).toThrow(/does not exist/);
  });
});
