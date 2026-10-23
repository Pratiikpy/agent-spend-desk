import { openLedger } from "../ledger/db.ts";
import { choosePort } from "../propose/command.ts";
import { BENCH_SEED, BENCH_SEED_B, buildQuestions, questionSetHash, type QuestionSet } from "./questions.ts";
import { ARMS, CATEGORIES, formatReport, readResults, runBench, writeQuestionSet } from "./run.ts";
import type { ArmId } from "./arms.ts";

/** Where the recorded run lives: committed, so a reader can see every answer and score. */
export const RESULTS_FILE = "docs/verification/benchmark/results.jsonl";
export const QUESTIONS_FILE = "docs/verification/benchmark/questions.json";
export const RESULTS_FILE_B = "docs/verification/benchmark/set-b/results.jsonl";
export const QUESTIONS_FILE_B = "docs/verification/benchmark/set-b/questions.json";

export const filesFor = (set: QuestionSet): { results: string; questions: string; seed: number } => (set === "B" ? { results: RESULTS_FILE_B, questions: QUESTIONS_FILE_B, seed: BENCH_SEED_B } : { results: RESULTS_FILE, questions: QUESTIONS_FILE, seed: BENCH_SEED });
export const BENCH_CASSETTES = "data/sample/bench-cassettes";

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
  concurrency?: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

export async function benchCommand(o: BenchCommandOptions): Promise<string> {
  const db = openLedger(o.dbPath);
  try {
    const set: QuestionSet = o.set === "B" ? "B" : "A";
    if (o.set !== undefined && o.set !== "A" && o.set !== "B") return `--set is A or B, not ${o.set}.`;
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
      for (const a of arms) if (!ARMS.includes(a)) return `Unknown arm ${a}. The arms are ${ARMS.join(", ")}.`;
      const split = (o.split ?? "all") as "dev" | "held_out" | "all";
      if (!["dev", "held_out", "all"].includes(split)) return `--split is dev, held_out or all, not ${split}.`;
      // A rate-limited reply is retried for minutes, so a busy endpoint costs time and never a wrong or missing answer.
      const { port, label } = choosePort({ sampleMode: o.sampleMode, record: o.record, cassetteDir: BENCH_CASSETTES, env: o.env, backoffMs: [4_000, 8_000, 15_000, 30_000, 60_000, 60_000, 60_000] });
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
