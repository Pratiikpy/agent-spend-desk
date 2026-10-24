import { createHash } from "node:crypto";

import { parseAmount } from "./amounts.ts";
import { parseCsv } from "./csv.ts";

/**
 * Read an invoice or a usage export into lines (DF-024). The reading is strict: every line keeps the place it came from,
 * every amount is read as exact micro-units, and a file that does not hold together (lines that do not add up to the
 * stated total, a currency the file never states, a date it cannot read) is reported as that, not repaired by a guess.
 */
export type InvoiceStatus = "imported" | "sum_mismatch" | "conflict";

export interface BilledLine {
  lineNo: number;
  /** The date the line is for, `YYYY-MM-DD`, when the file has one. */
  day: string | null;
  model: string | null;
  description: string;
  quantity: number | null;
  amountMicros: number;
  /** Where in the file the line is: `line 14` for a CSV, `page 1 line 6` for a PDF. */
  locator: string;
}

export interface ParsedInvoice {
  invoiceId: string;
  vendor: string;
  invoiceNumber: string | null;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  statedTotalMicros: number | null;
  linesTotalMicros: number;
  status: InvoiceStatus;
  /** Plain sentences about what the reading found: a mismatch, a skipped row, an assumption the person gave. */
  notes: string[];
  lines: BilledLine[];
  sourceName: string;
  sourceSha256: string;
}

export interface ImportOptions {
  vendor?: string;
  /** The currency to use when the file does not state one. */
  currency?: string;
  /** `YYYY-MM`, for a file whose lines carry no date. */
  period?: string;
  sourceName: string;
}

export class ImportError extends Error {}

const FIELDS = {
  day: ["date", "day", "usagedate", "usagedateutc", "billingdate", "startdate", "servicedate", "periodstart", "period"],
  model: ["model", "modelid", "modelname"],
  description: ["description", "item", "lineitem", "product", "usagetype", "service", "details", "memo", "name"],
  quantity: ["quantity", "qty", "tokens", "units", "usage"],
  amount: ["amount", "costusd", "cost", "netamount", "linetotal", "charge", "total", "net", "amountusd"],
  currency: ["currency", "cur"],
  invoice: ["invoicenumber", "invoiceid", "invoiceno", "invoice"],
} as const;

type Field = keyof typeof FIELDS;

const norm = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function mapColumns(header: string[]): Partial<Record<Field, number>> {
  const normalised = header.map(norm);
  const out: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(FIELDS) as Field[]) {
    for (const name of FIELDS[field]) {
      const at = normalised.indexOf(name);
      if (at >= 0) {
        out[field] = at;
        break;
      }
    }
  }
  return out;
}

/** A date written as `2026-10-03`, `2026-10-03T00:00:00Z` or `2026/10/03`, checked to be a real calendar day. */
export function parseDay(raw: string): string | null {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ].*)?$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const TOTAL_ROW = /^(grand\s+)?total(\s+due)?$|^amount\s+due$|^balance\s+due$|^total\s+amount$|^invoice\s+total$/i;
const SUBTOTAL_ROW = /^sub\s*-?\s*total$/i;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export function vendorOf(model: string | null, given: string | undefined): string | null {
  if (given !== undefined && given.trim() !== "") return given.trim().toLowerCase();
  if (model === null) return null;
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o\d|codex|chatgpt)/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "google";
  return null;
}

function finish(inv: Omit<ParsedInvoice, "invoiceId" | "linesTotalMicros" | "status">): ParsedInvoice {
  const linesTotal = inv.lines.reduce((s, l) => s + l.amountMicros, 0);
  const notes = [...inv.notes];
  let status: InvoiceStatus = "imported";
  if (inv.statedTotalMicros !== null && inv.statedTotalMicros !== linesTotal) {
    status = "sum_mismatch";
    notes.push(`The lines add up to ${fmt(linesTotal)} but the file states a total of ${fmt(inv.statedTotalMicros)}: ${fmt(Math.abs(linesTotal - inv.statedTotalMicros))} is unaccounted for. Nothing was changed to make them agree.`);
  } else if (inv.statedTotalMicros === null) notes.push("The file states no total, so there is no sum check.");
  return { ...inv, notes, linesTotalMicros: linesTotal, status, invoiceId: `inv-${inv.sourceSha256.slice(0, 16)}` };
}

const fmt = (micros: number): string => `${micros < 0 ? "-" : ""}${(Math.abs(micros) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

/** Read a CSV invoice or usage export. */
export function readCsvInvoice(text: string, opts: ImportOptions): ParsedInvoice {
  const records = parseCsv(text);
  const headerAt = records.findIndex((r) => r.fields.some((f) => FIELDS.amount.includes(norm(f) as never)));
  if (headerAt < 0) throw new ImportError("The file has no column that looks like an amount (amount, cost, cost_usd, total, charge).");
  const header = records[headerAt]!.fields;
  const col = mapColumns(header);
  if (col.amount === undefined) throw new ImportError("The file has no amount column.");
  const notes: string[] = [];
  const lines: BilledLine[] = [];
  const currencies = new Set<string>();
  let stated: number | null = null;
  let invoiceNumber: string | null = null;
  const amountHeader = norm(header[col.amount]!);
  const columnCurrency = amountHeader.endsWith("usd") ? "USD" : null;

  for (const rec of records.slice(headerAt + 1)) {
    const f = rec.fields;
    const cell = (c: number | undefined): string => (c === undefined ? "" : (f[c] ?? "").trim());
    if (f.every((x) => x.trim() === "")) continue;
    const description = cell(col.description) || cell(col.model);
    // A total or subtotal row may carry its label under any column (often the first, the date's).
    const label = f.map((x) => x.trim()).find((x) => TOTAL_ROW.test(x) || SUBTOTAL_ROW.test(x)) ?? description;
    const amount = parseAmount(cell(col.amount));
    if (amount === null) {
      if (cell(col.amount) === "" && description === "") continue;
      throw new ImportError(`line ${rec.line}: "${cell(col.amount)}" is not an amount this reader accepts (digits with an optional minus sign, a currency sign or code, commas for thousands and a point for decimals).`);
    }
    const rowCurrency = cell(col.currency).toUpperCase();
    const currency = amount.currency ?? (rowCurrency !== "" ? rowCurrency : columnCurrency);
    if (currency !== null) currencies.add(currency);
    const isSummary = TOTAL_ROW.test(label) || SUBTOTAL_ROW.test(label);
    const inv = isSummary ? "" : cell(col.invoice);
    if (inv !== "" && invoiceNumber === null) invoiceNumber = inv;
    if (inv !== "" && invoiceNumber !== null && inv !== invoiceNumber) throw new ImportError(`line ${rec.line}: the file mixes invoice numbers (${invoiceNumber} and ${inv}); import one invoice per file.`);
    if (TOTAL_ROW.test(label)) {
      if (stated !== null) throw new ImportError(`line ${rec.line}: the file states a total twice.`);
      stated = amount.micros;
      continue;
    }
    if (SUBTOTAL_ROW.test(label)) {
      notes.push(`line ${rec.line}: a subtotal row was left out of the lines.`);
      continue;
    }
    const dayRaw = cell(col.day);
    const day = dayRaw === "" ? null : parseDay(dayRaw);
    if (dayRaw !== "" && day === null && col.day !== undefined && norm(header[col.day]!) !== "period") throw new ImportError(`line ${rec.line}: "${dayRaw}" is not a date (use YYYY-MM-DD).`);
    const qty = cell(col.quantity) === "" ? null : Number(cell(col.quantity).replace(/,/g, ""));
    lines.push({
      lineNo: lines.length + 1,
      day,
      model: cell(col.model) || null,
      description: description || "(no description)",
      quantity: qty !== null && Number.isFinite(qty) ? qty : null,
      amountMicros: amount.micros,
      locator: `line ${rec.line}`,
    });
  }
  if (lines.length === 0) throw new ImportError("The file has an amount column but no lines.");
  if (currencies.size > 1) throw new ImportError(`The file mixes currencies (${[...currencies].sort().join(", ")}). Nothing is converted: import one currency per file.`);
  let currency = [...currencies][0] ?? opts.currency?.toUpperCase() ?? null;
  if (currency === null) throw new ImportError("The file does not state its currency anywhere. Say it with --currency (for example --currency USD).");
  if (opts.currency !== undefined && currencies.size === 1 && currency !== opts.currency.toUpperCase()) throw new ImportError(`The file says ${currency} but --currency says ${opts.currency.toUpperCase()}.`);
  currency = currency.toUpperCase();

  const vendor = vendorOf(lines.find((l) => l.model !== null)?.model ?? null, opts.vendor);
  if (vendor === null) throw new ImportError("The file does not say which vendor it is from. Say it with --vendor (for example --vendor anthropic).");

  const days = lines.map((l) => l.day).filter((d): d is string => d !== null).sort();
  let periodStart = days[0] ?? null;
  let periodEnd = days[days.length - 1] ?? null;
  if (opts.period !== undefined) {
    const p = /^(\d{4})-(\d{2})$/.exec(opts.period);
    if (!p) throw new ImportError("--period must be a month such as 2026-10.");
    const last = new Date(Date.UTC(Number(p[1]), Number(p[2]), 0)).getUTCDate();
    periodStart = `${opts.period}-01`;
    periodEnd = `${opts.period}-${String(last).padStart(2, "0")}`;
    notes.push(`The period ${opts.period} was given, not read from the file.`);
  }
  if (periodStart === null || periodEnd === null) throw new ImportError("No line has a date, so the invoice cannot be placed in a month. Say which with --period (for example --period 2026-10).");

  return finish({ vendor, invoiceNumber, currency, periodStart, periodEnd, statedTotalMicros: stated, notes, lines, sourceName: opts.sourceName, sourceSha256: sha256(text) });
}

/** Lines already extracted from a PDF (two independent extractions that agreed), turned into an invoice. */
export function invoiceFromExtractedLines(
  rows: { description: string; amountMicros: number; locator: string }[],
  opts: ImportOptions & { sourceSha256: string },
): ParsedInvoice {
  let stated: number | null = null;
  const lines: BilledLine[] = [];
  const notes: string[] = [];
  for (const r of rows) {
    if (TOTAL_ROW.test(r.description.trim())) {
      stated = r.amountMicros;
      continue;
    }
    if (SUBTOTAL_ROW.test(r.description.trim())) {
      notes.push(`${r.locator}: a subtotal row was left out of the lines.`);
      continue;
    }
    const model = /\bclaude[-\w.]*/i.exec(r.description)?.[0] ?? null;
    lines.push({ lineNo: lines.length + 1, day: null, model, description: r.description, quantity: null, amountMicros: r.amountMicros, locator: r.locator });
  }
  if (lines.length === 0) throw new ImportError("No line with an amount was found in the PDF.");
  if (opts.currency === undefined) throw new ImportError("A PDF does not state its currency in a way this reader trusts. Say it with --currency (for example --currency USD).");
  const vendor = vendorOf(lines.find((l) => l.model !== null)?.model ?? null, opts.vendor);
  if (vendor === null) throw new ImportError("The PDF does not say which vendor it is from. Say it with --vendor.");
  if (opts.period === undefined) throw new ImportError("A PDF's dates are not read. Say which month it covers with --period (for example --period 2026-10).");
  const p = /^(\d{4})-(\d{2})$/.exec(opts.period);
  if (!p) throw new ImportError("--period must be a month such as 2026-10.");
  const last = new Date(Date.UTC(Number(p[1]), Number(p[2]), 0)).getUTCDate();
  notes.push(`The period ${opts.period} was given, not read from the PDF.`);
  return finish({
    vendor, invoiceNumber: null, currency: opts.currency.toUpperCase(), periodStart: `${opts.period}-01`, periodEnd: `${opts.period}-${String(last).padStart(2, "0")}`,
    statedTotalMicros: stated, notes, lines, sourceName: opts.sourceName, sourceSha256: opts.sourceSha256,
  });
}
