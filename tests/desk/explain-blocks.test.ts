import { describe, expect, it } from "vitest";

import { analyseCalls, buildAutopsy, type AutopsyCall, type AutopsyToolUse } from "../../src/desk/autopsy/engine.ts";
import { BLOCK_RULE, explainBlock, findBlocks, type ToolUseFacts } from "../../src/desk/explain/blocks.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-10-20T09:00:00.000Z");

interface Spec {
  id: string;
  minute: number;
  tools?: AutopsyToolUse[];
  prompt?: boolean;
  sidechain?: boolean;
  thread?: string;
  /** Micro-dollars of output cost, so that a call has a known price. */
  cost?: number;
  read?: number;
  write5m?: number;
  model?: string;
  results?: number;
  sinceHuman?: number | null;
}

function call(s: Spec): AutopsyCall {
  return {
    callId: s.id,
    threadKey: s.thread ?? "main",
    sessionId: "s1",
    tsMs: T0 + s.minute * MIN,
    model: s.model ?? "claude-opus-5",
    isSidechain: s.sidechain ?? false,
    tokens: { input: 10, output: 100, reasoning: 0, read: s.read ?? 5_000, write5m: s.write5m ?? 100, write1h: 0 },
    micros: { input: 0, output: s.cost ?? 1_000_000, read: 0, write5m: 0, write1h: 0 },
    tools: s.tools ?? [],
    toolResultChars: s.results ?? 50,
    humanPromptBefore: s.prompt ?? false,
    msSinceHumanPrompt: s.sinceHuman === undefined ? s.minute * MIN : s.sinceHuman,
  };
}

const fail = (name: string, hash: string): AutopsyToolUse => ({ name, inputHash: hash, resultIsError: true });
const ok = (name: string, hash: string): AutopsyToolUse => ({ name, inputHash: hash, resultIsError: false });
const NO_FACTS = new Map<string, ToolUseFacts>();

function run(calls: AutopsyCall[], facts: Map<string, ToolUseFacts> = NO_FACTS) {
  const analysis = analyseCalls(calls);
  const autopsy = buildAutopsy(calls, T0 - 1, T0 + 1_000 * MIN, analysis);
  const blocks = findBlocks(calls, analysis, autopsy.missEvents);
  const missByCall = new Map(autopsy.missEvents.map((m) => [m.callId, m]));
  const explain = (i: number) => explainBlock(blocks[i]!, [...calls].sort((a, b) => a.tsMs - b.tsMs), missByCall, facts, T0);
  return { blocks, explain, autopsy };
}

describe("loops: the failing command repeated", () => {
  const CALLS = [
    call({ id: "c1", minute: 0, prompt: true, tools: [ok("Read", "r1")] }),
    call({ id: "c2", minute: 1, tools: [fail("Bash", "b1")] }), // first break
    call({ id: "c3", minute: 2, tools: [fail("Bash", "b1")] }), // second
    call({ id: "c4", minute: 3, tools: [fail("Bash", "b1")], cost: 2_000_000 }), // third: the rule acts here
    call({ id: "c5", minute: 4, tools: [fail("Bash", "b1")], cost: 3_000_000 }),
    call({ id: "c6", minute: 5, tools: [ok("Edit", "e1")] }),
  ];

  it("starts the block at the third identical failure and says the chain began at the first", () => {
    const { blocks, explain } = run(CALLS);
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b).toMatchObject({ kind: "loops", rule: "C-LOOP-1", totalMicros: 5_000_000 });
    expect(b.calls.map((c) => c.callId)).toEqual(["c4", "c5"]);
    const e = explain(0);
    expect(e.stop).toMatchObject({ callId: "c4", offsetSec: 180, savingMicros: 5_000_000, callsAfter: 1 });
    expect(e.stop.why).toBe("the 3rd identical failing Bash call inside 12 calls, with no prompt from you in between");
    expect(e.rule).toEqual({ id: "C-LOOP-1", params: { repeats: 3, window_calls: 12 }, observed: { failing_tool: "Bash", repeats_seen: 3 } });
    expect(e.cascade.firstBreak).toMatchObject({ callId: "c2", tool: "Bash", callsBeforeStop: 2 });
    expect(e.cascade.steps.map((s) => s.callId)).toEqual(["c2", "c3", "c4", "c5"]);
    expect(e.cascade.steps.every((s) => s.repeatsFirstBreak && s.failed && !s.opaque)).toBe(true);
    expect(e.cascade.confidence).toBe("high");
    expect(e.sentences[0]!.text).toBe("Bash failed with the same input 3 times, first at 09:01:00 UTC, and the agent kept calling it for 1 more call.");
    expect(e.sentences[1]!.text).toContain("Stopping there would have saved $5.00");
  });

  it("does not call three ordinary repeated reads a loop, nor three different failures, nor a fourth after a prompt", () => {
    const reads = [0, 1, 2, 3].map((i) => call({ id: `g${i}`, minute: i, tools: [ok("Bash", "git-status")], prompt: i === 0 }));
    expect(run(reads).blocks).toHaveLength(0);
    const different = [fail("Bash", "a"), fail("Bash", "b"), fail("Bash", "c"), fail("Bash", "d")].map((t, i) => call({ id: `d${i}`, minute: i, tools: [t], prompt: i === 0 }));
    expect(run(different).blocks).toHaveLength(0);
    const reset = [call({ id: "x1", minute: 0, prompt: true, tools: [fail("Bash", "b1")] }), call({ id: "x2", minute: 1, tools: [fail("Bash", "b1")] }), call({ id: "x3", minute: 2, prompt: true, tools: [fail("Bash", "b1")] }), call({ id: "x4", minute: 3, tools: [fail("Bash", "b1")] })];
    expect(run(reset).blocks).toHaveLength(0); // your prompt in between starts the count again
    const twice = [call({ id: "y1", minute: 0, prompt: true, tools: [fail("Bash", "b1")] }), call({ id: "y2", minute: 1, tools: [fail("Bash", "b1")] })];
    expect(run(twice).blocks).toHaveLength(0);
  });

  it("marks the chain low-confidence when a delegated agent's call or a tool use with no result lies between the first break and the stop", () => {
    const withSidechain = [...CALLS];
    withSidechain.splice(2, 0, call({ id: "s1", minute: 1.5, sidechain: true, thread: "main", tools: [ok("Task", "t")] }));
    const a = run(withSidechain).explain(0);
    expect(a.cascade.confidence).toBe("low");
    expect(a.cascade.why).toMatch(/opaque step lies between the first break and the stop point \(a delegated agent's call/);
    expect(a.cascade.steps.find((s) => s.callId === "s1")).toMatchObject({ opaque: true, repeatsFirstBreak: false, failed: false });

    const gap = new Map<string, ToolUseFacts>([["c3", { withoutResult: 1 }]]);
    const b = run(CALLS, gap).explain(0);
    expect(b.cascade.confidence).toBe("low");
    expect(b.cascade.why).toMatch(/1 tool use in this call has no result in the log/);
    expect(b.cascade.steps.find((s) => s.callId === "c3")).toMatchObject({ opaque: true });
    // A gap after the stop point does not weaken the chain that led to it.
    expect(run(CALLS, new Map([["c5", { withoutResult: 2 }]])).explain(0).cascade.confidence).toBe("high");
  });

  it("keeps blocks apart when another kind of call separates them, and orders them by cost", () => {
    const two = [
      ...CALLS,
      call({ id: "c7", minute: 6, prompt: true, tools: [fail("Bash", "z")] }),
      call({ id: "c8", minute: 7, tools: [fail("Bash", "z")] }),
      call({ id: "c9", minute: 8, tools: [fail("Bash", "z")], cost: 9_000_000 }),
    ];
    const { blocks } = run(two);
    expect(blocks.map((b) => [b.kind, b.totalMicros])).toEqual([["loops", 9_000_000], ["loops", 5_000_000]]);
  });
});

describe("idle: calls with no one asking", () => {
  it("explains a run of background calls long after the last prompt, with the rule's own number", () => {
    const calls = [
      call({ id: "i0", minute: 0, prompt: true }),
      call({ id: "i1", minute: 10, results: 50 }),
      call({ id: "i2", minute: 50, results: 0, sinceHuman: 50 * MIN, cost: 4_000_000 }), // no prompt, no tool result, 50 minutes on
      call({ id: "i3", minute: 55, results: 0, sinceHuman: 55 * MIN, cost: 6_000_000 }),
    ];
    const { blocks, explain } = run(calls);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "idle", rule: "C-IDLE-1", totalMicros: 10_000_000 });
    const e = explain(0);
    expect(e.rule).toEqual({ id: "C-IDLE-1", params: { idle_after_minutes: 30 }, observed: { minutes_since_your_last_prompt: 50 } });
    expect(e.cascade).toMatchObject({ firstBreak: null, steps: [], confidence: "high" });
    expect(e.stop.why).toBe("a call with no prompt and no tool result to answer, 50.0 minutes after your last prompt (the rule acts after 30 minutes)");
    expect(e.sentences[0]!.text).toBe("2 calls were made by the agent on its own, starting 50.0 minutes after your last prompt.");
  });

  it("does not call a call idle when a tool result is waiting for it or when the prompt was recent", () => {
    const calls = [call({ id: "j0", minute: 0, prompt: true }), call({ id: "j1", minute: 50, results: 200, sinceHuman: 50 * MIN }), call({ id: "j2", minute: 55, results: 0, sinceHuman: 5 * MIN })];
    expect(run(calls).blocks).toHaveLength(0);
  });
});

describe("cache misses: one call that rewrote a context the cache held", () => {
  const base = [call({ id: "m0", minute: 0, prompt: true, read: 90_000, write5m: 1_000 }), call({ id: "m1", minute: 1, read: 91_000, write5m: 1_000 })];

  it("reads a pause past the cache's life from the timestamps and says so with high confidence", () => {
    const calls = [...base, call({ id: "m2", minute: 20, read: 100, write5m: 90_000 })];
    const { blocks, explain } = run(calls);
    expect(blocks.map((b) => b.kind)).toEqual(["cache_miss"]);
    const e = explain(0);
    expect(e.rule.id).toBe("C-CACHE-1");
    expect(e.rule.observed).toMatchObject({ reason: "ttl_expired", minutes_since_previous_call: 19, cache_lifetime_minutes: 5 });
    expect(e.stop.why).toBe("the call came 19.0 minutes after the one before, past the 5-minute life of the cache");
    expect(e.cascade.confidence).toBe("high");
  });

  it("calls a model switch a model switch, and an unexplained rewrite a guess", () => {
    const sw = run([...base, call({ id: "m2", minute: 2, read: 100, write5m: 90_000, model: "claude-sonnet-5-5" })]).explain(0);
    expect(sw.rule.observed["reason"]).toBe("model_switch");
    expect(sw.cascade.confidence).toBe("high");
    const unexplained = run([...base, call({ id: "m2", minute: 2, read: 100, write5m: 90_000 })]).explain(0);
    expect(unexplained.rule.observed["reason"]).toBe("prefix_changed");
    expect(unexplained.cascade).toMatchObject({ confidence: "low" });
    expect(unexplained.cascade.why).toMatch(/The logs do not say what/);
  });
});

describe("fan-out: a delegated agent's run", () => {
  it("is one block per delegated thread and says it is a cost, not necessarily waste", () => {
    const calls = [
      call({ id: "p0", minute: 0, prompt: true }),
      call({ id: "d1", minute: 1, sidechain: true, thread: "agent-1", cost: 2_000_000 }),
      call({ id: "d2", minute: 2, sidechain: true, thread: "agent-1", cost: 3_000_000 }),
      call({ id: "e1", minute: 1.5, sidechain: true, thread: "agent-2", cost: 1_000_000 }),
      call({ id: "p1", minute: 4 }),
    ];
    const { blocks, explain } = run(calls);
    expect(blocks.map((b) => [b.kind, b.rule, b.threadKey, b.totalMicros])).toEqual([["subagents", "C-FANOUT-1", "agent-1", 5_000_000], ["subagents", "C-FANOUT-1", "agent-2", 1_000_000]]);
    expect(explain(0).sentences[0]!.text).toMatch(/not necessarily waste/);
    expect(BLOCK_RULE.subagents).toBe("C-FANOUT-1");
  });
});

describe("what is not priced is not invented", () => {
  it("counts a block's unpriced calls apart and prices only the rest", () => {
    const loopCalls = [
      call({ id: "u0", minute: 0, prompt: true, tools: [fail("Bash", "q")] }),
      call({ id: "u1", minute: 1, tools: [fail("Bash", "q")] }),
      { ...call({ id: "u2", minute: 2, tools: [fail("Bash", "q")] }), micros: null },
      call({ id: "u3", minute: 3, tools: [fail("Bash", "q")], cost: 2_000_000 }),
    ];
    const { blocks, explain } = run(loopCalls);
    expect(blocks[0]).toMatchObject({ kind: "loops", unpricedCalls: 1 });
    expect(blocks[0]!.calls.map((c) => c.callId)).toEqual(["u2", "u3"]);
    expect(explain(0).sentences[1]!.text).toContain("saved $2.00 (and 1 call on a model with no price, counted and not priced)");
  });
});
