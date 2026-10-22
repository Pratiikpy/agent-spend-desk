import type { Ledger } from "../ledger/db.ts";
import { addDays, daysBetween, rangeBounds } from "./days.ts";
import { sanitizeLabel } from "./label.ts";
import { loadEngineModule, type MarkovianLike } from "./load.ts";

/**
 * The Desk's use of the Meterless Markovian engine: a long date range is read in bounded chunks, one
 * period per chunk, and everything the next chunk may know is the carryover state the engine hands it.
 * The state is a fixed-size block (totals, peak, top models, the series of period costs), so the amount of
 * text a long range adds to an answer does not grow with the range.
 *
 * The chunk "generator" here is code, not a language model: the engine's chunk, marker, carryover and
 * budget contract is what is used. That is stated wherever this engine is claimed.
 */
export interface Period {
  label: string;
  micros: number;
  calls: number;
  unpriced: number;
  byModel: Record<string, number>;
}

export interface RangeDigest {
  from: string;
  to: string;
  bucketDays: number;
  periods: number;
  totalMicros: number;
  totalCalls: number;
  unpricedCalls: number;
  peak: { label: string; micros: number } | null;
  topModels: { model: string; micros: number }[];
  /** Cost of each period in order; its length is the number of periods. */
  series: number[];
  /** How many chunks the engine ran and the largest carryover it passed on, in estimated tokens. */
  chunks: number;
  maxCarryoverTokens: number;
  carryoverBudgetTokens: number;
  status: string;
}

export const MAX_CHUNKS = 32;
export const CARRYOVER_TOKENS = 800;
const TOP_MODELS = 5;

/** Smallest bucket that keeps the number of periods within the engine's chunk cap: a day, then whole weeks. */
export function bucketDaysFor(spanDays: number, maxChunks = MAX_CHUNKS): number {
  if (spanDays <= maxChunks) return 1;
  let weeks = 1;
  while (Math.ceil(spanDays / (weeks * 7)) > maxChunks) weeks += 1;
  return weeks * 7;
}

export function loadPeriods(db: Ledger, from: string, to: string, bucketDays: number): Period[] {
  const { since, until } = rangeBounds(from, to);
  const rows = db
    .prepare(
      `SELECT CAST((julianday(substr(m.ts, 1, 10)) - julianday(?)) / ? AS INTEGER) AS b, m.model AS model, COUNT(*) AS calls,
              SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros ELSE 0 END) AS micros,
              SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) AS unpriced
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id
       WHERE m.ts >= ? AND m.ts < ? GROUP BY b, m.model`,
    )
    .all(from, bucketDays, since, until) as unknown as { b: number; model: string; calls: number; micros: number; unpriced: number }[];
  const span = daysBetween(from, to) + 1;
  const count = Math.ceil(span / bucketDays);
  const periods: Period[] = [];
  for (let i = 0; i < count; i += 1) {
    periods.push({ label: addDays(from, i * bucketDays), micros: 0, calls: 0, unpriced: 0, byModel: {} });
  }
  for (const r of rows) {
    const p = periods[r.b];
    if (!p) continue;
    p.micros += r.micros;
    p.calls += r.calls;
    p.unpriced += r.unpriced;
    // Model ids come from the logs; one holding a marker such as [TASK_COMPLETE] would end the chain early.
    const key = sanitizeLabel(r.model);
    p.byModel[key] = (p.byModel[key] ?? 0) + r.micros;
  }
  return periods;
}

interface State {
  n: number;
  total: number;
  calls: number;
  unpriced: number;
  peakLabel: string;
  peakMicros: number;
  models: Record<string, number>;
  series: number[];
}

const emptyState = (): State => ({ n: 0, total: 0, calls: 0, unpriced: 0, peakLabel: "", peakMicros: -1, models: {}, series: [] });

function encode(s: State): string {
  const top = Object.entries(s.models)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_MODELS);
  const payload = JSON.stringify({ n: s.n, total: s.total, calls: s.calls, unpriced: s.unpriced, peak: [s.peakLabel, s.peakMicros], models: Object.fromEntries(top), series: s.series });
  return `COMPLETED: ${s.n} periods read\nREMAINING: later periods\nDECISIONS: none\nCONTEXT: ${payload}`;
}

function decode(carryover: string): State {
  const m = /CONTEXT: (\{.*\})/s.exec(carryover);
  if (!m) return emptyState();
  const o = JSON.parse(m[1] as string) as { n: number; total: number; calls: number; unpriced: number; peak: [string, number]; models: Record<string, number>; series: number[] };
  return { n: o.n, total: o.total, calls: o.calls, unpriced: o.unpriced, peakLabel: o.peak[0], peakMicros: o.peak[1], models: o.models, series: o.series };
}

/** Fold one period into the state. Models that fall out of the top five keep their cost in `total` only. */
function fold(s: State, p: Period): State {
  const models = { ...s.models };
  for (const [k, v] of Object.entries(p.byModel)) models[k] = (models[k] ?? 0) + v;
  const peak = p.micros > s.peakMicros;
  return {
    n: s.n + 1,
    total: s.total + p.micros,
    calls: s.calls + p.calls,
    unpriced: s.unpriced + p.unpriced,
    peakLabel: peak ? p.label : s.peakLabel,
    peakMicros: peak ? p.micros : s.peakMicros,
    models,
    series: [...s.series, p.micros],
  };
}

export async function digestRange(db: Ledger, from: string, to: string): Promise<RangeDigest> {
  const span = daysBetween(from, to) + 1;
  const bucketDays = bucketDaysFor(span);
  const periods = loadPeriods(db, from, to, bucketDays);
  const mod = await loadEngineModule("markovian");
  const Ctor = mod["Markovian"] as new (o: { chunkConfig: { maxChunks: number; carryoverTokens: number } }) => MarkovianLike;
  const engine = new Ctor({ chunkConfig: { maxChunks: MAX_CHUNKS, carryoverTokens: CARRYOVER_TOKENS } });

  let last: State = emptyState();
  let maxCarry = 0;
  const run = await engine.run({
    goal: `Read ${from} to ${to} one period at a time and keep totals`,
    mode: "RESEARCH",
    reflect: false,
    stepFn: ({ carryover, step }) => {
      // Only the carryover crosses from one chunk to the next: the period itself is the whole new input.
      const state = decode(carryover);
      const period = periods[step];
      if (!period) return { content: "no more periods\n[TASK_COMPLETE]" };
      const next = fold(state, period);
      last = next;
      maxCarry = Math.max(maxCarry, Math.ceil(carryover.length / 4));
      const done = step === periods.length - 1;
      return { content: `${period.label}\n${done ? "[TASK_COMPLETE]" : `[STATE_CHECKPOINT] ${encode(next)}`}` };
    },
  });
  if (run.status !== "completed") throw new Error(`Markovian run did not complete: ${run.status}${run.error ? ` (${run.error})` : ""}`);
  const peak = last.peakMicros >= 0 && last.total > 0 ? { label: last.peakLabel, micros: last.peakMicros } : null;
  return {
    from,
    to,
    bucketDays,
    periods: last.n,
    totalMicros: last.total,
    totalCalls: last.calls,
    unpricedCalls: last.unpriced,
    peak,
    topModels: Object.entries(last.models)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([model, micros]) => ({ model, micros })),
    series: last.series,
    chunks: run.chunks.length,
    maxCarryoverTokens: maxCarry,
    carryoverBudgetTokens: run.chunkConfig.carryoverTokens,
    status: run.status,
  };
}
