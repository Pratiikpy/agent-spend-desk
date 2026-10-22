import { evaluate } from "../policy/evaluate.ts";
import { parsePolicy } from "../policy/parse.ts";
import { restrictCheck } from "../policy/restrict.ts";
import { VERDICT_ORDER, type Policy, type Request } from "../policy/types.ts";
import { seeded } from "../replay/wind-tunnel.ts";

/**
 * Differential fuzzing of the restrict-only check (spec 26.4). Random pairs of small policies are made, some by
 * narrowing, some by widening, some by leaving the meaning alone. The check's answer is compared with an oracle
 * that shares none of its code: random requests built from the policies' own literals, their numeric boundaries
 * and one step either side of each, evaluated by the interpreter. An escape is a pair the check calls narrowing
 * for which the oracle finds a request that is newly more permitted. A miss is the reverse. Neither may occur.
 */
export interface FuzzResult {
  pairs: number;
  seed: number;
  /** Pairs the check called "narrows only". */
  narrowing: number;
  escapes: { prev: unknown; next: unknown; request: Request }[];
  misses: { prev: unknown; next: unknown; request: Request }[];
}

const MODELS = ["m-big", "m-small", "m-mid"];
const WASTE = ["none", "C-LOOP-1", "C-IDLE-1"];
const TASKS = ["code", "docs"];

type Rng = () => number;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const usd = (micros: number): string => (micros / 1_000_000).toFixed(2);

function condition(r: Rng): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (r() < 0.5) c["model"] = { in: [...new Set([pick(r, MODELS), pick(r, MODELS)])] };
  if (r() < 0.4) c["waste_rule"] = { in: [pick(r, WASTE)] };
  if (r() < 0.3) c["task_type"] = { in: [pick(r, TASKS)] };
  if (r() < 0.5) {
    const lo = Math.floor(r() * 10) * 500_000;
    c["recoverable_usd"] = r() < 0.5 ? { gt: usd(lo) } : { gte: usd(lo) };
  }
  return c;
}

function ruleDoc(r: Rng, i: number): Record<string, unknown> {
  const x = r();
  if (x < 0.35) return { id: `p${i}`, kind: "permit", when: condition(r), ...(r() < 0.5 ? { cap: { window: "day", max_usd: usd((5 + Math.floor(r() * 20)) * 1_000_000), warn_at: 0.5, ask_at: 0.8 } } : {}) };
  if (x < 0.85) return { id: `f${i}`, kind: "forbid", when: condition(r), action: "pause_with_checkpoint" };
  return { id: `r${i}`, kind: "route", when: condition(r), route: { model_map: { [pick(r, MODELS)]: pick(r, MODELS) } } };
}

interface Doc {
  version: number;
  rules: Record<string, unknown>[];
  approvals: unknown[];
}

function basePolicy(r: Rng): Doc {
  const rules: Record<string, unknown>[] = [{ id: "allow-all", kind: "permit", when: {} }];
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i += 1) rules.push(ruleDoc(r, i));
  return { version: 1, rules, approvals: [] };
}

/** One edit of a kind: a narrowing, a widening or a change that leaves what is allowed alone. */
function edit(r: Rng, prev: Doc): { doc: Doc; kind: "narrow" | "widen" | "same" } {
  const doc: Doc = JSON.parse(JSON.stringify(prev)) as Doc;
  doc.version = prev.version + 1;
  const x = r();
  if (x < 0.34) {
    doc.rules.push({ id: `nf${doc.rules.length}`, kind: "forbid", when: condition(r), action: "pause_with_checkpoint" });
    return { doc, kind: "narrow" };
  }
  if (x < 0.67) {
    const forbids = doc.rules.filter((q) => q["kind"] === "forbid");
    if (forbids.length > 0 && r() < 0.7) doc.rules.splice(doc.rules.indexOf(pick(r, forbids)), 1);
    else doc.rules.push({ id: `np${doc.rules.length}`, kind: "permit", when: {} });
    return { doc, kind: "widen" };
  }
  doc.rules.push({ ...(doc.rules[0] as Record<string, unknown>), id: `dup${doc.rules.length}` });
  return { doc, kind: "same" };
}

function requestsFor(r: Rng, ...policies: Policy[]): Request[] {
  const cuts = new Set<number>([0, 1]);
  for (const p of policies) {
    for (const rule of p.rules) {
      const iv = rule.when.numeric["recoverable_micros"];
      if (iv) for (const v of [iv.lo, iv.hi]) if (Number.isFinite(v)) for (const d of [-1, 0, 1]) cuts.add(Math.max(0, v + d));
      if (rule.kind === "permit" && rule.cap) for (const d of [-1, 0, 1]) cuts.add(Math.max(0, rule.cap.maxMicros + d));
    }
  }
  const nums = [...cuts];
  const out: Request[] = [];
  for (let i = 0; i < 300; i += 1) {
    out.push({
      project: "proj", person: "person", agent: "agent", action: "call",
      model: r() < 0.9 ? pick(r, MODELS) : "m-other",
      task_type: pick(r, TASKS),
      waste_rule: pick(r, WASTE),
      recoverable_micros: pick(r, nums),
      day_spend_after_micros: pick(r, nums),
      month_spend_after_micros: pick(r, nums),
    });
  }
  return out;
}

/** `check` is the function under test; tests pass a deliberately broken one to prove the fuzzer can see an escape. */
export function fuzzRestrictCheck(opts: { pairs: number; seed: number }, check: typeof restrictCheck = restrictCheck): FuzzResult {
  const r = seeded(opts.seed);
  const result: FuzzResult = { pairs: 0, seed: opts.seed, narrowing: 0, escapes: [], misses: [] };
  for (let i = 0; i < opts.pairs; i += 1) {
    const prevDoc = basePolicy(r);
    const { doc: nextDoc } = edit(r, prevDoc);
    let prev: Policy;
    let next: Policy;
    try {
      prev = parsePolicy(prevDoc);
      next = parsePolicy(nextDoc);
    } catch {
      continue; // a generated document the parser refuses is not a pair
    }
    result.pairs += 1;
    const verdict = check(prev, next);
    if (verdict.outsideFragment) continue;
    if (verdict.narrows) result.narrowing += 1;
    let found: Request | null = null;
    for (const req of requestsFor(r, prev, next)) {
      if (VERDICT_ORDER[evaluate(next, req).verdict] > VERDICT_ORDER[evaluate(prev, req).verdict]) {
        found = req;
        break;
      }
    }
    if (verdict.narrows && found) result.escapes.push({ prev: prevDoc, next: nextDoc, request: found });
    if (!verdict.narrows && !found && verdict.widening) {
      // The check found a widening the random oracle did not hit. Replay its own witness through the interpreter
      // to make sure the witness is real; a witness that does not hold is a miss in the other direction.
      const w = verdict.widening;
      if (!(VERDICT_ORDER[evaluate(next, w.request).verdict] > VERDICT_ORDER[evaluate(prev, w.request).verdict])) result.misses.push({ prev: prevDoc, next: nextDoc, request: w.request });
    }
  }
  return result;
}
