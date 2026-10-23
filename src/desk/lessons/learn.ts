import type { DatabaseSync } from "node:sqlite";

import type { ModelPort } from "../agents/model.ts";
import type { Precedent } from "../ask/ask.ts";
import { runA2 } from "../bench/arms.ts";
import type { Question } from "../bench/questions.ts";
import { sampled, type BenchRow } from "../bench/run.ts";
import { score } from "../bench/score.ts";
import { Rng } from "../canary/rng.ts";
import type { Ledger } from "../ledger/db.ts";
import { nearest } from "./precedent.ts";
import { addLesson, addRound, precedentsInForce, setStatus, type Lesson } from "./store.ts";

/**
 * Learning from mistakes, measured (DF-127). The procedure is fixed in docs/verification/benchmark/PREREGISTRATION.md,
 * Addendum 3, before any lesson was made. In short: the Desk's wrong answers on the training questions become lessons
 * when a plan can be found that the benchmark's own scorer calls right; lessons are added a few at a time; after each
 * round the Desk is run on questions it was not trained on; a round that makes that worse is reverted.
 */
export interface LearnConfig {
  /** Resolved lessons per round. The spec says twenty; the pool of mistakes here is too small for that. */
  roundSize: number;
  maxRounds: number;
  /** Plans tried for one mistake before it is left unresolved. */
  attempts: number;
  /** Precedents shown to the Planner. */
  neighbours: number;
  seed: number;
  concurrency: number;
}

export const DEFAULT_LEARN: LearnConfig = { roundSize: 6, maxRounds: 4, attempts: 4, neighbours: 2, seed: 20261026, concurrency: 3 };

/** A mistake: the Desk was run without a model failure and the scorer did not call the answer exact. */
export function mistakesOf(questions: readonly Question[], rows: readonly BenchRow[]): Question[] {
  const wrong = new Set(rows.filter((r) => r.arm === "A2" && r.trial === 0 && !r.exact && !r.error).map((r) => r.qid));
  return questions.filter((q) => wrong.has(q.id));
}

export interface PlanSearch {
  question: Question;
  program: Precedent["program"] | null;
  attempts: number;
}

/** Try up to `attempts` plans for a question, with no precedents, and keep the first whose answer the scorer calls exact. */
export async function findVerifiedPlan(o: { db: Ledger; port: ModelPort; question: Question; attempts: number }): Promise<PlanSearch> {
  for (let k = 1; k <= o.attempts; k += 1) {
    const out = await runA2({ db: o.db, port: sampled(o.port, k), question: o.question.text });
    if (out.error || !out.program) continue;
    if (score(o.question, out.answer).exact) return { question: o.question, program: out.program, attempts: k };
  }
  return { question: o.question, program: null, attempts: o.attempts };
}

export interface HeldoutRow {
  qid: string;
  exact: boolean;
  error: string | null;
  precedents: string[];
}

async function pool<T, R>(items: readonly T[], width: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await f(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

/** The Desk on every held-out question with the given precedents in force, greedy. */
export async function evaluateHeldout(o: { db: Ledger; port: ModelPort; questions: readonly Question[]; precedents: readonly Precedent[]; neighbours: number; concurrency: number; /** Round 0's result per question. A question shown no precedent sends the Planner the very request it sent in round 0, so its result stands and nothing is asked again: the model is not deterministic, and asking again would measure that noise instead of the lessons. */ unchanged?: ReadonlyMap<string, boolean> }): Promise<HeldoutRow[]> {
  return pool(o.questions, o.concurrency, async (q) => {
    const shown = nearest(q.text, o.precedents, o.neighbours);
    const same = o.unchanged?.get(q.id);
    if (shown.length === 0 && same !== undefined) return { qid: q.id, exact: same, error: null, precedents: [] };
    const out = await runA2({ db: o.db, port: o.port, question: q.text, ...(shown.length > 0 ? { precedents: shown } : {}) });
    return { qid: q.id, exact: out.error ? false : score(q, out.answer).exact, error: out.error, precedents: shown.map((p) => p.id) };
  });
}

/** Paired bootstrap over questions: the change in held-out error since the baseline, with a 95% interval (negative is better). */
export function pairedChange(base: readonly boolean[], now: readonly boolean[], seed: number, resamples = 2000): { change: number; low: number; high: number } {
  const n = base.length;
  const diffs = base.map((b, i) => (b ? 1 : 0) - (now[i] ? 1 : 0));
  const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const rng = new Rng(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += diffs[Math.floor(rng.next() * n)]!;
    means.push(n === 0 ? 0 : sum / n);
  }
  means.sort((a, b) => a - b);
  return { change: mean(diffs), low: means[Math.floor(0.025 * resamples)] ?? 0, high: means[Math.min(resamples - 1, Math.ceil(0.975 * resamples))] ?? 0 };
}

export interface RoundReport {
  round: number;
  lessons: string[];
  exact: number;
  n: number;
  heldoutError: number;
  /** Change in held-out error since round 0, with its 95% interval. */
  change: { change: number; low: number; high: number };
  reverted: boolean;
  novel: { exact: number; n: number };
  rows: HeldoutRow[];
}

export interface LearnReport {
  config: LearnConfig;
  mistakes: number;
  resolved: number;
  unresolved: number;
  rounds: RoundReport[];
  /** Each accepted lesson's own question, asked again with every other precedent in force. */
  regression: { exact: number; n: number };
}

const toRows = (rows: readonly HeldoutRow[], questions: readonly Question[]): { exact: boolean[]; novel: { exact: number; n: number } } => {
  const byId = new Map(rows.map((r) => [r.qid, r]));
  const novel = questions.filter((q) => q.novel);
  return { exact: questions.map((q) => byId.get(q.id)?.exact === true), novel: { exact: novel.filter((q) => byId.get(q.id)?.exact).length, n: novel.length } };
};

export async function runLearning(o: {
  db: Ledger;
  lessons: DatabaseSync;
  port: ModelPort;
  /** Training questions, in order, with the Desk's greedy rows on them. */
  training: { questions: readonly Question[]; rows: readonly BenchRow[] };
  heldout: readonly Question[];
  /** The Desk's greedy rows on the held-out questions with no precedents: round 0. */
  baseline: readonly BenchRow[];
  config?: Partial<LearnConfig>;
  now?: () => string;
  log?: (line: string) => void;
}): Promise<LearnReport> {
  const cfg = { ...DEFAULT_LEARN, ...o.config };
  const log = o.log ?? (() => undefined);
  const now = o.now ?? ((): string => new Date().toISOString());
  const mistakes = mistakesOf(o.training.questions, o.training.rows);
  log(`${mistakes.length} mistakes among ${o.training.questions.length} training questions`);

  // Lessons: a plan the scorer calls right, for as many mistakes as it can be found for.
  const searched = await pool(mistakes, cfg.concurrency, async (q) => {
    const found = await findVerifiedPlan({ db: o.db, port: o.port, question: q, attempts: cfg.attempts });
    log(`${q.id} ${found.program ? `verified plan after ${found.attempts} attempt(s)` : `no verified plan in ${found.attempts} attempts`}`);
    return found;
  });
  const resolved: Lesson[] = [];
  let unresolved = 0;
  for (const f of searched) {
    const expected = f.question.expect.kind === "abstain" ? { abstain: true } : { required: f.question.expect.required.map((r) => ({ label: r.label, value: r.value })) };
    if (f.program) resolved.push(addLesson(o.lessons, { kind: "wrong_plan", question: f.question.text, expected, changeKind: "precedent", program: f.program, attempts: f.attempts, createdAt: now(), round: null }));
    else {
      unresolved += 1;
      addLesson(o.lessons, { kind: "wrong_plan", question: f.question.text, expected, changeKind: "none", program: null, attempts: f.attempts, createdAt: now(), status: "unresolved", round: null });
    }
  }

  const base = toRows(
    o.heldout.map((q) => {
      const r = o.baseline.find((x) => x.qid === q.id && x.arm === "A2" && x.trial === 0);
      return { qid: q.id, exact: r?.exact === true, error: r?.error ?? null, precedents: [] };
    }),
    o.heldout,
  );
  const rounds: RoundReport[] = [
    {
      round: 0,
      lessons: [],
      exact: base.exact.filter(Boolean).length,
      n: o.heldout.length,
      heldoutError: 1 - base.exact.filter(Boolean).length / Math.max(1, o.heldout.length),
      change: { change: 0, low: 0, high: 0 },
      reverted: false,
      novel: base.novel,
      rows: [],
    },
  ];
  addRound(o.lessons, { round: 0, nLessons: 0, exact: rounds[0]!.exact, n: rounds[0]!.n, heldoutError: rounds[0]!.heldoutError, intervalLow: 0, intervalHigh: 0, reverted: false });

  let accepted: Lesson[] = [];
  let previousExact = rounds[0]!.exact;
  for (let r = 1; r <= cfg.maxRounds; r += 1) {
    const batch = resolved.slice((r - 1) * cfg.roundSize, r * cfg.roundSize);
    if (batch.length === 0) break;
    const inForce: Precedent[] = [...accepted, ...batch].map((l) => ({ id: l.id, question: l.question, program: l.program! }));
    const rows = await evaluateHeldout({ db: o.db, port: o.port, questions: o.heldout, precedents: inForce, neighbours: cfg.neighbours, concurrency: cfg.concurrency, unchanged: new Map(o.heldout.map((q, i) => [q.id, base.exact[i]!])) });
    const t = toRows(rows, o.heldout);
    const exact = t.exact.filter(Boolean).length;
    const reverted = exact < previousExact;
    const change = pairedChange(base.exact, t.exact, cfg.seed + r);
    for (const l of batch) {
      setStatus(o.lessons, l.id, reverted ? "reverted" : "accepted");
      o.lessons.prepare("UPDATE lesson SET round = ? WHERE lesson_id = ?").run(r, l.id);
    }
    if (!reverted) {
      accepted = [...accepted, ...batch];
      previousExact = exact;
    }
    const report: RoundReport = { round: r, lessons: batch.map((l) => l.id), exact, n: o.heldout.length, heldoutError: 1 - exact / Math.max(1, o.heldout.length), change, reverted, novel: t.novel, rows };
    rounds.push(report);
    addRound(o.lessons, { round: r, nLessons: accepted.length, exact, n: report.n, heldoutError: report.heldoutError, intervalLow: change.low, intervalHigh: change.high, reverted });
    log(`round ${r}: ${exact}/${report.n} exact with ${[...accepted, ...(reverted ? batch : [])].length} lessons${reverted ? " (reverted)" : ""}; change in error ${change.change.toFixed(3)} (95% ${change.low.toFixed(3)} to ${change.high.toFixed(3)})`);
  }

  // Each accepted lesson as a test: its own question, every other precedent in force, must come out right.
  const inForce = precedentsInForce(o.lessons);
  const asked = accepted.map((l) => o.training.questions.find((q) => q.text === l.question)).filter((q): q is Question => q !== undefined);
  const regress = await evaluateHeldout({ db: o.db, port: o.port, questions: asked, precedents: inForce, neighbours: cfg.neighbours, concurrency: cfg.concurrency });
  return { config: cfg, mistakes: mistakes.length, resolved: resolved.length, unresolved, rounds, regression: { exact: regress.filter((x) => x.exact).length, n: regress.length } };
}
