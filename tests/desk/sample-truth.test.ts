import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { analyseThread } from "../../src/desk/autopsy/engine.ts";
import { loadAutopsyCalls } from "../../src/desk/autopsy/load.ts";
import { findJsonlLogs } from "../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir, sampleReposDir, type Truth } from "../../src/desk/sample/gen.ts";
import { TempDir } from "./helpers.ts";

/**
 * The scenario is generated with waste planted at known places. These tests compare what the Desk finds
 * with what was planted. They are the reason the loop detector only counts failing commands and the
 * landing step attributes each commit to one session: both were wrong the first time this ran.
 */
describe("the Desk against planted truth", () => {
  let dir: TempDir;
  let db: Ledger;
  let truth: Truth;
  const flagged = { loops: new Map<string, number>(), idle: new Map<string, number>(), subagents: 0, miss: 0 };
  let totalCalls = 0;

  beforeAll(async () => {
    dir = new TempDir();
    const out = join(dir.path, "sample");
    truth = buildSample({ outDir: out, seed: 7, months: 0.3, engineers: 14 });
    db = openLedger(":memory:");
    const snapshot = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");
    await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), snapshot);
    const calls = loadAutopsyCalls(db, snapshot, "0000", "9999");
    totalCalls = calls.length;
    const byThread = new Map<string, typeof calls>();
    for (const c of calls) byThread.set(c.threadKey, [...(byThread.get(c.threadKey) ?? []), c]);
    for (const thread of byThread.values()) {
      const bySession = new Map(thread.map((c) => [c.callId, c.sessionId]));
      for (const [id, a] of analyseThread(thread)) {
        const sid = bySession.get(id)!;
        if (a.wholeCall === "loops") flagged.loops.set(sid, (flagged.loops.get(sid) ?? 0) + 1);
        if (a.wholeCall === "idle") flagged.idle.set(sid, (flagged.idle.get(sid) ?? 0) + 1);
        if (a.wholeCall === "subagents") flagged.subagents += 1;
        if (a.miss) flagged.miss += 1;
      }
    }
    const repos = [...new Set(truth.sessions.map((s) => s.repo))].map((n) => join(sampleReposDir(out), n));
    linkOutcomes(db, repos, Date.parse("2026-12-31T00:00:00Z"));
  }, 180_000);

  afterAll(() => {
    db?.close();
    dir?.dispose();
  });

  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it("reads every planted call exactly once", () => {
    expect(totalCalls).toBe(truth.sessions.reduce((n, s) => n + s.calls, 0));
  });

  it("attributes sub-agent calls exactly", () => {
    expect(flagged.subagents).toBe(truth.sessions.reduce((n, s) => n + s.subagentCalls, 0));
  });

  it("finds planted loops and flags no session that had none", () => {
    const detectable = truth.sessions.reduce((n, s) => n + Math.max(0, s.loopCalls - 2), 0);
    expect(detectable).toBeGreaterThan(100);
    expect(sum(flagged.loops)).toBeGreaterThanOrEqual(0.75 * detectable);
    expect(sum(flagged.loops)).toBeLessThanOrEqual(truth.sessions.reduce((n, s) => n + s.loopCalls, 0));
    expect(truth.sessions.filter((s) => s.loopCalls === 0 && flagged.loops.has(s.id))).toEqual([]);
  });

  it("finds planted idle polling and flags no session that had none", () => {
    const planted = truth.sessions.reduce((n, s) => n + s.idleCalls, 0);
    expect(planted).toBeGreaterThan(20);
    expect(sum(flagged.idle)).toBeGreaterThanOrEqual(0.8 * planted);
    expect(truth.sessions.filter((s) => s.idleCalls === 0 && flagged.idle.has(s.id))).toEqual([]);
  });

  it("finds cache misses within 10% of the planted number", () => {
    const planted = truth.sessions.reduce((n, s) => n + s.missCalls, 0);
    expect(Math.abs(flagged.miss - planted) / planted).toBeLessThan(0.1);
  });

  it("recovers landed work, unlanded work and reverted work from git alone", () => {
    const state = new Map((db.prepare("SELECT session_id, state FROM session_outcome").all() as unknown as { session_id: string; state: string }[]).map((r) => [r.session_id, r.state]));
    const of = (fate: string) => truth.sessions.filter((s) => s.fate === fate);
    const landedFound = of("landed").filter((s) => ["committed", "merged", "kept"].includes(state.get(s.id) ?? "")).length;
    const falseLanded = of("unlanded").filter((s) => ["committed", "merged", "kept", "reverted"].includes(state.get(s.id) ?? "")).length;
    const revertedFound = of("reverted").filter((s) => state.get(s.id) === "reverted").length;
    expect(landedFound / of("landed").length).toBeGreaterThanOrEqual(0.9);
    expect(falseLanded / of("unlanded").length).toBeLessThanOrEqual(0.08);
    expect(revertedFound / of("reverted").length).toBeGreaterThanOrEqual(0.9);
  });

  it("is reproducible from its seed", () => {
    const again = buildSample({ outDir: join(dir.path, "again"), seed: 7, months: 0.3, engineers: 14 });
    expect(again.sessions.map((s) => [s.id, s.calls, s.fate])).toEqual(truth.sessions.map((s) => [s.id, s.calls, s.fate]));
  });
});
