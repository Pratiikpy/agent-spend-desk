import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { CassettePort, ReplayOrRecordPort, portFromEnv, type ModelPort } from "../agents/model.ts";
import { filesFor, RESULTS_FILE, RESULTS_FILE_A_V2 } from "../bench/command.ts";
import { buildQuestions } from "../bench/questions.ts";
import { readResults } from "../bench/run.ts";
import { openLedger, type Ledger } from "../ledger/db.ts";
import { DEFAULT_LEARN, runLearning, type LearnConfig, type LearnReport } from "./learn.ts";
import { allLessons, openLessons, type Lesson } from "./store.ts";

/** The Desk (version 2) run once on set A, kept beside the first version's results, which the preregistered table rests on. */
export { RESULTS_FILE_A_V2 };
export const LEARNING_REPORT = "docs/verification/learning/report.json";
export const LEARNING_CASSETTES = "data/sample/learning-cassettes";

export interface StoredReport extends LearnReport {
  lessons: (Pick<Lesson, "id" | "question" | "changeKind" | "program" | "attempts" | "round" | "status"> & { expected: unknown })[];
}

/** Everything the learning run reads, from files, so that a recorded run can be replayed on a fresh clone. */
export function learningInputs(db: Ledger): { training: { questions: ReturnType<typeof buildQuestions>; rows: ReturnType<typeof readResults> }; heldout: ReturnType<typeof buildQuestions>; baseline: ReturnType<typeof readResults>; missing: string | null } {
  const a = filesFor("A");
  const b = filesFor("B");
  const c = filesFor("C");
  const questions = [...buildQuestions(db, a.seed, "A"), ...buildQuestions(db, c.seed, "C").map((q) => ({ ...q, id: `C-${q.id}` }))];
  const missing = [RESULTS_FILE_A_V2, c.results, b.results].find((f) => !existsSync(f)) ?? null;
  const rowsA = existsSync(RESULTS_FILE_A_V2) ? readResults(RESULTS_FILE_A_V2).filter((r) => r.arm === "A2") : [];
  const rowsC = existsSync(c.results) ? readResults(c.results).filter((r) => r.arm === "A2").map((r) => ({ ...r, qid: `C-${r.qid}` })) : [];
  return { training: { questions, rows: [...rowsA, ...rowsC] }, heldout: buildQuestions(db, b.seed, "B"), baseline: existsSync(b.results) ? readResults(b.results) : [], missing };
}

export function toStored(report: LearnReport, lessons: ReturnType<typeof allLessons>): StoredReport {
  return { ...report, lessons: lessons.map((l) => ({ id: l.id, question: l.question, expected: l.expected, changeKind: l.changeKind, program: l.program, attempts: l.attempts, round: l.round, status: l.status })) };
}

export interface LessonsOptions {
  sub: string;
  dbPath: string;
  sampleMode: boolean;
  record: boolean;
  env: Record<string, string | undefined>;
  config?: Partial<LearnConfig>;
  log: (line: string) => void;
}

export function renderLearning(r: StoredReport): string {
  const out: string[] = ["Learning from mistakes (DF-127)"];
  out.push(`  mistakes on the training questions: ${r.mistakes}; a verified plan was found for ${r.resolved}, none for ${r.unresolved}`);
  for (const k of r.rounds) {
    if (k.round === 0) out.push(`  round 0, no lessons: ${k.exact} of ${k.n} held-out questions exact (error ${(k.heldoutError * 100).toFixed(1)}%); on the ${k.novel.n} new-template questions ${k.novel.exact}`);
    else out.push(`  round ${k.round}, ${k.lessons.length} lessons added: ${k.exact} of ${k.n} exact (error ${(k.heldoutError * 100).toFixed(1)}%); change since round 0 ${(k.change.change * 100).toFixed(1)} points (95% interval ${(k.change.low * 100).toFixed(1)} to ${(k.change.high * 100).toFixed(1)})${k.reverted ? "; REVERTED, it made the held-out answers worse" : ""}; new-template questions ${k.novel.exact} of ${k.novel.n}`);
  }
  out.push(`  as tests: ${r.regression.exact} of ${r.regression.n} accepted lessons come out right when their own question is asked again with the other precedents in force`);
  const last = r.rounds.filter((k) => !k.reverted).at(-1);
  if (last && last.round > 0) out.push(last.change.low <= 0 && last.change.high >= 0 ? "  The interval for the change includes zero, so no improvement is claimed." : "  The interval for the change excludes zero.");
  out.push("  No model weights change. A lesson changes only which earlier plans the Planner is shown.");
  return out.join("\n");
}

/** `desk lessons learn` records a run (live, with replay of what is already recorded); `desk lessons report` prints the recorded one. */
export async function lessonsCommand(o: LessonsOptions): Promise<string> {
  if (o.sub === "report") {
    if (!existsSync(LEARNING_REPORT)) return `No recorded learning run at ${LEARNING_REPORT}. Record one with: desk lessons learn --record`;
    return renderLearning(JSON.parse(readFileSync(LEARNING_REPORT, "utf8")) as StoredReport);
  }
  if (o.sub !== "learn") return "Use: desk lessons learn [--record] | desk lessons report";
  const db = openLedger(o.dbPath);
  try {
    const inputs = learningInputs(db);
    if (inputs.missing) return `The learning run needs ${inputs.missing}. It reads the Desk's greedy runs on set A (${RESULTS_FILE_A_V2}), on set C (${filesFor("C").results}) and on set B (${filesFor("B").results}); record them with: desk bench run --set <A|B|C> --arm A2 --record`;
    let port: ModelPort;
    if (o.sampleMode) port = new CassettePort(LEARNING_CASSETTES);
    else {
      try {
        port = new ReplayOrRecordPort(portFromEnv({ ...o.env, SAMPLE_MODE: "false" }, LEARNING_CASSETTES, { backoffMs: [4_000, 8_000, 15_000, 30_000, 60_000, 60_000, 60_000] }), LEARNING_CASSETTES);
      } catch (e) {
        return `No model to learn with: ${(e as Error).message.split(":")[0]}. Run with --sample to replay the recorded run.`;
      }
    }
    const lessons = openLessons(":memory:");
    const report = await runLearning({ db, lessons, port, training: inputs.training, heldout: inputs.heldout, baseline: inputs.baseline, config: { ...DEFAULT_LEARN, ...o.config }, log: o.log });
    const stored = toStored(report, allLessons(lessons));
    if (!o.sampleMode || o.record) {
      mkdirSync(dirname(LEARNING_REPORT), { recursive: true });
      writeFileSync(LEARNING_REPORT, JSON.stringify(stored, null, 1) + "\n");
    }
    return renderLearning(stored);
  } finally {
    db.close();
  }
}

export { RESULTS_FILE };
