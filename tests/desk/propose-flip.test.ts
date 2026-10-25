import { describe, expect, it } from "vitest";

import { adoptionFailures, MIN_HELD_OUT_PAUSES } from "../../src/desk/decision/adoption.ts";
import { proposalDecisionRecord } from "../../src/desk/decision/from-proposal.ts";
import { describeFlip } from "../../src/desk/flip.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { proposalFlips } from "../../src/desk/propose/flip.ts";
import { propose, renderProposal, type ProposeResult } from "../../src/desk/propose/run.ts";
import type { ReplayCall, ReplayResult, ReplaySession } from "../../src/desk/replay/policy-replay.ts";

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

const TRAIN = [loop("t1", T0 + DAY), loop("t2", T0 + 2 * DAY), clean("t3", T0 + 3 * DAY)];
const STRONG = [...TRAIN, loop("h1", SPLIT + DAY), loop("h2", SPLIT + 2 * DAY), loop("h3", SPLIT + 3 * DAY), loop("h4", SPLIT + 4 * DAY), clean("h5", SPLIT + 5 * DAY)];
const MINIMAL = [...TRAIN, loop("h1", SPLIT + DAY), loop("h2", SPLIT + 2 * DAY), loop("h3", SPLIT + 3 * DAY), clean("h5", SPLIT + 5 * DAY)];

/** A held-out replay with the given paused sessions, for the cases a real replay would need a contrived ledger to reach. */
const replay = (paused: { id: string; landed: boolean }[], landedTotal: number): ReplayResult => ({
  totalMicros: 0,
  savedMicros: 0,
  askedCalls: 0,
  deniedCalls: 0,
  paused: paused.map((p) => ({ sessionId: p.id, at: 0, verdictReason: "forbid r", landed: p.landed })),
  landedTotal,
  landedBlocked: paused.filter((p) => p.landed).map((p) => p.id),
});

describe("what would flip a policy proposal's recommendation", () => {
  it("finds that one paused session landing would turn a clean adoption over, and says how many would", async () => {
    const result = await run(STRONG);
    const cert = proposalFlips(result.heldOut, result.restrict.narrows);
    expect(cert.verdict).toBe("adopt the proposal");
    expect(cert.completeness).toBe("complete");
    expect(cert.smallest).toMatchObject({ kind: "move_landing", subject: "h1", from: "adopt the proposal", to: "keep the policy in force" });
    expect(cert.smallest?.because).toMatch(/paused 1 of \d+ sessions whose work landed/);
    // Four sessions were paused, each unlanded; any one landing would overturn it. Taking one pause away leaves three, enough, so none of those flip it.
    expect(cert.flips.map((f) => f.kind)).toEqual(["move_landing", "move_landing", "move_landing", "move_landing"]);
    expect(describeFlip(cert)).toMatch(/^Session h1 had landed, and the recommendation goes from adopt the proposal to keep the policy in force \(.*\)\. 3 other single changes would also flip it\. All 8 candidate changes were tried\.$/);
  });

  it("finds that a proposal at the edge of the evidence minimum flips when one pause is taken away", async () => {
    const result = await run(MINIMAL);
    expect(result.heldOut.paused.length).toBe(MIN_HELD_OUT_PAUSES);
    const cert = proposalFlips(result.heldOut, result.restrict.narrows);
    expect(cert.flips.filter((f) => f.kind === "remove_pause").map((f) => f.subject)).toEqual(["h1", "h2", "h3"]);
    expect(cert.flips.find((f) => f.kind === "remove_pause")?.because).toMatch(/paused only 2 held-out session\(s\), fewer than the 3 needed/);
  });

  it("finds the one landed session a refusal rests on, and what the recommendation becomes without it", () => {
    const four = proposalFlips(replay([{ id: "a", landed: true }, { id: "b", landed: false }, { id: "c", landed: false }, { id: "d", landed: false }], 5), true);
    expect(four.verdict).toBe("keep the policy in force");
    expect(four.smallest).toMatchObject({ kind: "move_landing", subject: "a", change: "Session a had not landed", to: "adopt the proposal", because: "every check then passes" });
    // Taking away the one pause that blocked landed work flips it too (three pauses are left, enough); nothing about the three unlanded sessions does.
    expect(four.flips.map((f) => `${f.kind}:${f.subject}`)).toEqual(["move_landing:a", "remove_pause:a"]);
    // With only three pauses, taking one away leaves too few to tell the policy from chance, so only the landing state flips it.
    const three = proposalFlips(replay([{ id: "a", landed: true }, { id: "b", landed: false }, { id: "c", landed: false }], 5), true);
    expect(three.flips.map((f) => `${f.kind}:${f.subject}`)).toEqual(["move_landing:a"]);
  });

  it("finds nothing to flip when two landed sessions were blocked, or the proposal widens the policy", () => {
    const two = proposalFlips(replay([{ id: "a", landed: true }, { id: "b", landed: true }, { id: "c", landed: false }], 5), true);
    expect(two.smallest).toBeNull();
    expect(describeFlip(two)).toBe("No single change flips this recommendation (keep the policy in force). All 6 candidate changes were tried.");
    const widens = proposalFlips(replay([{ id: "a", landed: false }, { id: "b", landed: false }, { id: "c", landed: false }], 5), false);
    expect(widens.smallest).toBeNull();
  });

  it("says why there is nothing to test when the proposal paused no held-out session", () => {
    const cert = proposalFlips(replay([], 4), true);
    expect(cert.candidates).toBe(0);
    expect(describeFlip(cert)).toBe("There is no single change to test for this recommendation (keep the policy in force) (the proposal paused no held-out session).");
  });

  it("uses the rule the decision record uses, so the two cannot disagree", async () => {
    for (const sessions of [STRONG, MINIMAL, [...TRAIN, loop("h1", SPLIT + DAY, true), loop("h2", SPLIT + 2 * DAY), loop("h3", SPLIT + 3 * DAY), loop("h4", SPLIT + 4 * DAY)]]) {
      const result = await run(sessions);
      const h = result.heldOut;
      const adopt = adoptionFailures({ narrows: result.restrict.narrows, landedBlocked: h.landedBlocked.length, landedTotal: h.landedTotal, paused: h.paused.length }).length === 0;
      const rec = proposalDecisionRecord({ result, sessions, splitMs: SPLIT, now: NOW });
      expect(rec.chosen).toBe(adopt ? "a2" : "a1");
      expect(proposalFlips(h, result.restrict.narrows).verdict).toBe(adopt ? "adopt the proposal" : "keep the policy in force");
    }
  });

  it("puts the sentence in the decision record's limits and in the proposal report", async () => {
    const result = await run(STRONG);
    const rec = proposalDecisionRecord({ result, sessions: STRONG, splitMs: SPLIT, now: NOW });
    expect(rec.limits.some((l) => l.startsWith("What would flip this recommendation: Session h1 had landed"))).toBe(true);
    const report = renderProposal(result, { sessions: STRONG, splitMs: SPLIT });
    expect(report).toMatch(/\nwhat would flip the recommendation: Session h1 had landed/);
  });
});
