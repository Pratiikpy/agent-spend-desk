import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseClaudeCodeLine } from "../../src/desk/ingest/claude-code.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { reconcile, renderReconciliation, summariseReconciliation } from "../../src/desk/reconcile/reconcile.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const snap = testSnapshot();
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

interface StateOptions {
  session?: string;
  start: string;
  total: number;
  models?: Record<string, { in?: number; out?: number; think?: number; read?: number; write?: number; usd: number }>;
}

/** A `cost-state` line in the structure real Claude Code logs have (checked 2026-10-24 on logs from this machine). */
function costState(o: StateOptions): string {
  return JSON.stringify({
    type: "cost-state",
    sessionId: o.session ?? "s1",
    totalCostUSD: o.total,
    totalAPIDuration: 1000,
    totalAPIDurationWithoutRetries: 900,
    totalToolDuration: 100,
    totalLinesAdded: 10,
    totalLinesRemoved: 2,
    totalDuration: 5000,
    startTime: Date.parse(o.start),
    modelUsage: Object.fromEntries(
      Object.entries(o.models ?? {}).map(([m, u]) => [m, { inputTokens: u.in ?? 0, outputTokens: u.out ?? 0, thinkingTokens: u.think ?? 0, cacheReadInputTokens: u.read ?? 0, cacheCreationInputTokens: u.write ?? 0, webSearchRequests: 0, costUSD: u.usd }]),
    ),
    hasUnknownModelCost: false,
  });
}

describe("reading the cost Claude Code recorded", () => {
  it("reads a cost-state line into the total, the start of the process it covers and the per-model usage", () => {
    const r = parseClaudeCodeLine(costState({ start: "2026-10-20T09:00:00Z", total: 1.5, models: { "claude-opus-5": { in: 10, out: 20, read: 300, write: 40, usd: 1.5 } } }));
    expect(r.kind).toBe("cost_state");
    if (r.kind !== "cost_state") return;
    expect(r.state).toMatchObject({ sessionId: "s1", processStartMs: Date.parse("2026-10-20T09:00:00Z"), totalMicros: 1_500_000, linesAdded: 10, linesRemoved: 2, unknownModelCost: false });
    expect(r.state.models).toEqual([{ model: "claude-opus-5", inputTokens: 10, outputTokens: 20, thinkingTokens: 0, cacheReadTokens: 300, cacheWriteTokens: 40, costMicros: 1_500_000 }]);
  });

  it("calls a cost-state line without a session, a start time or a sensible total malformed", () => {
    const base = JSON.parse(costState({ start: "2026-10-20T09:00:00Z", total: 1 })) as Record<string, unknown>;
    for (const change of [{ sessionId: undefined }, { startTime: "yesterday" }, { totalCostUSD: -1 }, { totalCostUSD: "1.5" }, { totalCostUSD: null }]) {
      const r = parseClaudeCodeLine(JSON.stringify({ ...base, ...change }));
      expect(r.kind, JSON.stringify(change)).toBe("malformed");
    }
  });

  it("keeps the model rows it can read and skips a model entry that is not an object", () => {
    const o = JSON.parse(costState({ start: "2026-10-20T09:00:00Z", total: 1, models: { a: { usd: 0.4 } } })) as Record<string, unknown>;
    (o["modelUsage"] as Record<string, unknown>)["broken"] = "x";
    const r = parseClaudeCodeLine(JSON.stringify(o));
    expect(r.kind === "cost_state" && r.state.models.map((m) => m.model)).toEqual(["a"]);
  });
});

describe("storing it", () => {
  const ingest = async (lines: string[]) => ingestClaudeCode(db, [dir.file("a.jsonl", lines)], snap);

  it("keeps the latest, largest record of a process, since the counters only grow", async () => {
    await ingest([
      costState({ start: "2026-10-20T09:00:00Z", total: 1, models: { "claude-opus-5": { out: 10, usd: 1 } } }),
      costState({ start: "2026-10-20T09:00:00Z", total: 3, models: { "claude-opus-5": { out: 30, usd: 3 } } }),
      costState({ start: "2026-10-20T09:00:00Z", total: 2, models: { "claude-opus-5": { out: 20, usd: 2 } } }),
    ]);
    const rows = db.prepare("SELECT session_id, process_start_ms, total_micros FROM reported_cost").all() as { total_micros: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total_micros).toBe(3_000_000);
    const m = db.prepare("SELECT model, output_tokens, cost_micros FROM reported_model_usage").all();
    expect(m).toEqual([{ model: "claude-opus-5", output_tokens: 30, cost_micros: 3_000_000 }]);
  });

  it("keeps separate rows for separate processes of one session, and does not read the same line twice", async () => {
    const lines = [costState({ start: "2026-10-20T09:00:00Z", total: 1 }), costState({ start: "2026-10-21T09:00:00Z", total: 2 })];
    const file = dir.file("a.jsonl", lines);
    await ingestClaudeCode(db, [file], snap);
    await ingestClaudeCode(db, [file], snap);
    expect((db.prepare("SELECT COUNT(*) n FROM reported_cost").get() as { n: number }).n).toBe(2);
  });

  it("is removed with the session when the user forgets it", async () => {
    await ingest([assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 10 }), costState({ start: "2026-10-20T09:00:00Z", total: 1, models: { "claude-opus-5": { usd: 1 } } })]);
    forgetLedger(db, { all: true });
    expect((db.prepare("SELECT COUNT(*) n FROM reported_cost").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM reported_model_usage").get() as { n: number }).n).toBe(0);
  });
});

describe("reconciling an estimate with the reported cost", () => {
  /** 1,000,000 output tokens on claude-opus-5 cost $25 at the test prices. */
  const call = (id: string, ts: string, out = 1_000_000, session = "s1") => assistantLine({ id, session, ts, output: out, model: "claude-opus-5" });

  it("matches when the estimate for the process's calls equals what the tool recorded", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [call("m1", "2026-10-20T10:00:00Z"), call("m2", "2026-10-20T11:00:00Z", 2_000_000), costState({ start: "2026-10-20T09:00:00Z", total: 75, models: { "claude-opus-5": { out: 3_000_000, usd: 75 } } })])], snap);
    const rows = reconcile(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "s1", reportedMicros: 75_000_000, estimatedMicros: 75_000_000, verdict: "match", calls: 2, unpricedCalls: 0 });
    expect(rows[0]?.models[0]).toMatchObject({ model: "claude-opus-5", reportedOutputTokens: 3_000_000, estimatedOutputTokens: 3_000_000 });
  });

  it("leaves out calls from before the process the counter covers, as Claude Code's own counter does", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [call("old", "2026-10-01T10:00:00Z", 5_000_000), call("m1", "2026-10-20T10:00:00Z"), costState({ start: "2026-10-20T09:00:00Z", total: 25, models: { "claude-opus-5": { out: 1_000_000, usd: 25 } } })])], snap);
    const r = reconcile(db)[0]!;
    expect(r.estimatedMicros).toBe(25_000_000);
    expect(r.verdict).toBe("match");
    expect(r.callsBeforeProcess).toBe(1);
  });

  it("ends one process's window where the next process of the same session starts", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [
      call("a1", "2026-10-20T10:00:00Z"), costState({ start: "2026-10-20T09:00:00Z", total: 25, models: { "claude-opus-5": { out: 1_000_000, usd: 25 } } }),
      call("b1", "2026-10-21T10:00:00Z", 2_000_000), costState({ start: "2026-10-21T09:00:00Z", total: 50, models: { "claude-opus-5": { out: 2_000_000, usd: 50 } } }),
    ])], snap);
    const rows = reconcile(db);
    expect(rows.map((r) => [r.reportedMicros, r.estimatedMicros, r.verdict])).toEqual([[25_000_000, 25_000_000, "match"], [50_000_000, 50_000_000, "match"]]);
  });

  it("leaves out calls after the last message the tool had seen when it wrote its record", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [call("m1", "2026-10-20T10:00:00Z"), costState({ start: "2026-10-20T09:00:00Z", total: 25, models: { "claude-opus-5": { out: 1_000_000, usd: 25 } } }), call("m2", "2026-10-20T12:00:00Z", 2_000_000)])], snap);
    const r = reconcile(db)[0]!;
    expect(r.estimatedMicros).toBe(25_000_000);
    expect(r.verdict).toBe("match");
    expect(r.callsAfterRecord).toBe(1);
    expect(r.note).toMatch(/later call/);
  });

  it("says the estimate is low or high when the totals differ by more than the tolerance, and names the difference", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [
      call("m1", "2026-10-20T10:00:00Z"), costState({ start: "2026-10-20T09:00:00Z", total: 40, models: { "claude-opus-5": { out: 1_000_000, usd: 40 } } }),
      call("n1", "2026-10-20T10:00:00Z", 2_000_000, "s2"), costState({ session: "s2", start: "2026-10-20T09:00:00Z", total: 25, models: { "claude-opus-5": { out: 2_000_000, usd: 25 } } }),
    ])], snap);
    const rows = reconcile(db);
    const low = rows.find((r) => r.sessionId === "s1")!;
    const high = rows.find((r) => r.sessionId === "s2")!;
    expect(low.verdict).toBe("estimate_low");
    expect(low.diffMicros).toBe(-15_000_000);
    expect(low.models[0]?.tokensAgree).toBe(true);
    expect(high.verdict).toBe("estimate_high");
    expect(high.ratio).toBeCloseTo(2, 5);
  });

  it("reports a process with a recorded cost but no calls in its window", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [costState({ start: "2026-10-20T09:00:00Z", total: 5 })])], snap);
    const r = reconcile(db)[0]!;
    expect(r.verdict).toBe("no_calls");
    expect(r.estimatedMicros).toBe(0);
  });

  it("says when the estimate leaves out calls it could not price", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [call("m1", "2026-10-20T10:00:00Z"), assistantLine({ id: "m2", session: "s1", ts: "2026-10-20T10:30:00Z", output: 1000, model: "claude-unknown-9" }), costState({ start: "2026-10-20T09:00:00Z", total: 26, models: { "claude-opus-5": { out: 1_000_000, usd: 25 }, "claude-unknown-9": { out: 1000, usd: 1 } } })])], snap);
    const r = reconcile(db)[0]!;
    expect(r.unpricedCalls).toBe(1);
    expect(r.verdict).toBe("estimate_low");
    expect(r.note).toMatch(/not priced/);
  });

  it("summarises how many sessions agree within the tolerance and how far off the rest are", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [
      call("m1", "2026-10-20T10:00:00Z"), costState({ start: "2026-10-20T09:00:00Z", total: 25, models: { "claude-opus-5": { out: 1_000_000, usd: 25 } } }),
      call("n1", "2026-10-20T10:00:00Z", 1_000_000, "s2"), costState({ session: "s2", start: "2026-10-20T09:00:00Z", total: 50, models: { "claude-opus-5": { out: 1_000_000, usd: 50 } } }),
    ])], snap);
    const s = summariseReconciliation(reconcile(db));
    expect(s).toMatchObject({ processes: 2, match: 1, estimateLow: 1, estimateHigh: 0, reportedMicros: 75_000_000, estimatedMicros: 50_000_000 });
    expect(s.medianAbsPctError).toBeGreaterThan(0);
    expect(renderReconciliation(reconcile(db), s)).toContain("1 of 2");
  });

  it("splits the summary by whether a process used sub-agents, because the tool's own counter undercounts those", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [
      call("m1", "2026-10-20T10:00:00Z"), costState({ start: "2026-10-20T09:00:00Z", total: 25, models: { "claude-opus-5": { out: 1_000_000, usd: 25 } } }),
      assistantLine({ id: "n1", session: "s2", ts: "2026-10-20T10:00:00Z", output: 1_000_000, model: "claude-opus-5", sidechain: true }), costState({ session: "s2", start: "2026-10-20T09:00:00Z", total: 5, models: { "claude-opus-5": { out: 1_000_000, usd: 5 } } }),
    ])], snap);
    const rows = reconcile(db);
    expect(rows.find((r) => r.sessionId === "s2")?.sidechainCalls).toBe(1);
    const s = summariseReconciliation(rows);
    expect(s.withoutSubAgents).toMatchObject({ processes: 1, match: 1 });
    expect(s.withSubAgents).toMatchObject({ processes: 1, match: 0, reportedMicros: 5_000_000, estimatedMicros: 25_000_000 });
    expect(renderReconciliation(rows, s)).toMatch(/with sub-agents: 1 process/);
  });

  it("returns nothing for a ledger that has no recorded cost, without inventing one", () => {
    expect(reconcile(db)).toEqual([]);
    expect(summariseReconciliation([])).toMatchObject({ processes: 0, match: 0 });
    expect(renderReconciliation([], summariseReconciliation([]))).toMatch(/no cost recorded/i);
  });
});
