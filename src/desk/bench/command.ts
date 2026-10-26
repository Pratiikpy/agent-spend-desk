import { existsSync } from "node:fs";

import { openLedger } from "../ledger/db.ts";
import { choosePort } from "../propose/command.ts";
import { BENCH_SEED, BENCH_SEED_B, BENCH_SEED_C, BENCH_SEED_D, BENCH_SEED_E, BENCH_SEED_F, buildQuestions, questionSetHash, type QuestionSet } from "./questions.ts";
import { ABLATION_ARMS, ALL_ARMS, ARMS, CATEGORIES, formatReport, readResults, runBench, writeQuestionSet, type BenchRow } from "./run.ts";
import type { ArmId } from "./arms.ts";

/** Where the recorded run lives: committed, so a reader can see every answer and score. */
export const RESULTS_FILE = "docs/verification/benchmark/results.jsonl";
export const QUESTIONS_FILE = "docs/verification/benchmark/questions.json";
export const RESULTS_FILE_B = "docs/verification/benchmark/set-b/results.jsonl";
export const RESULTS_FILE_A_V2 = "docs/verification/benchmark/results-v2.jsonl";
/** Set A run again, all three arms, on the Desk v3 (post hoc: set A was read to build the Desk). The first two files are history and cannot be replayed by today's code. */
export const RESULTS_FILE_A_V3 = "docs/verification/benchmark/set-a-v3/results.jsonl";
export const QUESTIONS_FILE_B = "docs/verification/benchmark/set-b/questions.json";
export const RESULTS_FILE_C = "docs/verification/learning/train-c/results.jsonl";
export const QUESTIONS_FILE_C = "docs/verification/learning/train-c/questions.json";
export const RESULTS_FILE_D = "docs/verification/benchmark/set-d/results.jsonl";
export const QUESTIONS_FILE_D = "docs/verification/benchmark/set-d/questions.json";
/** Set E, with the role-necessity ablation (DF-085): the Desk and five arms that each take one role out. */
export const RESULTS_FILE_E = "docs/verification/ablation/set-e/results.jsonl";
export const QUESTIONS_FILE_E = "docs/verification/ablation/set-e/questions.json";

/** Each set records into its own folder: a reply recorded for one set must never overwrite what the other set replays. */
export const CASSETTES_A = "data/sample/bench-cassettes";
export const CASSETTES_B = "data/sample/bench-cassettes-b";
export const CASSETTES_C = "data/sample/learning-cassettes-c";
export const CASSETTES_D = "data/sample/bench-cassettes-d";
export const CASSETTES_E = "data/sample/bench-cassettes-e";
export const RESULTS_FILE_F = "docs/verification/mix/set-f/results.jsonl";
export const QUESTIONS_FILE_F = "docs/verification/mix/set-f/questions.json";
export const CASSETTES_F = "data/sample/bench-cassettes-f";

/**
 * The rows of set A that today's Desk can be held to: the first two arms from the preregistered file, and the Desk from the
 * second file once that run is complete. Until it is, the first version's rows stand in, and are the history the table was
 * preregistered on.
 */
export function setARows(): { rows: BenchRow[]; deskVersion: 1 | 2 | 3 } {
  if (existsSync(RESULTS_FILE_A_V3)) {
    const v3 = readResults(RESULTS_FILE_A_V3);
    if (v3.length > 0) return { rows: v3, deskVersion: 3 };
  }
  const first = existsSync(RESULTS_FILE) ? readResults(RESULTS_FILE) : [];
  const v2 = existsSync(RESULTS_FILE_A_V2) ? readResults(RESULTS_FILE_A_V2).filter((r) => r.arm === "A2") : [];
  const wasA2 = first.filter((r) => r.arm === "A2").length;
  const done = v2.length >= Math.max(1, wasA2);
  return { rows: done ? [...first.filter((r) => r.arm !== "A2"), ...v2] : first, deskVersion: done ? 2 : 1 };
}

export const filesFor = (set: QuestionSet): { results: string; questions: string; seed: number; cassettes: string } =>
  set === "B"
    ? { results: RESULTS_FILE_B, questions: QUESTIONS_FILE_B, seed: BENCH_SEED_B, cassettes: CASSETTES_B }
    : set === "C"
      ? { results: RESULTS_FILE_C, questions: QUESTIONS_FILE_C, seed: BENCH_SEED_C, cassettes: CASSETTES_C }
      : set === "D"
        ? { results: RESULTS_FILE_D, questions: QUESTIONS_FILE_D, seed: BENCH_SEED_D, cassettes: CASSETTES_D }
        : set === "F"
          ? { results: RESULTS_FILE_F, questions: QUESTIONS_FILE_F, seed: BENCH_SEED_F, cassettes: CASSETTES_F }
        : set === "E"
          ? { results: RESULTS_FILE_E, questions: QUESTIONS_FILE_E, seed: BENCH_SEED_E, cassettes: CASSETTES_E }
          : { results: RESULTS_FILE, questions: QUESTIONS_FILE, seed: BENCH_SEED, cassettes: CASSETTES_A };

export interface BenchCommandOptions {
  sub: string;
  dbPath: string;
  sampleMode: boolean;
  record: boolean;
  arms?: string;
  split?: string;
  set?: string;
  trials?: string;
  only?: string;
  results?: string;
  /** Where recordings are read and written, when it is not the set's own folder (a run on a different model mix keeps its own). */
  cassetteDir?: string;
  concurrency?: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

export async function benchCommand(o: BenchCommandOptions): Promise<string> {
  const db = openLedger(o.dbPath);
  try {
    const set: QuestionSet = o.set === "B" ? "B" : o.set === "C" ? "C" : o.set === "D" ? "D" : o.set === "E" ? "E" : o.set === "F" ? "F" : "A";
    if (o.set !== undefined && !["A", "B", "C", "D", "E", "F"].includes(o.set)) return `--set is A, B, C, D, E or F, not ${o.set}.`;
    const files = filesFor(set);
    const questions = buildQuestions(db, files.seed, set);
    const results = o.results ?? files.results;
    if (o.sub === "questions") {
      writeQuestionSet(files.questions, questions, files.seed);
      const per = CATEGORIES.map((c) => `${c} ${questions.filter((q) => q.category === c).length}`).join(", ");
      return `${questions.length} questions (${per}); ${questions.filter((q) => q.split === "held_out").length} held out; set ${questionSetHash(questions)}\nwritten: ${files.questions}`;
    }
    if (o.sub === "report") {
      const rows = readResults(results);
      if (rows.length === 0) return `No results at ${results}. Run: desk bench run --arm A0,A1,A2`;
      return formatReport(rows, questions);
    }
    if (o.sub === "run") {
      const arms = (o.arms ?? ARMS.join(",")).split(",").map((a) => a.trim().toUpperCase()) as ArmId[];
      for (const a of arms) if (!ALL_ARMS.includes(a)) return `Unknown arm ${a}. The arms are ${ALL_ARMS.join(", ")}.`;
      const split = (o.split ?? "all") as "dev" | "held_out" | "all";
      if (!["dev", "held_out", "all"].includes(split)) return `--split is dev, held_out or all, not ${split}.`;
      // A rate-limited reply is retried for minutes, so a busy endpoint costs time and never a wrong or missing answer.
      // Arms that take one role out ask the same questions of the same model as the full Desk until the point they differ, so they share the recorded replies.
      const { port, label } = choosePort({ sampleMode: o.sampleMode, record: o.record, cassetteDir: o.cassetteDir ?? files.cassettes, env: o.env, backoffMs: [4_000, 8_000, 15_000, 30_000, 60_000, 60_000, 60_000], reuse: arms.some((a) => ABLATION_ARMS.includes(a)) });
      if (!port) return `No model to run the arms on: ${label}. Set the model settings in .env, or run with --sample to replay the recorded replies.`;
      const only = o.only ? o.only.split(",").map((s) => s.trim()) : undefined;
      const trials = (o.trials ?? "0").split(",").map((t) => Number(t.trim()));
      if (trials.some((t) => !Number.isInteger(t) || t < 0 || t > 9)) return `--trials is a list of whole numbers from 0 to 9, for example 1,2,3 (0 is the greedy run).`;
      const r = await runBench({ db, port, arms, split, set, trials, ...(only ? { only } : {}), out: results, concurrency: Number(o.concurrency ?? "1"), log: o.log });
      return `${r.ran} runs added to ${results} (${r.skipped} were already there); model route: ${label}\n\n${formatReport(readResults(results), questions)}`;
    }
    return "Use: desk bench questions | desk bench run [--arm A0,A1,A2] [--split dev|held_out|all] [--only Q01,Q02] [--record] | desk bench report";
  } finally {
    db.close();
  }
}
