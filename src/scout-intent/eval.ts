import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { Decision } from "./types.ts";

/**
 * The evaluation of a Scout implementation against a regression corpus. The metrics and the gates are those of the Meterless harness (evals/runner/index.ts, Apache-2.0): intent
 * top-1 and top-3, injection precision and recall (a prompt is "detected" when the decision's risk level is block), tool-plan precision (the expected capabilities are among the
 * planned ones), clarification rate, and override frequency, each overall and by slice, against a hard floor or ceiling, so that an aggregate cannot hide a slice that fell.
 *
 * Five measures are added, each in the harness's own style, because the corpus has labels the original did not score: whether a prompt that needed a clarification got one and
 * one that did not, did not; whether a multi-intent prompt was planned as exactly the intents it contains; whether an access rule (role or surface) blocked what it should and
 * nothing else; whether GENERAL is chosen only when nothing registered fits.
 */
export interface Example {
  id: string;
  prompt: string;
  user?: { role: string };
  surface?: string;
  expected: { intent?: string; intents?: string[]; parameters?: Record<string, unknown>; risk?: string; toolPlan?: string[]; injection?: boolean; clarification?: boolean; reason?: string; policy?: boolean };
  tags?: string[];
}

export interface Tally {
  n: number;
  intentTotal: number;
  top1: number;
  top3: number;
  injTP: number;
  injFP: number;
  injFN: number;
  injTN: number;
  toolTotal: number;
  toolHits: number;
  clarifications: number;
  contracts: number;
  overrides: number;
  clarExpectedYes: number;
  clarYesHit: number;
  clarExpectedNo: number;
  clarNoHit: number;
  multiTotal: number;
  multiExact: number;
  multiTP: number;
  multiFP: number;
  multiFN: number;
  policyTotal: number;
  policyHit: number;
}

export type Metrics = Record<string, number>;

const empty = (): Tally => ({
  n: 0, intentTotal: 0, top1: 0, top3: 0, injTP: 0, injFP: 0, injFN: 0, injTN: 0, toolTotal: 0, toolHits: 0, clarifications: 0, contracts: 0, overrides: 0, clarExpectedYes: 0, clarYesHit: 0, clarExpectedNo: 0, clarNoHit: 0,
  multiTotal: 0, multiExact: 0, multiTP: 0, multiFP: 0, multiFN: 0, policyTotal: 0, policyHit: 0,
});

export interface Result {
  ex: Example;
  out: Decision & { overrides?: unknown };
}

export function tally(results: readonly Result[]): Tally {
  const t = empty();
  t.n = results.length;
  for (const { ex, out } of results) {
    if (ex.expected.intent && !ex.expected.policy) {
      t.intentTotal += 1;
      const top1 = out.executionContract?.intent?.primary?.id;
      const top3 = (out.candidates ?? []).slice(0, 3).map((c) => c.intent);
      if (top1 === ex.expected.intent) t.top1 += 1;
      if (top3.includes(ex.expected.intent)) t.top3 += 1;
    }
    if (ex.expected.injection !== undefined) {
      const blocked = out.risk?.level === "block";
      if (ex.expected.injection && blocked) t.injTP += 1;
      else if (ex.expected.injection && !blocked) t.injFN += 1;
      else if (!ex.expected.injection && blocked) t.injFP += 1;
      else t.injTN += 1;
    }
    if (ex.expected.toolPlan?.length) {
      t.toolTotal += 1;
      const got = (out.toolPlan ?? []).map((s) => s.capability);
      if (ex.expected.toolPlan.every((c) => got.includes(c))) t.toolHits += 1;
    }
    const clarified = out.clarification !== undefined;
    if (clarified) t.clarifications += 1;
    if (ex.expected.clarification === true) {
      t.clarExpectedYes += 1;
      if (clarified) t.clarYesHit += 1;
    } else if (ex.expected.clarification === false) {
      t.clarExpectedNo += 1;
      if (!clarified) t.clarNoHit += 1;
    }
    if (out.executionContract) t.contracts += 1;
    if (out.overrides !== undefined) t.overrides += Array.isArray(out.overrides) ? out.overrides.length : 0;
    if (ex.expected.intents) {
      t.multiTotal += 1;
      const got = new Set((out.intents ?? []).map((i) => i.intent));
      const want = new Set(ex.expected.intents);
      for (const g of got) if (want.has(g)) t.multiTP += 1;
      else t.multiFP += 1;
      for (const w of want) if (!got.has(w)) t.multiFN += 1;
      if (got.size === want.size && [...got].every((g) => want.has(g))) t.multiExact += 1;
    }
    if (ex.expected.policy) {
      t.policyTotal += 1;
      const blocked = out.risk?.level === "block";
      if (blocked === (ex.expected.risk === "block")) t.policyHit += 1;
    }
  }
  return t;
}

const ratio = (a: number, b: number, whenEmpty = 0): number => (b === 0 ? whenEmpty : a / b);

export function toMetrics(t: Tally): Metrics {
  const f1 = (): number => {
    const p = ratio(t.multiTP, t.multiTP + t.multiFP);
    const r = ratio(t.multiTP, t.multiTP + t.multiFN);
    return p + r === 0 ? 0 : (2 * p * r) / (p + r);
  };
  return {
    intent_top1: ratio(t.top1, t.intentTotal),
    intent_top3_recall: ratio(t.top3, t.intentTotal),
    injection_precision: ratio(t.injTP, t.injTP + t.injFP, 1),
    injection_recall: ratio(t.injTP, t.injTP + t.injFN, 1),
    tool_precision: ratio(t.toolHits, t.toolTotal),
    clarification_rate: ratio(t.clarifications, t.n),
    override_frequency: ratio(t.overrides, t.contracts),
    clarification_recall: ratio(t.clarYesHit, t.clarExpectedYes, 1),
    clarification_specificity: ratio(t.clarNoHit, t.clarExpectedNo, 1),
    multi_intent_f1: t.multiTotal === 0 ? 1 : f1(),
    multi_intent_exact: ratio(t.multiExact, t.multiTotal, 1),
    policy_accuracy: ratio(t.policyHit, t.policyTotal, 1),
  };
}

const FILTER_DIRS: Record<string, string[]> = {
  all: ["intents", "injection", "multi-intent", "edge-cases", "policy"],
  intent: ["intents"],
  injection: ["injection"],
  "multi-intent": ["multi-intent"],
};

function loadJsonl(path: string): Example[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Example);
}

/** `root` is a corpus folder holding intents/, injection/, multi-intent/, edge-cases/ (and policy/ where present) of .jsonl files. */
export function loadCorpus(root: string, filter = "all"): Example[] {
  const out: Example[] = [];
  for (const d of FILTER_DIRS[filter] ?? FILTER_DIRS["all"] ?? []) {
    const dir = join(root, d);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".jsonl")) out.push(...loadJsonl(join(dir, f)));
  }
  return out;
}

const sliceValue = (ex: Example, dim: string): string | undefined => {
  switch (dim) {
    case "surface": return ex.surface ?? "chat";
    case "role": return ex.user?.role ?? "ae";
    case "intent_family": return ex.expected.intent?.split(".")[0];
    case "risk_class": return ex.expected.risk && ex.expected.risk !== "block" && ex.expected.risk !== "allowed" ? ex.expected.risk : undefined;
    default: return undefined;
  }
};

export interface Thresholds {
  metrics: Record<string, { target?: number; hard_floor?: number; target_max?: number; hard_max?: number }>;
  slices?: { dim: string; values: string[] }[];
  slice_policy?: Record<string, { slice_hard_floor?: number }>;
}

export function loadThresholds(...paths: string[]): Thresholds {
  const merged: Thresholds = { metrics: {}, slices: [], slice_policy: {} };
  for (const p of paths) {
    const t = parseYaml(readFileSync(p, "utf8")) as Thresholds;
    Object.assign(merged.metrics, t.metrics ?? {});
    merged.slices = [...(merged.slices ?? []), ...(t.slices ?? [])];
    Object.assign(merged.slice_policy ?? {}, t.slice_policy ?? {});
  }
  return merged;
}

export type Slices = Record<string, { metrics: Metrics; tally: Tally }>;

export function computeSlices(results: readonly Result[], thresholds: Thresholds): Slices {
  const slices: Slices = {};
  for (const spec of thresholds.slices ?? []) {
    for (const value of spec.values) {
      const subset = results.filter((r) => sliceValue(r.ex, spec.dim) === value);
      if (subset.length === 0) continue;
      const t = tally(subset);
      slices[`${spec.dim}=${value}`] = { metrics: toMetrics(t), tally: t };
    }
  }
  return slices;
}

export function gate(metrics: Metrics, slices: Slices, thresholds: Thresholds): { pass: boolean; failures: string[]; notMet: string[] } {
  const failures: string[] = [];
  const notMet: string[] = [];
  for (const [name, t] of Object.entries(thresholds.metrics)) {
    const v = metrics[name];
    if (v === undefined) continue;
    if (t.hard_floor !== undefined && v < t.hard_floor) failures.push(`${name}=${v.toFixed(3)} below floor ${t.hard_floor}`);
    else if (t.target !== undefined && v < t.target) notMet.push(`${name}=${v.toFixed(3)} below target ${t.target}`);
    if (t.hard_max !== undefined && v > t.hard_max) failures.push(`${name}=${v.toFixed(3)} above ceiling ${t.hard_max}`);
    else if (t.target_max !== undefined && v > t.target_max) notMet.push(`${name}=${v.toFixed(3)} above target ${t.target_max}`);
  }
  for (const [metric, policy] of Object.entries(thresholds.slice_policy ?? {})) {
    const floor = policy.slice_hard_floor;
    if (floor === undefined) continue;
    for (const [key, s] of Object.entries(slices)) {
      const relevant = metric === "intent_top1" ? s.tally.intentTotal > 0 : metric === "injection_precision" ? s.tally.injTP + s.tally.injFP > 0 : true;
      if (!relevant) continue;
      const v = s.metrics[metric];
      if (v !== undefined && v < floor) failures.push(`slice ${key}: ${metric}=${v.toFixed(3)} below slice floor ${floor}`);
    }
  }
  return { pass: failures.length === 0, failures, notMet };
}

export interface Evaluation {
  corpus: string;
  examples: number;
  metrics: Metrics;
  slices: Slices;
  gate: { pass: boolean; failures: string[]; notMet: string[] };
  /** Examples whose decision differed from the label on a measure the label covers, for reading the misses. */
  misses: { id: string; prompt: string; why: string }[];
  skipped: { id: string; why: string }[];
}

/** Run every example through `decide` and score the decisions. An example that throws is reported as skipped and counted against nothing, so the report names it. */
export async function evaluate(scout: { decide(i: { prompt: string; user: { id: string; role: string }; surface: string }): Promise<Decision> }, corpusRoot: string, thresholds: Thresholds, filter = "all"): Promise<Evaluation> {
  const corpus = loadCorpus(corpusRoot, filter);
  const results: Result[] = [];
  const skipped: Evaluation["skipped"] = [];
  const misses: Evaluation["misses"] = [];
  for (const ex of corpus) {
    try {
      const out = (await scout.decide({ prompt: ex.prompt, user: { id: `eval-${ex.id}`, role: ex.user?.role ?? "ae" }, surface: ex.surface ?? "chat" })) as Result["out"];
      results.push({ ex, out });
      const e = ex.expected;
      const got = out.executionContract?.intent?.primary?.id;
      if (e.intent && !e.policy && got !== e.intent) misses.push({ id: ex.id, prompt: ex.prompt, why: `intent ${got ?? (out.clarification ? `clarification (${out.clarification.trigger})` : out.risk.level === "block" ? "block" : "none")}, wanted ${e.intent}` });
      if (e.injection !== undefined && (out.risk.level === "block") !== e.injection) misses.push({ id: ex.id, prompt: ex.prompt, why: e.injection ? "injection not blocked" : `blocked: ${out.risk.reason ?? "no reason"}` });
      if (e.clarification !== undefined && (out.clarification !== undefined) !== e.clarification) misses.push({ id: ex.id, prompt: ex.prompt, why: e.clarification ? "no clarification" : `clarified (${out.clarification?.trigger})` });
      if (e.intents) {
        const g = new Set(out.intents.map((i) => i.intent));
        if (g.size !== e.intents.length || !e.intents.every((i) => g.has(i))) misses.push({ id: ex.id, prompt: ex.prompt, why: `planned ${[...g].join("+")}, wanted ${e.intents.join("+")}` });
      }
      if (e.policy && (out.risk.level === "block") !== (e.risk === "block")) misses.push({ id: ex.id, prompt: ex.prompt, why: e.risk === "block" ? "not blocked" : `blocked: ${out.risk.reason ?? ""}` });
    } catch (err) {
      skipped.push({ id: ex.id, why: err instanceof Error ? err.message : String(err) });
    }
  }
  const t = tally(results);
  const metrics = toMetrics(t);
  const slices = computeSlices(results, thresholds);
  return { corpus: corpusRoot, examples: corpus.length, metrics, slices, gate: gate(metrics, slices, thresholds), misses, skipped };
}
