import { rollbackQuietly } from "../ledger/db.ts";
import { sealLedger } from "../ledger/chain.ts";
import { priceCall } from "../cost/price-call.ts";
import { recordSnapshot } from "../ledger/ingest.ts";
import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import type { PriceSnapshot } from "./pricebook.ts";

/**
 * Repricing as superseding events (DF-029). A price that was wrong, or a snapshot that came later, changes what calls
 * cost; the old cost is never overwritten without a trace. Each cost that changes is copied to `cost_event_history`
 * under a `repricing` row that says when, to which snapshot, for which span and why, and the call keeps the
 * snapshot id of the price that now stands. Nothing is mutated that a later reader cannot read back.
 */
export interface RepriceOptions {
  fromIso?: string;
  untilIso?: string;
  reason: string;
  now?: Date;
  /** Compute and report without writing anything. */
  preview?: boolean;
}

export interface RepriceModelDelta {
  model: string;
  calls: number;
  deltaMicros: number;
}

export interface RepriceReport {
  /** The repricing row written; null for a preview or when no cost changed. */
  repricingId: number | null;
  toSnapshot: string;
  examined: number;
  /** Calls whose cost changed. Each keeps its old cost in the history. */
  changed: number;
  /** Calls whose cost is the same but whose rule notes changed; updated in place, since no price moved. */
  annotated: number;
  /** New total minus old total over the changed calls; a call that was unpriced counts as zero before. */
  deltaMicros: number;
  newlyPriced: number;
  nowUnpriced: number;
  byModel: RepriceModelDelta[];
}

interface Row {
  call_id: string;
  model: string;
  ts: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  speed: string | null;
  inference_geo: string | null;
  e_class: string | null;
  e_snapshot: string | null;
  e_matched: string | null;
  e_ladder: string | null;
  e_reason: string | null;
  e_total: number | null;
  e_input: number | null;
  e_output: number | null;
  e_read: number | null;
  e_w5: number | null;
  e_w1: number | null;
  e_rules: string | null;
}

export function repriceLedger(db: Ledger, snapshot: PriceSnapshot, opts: RepriceOptions): RepriceReport {
  const at = (opts.now ?? new Date()).toISOString();
  const rows = db
    .prepare(
      `SELECT m.call_id, m.model, m.ts, m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_write_5m_tokens, m.cache_write_1h_tokens, m.speed, m.inference_geo,
              c.class e_class, c.snapshot_id e_snapshot, c.matched_as e_matched, c.ladder_step e_ladder, c.unpriced_reason e_reason, c.total_micros e_total,
              c.input_micros e_input, c.output_micros e_output, c.cache_read_micros e_read, c.cache_write_5m_micros e_w5, c.cache_write_1h_micros e_w1, c.rule_ids e_rules
       FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id
       WHERE (? IS NULL OR m.ts >= ?) AND (? IS NULL OR m.ts <= ?)`,
    )
    .all(opts.fromIso ?? null, opts.fromIso ?? null, opts.untilIso ?? null, opts.untilIso ?? null) as unknown as Row[];

  type Change = { row: Row; next: ReturnType<typeof priceCall> };
  const changes: Change[] = [];
  const annotate: Change[] = [];
  for (const r of rows) {
    const next = priceCall(snapshot, {
      model: r.model,
      tokens: { inputTokens: r.input_tokens, outputTokens: r.output_tokens, cacheReadTokens: r.cache_read_tokens, cacheWrite5mTokens: r.cache_write_5m_tokens, cacheWrite1hTokens: r.cache_write_1h_tokens },
      speed: r.speed,
      inferenceGeo: r.inference_geo,
    });
    if (r.e_class === null) {
      changes.push({ row: r, next });
      continue;
    }
    const samePrice =
      next.kind === "priced"
        ? r.e_class === "estimated" &&
          r.e_total === next.totalMicros &&
          r.e_input === next.components.input &&
          r.e_output === next.components.output &&
          r.e_read === next.components.cacheRead &&
          r.e_w5 === next.components.cacheWrite5m &&
          r.e_w1 === next.components.cacheWrite1h
        : r.e_class === "unpriced" && r.e_reason === next.reason;
    if (!samePrice) changes.push({ row: r, next });
    else if ((r.e_rules ?? "[]") !== JSON.stringify(next.ruleIds)) annotate.push({ row: r, next });
  }

  let delta = 0;
  let newlyPriced = 0;
  let nowUnpriced = 0;
  const perModel = new Map<string, RepriceModelDelta>();
  for (const { row, next } of changes) {
    const before = row.e_class === "estimated" ? (row.e_total ?? 0) : 0;
    const after = next.kind === "priced" ? next.totalMicros : 0;
    delta += after - before;
    if (row.e_class !== "estimated" && next.kind === "priced") newlyPriced += 1;
    if (row.e_class === "estimated" && next.kind === "unpriced") nowUnpriced += 1;
    const m = perModel.get(row.model) ?? { model: row.model, calls: 0, deltaMicros: 0 };
    m.calls += 1;
    m.deltaMicros += after - before;
    perModel.set(row.model, m);
  }
  const report: RepriceReport = {
    repricingId: null,
    toSnapshot: snapshot.snapshotId,
    examined: rows.length,
    changed: changes.length,
    annotated: annotate.length,
    deltaMicros: delta,
    newlyPriced,
    nowUnpriced,
    byModel: [...perModel.values()].sort((a, b) => Math.abs(b.deltaMicros) - Math.abs(a.deltaMicros)),
  };
  if (opts.preview || (changes.length === 0 && annotate.length === 0)) return report;

  db.exec("BEGIN");
  try {
    recordSnapshot(db, snapshot);
    const note = db.prepare("UPDATE cost_event SET rule_ids = ? WHERE call_id = ?");
    for (const { row, next } of annotate) note.run(JSON.stringify(next.ruleIds), row.call_id);
    if (changes.length === 0) {
      db.exec("COMMIT");
      return report;
    }
    const id = Number(
      db
        .prepare("INSERT INTO repricing (at, to_snapshot, from_ts, until_ts, reason, calls_changed, delta_micros) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(at, snapshot.snapshotId, opts.fromIso ?? null, opts.untilIso ?? null, opts.reason, changes.length, delta).lastInsertRowid,
    );
    const keep = db.prepare(
      `INSERT INTO cost_event_history (call_id, class, snapshot_id, matched_as, ladder_step, unpriced_reason, total_micros, input_micros, output_micros,
         cache_read_micros, cache_write_5m_micros, cache_write_1h_micros, rule_ids, repricing_id)
       SELECT call_id, class, snapshot_id, matched_as, ladder_step, unpriced_reason, total_micros, input_micros, output_micros,
         cache_read_micros, cache_write_5m_micros, cache_write_1h_micros, rule_ids, ? FROM cost_event WHERE call_id = ?`,
    );
    const put = db.prepare(
      `INSERT OR REPLACE INTO cost_event (call_id, class, snapshot_id, matched_as, ladder_step, unpriced_reason, total_micros, input_micros,
         output_micros, cache_read_micros, cache_write_5m_micros, cache_write_1h_micros, rule_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { row, next } of changes) {
      if (row.e_class !== null) keep.run(id, row.call_id);
      if (next.kind === "unpriced") put.run(row.call_id, "unpriced", null, null, null, next.reason, null, null, null, null, null, null, "[]");
      else {
        const c = next.components;
        put.run(row.call_id, "estimated", snapshot.snapshotId, next.matchedAs, next.ladderStep, null, next.totalMicros, c.input, c.output, c.cacheRead, c.cacheWrite5m, c.cacheWrite1h, JSON.stringify(next.ruleIds));
      }
    }
    db.exec("COMMIT");
    report.repricingId = id;
  } catch (e) {
    rollbackQuietly(db);
    throw e;
  }
  // The costs changed and the usage facts did not: the event says which price list the ledger moved to, and each cost can be worked out again from it.
  sealLedger(db, "reprice", { repricing_id: report.repricingId, to_snapshot: snapshot.snapshotId, calls_changed: changes.length }, { sources: [] });
  return report;
}

export interface RepricingRow {
  repricingId: number;
  at: string;
  toSnapshot: string;
  fromTs: string | null;
  untilTs: string | null;
  reason: string;
  callsChanged: number;
  deltaMicros: number;
}

export function listRepricings(db: Ledger, limit = 20): RepricingRow[] {
  return (
    db
      .prepare("SELECT repricing_id repricingId, at, to_snapshot toSnapshot, from_ts fromTs, until_ts untilTs, reason, calls_changed callsChanged, delta_micros deltaMicros FROM repricing ORDER BY repricing_id DESC LIMIT ?")
      .all(limit) as unknown as RepricingRow[]
  );
}

export interface CostVersion {
  /** The repricing that replaced this version, or null for the version that stands now. */
  supersededBy: number | null;
  supersededAt: string | null;
  snapshotId: string | null;
  class: string;
  totalMicros: number | null;
  unpricedReason: string | null;
  ruleIds: string[];
}

/** Every version of one call's cost, oldest first; the last is the one that stands. */
export function costVersions(db: Ledger, callId: string): CostVersion[] {
  const old = db
    .prepare(
      `SELECT h.repricing_id supersededBy, r.at supersededAt, h.snapshot_id snapshotId, h.class class, h.total_micros totalMicros, h.unpriced_reason unpricedReason, h.rule_ids rules
       FROM cost_event_history h JOIN repricing r ON r.repricing_id = h.repricing_id WHERE h.call_id = ? ORDER BY h.history_id`,
    )
    .all(callId) as unknown as (Omit<CostVersion, "ruleIds"> & { rules: string })[];
  const now = db.prepare("SELECT snapshot_id snapshotId, class, total_micros totalMicros, unpriced_reason unpricedReason, rule_ids rules FROM cost_event WHERE call_id = ?").get(callId) as unknown as
    | { snapshotId: string | null; class: string; totalMicros: number | null; unpricedReason: string | null; rules: string }
    | undefined;
  const out: CostVersion[] = old.map((o) => ({ supersededBy: o.supersededBy, supersededAt: o.supersededAt, snapshotId: o.snapshotId, class: o.class, totalMicros: o.totalMicros, unpricedReason: o.unpricedReason, ruleIds: JSON.parse(o.rules) as string[] }));
  if (now) out.push({ supersededBy: null, supersededAt: null, snapshotId: now.snapshotId, class: now.class, totalMicros: now.totalMicros, unpricedReason: now.unpricedReason, ruleIds: JSON.parse(now.rules) as string[] });
  return out;
}

const signed = (micros: number): string => `${micros < 0 ? "-" : "+"}${formatUsd(Math.abs(micros))}`;

export function renderRepricing(r: RepriceReport, preview: boolean): string {
  if (r.changed === 0) {
    const noted = r.annotated > 0 ? ` ${preview ? "Would note" : "Noted"} the pricing rules on ${r.annotated.toLocaleString("en-US")} of them; no price moved.` : "";
    return `Nothing to reprice: the ${r.examined.toLocaleString("en-US")} calls examined already cost what snapshot ${r.toSnapshot} says.${noted}`;
  }
  const lines = [
    `${preview ? "Would reprice" : "Repriced"} ${r.changed.toLocaleString("en-US")} of ${r.examined.toLocaleString("en-US")} calls to ${r.toSnapshot}: ${signed(r.deltaMicros)}${r.newlyPriced > 0 ? `, ${r.newlyPriced} that had no price now have one` : ""}${r.nowUnpriced > 0 ? `, ${r.nowUnpriced} no longer have one` : ""}.`,
  ];
  for (const m of r.byModel.slice(0, 8)) lines.push(`  ${m.model.padEnd(32)} ${String(m.calls).padStart(8)} calls  ${signed(m.deltaMicros).padStart(12)}`);
  if (r.annotated > 0) lines.push(`${preview ? "Would also note" : "Also noted"} the pricing rules on ${r.annotated.toLocaleString("en-US")} calls whose price did not move.`);
  if (!preview && r.repricingId !== null) lines.push(`Every earlier cost is kept: desk prices history --call <id> shows both versions (repricing ${r.repricingId}).`);
  return lines.join("\n");
}
