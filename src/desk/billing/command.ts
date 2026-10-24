import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { ImportError, readCsvInvoice, type ImportOptions, type ParsedInvoice } from "./import.ts";
import { findPdftotext, pdftotextTool, readPdfInvoice, type PdfTool } from "./pdf.ts";
import { allocateBilled, reconcileLedger, type AllocateBy, type PeriodReconciliation } from "./reconcile.ts";
import { acceptInvoice, listInvoices, removeInvoice, storeInvoice } from "./store.ts";

export interface InvoiceCommandOptions {
  vendor?: string;
  currency?: string;
  period?: string;
  month?: string;
  by?: string;
  tolerancePct?: number;
  reason?: string;
  /** For tests: the PDF reader to use instead of pdftotext. */
  pdfTool?: PdfTool | null;
  now?: Date;
}

const money = (micros: number | null, currency = "USD"): string => (micros === null ? "none" : currency === "USD" ? formatUsd(micros) : `${currency} ${(micros / 1_000_000).toFixed(2)}`);

/** The text of `desk invoices ...`. A usage mistake throws an Error with a plain message. */
export function invoicesCommand(args: readonly string[], db: Ledger, o: InvoiceCommandOptions = {}): string {
  const [sub, ...rest] = args;
  if (sub === "import") return importFile(rest[0], db, o);
  if (sub === undefined || sub === "list") return list(db);
  if (sub === "reconcile") return reconcileText(db, o);
  if (sub === "remove") {
    if (!rest[0]) throw new Error("Use: desk invoices remove <invoice id>");
    return removeInvoice(db, rest[0]) ? `Removed ${rest[0]} and its lines.` : `No invoice ${rest[0]}.`;
  }
  if (sub === "accept") {
    if (!rest[0] || !o.reason) throw new Error('Use: desk invoices accept <invoice id> --reason "why the lines differ from the stated total"');
    return acceptInvoice(db, rest[0], o.reason, o.now) ? `Accepted ${rest[0]}; the reason is kept with it.` : `${rest[0]} is not an invoice on hold for a sum mismatch.`;
  }
  if (sub === "allocate") return allocate(db, o);
  throw new Error("Use: desk invoices import <file.csv|file.pdf> [--vendor V] [--currency C] [--period YYYY-MM] | list | reconcile [--tolerance N] | accept <id> --reason TEXT | remove <id> | allocate --month YYYY-MM [--vendor V] [--by session|model|task]");
}

function importFile(file: string | undefined, db: Ledger, o: InvoiceCommandOptions): string {
  if (!file) throw new Error("Use: desk invoices import <file.csv|file.pdf>");
  if (!existsSync(file)) throw new Error(`No file at ${file}.`);
  const opts: ImportOptions = { sourceName: basename(file), ...(o.vendor ? { vendor: o.vendor } : {}), ...(o.currency ? { currency: o.currency } : {}), ...(o.period ? { period: o.period } : {}) };
  let parsed: ParsedInvoice | null;
  const lines: string[] = [];
  try {
    if (/\.pdf$/i.test(file)) {
      const exe = o.pdfTool === undefined ? findPdftotext() : null;
      const tool = o.pdfTool ?? (exe ? pdftotextTool(exe) : null);
      if (tool === null) throw new ImportError("Reading a PDF needs pdftotext (poppler), which was not found. Export the invoice as CSV instead, or install poppler.");
      const r = readPdfInvoice(file, opts, tool);
      parsed = r.invoice;
      if (r.reading.kind === "conflict") {
        lines.push("The two readings of the PDF disagree, so nothing was imported.");
        if (r.reading.onlyLayout.length > 0) lines.push(`  amounts only the layout reading has: ${r.reading.onlyLayout.map((m) => money(m)).join(", ")}`);
        if (r.reading.onlyRaw.length > 0) lines.push(`  amounts only the raw reading has:    ${r.reading.onlyRaw.map((m) => money(m)).join(", ")}`);
        lines.push("Export the invoice as CSV, or fix the PDF's text, and import again.");
        return lines.join("\n");
      }
    } else {
      parsed = readCsvInvoice(readFileSync(file, "utf8"), opts);
    }
  } catch (e) {
    if (e instanceof ImportError || (e as Error).name === "CsvError") throw new Error(`${basename(file)}: ${(e as Error).message}`);
    throw e;
  }
  if (parsed === null) return lines.join("\n");
  const stored = storeInvoice(db, parsed, o.now);
  if (stored.kind === "already_imported") return `${basename(file)} was already imported as ${stored.invoiceId}; nothing changed.`;
  if (stored.kind === "number_conflict") {
    throw new Error(`${basename(file)}: invoice number ${stored.invoiceNumber} from ${parsed.vendor} is already imported from a different file (${stored.existing}). Remove one (desk invoices remove <id>) or check which file is right.`);
  }
  lines.push(`Imported ${stored.invoiceId}: ${parsed.vendor}, ${parsed.lines.length} lines, ${money(parsed.linesTotalMicros, parsed.currency)}, ${parsed.periodStart} to ${parsed.periodEnd}.`);
  for (const n of parsed.notes) lines.push(`  ${n}`);
  if (parsed.status === "sum_mismatch") lines.push(`The invoice is on hold and not counted until it is accepted: desk invoices accept ${stored.invoiceId} --reason "..." (or fix the file and import it again).`);
  else lines.push("Run desk invoices reconcile to compare it with the estimate.");
  return lines.join("\n");
}

function list(db: Ledger): string {
  const rows = listInvoices(db);
  if (rows.length === 0) return "No invoice imported. Import one with: desk invoices import <file.csv|file.pdf>. Until then every dollar is an estimate or the tool's own figure.";
  const out = [`${rows.length} invoice${rows.length === 1 ? "" : "s"}:`];
  for (const r of rows) out.push(`  ${r.invoiceId}  ${r.vendor.padEnd(10)} ${r.periodStart} to ${r.periodEnd}  ${money(r.linesTotalMicros, r.currency).padStart(12)}  ${String(r.lines).padStart(4)} lines  ${r.status}${r.invoiceNumber ? `  ${r.invoiceNumber}` : ""}  (${r.sourceName})`);
  return out.join("\n");
}

function line(r: PeriodReconciliation): string {
  const gap = r.gapMicros === null ? "" : `  gap ${r.gapMicros < 0 ? "-" : "+"}${money(Math.abs(r.gapMicros))}`;
  const rep = r.reportedMicros === null ? "" : `  reported ${money(r.reportedMicros)}`;
  return `  ${r.period}  ${r.vendor.padEnd(10)} billed ${money(r.billedMicros, r.currency).padStart(12)}  estimated ${money(r.estimatedMicros).padStart(12)}${rep}${gap}\n      ${r.status.toUpperCase()}: ${r.reason}`;
}

function reconcileText(db: Ledger, o: InvoiceCommandOptions): string {
  const rows = reconcileLedger(db, { ...(o.tolerancePct !== undefined ? { tolerancePct: o.tolerancePct } : {}), ...(o.now ? { now: o.now } : {}) });
  if (rows.length === 0) return "Nothing to reconcile: no calls and no invoices.";
  const out = [`Billed against estimated${rows.some((r) => r.reportedMicros !== null) ? " against reported" : ""}, per vendor and month (tolerance ${o.tolerancePct ?? 2}%, a parameter, not a claim of accuracy):`];
  for (const r of rows) out.push(line(r));
  const counts = { reconciled: 0, partial: 0, unreconciled: 0 };
  for (const r of rows) counts[r.status] += 1;
  out.push("", `${counts.reconciled} reconciled, ${counts.partial} partial, ${counts.unreconciled} unreconciled. The estimate is list price from logged tokens; the invoice is the authority where one exists.`);
  return out.join("\n");
}

function allocate(db: Ledger, o: InvoiceCommandOptions): string {
  if (!o.month || !/^\d{4}-\d{2}$/.test(o.month)) throw new Error("Use: desk invoices allocate --month YYYY-MM [--vendor V] [--by session|model|task]");
  const by = (o.by ?? "session") as AllocateBy;
  if (!["session", "model", "task"].includes(by)) throw new Error("--by must be session, model or task");
  const vendor = (o.vendor ?? "anthropic").toLowerCase();
  const a = allocateBilled(db, vendor, o.month, by);
  if (a === null) return `No imported USD invoice for ${vendor} in ${o.month}. Import one first.`;
  const out = [`${vendor}, ${o.month}: billed total ${money(a.billedMicros)}, allocated by estimate across ${a.parts.length} ${by}${a.parts.length === 1 ? "" : "s"} (the invoice does not say which ${by} cost what; only the estimate does):`];
  for (const p of a.parts.slice(0, 25)) out.push(`  ${p.key.slice(0, 44).padEnd(44)} estimate ${money(p.estimatedMicros).padStart(11)}  billed share ${money(p.billedMicros).padStart(11)}`);
  if (a.parts.length > 25) out.push(`  ... and ${a.parts.length - 25} more`);
  out.push(`The parts sum to ${money(a.parts.reduce((s, p) => s + p.billedMicros, 0))}, exactly the billed total.`);
  return out.join("\n");
}
