import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { invoicesCommand } from "../../src/desk/billing/command.ts";
import { findPdftotext, pdftotextTool, type PdfTool } from "../../src/desk/billing/pdf.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { testSnapshot } from "./helpers.ts";

const dirs: string[] = [];
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-invoices-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function ledger(): Ledger {
  const db = openLedger(":memory:");
  db.prepare("INSERT INTO session (session_id, tool) VALUES ('s1', 'claude_code'), ('s2', 'claude_code')").run();
  const add = db.prepare(
    "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 'reported', 0, 0)",
  );
  add.run("c1", "s1", "2026-10-01T10:00:00.000Z", "claude-opus-5", 1_000_000);
  add.run("c2", "s2", "2026-10-02T10:00:00.000Z", "claude-sonnet-5-5", 2_000_000);
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(["c1", "c2"]), { unpricedCalls: 0, unpricedModels: {} });
  return db;
}

const csvFile = (lines: string[], name = "october.csv"): string => {
  const f = join(dir(), name);
  writeFileSync(f, `${lines.join("\n")}\n`);
  return f;
};
const GOOD = ["invoice,date,model,cost_usd", "INV-1,2026-10-01,claude-opus-5,25.00", "INV-1,2026-10-02,claude-sonnet-5-5,20.00", "Total,,,45.00"];

describe("desk invoices", () => {
  it("imports a CSV, says what it found, and says it was already imported the second time", () => {
    const db = ledger();
    const f = csvFile(GOOD);
    const first = invoicesCommand(["import", f], db, { period: "2026-10" });
    expect(first).toMatch(/^Imported inv-[0-9a-f]{16}: anthropic, 2 lines, \$45\.00, 2026-10-01 to 2026-10-31\./);
    expect(first).toMatch(/Run desk invoices reconcile/);
    expect(invoicesCommand(["import", f], db, { period: "2026-10" })).toMatch(/was already imported as inv-[0-9a-f]{16}; nothing changed/);
    expect(invoicesCommand(["list"], db)).toMatch(/1 invoice:\n.*anthropic.*\$45\.00.*2 lines.*imported.*INV-1.*\(october\.csv\)/);
    db.close();
  });

  it("lists nothing plainly, and reconciles nothing plainly", () => {
    const db = openLedger(":memory:");
    expect(invoicesCommand([], db)).toMatch(/^No invoice imported/);
    expect(invoicesCommand(["reconcile"], db)).toBe("Nothing to reconcile: no calls and no invoices.");
    db.close();
  });

  it("reconciles: billed, estimated and the verdict, with the reason", () => {
    const db = ledger();
    invoicesCommand(["import", csvFile(GOOD)], db, { period: "2026-10" });
    const text = invoicesCommand(["reconcile"], db);
    expect(text).toMatch(/2026-10  anthropic\s+billed\s+\$45\.00\s+estimated\s+\$45\.00\s+gap \+\$0\.00/);
    expect(text).toMatch(/RECONCILED: within 2% of the invoice, the whole month covered/);
    expect(text).toMatch(/1 reconciled, 0 partial, 0 unreconciled/);
    db.close();
  });

  it("holds an invoice whose lines do not sum, leaves it out of the reconciliation, and takes it back when accepted with a reason", () => {
    const db = ledger();
    const held = csvFile(["invoice,date,model,cost_usd", "INV-2,2026-10-01,claude-opus-5,25.00", "INV-2,2026-10-02,claude-sonnet-5-5,20.00", "Total,,,50.00"]);
    const said = invoicesCommand(["import", held], db, { period: "2026-10" });
    expect(said).toMatch(/is on hold and not counted until it is accepted: desk invoices accept (inv-[0-9a-f]{16})/);
    const id = /accept (inv-[0-9a-f]{16})/.exec(said)![1]!;
    expect(invoicesCommand(["reconcile"], db)).toMatch(/UNRECONCILED: an invoice for this month is on hold/);
    expect(() => invoicesCommand(["accept", id], db)).toThrowError(/--reason/);
    expect(invoicesCommand(["accept", id], db, { reason: "tax is billed apart" })).toMatch(/^Accepted/);
    expect(invoicesCommand(["reconcile"], db)).toMatch(/billed\s+\$45\.00/);
    db.close();
  });

  it("allocates the billed total across sessions, and says the invoice does not know which session cost what", () => {
    const db = ledger();
    invoicesCommand(["import", csvFile(GOOD)], db, { period: "2026-10" });
    const text = invoicesCommand(["allocate"], db, { month: "2026-10" });
    expect(text).toMatch(/billed total \$45\.00, allocated by estimate across 2 sessions \(the invoice does not say which session cost what/);
    expect(text).toMatch(/s1\s+estimate\s+\$25\.00\s+billed share\s+\$25\.00/);
    expect(text).toMatch(/The parts sum to \$45\.00, exactly the billed total/);
    expect(invoicesCommand(["allocate"], db, { month: "2026-09" })).toMatch(/No imported USD invoice for anthropic in 2026-09/);
    expect(() => invoicesCommand(["allocate"], db, {})).toThrowError(/--month/);
    expect(() => invoicesCommand(["allocate"], db, { month: "2026-10", by: "team" })).toThrowError(/session, model or task/);
    db.close();
  });

  it("removes an invoice", () => {
    const db = ledger();
    const said = invoicesCommand(["import", csvFile(GOOD)], db, { period: "2026-10" });
    const id = /(inv-[0-9a-f]{16})/.exec(said)![1]!;
    expect(invoicesCommand(["remove", id], db)).toBe(`Removed ${id} and its lines.`);
    expect(invoicesCommand(["remove", id], db)).toBe(`No invoice ${id}.`);
    expect(() => invoicesCommand(["remove"], db)).toThrowError(/Use: desk invoices remove/);
    db.close();
  });

  it("names the file in every reading error, and refuses a missing file, a second invoice with the same number, and an unknown subcommand", () => {
    const db = ledger();
    expect(() => invoicesCommand(["import", join(dir(), "nope.csv")], db)).toThrowError(/No file at/);
    expect(() => invoicesCommand(["import", csvFile(["a,b", "1,2"], "bad.csv")], db)).toThrowError(/^bad\.csv: The file has no column that looks like an amount/);
    expect(() => invoicesCommand(["import", csvFile(["date,model,amount", "2026-10-01,claude-opus-5,1.00"], "nocur.csv")], db)).toThrowError(/nocur\.csv: The file does not state its currency/);
    invoicesCommand(["import", csvFile(GOOD)], db, { period: "2026-10" });
    const other = csvFile(["invoice,date,model,cost_usd", "INV-1,2026-10-01,claude-opus-5,99.00"], "other.csv");
    expect(() => invoicesCommand(["import", other], db, { period: "2026-10" })).toThrowError(/other\.csv: invoice number INV-1 from anthropic is already imported from a different file/);
    expect(() => invoicesCommand(["frobnicate"], db)).toThrowError(/Use: desk invoices import/);
    db.close();
  });

  it("imports a PDF that the two readings agree on, and refuses one they disagree on, with the amounts each reading has", () => {
    const db = ledger();
    const pdf = join(dir(), "i.pdf");
    writeFileSync(pdf, "%PDF-1.4 stand-in");
    const layout = "claude-opus-5 usage        $25.00\nclaude-sonnet-5-5 usage    $20.00\nTotal      $45.00\n";
    const raw = "claude-opus-5 usage $25.00\nclaude-sonnet-5-5 usage $20.00\nTotal $45.00\n";
    const tool = (a: string, b: string): PdfTool => (args) => (args.includes("-layout") ? a : b);
    const ok = invoicesCommand(["import", pdf], db, { currency: "USD", period: "2026-10", vendor: "anthropic", pdfTool: tool(layout, raw) });
    expect(ok).toMatch(/^Imported inv-[0-9a-f]{16}: anthropic, 2 lines, \$45\.00/);
    const db2 = ledger();
    const bad = invoicesCommand(["import", pdf], db2, { currency: "USD", period: "2026-10", vendor: "anthropic", pdfTool: tool(layout, raw.replace("$20.00", "$28.00")) });
    expect(bad).toMatch(/The two readings of the PDF disagree, so nothing was imported\./);
    expect(bad).toMatch(/amounts only the layout reading has: \$20\.00/);
    expect(bad).toMatch(/amounts only the raw reading has:\s+\$28\.00/);
    expect(invoicesCommand(["list"], db2)).toMatch(/^No invoice imported/);
    db.close();
    db2.close();
  });

  it("says a PDF needs pdftotext when there is none", () => {
    const db = ledger();
    const pdf = join(dir(), "i.pdf");
    writeFileSync(pdf, "%PDF-1.4 stand-in");
    expect(() => invoicesCommand(["import", pdf], db, { pdfTool: null })).toThrowError(/needs pdftotext \(poppler\)/);
    db.close();
  });
});

/** A one-page PDF with real text, so that the real pdftotext can read it. */
function textPdf(lines: string[]): string {
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l, i) => `${i === 0 ? "" : "0 -20 Td "}(${l}) Tj`).join(" ")} ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

describe("a real PDF through the real pdftotext", () => {
  const exe = findPdftotext();
  it.skipIf(exe === null)("is read twice and agrees, when pdftotext is installed", () => {
    const db = ledger();
    const f = join(dir(), "real.pdf");
    writeFileSync(f, textPdf(["claude-opus-5 usage   $25.00", "claude-sonnet-5-5 usage   $20.00", "Total   $45.00"]), "latin1");
    const text = invoicesCommand(["import", f], db, { currency: "USD", period: "2026-10", vendor: "anthropic", pdfTool: pdftotextTool(exe!) });
    expect(text).toMatch(/^Imported inv-[0-9a-f]{16}: anthropic, 2 lines, \$45\.00/);
    db.close();
  });
});
