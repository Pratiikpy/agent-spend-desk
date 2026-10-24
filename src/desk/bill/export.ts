import { vendorOf } from "../billing/import.ts";
import type { Ledger } from "../ledger/db.ts";
import { projectName } from "../ui/queries.ts";

/** One row of the bill's export: a day, a project, a model and a landing state, with the tokens and the dollars and what kind of figure the dollars are. */
export interface BillLine {
  class: "estimated" | "unpriced" | "billed";
  day: string;
  vendor: string;
  project: string;
  model: string;
  landing: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  currency: string;
  /** Millionths of the currency. Null for a call with no price: tokens are counted and no dollars are invented. */
  amountMicros: number | null;
  snapshot: string;
  note: string;
}

const has = (db: Ledger, name: string): boolean => ((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { n: number }).n ?? 0) > 0;

/** The bill as rows. Estimated and unpriced rows come from the calls; billed rows come from the imported invoices that fall in the period. */
export function billLines(db: Ledger, sinceIso: string, untilIso: string): BillLine[] {
  const rows = db
    .prepare(
      `SELECT substr(m.ts, 1, 10) day, s.project_path path, COALESCE(m.model, '') model, COALESCE(o.state, 'unlinked') landing, c.class cls, COALESCE(c.snapshot_id, '') snap,
              COUNT(*) calls, SUM(COALESCE(m.input_tokens, 0)) i, SUM(COALESCE(m.output_tokens, 0)) o, SUM(COALESCE(m.cache_read_tokens, 0)) cr,
              SUM(COALESCE(m.cache_write_5m_tokens, 0) + COALESCE(m.cache_write_1h_tokens, 0)) cw, SUM(COALESCE(c.total_micros, 0)) micros
       FROM model_call m JOIN session s ON s.session_id = m.session_id JOIN cost_event c ON c.call_id = m.call_id AND c.class IN ('estimated', 'unpriced')
       LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts <= ? GROUP BY day, s.project_path, m.model, landing, c.class, snap`,
    )
    .all(sinceIso, untilIso) as unknown as { day: string; path: string | null; model: string; landing: string; cls: "estimated" | "unpriced"; snap: string; calls: number; i: number; o: number; cr: number; cw: number; micros: number }[];
  const merged = new Map<string, BillLine>();
  for (const r of rows) {
    const project = projectName(r.path);
    const key = [r.day, project, r.model, r.landing, r.cls, r.snap].join("|");
    const priced = r.cls === "estimated";
    const prev = merged.get(key);
    if (prev) {
      prev.calls += r.calls;
      prev.inputTokens += r.i;
      prev.outputTokens += r.o;
      prev.cacheReadTokens += r.cr;
      prev.cacheWriteTokens += r.cw;
      if (priced) prev.amountMicros = (prev.amountMicros ?? 0) + r.micros;
    } else {
      merged.set(key, {
        class: r.cls, day: r.day, vendor: vendorOf(r.model, undefined) ?? "", project, model: r.model, landing: r.landing, calls: r.calls, inputTokens: r.i, outputTokens: r.o, cacheReadTokens: r.cr, cacheWriteTokens: r.cw,
        currency: "USD", amountMicros: priced ? r.micros : null, snapshot: r.snap, note: priced ? "" : "no price for this model: tokens counted, no dollars invented",
      });
    }
  }
  const lines = [...merged.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.project < b.project ? -1 : a.project > b.project ? 1 : a.model < b.model ? -1 : a.model > b.model ? 1 : a.landing < b.landing ? -1 : 1));

  const billed: BillLine[] = [];
  if (has(db, "invoice") && has(db, "billed_line")) {
    const inv = db
      .prepare(
        `SELECT i.vendor vendor, COALESCE(b.day, i.period_start) day, COALESCE(b.model, '') model, i.currency currency, b.amount_micros micros, b.description description
         FROM billed_line b JOIN invoice i ON i.invoice_id = b.invoice_id WHERE i.status = 'imported' AND COALESCE(b.day, i.period_start) >= ? AND COALESCE(b.day, i.period_start) <= ?
         ORDER BY i.vendor, day, model, b.line_no`,
      )
      .all(sinceIso.slice(0, 10), untilIso.slice(0, 10)) as unknown as { vendor: string; day: string; model: string; currency: string; micros: number; description: string }[];
    for (const r of inv) {
      billed.push({ class: "billed", day: r.day, vendor: r.vendor, project: "", model: r.model, landing: "", calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, currency: r.currency, amountMicros: r.micros, snapshot: "", note: r.description });
    }
  }
  // The spec's order of headline classes: billed first, then what the calls say.
  return [...billed, ...lines];
}

const COLUMNS = ["class", "day", "vendor", "project", "model", "landing_state", "calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "currency", "amount_micros", "amount", "snapshot", "note"] as const;

/**
 * A cell that a spreadsheet would read as a formula is made plain text by a leading apostrophe, so a project or model name taken from a
 * log cannot run anything when the file is opened. Quotes, commas and line breaks are quoted the usual way.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(lines: readonly BillLine[]): string {
  const head = COLUMNS.join(",");
  const body = lines.map((l) =>
    [l.class, l.day, l.vendor, l.project, l.model, l.landing, l.calls, l.inputTokens, l.outputTokens, l.cacheReadTokens, l.cacheWriteTokens, l.currency, l.amountMicros, l.amountMicros === null ? null : (l.amountMicros / 1e6).toFixed(6), l.snapshot, l.note]
      .map((v) => csvCell(v as string | number | null))
      .join(","),
  );
  return `${[head, ...body].join("\r\n")}\r\n`;
}
