import { describe, expect, it } from "vitest";

import { buildGauge, gaugeLine, renderGauge } from "../../src/desk/gauge/gauge.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { parseStatusline, type StatuslineSample } from "../../src/desk/statusline/statusline.ts";
import { testSnapshot } from "./helpers.ts";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString();

interface Call {
  id: string;
  session?: string;
  minutesAgo: number;
  model?: string;
  output: number;
  unknownModel?: boolean;
}

function ledger(calls: Call[]): Ledger {
  const db = openLedger(":memory:");
  const sessions = [...new Set(calls.map((c) => c.session ?? "s1"))];
  for (const s of sessions) db.prepare("INSERT INTO session (session_id, tool) VALUES (?, 'claude_code')").run(s);
  const add = db.prepare(
    "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 'reported', 0, 0)",
  );
  for (const c of calls) add.run(c.id, c.session ?? "s1", at(c.minutesAgo), c.unknownModel ? "gpt-x" : (c.model ?? "claude-opus-5"), c.output);
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(calls.map((c) => c.id)), { unpricedCalls: 0, unpricedModels: {} });
  return db;
}

const sample = (minutesAgo: number, five: number | null, week: number | null): StatuslineSample => ({
  ts: at(minutesAgo), sessionId: "s1", model: "claude-opus-5", version: "2.1", costUsd: null, contextPct: null,
  fiveHour: five === null ? null : { pct: five, resetsAt: Math.floor((NOW + 90 * 60_000) / 1000) },
  sevenDay: week === null ? null : { pct: week, resetsAt: Math.floor((NOW + 3 * 24 * 3_600_000) / 1000) },
});

describe("the gauge", () => {
  // Opus 5 output is $25 per million tokens: 100,000 output tokens cost $2.50.
  const calls: Call[] = [
    { id: "c1", minutesAgo: 200, output: 100_000 }, // $2.50, in the window, not in the last 30 minutes
    { id: "c2", minutesAgo: 20, output: 40_000 }, // $1.00
    { id: "c3", minutesAgo: 5, output: 20_000 }, // $0.50
    { id: "old", minutesAgo: 400, output: 1_000_000 }, // $25.00, outside a 5-hour window
  ];

  it("equals the ledger for the same span: the spend is the sum of the cost events in it", () => {
    const db = ledger(calls);
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    const sql = db.prepare("SELECT SUM(c.total_micros) t FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ?").get(at(300), at(0)) as { t: number };
    expect(g.spendMicros).toBe(sql.t);
    expect(g.spendMicros).toBe(4_000_000);
    expect(g.calls).toBe(3);
    db.close();
  });

  it("splits the spend by cause so that the parts add up to the spend", () => {
    const db = ledger(calls);
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g.split.reduce((s, x) => s + x.micros, 0)).toBe(g.spendMicros);
    expect(g.split.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(g.split[0]!.micros).toBeGreaterThanOrEqual(g.split[g.split.length - 1]!.micros);
    db.close();
  });

  it("gives the burn as the spend of the last 30 minutes per hour, and the minutes since the last call", () => {
    const db = ledger(calls);
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g.burnMicrosPerHour).toBe(3_000_000); // $1.50 in 30 minutes
    expect(g.idleMinutes).toBe(5);
    db.close();
  });

  it("says a rate is unknown, not zero, when nothing happened in the last 30 minutes", () => {
    const db = ledger([{ id: "c1", minutesAgo: 90, output: 100_000 }]);
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g.burnMicrosPerHour).toBeNull();
    expect(g.notes.join(" ")).toMatch(/no call in the last 30 minutes, so no rate/);
    expect(gaugeLine(g)).toMatch(/— \/h/);
    db.close();
  });

  it("says $0.00 with a note, not unknown, for a span with no call, and handles an empty ledger", () => {
    const db = openLedger(":memory:");
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g).toMatchObject({ spendMicros: 0, calls: 0, burnMicrosPerHour: null, idleMinutes: null, split: [], limits: [] });
    expect(g.notes.join(" ")).toMatch(/No call in the last 5 hours; the spend is \$0\.00, not unknown/);
    expect(renderGauge(g)).toMatch(/Spend\s+\$0\.00/);
    db.close();
  });

  it("limits itself to one session when asked", () => {
    const db = ledger([{ id: "a", session: "s1", minutesAgo: 10, output: 100_000 }, { id: "b", session: "s2", minutesAgo: 10, output: 40_000 }]);
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW, sessionId: "s2" })).toMatchObject({ spendMicros: 1_000_000, calls: 1 });
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW, sessionId: "nope" })).toMatchObject({ spendMicros: 0, calls: 0 });
    db.close();
  });

  it("counts calls with no price and says the spend is a floor", () => {
    const db = ledger([{ id: "a", minutesAgo: 10, output: 100_000 }, { id: "b", minutesAgo: 9, output: 100_000, unknownModel: true }]);
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g.unpricedCalls).toBe(1);
    expect(g.notes.join(" ")).toMatch(/1 call in the span has no price \(tokens counted, no dollars invented\), so the spend is a floor/);
    db.close();
  });

  it("covers a span other than five hours", () => {
    const db = ledger(calls);
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW, hours: 8 }).spendMicros).toBe(29_000_000);
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW, hours: 1 }).spendMicros).toBe(1_500_000);
    db.close();
  });
});

describe("the gauge's plan windows", () => {
  const db = ledger([{ id: "c1", minutesAgo: 10, output: 40_000 }]);

  it("shows the status line's reading when it is recent, with its age and when it resets", () => {
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW, statusSamples: [sample(2, 42, 17)] });
    expect(g.limits.map((l) => [l.label, l.usedPct, l.minutesToReset, l.ageSeconds, l.source])).toEqual([
      ["Claude Code, 5-hour window", 42, 90, 120, "status line"],
      ["Claude Code, weekly window", 17, 4320, 120, "status line"],
    ]);
    expect(renderGauge(g)).toMatch(/Claude Code, 5-hour window: 42% used, resets in 1h30 \(13:30 UTC\), read 2 min ago \[status line\]/);
    expect(gaugeLine(g)).toMatch(/5-hour 42% \(resets 1h30\)/);
  });

  it("drops a reading older than ten minutes and says so, rather than showing a stale percent", () => {
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW, statusSamples: [sample(14, 42, 17)] });
    expect(g.limits).toEqual([]);
    expect(g.notes.join(" ")).toMatch(/status line last reported 14 minutes ago, too old to show a plan percent \(limit 10 minutes\)/);
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW, statusSamples: [sample(14, 42, 17)], staleSeconds: 3600 }).limits).toHaveLength(2);
  });

  it("never shows a window that has already reset", () => {
    const old: StatuslineSample = { ...sample(1, 99, 99), fiveHour: { pct: 99, resetsAt: Math.floor((NOW - 60_000) / 1000) } };
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW, statusSamples: [old] }).limits.map((l) => l.label)).toEqual(["Claude Code, weekly window"]);
  });

  it("says how to turn the status line on when there is no reading at all", () => {
    expect(buildGauge(db, testSnapshot(), { nowMs: NOW }).notes.join(" ")).toMatch(/no status line reading\. `desk statusline install`/);
  });

  it("rejects an epoch timestamp or a value over 100 sent as a percent, so a payload bug cannot show 1,761,300,000%", () => {
    const bad = parseStatusline({ session_id: "s", rate_limits: { five_hour: { used_percentage: 1_761_300_000, resets_at: 1_761_303_600 } } }, new Date(NOW));
    expect(bad?.fiveHour).toBeNull();
    const negative = parseStatusline({ session_id: "s", rate_limits: { five_hour: { used_percentage: -4, resets_at: 1_761_303_600 } } }, new Date(NOW));
    expect(negative?.fiveHour).toBeNull();
  });
});

describe("the gauge and the plan readings in the ledger", () => {
  it("shows a Codex window with its reading, an outlook from the ledger's own past windows, and the pace", () => {
    const db = openLedger(":memory:");
    const put = db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type) VALUES ('codex', 's', ?, 'primary', 300, ?, ?, 'plus')");
    const resets = Math.floor((NOW + 120 * 60_000) / 1000);
    put.run(at(60), 20, resets);
    put.run(at(30), 40, resets);
    put.run(at(2), 50, resets);
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g.limits).toHaveLength(1);
    const l = g.limits[0]!;
    expect(l).toMatchObject({ label: "Codex, plus plan, 5-hour window", usedPct: 50, source: "ledger", minutesToReset: 120 });
    expect(l.outlook).toMatch(/No forecast: only 0 past windows/);
    // 30 points in the last hour: 50 points to go takes about 100 minutes, which is before the reset 120 minutes away.
    expect(l.paceFinish).not.toBeNull();
    expect(renderGauge(g)).toMatch(/it reaches 100% at about 13:\d\d UTC, before the reset\. A pace, not a forecast\./);
    db.close();
  });

  it("drops a ledger reading older than ten minutes and says so", () => {
    const db = openLedger(":memory:");
    db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type) VALUES ('codex', 's', ?, 'primary', 300, 50, ?, 'plus')").run(at(25), Math.floor((NOW + 120 * 60_000) / 1000));
    const g = buildGauge(db, testSnapshot(), { nowMs: NOW });
    expect(g.limits).toEqual([]);
    expect(g.notes.join(" ")).toMatch(/Codex plus plan, 5-hour window: last reading 25 minutes ago, too old to show/);
    db.close();
  });
});
