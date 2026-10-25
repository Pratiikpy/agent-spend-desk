import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { session, sources, type UiContext } from "../../src/desk/ui/queries.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const snap = testSnapshot();
let db: Ledger;
let dir: TempDir;
beforeEach(() => {
  db = openLedger(":memory:");
  dir = new TempDir();
});
afterEach(() => {
  db.close();
  dir.dispose();
});

const call = (id: string, ts: string, session = "s1"): string => assistantLine({ id, session, ts, output: 100 });
const NOW = new Date("2026-10-25T12:00:00Z");
const ctx = (): UiContext => ({ db, snapshot: snap, policiesDir: "policies", mode: "own_logs", ledgerName: "ledger", env: {}, nowMs: () => NOW.getTime(), egressLogPath: null });

describe("a clock that ran backwards or forwards in a log (drill-clock-skew)", () => {
  it("counts a line stamped more than a minute before the line above it, and one stamped in the future, and no ordinary interleaving", async () => {
    const log = dir.file("a.jsonl", [
      call("m1", "2026-10-20T10:00:00Z"),
      call("m2", "2026-10-20T10:00:30Z"),
      call("m3", "2026-10-20T10:00:10Z"), // 20 seconds behind m2: parallel work, not skew
      call("m4", "2026-10-20T09:30:00Z"), // half an hour behind: skew
      call("m5", "2026-10-20T10:05:00Z"),
      call("m6", "2027-03-01T00:00:00Z"), // months ahead of the clock that read it: future
    ]);
    const r = await ingestClaudeCode(db, [log], snap, () => NOW);
    expect(r.skewedLines).toBe(1);
    expect(r.futureLines).toBe(1);
    expect(db.prepare("SELECT skewed_lines s, future_lines f FROM ingest_source").get()).toMatchObject({ s: 1, f: 1 });
    expect(db.prepare("SELECT skewed_lines s, future_lines f FROM ingest_run").get()).toMatchObject({ s: 1, f: 1 });
  });

  it("counts nothing for a log whose stamps only ever move forward, so the flag means something", async () => {
    const log = dir.file("a.jsonl", [call("m1", "2026-10-20T10:00:00Z"), call("m2", "2026-10-20T10:00:01Z"), call("m3", "2026-10-20T11:00:00Z")]);
    const r = await ingestClaudeCode(db, [log], snap, () => NOW);
    expect([r.skewedLines, r.futureLines]).toEqual([0, 0]);
  });

  it("keeps the calls in the order the log wrote them for a session that carries skew, and says so", async () => {
    const log = dir.file("a.jsonl", [call("m1", "2026-10-20T10:00:00Z"), call("m2", "2026-10-20T10:10:00Z"), call("m3", "2026-10-20T09:00:00Z"), call("m4", "2026-10-20T10:20:00Z")]);
    await ingestClaudeCode(db, [log], snap, () => NOW);
    const s = session(ctx(), "s1") as { calls: { ts: string }[]; clock: { skewedLines: number; futureLines: number } | null };
    // The file's order, not sorted by stamp (which would put the 09:00 call first).
    expect(s.calls.map((c) => c.ts.slice(11, 16))).toEqual(["10:00", "10:10", "09:00", "10:20"]);
    expect(s.clock).toEqual({ skewedLines: 1, futureLines: 0 });
  });

  it("orders a session with no skew by its stamps, as before, and carries no note", async () => {
    const log = dir.file("a.jsonl", [call("m2", "2026-10-20T10:10:00Z"), call("m1", "2026-10-20T10:09:50Z")]);
    await ingestClaudeCode(db, [log], snap, () => NOW);
    const s = session(ctx(), "s1") as { calls: { ts: string }[]; clock: unknown };
    expect(s.calls.map((c) => c.ts.slice(11, 19))).toEqual(["10:09:50", "10:10:00"]);
    expect(s.clock).toBeNull();
  });

  it("adds up on the Sources screen across runs", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [call("m1", "2026-10-20T10:00:00Z"), call("m2", "2026-10-20T08:00:00Z")])], snap, () => NOW);
    await ingestClaudeCode(db, [dir.file("b.jsonl", [call("n1", "2026-10-21T10:00:00Z", "s2"), call("n2", "2026-10-21T08:00:00Z", "s2"), call("n3", "2026-10-21T07:00:00Z", "s2")])], snap, () => NOW);
    const t = (sources(ctx()) as { skipped: { skewedLines: number; futureLines: number } }).skipped;
    expect(t).toMatchObject({ skewedLines: 3, futureLines: 0 });
  });
});
