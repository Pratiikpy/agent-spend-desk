import { describe, expect, it } from "vitest";

import { analyseCalls, type AutopsyCall, type AutopsyToolUse } from "../../src/desk/autopsy/engine.ts";
import { detectWaste, potentialTruncations, WASTE_PARAMS, type CallFacts } from "../../src/desk/waste/detect.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-10-20T09:00:00.000Z");

interface Spec {
  id: string;
  minute: number;
  tools?: AutopsyToolUse[];
  prompt?: boolean;
  sidechain?: boolean;
  thread?: string;
  session?: string;
  cost?: number;
  stop?: string | null;
}

function call(s: Spec): AutopsyCall {
  return {
    callId: s.id,
    threadKey: s.thread ?? "main",
    sessionId: s.session ?? "s1",
    tsMs: T0 + s.minute * MIN,
    model: "claude-opus-5",
    isSidechain: s.sidechain ?? false,
    tokens: { input: 10, output: 100, reasoning: 0, read: 5_000, write5m: 100, write1h: 0 },
    micros: { input: 0, output: s.cost ?? 1_000_000, read: 0, write5m: 0, write1h: 0 },
    tools: s.tools ?? [],
    stopReason: s.stop ?? null,
    toolResultChars: 50,
    humanPromptBefore: s.prompt ?? false,
    msSinceHumanPrompt: s.minute * MIN,
  };
}

const bash = (hash: string): AutopsyToolUse => ({ name: "Bash", inputHash: hash });
const factsOf = (rows: Record<string, Partial<CallFacts>>): Map<string, CallFacts> => new Map(Object.entries(rows).map(([id, f]) => [id, { results: f.results ?? [], editedPaths: f.editedPaths ?? [] }]));
const fail = (inputHash: string, resultHash: string, name = "Bash") => ({ name, inputHash, resultHash, truncated: false, isError: true });
const ok = (inputHash: string, name = "Bash") => ({ name, inputHash, resultHash: "OK", truncated: false, isError: false });

function run(calls: AutopsyCall[], f: Map<string, CallFacts>) {
  return detectWaste(calls, analyseCalls(calls), f);
}

describe("C-LOOP-2: the same error again and again", () => {
  const seq = (n: number, prompts: number[] = []) => Array.from({ length: n }, (_, i) => call({ id: `e${i}`, minute: i, prompt: i === 0 || prompts.includes(i), tools: [bash(`in${i}`)] }));
  const same = (n: number, hash = "H1") => factsOf(Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, { results: [fail(`in${i}`, hash)] }])));

  it("flags the third and later calls that fail the same way, and prices them", () => {
    const events = run(seq(5), same(5));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rule: "C-LOOP-2", micros: 3_000_000, confidence: "high", unpricedCalls: 0 });
    expect(events[0]!.calls.map((c) => c.callId)).toEqual(["e2", "e3", "e4"]);
    expect(events[0]!.observed).toEqual({ failing_tool: "Bash", repeats_required: 3 });
  });

  it("does not flag two repeats, three different errors, or a result that was not an error", () => {
    expect(run(seq(2), same(2))).toEqual([]);
    expect(run(seq(3), factsOf({ e0: { results: [fail("in0", "A")] }, e1: { results: [fail("in1", "B")] }, e2: { results: [fail("in2", "C")] } }))).toEqual([]);
    const reads = Array.from({ length: 4 }, (_, i) => call({ id: `g${i}`, minute: i, prompt: i === 0, tools: [bash("git-status")] }));
    expect(run(reads, factsOf(Object.fromEntries(reads.map((c) => [c.callId, { results: [ok("git-status")] }]))))).toEqual([]);
  });

  it("starts the count again after a success of that tool, but not after a success of another tool", () => {
    const calls = Array.from({ length: 6 }, (_, i) => call({ id: `e${i}`, minute: i, prompt: i === 0, tools: [bash(`in${i}`)] }));
    const withSuccess = factsOf({ e0: { results: [fail("in0", "H")] }, e1: { results: [fail("in1", "H")] }, e2: { results: [ok("in2")] }, e3: { results: [fail("in3", "H")] }, e4: { results: [fail("in4", "H")] }, e5: { results: [fail("in5", "H")] } });
    expect(run(calls, withSuccess).map((e) => e.calls.map((c) => c.callId))).toEqual([["e5"]]); // two, a success, then three: billed from the third of the second run
    const otherTool = factsOf({ e0: { results: [fail("in0", "H")] }, e1: { results: [fail("in1", "H")] }, e2: { results: [ok("in2", "Read")] }, e3: { results: [fail("in3", "H")] } });
    expect(run(calls.slice(0, 4), otherTool).map((e) => e.calls.map((c) => c.callId))).toEqual([["e3"]]);
  });

  it("starts the count again after a prompt from you", () => {
    expect(run(seq(5, [2, 4]), same(5))).toEqual([]);
    expect(run(seq(5, [2]), same(5))).toHaveLength(1); // the three after the prompt count again
  });

  it("never bills a call the autopsy already counts as a loop", () => {
    const calls = Array.from({ length: 5 }, (_, i) => call({ id: `x${i}`, minute: i, prompt: i === 0, tools: [bash("one-input")] }));
    const f = factsOf(Object.fromEntries(calls.map((c) => [c.callId, { results: [fail("one-input", "H1")] }])));
    const ids = run(calls, f).flatMap((e) => e.calls.map((c) => c.callId));
    for (const [id, a] of analyseCalls(calls)) if (a.wholeCall === "loops" || a.wholeCall === "idle") expect(ids).not.toContain(id);
  });
});

describe("C-TRUNC: a cut-short result and a repeat", () => {
  const cut = { name: "Read", inputHash: "bigfile", resultHash: "R", truncated: true, isError: false };
  const calls = (repeatAt: number | null) => {
    const list = [call({ id: "t0", minute: 0, prompt: true, tools: [{ name: "Read", inputHash: "bigfile" }] }), call({ id: "t1", minute: 1, tools: [{ name: "Grep", inputHash: "g" }] }), call({ id: "t2", minute: 2, tools: [{ name: "Grep", inputHash: "h" }] }), call({ id: "t3", minute: 3, tools: [{ name: "Grep", inputHash: "i" }] }), call({ id: "t4", minute: 4, tools: [{ name: "Edit", inputHash: "e" }] })];
    if (repeatAt !== null) list[repeatAt] = call({ id: `t${repeatAt}`, minute: repeatAt, tools: [{ name: "Read", inputHash: "bigfile" }] });
    return list;
  };

  it("bills the calls from the cut to the repeat, when the same tool use is asked again within three calls", () => {
    const e = run(calls(2), factsOf({ t0: { results: [cut] } }));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ rule: "C-TRUNC", micros: 2_000_000, confidence: "high" });
    expect(e[0]!.calls.map((c) => c.callId)).toEqual(["t1", "t2"]);
    expect(e[0]!.observed).toMatchObject({ truncated_tool: "Read", truncated_call: "t0", repeated_after_calls: 2 });
  });

  it("does not bill a cut with no repeat, or a repeat four calls later, and lists the cut as a possibility only", () => {
    const f = factsOf({ t0: { results: [cut] } });
    expect(run(calls(null), f)).toEqual([]);
    expect(run(calls(4), f)).toEqual([]); // four calls later is not within three
    expect(potentialTruncations(calls(null), f, [])).toEqual([{ callId: "t0", sessionId: "s1", tool: "Read" }]);
    const billed = run(calls(2), f);
    expect(potentialTruncations(calls(2), f, billed)).toEqual([]); // a confirmed cut is billed, not merely possible
  });

  it("does not call an ordinary result a cut", () => {
    const f = factsOf({ t0: { results: [{ ...cut, truncated: false }] } });
    expect(run(calls(2), f)).toEqual([]);
    expect(potentialTruncations(calls(2), f, [])).toEqual([]);
  });
});

describe("C-CHURN: one file edited with nothing run between", () => {
  const edit = (i: number, over: Partial<Spec> = {}) => call({ id: `c${i}`, minute: i, tools: [{ name: "Edit", inputHash: `e${i}` }], ...over });
  const onFile = (calls: AutopsyCall[], path = "src/a.ts") => factsOf(Object.fromEntries(calls.filter((c) => c.tools.some((t) => t.name === "Edit")).map((c) => [c.callId, { editedPaths: [path] }])));

  it("flags the fourth edit of one file and the edits after it, and marks it a heuristic", () => {
    const c = [edit(0, { prompt: true }), edit(1), edit(2), edit(3), edit(4), edit(5)];
    const e = run(c, onFile(c));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ rule: "C-CHURN", micros: 3_000_000, confidence: "low" });
    expect(e[0]!.calls.map((x) => x.callId)).toEqual(["c3", "c4", "c5"]);
    expect(e[0]!.observed).toEqual({ edits_required: WASTE_PARAMS.churnEdits });
  });

  it("does not flag three edits, edits of different files, or edits with a read or a search between", () => {
    const three = [edit(0, { prompt: true }), edit(1), edit(2)];
    expect(run(three, onFile(three))).toEqual([]);
    const mixed = [edit(0, { prompt: true }), edit(1), edit(2), edit(3), edit(4), edit(5)];
    expect(run(mixed, factsOf(Object.fromEntries(mixed.map((c, i) => [c.callId, { editedPaths: [`src/f${i}.ts`] }]))))).toEqual([]);
    const withReads = [edit(0, { prompt: true }), call({ id: "r1", minute: 1, tools: [{ name: "Read", inputHash: "r" }] }), edit(2), call({ id: "g3", minute: 3, tools: [{ name: "Grep", inputHash: "g" }] }), edit(4), edit(5)];
    expect(run(withReads, onFile(withReads)).map((x) => x.calls.map((c) => c.callId))).toEqual([["c5"]]); // reads and searches do not run a check
  });

  it("starts the count again after a call that could run a check, or after a prompt from you", () => {
    const c = [edit(0, { prompt: true }), edit(1), edit(2), call({ id: "b3", minute: 3, tools: [bash("npm test")] }), edit(4), edit(5), edit(6)];
    expect(run(c, onFile(c))).toEqual([]); // a shell call between the edits: iteration, not churn
    const p = [edit(0, { prompt: true }), edit(1), edit(2), edit(3, { prompt: true }), edit(4), edit(5)];
    expect(run(p, onFile(p))).toEqual([]);
  });

  it("treats a delegated agent or an unknown tool as able to run a check", () => {
    const c = [edit(0, { prompt: true }), edit(1), call({ id: "a2", minute: 2, tools: [{ name: "Task", inputHash: "t" }] }), edit(3), edit(4), edit(5)];
    expect(run(c, onFile(c))).toEqual([]);
    const m = [edit(0, { prompt: true }), edit(1), call({ id: "m2", minute: 2, tools: [{ name: "mcp__thing__run", inputHash: "t" }] }), edit(3), edit(4), edit(5)];
    expect(run(m, onFile(m))).toEqual([]);
  });
});

describe("C-UNREF: the model carrying on alone with no tool", () => {
  const bare = (i: number, stop: string | null, over: Partial<Spec> = {}) => call({ id: `u${i}`, minute: i, stop, ...over });

  it("bills the third and later bare calls when the first two did not hand control back", () => {
    const calls = [bare(0, "stop_sequence", { prompt: true }), bare(1, "max_tokens"), bare(2, "stop_sequence"), bare(3, "end_turn")];
    const e = run(calls, new Map());
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ rule: "C-UNREF", micros: 2_000_000 });
    expect(e[0]!.calls.map((c) => c.callId)).toEqual(["u2", "u3"]);
  });

  it("does not bill bare calls that each ended their turn: those answered something", () => {
    const calls = [bare(0, "end_turn", { prompt: true }), bare(1, "end_turn"), bare(2, "end_turn"), bare(3, "end_turn")];
    expect(run(calls, new Map())).toEqual([]);
  });

  it("does not bill when the stop reason is not recorded, because an incomplete record proves nothing", () => {
    expect(run([bare(0, null, { prompt: true }), bare(1, null), bare(2, null), bare(3, null)], new Map())).toEqual([]);
  });

  it("does not bill a call with a tool, a call after a prompt, or only two in a row", () => {
    expect(run([bare(0, "stop_sequence", { prompt: true }), bare(1, "stop_sequence")], new Map())).toEqual([]);
    expect(run([bare(0, "stop_sequence"), bare(1, "stop_sequence"), call({ id: "t2", minute: 2, stop: "tool_use", tools: [bash("x")] }), bare(3, "stop_sequence"), bare(4, "stop_sequence")], new Map())).toEqual([]);
    expect(run([bare(0, "stop_sequence"), bare(1, "stop_sequence"), bare(2, "stop_sequence", { prompt: true }), bare(3, "stop_sequence")], new Map())).toEqual([]);
  });
});

describe("C-ORPHAN: a delegated agent after its parent has stopped", () => {
  const main = (i: number, over: Partial<Spec> = {}) => call({ id: `m${i}`, minute: i, thread: "main", ...over });
  const kid = (i: number, minute: number, over: Partial<Spec> = {}) => call({ id: `k${i}`, minute, thread: "agent-1", sidechain: true, tools: [bash(`k${i}`)], ...over });

  it("bills the delegated calls made more than thirty minutes after the parent's last call with no prompt between", () => {
    const calls = [main(0, { prompt: true }), main(1), kid(0, 5), kid(1, 35), kid(2, 45)];
    const e = run(calls, new Map());
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ rule: "C-ORPHAN", micros: 2_000_000 });
    expect(e[0]!.calls.map((c) => c.callId)).toEqual(["k1", "k2"]);
    expect(e[0]!.observed).toMatchObject({ minutes_after_parent: 34, orphan_after_minutes: 30 });
  });

  it("does not bill calls inside thirty minutes, while the parent is still working, or after you came back with a prompt", () => {
    expect(run([main(0, { prompt: true }), main(1), kid(0, 5), kid(1, 25)], new Map())).toEqual([]);
    expect(run([main(0, { prompt: true }), main(1), main(50), kid(0, 35), kid(1, 40)], new Map())).toEqual([]);
    expect(run([main(0, { prompt: true }), main(1), main(33, { prompt: true }), kid(0, 35), kid(1, 45)], new Map())).toEqual([]);
  });

  it("does not guess when a session has no parent thread", () => {
    expect(run([kid(0, 5), kid(1, 60)], new Map())).toEqual([]);
  });
});

describe("the classes can be added up", () => {
  it("claims each call once, so two rules never bill the same call", () => {
    // Edits that also fail the same way: the first rule in the order keeps them.
    const calls = Array.from({ length: 8 }, (_, i) => call({ id: `z${i}`, minute: i, prompt: i === 0, tools: [{ name: "Edit", inputHash: `e${i}` }] }));
    const f = factsOf(Object.fromEntries(calls.map((c, i) => [c.callId, { editedPaths: ["src/a.ts"], results: [fail(`e${i}`, "same", "Edit")] }])));
    const events = run(calls, f);
    const ids = events.flatMap((e) => e.calls.map((c) => c.callId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(events[0]!.rule).toBe("C-LOOP-2");
    expect(WASTE_PARAMS.echoRepeats).toBe(3);
  });

  it("counts a call on a model with no price as no dollars and says so", () => {
    const calls = Array.from({ length: 4 }, (_, i) => call({ id: `p${i}`, minute: i, prompt: i === 0, tools: [bash(`in${i}`)] }));
    calls[3] = { ...(calls[3] as AutopsyCall), micros: null };
    const e = run(calls, factsOf(Object.fromEntries(calls.map((c, i) => [c.callId, { results: [fail(`in${i}`, "H")] }]))));
    expect(e[0]).toMatchObject({ micros: 1_000_000, unpricedCalls: 1 });
  });
});
