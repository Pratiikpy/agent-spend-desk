import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { ask, quoteNote } from "../../src/desk/ask/ask.ts";
import { renderAnswer } from "../../src/desk/ask/command.ts";
import { OwnerMemory } from "../../src/desk/engines/memory.ts";
import { sharesTopic, stem, topicStems } from "../../src/desk/engines/topic.ts";
import { sampleEnv, type Env } from "../../src/desk/prove/env.ts";
import { DEFAULT_SAMPLE } from "../../src/desk/sample/gen.ts";

/**
 * "What did I tell you about landed work?" is one of the questions the Desk advertises, and with H-MEM's score alone it found nothing even for a note that defines landed:
 * the hash embedder gives a short note a small score for a question about it and about the same for an unrelated one. A note is now recalled when the engine ranks it and it
 * shares a topic word with the question.
 */
let work: string;
let env: Env;
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-recall-"));
  env = await sampleEnv(work, undefined, { ...DEFAULT_SAMPLE, engineers: 3 });
}, 120_000);
afterAll(() => {
  env.db.close();
  rmSync(work, { recursive: true, force: true });
});

async function memoryWithNotes(): Promise<OwnerMemory> {
  // Each note is written a minute after the one before, so "newest" is not a tie.
  let t = Date.UTC(2026, 9, 20, 9, 0, 0);
  const m = await OwnerMemory.open({ clock: () => (t += 60_000) });
  m.remember({ content: "Landed means committed, merged or kept.", kind: "outcome_definition" });
  m.remember({ content: "Work on the billing module counts as landed once it is merged and the checks are green.", kind: "note" });
  m.remember({ content: "The finance team approved a temporary daily cap of $400 for the data pipeline until the migration ends.", kind: "note" });
  m.remember({ content: "Opus is allowed for security reviews only.", kind: "note" });
  return m;
}
const contents = (m: OwnerMemory, q: string, n?: number): string[] => m.recall(q, n).map((r) => r.content);

describe("topic words", () => {
  it("drops the words that only frame a question to a memory", () => {
    expect([...topicStems("What did I tell you about landed work?")].sort()).toEqual(["land", "work"]);
    expect(topicStems("What did I tell you?").size).toBe(0);
    expect(topicStems("Do you remember anything about the data pipeline cap?").has("pipelin")).toBe(true);
  });

  it("matches plain inflections and keeps dollar figures whole", () => {
    expect(stem("landed")).toBe(stem("landing"));
    expect(stem("landed")).toBe(stem("lands"));
    expect(stem("caps")).not.toBe(stem("capital"));
    expect(sharesTopic(topicStems("the $400 cap"), "A daily cap of $400 was approved")).toBe(true);
    expect(sharesTopic(topicStems("the $500 limit"), "A daily cap of $400 was approved")).toBe(false);
  });
});

describe("recall", () => {
  it("finds the note that defines landed when asked the advertised question, ahead of the note that only mentions it", async () => {
    const m = await memoryWithNotes();
    const found = contents(m, "What did I tell you about landed work?");
    expect(found[0]).toBe("Landed means committed, merged or kept.");
    expect(found).toContain("Work on the billing module counts as landed once it is merged and the checks are green.");
    expect(found).not.toContain("Opus is allowed for security reviews only.");
  });

  it("finds a note by its own words, in any case and with punctuation", async () => {
    const m = await memoryWithNotes();
    expect(contents(m, "COMMITTED?!")).toEqual(["Landed means committed, merged or kept."]);
    expect(contents(m, "What did I say about the data pipeline cap?")).toEqual(["The finance team approved a temporary daily cap of $400 for the data pipeline until the migration ends."]);
    expect(contents(m, "opus security")).toEqual(["Opus is allowed for security reviews only."]);
  });

  it("finds nothing for a question about something no note mentions", async () => {
    const m = await memoryWithNotes();
    expect(contents(m, "What did I say about the weather in Paris?")).toEqual([]);
    expect(contents(m, "kubernetes cluster autoscaling")).toEqual([]);
  });

  it("answers a question that names no topic with the newest notes, up to the limit", async () => {
    const m = await memoryWithNotes();
    expect(contents(m, "What did I tell you?", 2)).toEqual(["Opus is allowed for security reviews only.", "The finance team approved a temporary daily cap of $400 for the data pipeline until the migration ends."]);
    expect(contents(m, "What did I tell you?")).toHaveLength(4);
  });

  it("keeps a replaced note, marked as replaced", async () => {
    const m = await OwnerMemory.open({});
    const first = m.remember({ content: "Landed means committed.", kind: "outcome_definition" });
    m.remember({ content: "Landed means merged or kept.", kind: "outcome_definition", supersedes: first.id });
    const found = m.recall("landed");
    expect(found.map((f) => f.superseded).sort()).toEqual([false, true]);
  });

  it("returns nothing from an empty memory", async () => {
    const m = await OwnerMemory.open({});
    expect(m.recall("What did I tell you about landed work?")).toEqual([]);
    expect(m.recall("What did I tell you?")).toEqual([]);
  });
});

describe("Ask on recall", () => {
  it("answers the advertised question from the owner's notes, and says memory is off when it is", async () => {
    const memory = await memoryWithNotes();
    const q = "What did I tell you about landed work?";
    const on = await ask({ db: env.db, question: q, port: null, record: false, memory });
    expect(on.status).toBe("answered");
    expect(on.yourWords?.map((w) => w.text)).toContain("Landed means committed, merged or kept.");
    expect(on.yourWords?.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.recordedOn))).toBe(true);
    // The sentences stay the Desk's checked claims and do not carry the owner's text.
    expect(on.sentences.map((s) => s.text).join(" ")).not.toContain("committed, merged or kept");
    const off = await ask({ db: env.db, question: q, port: null, record: false, memory, ablate: new Set(["hmem"]) });
    expect(off.status).toBe("unknowable");
    expect(`${off.note ?? ""}${off.sentences.map((s) => s.text).join(" ")}`).toContain("Owner memory is off");
  });

  it("says no note matches when none does", async () => {
    const memory = await memoryWithNotes();
    const r = await ask({ db: env.db, question: "What did I tell you about the weather in Paris?", port: null, record: false, memory });
    expect(r.status).toBe("unknowable");
    expect(r.note ?? "").toContain("No note of yours matches");
  });
});

describe("the owner's words as shown", () => {
  it("removes control and direction characters, collapses whitespace and caps the length", () => {
    const messy = ["a", String.fromCharCode(27), "[31mred", String.fromCharCode(0x202e), "text", String.fromCharCode(10, 10), "  more"].join("");
    expect(quoteNote(messy)).toBe("a [31mred text more");
    expect(quoteNote("x".repeat(400))).toHaveLength(300);
    expect(quoteNote("x".repeat(400)).endsWith(String.fromCharCode(0x2026))).toBe(true);
    expect(quoteNote("  short  ")).toBe("short");
  });

  it("is printed under the answer, labelled as the owner's words and not as a claim", async () => {
    const memory = await memoryWithNotes();
    const trace = new MemoryTrace();
    const r = await ask({ db: env.db, question: "What did I tell you about the data pipeline cap?", port: null, record: false, memory, trace });
    const text = renderAnswer(r, trace);
    expect(text).toContain("Your words (quoted, not claims of the Desk):");
    expect(text).toContain('"The finance team approved a temporary daily cap of $400 for the data pipeline until the migration ends."');
  });

  it("does not show a note an answer does not use", async () => {
    const memory = await memoryWithNotes();
    const r = await ask({ db: env.db, question: "How much did we spend in September?", port: null, record: false, memory });
    expect(r.yourWords).toBeUndefined();
  });
});
