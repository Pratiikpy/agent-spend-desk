import { effectiveRow, priceCall } from "../cost/price-call.ts";
import { restrictCheck } from "../policy/restrict.ts";
import { replayPolicy, type ReplayCall, type ReplaySession } from "../replay/policy-replay.ts";
import type { Policy } from "../policy/types.ts";
import { promptTokens, resolvePrice, type PriceSnapshot } from "../pricing/pricebook.ts";
import { LIMITS, type Row } from "./format.ts";

/**
 * The registry of computations a dossier claim may cite (spec 11.1, 11.2, 11.5 V6-D). Each is a pure function
 * of cited ledger rows, price snapshots and policy documents, versioned in its name. The verifier recomputes
 * a claim by running the function named in it; a name this registry does not know is INDETERMINATE, never PASS.
 * All money and shares are integers: micro-USD, basis points, and milli-units for intervals.
 */
export type Scalar = string | number | boolean | null;
export type Where = Record<string, Scalar | { in: Scalar[] }>;

export interface RowRef {
  stream: string;
  seq: number;
}

export interface CompSpec {
  fn: string;
  args: Record<string, unknown>;
  range?: { stream: string; from: number; to: number };
  rows?: RowRef[];
}

export interface CompEnv {
  rows: ReadonlyMap<string, ReadonlyMap<number, Row>>;
  snapshots: ReadonlyMap<string, PriceSnapshot>;
  policies: ReadonlyMap<string, Policy>;
}

export interface Computed {
  /** Named integer outputs. `value` is the primary one. */
  values: Record<string, number>;
  rowsUsed: number;
  /** Classes a claim of this computation may carry; empty means a claim must carry none. */
  allowedClasses: readonly string[];
}

export class ComputationError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.code = code;
  }
}

function fail(code: string, detail: string): never {
  throw new ComputationError(code, detail);
}

export function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function dataOf(row: Row): Record<string, unknown> {
  if (typeof row.data !== "object" || row.data === null || Array.isArray(row.data)) fail("row_not_object", `row ${row.stream}#${row.seq} data is not an object`);
  return row.data as Record<string, unknown>;
}

function parseWhere(raw: unknown): Where {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("bad_args", "where must be an object");
  const out: Where = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isScalar(v)) out[k] = v;
    else if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray((v as { in?: unknown }).in) && ((v as { in: unknown[] }).in).every(isScalar)) {
      out[k] = { in: (v as { in: Scalar[] }).in };
    } else fail("bad_args", `where.${k} must be a scalar or {in: [...]}`);
  }
  return out;
}

function matches(row: Row, where: Where): boolean {
  const d = dataOf(row);
  for (const [k, want] of Object.entries(where)) {
    const have = d[k];
    if (typeof want === "object" && want !== null) {
      if (!want.in.some((w) => w === have)) return false;
    } else if (have !== want) return false;
  }
  return true;
}

function intField(row: Row, name: string): number {
  const v = dataOf(row)[name];
  if (typeof v !== "number" || !Number.isSafeInteger(v)) fail("bad_field", `row ${row.stream}#${row.seq}: field ${name} is not a safe integer`);
  return v;
}

function strField(row: Row, name: string): string {
  const v = dataOf(row)[name];
  if (typeof v !== "string") fail("bad_field", `row ${row.stream}#${row.seq}: field ${name} is not a string`);
  return v;
}

function argInt(args: Record<string, unknown>, name: string, min: number, max: number): number {
  const v = args[name];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) fail("bad_args", `${name} must be an integer in [${min}, ${max}]`);
  return v;
}

function argStr(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || v.length === 0) fail("bad_args", `${name} must be a non-empty string`);
  return v;
}

function allowedArgs(args: Record<string, unknown>, names: readonly string[]): void {
  for (const k of Object.keys(args)) if (!names.includes(k)) fail("bad_args", `unknown argument ${k}`);
}

/** The rows a computation reads. A range must be complete and chain-linked, so it cannot silently omit a row. */
export function selectRows(spec: CompSpec, env: CompEnv): Row[] {
  if ((spec.range === undefined) === (spec.rows === undefined)) fail("bad_spec", "give exactly one of range or rows");
  if (spec.range) {
    const { stream, from, to } = spec.range;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) fail("bad_spec", "range needs 0 <= from <= to");
    if (to - from + 1 > LIMITS.maxRows) fail("limit_exceeded", "range is larger than the row limit");
    const byseq = env.rows.get(stream);
    const out: Row[] = [];
    for (let s = from; s <= to; s += 1) {
      const r = byseq?.get(s);
      if (!r) fail("row_missing", `range ${stream}#${from}..${to} is not complete: #${s} is absent from the bundle`);
      const prev = out[out.length - 1];
      if (prev && r.prev_hash !== prev.row_hash) fail("range_broken", `${stream}#${s} does not link to #${s - 1}`);
      out.push(r);
    }
    return out;
  }
  const refs = spec.rows as RowRef[];
  if (refs.length === 0) fail("bad_spec", "rows must not be empty");
  if (refs.length > LIMITS.maxRows) fail("limit_exceeded", "too many cited rows");
  const seen = new Set<string>();
  return refs.map((ref) => {
    const key = `${ref.stream}#${ref.seq}`;
    if (seen.has(key)) fail("duplicate_citation", `${key} is cited twice in one computation`);
    seen.add(key);
    const r = env.rows.get(ref.stream)?.get(ref.seq);
    if (!r) fail("row_missing", `${key} is cited but absent from the bundle`);
    return r;
  });
}

function sumRows(rows: readonly Row[], field: string): number {
  let total = 0n;
  for (const r of rows) total += BigInt(intField(r, field));
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) fail("overflow", `sum of ${field} is not a safe integer`);
  return Number(total);
}

/** Round half up for a non-negative numerator and positive denominator, exact in BigInt. */
export function divRoundBig(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Run = (spec: CompSpec, rows: Row[], env: CompEnv) => Computed;

const sum: Run = (spec, rows) => {
  allowedArgs(spec.args, ["field", "where", "class_field"]);
  const field = argStr(spec.args, "field");
  const picked = rows.filter((r) => matches(r, parseWhere(spec.args["where"])));
  let classes: string[] = [];
  const cf = spec.args["class_field"];
  if (cf !== undefined) {
    if (typeof cf !== "string") fail("bad_args", "class_field must be a string");
    const values = new Set(picked.map((r) => strField(r, cf)));
    if (values.size > 1) fail("mixed_classes", `rows mix cost classes: ${[...values].join(", ")}`);
    classes = [...values];
  } else classes = ["computed"];
  return { values: { value: sumRows(picked, field) }, rowsUsed: picked.length, allowedClasses: classes };
};

const count: Run = (spec, rows) => {
  allowedArgs(spec.args, ["where"]);
  const picked = rows.filter((r) => matches(r, parseWhere(spec.args["where"])));
  return { values: { value: picked.length }, rowsUsed: picked.length, allowedClasses: ["computed"] };
};

const ratioBp: Run = (spec, rows) => {
  allowedArgs(spec.args, ["field", "where", "denom_where"]);
  const field = argStr(spec.args, "field");
  const num = sumRows(rows.filter((r) => matches(r, parseWhere(spec.args["where"]))), field);
  const den = sumRows(rows.filter((r) => matches(r, parseWhere(spec.args["denom_where"]))), field);
  if (den <= 0 || num < 0) fail("division_by_zero", "the denominator is not positive or the numerator is negative");
  return { values: { value: Number(divRoundBig(BigInt(num) * 10_000n, BigInt(den))) }, rowsUsed: rows.length, allowedClasses: ["computed"] };
};

const costMicros: Run = (spec, rows, env) => {
  allowedArgs(spec.args, ["where"]);
  const picked = rows.filter((r) => matches(r, parseWhere(spec.args["where"])));
  let total = 0n;
  let unpriced = 0;
  for (const r of picked) {
    const snapshot = env.snapshots.get(strField(r, "snapshot_id"));
    if (!snapshot) fail("snapshot_missing", `${r.stream}#${r.seq} cites price snapshot ${strField(r, "snapshot_id")}, which is not in the bundle`);
    const recorded = intField(r, "cost_micros");
    // A row may carry the speed and the inference geography the call was priced with; an older row does not, and is priced as before.
    const price = priceCall(snapshot, {
      model: strField(r, "model"),
      tokens: {
        inputTokens: intField(r, "input_tokens"),
        outputTokens: intField(r, "output_tokens"),
        cacheReadTokens: intField(r, "cache_read_tokens"),
        cacheWrite5mTokens: intField(r, "cache_write_5m_tokens"),
        cacheWrite1hTokens: intField(r, "cache_write_1h_tokens"),
      },
      speed: typeof dataOf(r)["speed"] === "string" ? (dataOf(r)["speed"] as string) : null,
      inferenceGeo: typeof dataOf(r)["inference_geo"] === "string" ? (dataOf(r)["inference_geo"] as string) : null,
    });
    let cost = 0;
    if (price.kind === "priced") cost = price.totalMicros;
    else unpriced += 1;
    if (cost !== recorded) fail("row_cost_mismatch", `${r.stream}#${r.seq}: recorded ${recorded} micro-USD, recomputed ${cost}`);
    total += BigInt(cost);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail("overflow", "total cost is not a safe integer");
  return { values: { value: Number(total), unpriced_calls: unpriced }, rowsUsed: picked.length, allowedClasses: ["estimated"] };
};

const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens"] as const;

/**
 * A total over rows that each stand for many calls: one row per day, model, tier, speed and geography, holding the sums of the
 * calls' tokens and of the costs the ledger recorded for them. Each call's cost is its exact list-price figure rounded half up to a
 * micro-USD, so the rows' recorded cost can differ from the exact figure over their summed tokens by less than half a micro-USD per
 * call, and by no more. A row that is further off than that is refused. A row for calls priced at the long-prompt rates must hold
 * more prompt tokens than the line allows each call; the sum cannot show that each call was over it, and the dossier says so.
 * A row for a model with no price must cost nothing and the snapshot must really have no price for it.
 */
const costBounds: Run = (spec, rows, env) => {
  allowedArgs(spec.args, ["where"]);
  const picked = rows.filter((r) => matches(r, parseWhere(spec.args["where"])));
  let total = 0n;
  let calls = 0n;
  let unpriced = 0n;
  let long = 0n;
  for (const r of picked) {
    const d = dataOf(r);
    const where = `${r.stream}#${r.seq}`;
    const n = intField(r, "calls");
    if (n < 1) fail("bad_field", `${where}: calls must be at least 1`);
    const snapshot = env.snapshots.get(strField(r, "snapshot_id"));
    if (!snapshot) fail("snapshot_missing", `${where} cites price snapshot ${strField(r, "snapshot_id")}, which is not in the bundle`);
    const recorded = intField(r, "cost_micros");
    if (recorded < 0) fail("bad_field", `${where}: cost_micros is negative`);
    const tier = strField(r, "tier");
    if (tier !== "std" && tier !== "long") fail("bad_field", `${where}: tier must be std or long`);
    if (typeof d["priced"] !== "boolean") fail("bad_field", `${where}: priced must be true or false`);
    const resolved = resolvePrice(snapshot, strField(r, "model"));
    calls += BigInt(n);
    if (!d["priced"]) {
      if (resolved.kind !== "unpriced") fail("row_priced_mismatch", `${where}: marked unpriced, but the snapshot has a price for ${strField(r, "model")}`);
      if (recorded !== 0) fail("row_cost_mismatch", `${where}: an unpriced row records ${recorded} micro-USD, not 0`);
      unpriced += BigInt(n);
      continue;
    }
    if (resolved.kind === "unpriced") fail("row_priced_mismatch", `${where}: marked priced, but the snapshot has no price for ${strField(r, "model")}`);
    const speed = typeof d["speed"] === "string" ? (d["speed"] as string) : null;
    const geo = typeof d["inference_geo"] === "string" ? (d["inference_geo"] as string) : null;
    const base = effectiveRow(resolved.row, speed, geo).row;
    const tokens = Object.fromEntries(TOKEN_FIELDS.map((f) => [f, intField(r, f)])) as Record<(typeof TOKEN_FIELDS)[number], number>;
    let rates = base;
    if (tier === "long") {
      if (!base.longPrompt) fail("row_tier_mismatch", `${where}: marked long-prompt, but ${strField(r, "model")} has no long-prompt rates here`);
      const prompt = promptTokens({ inputTokens: tokens.input_tokens, cacheReadTokens: tokens.cache_read_tokens, cacheWrite5mTokens: tokens.cache_write_5m_tokens, cacheWrite1hTokens: tokens.cache_write_1h_tokens });
      if (BigInt(prompt) <= BigInt(n) * BigInt(base.longPrompt.overPromptTokens)) fail("row_tier_mismatch", `${where}: marked long-prompt, but its ${n} calls hold ${prompt} prompt tokens, not more than ${n} times ${base.longPrompt.overPromptTokens}`);
      rates = { ...base, ...base.longPrompt };
      long += BigInt(n);
    }
    const numerator =
      BigInt(tokens.input_tokens) * BigInt(rates.inputPerMTokMicros) +
      BigInt(tokens.output_tokens) * BigInt(rates.outputPerMTokMicros) +
      BigInt(tokens.cache_read_tokens) * BigInt(rates.cacheReadPerMTokMicros) +
      BigInt(tokens.cache_write_5m_tokens) * BigInt(rates.cacheWrite5mPerMTokMicros) +
      BigInt(tokens.cache_write_1h_tokens) * BigInt(rates.cacheWrite1hPerMTokMicros);
    // Each call rounds to the nearest micro-USD, a half upward, so the error of n calls lies in (-n/2, n/2] micro-USD; times 1e6 below.
    const off = BigInt(recorded) * 1_000_000n - numerator;
    const slack = BigInt(n) * 500_000n;
    if (off > slack || off <= -slack) fail("row_cost_mismatch", `${where}: recorded ${recorded} micro-USD, but ${n} calls with those tokens cost ${(Number(numerator) / 1e6).toFixed(3)} micro-USD at the pinned prices, further off than rounding allows`);
    total += BigInt(recorded);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail("overflow", "total cost is not a safe integer");
  return { values: { value: Number(total), calls: Number(calls), unpriced_calls: Number(unpriced), long_prompt_calls: Number(long) }, rowsUsed: picked.length, allowedClasses: ["estimated"] };
};

const pairedDiffCi: Run = (spec, rows) => {
  allowedArgs(spec.args, ["a", "b", "seed", "resamples", "level_bp", "where"]);
  const a = argStr(spec.args, "a");
  const b = argStr(spec.args, "b");
  const seed = argInt(spec.args, "seed", 0, 0xffffffff);
  const resamples = argInt(spec.args, "resamples", 100, LIMITS.maxResamples);
  const level = argInt(spec.args, "level_bp", 5_000, 9_999);
  const picked = rows.filter((r) => matches(r, parseWhere(spec.args["where"])));
  if (picked.length < 2) fail("too_few_rows", "a paired interval needs at least two rows");
  if (picked.length > 5_000) fail("limit_exceeded", "paired interval is limited to 5000 pairs");
  const diffs = picked.map((r) => intField(r, b) - intField(r, a));
  const n = diffs.length;
  const rng = mulberry32(seed);
  const means = new Array<number>(resamples);
  for (let i = 0; i < resamples; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) s += diffs[Math.floor(rng() * n)] as number;
    means[i] = s / n;
  }
  means.sort((x, y) => x - y);
  const lo = Math.floor((resamples * (10_000 - level)) / 20_000);
  const hi = resamples - 1 - lo;
  const milli = (x: number): number => Math.floor(x * 1000 + 0.5);
  const observed = diffs.reduce((p, q) => p + q, 0) / n;
  return { values: { value: milli(observed), low: milli(means[lo] as number), high: milli(means[hi] as number) }, rowsUsed: n, allowedClasses: ["computed"] };
};

const restrictNarrows: Run = (spec, _rows, env) => {
  allowedArgs(spec.args, ["from", "to", "domain"]);
  const prev = env.policies.get(argStr(spec.args, "from"));
  const next = env.policies.get(argStr(spec.args, "to"));
  if (!prev || !next) fail("policy_missing", "from and to must name bundled policy versions");
  const domain = spec.args["domain"] === undefined ? {} : (spec.args["domain"] as Record<string, readonly string[]>);
  const r = restrictCheck(prev, next, domain);
  if (r.outsideFragment) fail("outside_fragment", "the policy grid is too large to check exhaustively");
  return { values: { value: r.narrows ? 1 : 0, cells: r.gridSize }, rowsUsed: 0, allowedClasses: [] };
};

const REPLAY_METRICS = ["sessions", "landed_total", "paused", "landed_blocked", "saved_micros", "total_micros", "asked_calls"] as const;

function replayCallOf(raw: unknown, where: string): ReplayCall {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("bad_field", `${where}: a call is not an object`);
  const c = raw as Record<string, unknown>;
  const int = (k: string): number => {
    const v = c[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) fail("bad_field", `${where}: call field ${k} is not a non-negative safe integer`);
    return v;
  };
  const text = (k: string): string => {
    const v = c[k];
    if (typeof v !== "string" || v.length === 0 || v.length > 200) fail("bad_field", `${where}: call field ${k} is not a short string`);
    return v;
  };
  return { offsetMs: int("o"), costMicros: int("c"), model: text("m"), wasteRule: text("w"), recoverableMicros: int("r") };
}

/**
 * Replay a bundled policy over bundled sessions and report one figure. Each row of the cited stream is one
 * session: who, where, whether its work landed, when it started, and its calls (offset, cost, model, waste rule,
 * what stopping would save). The same interpreter that decides in the gate decides here, so a figure a dossier
 * states about a policy is the figure a stranger gets by running that policy over those rows.
 */
const policyReplay: Run = (spec, rows, env) => {
  allowedArgs(spec.args, ["policy", "metric", "ask_as"]);
  const policy = env.policies.get(argStr(spec.args, "policy"));
  if (!policy) fail("policy_missing", "policy must name a bundled policy version");
  const metric = argStr(spec.args, "metric");
  if (!(REPLAY_METRICS as readonly string[]).includes(metric)) fail("bad_args", `metric must be one of ${REPLAY_METRICS.join(", ")}`);
  const askAs = spec.args["ask_as"] === undefined ? "approved" : spec.args["ask_as"];
  if (askAs !== "approved" && askAs !== "denied") fail("bad_args", "ask_as must be approved or denied");
  const sessions: ReplaySession[] = rows.map((r) => {
    const where = `${r.stream}#${r.seq}`;
    const d = dataOf(r);
    const text = (k: string): string => {
      const v = d[k];
      if (typeof v !== "string" || v.length === 0 || v.length > 200) fail("bad_field", `${where}: field ${k} is not a short string`);
      return v;
    };
    const calls = d["calls"];
    if (!Array.isArray(calls) || calls.length === 0 || calls.length > 100_000) fail("bad_field", `${where}: calls must be a non-empty array`);
    if (typeof d["landed"] !== "boolean") fail("bad_field", `${where}: landed must be true or false`);
    return { id: text("id"), person: text("person"), project: text("project"), agent: text("agent"), taskType: text("task_type"), startMs: intField(r, "start_ms"), landed: d["landed"], calls: calls.map((c) => replayCallOf(c, where)) };
  });
  sessions.sort((a, b) => a.startMs - b.startMs);
  const result = replayPolicy(policy, sessions, { askAs });
  const value =
    metric === "sessions" ? sessions.length
    : metric === "landed_total" ? result.landedTotal
    : metric === "paused" ? result.paused.length
    : metric === "landed_blocked" ? result.landedBlocked.length
    : metric === "saved_micros" ? result.savedMicros
    : metric === "total_micros" ? result.totalMicros
    : result.askedCalls;
  return { values: { value }, rowsUsed: rows.length, allowedClasses: ["computed"] };
};

export interface Registered {
  run: Run;
  needsRows: boolean;
}

export const COMPUTATIONS: Readonly<Record<string, Registered>> = {
  "sum@1": { run: sum, needsRows: true },
  "count@1": { run: count, needsRows: true },
  "ratio_bp@1": { run: ratioBp, needsRows: true },
  "cost_micros@1": { run: costMicros, needsRows: true },
  "cost_bounds@1": { run: costBounds, needsRows: true },
  "paired_diff_ci@1": { run: pairedDiffCi, needsRows: true },
  "restrict_narrows@1": { run: restrictNarrows, needsRows: false },
  "policy_replay@1": { run: policyReplay, needsRows: true },
};

export function knownComputation(fn: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPUTATIONS, fn);
}

/** Run one computation. Throws ComputationError with a stable code; an unknown name is the caller's INDETERMINATE. */
export function runComputation(spec: CompSpec, env: CompEnv): Computed {
  const reg = COMPUTATIONS[spec.fn];
  if (!reg || !Object.prototype.hasOwnProperty.call(COMPUTATIONS, spec.fn)) fail("unknown_computation", spec.fn);
  const rows = reg.needsRows ? selectRows(spec, env) : [];
  if (!reg.needsRows && (spec.range !== undefined || spec.rows !== undefined)) fail("bad_spec", `${spec.fn} takes no rows`);
  return reg.run(spec, rows, env);
}
