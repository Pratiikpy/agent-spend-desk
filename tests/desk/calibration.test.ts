import { describe, expect, it } from "vitest";

import { attributionReliability, renderAttribution, wilson } from "../../src/desk/calibrate/attribution.ts";
import { calibrationOf, summarise, type TunnelTrial } from "../../src/desk/calibrate/windtunnel.ts";
import { smoothedBlockChance } from "../../src/desk/replay/wind-tunnel.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import type { RunRow } from "../../src/desk/canary/runner.ts";
import { TASKS } from "../../src/desk/canary/tasks.ts";
import type { ReplaySession } from "../../src/desk/replay/policy-replay.ts";
import { renderRoute, routeReplay, routesIn } from "../../src/desk/route/replay.ts";
import { renderSeats, seatReturn } from "../../src/desk/seats/seats.ts";
import type { RosterFact } from "../../src/desk/silo/facts.ts";

const DAY = 86_400_000;

describe("seat return", () => {
  const asOfMs = Date.UTC(2026, 9, 30);
  const session = (id: string, person: string, project: string, daysAgo: number, landed: boolean, micros = 1_000_000): ReplaySession => ({
    id,
    person,
    project,
    agent: "claude-code",
    taskType: "feature",
    startMs: asOfMs - daysAgo * DAY,
    landed,
    calls: [{ offsetMs: 0, costMicros: micros, model: "m", wasteRule: "none", recoverableMicros: 0 }],
  });
  const roster: RosterFact[] = [{ team: "payments", seats: 4, seatPlan: "claude-max-5x", seatPriceUsd: 100 }, { team: "growth", seats: 2, seatPlan: "cursor-pro", seatPriceUsd: null }];

  it("counts a seat as active only when its holder landed work in the window, and returns the rest with their price", () => {
    const sessions = [
      session("s1", "ana", "/w/payments-api", 3, true),
      session("s2", "ana", "/w/payments-api", 5, false),
      session("s3", "bo", "/w/payments-api", 9, true),
      session("s4", "cy", "/w/payments-api", 2, false),
      session("s5", "di", "/w/payments-api", 40, true),
    ];
    const lines = seatReturn(sessions, roster, { asOfMs, windowDays: 21 });
    const payments = lines.find((l) => l.team === "payments")!;
    expect(payments).toMatchObject({ seats: 4, activePeople: 2, idleSeats: 2, idleUsdPerMonth: 200 });
    expect(payments.people.map((p) => [p.person, p.landedSessions, p.sessions])).toEqual([["ana", 1, 2], ["bo", 1, 1], ["cy", 0, 1]]);
    expect(payments.people.find((p) => p.person === "di")).toBeUndefined();
  });

  it("states no dollars when the roster has no price, and never names anyone as idle", () => {
    const lines = seatReturn([], roster, { asOfMs, windowDays: 21 });
    expect(lines.find((l) => l.team === "growth")).toMatchObject({ idleSeats: 2, idleUsdPerMonth: null });
    const text = renderSeats(lines, { asOfMs, windowDays: 21 });
    expect(text).toContain("not a verdict on anyone");
    expect(text).not.toMatch(/\bidle (person|developer|engineer)\b/i);
  });

  it("ignores sessions outside any team's repositories and after the end of the window", () => {
    const lines = seatReturn([session("s1", "ana", "/w/unknown-repo", 1, true), session("s2", "bo", "/w/payments-api", -2, true)], roster, { asOfMs, windowDays: 21 });
    expect(lines.every((l) => l.activePeople === 0)).toBe(true);
  });
});

describe("route replay", () => {
  const STRONG = "strong-model";
  const CHEAP = "cheap-model";
  const rows = (model: string, passFor: (taskIndex: number) => number, n = 20): RunRow[] =>
    TASKS.flatMap((t, i) =>
      Array.from({ length: n }, (_, k) => ({ day: k + 1, date: "d", arm: "primary" as const, taskId: t.id, servedModel: model, score: (k < passFor(i) * n ? 1 : 0) as 0 | 1, error: null, latencyMs: 1, tokensIn: 100, tokensOut: model === STRONG ? 50 : 30, replySha: null, harness: "h", cacheBypass: true })),
    );

  it("names the stronger and the cheaper of two served models, and nothing when there is one", () => {
    expect(routesIn([...rows(STRONG, () => 0.9), ...rows(CHEAP, () => 0.5)])).toEqual({ strong: STRONG, cheap: CHEAP });
    expect(routesIn(rows(STRONG, () => 0.9))).toBeNull();
  });

  it("measures the change in pass rate with an interval, and routes a kind of task only when it holds on both halves", () => {
    // The cheap model matches the strong one on every "money" and "logic" task and collapses elsewhere.
    const cheap = rows(CHEAP, (i) => (["money", "logic"].includes(TASKS[i]!.cluster) ? 0.9 : 0.2));
    const r = routeReplay([...rows(STRONG, () => 0.9), ...cheap], { tolerance: 0.1 })!;
    expect(r.delta).toBeLessThan(-0.3);
    expect(r.interval.low).toBeLessThanOrEqual(r.delta);
    expect(r.interval.high).toBeGreaterThanOrEqual(r.delta);
    const routable = r.clusters.filter((c) => c.routable).map((c) => c.cluster).sort();
    expect(routable).toEqual(["logic", "money"]);
    expect(renderRoute(r)).toContain("route to the cheaper model");
  });

  it("recommends nothing when the cheaper route is worse everywhere, and states tokens, not dollars, without a price", () => {
    const r = routeReplay([...rows(STRONG, () => 0.95), ...rows(CHEAP, () => 0.3)], { tolerance: 0.1 })!;
    expect(r.clusters.some((c) => c.routable)).toBe(false);
    const text = renderRoute(r);
    expect(text).toContain("nothing here should be routed");
    expect(text).toContain("NOT VERIFIED");
    expect(r.tokens).toMatchObject({ tokensPerCallStrong: 150, tokensPerCallCheap: 130, usdPerCallStrong: null });
  });

  it("prices a call from tokens and the prices it is given", () => {
    const r = routeReplay([...rows(STRONG, () => 0.9), ...rows(CHEAP, () => 0.9)], { tolerance: 0.1, price: { strong: { inPerM: 1, outPerM: 2 }, cheap: { inPerM: 0.1, outPerM: 0.2 } } })!;
    expect(r.tokens.usdPerCallStrong).toBeCloseTo((100 * 1 + 50 * 2) / 1_000_000, 10);
    expect(r.tokens.usdPerCallCheap).toBeCloseTo((100 * 0.1 + 30 * 0.2) / 1_000_000, 10);
  });
});

describe("calibration", () => {
  it("computes the Wilson interval", () => {
    const w = wilson(5, 10);
    expect(w.low).toBeCloseTo(0.2366, 3);
    expect(w.high).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    expect(wilson(10, 10).high).toBeCloseTo(1, 6);
  });

  it("reads how often each confidence level is right against the planted fate, and whether the levels are ordered", () => {
    const db = openLedger(":memory:");
    const put = (id: string, state: string, conf: string | null): void => {
      db.prepare("INSERT INTO session (session_id, tool) VALUES (?, 'claude-code')").run(id);
      db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, ?, 1, 'now')").run(id, state, conf);
    };
    put("a", "merged", "high");
    put("b", "kept", "high");
    put("c", "reverted", "high");
    put("d", "committed", "medium");
    put("e", "committed", "medium");
    put("f", "unlinked", null);
    put("g", "unlinked", null);
    const truth = [
      { id: "a", fate: "landed" as const },
      { id: "b", fate: "landed" as const },
      { id: "c", fate: "reverted" as const },
      { id: "d", fate: "landed" as const },
      { id: "e", fate: "unlanded" as const },
      { id: "f", fate: "unlanded" as const },
      { id: "g", fate: "landed" as const },
    ];
    const r = attributionReliability(db, truth);
    const by = Object.fromEntries(r.levels.map((l) => [l.level, l]));
    expect(by["high"]).toMatchObject({ n: 3, right: 3 });
    expect(by["medium"]).toMatchObject({ n: 2, right: 1 });
    expect(by["unlinked"]).toMatchObject({ n: 2, right: 1 });
    expect(r.ordered).toBe(true);
    expect(r.stateTotal).toBe(5);
    expect(r.stateRight).toBe(3);
    expect(renderAttribution(r)).toContain("ordered as their names say");
  });

  it("reports a level that is less reliable than a lower one as out of order", () => {
    const db = openLedger(":memory:");
    for (const [id, conf] of [["a", "high"], ["b", "low"]] as const) {
      db.prepare("INSERT INTO session (session_id, tool) VALUES (?, 'claude-code')").run(id);
      db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, 'committed', ?, 1, 'now')").run(id, conf);
    }
    expect(attributionReliability(db, [{ id: "a", fate: "unlanded" }, { id: "b", fate: "landed" }]).ordered).toBe(false);
  });

  it("summarises wind-tunnel trials into a coverage with an interval, and separates the history the tunnel flagged", () => {
    const trial = (seed: number, inside: boolean, flagged = false): TunnelTrial => ({ seed, historySessions: 100, predictedLowMicros: 0, predictedHighMicros: 1, predictedMeanMicros: 0.5, realizedMicros: inside ? 0.5 : 2, inside, driftFlagged: flagged, pBlockedRaw: 0, pBlockedSmoothed: 0.4, blockedLandedRealized: inside ? 0 : 3 });
    const c = summarise("p.yaml", [trial(1, true), trial(2, true), trial(3, false, true), trial(4, true)]);
    expect(c).toMatchObject({ inside: 3, coverage: 0.75, driftFlagged: 1, insideWhenUnflagged: { inside: 3, n: 3 } });
    expect(c.low).toBeLessThan(0.75);
    expect(c.high).toBeGreaterThan(0.75);
  });

  it("computes the expected calibration error and the Brier score of a stated probability", () => {
    // Always says 0.9 and is right 9 times in 10: calibrated. Always says 0 and the event happens half the time: not.
    const good = calibrationOf(Array(10).fill(0.9), [true, true, true, true, true, true, true, true, true, false]);
    expect(good.ece).toBeCloseTo(0, 10);
    expect(good.brier).toBeCloseTo(0.9 * 0.01 + 0.1 * 0.81, 10);
    const bad = calibrationOf(Array(10).fill(0), [true, true, true, true, true, false, false, false, false, false]);
    expect(bad.ece).toBeCloseTo(0.5, 10);
    expect(bad.baseRate).toBe(0.5);
    expect(calibrationOf([], []).ece).toBe(0);
  });

  it("does not take a zero count for a zero probability, and lets a seen rate speak", () => {
    const landed = (id: string): ReplaySession => ({ id, person: "p", project: "r", agent: "a", taskType: "t", startMs: 0, landed: true, calls: [] });
    const history = Array.from({ length: 100 }, (_, i) => landed(`s${i}`));
    const none = smoothedBlockChance(history, 0, 100);
    expect(none).toBeGreaterThan(0.3);
    expect(none).toBeLessThan(0.5);
    expect(smoothedBlockChance(history, 0.05, 100)).toBeGreaterThan(0.99);
    expect(smoothedBlockChance([], 0, 100)).toBeGreaterThan(0.9);
  });

  it("carries the calibration of the stated probability in the coverage summary", () => {
    const trial = (seed: number, raw: number, smooth: number, blocked: number): TunnelTrial => ({ seed, historySessions: 100, predictedLowMicros: 0, predictedHighMicros: 1, predictedMeanMicros: 0.5, realizedMicros: 0.5, inside: true, driftFlagged: false, pBlockedRaw: raw, pBlockedSmoothed: smooth, blockedLandedRealized: blocked });
    const c = summarise("p.yaml", [trial(1, 0, 0.4, 3), trial(2, 0, 0.4, 0), trial(3, 0, 0.4, 2), trial(4, 0, 0.4, 1)]);
    expect(c.probability!.raw.ece).toBeCloseTo(0.75, 10);
    expect(c.probability!.smoothed.ece).toBeCloseTo(0.35, 10);
    expect(c.probability!.smoothed.brier).toBeLessThan(c.probability!.raw.brier);
  });
});
