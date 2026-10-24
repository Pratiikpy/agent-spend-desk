import { askThresholdMicros, evaluate, routeOf } from "./evaluate.ts";
import { numericOf } from "./types.ts";
import { capDim, FINITE_DIMS, NUMERIC_DIMS, VERDICT_ORDER, type Condition, type FiniteDim, type NumericDim, type Policy, type Request, type Verdict } from "./types.ts";

export const OTHER = "\u0000other";

export interface Widening {
  request: Request;
  was: Verdict;
  now: Verdict;
}

export interface RouteChange {
  request: Request;
  was: string;
  now: string;
}

export interface RestrictResult {
  /** True when the new policy permits nothing the old one denied, over every cell of the grid. */
  narrows: boolean;
  /** The first request the new policy treats more permissively, if any. */
  widening?: Widening;
  /** Route changes are never narrowings: they change behaviour, so each needs approval with a replay. */
  routeChanges: RouteChange[];
  gridSize: number;
  /** Dimensions that appear in no rule of either policy and are therefore one cell each. */
  mergedDims: string[];
  /** True when the grid was too large; the caller must send the change to a stronger checker. */
  outsideFragment: boolean;
}

function conditionsOf(policy: Policy): Condition[] {
  return [...policy.rules.map((r) => r.when), ...policy.approvals.map((a) => a.when)];
}

function patternSample(pattern: string): string {
  return pattern.replaceAll("*", "~");
}

/** Values to test for one finite dimension: every literal, a sample of every pattern, the caller's domain, and "other". */
function finiteValues(dim: FiniteDim, policies: readonly Policy[], domain: readonly string[]): string[] | null {
  const values = new Set<string>();
  let used = false;
  for (const p of policies) {
    for (const c of conditionsOf(p)) {
      const set = c.finite[dim];
      if (set === undefined) continue;
      used = true;
      for (const m of set) values.add(m.includes("*") ? patternSample(m) : m);
    }
  }
  if (dim === "model") {
    // Route rules read the model too: their map keys must be testable values, or a route change would go unseen.
    for (const p of policies) {
      for (const r of p.rules) {
        if (r.kind !== "route") continue;
        used = true;
        for (const [from, to] of Object.entries(r.modelMap)) {
          values.add(from.includes("*") ? patternSample(from) : from);
          values.add(to.includes("*") ? patternSample(to) : to);
        }
      }
    }
  }
  if (!used) return null;
  for (const d of domain) values.add(d);
  values.add(OTHER);
  return [...values];
}

/** Integer cut points: the value space is split into half-open cells [c_i, c_(i+1)) that no atom can cross. */
function numericCuts(dim: NumericDim, policies: readonly Policy[]): number[] | null {
  const cuts = new Set<number>();
  let used = false;
  for (const p of policies) {
    for (const c of conditionsOf(p)) {
      const i = c.numeric[dim];
      if (i === undefined) continue;
      used = true;
      if (Number.isFinite(i.lo)) cuts.add(i.loOpen ? i.lo + 1 : i.lo);
      if (Number.isFinite(i.hi)) cuts.add(i.hiOpen ? i.hi : i.hi + 1);
    }
    for (const r of p.rules) {
      if (r.kind !== "permit" || !r.cap) continue;
      if (capDim(r.cap) !== dim) continue;
      used = true;
      cuts.add(r.cap.maxMicros + 1);
      cuts.add(askThresholdMicros(r.cap));
    }
  }
  if (!used) return null;
  const sorted = [...cuts].filter((c) => c > 0).sort((a, b) => a - b);
  return [0, ...sorted];
}

/**
 * Decide whether `next` only narrows `prev` (spec 10.4). The real interpreter is evaluated on one
 * representative of every cell of the grid; every atom is constant inside a cell, so this is exhaustive.
 * A dimension is merged to a single cell only if it appears in NO rule of EITHER policy. A dimension that an
 * unchanged rule mentions is never merged: one representative could sit inside that rule's forbid and
 * hide a request the edit newly allows.
 */
export function restrictCheck(prev: Policy, next: Policy, domain: Partial<Record<FiniteDim, readonly string[]>> = {}, maxCells = 1_000_000): RestrictResult {
  const policies = [prev, next];
  const finite: { dim: FiniteDim; values: string[] }[] = [];
  const numeric: { dim: NumericDim; cuts: number[] }[] = [];
  const merged: string[] = [];
  for (const dim of FINITE_DIMS) {
    const values = finiteValues(dim, policies, domain[dim] ?? []);
    if (values === null) merged.push(dim);
    else finite.push({ dim, values });
  }
  for (const dim of NUMERIC_DIMS) {
    const cuts = numericCuts(dim, policies);
    if (cuts === null) merged.push(dim);
    else numeric.push({ dim, cuts });
  }
  let size = 1;
  for (const f of finite) size *= f.values.length;
  for (const n of numeric) size *= n.cuts.length;
  if (size > maxCells) return { narrows: false, routeChanges: [], gridSize: size, mergedDims: merged, outsideFragment: true };

  const base: Request = {
    project: OTHER, person: OTHER, agent: OTHER, model: OTHER, task_type: OTHER, waste_rule: OTHER, action: OTHER,
    recoverable_micros: 0, day_spend_after_micros: 0, month_spend_after_micros: 0,
  };
  const dims = [...finite.map((f) => f.values.length), ...numeric.map((n) => n.cuts.length)];
  const counter = dims.map(() => 0);
  const routeChanges: RouteChange[] = [];
  let widening: Widening | undefined;
  for (let cell = 0; cell < size; cell += 1) {
    const req: Request = { ...base };
    finite.forEach((f, k) => {
      (req as unknown as Record<string, unknown>)[f.dim] = f.values[counter[k] ?? 0];
    });
    numeric.forEach((n, k) => {
      (req as unknown as Record<string, unknown>)[n.dim] = n.cuts[counter[finite.length + k] ?? 0];
    });
    const was = evaluate(prev, req).verdict;
    const now = evaluate(next, req).verdict;
    if (VERDICT_ORDER[now] > VERDICT_ORDER[was] && widening === undefined) widening = { request: req, was, now };
    if (now !== "deny" && was !== "deny" && routeChanges.length < 10) {
      const a = routeOf(prev, req);
      const b = routeOf(next, req);
      if (a !== b) routeChanges.push({ request: req, was: a, now: b });
    }
    for (let k = counter.length - 1; k >= 0; k -= 1) {
      counter[k] = (counter[k] ?? 0) + 1;
      if ((counter[k] ?? 0) < (dims[k] ?? 1)) break;
      counter[k] = 0;
    }
  }
  return { narrows: widening === undefined, ...(widening ? { widening } : {}), routeChanges, gridSize: size, mergedDims: merged, outsideFragment: false };
}

/** A sentence a person can read: "a request from person p-3 on model small-model at $38.50 of daily spend is newly allowed". */
export function describeWidening(w: Widening): string {
  const r = w.request;
  const bits: string[] = [];
  for (const dim of FINITE_DIMS) if (r[dim] !== OTHER) bits.push(`${dim.replace("_", " ")} ${r[dim]}`);
  const WORDS: Record<string, string> = {
    day_spend_after_micros: "spend that day",
    month_spend_after_micros: "spend that month",
    session_spend_after_micros: "spend in the session",
    spend_10m_after_micros: "spend in the last 10 minutes",
    spend_1h_after_micros: "spend in the last hour",
    model_day_spend_after_micros: "spend on that model that day",
    model_month_spend_after_micros: "spend on that model that month",
    project_day_spend_after_micros: "spend on that project that day",
    project_month_spend_after_micros: "spend on that project that month",
  };
  for (const [dim, words] of Object.entries(WORDS)) {
    const v = numericOf(r, dim as NumericDim);
    if (v > 0) bits.push(`${(v / 1_000_000).toFixed(2)} USD of ${words}`);
  }
  const where = bits.length > 0 ? bits.join(", ") : "any request";
  return `${where}: was ${w.was}, now ${w.now}`;
}
