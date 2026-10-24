import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseAmount } from "../../src/desk/billing/amounts.ts";
import { CsvError, parseCsv } from "../../src/desk/billing/csv.ts";
import { ImportError, readCsvInvoice } from "../../src/desk/billing/import.ts";
import { compareReadings, linesFromText, readPdfInvoice, type PdfTool } from "../../src/desk/billing/pdf.ts";
import { allocateBilled, reconcileLedger } from "../../src/desk/billing/reconcile.ts";
import { acceptInvoice, listInvoices, removeInvoice, storeInvoice } from "../../src/desk/billing/store.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { testSnapshot } from "./helpers.ts";

describe("the CSV reader", () => {
  it("reads quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF and a byte-order mark", () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3\r\n';
    expect(parseCsv(text)).toEqual([
      { line: 1, fields: ["a", "b", "c"] },
      { line: 2, fields: ["x, y", 'say "hi"', "two\nlines"] },
      { line: 5, fields: ["1", "2", "3"] },
    ]);
  });

  it("keeps an empty last field and a last line without a newline", () => {
    expect(parseCsv("a,b\n1,")).toEqual([{ line: 1, fields: ["a", "b"] }, { line: 2, fields: ["1", ""] }]);
  });

  it("refuses a quote that is never closed instead of swallowing the rest of the file", () => {
    expect(() => parseCsv('a,b\n"oops,1\n2,3\n')).toThrowError(CsvError);
    expect(() => parseCsv('a,b\n"oops,1\n2,3\n')).toThrowError(/starts on line 2/);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("amounts", () => {
  it("reads money exactly, as micro-units", () => {
    expect(parseAmount("1,234.56")).toEqual({ micros: 1_234_560_000, currency: null });
    expect(parseAmount("0.1")!.micros + parseAmount("0.2")!.micros).toBe(parseAmount("0.3")!.micros);
    expect(parseAmount("12.345678")).toEqual({ micros: 12_345_678, currency: null });
    expect(parseAmount(".5")).toEqual({ micros: 500_000, currency: null });
  });

  it("reads a minus sign, accounting parentheses and a currency sign or code on either side", () => {
    expect(parseAmount("-12.50")?.micros).toBe(-12_500_000);
    expect(parseAmount("(12.50)")?.micros).toBe(-12_500_000);
    expect(parseAmount("$0.10")).toEqual({ micros: 100_000, currency: "USD" });
    expect(parseAmount("-$3.00")).toEqual({ micros: -3_000_000, currency: "USD" });
    expect(parseAmount("EUR 5")).toEqual({ micros: 5_000_000, currency: "EUR" });
    expect(parseAmount("5 USD")).toEqual({ micros: 5_000_000, currency: "USD" });
    expect(parseAmount("€3.00")).toEqual({ micros: 3_000_000, currency: "EUR" });
  });

  it("refuses a style it would have to guess at", () => {
    for (const bad of ["1.234,56", "1 234.56", "12.3456789", "abc", "", "1,23", "--5", "1e3", "NaN"]) expect(parseAmount(bad), bad).toBeNull();
  });
});

const csv = (lines: string[]): string => `${lines.join("\n")}\n`;
const USAGE = csv([
  "date,model,tokens,cost_usd",
  "2026-10-01,claude-opus-5,1000000,25.00",
  "2026-10-02,claude-sonnet-5-5,2000000,10.00",
  "2026-10-03,claude-opus-5,500000,12.50",
  "Total,,,47.50",
]);

describe("reading a CSV invoice", () => {
  it("reads lines with their place in the file, a stated total that adds up, and the month", () => {
    const inv = readCsvInvoice(USAGE, { sourceName: "october.csv" });
    expect(inv).toMatchObject({ vendor: "anthropic", currency: "USD", periodStart: "2026-10-01", periodEnd: "2026-10-03", statedTotalMicros: 47_500_000, linesTotalMicros: 47_500_000, status: "imported" });
    expect(inv.lines.map((l) => [l.locator, l.model, l.amountMicros])).toEqual([["line 2", "claude-opus-5", 25_000_000], ["line 3", "claude-sonnet-5-5", 10_000_000], ["line 4", "claude-opus-5", 12_500_000]]);
    expect(inv.invoiceId).toMatch(/^inv-[0-9a-f]{16}$/);
  });

  it("holds an invoice whose lines do not add up to its stated total, and says by how much", () => {
    const inv = readCsvInvoice(USAGE.replace("47.50", "50.00"), { sourceName: "x.csv" });
    expect(inv.status).toBe("sum_mismatch");
    expect(inv.notes.join(" ")).toMatch(/add up to 47\.50 but the file states a total of 50\.00: 2\.50 is unaccounted for/);
  });

  it("says there is no sum check when the file states no total", () => {
    const inv = readCsvInvoice(csv(["date,model,cost_usd", "2026-10-01,claude-opus-5,1.00"]), { sourceName: "x.csv" });
    expect(inv.status).toBe("imported");
    expect(inv.notes.join(" ")).toMatch(/states no total, so there is no sum check/);
  });

  it("leaves out a subtotal row and says so", () => {
    const inv = readCsvInvoice(csv(["date,model,cost_usd", "2026-10-01,claude-opus-5,1.00", "Subtotal,,1.00", "Total,,1.00"]), { sourceName: "x.csv" });
    expect(inv.lines).toHaveLength(1);
    expect(inv.notes.join(" ")).toMatch(/subtotal row was left out/);
  });

  it("refuses a file that never states its currency, and takes it from --currency", () => {
    const text = csv(["date,model,amount", "2026-10-01,claude-opus-5,1.00"]);
    expect(() => readCsvInvoice(text, { sourceName: "x" })).toThrowError(/does not state its currency/);
    expect(readCsvInvoice(text, { sourceName: "x", currency: "usd" }).currency).toBe("USD");
  });

  it("refuses a file that mixes currencies, and one that disagrees with --currency", () => {
    expect(() => readCsvInvoice(csv(["date,model,amount", "2026-10-01,claude-opus-5,$1.00", "2026-10-02,claude-opus-5,€2.00"]), { sourceName: "x" })).toThrowError(/mixes currencies \(EUR, USD\)/);
    expect(() => readCsvInvoice(csv(["date,model,amount", "2026-10-01,claude-opus-5,$1.00"]), { sourceName: "x", currency: "EUR" })).toThrowError(/says USD but --currency says EUR/);
  });

  it("names the line of an amount or a date it cannot read", () => {
    expect(() => readCsvInvoice(csv(["date,model,cost_usd", "2026-10-01,claude-opus-5,1.00", '2026-10-02,claude-opus-5,"1,5"']), { sourceName: "x" })).toThrowError(/line 3: "1" is not an amount|line 3/);
    expect(() => readCsvInvoice(csv(["date,model,cost_usd", "2026-02-30,claude-opus-5,1.00"]), { sourceName: "x" })).toThrowError(/line 2: "2026-02-30" is not a date/);
  });

  it("asks for the vendor when it cannot tell, and for the month when no line has a date", () => {
    expect(() => readCsvInvoice(csv(["date,model,cost_usd", "2026-10-01,some-model,1.00"]), { sourceName: "x" })).toThrowError(/which vendor/);
    expect(() => readCsvInvoice(csv(["model,cost_usd", "claude-opus-5,1.00"]), { sourceName: "x" })).toThrowError(/cannot be placed in a month/);
    const inv = readCsvInvoice(csv(["model,cost_usd", "claude-opus-5,1.00"]), { sourceName: "x", period: "2026-02" });
    expect([inv.periodStart, inv.periodEnd]).toEqual(["2026-02-01", "2026-02-28"]);
    expect(inv.notes.join(" ")).toMatch(/period 2026-02 was given/);
  });

  it("refuses a file that mixes invoice numbers, a total stated twice, and a file with no amount column or no lines", () => {
    expect(() => readCsvInvoice(csv(["invoice,date,model,cost_usd", "A1,2026-10-01,claude-opus-5,1.00", "A2,2026-10-02,claude-opus-5,1.00"]), { sourceName: "x" })).toThrowError(/mixes invoice numbers/);
    expect(() => readCsvInvoice(csv(["date,model,cost_usd", "2026-10-01,claude-opus-5,1.00", "Total,,1.00", "Total,,1.00"]), { sourceName: "x" })).toThrowError(/states a total twice/);
    expect(() => readCsvInvoice("a,b\n1,2\n", { sourceName: "x" })).toThrowError(ImportError);
    expect(() => readCsvInvoice("date,model,cost_usd\n", { sourceName: "x" })).toThrowError(/no lines/);
    expect(() => readCsvInvoice("", { sourceName: "x" })).toThrowError(/no column that looks like an amount/);
  });

  it("reads credits as negative lines", () => {
    const inv = readCsvInvoice(csv(["date,model,cost_usd", "2026-10-01,claude-opus-5,10.00", "2026-10-02,claude-opus-5,(2.50)", "Total,,7.50"]), { sourceName: "x" });
    expect(inv.status).toBe("imported");
    expect(inv.lines[1]?.amountMicros).toBe(-2_500_000);
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the invoice store", () => {
  it("keeps an invoice and its lines, recognises the same file twice, and refuses a second file with the same invoice number", () => {
    const db = openLedger(":memory:");
    const a = readCsvInvoice(csv(["invoice,date,model,cost_usd", "A1,2026-10-01,claude-opus-5,1.00"]), { sourceName: "a.csv" });
    expect(storeInvoice(db, a)).toEqual({ kind: "stored", invoiceId: a.invoiceId });
    expect(storeInvoice(db, a)).toEqual({ kind: "already_imported", invoiceId: a.invoiceId });
    const b = readCsvInvoice(csv(["invoice,date,model,cost_usd", "A1,2026-10-01,claude-opus-5,2.00"]), { sourceName: "b.csv" });
    expect(storeInvoice(db, b)).toEqual({ kind: "number_conflict", existing: a.invoiceId, invoiceNumber: "A1" });
    expect(listInvoices(db)).toHaveLength(1);
    expect(listInvoices(db)[0]).toMatchObject({ vendor: "anthropic", invoiceNumber: "A1", lines: 1, status: "imported" });
    db.close();
  });

  it("removes an invoice with its lines, and accepts a held one with the reason kept", () => {
    const db = openLedger(":memory:");
    const held = readCsvInvoice(USAGE.replace("47.50", "50.00"), { sourceName: "x.csv" });
    storeInvoice(db, held);
    expect(listInvoices(db)[0]?.status).toBe("sum_mismatch");
    expect(acceptInvoice(db, held.invoiceId, "tax is billed separately", new Date("2026-11-02T00:00:00Z"))).toBe(true);
    expect(listInvoices(db)[0]?.status).toBe("imported");
    expect(listInvoices(db)[0]?.notes.join(" ")).toMatch(/Accepted on 2026-11-02 although the lines differ from the stated total by 2.5: tax is billed separately/);
    expect(acceptInvoice(db, held.invoiceId, "again")).toBe(false);
    expect(removeInvoice(db, held.invoiceId)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM billed_line").get() as { n: number }).n).toBe(0);
    expect(removeInvoice(db, held.invoiceId)).toBe(false);
    db.close();
  });
});

function ledger(): Ledger {
  const db = openLedger(":memory:");
  db.prepare("INSERT INTO session (session_id, tool) VALUES ('s1', 'claude_code'), ('s2', 'claude_code')").run();
  const add = db.prepare(
    "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 'reported', 0, 0)",
  );
  // Opus 5 output is $25 per million, Sonnet 5.5 output is $10 per million.
  add.run("c1", "s1", "2026-10-01T10:00:00.000Z", "claude-opus-5", 1_000_000); // $25.00
  add.run("c2", "s2", "2026-10-02T10:00:00.000Z", "claude-sonnet-5-5", 2_000_000); // $20.00
  add.run("c3", "s1", "2026-10-03T10:00:00.000Z", "claude-opus-5", 500_000); // $12.50
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(["c1", "c2", "c3"]), { unpricedCalls: 0, unpricedModels: {} });
  return db;
}

const invoice = (rows: string[], opts: { period?: string; name?: string } = {}) =>
  readCsvInvoice(csv(["invoice,date,model,cost_usd", ...rows]), { sourceName: opts.name ?? "x.csv", ...(opts.period ? { period: opts.period } : {}) });

describe("reconciling billed against estimated", () => {
  // The ledger estimates October at $57.50 (25 + 20 + 12.50): Opus $37.50 and Sonnet $20.00.
  const full = (billedOpus: string, billedSonnet: string, extra: string[] = []) =>
    invoice([`INV-1,2026-10-01,claude-opus-5,${billedOpus}`, `INV-1,2026-10-02,claude-sonnet-5-5,${billedSonnet}`, ...extra], { period: "2026-10" });

  it("calls a month reconciled when an invoice covers all of it, the models match and the totals are within the tolerance", () => {
    const db = ledger();
    storeInvoice(db, full("37.80", "20.00"));
    const [r] = reconcileLedger(db);
    expect(r).toMatchObject({ vendor: "anthropic", period: "2026-10", currency: "USD", billedMicros: 57_800_000, estimatedMicros: 57_500_000, gapMicros: 300_000, status: "reconciled", unmatchedBilledMicros: 0, unmatchedEstimatedMicros: 0 });
    expect(r?.reason).toMatch(/within 2% of the invoice, the whole month covered/);
    db.close();
  });

  it("calls it unreconciled, with the percentage, when the estimate is further from the invoice than the tolerance", () => {
    const db = ledger();
    storeInvoice(db, full("45.00", "20.00"));
    const [r] = reconcileLedger(db);
    expect(r?.status).toBe("unreconciled");
    expect(r?.reason).toMatch(/differs from the invoice by 11\.5%, more than the 2% tolerance/);
    expect(reconcileLedger(db, { tolerancePct: 15 })[0]?.status).toBe("reconciled");
    db.close();
  });

  it("calls it partial when the invoice covers only part of the month, naming the days", () => {
    const db = ledger();
    storeInvoice(db, invoice(["INV-2,2026-10-01,claude-opus-5,37.50", "INV-2,2026-10-02,claude-sonnet-5-5,20.00"]));
    const [r] = reconcileLedger(db);
    expect(r?.status).toBe("partial");
    expect(r?.reason).toMatch(/covers 2026-10-01 to 2026-10-02, not the whole month/);
    db.close();
  });

  it("calls it partial when the totals agree but the models do not line up, and counts the dollars on each side", () => {
    const db = ledger();
    storeInvoice(db, invoice(["INV-1,2026-10-01,claude-opus-5,37.50", "INV-1,2026-10-03,claude-haiku-5-5,20.00"], { period: "2026-10" }));
    const [r] = reconcileLedger(db);
    expect(r).toMatchObject({ status: "partial", unmatchedBilledMicros: 20_000_000, unmatchedEstimatedMicros: 20_000_000 });
    db.close();
  });

  it("lists a month with calls and no invoice as unreconciled, and a held invoice as the reason", () => {
    const db = ledger();
    expect(reconcileLedger(db)[0]).toMatchObject({ status: "unreconciled", billedMicros: null, reason: "no invoice has been imported for this month" });
    const held = invoice(["INV-9,2026-10-01,claude-opus-5,10.00", "Total,,,99.00"], { period: "2026-10" });
    storeInvoice(db, { ...held });
    const r = reconcileLedger(db)[0];
    expect(r?.status).toBe("unreconciled");
    expect(r?.reason).toMatch(/on hold because its lines do not add up/);
    db.close();
  });

  it("does not compare an invoice in another currency with a USD estimate, and converts nothing", () => {
    const db = ledger();
    storeInvoice(db, readCsvInvoice(csv(["invoice,date,model,amount", "E-1,2026-10-01,claude-opus-5,EUR 30.00"]), { sourceName: "e.csv", period: "2026-10" }));
    const r = reconcileLedger(db)[0];
    expect(r).toMatchObject({ currency: "EUR", billedMicros: 30_000_000, gapMicros: null, status: "unreconciled" });
    expect(r?.reason).toMatch(/nothing is converted/);
    db.close();
  });

  it("puts the tool's own recorded cost beside them, never in place of either", () => {
    const db = ledger();
    db.prepare("INSERT INTO reported_cost (session_id, process_start_ms, total_micros, unknown_model_cost, observed_ts) VALUES ('s1', 1, 31000000, 0, '2026-10-03T12:00:00.000Z')").run();
    storeInvoice(db, full("37.50", "20.00"));
    expect(reconcileLedger(db)[0]).toMatchObject({ billedMicros: 57_500_000, estimatedMicros: 57_500_000, reportedMicros: 31_000_000 });
    db.close();
  });

  it("is stored, and a second run replaces rather than adds", () => {
    const db = ledger();
    storeInvoice(db, full("37.50", "20.00"));
    reconcileLedger(db);
    reconcileLedger(db);
    expect((db.prepare("SELECT COUNT(*) n FROM reconciliation").get() as { n: number }).n).toBe(1);
    db.close();
  });
});

describe("allocating the billed total", () => {
  it("splits the month's billed dollars across sessions by their estimates, and the parts sum to the billed total exactly", () => {
    const db = ledger();
    storeInvoice(db, invoice(["INV-1,2026-10-01,claude-opus-5,57.77", "INV-1,2026-10-02,claude-sonnet-5-5,0.01"], { period: "2026-10" }));
    const a = allocateBilled(db, "anthropic", "2026-10", "session")!;
    expect(a.billedMicros).toBe(57_780_000);
    expect(a.parts.reduce((s, p) => s + p.billedMicros, 0)).toBe(57_780_000);
    expect(a.parts.map((p) => p.key).sort()).toEqual(["s1", "s2"]);
    // s1 has $37.50 of the $57.50 estimate, s2 has $20.00: 57.78 x 37.5 / 57.5 = 37.682608...
    expect(a.parts.find((p) => p.key === "s1")?.billedMicros).toBe(37_682_609);
    expect(a.parts.find((p) => p.key === "s2")?.billedMicros).toBe(20_097_391);
    db.close();
  });

  it("allocates by model and by task too, and says nothing when there is no invoice for the month", () => {
    const db = ledger();
    expect(allocateBilled(db, "anthropic", "2026-10", "model")).toBeNull();
    storeInvoice(db, invoice(["INV-1,2026-10-01,claude-opus-5,57.50"], { period: "2026-10" }));
    expect(allocateBilled(db, "anthropic", "2026-10", "model")!.parts.map((p) => [p.key, p.billedMicros])).toEqual([["claude-opus-5", 37_500_000], ["claude-sonnet-5-5", 20_000_000]]);
    expect(allocateBilled(db, "anthropic", "2026-10", "task")!.parts.reduce((s, p) => s + p.billedMicros, 0)).toBe(57_500_000);
    db.close();
  });

  it("gives a credit back its sign", () => {
    const db = ledger();
    storeInvoice(db, invoice(["INV-1,2026-10-01,claude-opus-5,(10.00)"], { period: "2026-10" }));
    const a = allocateBilled(db, "anthropic", "2026-10", "session")!;
    expect(a.billedMicros).toBe(-10_000_000);
    expect(a.parts.reduce((s, p) => s + p.billedMicros, 0)).toBe(-10_000_000);
    db.close();
  });
});

describe("a PDF read twice", () => {
  const layout = "Anthropic invoice\nclaude-opus-5 usage        $37.50\nclaude-sonnet-5-5 usage    $20.00\nTotal      $57.50\nPage 1 of 1\n";
  const raw = "Anthropic invoice\nclaude-opus-5 usage $37.50\nclaude-sonnet-5-5 usage $20.00\nTotal $57.50\nPage 1 of 1\n";
  const tool = (a: string, b: string): PdfTool => (args) => (args.includes("-layout") ? a : b);

  function pdfFile(): string {
    const d = mkdtempSync(join(tmpdir(), "desk-pdf-test-"));
    dirs.push(d);
    const f = join(d, "i.pdf");
    writeFileSync(f, "%PDF-1.4 not really");
    return f;
  }

  it("takes the lines that end in an amount, and ignores the rest", () => {
    expect(linesFromText(layout).map((l) => [l.description, l.amountMicros, l.locator])).toEqual([["claude-opus-5 usage", 37_500_000, "line 2"], ["claude-sonnet-5-5 usage", 20_000_000, "line 3"], ["Total", 57_500_000, "line 4"]]);
  });

  it("trusts the lines when both readings give the same amounts, and checks the stated total", () => {
    const r = readPdfInvoice(pdfFile(), { sourceName: "i.pdf", currency: "USD", period: "2026-10", vendor: "anthropic" }, tool(layout, raw));
    expect(r.reading.kind).toBe("agreed");
    expect(r.invoice).toMatchObject({ status: "imported", linesTotalMicros: 57_500_000, statedTotalMicros: 57_500_000 });
    expect(r.invoice?.lines.map((l) => l.model)).toEqual(["claude-opus-5", "claude-sonnet-5-5"]);
  });

  it("returns a conflict, with the amounts each reading has that the other lacks, and no invoice, when they disagree", () => {
    const r = readPdfInvoice(pdfFile(), { sourceName: "i.pdf", currency: "USD", period: "2026-10", vendor: "anthropic" }, tool(layout, raw.replace("$20.00", "$28.00")));
    expect(r.invoice).toBeNull();
    expect(r.reading).toEqual({ kind: "conflict", onlyLayout: [20_000_000], onlyRaw: [28_000_000] });
  });

  it("compares duplicates as counts, not as a set", () => {
    const one = linesFromText("a $1.00\n");
    const two = linesFromText("a $1.00\nb $1.00\n");
    expect(compareReadings(one, two)).toMatchObject({ kind: "conflict", onlyLayout: [], onlyRaw: [1_000_000] });
  });

  it("says a PDF with no amount lines has no text to read, and asks for what a PDF cannot say", () => {
    expect(() => readPdfInvoice(pdfFile(), { sourceName: "i.pdf" }, () => "scanned image\n")).toThrowError(/export the invoice as CSV/);
    expect(() => readPdfInvoice(pdfFile(), { sourceName: "i.pdf", vendor: "anthropic", period: "2026-10" }, tool(layout, raw))).toThrowError(/does not state its currency/);
    expect(() => readPdfInvoice(pdfFile(), { sourceName: "i.pdf", vendor: "anthropic", currency: "USD" }, tool(layout, raw))).toThrowError(/Say which month/);
  });
});
