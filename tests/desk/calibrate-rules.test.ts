import { describe, expect, it } from "vitest";

import { calibrateRules, CALIBRATION, renderCalibration, rulesOf, type RuleCalibration } from "../../src/desk/calibrate/rules.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import type { ReplayCall, ReplaySession } from "../../src/desk/replay/policy-replay.ts";

const usd = (n: number): number => Math.round(n * 1_000_000);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

/** A session whose one call is on a loop with `recoverable` dollars recoverable, costing `cost`. Each is on its own day so no cap carries over between them. */
function session(id: string, i: number, recoverable: number, landed: boolean, cost = 4, person = "p"): ReplaySession {
  const call: ReplayCall = { offsetMs: 0, costMicros: usd(cost), model: "claude-opus-5", wasteRule: "C-LOOP-1", recoverableMicros: usd(recoverable) };
  return { id, person, project: "repo:a", agent: "main", taskType: "code", startMs: T0 + i * DAY, landed, calls: [call] };
}

const STOP = parsePolicyYaml(`
version: 1
rules:
  - { id: allow-all, kind: permit, when: {} }
  - { id: stop-loops, kind: forbid, when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "2.00" } }, action: pause_with_checkpoint }
`);

/** Twenty sessions a loop of $3 flags and half of them landed, and twenty-five a loop of $9 flags and one of them landed. */
const MISFIRING = (): ReplaySession[] => [
  ...Array.from({ length: 20 }, (_, i) => session(`a${i}`, i, 3, i < 10)),
  ...Array.from({ length: 25 }, (_, i) => session(`b${i}`, 20 + i, 9, i === 0)),
];
const row = (rows: RuleCalibration[], id: string): RuleCalibration => rows.find((r) => r.ruleId === id)!;

describe("which rule stopped a session", () => {
  it("reads the rule ids from the reasons the replay gives, and the default deny", () => {
    expect(rulesOf("forbid stop-loops")).toEqual(["stop-loops"]);
    expect(rulesOf("cap per-session: deny (session); cap allow-claude: ask")).toEqual(["per-session", "allow-claude"]);
    expect(rulesOf("no permit matches (default deny)")).toEqual(["(no rule permits it)"]);
    expect(rulesOf("approval required from alice")).toEqual([]);
  });
});

describe("what each rule flagged and whether it landed", () => {
  it("counts the sessions a rule stopped, those with a known landing, those that landed, and the spend after the stop", () => {
    const r = row(calibrateRules(STOP, MISFIRING()), "stop-loops");
    expect(r).toMatchObject({ flags: 45, labelled: 45, landed: 11, status: "misfires", threshold: "$2.00", what: "stops when recoverable waste is over" });
    expect(r.landedShare).toBeCloseTo(11 / 45, 10);
    expect(r.dollarsMicros).toBe(usd(4 * 45));
  });

  it("says a rule that never fired never fired, and one with no number has no number to move", () => {
    const rows = calibrateRules(STOP, MISFIRING());
    expect(row(rows, "allow-all")).toMatchObject({ status: "never_fired", threshold: null, what: "has no number to move" });
  });

  it("says there is not enough data under twenty flags with a known landing, and holds a rule up when what it flagged did not land", () => {
    const few = calibrateRules(STOP, MISFIRING().slice(0, 10));
    expect(row(few, "stop-loops").status).toBe("not_enough_data");
    const fine = Array.from({ length: 30 }, (_, i) => session(`c${i}`, i, 3, i < 3));
    expect(row(calibrateRules(STOP, fine), "stop-loops")).toMatchObject({ status: "ok", flags: 30, landed: 3 });
  });

  it("leaves a session whose landing is not known out of the share, because unknown is not the same as not landed", () => {
    const sessions = MISFIRING();
    const known = new Set(sessions.slice(0, 10).map((s) => s.id));
    const r = row(calibrateRules(STOP, sessions, known), "stop-loops");
    expect(r).toMatchObject({ flags: 45, labelled: 10, status: "not_enough_data" });
    expect(r.landed).toBe(10);
    const all = new Set(sessions.map((s) => s.id));
    expect(row(calibrateRules(STOP, sessions, all), "stop-loops").status).toBe("misfires");
  });

  it("sits exactly at the limits: twenty flags with a landed share of exactly a fifth is not a misfire, and just over is", () => {
    const at = (landed: number) => Array.from({ length: CALIBRATION.minFlags }, (_, i) => session(`d${i}`, i, 3, i < landed));
    expect(row(calibrateRules(STOP, at(4)), "stop-loops").status).toBe("ok");
    expect(row(calibrateRules(STOP, at(5)), "stop-loops").status).toBe("misfires");
    const nineteen = Array.from({ length: 19 }, (_, i) => session(`e${i}`, i, 3, true));
    expect(row(calibrateRules(STOP, nineteen), "stop-loops").status).toBe("not_enough_data");
  });
});

describe("the lowest higher threshold that brings a misfiring rule under the limit", () => {
  it("replays higher values and offers the lowest that does, with what it stops less and what the restrict-only check says", () => {
    const r = row(calibrateRules(STOP, MISFIRING()), "stop-loops");
    const p = r.proposal;
    expect(p && "none" in p).toBe(false);
    if (!p || "none" in p) return;
    // A threshold of $2.50 still flags the $3 loops, so it is not enough; $3.00 (1.5 times) no longer does, because the rule fires only above it.
    expect(p).toMatchObject({ multiplier: 1.5, threshold: "$3.00", flags: 25, labelled: 25, landed: 1 });
    expect(p.landedShare).toBeCloseTo(0.04, 10);
    expect(p.dollarsGivenUpMicros).toBe(usd(4 * 20));
    expect(p.policy.version).toBe(STOP.version + 1);
    expect(p.restrict.narrows).toBe(false);
    expect(p.restrict.widening).toBeDefined();
    expect(p.replay.paused).toHaveLength(25);
  });

  it("says why no higher value helps when even ten times the threshold leaves too much of what it flags landing", () => {
    // Loops of $30 are over even ten times the $2.00 threshold, and twelve of the thirty landed, so no higher threshold clears the limit.
    const sessions = Array.from({ length: 30 }, (_, i) => session(`f${i}`, i, 30, i < 12));
    const r = row(calibrateRules(STOP, sessions), "stop-loops");
    expect(r.status).toBe("misfires");
    expect(r.proposal).toEqual({ none: expect.stringMatching(/raising it up to 10 times \(6 values tried\) did not bring the flags that remain under 20% landed/) });
  });

  it("offers a higher cap for a cap that stops work that landed, and says a rule with no number has none to raise", () => {
    const capped = parsePolicyYaml(`
version: 1
rules:
  - { id: day-cap, kind: permit, when: {}, cap: { window: day, max_usd: "10.00", warn_at: 0.5, ask_at: 0.8 } }
`);
    // Thirty days, one session a day costing $9: past 80% of a $10 cap the Desk asks, so every one is flagged; ten of them landed.
    const sessions = Array.from({ length: 30 }, (_, i) => session(`g${i}`, i, 0, i < 10, 9));
    const r = row(calibrateRules(capped, sessions), "day-cap");
    expect(r).toMatchObject({ flags: 30, status: "misfires", threshold: "$10.00", what: "cap on the day" });
    expect(r.proposal && "none" in r.proposal).toBe(false);
    if (r.proposal && !("none" in r.proposal)) expect(r.proposal).toMatchObject({ multiplier: 1.25, threshold: "$12.50", flags: 0 });
    const noNumber = parsePolicyYaml(`
version: 1
rules:
  - { id: only-opus, kind: permit, when: { model: { in: ["claude-opus-5"] } } }
  - { id: no-loops, kind: forbid, when: { waste_rule: { in: ["C-LOOP-1"] } }, action: pause_with_checkpoint }
`);
    const sessions2 = Array.from({ length: 30 }, (_, i) => session(`h${i}`, i, 3, i < 15));
    expect(row(calibrateRules(noNumber, sessions2), "no-loops")).toMatchObject({ status: "misfires", proposal: { none: expect.stringMatching(/has no number to raise/) } });
  });

  it("names a default deny as a row of its own, so the table accounts for every stop", () => {
    const onlySonnet = parsePolicyYaml(`
version: 1
rules:
  - { id: only-sonnet, kind: permit, when: { model: { in: ["claude-sonnet-5-5"] } } }
`);
    const sessions = Array.from({ length: 25 }, (_, i) => session(`i${i}`, i, 0, i < 2));
    const r = row(calibrateRules(onlySonnet, sessions), "(no rule permits it)");
    expect(r).toMatchObject({ flags: 25, landed: 2, status: "ok", threshold: null });
  });
});

describe("the table in words", () => {
  const rows = (): RuleCalibration[] => calibrateRules(STOP, MISFIRING());
  it("says a rule misfires on your data and offers the higher threshold with the cost and the check, and says nothing is changed", () => {
    const text = renderCalibration(rows(), "October");
    expect(text).toMatch(/^Rule calibration over October: each rule's stops and asks/);
    expect(text).toMatch(/stop-loops {2}\(stops when recoverable waste is over \$2\.00\): 45 sessions stopped or asked about, 45 with a known landing, 11 landed \(24%\), \$180\.00 after the stop points\. This rule misfires on your data/);
    expect(text).toMatch(/Offer: raise it to \$3\.00 \(1\.5 times\)\. Replayed over the same sessions it flags 25, 1 of 25 labelled landed \(4%\), and stops \$80\.00 less\./);
    expect(text).toMatch(/It is a loosening, so it is a file and a question, not an approval: the restrict-only check names a request it allows that the current policy did not: a call on /);
    expect(text).toMatch(/Nothing here changes the policy\.$/);
    expect(text).toMatch(/allow-all {2}\(has no number to move\): never stopped or asked about a session in this period\./);
  });

  it("says not enough data, and that unknown is not the same as not landed", () => {
    const text = renderCalibration(calibrateRules(STOP, MISFIRING(), new Set(["a0"])), "October");
    expect(text).toMatch(/Not enough data: fewer than 20 flags with a known landing\./);
    expect(text).toMatch(/unknown is not the same as not landed/);
  });
});
