import { describe, expect, it } from "vitest";

import { analyseCalls, type AutopsyCall, type AutopsyToolUse } from "../../src/desk/autopsy/engine.ts";
import type { LandingState } from "../../src/desk/outcomes/attribute.ts";
import type { Landing } from "../../src/desk/waste/bloat.ts";
import { detectWaste, potentialTruncations, WASTE_PARAMS, type CallFacts, type OutcomeFacts } from "../../src/desk/waste/detect.ts";

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

/** What the ledger says about outcomes, as the two outcome rules read it; every answer can be changed to take one condition away. */
function outcomes(over: Partial<{ state: LandingState | null; confidence: "high" | "medium" | "low" | null; landing: Landing; resumed: boolean; calls: number; last: number; asOf: number; prs: number[] | null }> = {}): OutcomeFacts {
  const o = { state: "unlinked" as LandingState | null, confidence: null as "high" | "medium" | "low" | null, landing: "none" as Landing, resumed: false, prs: null as number[] | null, calls: 12, last: T0 + 11 * MIN, asOf: T0 + 11 * MIN + 3 * 24 * 60 * MIN, ...over };
  return {
    asOfMs: o.asOf,
    state: () => (o.state === null ? null : { state: o.state, bestConfidence: o.confidence }),
    landing: () => o.landing,
    callCount: () => o.calls,
    lastCallMs: () => o.last,
    resumed: () => o.resumed,
    abandonedPrs: () => o.prs,
  };
}
const runWith = (calls: AutopsyCall[], f: Map<string, CallFacts>, o: OutcomeFacts | undefined) => detectWaste(calls, analyseCalls(calls), f, o);

describe("C-ABANDON: a long session that ended failing, with nothing landed", () => {
  // Twelve calls; from the ninth on every tool result failed (a different failure each time, so it is not the same-error rule).
  const calls = Array.from({ length: 12 }, (_, i) => call({ id: `a${i}`, minute: i, prompt: i === 0, tools: [bash(`in${i}`)] }));
  const facts = (failFrom = 8, upTo = 12) => factsOf(Object.fromEntries(calls.map((c, i) => [c.callId, { results: [i >= failFrom && i < upTo ? fail(`in${i}`, `E${i}`) : ok(`in${i}`)] }])));

  it("bills the calls from where the final run of failures began, and says what it saw", () => {
    const events = runWith(calls, facts(), outcomes());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rule: "C-ABANDON", micros: 4_000_000, confidence: "high", unpricedCalls: 0 });
    expect(events[0]!.calls.map((c) => c.callId)).toEqual(["a8", "a9", "a10", "a11"]);
    expect(events[0]!.observed).toEqual({ failing_calls_at_the_end: 4, calls_in_session: 12, quiet_hours: 24 });
  });

  it("does nothing when git was never scanned, so it cannot say what landed", () => {
    expect(runWith(calls, facts(), undefined)).toEqual([]);
    expect(runWith(calls, facts(), outcomes({ state: null }))).toEqual([]);
  });

  it("needs more than ten calls, and a run of at least three failures that ends the session", () => {
    expect(runWith(calls, facts(), outcomes({ calls: WASTE_PARAMS.abandonCalls }))).toEqual([]);
    expect(runWith(calls, facts(), outcomes({ calls: WASTE_PARAMS.abandonCalls + 1 }))).toHaveLength(1);
    expect(runWith(calls, facts(10), outcomes())).toEqual([]); // two failures at the end
    expect(runWith(calls, facts(8, 11), outcomes())).toEqual([]); // the last call succeeded: it did not end failing
  });

  it("is not abandoned if the session is not yet over, a commit landed or cannot be ruled out, or someone took the folder up again", () => {
    expect(runWith(calls, facts(), outcomes({ asOf: T0 + 11 * MIN + 23 * 60 * MIN }))).toEqual([]);
    for (const landing of ["landed", "possible", "unknown"] as Landing[]) expect(runWith(calls, facts(), outcomes({ landing })), landing).toEqual([]);
    // Reverted work is not abandoned work: it was committed. C-REVERT takes it, and C-ABANDON does not.
    for (const state of ["committed", "merged", "kept", "reverted"] as LandingState[]) expect(runWith(calls, facts(), outcomes({ state })).filter((e) => e.rule === "C-ABANDON"), state).toEqual([]);
    expect(runWith(calls, facts(), outcomes({ resumed: true }))).toEqual([]);
  });

  it("does not look at a session whose last call is outside the window it was given", () => {
    expect(runWith(calls.slice(0, 11), facts(), outcomes({ last: T0 + 11 * MIN }))).toEqual([]);
  });

  it("lets calls with no tool result sit inside the run, and a success inside it end the run", () => {
    const bare = [...calls.slice(0, 9), call({ id: "bare", minute: 9, tools: [] }), ...calls.slice(10)];
    const f = factsOf(Object.fromEntries(bare.map((c, i) => [c.callId, { results: c.callId === "bare" ? [] : [i >= 8 ? fail(`in${i}`, `E${i}`) : ok(`in${i}`)] }])));
    expect(runWith(bare, f, outcomes())[0]!.calls.map((c) => c.callId)).toEqual(["a8", "bare", "a10", "a11"]);
    const f2 = factsOf(Object.fromEntries(calls.map((c, i) => [c.callId, { results: [i === 10 ? ok("in10") : i >= 8 ? fail(`in${i}`, `E${i}`) : ok(`in${i}`)] }])));
    expect(runWith(calls, f2, outcomes())).toEqual([]); // a success two calls from the end: only one failure ends the session
  });

  it("never bills a call another rule already claimed", () => {
    const same = factsOf(Object.fromEntries(calls.map((c, i) => [c.callId, { results: [i >= 8 ? fail(`in${i}`, "SAME") : ok(`in${i}`)] }])));
    const events = runWith(calls, same, outcomes());
    expect(events.map((e) => e.rule).sort()).toEqual(["C-ABANDON", "C-LOOP-2"]);
    const ids = events.flatMap((e) => e.calls.map((c) => c.callId));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("C-REVERT: work that was reverted", () => {
  const calls = Array.from({ length: 5 }, (_, i) => call({ id: `r${i}`, minute: i, prompt: i === 0, tools: [bash(`in${i}`)] }));
  const nothing = factsOf({});

  it("bills every call of a session whose commits were reverted, high only when the link is", () => {
    const high = runWith(calls, nothing, outcomes({ state: "reverted", confidence: "high" }));
    expect(high).toHaveLength(1);
    expect(high[0]).toMatchObject({ rule: "C-REVERT", micros: 5_000_000, confidence: "high" });
    expect(high[0]!.observed).toEqual({ link_confidence: "high", calls: 5 });
    expect(runWith(calls, nothing, outcomes({ state: "reverted", confidence: "medium" }))[0]!.confidence).toBe("low");
  });

  it("is silent for work that landed, was never linked, or has no recorded state, and when git was not scanned", () => {
    for (const state of ["committed", "merged", "kept", "unlinked"] as LandingState[]) expect(runWith(calls, nothing, outcomes({ state, calls: 5, last: T0 + 4 * MIN })), state).toEqual([]);
    expect(runWith(calls, nothing, outcomes({ state: null }))).toEqual([]);
    expect(runWith(calls, nothing, undefined)).toEqual([]);
  });

  it("counts a call on a model with no price as no dollars, and says so", () => {
    const unpriced = calls.map((c, i) => (i === 2 ? { ...c, micros: null } : c));
    const e = runWith(unpriced, nothing, outcomes({ state: "reverted", confidence: "high" }))[0]!;
    expect(e).toMatchObject({ micros: 4_000_000, unpricedCalls: 1 });
  });
});

describe("C-PR: work in a pull request closed without a merge", () => {
  const calls = Array.from({ length: 4 }, (_, i) => call({ id: `p${i}`, minute: i, prompt: i === 0, tools: [bash(`in${i}`)] }));
  const nothing = factsOf({});

  it("bills every call of the session and names the pull requests, high only when the link to the commit is", () => {
    const high = runWith(calls, nothing, outcomes({ state: "committed", confidence: "high", prs: [10, 12], calls: 4, last: T0 + 3 * MIN }));
    expect(high).toHaveLength(1);
    expect(high[0]).toMatchObject({ rule: "C-PR", micros: 4_000_000, confidence: "high" });
    expect(high[0]!.observed).toEqual({ pull_requests: "#10, #12", link_confidence: "high", calls: 4 });
    expect(runWith(calls, nothing, outcomes({ state: "committed", confidence: "medium", prs: [10] }))[0]!.confidence).toBe("low");
  });

  it("is silent when pull requests were not asked for, or none of the session's work was turned down", () => {
    expect(runWith(calls, nothing, outcomes({ state: "committed", confidence: "high", prs: null }))).toEqual([]);
    expect(runWith(calls, nothing, outcomes({ state: "committed", confidence: "high", prs: [] }))).toEqual([]);
    expect(runWith(calls, nothing, undefined)).toEqual([]);
  });

  it("never bills a call another rule already claimed", () => {
    const echo = factsOf(Object.fromEntries(calls.map((c, i) => [c.callId, { results: [fail(`in${i}`, "SAME")] }])));
    const events = runWith(calls, echo, outcomes({ state: "committed", confidence: "high", prs: [10], calls: 4, last: T0 + 3 * MIN }));
    const ids = events.flatMap((e) => e.calls.map((c) => c.callId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.map((e) => e.rule).sort()).toEqual(["C-LOOP-2", "C-PR"]);
  });
});
