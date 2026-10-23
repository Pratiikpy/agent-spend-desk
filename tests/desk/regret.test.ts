import { describe, expect, it } from "vitest";

import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { DAY, replayPolicy, type ReplayCall, type ReplaySession } from "../../src/desk/replay/policy-replay.ts";
import { coverage, markDecision, MIN_DAYS_TO_SCORE, openRegret, recordDecision, renderRegret, scoreDecisions, type DecisionInput } from "../../src/desk/regret/regret.ts";

const T0 = Date.UTC(2026, 8, 1);
const usd = (n: number): number => Math.round(n * 1_000_000);

const cap = (maxUsd: string): ReturnType<typeof parsePolicyYaml> =>
  parsePolicyYaml(`version: 1
rules:
  - id: allow-capped
    kind: permit
    when: {}
    cap: { window: day, max_usd: "${maxUsd}", warn_at: 0.5, ask_at: 0.8 }
`);

/** Two sessions a day from `startDay`, three one-dollar calls each; the first of the day is landed work. */
function days(startDay: number, count: number): ReplaySession[] {
  const out: ReplaySession[] = [];
  for (let d = startDay; d < startDay + count; d += 1) {
    for (let k = 0; k < 2; k += 1) {
      const calls: ReplayCall[] = [0, 1, 2].map((m) => ({ offsetMs: m * 60_000, costMicros: usd(1), model: "m", wasteRule: "none", recoverableMicros: 0 }));
      out.push({ id: `s${d}-${k}`, person: "p", project: "repo:a", agent: "main", taskType: "code", startMs: T0 + d * DAY + k * 3_600_000, landed: k === 0, calls });
    }
  }
  return out;
}

const HISTORY = days(0, 40);
const DECIDED = T0 + 40 * DAY;

function decision(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    decisionId: "d1",
    requestId: "req-1",
    decidedAtMs: DECIDED,
    decision: "proposed",
    history: HISTORY,
    options: [
      { option: "chosen", label: "the proposed policy", policy: cap("8.00") },
      { option: "rejected", label: "the policy already in force", policy: cap("150.00") },
      { option: "rejected", label: "a tighter cap", policy: cap("4.00") },
    ],
    ...over,
  };
}

describe("decision regret ledger", () => {
  it("writes down an expected range for each option, and recording again changes nothing", () => {
    const db = openRegret(":memory:");
    expect(recordDecision(db, decision()).recorded).toBe(true);
    expect(recordDecision(db, decision()).recorded).toBe(false);
    const rows = db.prepare("SELECT label, predicted_low_micros AS lo, predicted_high_micros AS hi, status FROM decision_regret ORDER BY label").all() as { label: string; lo: number; hi: number; status: string }[];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "pending" && r.lo !== null && r.hi >= r.lo)).toBe(true);
    // The policy already in force caps at 150 a day, so nothing is saved in any simulated month.
    expect(rows.find((r) => r.label === "the policy already in force")).toMatchObject({ lo: 0, hi: 0 });
    // A tighter cap saves at least as much as a looser one.
    const hi = (l: string): number => rows.find((r) => r.label === l)!.hi;
    expect(hi("a tighter cap")).toBeGreaterThanOrEqual(hi("the proposed policy"));
  });

  it("keeps a decision pending until the later days are in, and then scores it on the month that followed", () => {
    const db = openRegret(":memory:");
    recordDecision(db, decision());
    const early = scoreDecisions(db, [...HISTORY, ...days(40, MIN_DAYS_TO_SCORE - 5)]);
    expect(early[0]!.options.every((o) => o.status === "pending" && o.realised === null)).toBe(true);
    expect(renderRegret(early)).toContain("PENDING");

    const later = days(40, 35);
    const scored = scoreDecisions(db, [...HISTORY, ...later], () => new Date("2026-11-05T00:00:00Z"));
    const month = later.filter((s) => s.startMs < DECIDED + 30 * DAY);
    const chosen = scored[0]!.options.find((o) => o.option === "chosen")!;
    expect(chosen.status).toBe("scored");
    expect(chosen.realised).toBe(Math.round(replayPolicy(cap("8.00"), month).savedMicros));
    expect(chosen.blockedLanded).toBe(replayPolicy(cap("8.00"), month).landedBlocked.length);
    // A session after the thirtieth day is not part of the month.
    expect(scored[0]!.options.find((o) => o.label === "the policy already in force")!.realised).toBe(0);
  });

  it("charges regret only against a rejected option that saved more without blocking more landed work", () => {
    const later = days(40, 35);
    const month = later.filter((s) => s.startMs < DECIDED + 30 * DAY);
    const run = (maxUsd: string): { saved: number; blocked: number } => {
      const r = replayPolicy(cap(maxUsd), month);
      return { saved: Math.round(r.savedMicros), blocked: r.landedBlocked.length };
    };

    // A cap of 4 dollars a day stops only the second, unlanded session. A cap of 2 stops the landed one too.
    expect(run("4.00").blocked).toBe(0);
    expect(run("2.00").blocked).toBeGreaterThan(0);
    expect(run("2.00").saved).toBeGreaterThan(run("4.00").saved);

    // The chosen cap is the 4 dollar one: the 2 dollar cap saved more but blocked landed work, so it is not charged.
    const db = openRegret(":memory:");
    recordDecision(db, decision({ options: [{ option: "chosen", label: "the proposed policy", policy: cap("4.00") }, { option: "rejected", label: "a tighter cap", policy: cap("2.00") }, { option: "rejected", label: "the policy already in force", policy: cap("150.00") }] }));
    const first = scoreDecisions(db, [...HISTORY, ...later])[0]!.options;
    expect(first.find((o) => o.option === "chosen")).toMatchObject({ realised: run("4.00").saved, blockedLanded: 0, regret: 0 });
    expect(first.find((o) => o.label === "a tighter cap")).toMatchObject({ realised: run("2.00").saved, blockedLanded: run("2.00").blocked });

    // Chosen is the policy already in force and the 4 dollar cap was on the table: it saved more and blocked no more, so that is the regret.
    const db2 = openRegret(":memory:");
    recordDecision(db2, decision({ decisionId: "d2", options: [{ option: "chosen", label: "no change", policy: cap("150.00") }, { option: "rejected", label: "the proposed policy", policy: cap("4.00") }, { option: "rejected", label: "a tighter cap", policy: cap("2.00") }] }));
    const second = scoreDecisions(db2, [...HISTORY, ...later])[0]!.options.find((o) => o.option === "chosen")!;
    expect(second.regret).toBe(run("4.00").saved);
    expect(renderRegret(scoreDecisions(db2, [...HISTORY, ...later]))).toContain("regret $");
  });

  it("reports how often the realised month fell inside the expectation, as a count", () => {
    const db = openRegret(":memory:");
    recordDecision(db, decision());
    const lines = scoreDecisions(db, [...HISTORY, ...days(40, 35)]);
    const c = coverage(lines);
    expect(c.scored).toBe(3);
    expect(c.inside).toBeLessThanOrEqual(3);
    expect(renderRegret(lines)).toContain("a count, not an estimate");
  });

  it("marks the owner's answer on the request, and refuses to invent one for an unknown request", () => {
    const db = openRegret(":memory:");
    recordDecision(db, decision());
    expect(markDecision(db, "req-1", "approved")).toBe(true);
    expect(markDecision(db, "no-such-request", "approved")).toBe(false);
    expect(scoreDecisions(db, HISTORY)[0]!.decision).toBe("approved");
  });

  it("says plainly when there is nothing recorded", () => {
    expect(renderRegret([])).toContain("No decisions are recorded yet");
  });

  it("stores no expectation when there is too little history to simulate", () => {
    const db = openRegret(":memory:");
    recordDecision(db, decision({ decisionId: "short", history: HISTORY.slice(0, 10) }));
    const rows = db.prepare("SELECT predicted_low_micros AS lo FROM decision_regret WHERE decision_id = 'short'").all() as { lo: number | null }[];
    expect(rows.every((r) => r.lo === null)).toBe(true);
    expect(renderRegret(scoreDecisions(db, HISTORY))).toContain("no expectation");
  });
});
