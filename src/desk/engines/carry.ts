import { createHash } from "node:crypto";

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
 * A range of three or more whole calendar months is read one month to a chunk, and the state then also holds each leading model's cost
 * month by month, so that "which model grew every month" is answered from the carry and not from the rows (DF-118). The state of each chunk is kept
 * in the ledger (`carry_state`), keyed by a digest of everything read up to it, so asking about the same year again reads only the periods whose rows changed.
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

export type BucketKind = "days" | "month";

export interface RangeDigest {
  from: string;
  to: string;
  bucketDays: number;
  /** Fixed-length buckets of days, or whole calendar months. */
  bucketKind: BucketKind;
  periods: number;
  totalMicros: number;
  totalCalls: number;
  unpricedCalls: number;
  peak: { label: string; micros: number } | null;
  topModels: { model: string; micros: number }[];
  /** Cost of each period in order; its length is the number of periods. */
  series: number[];
  /** Month mode only: the leading models' cost in each period, and the ones whose cost rose in every period. */
  modelSeries: Record<string, number[]>;
  growers: string[];
  /** How many chunks the engine ran and the largest carryover it passed on, in estimated tokens. */
  chunks: number;
  maxCarryoverTokens: number;
  carryoverBudgetTokens: number;
  status: string;
  /** The engine's own account of the run: prompt tokens used, and what reading the range in one piece, with the history growing, would have used beyond that. */
  tokensUsed: number;
  tokensSaved: number;
  efficiencyPercent: number;
  /** Chunks whose state was read from the ledger instead of worked out again. */
  reusedPeriods: number;
}

export const MAX_CHUNKS = 32;
export const CARRYOVER_TOKENS = 800;
const TOP_MODELS = 5;
/** Leading models whose month-by-month series the carry state holds. */
export const SERIES_MODELS = 6;
/** A range must span at least this many whole calendar months to be read a month at a time. */
export const MIN_MONTHS = 3;

/** Smallest bucket that keeps the number of periods within the engine's chunk cap: a day, then whole weeks. */
export function bucketDaysFor(spanDays: number, maxChunks = MAX_CHUNKS): number {
  if (spanDays <= maxChunks) return 1;
  let weeks = 1;
  while (Math.ceil(spanDays / (weeks * 7)) > maxChunks) weeks += 1;
  return weeks * 7;
}

const lastOfMonth = (y: number, m0: number): number => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** The calendar months a range covers, when it starts on the 1st, ends on a month's last day and spans at least three of them; null otherwise. */
export function monthBuckets(from: string, to: string): { label: string; from: string; to: string }[] | null {
  const a = /^(\d{4})-(\d{2})-01$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const [y0, m0] = [Number(a[1]), Number(a[2]) - 1];
  const [y1, m1, d1] = [Number(b[1]), Number(b[2]) - 1, Number(b[3])];
  if (d1 !== lastOfMonth(y1, m1)) return null;
  const n = (y1 - y0) * 12 + (m1 - m0) + 1;
  if (n < MIN_MONTHS || n > MAX_CHUNKS) return null;
  const out: { label: string; from: string; to: string }[] = [];
  for (let i = 0; i < n; i += 1) {
    const y = y0 + Math.floor((m0 + i) / 12);
    const m = (m0 + i) % 12;
    const p = (x: number): string => String(x).padStart(2, "0");
    out.push({ label: `${y}-${p(m + 1)}-01`, from: `${y}-${p(m + 1)}-01`, to: `${y}-${p(m + 1)}-${p(lastOfMonth(y, m))}` });
  }
  return out;
}

function foldRows(rows: { b: number; model: string; calls: number; micros: number; unpriced: number }[], labels: string[]): Period[] {
  const periods: Period[] = labels.map((label) => ({ label, micros: 0, calls: 0, unpriced: 0, byModel: {} }));
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
  return foldRows(rows, Array.from({ length: count }, (_, i) => addDays(from, i * bucketDays)));
}

/** One period for each calendar month of the range. */
export function loadMonthPeriods(db: Ledger, months: readonly { label: string; from: string; to: string }[]): Period[] {
  const first = months[0]?.from;
  const last = months[months.length - 1]?.to;
  if (!first || !last) return [];
  const { since, until } = rangeBounds(first, last);
  const rows = db
    .prepare(
      `SELECT substr(m.ts, 1, 7) AS ym, m.model AS model, COUNT(*) AS calls,
              SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros ELSE 0 END) AS micros,
              SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) AS unpriced
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id
       WHERE m.ts >= ? AND m.ts < ? GROUP BY ym, m.model`,
    )
    .all(since, until) as unknown as { ym: string; model: string; calls: number; micros: number; unpriced: number }[];
  const index = new Map(months.map((m, i) => [m.label.slice(0, 7), i]));
  return foldRows(rows.flatMap((r) => (index.has(r.ym) ? [{ b: index.get(r.ym) as number, model: r.model, calls: r.calls, micros: r.micros, unpriced: r.unpriced }] : [])), months.map((m) => m.label));
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
  /** Month mode only: each leading model's cost in each period so far. */
  mseries: Record<string, number[]>;
}

const emptyState = (): State => ({ n: 0, total: 0, calls: 0, unpriced: 0, peakLabel: "", peakMicros: -1, models: {}, series: [], mseries: {} });

function encode(s: State, month: boolean): string {
  const top = Object.entries(s.models)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_MODELS);
  const base = { n: s.n, total: s.total, calls: s.calls, unpriced: s.unpriced, peak: [s.peakLabel, s.peakMicros], models: Object.fromEntries(top), series: s.series };
  const payload = JSON.stringify(month ? { ...base, mseries: s.mseries } : base);
  return `COMPLETED: ${s.n} periods read\nREMAINING: later periods\nDECISIONS: none\nCONTEXT: ${payload}`;
}

function decode(carryover: string): State {
  const m = /CONTEXT: (\{.*\})/s.exec(carryover);
  if (!m) return emptyState();
  const o = JSON.parse(m[1] as string) as { n: number; total: number; calls: number; unpriced: number; peak: [string, number]; models: Record<string, number>; series: number[]; mseries?: Record<string, number[]> };
  return { n: o.n, total: o.total, calls: o.calls, unpriced: o.unpriced, peakLabel: o.peak[0], peakMicros: o.peak[1], models: o.models, series: o.series, mseries: o.mseries ?? {} };
}

/** Fold one period into the state. Models that fall out of the top five keep their cost in `total` only. */
function fold(s: State, p: Period, month: boolean): State {
  const models = { ...s.models };
  for (const [k, v] of Object.entries(p.byModel)) models[k] = (models[k] ?? 0) + v;
  const peak = p.micros > s.peakMicros;
  const next: State = {
    n: s.n + 1,
    total: s.total + p.micros,
    calls: s.calls + p.calls,
    unpriced: s.unpriced + p.unpriced,
    peakLabel: peak ? p.label : s.peakLabel,
    peakMicros: peak ? p.micros : s.peakMicros,
    models,
    series: [...s.series, p.micros],
    mseries: {},
  };
  if (month) {
    // Each model seen so far gets one more entry (zero where it was absent), and only the leading ones by total cost keep their series.
    const names = new Set([...Object.keys(s.mseries), ...Object.keys(p.byModel)]);
    const grown: Record<string, number[]> = {};
    for (const k of names) grown[k] = [...(s.mseries[k] ?? Array.from({ length: s.n }, () => 0)), p.byModel[k] ?? 0];
    const lead = Object.entries(models)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SERIES_MODELS)
      .map(([k]) => k);
    for (const k of lead) if (grown[k]) next.mseries[k] = grown[k] as number[];
  }
  return next;
}

const sha = (x: unknown): string => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");

export interface DigestOptions {
  /** Keep the engine's record of the run in this folder; `desk markovian history` reads it. */
  historyDir?: string;
  /** Called as each chunk is read, with the engine's own progress. */
  onProgress?: (p: { chunk: number; of: number; tokensUsed: number }) => void;
  /** Read and write `carry_state`. On by default. A connection that may not write (Ask's steps run read-only) reads what is there and keeps nothing. */
  cache?: boolean;
}

/**
 * Work out and keep the carry state of every whole calendar month the ledger holds, from the first month to the last, so that a question about the year reads it back instead of
 * folding it again. Returns the number of periods and how many were already kept; null when the ledger has fewer than three whole months.
 */
export async function warmCarry(db: Ledger, opts: Pick<DigestOptions, "historyDir" | "onProgress"> = {}): Promise<{ periods: number; reused: number; from: string; to: string } | null> {
  const r = db.prepare("SELECT MIN(substr(ts, 1, 10)) AS a, MAX(substr(ts, 1, 10)) AS b FROM model_call").get() as { a: string | null; b: string | null };
  if (!r.a || !r.b) return null;
  const from = `${r.a.slice(0, 7)}-01`;
  // The last whole month is the one before the month of the last call, unless the last call is on its last day.
  const endOfThatMonth = addDays(new Date(Date.UTC(Number(r.b.slice(0, 4)), Number(r.b.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
  const to = r.b === endOfThatMonth ? r.b : addDays(`${r.b.slice(0, 7)}-01`, -1);
  if (to < from || monthBuckets(from, to) === null) return null;
  const d = await digestRange(db, from, to, opts);
  return { periods: d.periods, reused: d.reusedPeriods, from, to };
}

/** Every period's state is kept under a digest of everything read up to it, so only periods whose rows changed (and those after them) are worked out again. */
function cachedFold(db: Ledger, cache: boolean, key: { from: string; kind: BucketKind; days: number }, step: number, prevChain: string, period: Period, prev: State, month: boolean): { state: State; chain: string; reused: boolean } {
  const chain = sha([prevChain, period]);
  if (cache) {
    try {
      const row = db.prepare("SELECT chain_digest AS chain, state, state_digest AS digest FROM carry_state WHERE range_from = ? AND bucket_kind = ? AND bucket_days = ? AND step = ?").get(key.from, key.kind, key.days, step) as { chain: string; state: string; digest: string } | undefined;
      // Kept only when it was worked out from these very periods, and the text itself is what was written: a state edited afterwards is worked out again.
      if (row && row.chain === chain && row.digest === sha(row.state)) return { state: JSON.parse(row.state) as State, chain, reused: true };
    } catch {
      /* a ledger from before this table: worked out without it */
    }
  }
  const state = fold(prev, period, month);
  const text = JSON.stringify(state);
  if (cache) {
    try {
      db.prepare(
        `INSERT INTO carry_state (range_from, bucket_kind, bucket_days, step, period_label, chain_digest, state, state_digest, tokens, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (range_from, bucket_kind, bucket_days, step) DO UPDATE SET period_label = excluded.period_label, chain_digest = excluded.chain_digest, state = excluded.state, state_digest = excluded.state_digest, tokens = excluded.tokens, computed_at = excluded.computed_at`,
      ).run(key.from, key.kind, key.days, step, period.label, chain, text, sha(text), Math.ceil(encode(state, month).length / 4), new Date().toISOString());
    } catch {
      /* a ledger that cannot be written, or an older one: the state is simply not kept */
    }
  }
  return { state, chain, reused: false };
}

export async function digestRange(db: Ledger, from: string, to: string, opts: DigestOptions = {}): Promise<RangeDigest> {
  const span = daysBetween(from, to) + 1;
  const months = monthBuckets(from, to);
  const month = months !== null;
  const bucketDays = month ? 30 : bucketDaysFor(span);
  const periods = month ? loadMonthPeriods(db, months) : loadPeriods(db, from, to, bucketDays);
  const mod = await loadEngineModule("markovian");
  const Ctor = mod["Markovian"] as new (o: { chunkConfig: { maxChunks: number; carryoverTokens: number }; historyDir?: string }) => MarkovianLike;
  const engine = new Ctor({ chunkConfig: { maxChunks: MAX_CHUNKS, carryoverTokens: CARRYOVER_TOKENS }, ...(opts.historyDir ? { historyDir: opts.historyDir } : {}) });
  if (opts.onProgress) engine.onProgress((s) => opts.onProgress?.({ chunk: s.currentChunk, of: periods.length, tokensUsed: s.tokensUsed }));

  let last: State = emptyState();
  let chain = "";
  let maxCarry = 0;
  let reused = 0;
  const key = { from, kind: (month ? "month" : "days") as BucketKind, days: bucketDays };
  const run = await engine.run({
    goal: `Read ${from} to ${to} one period at a time and keep totals`,
    mode: "RESEARCH",
    reflect: false,
    stepFn: ({ carryover, step }) => {
      // Only the carryover crosses from one chunk to the next: the period itself is the whole new input.
      const state = decode(carryover);
      const period = periods[step];
      if (!period) return { content: "no more periods\n[TASK_COMPLETE]" };
      const f = cachedFold(db, opts.cache !== false, key, step, chain, period, state, month);
      chain = f.chain;
      if (f.reused) reused += 1;
      const next = f.state;
      last = next;
      maxCarry = Math.max(maxCarry, Math.ceil(carryover.length / 4));
      const done = step === periods.length - 1;
      // The chunk's visible output is what it read: the period and what each model cost in it. The state it carries on is the checkpoint, which the engine strips from the output.
      const read = Object.entries(period.byModel).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m, v]) => `${m} ${v}`).join("; ");
      return { content: `${period.label}: ${read}\n${done ? "[TASK_COMPLETE]" : `[STATE_CHECKPOINT] ${encode(next, month)}`}` };
    },
  });
  if (run.status !== "completed") throw new Error(`Markovian run did not complete: ${run.status}${run.error ? ` (${run.error})` : ""}`);
  const peak = last.peakMicros >= 0 && last.total > 0 ? { label: last.peakLabel, micros: last.peakMicros } : null;
  const lead = Object.entries(last.models)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([model, micros]) => ({ model, micros }));
  // A model grew when its cost in every period was more than in the one before, from a first period in which it was used at all.
  const growers = !month || last.n < MIN_MONTHS ? [] : Object.entries(last.mseries).filter(([, s]) => s.length === last.n && (s[0] ?? 0) > 0 && s.every((v, i) => i === 0 || v > (s[i - 1] as number))).map(([m]) => m).sort();
  return {
    from,
    to,
    bucketDays,
    bucketKind: key.kind,
    periods: last.n,
    totalMicros: last.total,
    totalCalls: last.calls,
    unpricedCalls: last.unpriced,
    peak,
    topModels: lead,
    series: last.series,
    modelSeries: month ? last.mseries : {},
    growers,
    chunks: run.chunks.length,
    maxCarryoverTokens: maxCarry,
    carryoverBudgetTokens: run.chunkConfig.carryoverTokens,
    status: run.status,
    tokensUsed: run.totalTokensUsed,
    tokensSaved: run.totalTokensSaved,
    efficiencyPercent: Math.round(run.efficiencyPercent * 10) / 10,
    reusedPeriods: reused,
  };
}

/** The engine's record of past runs in a folder: how many, and what reading each range in pieces saved over reading it whole. */
export async function markovianHistory(historyDir: string): Promise<{ runs: { id: string; at: string; prompt: string; chunks: number; tokensUsed: number; tokensSaved: number; efficiencyPercent: number }[]; stats: { totalRuns: number; totalTokensUsed: number; totalTokensSaved: number; averageEfficiency: number } }> {
  const mod = await loadEngineModule("markovian");
  const Ctor = mod["Markovian"] as new (o: { chunkConfig: { maxChunks: number; carryoverTokens: number }; historyDir?: string }) => MarkovianLike;
  const engine = new Ctor({ chunkConfig: { maxChunks: MAX_CHUNKS, carryoverTokens: CARRYOVER_TOKENS }, historyDir });
  const s = engine.history.cumulativeStats();
  return {
    runs: engine.history.list().map((r) => ({ id: r.id, at: new Date(r.timestamp).toISOString(), prompt: r.prompt, chunks: r.chunks.length, tokensUsed: r.totalTokensUsed, tokensSaved: r.totalTokensSaved, efficiencyPercent: Math.round(r.efficiencyPercent * 10) / 10 })),
    stats: { totalRuns: s.totalRuns, totalTokensUsed: s.totalTokensUsed, totalTokensSaved: s.totalTokensSaved, averageEfficiency: Math.round(s.averageEfficiency * 10) / 10 },
  };
}

/** What the engine projects for reading n periods: the prompt it would send for the last one with the whole history carried, against with the bounded carry. */
export async function projection(periods: number): Promise<{ step: number; standard: number; markovian: number }[]> {
  const mod = await loadEngineModule("markovian");
  const curve = mod["projectionCurve"] as (cfg: unknown, steps: number) => { step: number; standard: number; markovian: number }[];
  const Ctor = mod["Markovian"] as new (o: { chunkConfig: { maxChunks: number; carryoverTokens: number } }) => MarkovianLike;
  return curve(new Ctor({ chunkConfig: { maxChunks: MAX_CHUNKS, carryoverTokens: CARRYOVER_TOKENS } }).config, periods);
}
