import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildMoments, chanceAtLeast, finalQuantile, forecast, leaveOneWindowOut, type Moment } from "../../src/desk/limits/analog.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { projectRunway, renderRunway, runwayFromLedger } from "../../src/desk/limits/runway.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const HOUR = 3_600_000;
const sec = (ms: number): number => Math.floor(ms / 1000);

/** 80 past windows. At the halfway mark window i stood at i+1 percent and ended at twice that, up to 100. */
const history = (n = 80): Moment[] => Array.from({ length: n }, (_, i) => ({ window: 1000 + i, elapsed: 0.5, pct: i + 1, burnPerHour: null, final: Math.min(100, 2 * (i + 1)) }));

const reading = (over: Partial<{ ts: string; pct: number; resetsAt: number }> = {}) => ({
  ts: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
  pct: 47.5,
  // Halfway through a 300-minute window: 150 minutes left.
  resetsAt: sec(NOW.getTime() + 2.5 * HOUR),
  windowMinutes: 300,
  ...over,
});

describe("forecasting a window from past windows that looked like it", () => {
  it("looks at the closest windows, one moment per window, and says what share ended high", () => {
    const f = forecast(history(), { elapsed: 0.5, pct: 47.5 }, { neighbours: 10, minWindows: 20 });
    expect(f.abstained).toBe(false);
    expect(f.windows).toBe(10);
    // The ten windows closest to 47.5% are those at 43 to 52 percent, which ended at 86 to 100.
    expect(f.finals[0]).toBe(86);
    expect(f.finals[9]).toBe(100);
    expect(chanceAtLeast(f, 95)).toBeCloseTo(0.5, 10);
    expect(finalQuantile(f, 0.5)).toBeCloseTo(95, 6);
  });

  it("counts a window once, however many readings it has near the question", () => {
    const crowded = [...history(), ...history().flatMap((m) => [{ ...m, elapsed: 0.49 }, { ...m, elapsed: 0.51 }])];
    const f = forecast(crowded, { elapsed: 0.5, pct: 47.5 }, { neighbours: 10 });
    expect(f.windows).toBe(10);
    expect(f.finals).toEqual(forecast(history(), { elapsed: 0.5, pct: 47.5 }, { neighbours: 10 }).finals);
  });

  it("leaves a window out when asked", () => {
    const f = forecast(history(), { elapsed: 0.5, pct: 47.5 }, { neighbours: 10, excludeWindow: 1046 });
    expect(f.finals).not.toContain(94);
  });

  it("says nothing when there are too few past windows", () => {
    const f = forecast(history(12), { elapsed: 0.5, pct: 6 }, { minWindows: 20 });
    expect(f).toMatchObject({ abstained: true, windows: 12, finals: [] });
    expect(chanceAtLeast(f, 95)).toBeNull();
    expect(finalQuantile(f, 0.5)).toBeNull();
  });

  it("is checked by leaving each window out in turn, against the base rate", () => {
    const b = leaveOneWindowOut(history(60), { neighbours: 10, every: 1, from: 0.4, to: 0.6 });
    expect(b.windows).toBe(60);
    expect(b.queries).toBeGreaterThan(30);
    // Final percent is a clean function of the percent here, so the forecast must beat the base rate by a lot.
    expect(b.brier).toBeLessThan(b.baseBrier / 2);
    expect(b.reliability.reduce((s, r) => s + r.queries, 0)).toBe(b.queries);
    expect(b.inside80).toBeGreaterThan(0.6);
  });
});

describe("the runway of a plan window", () => {
  it("gives the chance of running out, where windows like this one ended, and says it is a toss-up when it is", () => {
    const r = projectRunway({ latest: reading(), moments: history(), now: NOW });
    expect(r.state).toBe("ok");
    expect(r.usedPct).toBe(47.5);
    expect(r.minutesToReset).toBe(150);
    expect(r.outlook).toMatchObject({ windows: 10, reached: 5, chance: 0.5 });
    expect(r.outlook!.low).toBeCloseTo(87.8, 6);
    expect(r.outlook!.high).toBe(100);
    expect(r.outlook!.median).toBeCloseTo(95, 6);
    expect(r.verdict).toBe("toss_up");
  });

  it("says it is likely to run out when most similar windows did, and likely to last when few did", () => {
    const high = projectRunway({ latest: reading({ pct: 49.5 }), moments: history(), now: NOW });
    expect(high.verdict).toBe("likely_to_run_out");
    const low = projectRunway({ latest: reading({ pct: 10.5 }), moments: history(), now: NOW });
    expect(low.verdict).toBe("likely_to_last");
    expect(low.outlook!.chance).toBe(0);
  });

  it("says a window already at the limit is full, without a forecast", () => {
    const r = projectRunway({ latest: reading({ pct: 97 }), moments: history(), now: NOW });
    expect(r.verdict).toBe("already_full");
    expect(r.outlook).toBeNull();
  });

  it("shows the percent and the reset but no forecast when there are too few past windows", () => {
    const r = projectRunway({ latest: reading(), moments: history(10), now: NOW });
    expect(r.state).toBe("ok");
    expect(r.outlook).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/10 past windows/);
  });

  it("does not forecast from a reading that is too old, and says how old it is", () => {
    const r = projectRunway({ latest: reading({ ts: new Date(NOW.getTime() - 3 * HOUR).toISOString() }), moments: history(), now: NOW });
    expect(r.state).toBe("stale");
    expect(r.outlook).toBeNull();
    expect(r.ageMinutes).toBe(180);
  });

  it("says the window is over once its reset has passed, and has no data without a reading", () => {
    expect(projectRunway({ latest: reading({ resetsAt: sec(NOW.getTime() - HOUR) }), moments: history(), now: NOW }).state).toBe("window_over");
    expect(projectRunway({ latest: null, moments: history(), now: NOW }).state).toBe("no_data");
  });

  it("writes the sentence a person can act on", () => {
    const text = renderRunway(projectRunway({ latest: reading(), moments: history(), now: NOW }), "Codex plus plan, 5-hour window");
    expect(text).toMatch(/Codex plus plan, 5-hour window: 48% used/);
    expect(text).toMatch(/resets in 2 h 30 min/);
    expect(text).toMatch(/5 of 10 similar past windows ended at 95% or more/);
    expect(text).toMatch(/between 88% and 100%/);
    expect(text).toMatch(/toss-up/);
    expect(renderRunway(projectRunway({ latest: null, moments: history(), now: NOW }), "x")).toMatch(/no reading/i);
    expect(renderRunway(projectRunway({ latest: reading({ pct: 97 }), moments: history(), now: NOW }), "x")).toMatch(/already at the limit/i);
  });
});

describe("the runway from a ledger", () => {
  let db: Ledger;
  beforeEach(() => {
    db = openLedger(":memory:");
    db.prepare("INSERT INTO session (session_id, tool) VALUES ('codex:s1', 'codex')").run();
  });
  afterEach(() => db.close());

  const sample = (ts: string, pct: number, resetsAt: number, plan: string | null = "plus", minutes = 300): void => {
    db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', 'codex:s1', ?, 'primary', ?, ?, ?, ?, NULL)").run(ts, minutes, pct, resetsAt, plan);
  };
  const call = (id: string, ts: string, tokens: number, model = "gpt-5.5"): void => {
    db.prepare(
      `INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error, tool_names, block_lines, usage_conflicts)
       VALUES (?, 'codex:s1', ?, ?, 0, ?, 0, 0, 0, 0, 0, 'assumed-5m', 0, 0, '[]', 1, 0)`,
    ).run(id, ts, model, tokens);
  };

  it("reads the newest reading of the plan and window it is asked about, and not another plan's", () => {
    const resets = sec(NOW.getTime() + 3 * HOUR);
    sample(new Date(NOW.getTime() - 31 * 60_000).toISOString(), 30, resets);
    sample(new Date(NOW.getTime() - 60_000).toISOString(), 40, resets);
    sample(new Date(NOW.getTime() - 30_000).toISOString(), 99, resets + 100, "free", 43_200);
    const r = runwayFromLedger(db, { tool: "codex", windowMinutes: 300, planType: "plus", now: NOW });
    expect(r.usedPct).toBe(40);
    expect(r.state).toBe("ok");
    expect(r.rise).toEqual({ points: 10, minutes: 30 });
  });

  it("has no data for a tool with no readings", () => {
    expect(runwayFromLedger(db, { tool: "codex", windowMinutes: 300, planType: "plus", now: NOW }).state).toBe("no_data");
  });

  it("builds a moment for each reading of a window with at least two, with how far through it was and where it ended", () => {
    const resets = sec(Date.parse("2026-10-20T15:00:00.000Z"));
    sample("2026-10-20T10:30:00.000Z", 10, resets);
    sample("2026-10-20T12:30:00.000Z", 50, resets);
    sample("2026-10-20T14:30:00.000Z", 80, resets);
    sample("2026-10-20T11:00:00.000Z", 5, resets + 99);
    call("a", "2026-10-20T12:00:00.000Z", 600_000);
    call("b", "2026-10-20T12:20:00.000Z", 400_000);
    call("c", "2026-10-20T12:20:00.000Z", 9_000_000, "kimi-k3");
    const ms = buildMoments(db, { tool: "codex", windowMinutes: 300, planType: "plus" });
    expect(ms).toHaveLength(3);
    const mid = ms.find((m) => m.pct === 50) as Moment;
    expect(mid.elapsed).toBeCloseTo(0.5, 6);
    expect(mid.final).toBe(80);
    expect(mid.burnPerHour).toBe(1_000_000);
  });
});

describe("what counts as a past window", () => {
  let db: Ledger;
  beforeEach(() => {
    db = openLedger(":memory:");
    db.prepare("INSERT INTO session (session_id, tool) VALUES ('codex:s1', 'codex')").run();
  });
  afterEach(() => db.close());
  const sample = (ts: string, pct: number, resetsAt: number): void => {
    db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', 'codex:s1', ?, 'primary', 300, ?, ?, 'plus', NULL)").run(ts, pct, resetsAt);
  };

  it("leaves out the window that is still running, and readings made after the time asked about", () => {
    const done = sec(Date.parse("2026-10-20T15:00:00.000Z"));
    const running = sec(NOW.getTime() + 2 * HOUR);
    sample("2026-10-20T11:00:00.000Z", 10, done);
    sample("2026-10-20T14:00:00.000Z", 60, done);
    sample(new Date(NOW.getTime() - 3 * HOUR).toISOString(), 20, running);
    sample(new Date(NOW.getTime() - 60_000).toISOString(), 30, running);
    sample(new Date(NOW.getTime() + 30 * 60_000).toISOString(), 90, running);
    const moments = buildMoments(db, { tool: "codex", windowMinutes: 300, planType: "plus", completedBefore: NOW.getTime() });
    expect(new Set(moments.map((m) => m.window))).toEqual(new Set([done]));
    const r = runwayFromLedger(db, { tool: "codex", windowMinutes: 300, planType: "plus", now: NOW });
    expect(r.usedPct).toBe(30);
  });
});
