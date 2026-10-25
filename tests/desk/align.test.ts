import { describe, expect, it } from "vitest";

import { alignJson, assign, scoreToolOutput, tokenConfidence, LOGPROB_FLOOR, parseJsonLoose } from "../../src/desk/align/index.ts";
import { editDistance, numberSimilarity, sequenceSimilarity, textSimilarity } from "../../src/desk/align/similarity.ts";

/** A small seeded generator, so a failing matrix can be run again. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function bruteBest(m: number[][]): number {
  const rows = m.length;
  const cols = m[0]!.length;
  let best = 0;
  const used = new Array<boolean>(cols).fill(false);
  const go = (i: number, acc: number): void => {
    if (i === rows) {
      best = Math.max(best, acc);
      return;
    }
    go(i + 1, acc); // this row left unpaired
    for (let j = 0; j < cols; j += 1) {
      if (used[j]) continue;
      used[j] = true;
      go(i + 1, acc + (m[i] as number[])[j]!);
      used[j] = false;
    }
  };
  go(0, 0);
  return best;
}

describe("the assignment", () => {
  it("finds the best total of every permutation, for square and for rectangular matrices", () => {
    const rnd = lcg(7);
    for (let t = 0; t < 300; t += 1) {
      const rows = 1 + Math.floor(rnd() * 6);
      const cols = 1 + Math.floor(rnd() * 6);
      const m = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(rnd() * 100) / 100));
      const got = assign(m);
      expect(got.total).toBeCloseTo(bruteBest(m), 9);
      expect(new Set(got.pairs.map((p) => p[0])).size).toBe(got.pairs.length);
      expect(new Set(got.pairs.map((p) => p[1])).size).toBe(got.pairs.length);
      expect(got.pairs.length).toBe(Math.min(rows, cols));
    }
  });

  it("is not fooled by the greedy choice: the best pair first is not the best pairing", () => {
    // Taking 0.9 first leaves 0 for the second row; the two 0.8 and 0.7 together are better.
    const got = assign([[0.9, 0.8], [0.8, 0]]);
    expect(got.total).toBeCloseTo(1.6, 9);
    expect(got.pairs).toEqual([[0, 1], [1, 0]]);
  });

  it("handles no rows, no columns and refuses a ragged or non-finite matrix", () => {
    expect(assign([])).toEqual({ pairs: [], total: 0 });
    expect(assign([[]])).toEqual({ pairs: [], total: 0 });
    expect(() => assign([[1, 2], [3]])).toThrow(RangeError);
    expect(() => assign([[Number.NaN]])).toThrow(RangeError);
  });

  it("pairs a matrix of two hundred by two hundred in good time", () => {
    const rnd = lcg(3);
    const m = Array.from({ length: 200 }, () => Array.from({ length: 200 }, () => rnd()));
    const started = Date.now();
    const got = assign(m);
    expect(got.pairs).toHaveLength(200);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("edit distance and the similarities built on it", () => {
  it("counts insertions, deletions and substitutions, by character or by word", () => {
    expect(editDistance([..."kitten"], [..."sitting"])).toBe(3);
    expect(textSimilarity("alice", "alice")).toBe(1);
    expect(textSimilarity("alice", "alicia")).toBeCloseTo(1 - 2 / 6, 9);
    expect(textSimilarity("", "")).toBe(1);
    expect(textSimilarity("", "abc")).toBe(0);
    expect(sequenceSimilarity(["a", "b", "c"], ["a", "c"])).toBeCloseTo(2 / 3, 9);
  });

  it("counts an emoji or an accented letter as one", () => {
    expect(textSimilarity("café", "cafe")).toBeCloseTo(0.75, 9);
    expect(textSimilarity("😀😀", "😀")).toBeCloseTo(0.5, 9);
  });

  it("scores two numbers by their distance against the larger", () => {
    expect(numberSimilarity(10, 10)).toBe(1);
    expect(numberSimilarity(10, 5)).toBe(0.5);
    expect(numberSimilarity(-5, 5)).toBe(0);
    expect(numberSimilarity(0, 0)).toBe(1);
    expect(numberSimilarity(0, 3)).toBe(0);
  });
});

describe("aligning structured output", () => {
  const reference = { id: 7, name: "alice", tags: ["a", "b", "c"], address: { city: "Lisbon", zip: "1000" }, items: [{ sku: "x1", qty: 2 }, { sku: "y2", qty: 5 }] };

  it("scores a reordered object and reordered lists as exactly the reference", () => {
    const shuffled = { items: [{ qty: 5, sku: "y2" }, { qty: 2, sku: "x1" }], address: { zip: "1000", city: "Lisbon" }, tags: ["c", "a", "b"], name: "alice", id: 7 };
    const r = alignJson(reference, shuffled);
    expect(r.score).toBe(1);
    expect(r.pass).toBe(true);
    expect(r.mode).toBe("structured");
    expect(r.confidence).toBe("high");
  });

  it("scores a near match between the threshold and one, and a wrong answer far below it", () => {
    const near = alignJson({ name: "alice", age: 30 }, { name: "alicia", age: 30 });
    expect(near.score).toBeGreaterThan(0.85);
    expect(near.score).toBeLessThan(1);
    expect(near.pass).toBe(true);
    const wrong = alignJson(reference, { id: 99, name: "zed", tags: ["x"], address: { city: "Oslo", zip: "0150" }, items: [] });
    expect(wrong.score).toBeLessThan(0.5);
    expect(wrong.pass).toBe(false);
  });

  it("gives a renamed field its value's share and a right key with a wrong value its key's share", () => {
    const renamed = alignJson({ a: 1, b: "two" }, { a: 1, c: "two" });
    expect(renamed.score).toBeCloseTo((1 + 0.7) / 2, 9);
    expect(renamed.details.some((d) => d.path === "b" && d.observedKey === "c")).toBe(true);
    const wrongValue = alignJson({ a: "alpha" }, { a: "omega" });
    expect(wrongValue.score).toBeCloseTo(0.3 + 0.7 * textSimilarity("alpha", "omega"), 9);
  });

  it("counts a missing field and an extra field against the whole, one as much as the other", () => {
    const missing = alignJson({ a: 1, b: 2 }, { a: 1 });
    const extra = alignJson({ a: 1 }, { a: 1, b: 2 });
    expect(missing.score).toBe(0.5);
    expect(extra.score).toBe(0.5);
    expect(missing.details.find((d) => d.kind === "missing")?.path).toBe("b");
    expect(extra.details.find((d) => d.kind === "extra")?.path).toBe("b");
  });

  it("treats a value of another type as a mismatch, and a number written as a string the same until the caller says otherwise", () => {
    expect(alignJson({ n: 30 }, { n: "30" }).score).toBeCloseTo(0.3, 9);
    expect(alignJson({ n: 30 }, { n: "30" }, { coerceNumericStrings: true }).score).toBe(1);
    expect(alignJson({ n: 30 }, { n: "thirty" }, { coerceNumericStrings: true }).score).toBeCloseTo(0.3, 9);
    expect(alignJson({ n: null }, { n: 0 }).score).toBeCloseTo(0.3, 9);
  });

  it("compares lists in order when asked to, so a changed order is a different answer", () => {
    const steps = { steps: ["build", "test", "deploy"] };
    const swapped = { steps: ["deploy", "test", "build"] };
    expect(alignJson(steps, swapped).score).toBe(1);
    expect(alignJson(steps, swapped, { orderedLists: true }).score).toBeLessThan(1);
  });

  it("finds the right element in a list when two are alike, and does not pair one element twice", () => {
    const r = alignJson([{ k: "aaa" }, { k: "aab" }], [{ k: "aab" }, { k: "aaa" }]);
    expect(r.score).toBe(1);
    const dup = alignJson([{ k: "x" }, { k: "x" }], [{ k: "x" }]);
    expect(dup.score).toBe(0.5);
  });

  it("handles empty values and the shapes at the top: a list, a string, a number, null", () => {
    expect(alignJson({}, {}).score).toBe(1);
    expect(alignJson([], []).score).toBe(1);
    expect(alignJson([], [1]).score).toBe(0);
    expect(alignJson("yes", "yes").score).toBe(1);
    expect(alignJson(42, 41).score).toBeCloseTo(1 - 1 / 42, 9);
    expect(alignJson(null, null).score).toBe(1);
    expect(alignJson(true, false).score).toBe(0);
  });

  it("reads JSON given as text, cut out of a fence or of a sentence, and says it had to cut", () => {
    const text = alignJson('{"a":1,"b":[1,2]}', '{"b":[2,1],"a":1}');
    expect(text.score).toBe(1);
    expect(text.confidence).toBe("high");
    const fenced = alignJson({ a: 1 }, 'Here you go:\n```json\n{"a": 1}\n```');
    expect(fenced.score).toBe(1);
    expect(fenced.confidence).toBe("low");
    expect(fenced.note).toMatch(/cut out of text/);
    const inline = alignJson({ a: { b: "}" } }, 'The result is {"a": {"b": "}"}} as asked.');
    expect(inline.score).toBe(1);
    expect(inline.confidence).toBe("low");
  });

  it("falls back to words, with low confidence and a reason, for output that is not JSON", () => {
    const r = alignJson({ a: 1 }, "I could not find anything");
    expect(r.mode).toBe("text");
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/not JSON/);
    expect(r.details).toEqual([]);
    const prose = alignJson("the build passed with two warnings", "the build passed with 2 warnings");
    expect(prose.mode).toBe("text");
    expect(prose.score).toBeCloseTo(5 / 6, 9);
  });

  it("gives up on a structure that is too deep or too large, and says so, without throwing", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i += 1) deep = { x: deep };
    const r = alignJson(deep, deep);
    expect(r.mode).toBe("text");
    expect(r.note).toMatch(/too large or too deep/);
    const big = Array.from({ length: 450 }, (_, i) => ({ id: i }));
    const b = alignJson(big, [...big].reverse());
    expect(b.mode === "structured" || b.mode === "text").toBe(true);
    expect(Number.isFinite(b.score)).toBe(true);
  });

  it("matches a list of two hundred records in any order to exactly one", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `n${i}`, v: [i, i + 1] }));
    const rnd = lcg(11);
    const shuffled = [...rows].sort(() => rnd() - 0.5);
    const started = Date.now();
    const r = alignJson(rows, shuffled);
    expect(r.score).toBe(1);
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("records where each loss is, capped, and says when it cut the list", () => {
    const ref = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]));
    const r = alignJson(ref, {});
    expect(r.score).toBe(0);
    expect(r.details.length).toBeLessThanOrEqual(200);
    expect(r.detailsTruncated).toBe(true);
  });
});

describe("what the model said about its own tokens", () => {
  it("leaves out the tokens given at under one per cent and counts them apart", () => {
    const c = tokenConfidence([{ logprob: Math.log(0.9) }, { logprob: Math.log(0.5) }, { logprob: Math.log(0.001) }, { logprob: 0 }]);
    expect(c.tokens).toBe(4);
    expect(c.doubtful).toBe(1);
    expect(c.mean).toBeCloseTo((0.9 + 0.5 + 1) / 3, 9);
    expect(LOGPROB_FLOOR).toBeCloseTo(Math.log(0.01), 12);
  });

  it("gives nothing for no logprobs, and skips a value that cannot be one", () => {
    expect(tokenConfidence(null)).toEqual({ tokens: 0, doubtful: 0, mean: null });
    expect(tokenConfidence([])).toEqual({ tokens: 0, doubtful: 0, mean: null });
    expect(tokenConfidence([Number.NaN, 3, -Infinity])).toMatchObject({ tokens: 1, doubtful: 1, mean: null });
  });

  it("never moves the alignment score, and marks the score low when the model doubted most of its tokens", () => {
    const sure = scoreToolOutput({ reference: { a: 1 }, observed: { a: 1 }, logprobs: [-0.01, -0.02] });
    const unsure = scoreToolOutput({ reference: { a: 1 }, observed: { a: 1 }, logprobs: [-9, -9, -0.1] });
    expect(sure.alignment.score).toBe(1);
    expect(unsure.alignment.score).toBe(1);
    expect(sure.label).toBe("high");
    expect(unsure.label).toBe("low");
    expect(scoreToolOutput({ reference: { a: 1 }, observed: "no" }).label).toBe("low");
  });
});

describe("loose JSON", () => {
  it("returns null for text with no JSON, and for an unclosed object", () => {
    expect(parseJsonLoose("nothing here")).toBeNull();
    expect(parseJsonLoose('{"a": 1')).toBeNull();
  });
});

describe("the canary checker and the command", () => {
  it("passes a reply that has the reference's content in any order, and fails one that has not", async () => {
    const { jsonAlignedIs } = await import("../../src/desk/canary/tasks.ts");
    const check = jsonAlignedIs({ a: 1, list: [1, 2, 3] });
    expect(check('{"list":[3,2,1],"a":1}')).toBe(1);
    expect(check('```json\n{"a":1,"list":[1,2,3]}\n```')).toBe(1);
    expect(check('{"a":2,"list":[9]}')).toBe(0);
    expect(check("")).toBe(0);
    expect((check as unknown as { spec: { kind: string; version: number } }).spec).toMatchObject({ kind: "jsonAlignedIs", version: 1 });
  });

  it("scores two files and says where the points went", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { alignCommand } = await import("../../src/desk/align/command.ts");
    const dir = mkdtempSync(join(tmpdir(), "desk-align-"));
    try {
      writeFileSync(join(dir, "ref.json"), JSON.stringify({ a: 1, b: "two", c: [1, 2] }));
      writeFileSync(join(dir, "out.json"), JSON.stringify({ c: [2, 1], b: "tw0", a: 1 }));
      const text = alignCommand({ args: [join(dir, "ref.json"), join(dir, "out.json")] });
      expect(text).toMatch(/score 0\.9\d\d, passes at 0\.85; compared as structure, confidence high/);
      expect(text).toContain("where it lost points:");
      expect(text).toMatch(/\bb {2}matched {2}0\.\d\d/);
      expect(alignCommand({ args: [join(dir, "ref.json")] })).toMatch(/Name two files/);
      expect(alignCommand({ args: [join(dir, "ref.json"), join(dir, "nope.json")] })).toMatch(/Could not read a file/);
      expect(alignCommand({ args: [join(dir, "ref.json"), join(dir, "out.json")], threshold: "2" })).toMatch(/from 0 to 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
