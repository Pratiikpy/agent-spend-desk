import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";

/**
 * Reconciliation of the estimate with the cost Claude Code recorded for itself. Each `cost-state` line covers one
 * process of a session, from the moment that process started; the estimate for the same process is the cost of the
 * session's calls that began at or after that moment and before the next process of the same session began. The two
 * are compared per process and per model, tokens first, because tokens that agree while dollars do not point at the
 * price table, and dollars and tokens that both differ point at coverage (calls the tool's counter did not see, or
 * files this product has not read).
 */
export type Verdict = "match" | "estimate_low" | "estimate_high" | "no_calls";

export interface ReconcileModel {
  model: string;
  reportedMicros: number;
  estimatedMicros: number;
  reportedInputTokens: number;
  estimatedInputTokens: number;
  reportedOutputTokens: number;
  estimatedOutputTokens: number;
  reportedCacheReadTokens: number;
  estimatedCacheReadTokens: number;
  reportedCacheWriteTokens: number;
  estimatedCacheWriteTokens: number;
  /** Every token class is within half a percent of what the tool recorded. */
  tokensAgree: boolean;
}

export interface ReconcileRow {
  sessionId: string;
  processStartMs: number;
  /** Where the window ends: the start of the session's next process, or null for the last one. */
  windowEndMs: number | null;
  /** The time of the last message the tool had read when it wrote its latest record, or null if that was not known. */
  observedAt: string | null;
  reportedMicros: number;
  estimatedMicros: number;
  diffMicros: number;
  ratio: number | null;
  calls: number;
  /** Of those, calls made by sub-agents. The tool's own counter was found to lag and to undercount these. */
  sidechainCalls: number;
  unpricedCalls: number;
  /** For a session's first process: calls that began before it, which its counter does not include. */
  callsBeforeProcess: number;
  /** Calls after the last message the tool had seen when it wrote its last record, which that record cannot include. */
  callsAfterRecord: number;
  verdict: Verdict;
  note: string;
  models: ReconcileModel[];
}

export interface ReconcileOptions {
  /** A process agrees when the estimate is within this share of the reported cost. */
  tolerance?: number;
}

interface CallRow {
  ts: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  class: string;
  total_micros: number | null;
  is_sidechain: number;
}

const within = (a: number, b: number): boolean => (a === b ? true : Math.abs(a - b) <= 0.005 * Math.max(a, b));

export function reconcile(db: Ledger, opts: ReconcileOptions = {}): ReconcileRow[] {
  const tolerance = opts.tolerance ?? 0.02;
  const reported = db.prepare("SELECT session_id, process_start_ms, total_micros, observed_ts FROM reported_cost ORDER BY session_id, process_start_ms").all() as { session_id: string; process_start_ms: number; total_micros: number; observed_ts: string | null }[];
  const usage = db.prepare("SELECT model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micros FROM reported_model_usage WHERE session_id = ? AND process_start_ms = ?");
  const calls = db.prepare(
    `SELECT m.ts, m.model, m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_write_5m_tokens, m.cache_write_1h_tokens, c.class, c.total_micros, m.is_sidechain
     FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.session_id = ?`,
  );

  const starts = new Map<string, number[]>();
  for (const r of reported) starts.set(r.session_id, [...(starts.get(r.session_id) ?? []), r.process_start_ms]);

  const out: ReconcileRow[] = [];
  const cache = new Map<string, { at: number; side: boolean; row: CallRow }[]>();
  for (const r of reported) {
    let all = cache.get(r.session_id);
    if (!all) {
      all = (calls.all(r.session_id) as unknown as CallRow[]).map((row) => ({ at: Date.parse(row.ts), side: row.is_sidechain === 1, row }));
      cache.set(r.session_id, all);
    }
    const mine = starts.get(r.session_id) ?? [];
    const first = mine[0] === r.process_start_ms;
    const next = mine.find((s) => s > r.process_start_ms) ?? null;
    const observedMs = r.observed_ts === null ? null : Date.parse(r.observed_ts);
    const processCalls = all.filter((c) => c.at >= r.process_start_ms && (next === null || c.at < next));
    const inWindow = processCalls.filter((c) => observedMs === null || Number.isNaN(observedMs) || c.at <= observedMs);
    const callsAfterRecord = processCalls.length - inWindow.length;
    const callsBeforeProcess = first ? all.filter((c) => c.at < r.process_start_ms).length : 0;

    const perModel = new Map<string, ReconcileModel>();
    const slot = (model: string): ReconcileModel => {
      let m = perModel.get(model);
      if (!m) {
        m = { model, reportedMicros: 0, estimatedMicros: 0, reportedInputTokens: 0, estimatedInputTokens: 0, reportedOutputTokens: 0, estimatedOutputTokens: 0, reportedCacheReadTokens: 0, estimatedCacheReadTokens: 0, reportedCacheWriteTokens: 0, estimatedCacheWriteTokens: 0, tokensAgree: false };
        perModel.set(model, m);
      }
      return m;
    };
    for (const u of usage.all(r.session_id, r.process_start_ms) as unknown as { model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_micros: number }[]) {
      const m = slot(u.model);
      m.reportedMicros = u.cost_micros;
      m.reportedInputTokens = u.input_tokens;
      m.reportedOutputTokens = u.output_tokens;
      m.reportedCacheReadTokens = u.cache_read_tokens;
      m.reportedCacheWriteTokens = u.cache_write_tokens;
    }
    let estimated = 0;
    let unpriced = 0;
    let sidechain = 0;
    for (const { row, side } of inWindow) {
      if (side) sidechain += 1;
      const m = slot(row.model);
      m.estimatedInputTokens += row.input_tokens;
      m.estimatedOutputTokens += row.output_tokens;
      m.estimatedCacheReadTokens += row.cache_read_tokens;
      m.estimatedCacheWriteTokens += row.cache_write_5m_tokens + row.cache_write_1h_tokens;
      if (row.class === "estimated" && row.total_micros !== null) {
        m.estimatedMicros += row.total_micros;
        estimated += row.total_micros;
      } else {
        unpriced += 1;
      }
    }
    for (const m of perModel.values()) {
      m.tokensAgree = within(m.reportedInputTokens, m.estimatedInputTokens) && within(m.reportedOutputTokens, m.estimatedOutputTokens) && within(m.reportedCacheReadTokens, m.estimatedCacheReadTokens) && within(m.reportedCacheWriteTokens, m.estimatedCacheWriteTokens);
    }

    const diff = estimated - r.total_micros;
    let verdict: Verdict;
    if (inWindow.length === 0) verdict = "no_calls";
    else if (Math.abs(diff) <= tolerance * Math.max(r.total_micros, 1)) verdict = "match";
    else verdict = diff < 0 ? "estimate_low" : "estimate_high";

    const notes: string[] = [];
    if (unpriced > 0) notes.push(`${unpriced} call(s) not priced, so the estimate leaves them out`);
    if (callsBeforeProcess > 0) notes.push(`${callsBeforeProcess} earlier call(s) are not in this process's counter`);
    if (callsAfterRecord > 0) notes.push(`${callsAfterRecord} later call(s) came after the tool's last record`);
    if (inWindow.length === 0) notes.push("the tool recorded a cost but no call of this session falls in the process window");
    if (verdict !== "match" && verdict !== "no_calls") {
      const disagree = [...perModel.values()].filter((m) => !m.tokensAgree);
      notes.push(disagree.length === 0 ? "tokens agree for every model, so the difference is in the prices" : `tokens differ for ${disagree.map((m) => m.model).join(", ")}, so calls may be missing from or extra in the ledger`);
    }

    out.push({
      sessionId: r.session_id,
      processStartMs: r.process_start_ms,
      windowEndMs: next,
      observedAt: r.observed_ts,
      reportedMicros: r.total_micros,
      estimatedMicros: estimated,
      diffMicros: diff,
      ratio: r.total_micros > 0 ? estimated / r.total_micros : null,
      calls: inWindow.length,
      sidechainCalls: sidechain,
      unpricedCalls: unpriced,
      callsBeforeProcess,
      callsAfterRecord,
      verdict,
      note: notes.join("; "),
      models: [...perModel.values()].sort((a, b) => b.reportedMicros - a.reportedMicros),
    });
  }
  return out;
}

export interface ReconcileSummary {
  processes: number;
  match: number;
  estimateLow: number;
  estimateHigh: number;
  noCalls: number;
  reportedMicros: number;
  estimatedMicros: number;
  medianAbsPctError: number | null;
  withinTenPct: number;
  /** The same comparison split by whether the process used sub-agents. */
  withoutSubAgents: GroupSummary;
  withSubAgents: GroupSummary;
}

export interface GroupSummary {
  processes: number;
  match: number;
  withinTenPct: number;
  reportedMicros: number;
  estimatedMicros: number;
}

function group(rows: readonly ReconcileRow[]): GroupSummary {
  const comparable = rows.filter((r) => r.verdict !== "no_calls");
  return {
    processes: comparable.length,
    match: comparable.filter((r) => r.verdict === "match").length,
    withinTenPct: comparable.filter((r) => r.reportedMicros > 0 && Math.abs(r.estimatedMicros - r.reportedMicros) / r.reportedMicros <= 0.1).length,
    reportedMicros: comparable.reduce((s, r) => s + r.reportedMicros, 0),
    estimatedMicros: comparable.reduce((s, r) => s + r.estimatedMicros, 0),
  };
}

export function summariseReconciliation(rows: readonly ReconcileRow[]): ReconcileSummary {
  const comparable = rows.filter((r) => r.verdict !== "no_calls" && r.reportedMicros > 0);
  const errors = comparable.map((r) => Math.abs(r.estimatedMicros - r.reportedMicros) / r.reportedMicros).sort((a, b) => a - b);
  const mid = Math.floor(errors.length / 2);
  return {
    processes: rows.length,
    match: rows.filter((r) => r.verdict === "match").length,
    estimateLow: rows.filter((r) => r.verdict === "estimate_low").length,
    estimateHigh: rows.filter((r) => r.verdict === "estimate_high").length,
    noCalls: rows.filter((r) => r.verdict === "no_calls").length,
    reportedMicros: rows.reduce((s, r) => s + r.reportedMicros, 0),
    estimatedMicros: rows.reduce((s, r) => s + r.estimatedMicros, 0),
    medianAbsPctError: errors.length === 0 ? null : errors.length % 2 === 1 ? (errors[mid] as number) : ((errors[mid - 1] as number) + (errors[mid] as number)) / 2,
    withinTenPct: errors.filter((e) => e <= 0.1).length,
    withoutSubAgents: group(rows.filter((r) => r.sidechainCalls === 0)),
    withSubAgents: group(rows.filter((r) => r.sidechainCalls > 0)),
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function renderReconciliation(rows: readonly ReconcileRow[], s: ReconcileSummary, opts: { worst?: number; tolerance?: number } = {}): string {
  if (rows.length === 0) return "No cost recorded by the tool in these logs, so there is nothing to reconcile against. Claude Code writes `cost-state` lines into its session logs; none was found.";
  const tolerance = opts.tolerance ?? 0.02;
  const lines: string[] = [];
  lines.push(`${s.match} of ${s.processes} recorded process(es) agree with the tool's own cost within ${pct(tolerance)}; ${s.estimateLow} estimate low, ${s.estimateHigh} estimate high, ${s.noCalls} with no call in their window.`);
  lines.push(`Tool recorded ${formatUsd(s.reportedMicros)}; this product estimates ${formatUsd(s.estimatedMicros)} for the same windows.${s.medianAbsPctError === null ? "" : ` Median absolute difference ${pct(s.medianAbsPctError)}; ${s.withinTenPct} within 10%.`}`);
  const split = (name: string, g: GroupSummary): string => (g.processes === 0 ? "" : `  ${name}: ${g.processes} process(es), ${g.match} within ${pct(tolerance)}, ${g.withinTenPct} within 10%; tool ${formatUsd(g.reportedMicros)}, estimate ${formatUsd(g.estimatedMicros)}`);
  if (s.withSubAgents.processes > 0) {
    lines.push("Split by whether the process used sub-agents (the tool's own counter was found to lag and undercount those):");
    for (const l of [split("without sub-agents", s.withoutSubAgents), split("with sub-agents", s.withSubAgents)]) if (l) lines.push(l);
  }
  const worst = [...rows].filter((r) => r.verdict !== "match").sort((a, b) => Math.abs(b.diffMicros) - Math.abs(a.diffMicros)).slice(0, opts.worst ?? 8);
  if (worst.length > 0) lines.push("Largest differences:");
  for (const r of worst) {
    lines.push(`  ${r.sessionId.slice(0, 8)} from ${new Date(r.processStartMs).toISOString().slice(0, 10)}: tool ${formatUsd(r.reportedMicros)}, estimate ${formatUsd(r.estimatedMicros)} (${r.ratio === null ? "n/a" : `${r.ratio.toFixed(2)}x`}), ${r.calls} calls${r.note ? `; ${r.note}` : ""}`);
  }
  return lines.join("\n");
}
