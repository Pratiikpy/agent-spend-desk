import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeReconciliations } from "../billing/reconcile.ts";
import type { ClaimInput, DossierInput, SentenceInput } from "../dossier/build.ts";
import type { Signer } from "../dossier/keys.ts";
import { MemoryLog } from "../dossier/log.ts";
import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { parseSnapshot, resolvePrice, type PriceSnapshot } from "../pricing/pricebook.ts";
import type { Row } from "../verify/format.ts";

/**
 * The month bill as a signed dossier (DF-012). Every figure in it is a computation over rows that a stranger holds:
 * one row per day, model, price tier, speed, geography and landing state, holding the summed tokens of the calls
 * and the cost the ledger recorded for them. The verifier recomputes each row's cost from the tokens and the pinned
 * price snapshot, to within the rounding half a micro-dollar per call allows, and adds the rows up.
 */
export interface MonthSpan {
  label: string;
  /** Inclusive start and exclusive end, ISO timestamps (UTC). */
  since: string;
  until: string;
  firstDay: string;
  lastDay: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthLabel(s: string): boolean {
  return MONTH.test(s);
}

export function monthSpan(label: string): MonthSpan {
  const m = MONTH.exec(label);
  if (!m) throw new RangeError(`"${label}" is not a month; write it as 2026-09`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = Date.UTC(y, mo - 1, 1);
  const next = Date.UTC(y, mo, 1);
  return { label, since: new Date(start).toISOString(), until: new Date(next).toISOString(), firstDay: new Date(start).toISOString().slice(0, 10), lastDay: new Date(next - 86_400_000).toISOString().slice(0, 10) };
}

/** The last month that has ended, in UTC. */
export function lastCompleteMonth(now: Date): string {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return prev.toISOString().slice(0, 7);
}

/** Every price snapshot a folder holds, by id. A file that is not a snapshot is skipped, so the folder may hold supplements. */
export function snapshotsFromDir(dir: string): Map<string, PriceSnapshot> {
  const out = new Map<string, PriceSnapshot>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const s = parseSnapshot(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!out.has(s.snapshotId)) out.set(s.snapshotId, s);
    } catch {
      // not a snapshot
    }
  }
  return out;
}

export interface CostRow {
  day: string;
  model: string;
  snapshot_id: string;
  speed: string;
  inference_geo: string;
  tier: "std" | "long";
  priced: boolean;
  landing: string;
  weak: boolean;
  class: "estimated" | "unpriced";
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cost_micros: number;
}

export interface BilledRow {
  vendor: string;
  day: string;
  model: string;
  currency: string;
  amount_micros: number;
  class: "billed";
}

export interface ReconRow {
  vendor: string;
  period: string;
  status: string;
  has_invoice: boolean;
  billed_micros: number;
  estimated_micros: number;
  class: "computed";
}

export interface MonthRows {
  span: MonthSpan;
  cost: CostRow[];
  billed: BilledRow[];
  reconciliation: ReconRow[];
  /** Why a bill cannot be built from this ledger, one line each; empty when it can. */
  problems: string[];
}

const has = (db: Ledger, name: string): boolean => ((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { n: number }).n ?? 0) > 0;

/** Read the month from the ledger as the rows a dossier cites. Reads only. */
export function readMonthRows(db: Ledger, label: string, snapshots: ReadonlyMap<string, PriceSnapshot>, live: PriceSnapshot): MonthRows {
  const span = monthSpan(label);
  const problems: string[] = [];
  const raw = db
    .prepare(
      `SELECT substr(m.ts, 1, 10) day, COALESCE(m.model, '') model, c.snapshot_id snap, COALESCE(m.speed, '') speed, COALESCE(m.inference_geo, '') geo,
              CASE WHEN c.rule_ids LIKE '%"long_prompt"%' THEN 'long' ELSE 'std' END tier, c.class cls,
              COALESCE(o.state, 'unlinked') landing, CASE WHEN o.best_confidence = 'low' THEN 1 ELSE 0 END weak,
              COUNT(*) calls, SUM(COALESCE(m.input_tokens, 0)) i, SUM(COALESCE(m.output_tokens, 0)) o, SUM(COALESCE(m.cache_read_tokens, 0)) cr,
              SUM(COALESCE(m.cache_write_5m_tokens, 0)) w5, SUM(COALESCE(m.cache_write_1h_tokens, 0)) w1, SUM(COALESCE(c.total_micros, 0)) cost
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class IN ('estimated', 'unpriced')
       LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts < ?
       GROUP BY day, model, snap, speed, geo, tier, cls, landing, weak ORDER BY day, model, landing, weak, speed, geo, tier, snap`,
    )
    .all(span.since, span.until) as unknown as { day: string; model: string; snap: string | null; speed: string; geo: string; tier: "std" | "long"; cls: "estimated" | "unpriced"; landing: string; weak: number; calls: number; i: number; o: number; cr: number; w5: number; w1: number; cost: number }[];

  const missing = new Set<string>();
  const cost: CostRow[] = raw.map((r) => {
    const priced = r.cls === "estimated";
    const snapshot_id = r.snap ?? live.snapshotId;
    if (!snapshots.has(snapshot_id)) missing.add(snapshot_id);
    return {
      day: r.day, model: r.model, snapshot_id, speed: r.speed, inference_geo: r.geo, tier: priced ? r.tier : "std", priced, landing: r.landing, weak: r.weak === 1, class: r.cls,
      calls: r.calls, input_tokens: r.i, output_tokens: r.o, cache_read_tokens: r.cr, cache_write_5m_tokens: r.w5, cache_write_1h_tokens: r.w1, cost_micros: priced ? r.cost : 0,
    };
  });
  if (missing.size > 0) problems.push(`the ledger priced calls with snapshot ${[...missing].join(", ")}, which is not among the price files; the bill cannot cite it`);
  // A model that has no price in the snapshot a call was recorded unpriced under, but has one now, is a ledger that needs repricing.
  const stale = new Set<string>();
  for (const r of cost) {
    const snap = snapshots.get(r.snapshot_id);
    if (!snap) continue;
    const priceNow = resolvePrice(snap, r.model).kind === "priced";
    if (!r.priced && priceNow) stale.add(r.model);
    if (r.priced && !priceNow) stale.add(r.model);
  }
  if (stale.size > 0) problems.push(`the ledger and the price files disagree on whether ${[...stale].slice(0, 3).join(", ")} has a price; run desk reprice`);

  let billed: BilledRow[] = [];
  let reconciliation: ReconRow[] = [];
  if (has(db, "invoice") && has(db, "billed_line")) {
    billed = (
      db
        .prepare(
          `SELECT i.vendor vendor, COALESCE(b.day, i.period_start) day, COALESCE(b.model, '') model, i.currency currency, b.amount_micros amount
           FROM billed_line b JOIN invoice i ON i.invoice_id = b.invoice_id
           WHERE i.status = 'imported' AND i.currency = 'USD' AND COALESCE(b.day, i.period_start) >= ? AND COALESCE(b.day, i.period_start) <= ?
           ORDER BY i.vendor, day, model, b.amount_micros`,
        )
        .all(span.firstDay, span.lastDay) as unknown as { vendor: string; day: string; model: string; currency: string; amount: number }[]
    ).map((r) => ({ vendor: r.vendor, day: r.day, model: r.model, currency: r.currency, amount_micros: r.amount, class: "billed" as const }));
    reconciliation = computeReconciliations(db)
      .filter((r) => r.period === label)
      .map((r) => ({ vendor: r.vendor, period: r.period, status: r.status, has_invoice: r.billedMicros !== null, billed_micros: r.billedMicros ?? 0, estimated_micros: r.estimatedMicros, class: "computed" as const }));
  }
  return { span, cost, billed, reconciliation, problems };
}

export interface MonthSummary {
  calls: number;
  pricedMicros: number;
  unpricedCalls: number;
  landedMicros: number;
  committedMicros: number;
  unlinkedMicros: number;
  revertedMicros: number;
  weakMicros: number;
  longPromptCalls: number;
  billedMicros: number | null;
  vendorMonths: number;
  unreconciledVendorMonths: number;
}

export function summarise(rows: MonthRows): MonthSummary {
  const sum = (f: (r: CostRow) => boolean, pick: (r: CostRow) => number): number => rows.cost.filter(f).reduce((s, r) => s + pick(r), 0);
  const micros = (landing: readonly string[]): number => sum((r) => r.priced && landing.includes(r.landing), (r) => r.cost_micros);
  return {
    calls: sum(() => true, (r) => r.calls),
    pricedMicros: sum((r) => r.priced, (r) => r.cost_micros),
    unpricedCalls: sum((r) => !r.priced, (r) => r.calls),
    landedMicros: micros(["merged", "kept"]),
    committedMicros: micros(["committed"]),
    unlinkedMicros: micros(["unlinked"]),
    revertedMicros: micros(["reverted"]),
    weakMicros: sum((r) => r.priced && r.weak, (r) => r.cost_micros),
    longPromptCalls: sum((r) => r.tier === "long", (r) => r.calls),
    billedMicros: rows.billed.length === 0 ? null : rows.billed.reduce((s, r) => s + r.amount_micros, 0),
    vendorMonths: rows.reconciliation.length,
    unreconciledVendorMonths: rows.reconciliation.filter((r) => r.status !== "reconciled").length,
  };
}

const LANDED = ["merged", "kept"];

export interface MonthBill {
  input: DossierInput;
  summary: MonthSummary;
}

/** The dossier input for a month: the rows, the claims over them, and the sentences that state the claims. */
export function monthBillInput(rows: MonthRows, o: { snapshots: ReadonlyMap<string, PriceSnapshot>; signer: Signer; tenant: string; now: Date }): MonthBill {
  if (rows.problems.length > 0) throw new RangeError(rows.problems[0]);
  if (rows.cost.length === 0) throw new RangeError(`the ledger has no call in ${rows.span.label}`);
  const s = summarise(rows);
  const log = new MemoryLog();
  for (const r of rows.cost) log.append("month_cost", "calls", r);
  for (const r of rows.billed) log.append("month_billed", "line", r);
  for (const r of rows.reconciliation) log.append("month_recon", "vendor_month", r);

  const nCost = rows.cost.length;
  const range = (stream: string, n: number) => ({ stream, from: 0, to: n - 1 });
  const usdClaim = (id: string, text: string, fn: string, args: Record<string, unknown>, stream: string, n: number, cls: ClaimInput["class"]): ClaimInput => ({
    id, kind: "number", text, unit: "usd", class: cls, decimals: 2, divisor: 1_000_000, computation: { fn, args, range: range(stream, n) },
  });
  const costSum = (id: string, text: string, where: Record<string, unknown>): ClaimInput =>
    usdClaim(id, text, "sum@1", { field: "cost_micros", where: { priced: true, ...where }, class_field: "class" }, "month_cost", nCost, "estimated");
  // A sum over no row has no class to carry, so a bucket with no row gets no claim; the summary still reports it as zero.
  const bucket = (landing: readonly string[], weak?: boolean): boolean => rows.cost.some((r) => r.priced && landing.includes(r.landing) && (weak === undefined || r.weak === weak));
  const claims: ClaimInput[] = [
    usdClaim("spend", "Estimated list-price spend for the month", "cost_bounds@1", {}, "month_cost", nCost, "estimated"),
    { id: "calls", kind: "number", text: "Calls in the month", unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "sum@1", args: { field: "calls" }, range: range("month_cost", nCost) } },
    { id: "unpriced", kind: "number", text: "Calls on a model with no price in the snapshot", unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "sum@1", args: { field: "calls", where: { priced: false } }, range: range("month_cost", nCost) } },
    { id: "long_prompt", kind: "number", text: "Calls priced at the long-prompt rates", unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "sum@1", args: { field: "calls", where: { tier: "long" } }, range: range("month_cost", nCost) } },
  ];
  const buckets: [string, string, readonly string[], Record<string, unknown>][] = [
    ["landed", "Spend on sessions whose work was merged or kept", LANDED, { landing: { in: LANDED } }],
    ["committed", "Spend on sessions whose work was committed and not yet merged or kept", ["committed"], { landing: "committed" }],
    ["unlinked", "Spend on sessions that cannot be tied to any commit", ["unlinked"], { landing: "unlinked" }],
    ["reverted", "Spend on sessions whose work was reverted", ["reverted"], { landing: "reverted" }],
  ];
  for (const [id, text, landing, where] of buckets) if (bucket(landing)) claims.push(costSum(id, text, where));
  claims.push({ id: "landed_share", kind: "number", text: "Share of the priced spend that landed", unit: "pct", class: "computed", decimals: 1, divisor: 100, computation: { fn: "ratio_bp@1", args: { field: "cost_micros", where: { priced: true, landing: { in: LANDED } }, denom_where: { priced: true } }, range: range("month_cost", nCost) } });
  if (rows.cost.some((r) => r.priced && r.weak)) claims.push(costSum("weak", "Spend whose link to a commit rests on a weak match", { weak: true }));
  if (rows.billed.length > 0) claims.push(usdClaim("billed", "What the imported invoices charge for the month", "sum@1", { field: "amount_micros", class_field: "class" }, "month_billed", rows.billed.length, "billed"));
  if (rows.reconciliation.length > 0) {
    const rec = range("month_recon", rows.reconciliation.length);
    claims.push(
      { id: "recon_all", kind: "number", text: "Vendor months in the month's reconciliation", unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "count@1", args: {}, range: rec } },
      { id: "recon_open", kind: "number", text: "Vendor months that are not reconciled", unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "count@1", args: { where: { status: { in: ["unreconciled", "partial"] } } }, range: rec } },
    );
  }

  const usd = formatUsd;
  const n = (x: number): string => x.toLocaleString("en-US");
  // The same rounding the verifier uses: basis points half up, then one decimal of a percent half up.
  const pct = (a: number, b: number): string => {
    if (b === 0) return "0.0";
    const bp = Number((BigInt(a) * 20_000n + BigInt(b)) / (BigInt(b) * 2n));
    return (Math.floor((bp * 10 * 2 + 100) / 200) / 10).toFixed(1);
  };
  const sentences: SentenceInput[] = [
    { id: "s_spend", text: `Estimated list-price spend for the month was ${usd(s.pricedMicros)} over ${n(s.calls)} calls.`, cites: ["spend", "calls"] },
  ];
  if (bucket(LANDED)) sentences.push({ id: "s_landed", text: `${usd(s.landedMicros)} of the priced spend, ${pct(s.landedMicros, s.pricedMicros)}%, went to sessions whose work was merged or kept.`, cites: ["landed", "landed_share"] });
  if (bucket(["unlinked"])) sentences.push({ id: "s_unlinked", text: `${usd(s.unlinkedMicros)} went to sessions that cannot be tied to any commit; that is unknown, not waste.`, cites: ["unlinked"] });
  if (s.unpricedCalls > 0) sentences.push({ id: "s_unpriced", text: `${n(s.unpricedCalls)} calls used a model with no price, so their tokens are counted and no dollars are invented for them.`, cites: ["unpriced"] });
  if (s.longPromptCalls > 0) sentences.push({ id: "s_long", text: `${n(s.longPromptCalls)} calls were priced at the long-prompt rates; a sum of tokens cannot show that each of them was over the line.`, cites: ["long_prompt"] });
  if (s.billedMicros !== null) sentences.push({ id: "s_billed", text: `The invoices imported for the month charge ${usd(s.billedMicros)}.`, cites: ["billed"] });
  if (rows.reconciliation.length > 0) sentences.push({ id: "s_recon", text: `${n(s.unreconciledVendorMonths)} of ${n(s.vendorMonths)} vendor ${s.vendorMonths === 1 ? "month is" : "months are"} not reconciled with what the vendor charged.`, cites: ["recon_open", "recon_all"] });

  const meta = { kind: "month_bill" as const, tenant: o.tenant, period: { from: rows.span.firstDay, to: rows.span.lastDay }, createdAt: o.now.toISOString(), audience: "auditor" as const, disclosure: "full" as const };
  const used = new Set(rows.cost.map((r) => r.snapshot_id));
  for (const id of used) if (!o.snapshots.has(id)) throw new RangeError(`the rows cite price snapshot ${id}, which was not given`);
  const input: DossierInput = { ...meta, log: log.rows as Row[], claims, sentences, snapshots: [...used].map((id) => o.snapshots.get(id) as PriceSnapshot), signer: o.signer };
  return { input, summary: s };
}
