import { describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { allocateOverhead } from "../../src/desk/overhead/allocate.ts";
import { overheadView, renderOverhead } from "../../src/desk/overhead/view.ts";
import { assistantLine, humanPromptLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

describe("share-weighted allocation of overhead", () => {
  it("shares the overhead in proportion to landed spend and gives every micro-dollar somewhere", () => {
    const a = allocateOverhead(1_000_000, [{ project: "web", micros: 6_000_000 }, { project: "api", micros: 3_000_000 }, { project: "docs", micros: 1_000_000 }]);
    expect(a.rows.map((r) => [r.project, r.allocatedMicros])).toEqual([["web", 600_000], ["api", 300_000], ["docs", 100_000]]);
    expect(a.rows.map((r) => r.weight)).toEqual([0.6, 0.3, 0.1]);
    expect(a.residualMicros).toBe(0);
    expect(a.unallocatedMicros).toBe(0);
  });

  it("gives the micro-dollars the floors leave to the project with the most landed spend, so the total is the overhead exactly", () => {
    const a = allocateOverhead(100, [{ project: "a", micros: 1 }, { project: "b", micros: 1 }, { project: "c", micros: 1 }]);
    // 100 / 3 = 33 each, and one is left over: it goes to the first of equal projects by name.
    expect(a.rows.map((r) => [r.project, r.allocatedMicros])).toEqual([["a", 34], ["b", 33], ["c", 33]]);
    expect(a).toMatchObject({ residualMicros: 1, residualTo: "a" });
    expect(a.rows.reduce((s, r) => s + r.allocatedMicros, 0)).toBe(100);
    const b = allocateOverhead(10, [{ project: "small", micros: 1 }, { project: "big", micros: 7 }]);
    expect(b.rows.map((r) => [r.project, r.allocatedMicros, r.residualMicros])).toEqual([["big", 9, 1], ["small", 1, 0]]); // 8.75 and 1.25 floor to 8 and 1: the 1 left goes to the larger
    expect(b.rows.reduce((s, r) => s + r.allocatedMicros, 0)).toBe(10);
  });

  it("holds the overhead exactly for every split, whatever the numbers", () => {
    let seed = 20261025;
    const next = (): number => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    for (let i = 0; i < 400; i += 1) {
      const n = 1 + Math.floor(next() * 12);
      const landed = Array.from({ length: n }, (_, k) => ({ project: `p${k}`, micros: Math.floor(next() * 5_000_000_000) }));
      const u = Math.floor(next() * 9_000_000_000);
      const a = allocateOverhead(u, landed);
      const total = a.rows.reduce((s, r) => s + r.allocatedMicros, 0);
      if (landed.every((p) => p.micros === 0)) expect(a).toMatchObject({ unallocatedMicros: u, rows: [] });
      else {
        expect(total).toBe(u);
        expect(a.unallocatedMicros).toBe(0);
        for (const r of a.rows) expect(r.allocatedMicros).toBeGreaterThanOrEqual(0);
        expect(a.residualMicros).toBeLessThan(a.rows.length);
      }
    }
  });

  it("does not lose precision where overhead times landed spend passes 2^53", () => {
    const u = 9_007_199_254; // about $9,000: the product with a landed spend of the same size is near 8e19
    const a = allocateOverhead(u, [{ project: "x", micros: 9_007_199_254 }, { project: "y", micros: 4_503_599_627 }]);
    expect(a.rows.reduce((s, r) => s + r.allocatedMicros, 0)).toBe(u);
    expect(a.rows[0]!.allocatedMicros).toBe(6_004_799_503); // floor(u * 2 / 3) is 6004799502 and floor(u / 3) is 3002399751: one micro-dollar is left, and goes to the larger
    expect(a.rows[1]!.allocatedMicros).toBe(3_002_399_751);
  });

  it("charges a project that landed nothing nothing, and keeps the whole overhead unallocated when no project landed anything", () => {
    const a = allocateOverhead(500, [{ project: "idle-one", micros: 0 }, { project: "idle-two", micros: 0 }]);
    expect(a).toEqual({ overheadMicros: 500, rows: [], residualMicros: 0, residualTo: null, unallocatedMicros: 500 });
    expect(allocateOverhead(500, []).unallocatedMicros).toBe(500);
    const b = allocateOverhead(500, [{ project: "landed", micros: 10 }, { project: "idle", micros: 0 }]);
    expect(b.rows.map((r) => r.project)).toEqual(["landed"]);
    expect(b.rows[0]!.allocatedMicros).toBe(500);
  });

  it("treats the same project named twice as one, and has nothing to share when there is no overhead", () => {
    const a = allocateOverhead(90, [{ project: "web", micros: 1 }, { project: "web", micros: 2 }, { project: "api", micros: 3 }]);
    expect(a.rows.map((r) => [r.project, r.directMicros, r.allocatedMicros])).toEqual([["api", 3, 45], ["web", 3, 45]]);
    expect(allocateOverhead(0, [{ project: "web", micros: 5 }]).rows[0]!.allocatedMicros).toBe(0);
  });

  it("refuses an amount that is not a whole, non-negative number of micro-dollars", () => {
    expect(() => allocateOverhead(-1, [])).toThrow(RangeError);
    expect(() => allocateOverhead(1.5, [])).toThrow(RangeError);
    expect(() => allocateOverhead(10, [{ project: "x", micros: -5 }])).toThrow(/landed spend of x/);
    expect(() => allocateOverhead(Number.NaN, [])).toThrow(RangeError);
  });
});

const at = (min: number): string => `2026-10-20T${String(10 + Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00.000Z`;

async function build(t: TempDir): Promise<Ledger> {
  const db = openLedger(":memory:");
  const line = (id: string, session: string, min: number, cwd: string | undefined, output = 100_000): string => assistantLine({ id, session, ts: at(min), output, ...(cwd ? { cwd } : {}) });
  // Shop and Docs each get a prompt, then a call that answers it and (for Shop) a call an hour and a half later with nothing behind it: idle.
  const shop = t.file("shop.jsonl", [humanPromptLine({ uuid: "p1", session: "s-shop", ts: at(0) }), line("sh1", "s-shop", 1, "D:/work/shop"), line("sh2", "s-shop", 100, "D:/work/shop", 40_000)]);
  const docs = t.file("docs.jsonl", [humanPromptLine({ uuid: "p2", session: "s-docs", ts: at(0) }), line("dc1", "s-docs", 2, "D:/work/docs", 200_000)]);
  const lost = t.file("lost.jsonl", [humanPromptLine({ uuid: "p3", session: "s-lost", ts: at(0) }), line("lo1", "s-lost", 3, "D:/work/lost", 100_000)]);
  await ingestClaudeCode(db, [shop, docs, lost], loadSnapshot(PRICES));
  db.prepare("UPDATE session SET project_path = NULL WHERE session_id = 's-lost'").run();
  const outcome = db.prepare("INSERT OR REPLACE INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, 't')");
  outcome.run("s-shop", "kept");
  outcome.run("s-docs", "committed");
  return db;
}

describe("the overhead of a period, from a ledger", () => {
  const span = ["2026-10-01T00:00:00.000Z", "2026-10-31T00:00:00.000Z"] as const;

  it("counts idle work and calls with no project folder as overhead, and shares it among the projects that kept work", async () => {
    const t = new TempDir();
    try {
      const db = await build(t);
      const v = overheadView(db, loadSnapshot(PRICES), ...span, "kept");
      expect(v.idleMicros).toBeGreaterThan(0);
      expect(v.sharedMicros).toBeGreaterThan(0);
      expect(v.overheadMicros).toBe(v.idleMicros + v.sharedMicros);
      expect(v.allocation.rows.map((r) => r.project)).toEqual(["shop"]); // docs only committed
      expect(v.allocation.rows[0]!.allocatedMicros).toBe(v.overheadMicros);
      expect(v.landedSessions).toBe(1);
      expect(v.sessions).toBe(3);
      // The idle call is overhead even though its project landed: shop's own spend is only the call that answered the prompt.
      const shopCall = (db.prepare("SELECT total_micros t FROM cost_event WHERE call_id = 'sh1'").get() as { t: number }).t;
      expect(v.allocation.rows[0]!.directMicros).toBe(shopCall);
      // Every call is in exactly one place.
      const all = (db.prepare("SELECT SUM(total_micros) t FROM cost_event").get() as { t: number }).t;
      const docsCall = (db.prepare("SELECT total_micros t FROM cost_event WHERE call_id = 'dc1'").get() as { t: number }).t;
      expect(v.overheadMicros + shopCall + docsCall).toBe(all);
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("shares among more projects at a lower bar, and says what each bar would have done", async () => {
    const t = new TempDir();
    try {
      const db = await build(t);
      const v = overheadView(db, loadSnapshot(PRICES), ...span, "committed");
      expect(v.allocation.rows.map((r) => r.project).sort()).toEqual(["docs", "shop"]);
      expect(v.allocation.rows.reduce((s, r) => s + r.allocatedMicros, 0)).toBe(v.overheadMicros);
      expect(v.alternatives.map((a) => [a.bar, a.projects])).toEqual([["committed", 2], ["merged", 1], ["kept", 1]]);
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("leaves the overhead unallocated, and says what a lower bar would do, when nothing reached the bar", async () => {
    const t = new TempDir();
    try {
      const db = await build(t);
      db.exec("UPDATE session_outcome SET state = 'unlinked' WHERE session_id = 's-shop'");
      const none = overheadView(db, loadSnapshot(PRICES), ...span, "kept");
      expect(none.allocation).toMatchObject({ rows: [], unallocatedMicros: none.overheadMicros });
      expect(renderOverhead(none)).toContain("stays unallocated rather than being divided by guess");
      expect(renderOverhead(none)).toContain('At a lower bar it would be shared: "committed" among 1 project');
      db.exec("DELETE FROM session_outcome");
      expect(renderOverhead(overheadView(db, loadSnapshot(PRICES), ...span, "kept"))).toContain("No project has work at any of the bars");
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("is worded as a table that adds up", async () => {
    const t = new TempDir();
    try {
      const db = await build(t);
      const text = renderOverhead(overheadView(db, loadSnapshot(PRICES), ...span, "committed"));
      expect(text).toMatch(/^Shared overhead, 2026-10-01 to 2026-10-31: \$\d+\.\d\d \(idle work \$\d+\.\d\d, sessions with no project folder \$\d+\.\d\d\), over 3 sessions\./);
      expect(text).toContain('Shared among the 2 projects with work that reached "committed"');
      expect(text).toContain("exactly the overhead, to the micro-dollar");
      expect(text).toContain("A project that landed nothing bears none of it.");
      db.close();
    } finally {
      t.dispose();
    }
  });
});
