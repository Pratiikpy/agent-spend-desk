import { openLedger } from "../ledger/db.ts";
import { choosePort } from "../propose/command.ts";
import { buildQuestions, questionSetHash } from "./questions.ts";
import { ARMS, CATEGORIES, formatReport, readResults, runBench, writeQuestionSet } from "./run.ts";
import type { ArmId } from "./arms.ts";

/** Where the recorded run lives: committed, so a reader can see every answer and score. */
export const RESULTS_FILE = "docs/verification/benchmark/results.jsonl";
export const QUESTIONS_FILE = "docs/verification/benchmark/questions.json";
export const BENCH_CASSETTES = "data/sample/bench-cassettes";

export interface BenchCommandOptions {
  sub: string;
  dbPath: string;
  sampleMode: boolean;
  record: boolean;
  arms?: string;
  split?: string;
  only?: string;
  results?: string;
  concurrency?: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

export async function benchCommand(o: BenchCommandOptions): Promise<string> {
  const db = openLedger(o.dbPath);
  try {
    const questions = buildQuestions(db);
    const results = o.results ?? RESULTS_FILE;
    if (o.sub === "questions") {
      writeQuestionSet(QUESTIONS_FILE, questions);
      const per = CATEGORIES.map((c) => `${c} ${questions.filter((q) => q.category === c).length}`).join(", ");
      return `${questions.length} questions (${per}); ${questions.filter((q) => q.split === "held_out").length} held out; set ${questionSetHash(questions)}\nwritten: ${QUESTIONS_FILE}`;
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
      const { port, label } = choosePort({ sampleMode: o.sampleMode, record: o.record, cassetteDir: BENCH_CASSETTES, env: o.env });
      if (!port) return `No model to run the arms on: ${label}. Set the model settings in .env, or run with --sample to replay the recorded replies.`;
      const only = o.only ? o.only.split(",").map((s) => s.trim()) : undefined;
      const r = await runBench({ db, port, arms, split, ...(only ? { only } : {}), out: results, concurrency: Number(o.concurrency ?? "1"), log: o.log });
      return `${r.ran} runs added to ${results} (${r.skipped} were already there); model route: ${label}\n\n${formatReport(readResults(results), questions)}`;
    }
    return "Use: desk bench questions | desk bench run [--arm A0,A1,A2] [--split dev|held_out|all] [--only Q01,Q02] [--record] | desk bench report";
  } finally {
    db.close();
  }
}
