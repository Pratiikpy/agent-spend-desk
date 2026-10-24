import { describe, expect, it } from "vitest";

import type { AutopsyCall, AutopsyToolUse } from "../../src/desk/autopsy/engine.ts";
import { BLOAT_PARAMS, compactionPhases, type CompactionRecord, type Landing } from "../../src/desk/waste/bloat.ts";
import type { CallFacts } from "../../src/desk/waste/detect.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-10-20T09:00:00.000Z");

interface Spec {
  id: string;
  minute: number;
  tools?: AutopsyToolUse[];
  thread?: string;
  write5m?: number;
  input?: number;
  read?: number;
  /** Micro-dollars charged for the cache writes of this call. */
  writeCost?: number | null;
}

const call = (s: Spec): AutopsyCall => ({
  callId: s.id,
  threadKey: s.thread ?? "main",
  sessionId: "s1",
  tsMs: T0 + s.minute * MIN,
  model: "claude-opus-5",
  isSidechain: false,
  tokens: { input: s.input ?? 10, output: 100, reasoning: 0, read: s.read ?? 0, write5m: s.write5m ?? 0, write1h: 0 },
  micros: s.writeCost === null ? null : { input: 0, output: 0, read: 0, write5m: s.writeCost ?? 0, write1h: 0 },
  tools: s.tools ?? [],
  toolResultChars: 0,
  humanPromptBefore: false,
  msSinceHumanPrompt: 0,
});

const read = (hash: string): AutopsyToolUse => ({ name: "Read", inputHash: hash });
const compaction = (minute: number, over: Partial<CompactionRecord> = {}): CompactionRecord => ({ sessionId: "s1", threadKey: "main", tsMs: T0 + minute * MIN, trigger: "auto", preTokens: 400_000, postTokens: 20_000, ...over });
const facts = (rows: Record<string, { name: string; inputHash: string; chars: number }[]>): Map<string, CallFacts> =>
  new Map(Object.entries(rows).map(([id, r]) => [id, { results: r.map((x) => ({ ...x, resultHash: "h", truncated: false, isError: false })), editedPaths: [] }]));
const none = (): Landing => "none";

describe("C-BLOAT: a phase between two compactions", () => {
  // A phase that wrote 100,000 tokens to the cache at 6,250,000 micro-dollars a million tokens: 625,000 micro-dollars, 6.25 per token.
  const phase = [call({ id: "a1", minute: 0, write5m: 60_000, writeCost: 375_000, tools: [read("f1")] }), call({ id: "a2", minute: 5, write5m: 40_000, writeCost: 250_000 })];

  it("counts what the compaction threw away from the log's own sizes and prices it at what the phase paid to write a token", () => {
    const [p] = compactionPhases([...phase, call({ id: "a3", minute: 11 })], [compaction(10)], facts({}), none);
    expect(p).toMatchObject({ index: 0, calls: 2, preTokens: 400_000, postTokens: 20_000, postSource: "log", churnTokens: 380_000, landing: "none", flagged: true, rereads: [], rereadTokens: 0 });
    expect(p!.wasteMicros).toBe(Math.round(380_000 * 6.25));
  });

  it("does not bill a phase that dropped no more than the threshold", () => {
    const [p] = compactionPhases(phase, [compaction(10, { preTokens: 70_000, postTokens: 20_000 })], facts({}), none);
    expect(p).toMatchObject({ churnTokens: 50_000, flagged: false, wasteMicros: null }); // exactly the threshold is not over it
    expect(BLOAT_PARAMS.churnTokens).toBe(50_000);
  });

  it.each(["landed", "possible", "unknown"] as const)("does not bill a phase whose outcome is %s, and still counts what it threw away", (landing) => {
    const [p] = compactionPhases(phase, [compaction(10)], facts({}), () => landing);
    expect(p).toMatchObject({ landing, flagged: false, wasteMicros: null, churnTokens: 380_000 });
  });

  it("bills only a phase known to have landed nothing", () => {
    const [p] = compactionPhases(phase, [compaction(10)], facts({}), (s, from, to) => (s === "s1" && from <= T0 + 3 * MIN && T0 + 3 * MIN <= to ? "none" : "unknown"));
    expect(p).toMatchObject({ landing: "none", flagged: true });
  });

  it("asks about the commit only inside the phase's own window", () => {
    const asked: [number, number][] = [];
    compactionPhases([...phase, call({ id: "b1", minute: 12, write5m: 1_000, writeCost: 6_250 }), call({ id: "b2", minute: 20 })], [compaction(10), compaction(21, { preTokens: 120_000, postTokens: 30_000 })], facts({}), (_s, from, to) => (asked.push([from, to]), "none"));
    expect(asked).toEqual([[T0, T0 + 10 * MIN], [T0 + 10 * MIN + 1, T0 + 21 * MIN]]);
  });

  it("takes the size after from the first call after the compaction when the log does not say, and says so", () => {
    const [p] = compactionPhases([...phase, call({ id: "a3", minute: 11, input: 5_000, read: 15_000 })], [compaction(10, { postTokens: null })], facts({}), none);
    expect(p).toMatchObject({ postTokens: 20_000, postSource: "next_call", churnTokens: 380_000 });
  });

  it("counts no churn, and bills nothing, when the size after is unknown", () => {
    const [p] = compactionPhases(phase, [compaction(10, { postTokens: null })], facts({}), none);
    expect(p).toMatchObject({ postTokens: null, postSource: "unknown", churnTokens: 0, flagged: false, wasteMicros: null });
  });

  it("counts a file read again within three calls of the compaction, with the tokens estimated from characters", () => {
    const calls = [...phase, call({ id: "c1", minute: 11, tools: [read("f1")] }), call({ id: "c2", minute: 12, tools: [read("f9")] }), call({ id: "c3", minute: 13 }), call({ id: "c4", minute: 14, tools: [read("f1")] })];
    const f = facts({ c1: [{ name: "Read", inputHash: "f1", chars: 8_000 }], c4: [{ name: "Read", inputHash: "f1", chars: 4_000 }] });
    const [p] = compactionPhases(calls, [compaction(10)], f, none);
    // f1 was read in the phase and again one call after: counted. f9 was not read before. The read at c4 is the fourth call after: outside the window.
    expect(p!.rereads).toEqual([{ inputHash: "f1", chars: 8_000 }]);
    expect(p!.rereadTokens).toBe(2_000); // 8,000 characters at four a token
    expect(p!.wasteMicros).toBe(Math.round((380_000 + 2_000) * 6.25));
  });

  it("keeps a re-read whose result the ledger does not hold, without inventing its size", () => {
    const [p] = compactionPhases([...phase, call({ id: "c1", minute: 11, tools: [read("f1")] })], [compaction(10)], facts({}), none);
    expect(p!.rereads).toEqual([{ inputHash: "f1", chars: null }]);
    expect(p!.rereadTokens).toBe(0);
  });

  it("makes one phase per compaction, each starting after the one before, and keeps a delegated agent's compactions apart", () => {
    const calls = [
      call({ id: "m1", minute: 0, write5m: 1_000, writeCost: 6_250 }),
      call({ id: "m2", minute: 9, write5m: 1_000, writeCost: 6_250 }),
      call({ id: "m3", minute: 12, write5m: 1_000, writeCost: 6_250 }),
      call({ id: "k1", minute: 3, thread: "agent", write5m: 1_000, writeCost: 6_250 }),
    ];
    const phases = compactionPhases(calls, [compaction(10), compaction(20, { preTokens: 300_000 }), compaction(6, { threadKey: "agent", preTokens: 90_000 })], facts({}), none);
    expect(phases.map((p) => [p.threadKey, p.index, p.calls])).toEqual([
      ["main", 0, 2],
      ["agent", 0, 1],
      ["main", 1, 1],
    ]);
    expect(phases.find((p) => p.threadKey === "agent")).toMatchObject({ preTokens: 90_000, churnTokens: 70_000, flagged: true });
  });

  it("gives no phase to a thread that never compacted, and none to a compaction with no calls to speak of", () => {
    expect(compactionPhases(phase, [], facts({}), none)).toEqual([]);
    expect(compactionPhases([], [compaction(10)], facts({}), none)).toEqual([]);
  });

  it("flags the phase but invents no dollars when no call of it was priced for cache writes", () => {
    const unpriced = [call({ id: "u1", minute: 0, write5m: 10_000, writeCost: null })];
    const [p] = compactionPhases(unpriced, [compaction(10)], facts({}), none);
    expect(p).toMatchObject({ flagged: true, wasteMicros: null, churnTokens: 380_000 });
  });
});
