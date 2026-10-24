import type { Ledger } from "../ledger/db.ts";
import type { ParsedInvoice } from "./import.ts";

export interface StoredInvoice {
  invoiceId: string;
  vendor: string;
  invoiceNumber: string | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  statedTotalMicros: number | null;
  linesTotalMicros: number;
  status: "imported" | "sum_mismatch" | "conflict";
  notes: string[];
  sourceName: string;
  lines: number;
  importedAt: string;
}

export type StoreOutcome =
  | { kind: "stored"; invoiceId: string }
  | { kind: "already_imported"; invoiceId: string }
  | { kind: "number_conflict"; existing: string; invoiceNumber: string };

/**
 * Keep an invoice and its lines. The same file twice is recognised by its hash and changes nothing. A different file that
 * carries the same vendor and invoice number is a conflict, not a replacement: the person decides which one stands.
 */
export function storeInvoice(db: Ledger, inv: ParsedInvoice, now: Date = new Date()): StoreOutcome {
  const same = db.prepare("SELECT invoice_id FROM invoice WHERE invoice_id = ?").get(inv.invoiceId) as { invoice_id: string } | undefined;
  if (same) return { kind: "already_imported", invoiceId: same.invoice_id };
  if (inv.invoiceNumber !== null) {
    const other = db.prepare("SELECT invoice_id FROM invoice WHERE vendor = ? AND invoice_number = ?").get(inv.vendor, inv.invoiceNumber) as { invoice_id: string } | undefined;
    if (other) return { kind: "number_conflict", existing: other.invoice_id, invoiceNumber: inv.invoiceNumber };
  }
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO invoice (invoice_id, vendor, invoice_number, currency, period_start, period_end, stated_total_micros, lines_total_micros, status, notes, source_name, source_sha256, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(inv.invoiceId, inv.vendor, inv.invoiceNumber, inv.currency, inv.periodStart!, inv.periodEnd!, inv.statedTotalMicros, inv.linesTotalMicros, inv.status, JSON.stringify(inv.notes), inv.sourceName, inv.sourceSha256, now.toISOString());
    const add = db.prepare("INSERT INTO billed_line (invoice_id, line_no, day, model, description, quantity, amount_micros, locator) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const l of inv.lines) add.run(inv.invoiceId, l.lineNo, l.day, l.model, l.description, l.quantity, l.amountMicros, l.locator);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { kind: "stored", invoiceId: inv.invoiceId };
}

export function listInvoices(db: Ledger): StoredInvoice[] {
  const rows = db
    .prepare(
      `SELECT i.invoice_id id, i.vendor, i.invoice_number num, i.currency, i.period_start ps, i.period_end pe, i.stated_total_micros st, i.lines_total_micros lt, i.status, i.notes,
              i.source_name src, i.imported_at at, (SELECT COUNT(*) FROM billed_line b WHERE b.invoice_id = i.invoice_id) lines
       FROM invoice i ORDER BY i.period_start, i.invoice_id`,
    )
    .all() as unknown as { id: string; vendor: string; num: string | null; currency: string; ps: string; pe: string; st: number | null; lt: number; status: StoredInvoice["status"]; notes: string; src: string; at: string; lines: number }[];
  return rows.map((r) => ({ invoiceId: r.id, vendor: r.vendor, invoiceNumber: r.num, currency: r.currency, periodStart: r.ps, periodEnd: r.pe, statedTotalMicros: r.st, linesTotalMicros: r.lt, status: r.status, notes: JSON.parse(r.notes) as string[], sourceName: r.src, lines: r.lines, importedAt: r.at }));
}

/** Remove an invoice and its lines. Reconciliations are computed again from what remains. */
export function removeInvoice(db: Ledger, invoiceId: string): boolean {
  db.exec("PRAGMA foreign_keys = ON");
  return Number(db.prepare("DELETE FROM invoice WHERE invoice_id = ?").run(invoiceId).changes) > 0;
}

/** Accept an invoice whose lines did not add up to its stated total, on the person's say-so, with the reason kept beside it. */
export function acceptInvoice(db: Ledger, invoiceId: string, reason: string, now: Date = new Date()): boolean {
  const row = db.prepare("SELECT status, notes, stated_total_micros st, lines_total_micros lt FROM invoice WHERE invoice_id = ?").get(invoiceId) as { status: string; notes: string; st: number | null; lt: number } | undefined;
  if (!row || row.status !== "sum_mismatch") return false;
  const notes = [...(JSON.parse(row.notes) as string[]), `Accepted on ${now.toISOString().slice(0, 10)} although the lines differ from the stated total by ${Math.abs(row.lt - (row.st ?? 0)) / 1_000_000}: ${reason}`];
  db.prepare("UPDATE invoice SET status = 'imported', notes = ? WHERE invoice_id = ?").run(JSON.stringify(notes), invoiceId);
  return true;
}
