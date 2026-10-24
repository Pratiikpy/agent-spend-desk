import { describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { buildReview, isoWeekOf, renderReview, weekLabel, weekRange } from "../../src/desk/review/review.ts";
import { assignTasks } from "../../src/desk/tasks/assign.ts";
import { testSnapshot } from "./helpers.ts";

const DAY = 86_400_000;

describe("ISO weeks", () => {
  it("numbers weeks the ISO way, including the year boundaries", () => {
    expect(isoWeekOf(Date.UTC(2026, 0, 1))).toEqual({ year: 2026, week: 1 }); // a Thursday: week 1 of 2026
    expect(isoWeekOf(Date.UTC(2025, 11, 29))).toEqual({ year: 2026, week: 1 }); // the Monday before it belongs to it
    expect(isoWeekOf(Date.UTC(2021, 0, 3))).toEqual({ year: 2020, week: 53 }); // a Sunday that still belongs to the old year
    expect(isoWeekOf(Date.UTC(2024, 11, 30))).toEqual({ year: 2025, week: 1 });
    expect(weekLabel(Date.UTC(2026, 9, 19))).toBe("2026-W43");
  });

  it("gives a named week as Monday to the next Monday, UTC", () => {
    const w = weekRange("2026-W43", 0);
    expect(w).toEqual({ label: "2026-W43", startMs: Date.UTC(2026, 9, 19), endMs: Date.UTC(2026, 9, 26) });
    expect(weekRange("2020-W53", 0).startMs).toBe(Date.UTC(2020, 11, 28));
  });

  it("refuses a week that does not exist or is not spelled right", () => {
    expect(() => weekRange("2021-W53", 0)).toThrowError(/2021 has no week 53/);
    expect(() => weekRange("2026-W54", 0)).toThrowError(/1 to 53/);
    expect(() => weekRange("2026-43", 0)).toThrowError(/2026-W43/);
    expect(() => weekRange("last", 0)).toThrowError(/ISO week/);
  });

  it("defaults to the last complete week: on a Sunday the week still running is not complete", () => {
    expect(weekRange(undefined, Date.UTC(2026, 9, 25, 12)).label).toBe("2026-W42");
    expect(weekRange(undefined, Date.UTC(2026, 9, 26, 0, 0, 1)).label).toBe("2026-W43");
    expect(weekRange(undefined, Date.UTC(2026, 9, 28)).label).toBe("2026-W43");
  });
});

const W43 = weekRange("2026-W43", 0);
const at = (dayOffset: number, hour = 10): string => new Date(W43.startMs + dayOffset * DAY + hour * 3_600_000).toISOString();

interface Seed {
  session: string;
  branch: string | null;
  model?: string;
  when: string;
  output: number;
  state?: "kept" | "merged" | "committed" | "reverted" | "unlinked";
  conf?: "low" | "medium" | "high";
  version?: string;
}

function ledger(seeds: Seed[]): Ledger {
  const db = openLedger(":memory:");
  const seen = new Set<string>();
  let n = 0;
  for (const s of seeds) {
    if (!seen.has(s.session)) {
      seen.add(s.session);
      db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at, tool_version) VALUES (?, 'claude_code', 'D:/work/shop', ?, ?, ?, ?)").run(s.session, s.branch, s.when, s.when, s.version ?? "1.0");
      if (s.state) db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, ?, 1, 't')").run(s.session, s.state, s.conf ?? "high");
    }
    n += 1;
    db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 'reported', 0, 0)").run(`c${n}`, s.session, s.when, s.model ?? "claude-opus-5", s.output);
  }
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(Array.from({ length: n }, (_, i) => `c${i + 1}`)), { unpricedCalls: 0, unpricedModels: {} });
  assignTasks(db, []);
  return db;
}

// Opus 5 output is $25 per million tokens: 100,000 tokens are $2.50. Sonnet 5.5 is $10 per million.
const WEEK: Seed[] = [
  { session: "a", branch: "fix/cart", when: at(0), output: 100_000, state: "kept" }, // $2.50 landed
  { session: "b", branch: "fix/cart", when: at(1), output: 200_000, state: "merged" }, // $5.00 landed
  { session: "c", branch: "feat/new", when: at(2), output: 100_000, state: "committed" }, // $2.50
  { session: "d", branch: "feat/new", when: at(3), output: 40_000, state: "reverted" }, // $1.00
  { session: "e", branch: "main", when: at(4), output: 100_000 }, // $2.50 unlinked
  { session: "f", branch: "main", when: at(5), output: 100_000, model: "claude-sonnet-5-5" }, // $1.00 unlinked
  { session: "g", branch: "main", when: at(6), output: 20_000, state: "unlinked", conf: "low" }, // $0.50, a weak link that does not count
];

describe("the weekly review", () => {
  it("adds up the week and says what it bought, with the unlinked and weakly linked dollars apart", () => {
    const db = ledger(WEEK);
    const r = buildReview({ db, snapshot: testSnapshot(), range: W43 });
    expect(r.spend).toMatchObject({ micros: 15_000_000, calls: 7, unpricedCalls: 0, previousMicros: null });
    expect(r.daysWithData).toBe(7);
    expect(r.enoughData).toBe(true);
    expect(r.landing).toEqual({ landedMicros: 7_500_000, committedMicros: 2_500_000, revertedMicros: 1_000_000, unlinkedMicros: 4_000_000, lowConfidenceMicros: 500_000 });
    db.close();
  });

  it("splits the week by workflow, the costliest kind first", () => {
    const db = ledger(WEEK);
    const wf = buildReview({ db, snapshot: testSnapshot(), range: W43 }).workflows;
    expect(wf.map((w) => [w.type, w.tasks, w.spendMicros, w.landedMicros, w.unlinkedMicros])).toEqual([
      ["fix", 1, 7_500_000, 7_500_000, 0],
      ["session", 3, 4_000_000, 0, 4_000_000],
      ["feat", 1, 3_500_000, 0, 0],
    ]);
    db.close();
  });

  it("compares with the week before, and shows the last four weeks with the cost of each landed task", () => {
    const earlier: Seed[] = [{ session: "old", branch: "fix/old", when: new Date(W43.startMs - 3 * DAY).toISOString(), output: 40_000, state: "kept" }]; // $1.00 the week before
    const db = ledger([...earlier, ...WEEK]);
    const r = buildReview({ db, snapshot: testSnapshot(), range: W43 });
    expect(r.spend.previousMicros).toBe(1_000_000);
    expect(r.trend.map((t) => t.label)).toEqual(["2026-W40", "2026-W41", "2026-W42", "2026-W43"]);
    expect(r.trend[2]).toMatchObject({ spendMicros: 1_000_000, landedMicros: 1_000_000, landedTasks: 1, costPerLandedTaskMicros: 1_000_000 });
    expect(r.trend[3]).toMatchObject({ landedMicros: 7_500_000, landedTasks: 1, costPerLandedTaskMicros: 7_500_000 });
    expect(r.trend[0]).toMatchObject({ spendMicros: 0, landedTasks: 0, costPerLandedTaskMicros: null });
    db.close();
  });

  it("says plainly when the week is part of a week, or empty", () => {
    const partial = ledger(WEEK.slice(0, 3));
    const r = buildReview({ db: partial, snapshot: testSnapshot(), range: W43 });
    expect(r).toMatchObject({ daysWithData: 3, enoughData: false });
    expect(r.notes.join(" ")).toMatch(/Only 3 of the 7 days in 2026-W43 have any call/);
    expect(renderReview(r)).toMatch(/This is part of a week/);
    const empty = buildReview({ db: openLedger(":memory:"), snapshot: testSnapshot(), range: W43 });
    expect(empty.spend).toMatchObject({ micros: 0, calls: 0 });
    expect(empty.notes).toEqual(["No call in 2026-W43."]);
    expect(empty.suggestions).toEqual([]);
    expect(renderReview(empty)).toMatch(/None: no rule shows a saving/);
    partial.close();
  });

  it("reports what drifted against the week before: a new model, a share that moved, a new tool version, a model with no price", () => {
    const before: Seed[] = [{ session: "p1", branch: "main", when: new Date(W43.startMs - 2 * DAY).toISOString(), output: 100_000, version: "1.0" }, { session: "p2", branch: "main", when: new Date(W43.startMs - 1 * DAY).toISOString(), output: 100_000, version: "1.0", model: "claude-sonnet-5-5" }];
    const db = ledger([...before, { session: "n1", branch: "main", when: at(1), output: 100_000, model: "claude-sonnet-5-5", version: "2.0" }, { session: "n2", branch: "main", when: at(2), output: 10_000, model: "gpt-x" }]);
    const kinds = buildReview({ db, snapshot: testSnapshot(), range: W43 }).drift.map((d) => d.kind).sort();
    expect(kinds).toEqual(["model_share", "model_share", "tool_version", "unpriced_model"]);
    const texts = buildReview({ db, snapshot: testSnapshot(), range: W43 }).drift.map((d) => d.text).join(" | ");
    expect(texts).toMatch(/claude-sonnet-5-5 went from 29% to 100% of the spend/);
    expect(texts).toMatch(/claude-opus-5 went from 71% to 0% of the spend/);
    expect(texts).toMatch(/A tool version first seen this week: 2\.0/);
    expect(texts).toMatch(/gpt-x has no price in the price book \(1 calls\)/);
    db.close();
  });

  it("flags nothing as new on the first week the ledger has", () => {
    const db = ledger(WEEK);
    expect(buildReview({ db, snapshot: testSnapshot(), range: W43 }).drift).toEqual([]);
    db.close();
  });

  it("offers at most three changes, each tied to a cause with its basis, and none without evidence", () => {
    const db = ledger(WEEK);
    const r = buildReview({ db, snapshot: testSnapshot(), range: W43 });
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
    for (const s of r.suggestions) {
      expect(["own_history", "heuristic_estimate"]).toContain(s.basis);
      expect(s.addressableMicros).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(20);
    }
    db.close();
  });

  it("counts open owner questions and leaves approvals unread unless a gate was named", () => {
    const db = ledger(WEEK);
    const r = buildReview({ db, snapshot: testSnapshot(), range: W43 });
    expect(r.questions).toEqual({ open: 0, costliest: [] });
    expect(r.approvals).toBeNull();
    expect(renderReview(r)).toMatch(/Not read: name the gate with --policy FILE/);
    const withApprovals = buildReview({ db, snapshot: testSnapshot(), range: W43, approvals: { decisions: 4, approved: 3, denied: 1, medianSecondsToDecide: 6, quickShare: 0.5 } });
    expect(renderReview(withApprovals)).toMatch(/4 decisions \(3 approved, 1 denied\); median time to decide 6 s; 50% approved within 10 seconds of being asked, faster than the evidence can be read\./);
    db.close();
  });

  it("runs from the command line: says an empty ledger has nothing to review, and refuses a bad week first", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "desk-review-"));
    try {
      const file = join(dir, "ledger.db");
      openLedger(file).close();
      const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "review", ...a, "--db", file], { encoding: "utf8", env: { ...process.env, DESK_TASKS_FILE: join(dir, "none.jsonl") } });
      expect(run().stdout).toMatch(/Nothing to review: the ledger has no call/);
      const bad = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "review", "--week", "2026-43", "--db", file], { encoding: "utf8" });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toMatch(/2026-W43/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders as text and as markdown, with the same figures", () => {
    const db = ledger(WEEK);
    const r = buildReview({ db, snapshot: testSnapshot(), range: W43 });
    const text = renderReview(r);
    const md = renderReview(r, true);
    expect(text).toMatch(/^Week 2026-W43 {2}\(2026-10-19 to 2026-10-25, UTC\)/);
    expect(text).toMatch(/Spend \$15\.00 over 7 calls on 7 days\./);
    expect(text).toMatch(/Landed \(merged or kept\): \$7\.50\. Committed only: \$2\.50\. Reverted: \$1\.00\. Not tied to any commit: \$4\.00, of which \$0\.50 rests on a weak link that is not counted\. Unlinked is unknown, not waste\./);
    expect(md).toMatch(/^# Week 2026-W43/);
    expect(md).toMatch(/\n## By workflow\n/);
    expect(md).toMatch(/Spend \$15\.00 over 7 calls/);
    db.close();
  });
});
