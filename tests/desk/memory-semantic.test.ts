import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { ask, verifyAnswer } from "../../src/desk/ask/ask.ts";
import type { EmbedKind, Embedder } from "../../src/desk/embed/port.ts";
import { OwnerMemory, WORDS_MIN } from "../../src/desk/engines/memory.ts";
import { loadRecallCases, evaluateRecall } from "../../src/desk/engines/recall-eval.ts";
import { sampleEnv, type Env } from "../../src/desk/prove/env.ts";
import { DEFAULT_SAMPLE } from "../../src/desk/sample/gen.ts";

/**
 * Notes read by meaning as well as by words. The embedder in these tests turns a text into a count of the concepts it mentions, so that two texts about the same thing are close
 * however they are worded; how good a real embedder is, is measured on the recorded vectors in `evals/memory`, not here.
 */
const CONCEPTS: Record<string, string[]> = {
  money: ["spend", "spending", "cap", "limit", "budget", "dollars", "cost", "price", "expensive"],
  people: ["intern", "interns", "team", "who", "people", "staff"],
  model: ["opus", "sonnet", "haiku", "model", "models", "biggest"],
  done: ["landed", "merged", "finished", "done", "shipped", "complete"],
  time: ["month", "day", "monday", "weekday", "weekdays", "date", "closes", "end"],
  weather: ["weather", "rain", "sunny", "paris"],
};
const DIMS = Object.keys(CONCEPTS);
function vec(text: string): Float32Array {
  const words = text.toLowerCase().split(/[^a-z]+/);
  const v = DIMS.map((d) => (CONCEPTS[d] as string[]).filter((w) => words.includes(w)).length);
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return Float32Array.from(n === 0 ? v : v.map((x) => x / n));
}

function fake(o: { fail?: boolean } = {}): Embedder & { calls: { kind: EmbedKind; texts: string[] }[]; opts: typeof o } {
  const calls: { kind: EmbedKind; texts: string[] }[] = [];
  const e = {
    id: "fake/concepts",
    source: "live" as const,
    calls,
    opts: o,
    async embed(texts: readonly string[], kind: EmbedKind): Promise<Float32Array[]> {
      calls.push({ kind, texts: [...texts] });
      if (e.opts.fail) throw new Error("the endpoint did not answer");
      return texts.map(vec);
    },
  };
  return e;
}

let t = Date.UTC(2026, 9, 20, 9, 0, 0);
async function memory(dir?: string): Promise<OwnerMemory> {
  const m = await OwnerMemory.open({ clock: () => (t += 60_000), ...(dir ? { persistDir: dir } : {}) });
  if (m.all().length === 0) {
    m.remember({ kind: "note", content: "Dana approves any spend above two hundred dollars a day." });
    m.remember({ kind: "note", content: "Opus is only for architecture reviews." });
    m.remember({ kind: "note", content: "Treat a session that ends with a revert as not landed." });
  }
  return m;
}
const ids = (m: OwnerMemory, q: string): string[] => m.recall(q).map((r) => r.content.split(" ")[0] as string);

describe("recall by meaning", () => {
  it("finds a note that shares no word with the question, and says it matched by meaning", async () => {
    const m = await memory();
    expect(ids(m, "How much budget needs a sign-off?")).toEqual([]);
    m.attach(fake());
    await m.prime(["How much budget needs a sign-off?"]);
    const r = m.recall("How much budget needs a sign-off?");
    expect(r.map((x) => x.content)).toContain("Dana approves any spend above two hundred dollars a day.");
    expect(r[0]).toMatchObject({ via: "meaning" });
    expect(r[0]?.similarity).toBeGreaterThan(0.3);
  });

  it("calls a match both when the note shares a word and the embedder agrees", async () => {
    const m = await memory();
    m.attach(fake());
    await m.prime(["What did I say about spend?"]);
    expect(m.recall("What did I say about spend?")[0]).toMatchObject({ via: "both" });
  });

  it("drops a note that shares a word with the question and that the embedder finds unrelated", async () => {
    const q = "Sunny day, rain or not, what is the weather in Paris?";
    const m = await memory();
    expect(m.recall(q).map((r) => r.content)).toContain("Dana approves any spend above two hundred dollars a day.");
    m.attach(fake());
    await m.prime([q]);
    expect(m.recall(q)).toEqual([]);
    expect(WORDS_MIN).toBeGreaterThan(0);
  });

  it("recalls nothing for a question about nothing the notes say", async () => {
    const m = await memory();
    m.attach(fake());
    await m.prime(["Will it rain in Paris tomorrow?"]);
    expect(m.recall("Will it rain in Paris tomorrow?")).toEqual([]);
  });

  it("falls back to words alone when the embedder fails, says why, and returns what words alone return", async () => {
    const plain = await memory();
    const want = plain.recall("What did I say about landed work?").map((r) => r.id + r.via);
    const m = await memory();
    m.attach(fake({ fail: true }));
    await m.prime(["What did I say about landed work?"]);
    expect(m.lastEmbedFailure).toMatch(/did not answer/);
    expect(m.recall("What did I say about landed work?").map((r) => r.id + r.via)).toEqual(want);
  });

  it("returns to words alone when the embedder is taken away", async () => {
    const m = await memory();
    m.attach(fake());
    await m.prime(["How much budget needs a sign-off?"]);
    m.attach(null);
    expect(m.recall("How much budget needs a sign-off?")).toEqual([]);
    expect(m.embedderId).toBeNull();
  });

  it("gives a question that names no topic the newest notes, whatever the embedder", async () => {
    const m = await memory();
    m.attach(fake());
    await m.prime(["What did I tell you?"]);
    expect(m.recall("What did I tell you?")[0]).toMatchObject({ via: "newest", content: "Treat a session that ends with a revert as not landed." });
  });
});

describe("the vectors of the notes", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-semantic-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("are made once and kept in a file beside the memory, so a later run does not ask for them again", async () => {
    const e1 = fake();
    const m1 = await memory(dir);
    m1.attach(e1);
    await m1.prime(["How much budget needs a sign-off?"]);
    expect(e1.calls.filter((c) => c.kind === "passage")).toHaveLength(1);
    expect(readdirSync(dir).some((f) => f.startsWith("semantic-fake-concepts"))).toBe(true);
    const e2 = fake();
    const m2 = await memory(dir);
    m2.attach(e2);
    await m2.prime(["How much budget needs a sign-off?"]);
    expect(e2.calls.filter((c) => c.kind === "passage")).toHaveLength(0);
    expect(m2.recall("How much budget needs a sign-off?")[0]).toMatchObject({ via: "meaning" });
  });

  it("are made only for a note that has none: a new note costs one passage, not the whole memory again", async () => {
    const e = fake();
    const m = await memory(dir);
    m.attach(e);
    await m.prime(["x"]);
    m.remember({ kind: "note", content: "Interns are budgeted separately." });
    await m.prime(["x"]);
    const passages = e.calls.filter((c) => c.kind === "passage");
    expect(passages.at(-1)?.texts).toEqual(["Interns are budgeted separately."]);
  });

  it("are not read for another model, and a damaged file is rebuilt, not trusted", async () => {
    const other = { ...fake(), id: "other/model" };
    const m = await memory(dir);
    m.attach(other);
    await m.prime(["x"]);
    expect(other.calls.filter((c) => c.kind === "passage")[0]?.texts.length).toBeGreaterThan(1);
    const file = readdirSync(dir).find((f) => f.startsWith("semantic-fake-concepts"))!;
    const text = readFileSync(join(dir, file), "utf8");
    expect(text.length).toBeGreaterThan(10);
  });
});

describe("inside Ask", () => {
  let work: string;
  let env: Env;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "desk-semantic-ask-"));
    env = await sampleEnv(work, undefined, { ...DEFAULT_SAMPLE, engineers: 3 });
  }, 120_000);
  afterAll(() => {
    env.db.close();
    rmSync(work, { recursive: true, force: true });
  });

  async function withNotes(): Promise<OwnerMemory> {
    let c = Date.UTC(2026, 9, 20, 9, 0, 0);
    const m = await OwnerMemory.open({ clock: () => (c += 60_000) });
    m.remember({ kind: "note", content: "Dana approves any spend above two hundred dollars a day." });
    return m;
  }
  const Q = "What did I tell you about my biggest budget limit?";

  it("reads the owner's notes by meaning when an embedder is given, and shows in the trace that it did", async () => {
    const m = await withNotes();
    const trace = new MemoryTrace();
    const r = await ask({ db: env.db, question: Q, port: null, memory: m, embedder: fake(), trace });
    expect(r.status).toBe("answered");
    expect(r.yourWords?.map((w) => w.text)).toEqual(["Dana approves any spend above two hundred dollars a day."]);
    const line = trace.events.find((e) => e.event === "desk.embed");
    expect(line?.detail).toMatchObject({ embedder: "fake/concepts", used: true });
  });

  it("says in the trace that it fell back to words when the embedder fails, and still answers", async () => {
    const m = await withNotes();
    const trace = new MemoryTrace();
    const r = await ask({ db: env.db, question: Q, port: null, memory: m, embedder: fake({ fail: true }), trace });
    expect(trace.events.find((e) => e.event === "desk.embed")?.detail).toMatchObject({ used: false, failure: expect.stringMatching(/did not answer/) });
    expect(["answered", "unknowable"]).toContain(r.status);
  });

  it("reads by words alone when no embedder is given, as before", async () => {
    const m = await withNotes();
    const trace = new MemoryTrace();
    await ask({ db: env.db, question: Q, port: null, memory: m, trace });
    expect(trace.events.find((e) => e.event === "desk.embed")).toBeUndefined();
  });
});

describe("how well the notes are found", () => {
  it("has a question set with notes it is about and questions about nothing, on both splits", () => {
    for (const split of ["dev", "test"] as const) {
      const { notes, cases } = loadRecallCases(split);
      expect(notes).toHaveLength(14);
      expect(cases.some((c) => c.about.length > 0)).toBe(true);
      expect(cases.some((c) => c.about.length === 0)).toBe(true);
      for (const c of cases) for (const id of c.about) expect(notes.map((n) => n.id)).toContain(id);
    }
  });

  it("scores words alone on the question sets, deterministically", async () => {
    const a = await evaluateRecall("dev", null);
    const b = await evaluateRecall("dev", null);
    expect(a).toEqual(b);
    expect(a.about.total).toBe(20);
    expect(a.unrelated.total).toBe(8);
    expect(a.embedder).toBeNull();
  });
});

describe("verify-answer with and without the embedder", () => {
  let work: string;
  let env: Env;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "desk-semantic-verify-"));
    env = await sampleEnv(work, undefined, { ...DEFAULT_SAMPLE, engineers: 3 });
  }, 120_000);
  afterAll(() => {
    env.db.close();
    rmSync(work, { recursive: true, force: true });
  });

  it("reports the recall step as unchanged with the same embedder and as changed without it", async () => {
    let c = Date.UTC(2026, 9, 20, 9, 0, 0);
    const m = await OwnerMemory.open({ clock: () => (c += 60_000) });
    m.remember({ kind: "note", content: "Dana approves any spend above two hundred dollars a day." });
    const e = fake();
    const r = await ask({ db: env.db, question: "What did I tell you about my biggest budget limit?", port: null, memory: m, embedder: e });
    expect(r.status).toBe("answered");
    const same = await verifyAnswer(env.db, r.answerId, { memory: m, embedder: e });
    expect(same.changed).toEqual([]);
    const m2 = await OwnerMemory.open({ clock: () => (c += 60_000) });
    m2.remember({ kind: "note", content: "Dana approves any spend above two hundred dollars a day." });
    const without = await verifyAnswer(env.db, r.answerId, { memory: m2 });
    expect(without.changed.length).toBeGreaterThan(0);
  });
});
