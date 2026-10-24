import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { billCommand, renderBill } from "../../src/desk/bill/command.ts";
import { classCoverage, coverageLine } from "../../src/desk/bill/coverage.ts";
import { billLines, csvCell, toCsv } from "../../src/desk/bill/export.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { formatUsd } from "../../src/desk/money.ts";
import { testSnapshot } from "./helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "desk-bill-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Seed {
  session: string;
  ts: string;
  project?: string;
  model?: string;
  output: number;
  state?: "kept" | "merged" | "committed" | "reverted";
}

function ledger(seeds: Seed[]): Ledger {
  const db = openLedger(":memory:");
  const seen = new Set<string>();
  let n = 0;
  for (const s of seeds) {
    if (!seen.has(s.session)) {
      seen.add(s.session);
      db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at, tool_version) VALUES (?, 'claude_code', ?, 'main', ?, ?, '1')").run(s.session, s.project ?? "D:/work/shop", s.ts, s.ts);
      if (s.state) db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, 't')").run(s.session, s.state);
    }
    n += 1;
    db.prepare(
      "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 'reported', 0, 0)",
    ).run(`c${n}`, s.session, s.ts, s.model ?? "claude-opus-5", s.output);
  }
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(Array.from({ length: n }, (_, i) => `c${i + 1}`)), { unpricedCalls: 0, unpricedModels: {} });
  return db;
}

// Opus 5 output is $25 per million: 100,000 tokens are $2.50. Sonnet 5.5 is $10 per million.
const SEEDS: Seed[] = [
  { session: "a", ts: "2026-09-01T10:00:00.000Z", output: 100_000, state: "kept" }, // $2.50
  { session: "a", ts: "2026-09-01T11:00:00.000Z", output: 100_000, state: "kept" }, // $2.50
  { session: "b", ts: "2026-09-02T10:00:00.000Z", output: 200_000, project: "D:/work/api", state: "reverted" }, // $5.00
  { session: "c", ts: "2026-09-03T10:00:00.000Z", output: 50_000, model: "claude-sonnet-5-5" }, // $0.50, unlinked
  { session: "d", ts: "2026-09-04T10:00:00.000Z", output: 10_000, model: "claude-mystery-1" }, // no price
  { session: "e", ts: "2026-10-01T10:00:00.000Z", output: 999_000 }, // outside September
];

const snap = testSnapshot();
const usd = formatUsd;

describe("which kind of figure stands behind the dollars", () => {
  it("is all estimate when there is no invoice and no tool figure, and counts the unpriced calls apart", () => {
    const c = classCoverage(ledger(SEEDS), "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z");
    expect(c).toMatchObject({ totalMicros: 10_500_000, billedMicros: 0, reportedMicros: 0, estimatedOnlyMicros: 10_500_000, unpricedCalls: 1, calls: 5 });
    expect(coverageLine(c, usd)).toBe("$10.50: 0.0% in months an invoice covers, 0.0% in processes that recorded their own cost, 100.0% only our estimate; 1 call on a model with no price are counted, not priced.".replace("1 call on a model with no price are", "1 call on a model with no price is"));
  });

  it("counts the dollars of a month an invoice covers as billed, and the tool's own figure for the rest, each call once", () => {
    const db = ledger(SEEDS);
    db.prepare("INSERT INTO invoice (invoice_id, vendor, invoice_number, currency, period_start, period_end, stated_total_micros, lines_total_micros, status, notes, source_name, source_sha256, imported_at) VALUES ('i', 'anthropic', 'A', 'USD', '2026-09-01', '2026-09-30', 10500000, 10500000, 'imported', '[]', 's.csv', ?, 't')").run("0".repeat(64));
    db.prepare("INSERT INTO billed_line (invoice_id, line_no, day, model, description, quantity, amount_micros, locator) VALUES ('i', 1, NULL, NULL, 'usage', NULL, 10500000, 'r1')").run();
    const billed = classCoverage(db, "2026-09-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z");
    // September is covered; October (999,000 tokens, $24.975) is not.
    expect(billed).toMatchObject({ billedMicros: 10_500_000, reportedMicros: 0, estimatedOnlyMicros: 24_975_000 });

    const other = ledger(SEEDS);
    other.prepare("INSERT INTO reported_cost (session_id, process_start_ms, total_micros, unknown_model_cost, observed_ts) VALUES ('b', 0, 5000000, 0, '2026-09-02T12:00:00.000Z')").run();
    const reported = classCoverage(other, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z");
    expect(reported).toMatchObject({ billedMicros: 0, reportedMicros: 5_000_000, estimatedOnlyMicros: 5_500_000 });
    expect(reported.billedMicros + reported.reportedMicros + reported.estimatedOnlyMicros).toBe(reported.totalMicros);
  });

  it("says plainly when nothing was priced", () => {
    const c = classCoverage(ledger([{ session: "x", ts: "2026-09-01T00:00:00.000Z", output: 5, model: "claude-mystery-1" }]), "0000", "9999");
    expect(coverageLine(c, usd)).toBe("No priced call in the period; 1 call on a model with no price.");
    expect(coverageLine(classCoverage(ledger([]), "0000", "9999"), usd)).toBe("No call in the period.");
  });
});

describe("desk bill", () => {
  const db = ledger(SEEDS);
  const run = (over: Record<string, unknown> = {}) => billCommand({ db, snapshot: snap, mode: "own_logs", month: "2026-09", ...over } as never);

  it("prints the month the same way the screen reads it", () => {
    const r = run();
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Bill, 2026-09-01 to 2026-09-30: $10.50 estimated at list price over 4 priced calls.");
    expect(r.text).toContain("An estimate from logged tokens, not an invoice.");
    expect(r.text).toContain("$10.50: 0.0% in months an invoice covers");
    expect(r.text).toContain("No repository is linked, so nothing can be called landed.");
    expect(r.text).toMatch(/claude-mystery-1\s+unpriced/);
    expect(r.text).toMatch(/By project\n\s+shop\s+\$5\.50\n\s+api\s+\$5\.00/);
    expect(r.text).not.toContain("D:/work");
  });

  it("refuses what it cannot read, naming the fix", () => {
    expect(run({ month: "september" })).toEqual({ ok: false, text: expect.stringMatching(/2026-09/) });
    expect(run({ month: "2026-09", since: "2026-09-01" }).text).toMatch(/not both/);
    expect(run({ month: undefined, since: "yesterday" }).text).toBe('--since must be a date such as 2026-09-01, got "yesterday".');
    expect(run({ month: undefined, since: "2026-09-10", until: "2026-09-01" }).text).toBe("--since is after --until.");
    expect(run({ month: "2025-01" }).text).toMatch(/holds no call between 2025-01-01 and 2025-01-31/);
    expect(run({ exportAs: "xml" }).text).toBe('--export must be csv or json, got "xml".');
    expect(billCommand({ db: ledger([]), snapshot: snap, mode: "own_logs" }).ok).toBe(false);
  });

  it("reads any dates, not only a month", () => {
    const r = run({ month: undefined, since: "2026-09-02", until: "2026-09-03" });
    expect(r.text).toContain("Bill, 2026-09-02 to 2026-09-03: $5.50 estimated");
  });
});

describe("the export", () => {
  const db = ledger([...SEEDS, { session: "f", ts: "2026-09-05T10:00:00.000Z", output: 10_000, project: "D:/work/=SUM(1+1)", state: "merged" }]);

  it("has a row per day, project, model and landing state, and the rows add up to the bill", () => {
    const lines = billLines(db, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z");
    const estimated = lines.filter((l) => l.class === "estimated");
    expect(estimated.reduce((t, l) => t + (l.amountMicros ?? 0), 0)).toBe(10_500_000 + 250_000);
    const bill = billCommand({ db, snapshot: snap, mode: "own_logs", month: "2026-09", exportAs: "json" });
    const parsed = JSON.parse(bill.text) as { schema: string; bill: { totals: { estimatedMicros: number } }; lines: unknown[] };
    expect(parsed.schema).toBe("desk.bill.v1");
    expect(parsed.bill.totals.estimatedMicros).toBe(estimated.reduce((t, l) => t + (l.amountMicros ?? 0), 0));
    expect(parsed.lines).toHaveLength(lines.length);
    const unpriced = lines.find((l) => l.class === "unpriced")!;
    expect(unpriced).toMatchObject({ model: "claude-mystery-1", amountMicros: null, calls: 1, outputTokens: 10_000 });
    expect(unpriced.note).toMatch(/no dollars invented/);
  });

  it("is a CSV a spreadsheet opens as data, not as a formula", () => {
    const csv = toCsv(billLines(db, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"));
    const rows = csv.split("\r\n");
    expect(rows[0]).toBe("class,day,vendor,project,model,landing_state,calls,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,currency,amount_micros,amount,snapshot,note");
    expect(rows.at(-1)).toBe("");
    const hostile = rows.find((r) => r.includes("SUM(1+1)"))!;
    expect(hostile).toContain(",'=SUM(1+1),"); // an apostrophe first, so a spreadsheet reads text, not a formula
    expect(rows.some((r) => r.includes(",=SUM"))).toBe(false);
    expect(rows.find((r) => r.startsWith("unpriced,"))).toMatch(/^unpriced,2026-09-04,anthropic,shop,claude-mystery-1,unlinked,1,0,10000,0,0,USD,,,,"no price for this model: tokens counted, no dollars invented"$/);
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell(-5)).toBe("-5"); // a number is a number
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
  });

  it("puts billed rows first and keeps their own currency", () => {
    const d = ledger(SEEDS);
    d.prepare("INSERT INTO invoice (invoice_id, vendor, invoice_number, currency, period_start, period_end, stated_total_micros, lines_total_micros, status, notes, source_name, source_sha256, imported_at) VALUES ('i', 'anthropic', 'A', 'EUR', '2026-09-01', '2026-09-30', 9000000, 9000000, 'imported', '[]', 's.csv', ?, 't')").run("0".repeat(64));
    d.prepare("INSERT INTO billed_line (invoice_id, line_no, day, model, description, quantity, amount_micros, locator) VALUES ('i', 1, NULL, 'claude-opus-5', 'Opus usage', NULL, 9000000, 'r1')").run();
    const lines = billLines(d, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z");
    expect(lines[0]).toMatchObject({ class: "billed", vendor: "anthropic", currency: "EUR", amountMicros: 9_000_000, day: "2026-09-01", note: "Opus usage" });
    expect(lines.slice(1).every((l) => l.class !== "billed")).toBe(true);
  });

  it("writes a file when asked, and says how many lines", () => {
    const out = join(tmp, "bill.csv");
    const r = billCommand({ db, snapshot: snap, mode: "own_logs", month: "2026-09", exportAs: "csv", out });
    expect(r.text).toMatch(/^Wrote \d+ lines \(csv\) to /);
    expect(readFileSync(out, "utf8").startsWith("class,day,vendor")).toBe(true);
  });
});

describe("the bill as text when repositories are linked", () => {
  it("lists each landing state with its share and the cost per landed session", () => {
    const b = {
      totals: { estimatedMicros: 20_000_000, pricedCalls: 10, unpricedCalls: 0 },
      coverageLine: "x",
      classes: [],
      reconciliations: [{ vendor: "anthropic", period: "2026-09", billedMicros: 21_000_000, currency: "USD", estimatedMicros: 20_000_000, status: "unreconciled", reason: "the estimate differs from the invoice by 4.8%" }],
      landing: { linked: true, lowConfidenceMicros: 1_000_000, rows: [{ state: "kept", micros: 12_000_000, share: 0.6, sessions: 3 }, { state: "unlinked", micros: 8_000_000, share: 0.4, sessions: 1 }, { state: "reverted", micros: 0, share: 0, sessions: 0 }] },
      costPerLandedSession: 4_000_000,
      landedSessions: 3,
      causes: [],
      pricing: null,
      priceBand: null,
      byModel: [],
      byProject: [],
      snapshotId: "s",
    };
    const text = renderBill(b, { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-09-30T23:59:59.999Z", days: 30, lastIso: null });
    expect(text).toMatch(/kept\s+\$12\.00\s+60\.0%\s+3 sessions/);
    expect(text).toMatch(/unlinked\s+\$8\.00\s+40\.0%\s+1 session(?!s)/);
    expect(text).not.toMatch(/reverted/);
    expect(text).toContain("$1.00 of linked spend rests on weak evidence and is not counted as landed.");
    expect(text).toContain("$4.00 per landed session over 3 sessions.");
    expect(text).toContain("anthropic 2026-09: billed $21.00, estimated $20.00, unreconciled: the estimate differs from the invoice by 4.8%");
  });
});
