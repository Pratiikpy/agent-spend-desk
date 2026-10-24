import { describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { costVersions, listRepricings, renderRepricing, repriceLedger } from "../../src/desk/pricing/reprice.ts";
import { hashModels, parseSnapshot, type PriceRow, type PriceSnapshot } from "../../src/desk/pricing/pricebook.ts";

const SONNET: PriceRow = { inputPerMTokMicros: 2_000_000, outputPerMTokMicros: 10_000_000, cacheReadPerMTokMicros: 100_000, cacheWrite5mPerMTokMicros: 2_500_000, cacheWrite1hPerMTokMicros: 4_000_000 };
const OPUS: PriceRow = { inputPerMTokMicros: 5_000_000, outputPerMTokMicros: 25_000_000, cacheReadPerMTokMicros: 500_000, cacheWrite5mPerMTokMicros: 6_250_000, cacheWrite1hPerMTokMicros: 10_000_000 };

function snap(id: string, models: Record<string, PriceRow>): PriceSnapshot {
  return parseSnapshot({ snapshotId: id, source: "test", sourceUrl: "https://example.invalid", fetchedAt: "2026-10-24T00:00:00.000Z", license: "test", upstreamSha256: "0".repeat(64), note: "n", contentHash: hashModels(models), models });
}

const A = snap("A", { "claude-sonnet-5-5": SONNET, "claude-opus-5": OPUS });
// B corrects Sonnet's cache read from $0.10 to $0.20 per million tokens, leaves Opus alone, and adds a model A did not price.
const B = snap("B", { "claude-sonnet-5-5": { ...SONNET, cacheReadPerMTokMicros: 200_000 }, "claude-opus-5": OPUS, "claude-new-1": SONNET });

function ledger(): Ledger {
  const db = openLedger(":memory:");
  db.prepare("INSERT INTO session (session_id, tool) VALUES ('s', 'claude_code')").run();
  const add = db.prepare(
    "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, 's', ?, ?, 0, 0, 1000, 0, ?, 0, 0, 'reported', 0, 0)",
  );
  add.run("c1", "2026-10-10T10:00:00.000Z", "claude-sonnet-5-5", 1_000_000);
  add.run("c2", "2026-10-20T10:00:00.000Z", "claude-sonnet-5-5", 2_000_000);
  add.run("c3", "2026-10-20T11:00:00.000Z", "claude-opus-5", 1_000_000);
  add.run("c4", "2026-10-20T12:00:00.000Z", "claude-new-1", 1_000_000);
  recordSnapshot(db, A);
  recomputeCosts(db, A, new Set(["c1", "c2", "c3", "c4"]), { unpricedCalls: 0, unpricedModels: {} });
  return db;
}

const total = (db: Ledger, id: string): number | null => (db.prepare("SELECT total_micros t FROM cost_event WHERE call_id = ?").get(id) as { t: number | null }).t;

describe("repricing", () => {
  it("starts from a ledger priced under snapshot A, with the new model unpriced", () => {
    const db = ledger();
    expect(total(db, "c1")).toBe(100_000 + 10_000); // 1M reads at $0.10 + 1,000 out at $10
    expect(total(db, "c4")).toBeNull();
    db.close();
  });

  it("previews a repricing without changing anything", () => {
    const db = ledger();
    const r = repriceLedger(db, B, { reason: "correct the Sonnet cache read", preview: true });
    expect(r).toMatchObject({ repricingId: null, examined: 4, changed: 3, newlyPriced: 1, nowUnpriced: 0, toSnapshot: "B" });
    expect(total(db, "c1")).toBe(110_000);
    expect(db.prepare("SELECT COUNT(*) n FROM repricing").get()).toEqual({ n: 0 });
    db.close();
  });

  it("changes only the calls whose cost changes, and keeps the old cost of each one", () => {
    const db = ledger();
    const r = repriceLedger(db, B, { reason: "correct the Sonnet cache read", now: new Date("2026-10-24T20:00:00.000Z") });
    // c1: +$0.10, c2: +$0.20, c4: was unpriced, now priced as Sonnet is in B: 1M reads at $0.10 + 1,000 out at $10 = $0.11
    expect(r.deltaMicros).toBe(100_000 + 200_000 + 110_000);
    expect(r.changed).toBe(3);
    expect(r.repricingId).toBe(1);
    expect(total(db, "c1")).toBe(210_000);
    expect(total(db, "c2")).toBe(410_000);
    expect(total(db, "c3")).toBe(500_000 + 25_000); // untouched: still priced under A
    expect((db.prepare("SELECT snapshot_id s FROM cost_event WHERE call_id = 'c3'").get() as { s: string }).s).toBe("A");
    expect((db.prepare("SELECT snapshot_id s FROM cost_event WHERE call_id = 'c1'").get() as { s: string }).s).toBe("B");
    const versions = costVersions(db, "c1");
    expect(versions.map((v) => [v.snapshotId, v.totalMicros, v.supersededBy])).toEqual([["A", 110_000, 1], ["B", 210_000, null]]);
    expect(versions[0]?.supersededAt).toBe("2026-10-24T20:00:00.000Z");
    db.close();
  });

  it("keeps the old unpriced event of a call that became priced", () => {
    const db = ledger();
    repriceLedger(db, B, { reason: "r" });
    expect(costVersions(db, "c4").map((v) => [v.class, v.unpricedReason, v.totalMicros])).toEqual([["unpriced", "unknown-model", null], ["estimated", null, 110_000]]);
    db.close();
  });

  it("records when, to which snapshot, for what and why", () => {
    const db = ledger();
    repriceLedger(db, B, { reason: "correct the Sonnet cache read", fromIso: "2026-10-01T00:00:00.000Z", now: new Date("2026-10-24T20:00:00.000Z") });
    expect(listRepricings(db)).toEqual([{ repricingId: 1, at: "2026-10-24T20:00:00.000Z", toSnapshot: "B", fromTs: "2026-10-01T00:00:00.000Z", untilTs: null, reason: "correct the Sonnet cache read", callsChanged: 3, deltaMicros: 410_000 }]);
    db.close();
  });

  it("does nothing the second time, and writes no empty repricing", () => {
    const db = ledger();
    repriceLedger(db, B, { reason: "r" });
    const again = repriceLedger(db, B, { reason: "r" });
    expect(again).toMatchObject({ changed: 0, repricingId: null, deltaMicros: 0 });
    expect(listRepricings(db)).toHaveLength(1);
    expect((db.prepare("SELECT COUNT(*) n FROM cost_event_history").get() as { n: number }).n).toBe(3);
    db.close();
  });

  it("reprices only the span asked for", () => {
    const db = ledger();
    const r = repriceLedger(db, B, { reason: "r", fromIso: "2026-10-15T00:00:00.000Z" });
    expect(r.examined).toBe(3);
    expect(total(db, "c1")).toBe(110_000); // 10 October: outside the span, still the old price
    expect(total(db, "c2")).toBe(410_000);
    db.close();
  });

  it("can go back: repricing to the old snapshot restores the old totals and keeps both versions", () => {
    const db = ledger();
    repriceLedger(db, B, { reason: "forward" });
    const back = repriceLedger(db, A, { reason: "back" });
    expect(back.deltaMicros).toBe(-(100_000 + 200_000 + 110_000));
    expect(total(db, "c1")).toBe(110_000);
    expect(costVersions(db, "c1").map((v) => v.snapshotId)).toEqual(["A", "B", "A"]);
    db.close();
  });

  it("says in words what changed, by model", () => {
    const db = ledger();
    const text = renderRepricing(repriceLedger(db, B, { reason: "r", preview: true }), true);
    expect(text).toMatch(/^Would reprice 3 of 4 calls to B: \+\$0\.41, 1 that had no price now have one\./);
    expect(text).toMatch(/claude-sonnet-5-5\s+2 calls\s+\+\$0\.30/);
    expect(renderRepricing(repriceLedger(db, A, { reason: "r", preview: true }), true)).toMatch(/^Nothing to reprice/);
    db.close();
  });

  it("notes the pricing rules on a call whose price did not move, in place, without a history row", () => {
    const db = ledger();
    db.exec("UPDATE cost_event SET rule_ids = '[\"note:speed_unrecorded\"]' WHERE call_id = 'c3'");
    const r = repriceLedger(db, A, { reason: "r" });
    expect(r).toMatchObject({ changed: 0, annotated: 1, repricingId: null });
    expect((db.prepare("SELECT rule_ids r FROM cost_event WHERE call_id = 'c3'").get() as { r: string }).r).toBe("[]");
    expect((db.prepare("SELECT COUNT(*) n FROM cost_event_history").get() as { n: number }).n).toBe(0);
    expect(renderRepricing(r, false)).toMatch(/Noted the pricing rules on 1 of them; no price moved/);
    db.close();
  });

  it("gives an empty ledger a clear nothing-to-do", () => {
    const db = openLedger(":memory:");
    expect(repriceLedger(db, B, { reason: "r" })).toMatchObject({ examined: 0, changed: 0, repricingId: null });
    db.close();
  });
});
