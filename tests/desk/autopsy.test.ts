import { describe, expect, it } from "vitest";

import { buildAutopsy, CAUSES, CONFIG, heaviestWindow, type AutopsyCall } from "../../src/desk/autopsy/engine.ts";
import { listPriceCost } from "../../src/desk/cost/cost.ts";
import { OPUS5 } from "./helpers.ts";

const MIN = 60_000;
let seq = 0;

interface Spec {
  t: number; // minutes from the start
  read?: number;
  write5m?: number;
  write1h?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  model?: string;
  sidechain?: boolean;
  thread?: string;
  tools?: [string, string][];
  toolResultChars?: number;
  prompt?: boolean;
  sincePrompt?: number | null;
  unpriced?: boolean;
}

function call(s: Spec): AutopsyCall {
  const tokens = { input: s.input ?? 0, output: s.output ?? 0, reasoning: s.reasoning ?? 0, read: s.read ?? 0, write5m: s.write5m ?? 0, write1h: s.write1h ?? 0 };
  const c = listPriceCost(
    { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: tokens.read, cacheWrite5mTokens: tokens.write5m, cacheWrite1hTokens: tokens.write1h },
    OPUS5,
  ).components;
  seq += 1;
  return {
    callId: `c${seq}`,
    threadKey: s.thread ?? "main",
    sessionId: "s1",
    tsMs: s.t * MIN,
    model: s.model ?? "claude-opus-5",
    isSidechain: s.sidechain ?? false,
    tokens,
    readMicrosPerToken: OPUS5.cacheReadPerMTokMicros / 1_000_000,
    micros: s.unpriced ? null : { input: c.input, output: c.output, read: c.cacheRead, write5m: c.cacheWrite5m, write1h: c.cacheWrite1h },
    tools: (s.tools ?? []).map(([name, inputHash]) => ({ name, inputHash })),
    toolResultChars: s.toolResultChars ?? 0,
    humanPromptBefore: s.prompt ?? false,
    msSinceHumanPrompt: s.sincePrompt === undefined ? 1 * MIN : s.sincePrompt === null ? null : s.sincePrompt * MIN,
  };
}

const run = (calls: AutopsyCall[]) => buildAutopsy(calls, 0, 24 * 60 * MIN);
const micros = (a: ReturnType<typeof run>, cause: (typeof CAUSES)[number]) => a.causes[cause].micros;

describe("limit autopsy", () => {
  it("assigns every micro-dollar to exactly one cause", () => {
    const calls = [
      call({ t: 0, write5m: 20_000, input: 5, output: 400, reasoning: 100 }),
      call({ t: 1, read: 20_000, write5m: 1_500, input: 3, output: 300, reasoning: 50, toolResultChars: 4_000, tools: [["Read", "a"]] }),
      call({ t: 2, read: 21_500, write5m: 800, input: 3, output: 700, reasoning: 0, sidechain: true, thread: "sub" }),
    ];
    const a = run(calls);
    const total = calls.reduce((s, c) => s + (c.micros ? c.micros.input + c.micros.output + c.micros.read + c.micros.write5m + c.micros.write1h : 0), 0);
    expect(a.totalMicros).toBe(total);
    expect(CAUSES.reduce((s, c) => s + micros(a, c), 0)).toBe(total);
  });

  it("calls a steady conversation re-reads plus new work, with no waste cause", () => {
    const a = run([
      call({ t: 0, write5m: 30_000, input: 2, output: 500 }),
      call({ t: 1, read: 30_000, write5m: 600, input: 2, output: 500 }),
      call({ t: 2, read: 30_600, write5m: 600, input: 2, output: 500 }),
    ]);
    expect(micros(a, "cache_misses")).toBe(0);
    expect(micros(a, "loops")).toBe(0);
    expect(micros(a, "idle")).toBe(0);
    expect(micros(a, "history_rereads")).toBeGreaterThan(0);
    expect(a.missEvents).toEqual([]);
  });

  it("finds a cache miss after the cache expired and prices only the extra cost", () => {
    const a = run([
      call({ t: 0, write5m: 40_000, output: 100 }),
      call({ t: 20, read: 0, write5m: 40_500, output: 100 }), // 20 minutes later, 5-minute cache gone, context rewritten
    ]);
    expect(a.missEvents).toHaveLength(1);
    expect(a.missEvents[0]).toMatchObject({ reason: "ttl_expired", tokens: 40_000 });
    expect(micros(a, "cache_misses")).toBeGreaterThan(0);
    expect(a.missEvents[0]!.savingMicros).toBeLessThan(micros(a, "cache_misses")); // a hit would still have cost the read price
  });

  it("uses the one-hour limit when the earlier writes were one-hour writes", () => {
    const a = run([call({ t: 0, write1h: 40_000 }), call({ t: 20, read: 0, write1h: 40_500 }), call({ t: 100, read: 0, write1h: 41_000 })]);
    expect(a.missEvents.map((e) => e.reason)).toEqual(["prefix_changed", "ttl_expired"]);
  });

  it("names a model switch and a changed prefix", () => {
    const a = run([
      call({ t: 0, write5m: 40_000 }),
      call({ t: 1, read: 0, write5m: 40_100, model: "claude-sonnet-5-5" }),
      call({ t: 2, read: 0, write5m: 40_200, model: "claude-sonnet-5-5" }),
    ]);
    expect(a.missEvents.map((e) => e.reason)).toEqual(["model_switch", "prefix_changed"]);
  });

  it("does not count a compaction or restart as a cache miss", () => {
    const a = run([call({ t: 0, read: 150_000, write5m: 2_000 }), call({ t: 1, read: 0, write5m: 12_000 })]);
    expect(a.missEvents).toEqual([]);
    expect(micros(a, "cache_misses")).toBe(0);
  });

  it("flags the third identical tool call as a loop and every one after it", () => {
    const same: [string, string][] = [["Bash", "deadbeef"]];
    const calls = [
      call({ t: 0, write5m: 10_000 }),
      call({ t: 1, read: 10_000, write5m: 300, tools: same, toolResultChars: 100 }),
      call({ t: 2, read: 10_300, write5m: 300, tools: same, toolResultChars: 100 }),
      call({ t: 3, read: 10_600, write5m: 300, tools: same, toolResultChars: 100 }),
      call({ t: 4, read: 10_900, write5m: 300, tools: same, toolResultChars: 100 }),
    ];
    const a = run(calls);
    expect(a.loopCalls).toBe(2);
    expect(micros(a, "loops")).toBeGreaterThan(0);
  });

  it("does not call different inputs a loop, and resets after a human prompt", () => {
    const a = run([
      call({ t: 0, write5m: 1000, tools: [["Bash", "a"]] }),
      call({ t: 1, read: 1000, tools: [["Bash", "b"]] }),
      call({ t: 2, read: 1000, tools: [["Bash", "c"]] }),
      call({ t: 3, read: 1000, tools: [["Bash", "a"]] }),
      call({ t: 4, read: 1000, tools: [["Bash", "a"]], prompt: true }),
      call({ t: 5, read: 1000, tools: [["Bash", "a"]] }),
    ]);
    expect(a.loopCalls).toBe(0);
  });

  it("puts a delegated agent's whole cost under sub-agents", () => {
    const a = run([call({ t: 0, write5m: 5_000, output: 200, sidechain: true, thread: "sub" })]);
    expect(micros(a, "subagents")).toBe(a.totalMicros);
    expect(micros(a, "history_rereads")).toBe(0);
  });

  it("calls a call that nobody asked for idle, but not one that follows a tool result or a prompt", () => {
    const a = run([
      call({ t: 0, write5m: 8_000, prompt: true }),
      call({ t: 120, read: 8_000, write5m: 100, sincePrompt: 120 }), // two hours later, no prompt, no tool result
      call({ t: 121, read: 8_100, write5m: 100, sincePrompt: 121, toolResultChars: 400 }), // caused by a tool result
    ]);
    expect(a.causes.idle.calls).toBe(1);
    expect(micros(a, "idle")).toBeGreaterThan(0);
  });

  it("estimates tool output from result length and says it is an estimate", () => {
    const a = run([
      call({ t: 0, write5m: 20_000 }),
      call({ t: 1, read: 20_000, write5m: 2_000, toolResultChars: 4_000, tools: [["Read", "x"]] }), // about 1,000 tokens of tool output
    ]);
    expect(a.causes.tool_output.tokens).toBe(1_000);
    expect(a.toolOutputIsEstimate).toBe(true);
    expect(CONFIG.charsPerToken).toBe(4);
  });

  it("counts unpriced calls separately and never prices them at zero", () => {
    const a = run([call({ t: 0, write5m: 1000 }), call({ t: 1, read: 1000, output: 50, unpriced: true })]);
    expect(a.unpricedCalls).toBe(1);
    expect(a.pricedCalls).toBe(1);
    expect(a.unpricedTokens).toBe(1050);
  });

  it("returns zeros for an empty window and respects the window edges", () => {
    expect(run([]).totalMicros).toBe(0);
    const calls = [call({ t: 0, write5m: 1000 }), call({ t: 400, read: 1000 })];
    expect(buildAutopsy(calls, 0, 60 * MIN).pricedCalls).toBe(1);
  });

  it("finds the heaviest window by cost", () => {
    const calls = [call({ t: 0, write5m: 1_000 }), call({ t: 600, write5m: 50_000 }), call({ t: 610, read: 50_000, write5m: 50_000 }), call({ t: 1_500, write5m: 2_000 })];
    const w = heaviestWindow(calls, 5);
    expect(w?.startMs).toBe(600 * MIN);
    expect(heaviestWindow([], 5)).toBeNull();
  });
});
