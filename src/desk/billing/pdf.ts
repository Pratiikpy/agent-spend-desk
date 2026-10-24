import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { parseAmount } from "./amounts.ts";
import { ImportError, invoiceFromExtractedLines, type ImportOptions, type ParsedInvoice } from "./import.ts";

/**
 * An invoice PDF, read twice by independent routes and trusted only where the two agree (DF-024). The text comes from
 * `pdftotext` (poppler) in a throwaway folder, with no shell, a time limit, a size limit and an environment that holds
 * nothing but the program path: a hostile PDF can waste thirty seconds, not reach a secret or the network the person
 * is on. The two routes are layout mode and raw mode. Every line that ends in an amount is read from each, and the two lists of
 * amounts must be the same. If they are not, the PDF is a conflict, listed line by line, and no line is stored: a
 * figure the two readings disagree on is not guessed.
 */
export type PdfTool = (args: string[], pdfPath: string) => string;

const LINE_WITH_AMOUNT = /^(.*?)\s+((?:[-(]\s?)?(?:[$€£]\s?)?\d[\d,]*\.\d{2}\)?)\s*$/;

export interface PdfLine {
  description: string;
  amountMicros: number;
  locator: string;
}

export function linesFromText(text: string): PdfLine[] {
  const out: PdfLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = LINE_WITH_AMOUNT.exec(raw.trim());
    if (!m) return;
    const a = parseAmount(m[2]!);
    if (a === null) return;
    out.push({ description: m[1]!.trim().replace(/\s{2,}/g, " ") || "(no description)", amountMicros: a.micros, locator: `line ${i + 1}` });
  });
  return out;
}

export type PdfReading =
  | { kind: "agreed"; lines: PdfLine[] }
  | { kind: "conflict"; onlyLayout: number[]; onlyRaw: number[] }
  | { kind: "no_lines" };

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

/** Compare two readings: the same multiset of amounts, or the amounts each has that the other does not. */
export function compareReadings(layout: PdfLine[], raw: PdfLine[]): PdfReading {
  if (layout.length === 0 && raw.length === 0) return { kind: "no_lines" };
  const a = sorted(layout.map((l) => l.amountMicros));
  const b = sorted(raw.map((l) => l.amountMicros));
  if (a.length === b.length && a.every((v, i) => v === b[i])) return { kind: "agreed", lines: layout };
  const count = (xs: number[]): Map<number, number> => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<number, number>());
  const ca = count(a);
  const cb = count(b);
  const diff = (x: Map<number, number>, y: Map<number, number>): number[] => {
    const out: number[] = [];
    for (const [k, n] of x) for (let i = 0; i < n - (y.get(k) ?? 0); i += 1) out.push(k);
    return out.sort((p, q) => p - q);
  };
  return { kind: "conflict", onlyLayout: diff(ca, cb), onlyRaw: diff(cb, ca) };
}

/** Find `pdftotext`: on PATH, or in the poppler folder winget installs on Windows. */
export function findPdftotext(env: Record<string, string | undefined> = process.env): string | null {
  const names = process.platform === "win32" ? ["pdftotext.exe"] : ["pdftotext"];
  for (const dir of (env["PATH"] ?? env["Path"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}

/** The default tool: pdftotext in a throwaway folder, with the limits above. */
export function pdftotextTool(exe: string): PdfTool {
  return (args, pdfPath) => {
    const dir = mkdtempSync(join(tmpdir(), "desk-pdf-"));
    try {
      const r = spawnSync(exe, [...args, pdfPath, "-"], { cwd: dir, encoding: "utf8", timeout: 30_000, maxBuffer: 20 * 1024 * 1024, env: { PATH: env0(exe) }, shell: false, windowsHide: true });
      if (r.error) throw new ImportError(`pdftotext could not read the PDF: ${r.error.message}`);
      if (r.status !== 0) throw new ImportError(`pdftotext could not read the PDF (exit ${r.status}): ${r.stderr.trim().slice(0, 200)}`);
      return r.stdout;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const env0 = (exe: string): string => exe.slice(0, Math.max(exe.lastIndexOf("/"), exe.lastIndexOf("\\")));

export interface PdfImport {
  invoice: ParsedInvoice | null;
  reading: PdfReading;
}

/** Read a PDF invoice with two extractions. A conflict returns no invoice and says which amounts disagree. */
export function readPdfInvoice(path: string, opts: ImportOptions, tool: PdfTool): PdfImport {
  const layout = linesFromText(tool(["-layout", "-nopgbrk"], path));
  const raw = linesFromText(tool(["-raw", "-nopgbrk"], path));
  const reading = compareReadings(layout, raw);
  if (reading.kind === "no_lines") throw new ImportError("No line ending in an amount was found in the PDF. If it is a scan, it has no text to read; export the invoice as CSV instead.");
  if (reading.kind === "conflict") return { invoice: null, reading };
  const sourceSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { invoice: invoiceFromExtractedLines(reading.lines, { ...opts, sourceSha256 }), reading };
}
