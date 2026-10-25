import { describe, expect, it } from "vitest";

import { ATTENTION_REASON, attentionOf, DEFAULT_ATTENTION, isLaunch, launchDenial, reviewOverhead } from "../../../src/desk/gate/attention.ts";
import { call, rig, T0 } from "./harness.ts";

const MIN = 60_000;
const cheap = (session: string, extra: Record<string, unknown> = {}): Record<string, unknown> => call({ session_id: session, max_tokens: 1000, ...extra });
const start = (r: ReturnType<typeof rig>, n: number, person = "p-1"): void => {
  for (let i = 1; i <= n; i += 1) expect(r.gate.authorize(cheap(`s-${person}-${i}`, { person })).verdict).toBe("allow");
};

describe("the governor is off unless it is given limits", () => {
  it("lets any number of agents start, and has no load to report", () => {
    const r = rig();
    for (let i = 1; i <= 8; i += 1) expect(r.gate.authorize(cheap(`s-${i}`)).verdict).toBe("allow");
    expect(r.gate.supervisionLoad("p-1")).toBeNull();
  });
});

describe("a new agent when its person is already supervising the most they can", () => {
  it("is refused with a reason that says how many are working, and an agent already working is never cut off", () => {
    const r = rig({ attention: {} });
    start(r, 4);
    const fifth = r.gate.authorize(cheap("s-fifth"));
    expect(fifth).toMatchObject({ verdict: "deny", reasonCode: ATTENTION_REASON, failed: false });
    expect(fifth.reasons[0]).toMatch(/p-1 already has 4 agents working \(the most allowed is 4\); a 5th is more than one person can supervise/);
    expect(fifth.reasons[0]).toMatch(/emergency bypass/);
    // The four that were already working go on.
    for (let i = 1; i <= 4; i += 1) expect(r.gate.authorize(cheap(`s-p-1-${i}`, { idempotency_key: `again-${i}` })).verdict).toBe("allow");
  });

  it("is let through once an agent has been quiet for ten minutes, and a refused agent does not count as working", () => {
    const r = rig({ attention: {} });
    start(r, 4);
    expect(r.gate.authorize(cheap("s-late")).verdict).toBe("deny");
    expect(r.gate.authorize(cheap("s-late", { idempotency_key: "retry" })).verdict).toBe("deny");
    // Nine minutes on: the first four are still inside the window.
    r.clock.advance(9 * MIN);
    expect(r.gate.authorize(cheap("s-late", { idempotency_key: "k9" })).verdict).toBe("deny");
    // Two minutes more: they have been quiet for eleven minutes, so they have stopped.
    r.clock.advance(2 * MIN);
    expect(r.gate.authorize(cheap("s-late", { idempotency_key: "k11" })).verdict).toBe("allow");
    expect(attentionOf(r.db, "p-1", r.clock.now(), null).activeSessions).toEqual(["s-late"]);
  });

  it("counts each person's agents on their own, and does not count the session that is asking", () => {
    const r = rig({ attention: {} });
    start(r, 4, "p-1");
    expect(r.gate.authorize(cheap("s-other", { person: "p-2" })).verdict).toBe("allow");
    const a = attentionOf(r.db, "p-1", r.clock.now(), "s-p-1-2");
    expect(a.activeSessions).toHaveLength(3);
    expect(a.activeSessions).not.toContain("s-p-1-2");
  });

  it("allows an agent when the owner has opened the emergency bypass", () => {
    const r = rig({ attention: {} });
    start(r, 4);
    expect(r.gate.authorize(cheap("s-fifth")).verdict).toBe("deny");
    r.gate.openBypass(30 * MIN, "owner");
    expect(r.gate.authorize(cheap("s-fifth", { idempotency_key: "bypassed" })).verdict).toBe("allow");
  });

  it("honours the limits it is given", () => {
    const r = rig({ attention: { maxConcurrent: 2 } });
    start(r, 2);
    expect(r.gate.authorize(cheap("s-third"))).toMatchObject({ verdict: "deny", reasonCode: ATTENTION_REASON });
    expect(r.gate.supervisionLoad("p-1")).toMatchObject({ level: "full", activeSessions: expect.any(Array) });
  });
});

describe("a new agent when its person has been asked too many questions", () => {
  /** An approval request, from a call that needs one: raising a cap is the action the test policy asks the owner about. */
  const ask = (r: ReturnType<typeof rig>, i: number): void => {
    const d = r.gate.authorize(cheap("s-asker", { action: "cap.raise", idempotency_key: `q-${i}` }));
    expect(d.verdict).toBe("ask");
  };

  it("refuses a new agent at ten questions in the last hour, though no agent is working elsewhere", () => {
    const r = rig({ attention: { maxConcurrent: 40 } });
    for (let i = 0; i < 10; i += 1) ask(r, i);
    expect(attentionOf(r.db, "p-1", r.clock.now(), null).interruptions).toBe(10);
    const d = r.gate.authorize(cheap("s-new"));
    expect(d).toMatchObject({ verdict: "deny", reasonCode: ATTENTION_REASON });
    expect(d.reasons[0]).toMatch(/has been asked 10 questions in the last hour \(the most allowed is 10\)/);
  });

  it("lets a new agent start nine questions in, and again an hour after the questions", () => {
    const r = rig({ attention: { maxConcurrent: 40 } });
    for (let i = 0; i < 9; i += 1) ask(r, i);
    expect(r.gate.authorize(cheap("s-new")).verdict).toBe("allow");
    ask(r, 9);
    r.clock.advance(61 * MIN);
    expect(r.gate.authorize(cheap("s-after")).verdict).toBe("allow");
  });
});

describe("the load and the warning", () => {
  it("is the larger of the agents and the questions against their limits, counting the agent that would start, and is a warning from 80%", () => {
    const r = rig({ attention: { maxConcurrent: 5 } });
    start(r, 3);
    // Three working, a fourth would be 4 of 5: 80%, a warning, and still allowed.
    const warned = r.gate.authorize(cheap("s-fourth"));
    expect(warned.verdict).toBe("allow");
    expect(r.trace.events.some((e) => e.event === "desk.attention" && (e.detail as { active: number }).active === 3)).toBe(true);
    const a = attentionOf(r.db, "p-1", r.clock.now(), "s-none", { ...DEFAULT_ATTENTION, maxConcurrent: 5 });
    expect(a.load).toBeCloseTo(5 / 5, 10);
    expect(a.level).toBe("warn");
    const calm = rig({ attention: { maxConcurrent: 5 } });
    start(calm, 1);
    expect(attentionOf(calm.db, "p-1", calm.clock.now(), null, { ...DEFAULT_ATTENTION, maxConcurrent: 5 }).level).toBe("ok");
  });

  it("says nothing to refuse for a person with room, and knows a launch from an agent already seen", () => {
    const r = rig({ attention: {} });
    start(r, 1);
    expect(launchDenial(attentionOf(r.db, "p-1", r.clock.now(), "s-x"))).toBeNull();
    expect(isLaunch(r.db, "s-p-1-1", r.clock.now())).toBe(false);
    expect(isLaunch(r.db, "never-seen", r.clock.now())).toBe(true);
    r.clock.advance(11 * MIN);
    expect(isLaunch(r.db, "s-p-1-1", r.clock.now())).toBe(true);
  });
});

describe("the owner's time on the questions the gate asked", () => {
  it("prices the wait from each request to its approval at the owner's rate, and counts a question with no answer apart", () => {
    const r = rig({ attention: {} });
    const asked = r.gate.authorize(cheap("s-1", { action: "cap.raise", idempotency_key: "a" }));
    r.clock.advance(90_000);
    const second = r.gate.authorize(cheap("s-1", { action: "cap.raise", idempotency_key: "b" }));
    r.gate.approve({ approval_request_id: asked.approvalRequest!.approval_request_id, action_digest: asked.approvalRequest!.action_digest }, "owner");
    expect(second.verdict).toBe("ask");
    const o = reviewOverhead(r.db, new Date(T0 - MIN).toISOString(), new Date(r.clock.now() + MIN).toISOString());
    expect(o).toMatchObject({ approvals: 1, unanswered: 1, seconds: 90, micros: 90 * 33_333 });
    expect(o.slowest).toEqual([{ session: "s-1", seconds: 90 }]);
  });

  it("is zero when nothing was asked", () => {
    const r = rig({ attention: {} });
    start(r, 1);
    expect(reviewOverhead(r.db, new Date(T0 - MIN).toISOString(), new Date(T0 + MIN).toISOString())).toEqual({ usdPerHour: 120, approvals: 0, unanswered: 0, seconds: 0, micros: 0, slowest: [] });
  });
});
