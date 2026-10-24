import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fitLimit, groupLabel, leaveOneOut, limitGroups, observeWindows, renderLimitFit, type WindowObservation } from "../../src/desk/limits/fit.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestCodex } from "../../src/desk/ledger/ingest-codex.ts";
import { codexLines } from "./codex-fixtures.ts";
import { TempDir, testSnapshot } from "./helpers.ts";

const { meta, turn, count } = codexLines;

let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  db.close();
  dir.dispose();
});

const pad = (n: number) => String(n).padStart(2, "0");

/** One 5-hour window of calls of `callTokens` tokens each, with the plan's percent rising by one for every `perPercent` tokens. */
function windowLog(id: string, n: number, opts: { perPercent: number; callTokens?: number; model?: string; resetsAt: number; start?: number; startPct?: number }): string[] {
  const callTokens = opts.callTokens ?? 50_000;
  const day = pad(1 + (n % 27));
  const lines = [meta({ id, ts: `2026-09-${day}T08:00:00.000Z` }), turn(`2026-09-${day}T08:00:01.000Z`, opts.model ?? "gpt-5.5")];
  let total = 0;
  const calls = opts.start ?? 60;
  for (let k = 1; k <= calls; k += 1) {
    total += callTokens;
    const pct = (opts.startPct ?? 0) + Math.floor((k * callTokens) / opts.perPercent);
    const t = new Date(Date.UTC(2026, 8, 1 + (n % 27), 8, 0, 2 + k)).toISOString();
    lines.push(count(t, { input: total, cached: 0, output: 0, reasoning: 0 }, undefined, { primary: { used: pct, minutes: 300, resetsAt: opts.resetsAt }, secondary: { used: 10 + Math.floor(pct / 5), minutes: 10_080, resetsAt: opts.resetsAt + 500_000 }, plan: "plus" }));
  }
  return lines;
}

async function ingestWindows(count_: number, perPercent: (i: number) => number, model = "gpt-5.5"): Promise<void> {
  for (let i = 0; i < count_; i += 1) await ingestCodex(db, [dir.file(`w${i}.jsonl`, windowLog(`s${i}`, i, { perPercent: perPercent(i), resetsAt: 1_790_000_000 + i * 20_000, model }))], testSnapshot());
}

describe("observing the plan's windows", () => {
  it("measures, per window, how many percent the plan reported and how many tokens were used in between", async () => {
    await ingestWindows(1, () => 200_000);
    const w = observeWindows(db, { tool: "codex", kind: "primary" });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "primary", firstPct: 0, lastPct: 15, dPct: 15, windowMinutes: 300 });
    // 60 calls of 50,000 tokens; the first reading comes with the first call, so 59 calls fall after it
    expect(w[0]?.tokens).toBe(59 * 50_000);
    expect(w[0]?.calls).toBe(59);
  });

  it("leaves out calls to models the plan does not cover, and a window with a single reading", async () => {
    await ingestWindows(1, () => 200_000, "kimi-k3");
    expect(observeWindows(db, { tool: "codex", kind: "primary" })[0]?.tokens).toBe(0);
    const lone = openLedger(":memory:");
    try {
      await ingestCodex(lone, [dir.file("lone.jsonl", windowLog("lone", 1, { perPercent: 200_000, resetsAt: 1_791_000_000, start: 1 }))], testSnapshot());
      expect(observeWindows(lone, { tool: "codex", kind: "primary" })).toEqual([]);
    } finally {
      lone.close();
    }
  });

  it("keeps the 5-hour window and the weekly window apart", async () => {
    await ingestWindows(1, () => 200_000);
    expect(observeWindows(db, { tool: "codex", kind: "secondary" })[0]).toMatchObject({ kind: "secondary", windowMinutes: 10_080 });
  });
});

describe("fitting tokens per percent of the limit", () => {
  it("recovers the rate when every window follows it, with an interval around it", async () => {
    await ingestWindows(12, () => 200_000);
    const fit = fitLimit(observeWindows(db, { tool: "codex", kind: "primary" }), { seed: 7 });
    expect(fit.abstained).toBe(false);
    expect(fit.qualifying).toBe(12);
    expect(fit.tokensPerPercent).toBeGreaterThan(190_000);
    expect(fit.tokensPerPercent).toBeLessThan(210_000);
    expect(fit.low!).toBeLessThanOrEqual(fit.tokensPerPercent!);
    expect(fit.high!).toBeGreaterThanOrEqual(fit.tokensPerPercent!);
    expect(fit.capacityTokens).toBeCloseTo((fit.tokensPerPercent as number) * 100, 5);
    expect(fit.high! - fit.low!).toBeLessThan(40_000);
  });

  it("gives a wider interval when windows disagree, and reports how they spread", async () => {
    await ingestWindows(12, (i) => (i % 2 === 0 ? 100_000 : 250_000));
    const fit = fitLimit(observeWindows(db, { tool: "codex", kind: "primary" }), { seed: 7 });
    expect(fit.abstained).toBe(false);
    expect(fit.high! - fit.low!).toBeGreaterThan(40_000);
    expect(fit.spread!.p10).toBeLessThan(fit.spread!.median);
    expect(fit.spread!.p90).toBeGreaterThan(fit.spread!.median);
  });

  it("abstains, and says why, when there are too few windows or too little percent to learn from", async () => {
    await ingestWindows(3, () => 200_000);
    const few = fitLimit(observeWindows(db, { tool: "codex", kind: "primary" }), { seed: 7 });
    expect(few.abstained).toBe(true);
    expect(few.reason).toMatch(/3 window/);
    expect(few.tokensPerPercent).toBeNull();
    expect(fitLimit([], { seed: 7 })).toMatchObject({ abstained: true, windows: 0 });
    const tiny = openLedger(":memory:");
    try {
      for (let i = 0; i < 10; i += 1) await ingestCodex(tiny, [dir.file(`t${i}.jsonl`, windowLog(`t${i}`, i, { perPercent: 200_000, resetsAt: 1_792_000_000 + i * 20_000, start: 8 }))], testSnapshot());
      const f = fitLimit(observeWindows(tiny, { tool: "codex", kind: "primary" }), { seed: 7 });
      expect(f.abstained).toBe(true);
      expect(f.qualifying).toBe(0);
    } finally {
      tiny.close();
    }
  });

  it("gives the same interval for the same seed", async () => {
    await ingestWindows(12, (i) => 150_000 + i * 10_000);
    const obs = observeWindows(db, { tool: "codex", kind: "primary" });
    expect(fitLimit(obs, { seed: 3 })).toEqual(fitLimit(obs, { seed: 3 }));
    expect(fitLimit(obs, { seed: 3 }).low).not.toBe(fitLimit(obs, { seed: 4 }).low);
  });

  it("shows one window far from the rest in the spread, while the pooled rate is pulled only part of the way", async () => {
    await ingestWindows(11, () => 200_000);
    await ingestCodex(db, [dir.file("odd.jsonl", windowLog("odd", 30, { perPercent: 50_000, resetsAt: 1_795_000_000 }))], testSnapshot());
    const fit = fitLimit(observeWindows(db, { tool: "codex", kind: "primary" }), { seed: 7 });
    expect(fit.windows).toBe(12);
    expect(fit.spread!.median).toBeGreaterThan(190_000);
    expect(fit.spread!.median).toBeLessThan(210_000);
    expect(fit.tokensPerPercent!).toBeLessThan(fit.spread!.median);
    expect(fit.tokensPerPercent!).toBeGreaterThan(120_000);
  });
});

describe("reading the fit", () => {
  it("states the rate, the interval, the window count and what it cannot say", async () => {
    await ingestWindows(12, () => 200_000);
    const text = renderLimitFit(fitLimit(observeWindows(db, { tool: "codex", kind: "primary" }), { seed: 7 }), "5-hour");
    expect(text).toMatch(/5-hour limit/);
    expect(text).toMatch(/tokens per percent/);
    expect(text).toMatch(/12 windows/);
    expect(text).toMatch(/not a forecast/);
  });

  it("says plainly when it abstained", () => {
    expect(renderLimitFit(fitLimit([], { seed: 1 }), "weekly")).toMatch(/no estimate/i);
  });
});

describe("how well the fitted rate predicts a window it has not seen", () => {
  const win = (i: number, dPct: number, tokens: number): WindowObservation => ({ kind: "primary", resetsAt: 1000 + i, windowMinutes: 300, firstTs: "2026-09-01T00:00:00.000Z", lastTs: "2026-09-01T04:00:00.000Z", firstPct: 0, lastPct: dPct, dPct, tokens, calls: 10 });

  it("is exact when every window moves the percent in proportion to its tokens", () => {
    const obs = Array.from({ length: 10 }, (_, i) => win(i, 10 + i * 5, (10 + i * 5) * 200_000));
    const r = leaveOneOut(obs);
    expect(r).toMatchObject({ windows: 10, medianAbsPoints: 0, withinQuarter: 10, withinHalf: 10 });
  });

  it("leaves each window out of its own prediction", () => {
    // Nine windows at 100K per point and one at 400K per point: the odd one must be predicted from the nine, not from itself.
    const obs = [...Array.from({ length: 9 }, (_, i) => win(i, 20, 2_000_000)), win(9, 20, 8_000_000)];
    const r = leaveOneOut(obs);
    expect(r.windows).toBe(10);
    expect(r.withinQuarter).toBe(9);
    expect(r.worstAbsPoints).toBeCloseTo(60, 6); // predicted 80 points for a window that moved 20
  });

  it("uses only the windows the fit itself would use", () => {
    const obs = [win(0, 3, 600_000), win(1, 20, 4_000_000), win(2, 30, 6_000_000), win(3, 40, 8_000_000)];
    expect(leaveOneOut(obs).windows).toBe(3);
  });

  it("has nothing to say with fewer than three usable windows", () => {
    expect(leaveOneOut([win(0, 20, 4_000_000), win(1, 30, 6_000_000)])).toMatchObject({ windows: 2, medianAbsPoints: null, medianRelative: null });
    expect(leaveOneOut([])).toMatchObject({ windows: 0, medianAbsPoints: null });
  });
});

describe("limits of different plans and window lengths", () => {
  let db: Ledger;
  beforeEach(() => {
    db = openLedger(":memory:");
    db.prepare("INSERT INTO session (session_id, tool) VALUES ('codex:s', 'codex')").run();
  });
  afterEach(() => db.close());

  const put = (ts: string, pct: number, resetsAt: number, minutes: number, plan: string | null, kind = "primary"): void => {
    db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', 'codex:s', ?, ?, ?, ?, ?, ?, 'codex')").run(ts, kind, minutes, pct, resetsAt, plan);
  };

  it("lists each plan and window length as its own limit, newest first", () => {
    put("2026-06-01T00:00:00.000Z", 1, 100, 300, "plus");
    put("2026-06-01T01:00:00.000Z", 2, 100, 300, "plus");
    put("2026-06-01T00:00:00.000Z", 1, 200, 10_080, "plus", "secondary");
    put("2026-10-01T00:00:00.000Z", 1, 300, 43_200, "free");
    put("2026-07-01T00:00:00.000Z", 1, 400, 300, null);
    const g = limitGroups(db, "codex");
    expect(g.map((x) => [x.planType, x.windowMinutes, x.samples])).toEqual([["free", 43_200, 1], [null, 300, 1], ["plus", 300, 2], ["plus", 10_080, 1]]);
    expect(groupLabel(g[0] as (typeof g)[number])).toBe("free plan, 30-day window");
    expect(groupLabel(g[1] as (typeof g)[number])).toBe("unknown plan, 5-hour window");
  });

  it("does not pool a free plan's month with a paid plan's five hours, though both are labelled primary", () => {
    for (let n = 0; n < 3; n += 1) {
      put(`2026-06-0${n + 1}T00:00:00.000Z`, 0, 1000 + n, 300, "plus");
      put(`2026-06-0${n + 1}T01:00:00.000Z`, 10, 1000 + n, 300, "plus");
    }
    put("2026-07-01T00:00:00.000Z", 0, 9000, 43_200, "free");
    put("2026-07-01T01:00:00.000Z", 40, 9000, 43_200, "free");
    expect(observeWindows(db, { tool: "codex", kind: "primary" })).toHaveLength(4);
    expect(observeWindows(db, { tool: "codex", windowMinutes: 300, planType: "plus" })).toHaveLength(3);
    expect(observeWindows(db, { tool: "codex", windowMinutes: 43_200, planType: "free" })).toHaveLength(1);
    expect(observeWindows(db, { tool: "codex", windowMinutes: 300, planType: null })).toHaveLength(0);
    expect(() => observeWindows(db, { tool: "codex" })).toThrow(/kind or a window length/);
  });

  it("keeps two windows that reset at the same moment apart when they carry different labels", () => {
    put("2026-06-01T00:00:00.000Z", 0, 500, 300, "plus", "primary");
    put("2026-06-01T01:00:00.000Z", 5, 500, 300, "plus", "primary");
    put("2026-06-01T00:00:00.000Z", 0, 500, 10_080, "plus", "secondary");
    put("2026-06-01T01:00:00.000Z", 1, 500, 10_080, "plus", "secondary");
    const w = observeWindows(db, { tool: "codex", kind: "primary" });
    expect(w).toHaveLength(1);
    expect(w[0]?.dPct).toBe(5);
  });
});
