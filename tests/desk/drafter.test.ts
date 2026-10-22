import { describe, expect, it } from "vitest";

import { probeEvasions, proposeEvasions } from "../../src/desk/agents/attacker.ts";
import { Budget, ASK_LIVE, DRAFT_LIVE } from "../../src/desk/agents/budget.ts";
import { draftPolicy, ruleBrainDraft, type Finding } from "../../src/desk/agents/drafter.ts";
import { hardenPolicy } from "../../src/desk/agents/harden.ts";
import type { ModelPort, ModelRequest, ModelResponse } from "../../src/desk/agents/model.ts";
import { ModelError } from "../../src/desk/agents/model.ts";
import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import type { ReplayCall, ReplaySession } from "../../src/desk/replay/policy-replay.ts";

const usd = (n: number) => Math.round(n * 1_000_000);
const T0 = Date.UTC(2026, 8, 1);

const BASE = parsePolicyYaml(`
version: 1
rules:
  - { id: allow-claude, kind: permit, when: { model: { in: ["claude-*"] } } }
`);

function call(min: number, cost: number, over: Partial<ReplayCall> = {}): ReplayCall {
  return { offsetMs: min * 60_000, costMicros: usd(cost), model: "claude-opus-5", wasteRule: "none", recoverableMicros: 0, ...over };
}
function session(id: string, calls: ReplayCall[], over: Partial<ReplaySession> = {}): ReplaySession {
  return { id, person: "p", project: "repo:a", agent: "main", taskType: "code", startMs: T0, landed: false, calls, ...over };
}

// A looping session that did not land, and a landed session that briefly looped by $1.20.
const TRAINING: ReplaySession[] = [
  session("loop-bad", [call(0, 1), call(1, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(6) }), call(2, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(3) })]),
  session("landed-small-loop", [call(0, 1), call(1, 0.6, { wasteRule: "C-LOOP-1", recoverableMicros: usd(1.2) }), call(2, 0.6, { wasteRule: "C-LOOP-1", recoverableMicros: usd(0.6) })], { landed: true }),
  session("clean", [call(0, 2)], { landed: true }),
];
const FINDINGS: Finding[] = [{ wasteRule: "C-LOOP-1", recoverableMicros: usd(9), occurrences: 2, targetMinMicros: usd(0.5) }];

class Scripted implements ModelPort {
  calls = 0;
  requests: ModelRequest[] = [];
  constructor(private readonly replies: (string | Error)[]) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.requests.push(r);
    const next = this.replies[Math.min(this.calls, this.replies.length - 1)]!;
    this.calls += 1;
    if (next instanceof Error) throw next;
    return { content: next, toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: null };
  }
}
const rule = (threshold: string) => JSON.stringify({ add_rules: [{ id: "stop-loops", kind: "forbid", when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: threshold } }, action: "pause_with_checkpoint" }] });
const opts = (port: ModelPort | null, trace?: MemoryTrace) => ({ current: BASE, findings: FINDINGS, training: TRAINING, port, budget: new Budget(DRAFT_LIVE), ...(trace ? { trace } : {}) });

describe("rule-brain drafter", () => {
  it("picks the lowest threshold that pauses no landed session", () => {
    const { policy, check } = ruleBrainDraft(BASE, FINDINGS, TRAINING);
    expect(check.landedBlocked).toBe(0);
    expect(check.narrows).toBe(true);
    const forbid = policy.rules.find((r) => r.kind === "forbid");
    expect(forbid?.when.numeric.recoverable_micros?.lo).toBe(usd(2));
    expect(check.pausedSessions).toBe(1);
  });

  it("adds no rule when every threshold would block landed work", () => {
    const allLanded = TRAINING.map((s) => ({ ...s, landed: true }));
    const { policy } = ruleBrainDraft(BASE, FINDINGS, allLanded.map((s) => ({ ...s, calls: s.calls.map((c) => ({ ...c, recoverableMicros: c.wasteRule === "none" ? 0 : usd(500) })) })));
    expect(policy.rules).toHaveLength(1);
  });
});

describe("model drafter and its loop", () => {
  it("accepts a first draft that passes both checks", async () => {
    const r = await draftPolicy(opts(new Scripted([rule("2.00")])));
    expect(r).toMatchObject({ accepted: true, rounds: 1, usedFallback: false, escalation: null });
    expect(r.check.landedBlocked).toBe(0);
  });

  it("feeds back a blocked landed session and the revision passes", async () => {
    const trace = new MemoryTrace();
    const port = new Scripted([rule("0.50"), rule("2.00")]);
    const r = await draftPolicy(opts(port, trace));
    expect(r).toMatchObject({ accepted: true, rounds: 2, usedFallback: false });
    expect(port.requests[1]!.messages[1]!.content).toMatch(/pause 1 of 2 sessions whose work landed/);
    expect(trace.events.map((e) => e.event)).toContain("revision.applied");
  });

  it("rejects a draft that widens the policy and says what it newly allows", async () => {
    const widen = JSON.stringify({ add_rules: [{ id: "open", kind: "permit", when: { model: { in: ["gpt-*"] } } }] });
    const port = new Scripted([widen, rule("2.00")]);
    const r = await draftPolicy(opts(port));
    expect(port.requests[1]!.messages[1]!.content).toMatch(/widens the policy/);
    expect(r.accepted).toBe(true);
  });

  it("after the reflexion cap it uses the rule brain's tightest passing policy", async () => {
    const trace = new MemoryTrace();
    const r = await draftPolicy(opts(new Scripted([rule("0.50")]), trace));
    expect(r).toMatchObject({ accepted: true, usedFallback: true });
    expect(trace.events.some((e) => e.event === "fallback.used")).toBe(true);
  });

  it("falls to the rule brain on junk, a model error and no model", async () => {
    for (const port of [new Scripted(["nonsense"]), new Scripted([new ModelError("transient", "HTTP 500")]), new Scripted([JSON.stringify({ add_rules: [] })]), null]) {
      const r = await draftPolicy(opts(port));
      expect(r.usedFallback).toBe(true);
      expect(r.accepted).toBe(true);
    }
  });

  it("feeds a parse error back instead of crashing", async () => {
    const bad = JSON.stringify({ add_rules: [{ id: "x", kind: "forbid", when: { colour: { in: ["red"] } }, action: "pause" }] });
    const r = await draftPolicy(opts(new Scripted([bad, rule("2.00")])));
    expect(r.accepted).toBe(true);
    expect(r.usedFallback).toBe(false);
  });

  it("escalates instead of emitting an unchecked policy when nothing passes", async () => {
    const hopeless = TRAINING.map((s) => ({ ...s, landed: true, calls: s.calls.map((c) => ({ ...c, recoverableMicros: c.wasteRule === "none" ? 0 : usd(500) })) }));
    const r = await draftPolicy({ ...opts(null), training: hopeless });
    expect(r.accepted).toBe(false);
    expect(r.escalation).toMatch(/landed/);
  });
});

describe("attacker", () => {
  const SCOPED = parsePolicyYaml(`
version: 1
rules:
  - { id: allow, kind: permit, when: { model: { in: ["claude-*"] } } }
  - { id: stop, kind: forbid, when: { waste_rule: { in: ["C-LOOP-1"] }, agent: { in: ["main"] }, recoverable_usd: { gt: "2.00" } }, action: pause }
`);
  const HARM = [{ wasteRule: "C-LOOP-1", minRecoverableMicros: usd(0.5) }];

  it("finds the band under the threshold and the agent that steps around the rule", () => {
    const ev = probeEvasions(SCOPED, HARM);
    expect(ev.some((e) => e.dimension === "recoverable_micros")).toBe(true);
    expect(ev.some((e) => e.dimension === "agent" && e.request.agent !== "main")).toBe(true);
    expect(ev.every((e) => e.request.waste_rule === "C-LOOP-1")).toBe(true);
  });

  it("finds nothing when a rule covers the whole harm class", () => {
    const tight = parsePolicyYaml(`
version: 1
rules:
  - { id: allow, kind: permit, when: { model: { in: ["claude-*"] } } }
  - { id: stop, kind: forbid, when: { waste_rule: { in: ["C-LOOP-1"] } }, action: pause }
`);
    expect(probeEvasions(tight, HARM)).toEqual([]);
  });

  it("finds that a policy with no rule for the class leaves it open", () => {
    expect(probeEvasions(BASE, HARM)[0]?.dimension).toBeNull();
  });

  it("keeps a model-proposed evasion only if the evaluator allows it and it is in the harm class", async () => {
    const proposal = JSON.stringify({ requests: [
      { model: "claude-opus-5", agent: "main", waste_rule: "C-LOOP-1", recoverable_usd: "1.00" },
      { model: "claude-opus-5", agent: "main", waste_rule: "C-LOOP-1", recoverable_usd: "9.00" },
      { model: "claude-opus-5", agent: "main", waste_rule: "other", recoverable_usd: "1.00" },
    ] });
    const ev = await proposeEvasions("p", SCOPED, HARM, new Scripted([proposal]), new Budget(ASK_LIVE));
    expect(ev).toHaveLength(1);
    expect(ev[0]?.request.recoverable_micros).toBe(usd(1));
  });

  it("returns nothing, with a trace line, when the attacker model fails", async () => {
    const trace = new MemoryTrace();
    expect(await proposeEvasions("p", SCOPED, HARM, new Scripted([new ModelError("transient", "boom")]), new Budget(ASK_LIVE), trace)).toEqual([]);
    expect(trace.events.some((e) => e.event === "fallback.used")).toBe(true);
  });
});

describe("hardening", () => {
  const SCOPED = parsePolicyYaml(`
version: 1
rules:
  - { id: allow, kind: permit, when: { model: { in: ["claude-*"] } } }
  - { id: stop, kind: forbid, when: { waste_rule: { in: ["C-LOOP-1"] }, agent: { in: ["main"] }, recoverable_usd: { gt: "2.00" } }, action: pause }
`);
  const HARM = [{ wasteRule: "C-LOOP-1", minRecoverableMicros: usd(2.5) }];

  it("closes an evasion by broadening a rule, when that still narrows and blocks no landed work", async () => {
    const r = await hardenPolicy({ original: BASE, drafted: SCOPED, harm: HARM, training: TRAINING, port: null, budget: new Budget(DRAFT_LIVE) });
    expect(r.closed.some((e) => e.dimension === "agent")).toBe(true);
    expect(probeEvasions(r.policy, HARM)).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  it("leaves an evasion unresolved, and visible, when closing it would block landed work", async () => {
    const harm = [{ wasteRule: "C-LOOP-1", minRecoverableMicros: usd(0.5) }];
    const drafted = ruleBrainDraft(BASE, FINDINGS, TRAINING).policy; // threshold 2.00: the band 0.5 to 2.0 stays open
    const r = await hardenPolicy({ original: BASE, drafted, harm, training: TRAINING, port: null, budget: new Budget(DRAFT_LIVE) });
    expect(r.unresolved.length).toBeGreaterThan(0);
    expect(r.unresolved.some((e) => e.dimension === "recoverable_micros")).toBe(true);
  });
});
