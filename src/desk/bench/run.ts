import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ModelPort, ModelRequest } from "../agents/model.ts";
import type { Ledger } from "../ledger/db.ts";
import { runArm, type ArmId } from "./arms.ts";
import { BENCH_SEED, buildQuestions, seedOf, questionSetHash, type Category, type Question, type QuestionSet } from "./questions.ts";
import { score } from "./score.ts";

export const ARMS: readonly ArmId[] = ["A0", "A1", "A2"];
export const CATEGORIES: readonly Category[] = ["lookup", "multi_hop", "counterfactual", "unanswerable", "adversarial", "numeric"];

export interface BenchRow {
  qid: string;
  /** 0 is the greedy run (temperature 0). Later trials sample at a temperature and each has its own recording. */
  trial: number;
  arm: ArmId;
  category: Category;
  split: "dev" | "held_out";
  answer: string;
  error: string | null;
  exact: boolean;
  close: boolean;
  abstained: boolean;
  resisted: boolean | null;
  rejectedPremise: boolean | null;
  extraFigures: number;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  servedModel: string | null;
  ms: number;
  detail: string;
}

export function readResults(path: string): BenchRow[] {
  if (!existsSync(path)) return [];
  // A question and arm can appear more than once: a run that errored is run again, and the later row is the one that counts.
  const last = new Map<string, BenchRow>();
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (l.trim() === "") continue;
    const r = JSON.parse(l) as BenchRow;
    r.trial ??= 0;
    last.set(`${r.qid}|${r.arm}|${r.trial}`, r);
  }
  return [...last.values()];
}

/** The temperature of every trial after the first: warm enough that a repeat can differ, cool enough to stay on task. */
export const TRIAL_TEMPERATURE = 0.7;

/** The same port with a temperature and a variant stamped on every request, so a repeat is a real draw with its own recording. */
export function sampled(inner: ModelPort, trial: number): ModelPort {
  return { complete: (request: ModelRequest, deadline: number) => inner.complete({ ...request, temperature: TRIAL_TEMPERATURE, variant: trial }, deadline) };
}

export interface RunOptions {
  db: Ledger;
  port: ModelPort;
  arms: readonly ArmId[];
  /** Which questions to run: a split, or every one. */
  split: "dev" | "held_out" | "all";
  /** Restrict to these question ids (a spot check). */
  only?: readonly string[];
  /** Which question set: A, or B with new parameters and a few new templates. */
  set?: QuestionSet;
  /** Trials to run: 0 is the greedy run; 1 and above sample at TRIAL_TEMPERATURE. */
  trials?: readonly number[];
  out: string;
  concurrency?: number;
  log?: (line: string) => void;
}

/** Run each question on each arm, score it, append the row. A (question, arm) already in the file is not run again. */
export async function runBench(o: RunOptions): Promise<{ ran: number; skipped: number }> {
  const questions = buildQuestions(o.db, seedOf(o.set ?? "A"), o.set ?? "A").filter((q) => (o.split === "all" || q.split === o.split) && (!o.only || o.only.includes(q.id)));
  // A run that ended in an error is run again; only a run that produced an answer counts as done.
  const have = new Set(readResults(o.out).filter((r) => !r.error).map((r) => `${r.qid}|${r.arm}|${r.trial}`));
  mkdirSync(dirname(o.out), { recursive: true });
  const todo: { q: Question; arm: ArmId; trial: number }[] = [];
  for (const trial of o.trials ?? [0]) for (const q of questions) for (const arm of o.arms) if (!have.has(`${q.id}|${arm}|${trial}`)) todo.push({ q, arm, trial });
  let cursor = 0;
  let ran = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = todo[cursor];
      cursor += 1;
      if (!item) return;
      const out = await runArm(item.arm, { db: o.db, port: item.trial === 0 ? o.port : sampled(o.port, item.trial), question: item.q.text });
      const s = score(item.q, out.answer);
      const row: BenchRow = { qid: item.q.id, trial: item.trial, arm: item.arm, category: item.q.category, split: item.q.split, answer: out.answer, error: out.error, exact: out.error ? false : s.exact, close: out.error ? false : s.close, abstained: s.abstained, resisted: s.resisted, rejectedPremise: s.rejectedPremise, extraFigures: s.extraFigures.length, modelCalls: out.modelCalls, tokensIn: out.tokensIn, tokensOut: out.tokensOut, servedModel: out.servedModel, ms: out.ms, detail: out.detail };
      appendFileSync(o.out, JSON.stringify(row) + "\n");
      ran += 1;
      o.log?.(`${item.q.id}${item.trial ? `.${item.trial}` : ""} ${item.arm} ${out.error ? `ERROR ${out.error.slice(0, 80)}` : row.exact ? "exact" : row.close ? "close" : "wrong"} (${out.modelCalls} calls, ${out.ms} ms)`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 1) }, worker));
  return { ran, skipped: have.size };
}

export interface Cell {
  n: number;
  exact: number;
  close: number;
  errors: number;
  withExtra: number;
  resisted: number;
  resistedOf: number;
  premiseRejected: number;
  premiseOf: number;
}

const empty = (): Cell => ({ n: 0, exact: 0, close: 0, errors: 0, withExtra: 0, resisted: 0, resistedOf: 0, premiseRejected: 0, premiseOf: 0 });

export function tally(rows: readonly BenchRow[]): Cell {
  const c = empty();
  for (const r of rows) {
    c.n += 1;
    if (r.exact) c.exact += 1;
    if (r.close) c.close += 1;
    if (r.error) c.errors += 1;
    if (r.extraFigures > 0) c.withExtra += 1;
    if (r.resisted !== null) {
      c.resistedOf += 1;
      if (r.resisted) c.resisted += 1;
    }
    if (r.rejectedPremise !== null) {
      c.premiseOf += 1;
      if (r.rejectedPremise) c.premiseRejected += 1;
    }
  }
  return c;
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);
const rowsOf = (rows: readonly BenchRow[], arm: ArmId, f?: (r: BenchRow) => boolean): BenchRow[] => rows.filter((r) => r.arm === arm && (f ? f(r) : true));

/** The table the Track 3 claim rests on, as text. Every cell is a count over the rows in the file. */
/** pass^k as tau-bench defines it: the chance that k trials of one question all succeed, averaged over questions. */
export function passK(rows: readonly BenchRow[], arm: ArmId, k: number): { value: number; questions: number; trials: number } | null {
  const byQuestion = new Map<string, boolean[]>();
  for (const r of rows) if (r.arm === arm && r.trial > 0 && !r.error) byQuestion.set(r.qid, [...(byQuestion.get(r.qid) ?? []), r.exact]);
  const counts = [...byQuestion.values()];
  const n = Math.min(...counts.map((c) => c.length));
  if (counts.length === 0 || n < k) return null;
  const choose = (a: number, b: number): number => {
    let x = 1;
    for (let i = 0; i < b; i += 1) x = (x * (a - i)) / (i + 1);
    return x;
  };
  const per = counts.map((c) => choose(c.filter(Boolean).length, k) / choose(c.length, k));
  return { value: per.reduce((a, b) => a + b, 0) / per.length, questions: counts.length, trials: n };
}

export function formatReport(allRows: readonly BenchRow[], questions: readonly Question[], note = ""): string {
  const rows = allRows.filter((r) => r.trial === 0);
  const arms = ARMS.filter((a) => rows.some((r) => r.arm === a));
  const lines: string[] = [];
  const ids = new Set(rows.map((r) => r.qid));
  lines.push(`Questions run: ${ids.size} of ${questions.length}; question set ${questionSetHash(questions).slice(0, 19)}${note ? `; ${note}` : ""}`);
  lines.push("");
  lines.push(`exact answers by category (n per cell shown in the header row)`);
  lines.push(["category".padEnd(16), ...arms.map((a) => a.padStart(10))].join(" "));
  for (const cat of CATEGORIES) {
    const n = rows.filter((r) => r.arm === arms[0] && r.category === cat).length;
    lines.push([`${cat} (${n})`.padEnd(16), ...arms.map((a) => { const c = tally(rowsOf(rows, a, (r) => r.category === cat)); return pct(c.exact, c.n).padStart(10); })].join(" "));
  }
  lines.push([`all`.padEnd(16), ...arms.map((a) => { const c = tally(rowsOf(rows, a)); return `${c.exact}/${c.n}`.padStart(10); })].join(" "));
  lines.push("");
  const line = (label: string, f: (a: ArmId) => string): void => void lines.push([label.padEnd(44), ...arms.map((a) => f(a).padStart(10))].join(" "));
  line("exact (all questions)", (a) => { const c = tally(rowsOf(rows, a)); return pct(c.exact, c.n); });
  line("close, within 1% (all questions)", (a) => { const c = tally(rowsOf(rows, a)); return pct(c.close, c.n); });
  line("exact on the dev split", (a) => { const c = tally(rowsOf(rows, a, (r) => r.split === "dev")); return pct(c.exact, c.n); });
  line("exact on the held-out split", (a) => { const c = tally(rowsOf(rows, a, (r) => r.split === "held_out")); return pct(c.exact, c.n); });
  line("correct abstention on unanswerable questions", (a) => { const c = tally(rowsOf(rows, a, (r) => r.category === "unanswerable")); return pct(c.exact, c.n); });
  line("instruction in the question not followed", (a) => { const c = tally(rowsOf(rows, a)); return pct(c.resisted, c.resistedOf); });
  line("false premise not accepted", (a) => { const c = tally(rowsOf(rows, a)); return pct(c.premiseRejected, c.premiseOf); });
  line("answers stating a figure nothing asked for", (a) => { const c = tally(rowsOf(rows, a, (r) => !r.error && !r.abstained)); return pct(c.withExtra, c.n); });
  line("runs with an error and no answer", (a) => { const c = tally(rowsOf(rows, a)); return `${c.errors}/${c.n}`; });
  const novel = new Set(questions.filter((q) => q.novel).map((q) => q.id));
  if (novel.size > 0) line(`exact on the ${novel.size} new-template questions`, (a) => { const c = tally(rowsOf(rows, a, (r) => novel.has(r.qid))); return `${c.exact}/${c.n}`; });
  line("model calls per question", (a) => { const x = rowsOf(rows, a); return x.length === 0 ? "n/a" : (x.reduce((s, r) => s + r.modelCalls, 0) / x.length).toFixed(1); });
  line("tokens per question (in + out)", (a) => { const x = rowsOf(rows, a); return x.length === 0 ? "n/a" : String(Math.round(x.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0) / x.length)); });
  line("median seconds per question", (a) => { const x = rowsOf(rows, a).map((r) => r.ms).sort((p, q) => p - q); return x.length === 0 ? "n/a" : (x[Math.floor(x.length / 2)]! / 1000).toFixed(1); });
  const trialRows = allRows.filter((r) => r.trial > 0);
  if (trialRows.length > 0) {
    lines.push("");
    lines.push(`reliability over repeated runs: ${arms.map((a) => passK(trialRows, a, 1)).find((x) => x)?.trials ?? 0} sampled trials per question at temperature ${TRIAL_TEMPERATURE}`);
    for (const k of [1, 2, 3]) {
      const cells = arms.map((a) => passK(trialRows, a, k));
      if (cells.every((c) => c === null)) continue;
      lines.push([`pass^${k}`.padEnd(44), ...cells.map((c) => (c ? `${Math.round(c.value * 100)}%` : "n/a").padStart(10))].join(" "));
    }
    const varies = arms.map((a) => { const by = new Map<string, boolean[]>(); for (const r of trialRows) if (r.arm === a && !r.error) by.set(r.qid, [...(by.get(r.qid) ?? []), r.exact]); return [...by.values()].filter((c) => c.some(Boolean) && c.some((x) => !x)).length; });
    lines.push(["questions whose answer changed between trials".padEnd(44), ...varies.map((v) => String(v).padStart(10))].join(" "));
  }
  return lines.join("\n");
}

export function writeQuestionSet(path: string, questions: readonly Question[], seed = BENCH_SEED): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = questions.map((q) => ({ id: q.id, category: q.category, split: q.split, ...(q.novel ? { novel: true } : {}), text: q.text, expect: q.expect.kind === "abstain" ? { kind: "abstain" } : { kind: "answer", required: q.expect.required, ...(q.expect.injected ? { injected: q.expect.injected.source } : {}), ...(q.expect.falsePremise ? { falsePremise: q.expect.falsePremise.source } : {}) } }));
  writeFileSync(path, JSON.stringify({ seed, hash: questionSetHash(questions), questions: body }, null, 1) + "\n");
}
