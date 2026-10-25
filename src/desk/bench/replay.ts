import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CassettePort } from "../agents/model.ts";
import type { Ledger } from "../ledger/db.ts";
import { filesFor, setARows } from "./command.ts";
import { digestDir, digestFile } from "../scorecard/model.ts";
import { buildQuestions, questionSetHash, type QuestionSet } from "./questions.ts";
import { ALL_ARMS, readResults, runBench, tally, type BenchRow } from "./run.ts";

/**
 * Replay every recorded run of a benchmark set from the recorded replies and score it again. The recorded rows are history; this says whether today's code, given the same
 * recorded replies, reaches the same answers and scores. It reproduces the table; it does not say the Desk wins.
 */
export type ReplayStatus = "same" | "differs" | "no_recording" | "question_set_changed";

export interface ReplayOutcome {
  set: QuestionSet;
  status: ReplayStatus;
  /** Runs that produced an answer and were replayed. */
  replayed: number;
  /** Runs that ended in an error when they were recorded; they are not replayed. */
  errors: number;
  differ: { qid: string; arm: string; trial: number }[];
  /** Greedy exact counts per arm, from the recorded rows. */
  exact: { arm: string; exact: number; n: number }[];
  detail: string;
  registeredHash: string | null;
  builtHash: string | null;
}

// Within one process the same recordings, results and question set give the same outcome, so a second ask for it (the proof run and the scorecard both make one) reuses the first.
const done = new Map<string, ReplayOutcome>();

export async function replaySet(db: Ledger, set: QuestionSet): Promise<ReplayOutcome> {
  const files = filesFor(set);
  const key = `${set}|${questionSetHash(buildQuestions(db, files.seed, set))}|${digestFile(files.results)}|${digestDir(files.cassettes)}`;
  const hit = done.get(key);
  if (hit) return hit;
  const outcome = await replayOnce(db, set);
  if (outcome.status === "same" || outcome.status === "differs") done.set(key, outcome);
  return outcome;
}

async function replayOnce(db: Ledger, set: QuestionSet): Promise<ReplayOutcome> {
  const files = filesFor(set);
  const blank: ReplayOutcome = { set, status: "no_recording", replayed: 0, errors: 0, differ: [], exact: [], detail: "", registeredHash: null, builtHash: null };
  if (!existsSync(files.results) || !existsSync(files.cassettes) || !existsSync(files.questions)) return { ...blank, detail: `no recorded benchmark at ${files.results}; run it with: desk bench run --set ${set} --record` };
  // The first version of the Desk (A2 in results.jsonl) ran before the plan critic and cannot be replayed by today's code; its rows are history.
  const recorded: readonly BenchRow[] = set === "A" ? setARows().rows : readResults(files.results);
  if (recorded.length === 0) return { ...blank, detail: "the recorded benchmark has no rows" };
  const registered = (JSON.parse(readFileSync(files.questions, "utf8")) as { hash: string }).hash;
  const built = questionSetHash(buildQuestions(db, files.seed, set));
  if (built !== registered) return { ...blank, status: "question_set_changed", registeredHash: registered, builtHash: built, detail: `the question set built from this ledger is ${built.slice(0, 19)}, not the pre-registered ${registered.slice(0, 19)}` };
  const dir = mkdtempSync(join(tmpdir(), "desk-bench-"));
  try {
    const out = join(dir, "replay.jsonl");
    const trials = [...new Set(recorded.map((r) => r.trial))].sort((a, b) => a - b);
    const arms = ALL_ARMS.filter((a) => recorded.some((x) => x.arm === a));
    await runBench({ db, port: new CassettePort(files.cassettes), arms, split: "all", set, trials, out });
    const again = new Map(readResults(out).map((x) => [`${x.qid}|${x.arm}|${x.trial}`, x]));
    const answered = recorded.filter((x) => !x.error);
    const differs = answered.filter((x) => {
      const y = again.get(`${x.qid}|${x.arm}|${x.trial}`);
      return !y || y.answer !== x.answer || y.exact !== x.exact || y.close !== x.close;
    });
    const greedy = answered.filter((x) => x.trial === 0);
    const exact = arms.map((a) => {
      const c = tally(greedy.filter((x) => x.arm === a));
      return { arm: a as string, exact: c.exact, n: c.n };
    });
    return {
      set,
      status: differs.length === 0 ? "same" : "differs",
      replayed: answered.length,
      errors: recorded.length - answered.length,
      differ: differs.map((x) => ({ qid: x.qid, arm: x.arm, trial: x.trial })),
      exact,
      detail: "",
      registeredHash: registered,
      builtHash: built,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
