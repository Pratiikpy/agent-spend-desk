import { describe, expect, it } from "vitest";

import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { replayPolicy, type ReplayCall, type ReplaySession } from "../../src/desk/replay/policy-replay.ts";
import { ksPValue, rankPolicies, seeded, windTunnel } from "../../src/desk/replay/wind-tunnel.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const usd = (n: number) => n * 1_000_000;

const LOOP_POLICY = parsePolicyYaml(`
version: 1
rules:
  - { id: ok, kind: permit, when: { model: { in: ["m-*"] } } }
  - { id: stop-loops, kind: forbid, when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "2.00" } }, action: pause }
`);
const CAP_POLICY = parsePolicyYaml(`
version: 1
rules:
  - { id: ok, kind: permit, when: { model: { in: ["m-*"] } }, cap: { window: day, max_usd: "10.00", warn_at: 0.5, ask_at: 0.8 } }
`);

function call(offsetMin: number, cost: number, over: Partial<ReplayCall> = {}): ReplayCall {
  return { offsetMs: offsetMin * 60_000, costMicros: usd(cost), model: "m-1", wasteRule: "none", recoverableMicros: 0, ...over };
}
function session(id: string, calls: ReplayCall[], over: Partial<ReplaySession> = {}): ReplaySession {
  return { id, person: "p1", project: "repo:a", agent: "main", taskType: "code", startMs: T0, landed: false, calls, ...over };
}

describe("policy replay", () => {
  it("lets everything through when nothing is forbidden", () => {
    const r = replayPolicy(LOOP_POLICY, [session("a", [call(0, 1), call(1, 1)])]);
    expect(r).toMatchObject({ totalMicros: usd(2), savedMicros: 0, deniedCalls: 0 });
  });

  it("pauses a looping session at the first forbidden call and counts the rest as saved", () => {
    const loop = (m: number) => call(m, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(2.5) });
    const r = replayPolicy(LOOP_POLICY, [session("a", [call(0, 1), loop(1), loop(2), loop(3)])]);
    expect(r.savedMicros).toBe(usd(9));
    expect(r.deniedCalls).toBe(1);
    expect(r.paused[0]).toMatchObject({ sessionId: "a", landed: false });
  });

  it("reports a landed session that the policy would have paused", () => {
    const loop = call(1, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(3) });
    const r = replayPolicy(LOOP_POLICY, [session("a", [call(0, 1), loop], { landed: true }), session("b", [call(0, 1)], { landed: true })]);
    expect(r.landedBlocked).toEqual(["a"]);
    expect(r.landedTotal).toBe(2);
  });

  it("applies a daily cap to the spend that was actually made, and resets each day", () => {
    const day1 = session("a", [call(0, 4), call(10, 4), call(20, 4), call(30, 4)]);
    const day2 = session("b", [call(0, 4)], { startMs: T0 + DAY });
    const r = replayPolicy(CAP_POLICY, [day1, day2]);
    // 4 and 8 pass; the third call would reach 12 > 10 and is denied; the fourth is saved with it.
    expect(r.savedMicros).toBe(usd(8));
    expect(r.askedCalls).toBe(1); // 8 reaches the ask line (80% of 10)
    expect(r.paused.map((p) => p.sessionId)).toEqual(["a"]);
  });

  it("counts an ask as denied when the owner would decline", () => {
    const s = session("a", [call(0, 4), call(10, 4), call(20, 1)]);
    const approved = replayPolicy(CAP_POLICY, [s], { askAs: "approved" });
    const declined = replayPolicy(CAP_POLICY, [s], { askAs: "denied" });
    expect(approved.savedMicros).toBe(0);
    expect(declined.savedMicros).toBe(usd(5));
  });

  it("orders events across sessions by time, so two sessions share one cap", () => {
    const a = session("a", [call(0, 6)]);
    const b = session("b", [call(5, 6)]);
    const r = replayPolicy(CAP_POLICY, [b, a]);
    expect(r.paused.map((p) => p.sessionId)).toEqual(["b"]);
  });

  it("handles an empty history", () => {
    expect(replayPolicy(LOOP_POLICY, [])).toMatchObject({ totalMicros: 0, savedMicros: 0, paused: [] });
  });
});

function history(weeks: number, perWeek: number, loopEvery = 5): ReplaySession[] {
  const rand = seeded(7);
  const out: ReplaySession[] = [];
  for (let w = 0; w < weeks; w += 1) {
    for (let i = 0; i < perWeek; i += 1) {
      const looping = (w * perWeek + i) % loopEvery === 0;
      const calls: ReplayCall[] = [call(0, 1 + rand() * 2)];
      if (looping) for (let k = 1; k <= 4; k += 1) calls.push(call(k * 3, 2, { wasteRule: "C-LOOP-1", recoverableMicros: usd(2.5) }));
      out.push(session(`s${w}-${i}`, calls, { startMs: T0 + w * 7 * DAY + Math.floor(rand() * 6) * DAY, landed: !looping }));
    }
  }
  return out;
}

describe("wind tunnel", () => {
  it("is reproducible from its seed", () => {
    const h = history(6, 20);
    const a = windTunnel(LOOP_POLICY, h, { innerSims: 8, outerReps: 6, seed: 3 });
    const b = windTunnel(LOOP_POLICY, h, { innerSims: 8, outerReps: 6, seed: 3 });
    expect(a).toEqual(b);
  });

  it("refuses to simulate too little history", () => {
    const r = windTunnel(LOOP_POLICY, history(1, 5));
    expect(r.status).toBe("too_little_history");
    expect(r.historyMayNotPredict).toBe(true);
  });

  it("reports a saving with an ordered interval for a policy that stops loops", () => {
    const r = windTunnel(LOOP_POLICY, history(8, 20), { innerSims: 10, outerReps: 10 });
    expect(r.status).toBe("ok");
    expect(r.savedMicros.mid).toBeGreaterThan(0);
    expect(r.savedMicros.low).toBeLessThanOrEqual(r.savedMicros.mid);
    expect(r.savedMicros.mid).toBeLessThanOrEqual(r.savedMicros.high);
    expect(r.pBlockedLanded.mid).toBe(0); // looping sessions are the only ones forbidden, and none landed
  });

  it("shows a chance of blocking landed work when the policy is too tight", () => {
    const tight = parsePolicyYaml(`
version: 1
rules:
  - { id: ok, kind: permit, when: { model: { in: ["m-*"] } }, cap: { window: day, max_usd: "3.00", warn_at: 0.5, ask_at: 0.9 } }
`);
    const r = windTunnel(tight, history(8, 20), { innerSims: 10, outerReps: 10 });
    expect(r.pBlockedLanded.mid).toBeGreaterThan(0.5);
  });

  it("ranks the safe policy ahead of the tight one", () => {
    const tight = parsePolicyYaml(`
version: 1
rules:
  - { id: ok, kind: permit, when: { model: { in: ["m-*"] } }, cap: { window: day, max_usd: "3.00", warn_at: 0.5, ask_at: 0.9 } }
`);
    const ranked = rankPolicies([{ name: "tight", policy: tight }, { name: "loops", policy: LOOP_POLICY }], history(8, 20), 0.05, { innerSims: 8, outerReps: 8 });
    expect(ranked.map((r) => r.name)).toEqual(["loops", "tight"]);
    expect(ranked[0]?.eligible).toBe(true);
    expect(ranked[1]?.eligible).toBe(false);
  });

  it("flags drift when the last four weeks cost far more than the earlier history", () => {
    const calm = history(10, 20);
    const shifted = calm.map((s) => (s.startMs >= T0 + 6 * 7 * DAY ? { ...s, calls: s.calls.map((c) => ({ ...c, costMicros: c.costMicros * 8 })) } : s));
    expect(windTunnel(LOOP_POLICY, shifted, { innerSims: 4, outerReps: 4 }).historyMayNotPredict).toBe(true);
    expect(windTunnel(LOOP_POLICY, calm, { innerSims: 4, outerReps: 4 }).historyMayNotPredict).toBe(false);
  });
});

describe("two-sample test", () => {
  it("gives p near 1 for the same sample and near 0 for far-apart samples", () => {
    const a = Array.from({ length: 100 }, (_, i) => i);
    expect(ksPValue(a, a)).toBeGreaterThan(0.99);
    expect(ksPValue(a, a.map((x) => x + 1000))).toBeLessThan(0.001);
    expect(ksPValue([], a)).toBe(1);
  });
});
