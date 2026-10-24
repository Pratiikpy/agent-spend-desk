import type { Ledger } from "../ledger/db.ts";
import { splitProportional } from "../money.ts";
import { vendorOf } from "./import.ts";

/**
 * Billed against estimated against reported, per vendor and month (DF-027). The estimate is the Desk's list-price figure from
 * logged tokens; the billed figure is what an imported invoice says; the reported figure is what the tool recorded for
 * itself. They are shown side by side and never merged. A month is `reconciled` only when an invoice covers all of it, the
 * models on the invoice are the models in the ledger, and the two totals are within the tolerance (2% by default, a
 * parameter shown on screen, not a claim of accuracy). Anything less is `partial` or `unreconciled`, with the reason.
 */
export type ReconStatus = "reconciled" | "partial" | "unreconciled";

export interface PeriodReconciliation {
  vendor: string;
  period: string;
  currency: string;
  billedMicros: number | null;
  estimatedMicros: number;
  reportedMicros: number | null;
  gapMicros: number | null;
  status: ReconStatus;
  reason: string;
  /** Billed dollars for a model the ledger has no spend for, and estimated dollars for a model the invoice does not list. */
  unmatchedBilledMicros: number;
  unmatchedEstimatedMicros: number;
  invoices: string[];
}

export interface ReconcileOptions {
  /** Percent of the billed total the estimate may differ by; default 2. */
  tolerancePct?: number;
  now?: Date;
}

const normModel = (m: string): string => m.trim().toLowerCase().replace(/-\d{8}$/, "");

interface Billed {
  micros: number;
  byModel: Map<string, number>;
  withModels: boolean;
  invoices: Set<string>;
  currencies: Set<string>;
  covered: { start: string; end: string }[];
}

const lastDayOf = (period: string): string => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Reconcile and keep the result in the `reconciliation` table, replacing what was there. */
export function reconcileLedger(db: Ledger, opts: ReconcileOptions = {}): PeriodReconciliation[] {
  const out = computeReconciliations(db, opts);
  const at = (opts.now ?? new Date()).toISOString();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM reconciliation");
    const put = db.prepare(
      `INSERT INTO reconciliation (vendor, period, currency, billed_micros, estimated_micros, reported_micros, gap_micros, status, reason, unmatched_billed_micros, unmatched_estimated_micros, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of out) put.run(r.vendor, r.period, r.currency, r.billedMicros, r.estimatedMicros, r.reportedMicros, r.gapMicros, r.status, r.reason, r.unmatchedBilledMicros, r.unmatchedEstimatedMicros, at);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return out;
}

/** The reconciliation itself, read-only: the screens use it so they can show it from a ledger they cannot write to. */
export function computeReconciliations(db: Ledger, opts: ReconcileOptions = {}): PeriodReconciliation[] {
  const tol = (opts.tolerancePct ?? 2) / 100;

  // What the ledger estimates, per vendor, month and model.
  const est = new Map<string, Map<string, number>>();
  const unpriced = new Map<string, number>();
  const rows = db
    .prepare(
      `SELECT substr(m.ts, 1, 7) period, m.model model, SUM(c.total_micros) micros, SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) unpriced
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id GROUP BY period, m.model`,
    )
    .all() as unknown as { period: string; model: string; micros: number | null; unpriced: number }[];
  for (const r of rows) {
    const vendor = vendorOf(r.model, undefined);
    if (vendor === null) continue;
    const key = `${vendor}|${r.period}`;
    const byModel = est.get(key) ?? new Map<string, number>();
    byModel.set(normModel(r.model), (byModel.get(normModel(r.model)) ?? 0) + (r.micros ?? 0));
    est.set(key, byModel);
    unpriced.set(key, (unpriced.get(key) ?? 0) + r.unpriced);
  }

  // What the tool reported for itself: only Claude Code writes it, so it belongs to the vendor anthropic.
  const reported = new Map<string, number>();
  const hasReported = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'reported_cost'").get() as { n: number }).n > 0;
  if (hasReported) {
    for (const r of db.prepare("SELECT substr(observed_ts, 1, 7) period, SUM(total_micros) micros FROM reported_cost WHERE observed_ts IS NOT NULL GROUP BY period").all() as unknown as { period: string; micros: number }[]) {
      reported.set(`anthropic|${r.period}`, r.micros);
    }
  }

  // What the invoices say, per vendor and month. A hold (lines that do not sum) is left out until the person accepts it.
  const billed = new Map<string, Billed>();
  const holds = new Map<string, string[]>();
  const lines = db
    .prepare(
      `SELECT i.invoice_id id, i.vendor, i.currency, i.period_start ps, i.period_end pe, i.status, b.day, b.model, b.amount_micros micros
       FROM invoice i JOIN billed_line b ON b.invoice_id = i.invoice_id`,
    )
    .all() as unknown as { id: string; vendor: string; currency: string; ps: string; pe: string; status: string; day: string | null; model: string | null; micros: number }[];
  for (const l of lines) {
    const period = (l.day ?? l.ps).slice(0, 7);
    const key = `${l.vendor}|${period}`;
    if (l.status !== "imported") {
      const h = holds.get(key) ?? [];
      if (!h.includes(l.id)) h.push(l.id);
      holds.set(key, h);
      continue;
    }
    const b: Billed = billed.get(key) ?? { micros: 0, byModel: new Map(), withModels: false, invoices: new Set(), currencies: new Set(), covered: [] };
    b.micros += l.micros;
    if (l.model !== null) {
      b.withModels = true;
      b.byModel.set(normModel(l.model), (b.byModel.get(normModel(l.model)) ?? 0) + l.micros);
    }
    b.invoices.add(l.id);
    b.currencies.add(l.currency);
    if (!b.covered.some((c) => c.start === l.ps && c.end === l.pe)) b.covered.push({ start: l.ps, end: l.pe });
    billed.set(key, b);
  }

  const out: PeriodReconciliation[] = [];
  const keys = new Set([...est.keys(), ...billed.keys(), ...holds.keys()]);
  for (const key of [...keys].sort()) {
    const [vendor, period] = key.split("|") as [string, string];
    const estByModel = est.get(key) ?? new Map<string, number>();
    const estimated = [...estByModel.values()].reduce((a, b) => a + b, 0);
    const b = billed.get(key);
    const rep = reported.get(key) ?? null;
    const base = { vendor, period, estimatedMicros: estimated, reportedMicros: rep, unmatchedBilledMicros: 0, unmatchedEstimatedMicros: 0 };
    const held = holds.get(key);
    if (b === undefined) {
      out.push({
        ...base, currency: "USD", billedMicros: null, gapMicros: null, status: "unreconciled", invoices: [],
        reason: held ? `an invoice for this month is on hold because its lines do not add up to its stated total (${held.join(", ")}); accept it or fix the file` : "no invoice has been imported for this month",
      });
      continue;
    }
    if (b.currencies.size > 1 || !b.currencies.has("USD")) {
      const cur = [...b.currencies].sort().join(" and ");
      out.push({ ...base, currency: cur, billedMicros: b.micros, gapMicros: null, status: "unreconciled", invoices: [...b.invoices], reason: `the invoice is in ${cur} and the estimate is in USD; nothing is converted, so they are not compared` });
      continue;
    }
    // Coverage: every day of the month must lie inside an invoice's period.
    const first = `${period}-01`;
    const last = lastDayOf(period);
    const full = b.covered.some((c) => c.start <= first && c.end >= last);
    let unmatchedBilled = 0;
    let unmatchedEstimated = 0;
    if (b.withModels) {
      for (const [m, v] of b.byModel) if (!estByModel.has(m) || (estByModel.get(m) ?? 0) === 0) unmatchedBilled += v;
      for (const [m, v] of estByModel) if (v > 0 && !b.byModel.has(m)) unmatchedEstimated += v;
    }
    const gap = b.micros - estimated;
    const ratio = b.micros === 0 ? (estimated === 0 ? 0 : 1) : Math.abs(gap) / Math.abs(b.micros);
    const unp = unpriced.get(key) ?? 0;
    let status: ReconStatus;
    let reason: string;
    if (ratio > tol) {
      status = "unreconciled";
      reason = `the estimate differs from the invoice by ${(ratio * 100).toFixed(1)}%, more than the ${(tol * 100).toFixed(0)}% tolerance${unp > 0 ? `; ${unp} call${unp === 1 ? "" : "s"} in the month have no price and are not in the estimate` : ""}`;
    } else if (!full) {
      status = "partial";
      reason = `the totals agree within ${(tol * 100).toFixed(0)}%, but the invoice covers ${b.covered.map((c) => `${c.start} to ${c.end}`).join(" and ")}, not the whole month`;
    } else if (unmatchedBilled !== 0 || unmatchedEstimated !== 0) {
      status = "partial";
      reason = `the totals agree within ${(tol * 100).toFixed(0)}%, but the models on the invoice and in the ledger do not match line for line`;
    } else {
      status = "reconciled";
      reason = `within ${(tol * 100).toFixed(0)}% of the invoice, the whole month covered`;
    }
    out.push({ ...base, currency: "USD", billedMicros: b.micros, gapMicros: gap, status, reason, unmatchedBilledMicros: unmatchedBilled, unmatchedEstimatedMicros: unmatchedEstimated, invoices: [...b.invoices] });
  }

  return out;
}

export type AllocateBy = "session" | "model" | "task";

export interface Allocation {
  key: string;
  estimatedMicros: number;
  billedMicros: number;
}

/**
 * The month's billed total, split across sessions, models or tasks in proportion to their estimates, so that the parts sum to the
 * billed total exactly (largest remainder). It is labelled "billed total, allocated by estimate" wherever it is shown: the invoice
 * does not say which session cost what, only the estimate does.
 */
export function allocateBilled(db: Ledger, vendor: string, period: string, by: AllocateBy): { billedMicros: number; parts: Allocation[] } | null {
  const total = db
    .prepare(
      `SELECT SUM(b.amount_micros) micros FROM billed_line b JOIN invoice i ON i.invoice_id = b.invoice_id
       WHERE i.vendor = ? AND i.status = 'imported' AND i.currency = 'USD' AND substr(COALESCE(b.day, i.period_start), 1, 7) = ?`,
    )
    .get(vendor, period) as { micros: number | null };
  if (total.micros === null) return null;
  const totalMicros = total.micros;
  const keyExpr = by === "session" ? "m.session_id" : by === "model" ? "m.model" : "COALESCE(ts.task_id, 'session:' || m.session_id)";
  const join = by === "task" ? "LEFT JOIN task_session ts ON ts.session_id = m.session_id" : "";
  const rows = (
    db
      .prepare(
        `SELECT ${keyExpr} key, m.model model, SUM(c.total_micros) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' ${join}
         WHERE substr(m.ts, 1, 7) = ? GROUP BY key, m.model`,
      )
      .all(period) as unknown as { key: string; model: string; micros: number }[]
  ).filter((r) => vendorOf(r.model, undefined) === vendor);
  const grouped = new Map<string, number>();
  for (const r of rows) grouped.set(r.key, (grouped.get(r.key) ?? 0) + r.micros);
  const keys = [...grouped.keys()].sort();
  const weights = keys.map((k) => grouped.get(k)!);
  if (weights.reduce((a, b) => a + b, 0) === 0) return { billedMicros: totalMicros, parts: [] };
  // A credit (negative total) is split on its magnitude and given back its sign.
  const parts = splitProportional(Math.abs(totalMicros), weights).map((p) => (totalMicros < 0 ? -p : p));
  return { billedMicros: totalMicros, parts: keys.map((key, i) => ({ key, estimatedMicros: weights[i]!, billedMicros: parts[i]! })).sort((a, b) => b.billedMicros - a.billedMicros) };
}
