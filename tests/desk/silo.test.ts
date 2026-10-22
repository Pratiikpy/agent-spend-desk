import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findJsonlLogs } from "../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir, sampleReposDir } from "../../src/desk/sample/gen.ts";
import { ciSummary, fetchSiloFacts, parseHeadline, parseInvoices, parsePrs, parseRoster, reconcile, teamOfProject } from "../../src/desk/silo/facts.ts";
import { ciGreen, ciSql, deriveSeed, invoiceFactor, invoicesCsv, rosterJson, TEAM_OF_REPO, writeSeed, type SiloSeed } from "../../src/desk/silo/seed.ts";
import type { SiloRows } from "../../src/sponsors/zetaris/silo-port.ts";

const rows = (headers: string[], data: string[][]): SiloRows => ({ headers, rows: data, total: data.length, servedFrom: "live", reqHash: "x", respHash: "y" });

describe("parsing silo answers", () => {
  it("parses invoices and counts rows that do not parse instead of guessing", () => {
    const r = rows(["invoice_id", "workspace", "day", "model", "quantity", "amount_usd"], [
      ["INV-1", "payments", "2026-09-01", "claude-opus-5", "1.5", "12.5"],
      ["INV-2", "payments", "2026-09-02", "claude-opus-5", "1", "not-a-number"],
      ["INV-3", "", "2026-09-02", "claude-opus-5", "1", "3"],
      ["INV-4", "growth", "yesterday", "claude-opus-5", "1", "3"],
      ["INV-5", "growth", "2026-09-03", "claude-opus-5", "1", "-4"],
    ]);
    const p = parseInvoices(r);
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0]).toMatchObject({ team: "payments", amountMicros: 12_500_000 });
    expect(p.skipped).toBe(4);
  });

  it("rejects an answer that lacks a column", () => {
    expect(() => parseInvoices(rows(["invoice_id"], []))).toThrowError(/no column workspace/);
  });

  it("parses pull requests, reading booleans from the forms Postgres returns", () => {
    const r = rows(["head_sha", "team", "merged_at", "checks_green", "reverted"], [
      ["a1", "payments", "2026-09-01 10:00:00", "true", "false"],
      ["a2", "payments", "", "t", "f"],
      ["a3", "growth", "2026-09-01 10:00:00", "maybe", "false"],
      ["", "growth", "", "true", "false"],
    ]);
    const p = parsePrs(r);
    expect(p.facts.map((f) => [f.headSha, f.merged, f.checksGreen])).toEqual([["a1", true, true], ["a2", false, true]]);
    expect(p.skipped).toBe(2);
  });

  it("parses the roster and the headline, keeping a missing billed figure as null", () => {
    expect(parseRoster(rows(["team", "seats", "seat_plan"], [["payments", "4", "max"], ["growth", "-1", "x"], ["", "2", "y"]])).facts).toEqual([{ team: "payments", seats: 4, seatPlan: "max" }]);
    const h = parseHeadline(rows(["team", "seats", "seat_plan", "landed_prs", "billed_usd", "usd_per_landed_pr"], [["payments", "4", "max", "3", "", ""], ["growth", "2", "x", "n", "1", "1"]]));
    expect(h.facts).toEqual([{ team: "payments", seats: 4, seatPlan: "max", landedPrs: 3, billedUsd: null, usdPerLandedPr: null }]);
    expect(h.skipped).toBe(1);
  });
});

describe("seed files", () => {
  const seed: SiloSeed = {
    invoiceLines: [{ invoiceId: "INV-A", vendor: "anthropic", workspace: "payments", day: "2026-09-01", sku: "api-usage", model: "claude,\"odd\"", unit: "mtok", quantity: 1.25, amountUsd: 3.5 }],
    pullRequests: [{ prId: 1, repo: "o'brien", team: "payments", headSha: "abc", mergedAt: "2026-09-01 10:00:00", checksGreen: true, reverted: false }, { prId: 2, repo: "r", team: "growth", headSha: "def", mergedAt: null, checksGreen: false, reverted: true }],
    roster: [{ team: "payments", lead: "Team Lead A", seats: 3, seatPlan: "max", seatPriceUsd: 100 }],
  };

  it("escapes CSV cells and SQL strings", () => {
    expect(invoicesCsv(seed.invoiceLines)).toContain('"claude,""odd"""');
    const sql = ciSql(seed.pullRequests);
    expect(sql).toContain("'o''brien'");
    expect(sql).toContain("NULL");
    expect(sql).toMatch(/DROP TABLE IF EXISTS pull_requests;/);
  });

  it("writes a roster in the snake_case the REST silo serves", () => {
    expect(JSON.parse(rosterJson(seed.roster))).toEqual([{ team: "payments", lead: "Team Lead A", seats: 3, seat_plan: "max", seat_price_usd: 100 }]);
  });

  it("draws the invoice factor and the CI result from a hash, between fixed bounds, the same every time", () => {
    for (const team of Object.values(TEAM_OF_REPO)) for (const month of ["2026-09", "2026-10"]) {
      const f = invoiceFactor(team, month);
      expect(f).toBeGreaterThanOrEqual(0.93);
      expect(f).toBeLessThanOrEqual(1.03);
      expect(f).toBe(invoiceFactor(team, month));
    }
    const red = Array.from({ length: 2000 }, (_, i) => ciGreen(`sha-${i}`)).filter((g) => !g).length;
    expect(red / 2000).toBeGreaterThan(0.05);
    expect(red / 2000).toBeLessThan(0.13);
  });

  it("maps repositories to teams and nothing else", () => {
    expect(teamOfProject("C:\\somewhere\\payments-api")).toBe("payments");
    expect(teamOfProject("/x/y/web-app")).toBe("growth");
    expect(teamOfProject("/x/y/unknown-repo")).toBeNull();
    expect(teamOfProject(null)).toBeNull();
  });
});

describe("against a generated sample", () => {
  let dir: string;
  let db: Ledger;
  let seed: SiloSeed;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "desk-silo-"));
    const out = join(dir, "sample");
    buildSample({ outDir: out, seed: 11, months: 0.4, engineers: 8 });
    db = openLedger(":memory:");
    await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"));
    linkOutcomes(db, Object.keys(TEAM_OF_REPO).map((n) => join(sampleReposDir(out), n)), Date.parse("2026-12-01T00:00:00Z"));
    seed = deriveSeed(db);
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("derives the same seed twice and writes three files", () => {
    expect(JSON.stringify(deriveSeed(db))).toBe(JSON.stringify(seed));
    const files = writeSeed(seed, join(dir, "silos"));
    expect(Object.keys(files).sort()).toEqual(["ci", "invoices", "roster"]);
  });

  it("makes invoices that differ from the ledger estimate, not equal to it by construction", () => {
    const invoices = seed.invoiceLines.map((l) => ({ invoiceId: l.invoiceId, team: l.workspace, day: l.day, model: l.model, amountMicros: Math.round(l.amountUsd * 1e6) }));
    const rec = reconcile(db, invoices);
    expect(rec.billedMicros).toBeGreaterThan(0);
    expect(rec.billedMicros).not.toBe(rec.estimatedOfBilledMicros);
    for (const tm of rec.teamMonths) {
      expect(tm.deltaShare).toBeGreaterThan(-0.08);
      expect(tm.deltaShare).toBeLessThan(0.04);
    }
    expect(rec.billedShare).toBeGreaterThan(0.95);
  });

  it("without invoices everything is estimated and nothing is billed", () => {
    const rec = reconcile(db, []);
    expect(rec.billedMicros).toBe(0);
    expect(rec.billedShare).toBe(0);
    expect(rec.estimatedOnlyMicros).toBe(rec.ledgerEstimatedMicros);
  });

  it("covers only the months that have an invoice", () => {
    const first = seed.invoiceLines[0]!;
    const month = first.day.slice(0, 7);
    const only = seed.invoiceLines.filter((l) => l.day.startsWith(month) && l.workspace === first.workspace);
    const rec = reconcile(db, only.map((l) => ({ invoiceId: l.invoiceId, team: l.workspace, day: l.day, model: l.model, amountMicros: Math.round(l.amountUsd * 1e6) })));
    expect(rec.teamMonths).toHaveLength(1);
    expect(rec.estimatedOnlyMicros + rec.estimatedOfBilledMicros).toBe(rec.ledgerEstimatedMicros);
    expect(rec.billedShare).toBeLessThan(0.7);
  });

  it("reads CI facts for landed sessions through the commit each was linked to", () => {
    const prs = seed.pullRequests.map((p) => ({ headSha: p.headSha, team: p.team, merged: p.mergedAt !== null, checksGreen: p.checksGreen, reverted: p.reverted }));
    const ci = ciSummary(db, prs);
    expect(ci.landedWithCi).toBeGreaterThan(0);
    expect(ci.landedGreen + ci.landedRed).toBe(ci.landedWithCi);
    expect(ci.landedRed).toBeGreaterThan(0);
    const none = ciSummary(db, []);
    expect(none.landedWithCi).toBe(0);
    expect(none.landedNoPr).toBe(ci.landedWithCi + ci.landedNoPr);
  });
});

describe("the committed recordings", () => {
  it("replay all four statements from live runs, offline, and parse", async () => {
    const f = await fetchSiloFacts({ sample: true, cassetteDir: "data/sample/cassettes", record: false, config: null });
    expect(f.reasons).toEqual([]);
    expect(Object.values(f.served)).toEqual(["cassette", "cassette", "cassette", "cassette"]);
    expect(f.invoices.length).toBeGreaterThan(100);
    expect(f.prs.length).toBeGreaterThan(100);
    expect(f.headline.length).toBeGreaterThan(0);
    expect(f.skipped).toEqual({ invoices: 0, prs: 0, roster: 0, headline: 0 });
  });

  it("fall back, with the reason, when the recordings are missing", async () => {
    const f = await fetchSiloFacts({ sample: true, cassetteDir: "data/sample/does-not-exist", record: false, config: null });
    expect(f.reasons).toHaveLength(4);
    expect(Object.values(f.served)).toEqual(["fallback", "fallback", "fallback", "fallback"]);
    expect(f.invoices).toEqual([]);
  });
});
