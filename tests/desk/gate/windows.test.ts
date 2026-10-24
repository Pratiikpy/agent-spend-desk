import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { restrictCheck } from "../../../src/desk/policy/restrict.ts";
import { PolicyError, parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { policyToDoc } from "../../../src/desk/policy/doc.ts";
import { parsePolicy } from "../../../src/desk/policy/parse.ts";
import { Gate } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../../src/desk/gate/policy-source.ts";
import { testSnapshot } from "../helpers.ts";
import { call, rig, USD } from "./harness.ts";

const BASE = `
version: 1
rules:
  - id: allow-claude
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "100.00" }
`;

const withRules = (extra: string): string => `${BASE}${extra}`;

/** One call that reserves $2.50 (100,000 output tokens on opus), settled for what it reserved. */
function spend(r: ReturnType<typeof rig>, over: Record<string, unknown> = {}) {
  const d = r.gate.authorize(call(over));
  if (d.verdict === "allow") r.gate.settle({ reservation_id: d.reservationId, actual_micros: d.reservedMicros });
  return d;
}

describe("a cap on the last ten minutes: velocity", () => {
  const yaml = withRules(`  - id: velocity
    kind: permit
    when: {}
    cap: { window: 10m, max_usd: "6.00", warn_at: 0.5, ask_at: 0.9 }
`);

  it("refuses a burst that spends more than the cap in ten minutes, and allows again once the spend has slid out of the window", () => {
    const r = rig({ policyYaml: yaml });
    expect(spend(r, { idempotency_key: "a" }).verdict).toBe("allow"); // 2.50
    r.clock.advance(60_000);
    expect(spend(r, { idempotency_key: "b" }).verdict).toBe("allow"); // 5.00, below the ask line of 5.40
    r.clock.advance(60_000);
    const third = r.gate.authorize(call({ idempotency_key: "c" })); // 7.50 would pass 6.00
    expect(third.verdict).toBe("deny");
    expect(third.reasonCode).toBe("cap_exceeded");
    expect(third.reasons).toContain("cap velocity: deny (last 10 minutes)");
    // Nine more minutes: the first call is 11 minutes old and has left the window, the second has not.
    r.clock.advance(9 * 60_000);
    expect(r.gate.authorize(call({ idempotency_key: "d" })).verdict).toBe("allow"); // 2.50 + 2.50 = 5.00
    expect(r.gate.integrity()).toEqual([]);
  });

  it("asks between the ask line and the cap, and an approval lets that one call through", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a" });
    r.clock.advance(1_000);
    spend(r, { idempotency_key: "b" });
    const third = r.gate.authorize(call({ idempotency_key: "c", max_tokens: 20_000 })); // 5.00 + 0.50 = 5.50: past the ask line, under the cap
    expect(third.verdict).toBe("ask");
    expect(third.reasons).toContain("cap velocity: ask (last 10 minutes)");
  });

  it("says what the window holds and what is left, tightest first", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a" });
    r.clock.advance(1_000);
    const d = r.gate.authorize(call({ idempotency_key: "b" }));
    expect(d.verdict).toBe("allow");
    expect(d.scoped).toEqual([{ rule: "velocity", window: "last 10 minutes", spentMicros: USD(5), limitMicros: USD(6), remainingMicros: USD(1) }]);
    const left = r.gate.budgetLeft({ person: "p-1" });
    expect(left.scoped).toEqual([{ rule: "velocity", window: "last 10 minutes", spentMicros: USD(5), limitMicros: USD(6), remainingMicros: USD(1) }]); // the open reservation counts
  });

  it("counts a reservation that is open, and gives it back when it is voided", () => {
    const r = rig({ policyYaml: yaml });
    const a = r.gate.authorize(call({ idempotency_key: "a" }));
    const b = r.gate.authorize(call({ idempotency_key: "b" }));
    expect(b.verdict).toBe("allow");
    expect(r.gate.authorize(call({ idempotency_key: "c" })).verdict).toBe("deny"); // two open reservations hold 5.00
    r.gate.voidReservation({ reservation_id: a.reservationId });
    expect(r.gate.authorize(call({ idempotency_key: "d" })).verdict).toBe("allow");
  });

  it("is the same after a restart: the window is read from the events, not from memory", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a" });
    spend(r, { idempotency_key: "b" });
    const again = new Gate({ db: r.db, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(yaml)), now: r.clock.now, person: "p-1", ownerKey: "owner-key-for-tests-0123456789" });
    expect(again.authorize(call({ idempotency_key: "c" })).verdict).toBe("deny");
  });

  it("counts only the person's own spend", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a" });
    spend(r, { idempotency_key: "b" });
    expect(r.gate.authorize(call({ idempotency_key: "c", person: "p-2" })).verdict).toBe("allow");
  });
});

describe("a cap on one session", () => {
  const yaml = withRules(`  - id: per-session
    kind: permit
    when: {}
    cap: { window: session, max_usd: "4.00", ask_at: 1.0, warn_at: 0.5 }
`);

  it("stops a session at its cap and leaves another session alone", () => {
    const r = rig({ policyYaml: yaml });
    expect(spend(r, { idempotency_key: "a", session_id: "s-1" }).verdict).toBe("allow"); // 2.50
    const second = r.gate.authorize(call({ idempotency_key: "b", session_id: "s-1" })); // 5.00 passes 4.00
    expect(second.verdict).toBe("deny");
    expect(second.reasons).toContain("cap per-session: deny (session)");
    expect(r.gate.authorize(call({ idempotency_key: "c", session_id: "s-2" })).verdict).toBe("allow");
  });

  it("does not let a session's cap lapse with time", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a", session_id: "s-1" });
    r.clock.advance(5 * 3_600_000);
    expect(r.gate.authorize(call({ idempotency_key: "b", session_id: "s-1" })).verdict).toBe("deny");
  });
});

describe("a cap per model", () => {
  const yaml = withRules(`  - id: per-model
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, per: model, max_usd: "5.50", ask_at: 1.0, warn_at: 0.5 }
`);

  it("counts only the spend on the request's own model", () => {
    const r = rig({ policyYaml: yaml });
    expect(spend(r, { idempotency_key: "a", model: "claude-opus-5" }).verdict).toBe("allow"); // opus 2.50
    expect(spend(r, { idempotency_key: "b", model: "claude-opus-5" }).verdict).toBe("allow"); // opus 5.00: under the cap of 5.50
    const third = r.gate.authorize(call({ idempotency_key: "c", model: "claude-opus-5" }));
    expect(third.verdict).toBe("deny");
    expect(third.reasons).toContain("cap per-model: deny (day per model)");
    // Sonnet has spent nothing: 100,000 output tokens cost $1.00 there.
    expect(r.gate.authorize(call({ idempotency_key: "d", model: "claude-sonnet-5-5" })).verdict).toBe("allow");
  });

  it("starts again the next day", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a", model: "claude-opus-5" });
    spend(r, { idempotency_key: "b", model: "claude-opus-5" });
    r.clock.advance(24 * 3_600_000);
    expect(r.gate.authorize(call({ idempotency_key: "c", model: "claude-opus-5" })).verdict).toBe("allow");
  });

  it("shows the model's own window in what is left", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a", model: "claude-opus-5" });
    const d = r.gate.authorize(call({ idempotency_key: "b", model: "claude-opus-5" }));
    expect(d.scoped).toEqual([{ rule: "per-model", window: "day per model", spentMicros: USD(5), limitMicros: USD(5.5), remainingMicros: USD(0.5) }]);
  });
});

describe("a cap per project", () => {
  const yaml = withRules(`  - id: per-project
    kind: permit
    when: {}
    cap: { window: month, per: project, max_usd: "5.50", ask_at: 1.0, warn_at: 0.5 }
`);

  it("counts only the project's spend this month, whoever on the person's day it came from", () => {
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a", project: "repo:acme/api" });
    spend(r, { idempotency_key: "b", project: "repo:acme/api" });
    expect(r.gate.authorize(call({ idempotency_key: "c", project: "repo:acme/api" })).verdict).toBe("deny");
    expect(r.gate.authorize(call({ idempotency_key: "d", project: "repo:acme/web" })).verdict).toBe("allow");
  });
});

describe("every matching cap applies, and the tightest binds", () => {
  it("denies on the narrowest window and lists the caps tightest first", () => {
    const yaml = withRules(`  - id: velocity
    kind: permit
    when: {}
    cap: { window: 1h, max_usd: "20.00", ask_at: 1.0, warn_at: 0.5 }
  - id: per-session
    kind: permit
    when: {}
    cap: { window: session, max_usd: "4.00", ask_at: 1.0, warn_at: 0.5 }
`);
    const r = rig({ policyYaml: yaml });
    spend(r, { idempotency_key: "a" });
    const d = r.gate.authorize(call({ idempotency_key: "b" }));
    expect(d.verdict).toBe("deny");
    expect(d.reasons).toContain("cap per-session: deny (session)");
    expect(d.reasons.some((x) => x.startsWith("cap velocity"))).toBe(false);
    expect(d.scoped?.map((s) => [s.rule, s.remainingMicros])).toEqual([["per-session", 0], ["velocity", USD(15)]]);
  });

  it("leaves a policy that has none of these windows exactly as it was", () => {
    const r = rig();
    const d = r.gate.authorize(call({ idempotency_key: "a" }));
    expect(d.scoped).toBeUndefined();
    expect(r.gate.budgetLeft({ person: "p-1" }).scoped).toEqual([]);
  });
});

describe("the policy language for the new windows", () => {
  it("reads and writes them, and a condition can ask about them", () => {
    const text = withRules(`  - id: a
    kind: permit
    when: { session_spend_after_usd: { gt: "3.00" } }
    cap: { window: 1h, max_usd: "9.00" }
  - id: b
    kind: permit
    when: {}
    cap: { window: month, per: project, max_usd: "50.00", warn_at: 0.4, ask_at: 0.7 }
`);
    const p = parsePolicyYaml(text);
    const a = p.rules.find((x) => x.id === "a")!;
    expect(a.kind === "permit" && a.cap).toMatchObject({ window: "1h", maxMicros: USD(9) });
    expect(a.when.numeric.session_spend_after_micros).toMatchObject({ lo: USD(3), loOpen: true });
    const b = p.rules.find((x) => x.id === "b")!;
    expect(b.kind === "permit" && b.cap).toMatchObject({ window: "month", per: "project", warnAt: 0.4, askAt: 0.7 });
    // The document form reads back to the same policy.
    expect(parsePolicy(policyToDoc(p))).toEqual(p);
  });

  it.each([
    ["an unknown window", "cap: { window: week, max_usd: \"1.00\" }", /cap window must be one of day, month, session, 10m, 1h/],
    ["an unknown scope", "cap: { window: day, per: team, max_usd: \"1.00\" }", /cap per must be one of person, model, project/],
    ["a session cap per model", "cap: { window: session, per: model, max_usd: \"1.00\" }", /a cap per model has a day or a month window, not session/],
    ["a velocity cap per project", "cap: { window: 10m, per: project, max_usd: \"1.00\" }", /a cap per project has a day or a month window, not 10m/],
  ])("refuses %s", (_name, cap, message) => {
    expect(() => parsePolicyYaml(`version: 1\nrules:\n  - id: x\n    kind: permit\n    when: {}\n    ${cap}\n`)).toThrow(message);
    expect(() => parsePolicyYaml(`version: 1\nrules:\n  - id: x\n    kind: permit\n    when: {}\n    ${cap}\n`)).toThrow(PolicyError);
  });

  it("checks whether an edit only narrows, for the new windows too", () => {
    const rule = (max: string, window = "1h"): string => `version: 1\nrules:\n  - id: allow\n    kind: permit\n    when: {}\n    cap: { window: ${window}, max_usd: "${max}" }\n`;
    const loose = parsePolicyYaml(rule("20.00"));
    expect(restrictCheck(loose, parsePolicyYaml(rule("10.00"))).narrows).toBe(true); // a lower cap only narrows
    const widened = restrictCheck(loose, parsePolicyYaml(rule("40.00")));
    expect(widened.narrows).toBe(false);
    expect(widened.widening?.request.spend_1h_after_micros).toBeGreaterThan(0); // the first window the edit loosens: a spend that used to ask and now goes through
    // Adding a velocity cap to a policy that had none narrows it; removing one widens it.
    const plain = parsePolicyYaml(`version: 1\nrules:\n  - id: allow\n    kind: permit\n    when: {}\n`);
    expect(restrictCheck(plain, parsePolicyYaml(rule("20.00"))).narrows).toBe(true);
    expect(restrictCheck(parsePolicyYaml(rule("20.00")), plain).narrows).toBe(false);
  });
});

describe("the example policy that ships with the Desk", () => {
  it("parses, and stops a burst, a session and one model, each for its own reason", () => {
    const yaml = readFileSync("policies/velocity-and-session.yaml", "utf8");
    const r = rig({ policyYaml: yaml });
    // Four calls of $2.50 on sonnet leave $10 in the ten-minute window; the cap is $25 and the ask line $20.
    const verdicts: string[] = [];
    for (let i = 0; i < 4; i += 1) verdicts.push(spend(r, { idempotency_key: `k${i}`, session_id: `sess-${i}`, model: "claude-sonnet-5-5", max_tokens: 250_000 }).verdict);
    expect(verdicts).toEqual(["allow", "allow", "allow", "allow"]);
    const asks = r.gate.authorize(call({ idempotency_key: "big", session_id: "sess-9", model: "claude-opus-5", max_tokens: 400_000 })); // $10 on opus: $20, at the ask line
    expect(asks.verdict).toBe("ask");
    expect(asks.reasons).toContain("cap velocity: ask (last 10 minutes)");
    const over = r.gate.authorize(call({ idempotency_key: "over", session_id: "sess-10", model: "claude-opus-5", max_tokens: 700_000 })); // $17.50 on opus: $27.50 passes $25
    expect(over.verdict).toBe("deny");
    expect(over.reasons).toContain("cap velocity: deny (last 10 minutes)");
    // One session at a time: $15 calls eleven minutes apart keep each ten minutes light, and the session still fills.
    r.clock.advance(3_600_000);
    const sessionVerdicts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      sessionVerdicts.push(spend(r, { idempotency_key: `s${i}`, session_id: "long", model: "claude-opus-5", max_tokens: 600_000 }).verdict); // $15 each: $15, $30, $45 in the session
      r.clock.advance(11 * 60_000);
    }
    expect(sessionVerdicts).toEqual(["allow", "allow", "allow"]);
    const atCap = r.gate.authorize(call({ idempotency_key: "s3", session_id: "long", model: "claude-opus-5", max_tokens: 600_000 })); // $60: at the cap, past the ask line of $48
    expect(atCap.verdict).toBe("ask");
    const past = r.gate.authorize(call({ idempotency_key: "s4", session_id: "long", model: "claude-opus-5", max_tokens: 800_000 })); // $65 in the session
    expect(past.verdict).toBe("deny");
    expect(past.reasons).toContain("cap per-session: deny (session)");
  });
});

describe("the hook reads the new windows too", () => {
  it("stops a tool call from a session that has used its session cap, and not another session's", () => {
    const yaml = withRules(`  - id: per-session
    kind: permit
    when: {}
    cap: { window: session, max_usd: "4.00", ask_at: 1.0, warn_at: 0.5 }
`);
    const r = rig({ policyYaml: yaml, hookProbeMicros: USD(2) });
    spend(r, { idempotency_key: "a", session_id: "s-1" }); // $2.50 in the session; the next tool call is assumed to cost $2
    const event = (session: string) => ({ hook_event_name: "PreToolUse", session_id: session, tool_name: "Bash", cwd: "/work/api" });
    const stopped = r.gate.hookPreToolUse(event("s-1"));
    expect(stopped.decision).toBe("deny");
    expect(stopped.reason).toContain("cap per-session: deny (session)");
    expect(r.gate.hookPreToolUse(event("s-2")).decision).toBe("allow");
  });
});
