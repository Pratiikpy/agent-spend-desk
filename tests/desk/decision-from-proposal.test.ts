import { describe, expect, it } from "vitest";

import { decisionRecordHash } from "../../src/desk/decision/record.ts";
import { MIN_HELD_OUT_PAUSES, proposalDecisionRecord } from "../../src/desk/decision/from-proposal.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { propose, type ProposeResult } from "../../src/desk/propose/run.ts";
import type { ReplayCall, ReplaySession } from "../../src/desk/replay/policy-replay.ts";

const usd = (n: number) => Math.round(n * 1_000_000);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const SPLIT = T0 + 30 * DAY;
const NOW = new Date("2026-10-24T09:00:00.000Z");

const BASE = parsePolicyYaml(`
version: 1
rules:
  - { id: allow-claude, kind: permit, when: { model: { in: ["claude-*"] } } }
`);

const call = (min: number, cost: number, over: Partial<ReplayCall> = {}): ReplayCall => ({ offsetMs: min * 60_000, costMicros: usd(cost), model: "claude-opus-5", wasteRule: "none", recoverableMicros: 0, ...over });
const session = (id: string, startMs: number, calls: ReplayCall[], over: Partial<ReplaySession> = {}): ReplaySession => ({ id, person: "p", project: "repo:a", agent: "main", taskType: "code", startMs, landed: false, calls, ...over });
const loop = (id: string, startMs: number, landed = false): ReplaySession =>
  session(id, startMs, [call(0, 1), call(1, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(6) }), call(2, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(3) })], { landed });
const clean = (id: string, startMs: number): ReplaySession => session(id, startMs, [call(0, 2)], { landed: true });

const run = (sessions: ReplaySession[]): Promise<ProposeResult> => propose({ current: BASE, sessions, splitMs: SPLIT, targetMinMicros: usd(0.5), port: null });

const STRONG = [loop("t1", T0 + DAY), loop("t2", T0 + 2 * DAY), clean("t3", T0 + 3 * DAY), loop("h1", SPLIT + DAY), loop("h2", SPLIT + 2 * DAY), loop("h3", SPLIT + 3 * DAY), loop("h4", SPLIT + 4 * DAY), clean("h5", SPLIT + 5 * DAY), clean("h6", SPLIT + 6 * DAY)];

describe("the decision record of a proposal", () => {
  it("recommends adopting a proposal that narrows the policy, pauses enough held-out sessions and blocks no landed one", async () => {
    const result = await run(STRONG);
    expect(result.heldOut.paused.length).toBeGreaterThanOrEqual(MIN_HELD_OUT_PAUSES);
    const rec = proposalDecisionRecord({ result, sessions: STRONG, splitMs: SPLIT, now: NOW });
    expect(rec.chosen).toBe("a2");
    expect(rec.alternatives.map((a) => [a.id, a.outcome])).toEqual([["a1", "rejected"], ["a2", "chosen"]]);
    expect(rec.alternatives[0]?.summary).toMatch(/do nothing/i);
    expect(rec.tests.map((t) => [t.kind, t.passed])).toEqual([["restrict_check", true], ["held_out_replay", true], ["attack", true]]);
    expect(rec.id).toBe(`dr-${result.policyHash.replace("sha256:", "").slice(0, 12)}`);
    expect(rec.context.window).toEqual({ from: "2026-09-02", to: "2026-10-07" });
    expect(rec.approver).toBeNull();
    expect(rec.enforcement).toBeNull();
    expect(rec.observed).toBeNull();
  });

  it("states what the numbers rest on and never calls a replay experimentally supported", async () => {
    const rec = proposalDecisionRecord({ result: await run(STRONG), sessions: STRONG, splitMs: SPLIT, now: NOW });
    expect(rec.evidenceLevel).toBe("estimated");
    expect(rec.limits.join(" ")).toMatch(/upper bound/);
    expect(rec.limits.join(" ")).toMatch(/without randomised assignment/);
    expect(rec.evidenceIds[0]).toMatch(/^policy:sha256:/);
  });

  it("predicts the share of landed sessions it would pause, with an interval that contains the estimate", async () => {
    const rec = proposalDecisionRecord({ result: await run(STRONG), sessions: STRONG, splitMs: SPLIT, now: NOW });
    expect(rec.predictions).toHaveLength(1);
    const p = rec.predictions[0]!;
    expect(p.expected).toBe(0);
    expect(p.low).toBe(0);
    expect(p.high).toBeGreaterThan(0.2);
    expect(p.level).toBe(0.95);
  });

  it("keeps the policy in force when too few held-out sessions were paused to tell the proposal from chance", async () => {
    const few = [loop("t1", T0 + DAY), clean("t2", T0 + 2 * DAY), loop("h1", SPLIT + DAY), clean("h2", SPLIT + 2 * DAY)];
    const rec = proposalDecisionRecord({ result: await run(few), sessions: few, splitMs: SPLIT, now: NOW });
    expect(rec.chosen).toBe("a1");
    expect(rec.alternatives[1]?.reason).toMatch(/fewer than the 3 needed/);
    expect(rec.decision).toMatch(/Keep the policy in force/);
  });

  it("keeps the policy in force when the proposal would have paused work that landed", async () => {
    const hurt = [...STRONG.slice(0, 6), loop("h4", SPLIT + 4 * DAY, true), clean("h5", SPLIT + 5 * DAY)];
    const result = await run(hurt);
    expect(result.heldOut.landedBlocked.length).toBeGreaterThan(0);
    const rec = proposalDecisionRecord({ result, sessions: hurt, splitMs: SPLIT, now: NOW });
    expect(rec.chosen).toBe("a1");
    expect(rec.tests.find((t) => t.kind === "held_out_replay")?.passed).toBe(false);
    expect(rec.alternatives[1]?.reason).toMatch(/whose work landed/);
    expect(rec.predictions[0]!.expected).toBeGreaterThan(0);
  });

  it("keeps the policy in force and says why when no rule was proposed", async () => {
    const calm = [clean("t1", T0 + DAY), clean("h1", SPLIT + DAY)];
    const rec = proposalDecisionRecord({ result: await run(calm), sessions: calm, splitMs: SPLIT, now: NOW });
    expect(rec.chosen).toBe("a1");
    expect(rec.alternatives[0]?.reason).toMatch(/nothing to adopt/);
    expect(rec.alternatives[1]?.summary).toMatch(/adds no rule/);
  });

  it("refuses to recommend a proposal that widens the policy", async () => {
    const result = await run(STRONG);
    const widened: ProposeResult = { ...result, restrict: { ...result.restrict, narrows: false } };
    const rec = proposalDecisionRecord({ result: widened, sessions: STRONG, splitMs: SPLIT, now: NOW });
    expect(rec.chosen).toBe("a1");
    expect(rec.tests.find((t) => t.kind === "restrict_check")?.passed).toBe(false);
  });

  it("hashes to the same value when made twice from the same inputs", async () => {
    const result = await run(STRONG);
    const a = proposalDecisionRecord({ result, sessions: STRONG, splitMs: SPLIT, now: NOW });
    const b = proposalDecisionRecord({ result, sessions: STRONG, splitMs: SPLIT, now: NOW });
    expect(decisionRecordHash(a)).toBe(decisionRecordHash(b));
  });
});
