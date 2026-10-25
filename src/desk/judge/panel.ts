import { createHash } from "node:crypto";

import type { ModelPort } from "../agents/model.ts";
import { completeOwn } from "../agents/own-calls.ts";

/**
 * A panel of judges for work that tests cannot decide (DF-038, DF-098). The tests come first; a panel is asked only about what they leave open: two routes' changes to the same
 * task, when neither or both pass. Its rules are fixed before anything is judged:
 *
 * - at least three judges from at least two model families, and a judge that is the model under test, or that is listed twice, stops the panel from starting;
 * - the two changes are shown as "A" and "B", with no route name, and every judge sees them in both orders; a judge that prefers whichever came first in both orders has not
 *   preferred a change, and its verdict is a tie;
 * - the panel's answer is the verdict a majority of the judges gave. With no majority there is no answer, and no score is made up;
 * - a judge whose call failed or whose reply could not be read is `grader_failed`: it is not a vote, it is not a pass, and with fewer than two valid votes the pair is unscored;
 * - a change that wins by being longer, with no better test result, is not counted as a win: its length-normalised score is a tie.
 */
export interface Judge {
  id: string;
  family: string;
  model: string;
  port: ModelPort;
}

export type Verdict = "A" | "B" | "tie";

export class PanelConfigError extends Error {}

export const MIN_JUDGES = 3;
export const MIN_FAMILIES = 2;
export const LENGTH_RATIO = 1.3;

export function validatePanel(judges: readonly Pick<Judge, "id" | "family" | "model">[], underTest: readonly string[]): void {
  if (judges.length < MIN_JUDGES) throw new PanelConfigError(`a panel needs at least ${MIN_JUDGES} judges, and this one has ${judges.length}`);
  const families = new Set(judges.map((j) => j.family));
  if (families.size < MIN_FAMILIES) throw new PanelConfigError(`a panel needs judges from at least ${MIN_FAMILIES} model families, and this one has ${families.size}`);
  const ids = new Set<string>();
  const models = new Set<string>();
  for (const j of judges) {
    if (ids.has(j.id)) throw new PanelConfigError(`the judge ${j.id} is listed twice`);
    if (models.has(j.model)) throw new PanelConfigError(`the model ${j.model} is listed as two judges, which would count one opinion twice`);
    ids.add(j.id);
    models.add(j.model);
    if (underTest.includes(j.model)) throw new PanelConfigError(`the judge ${j.id} is ${j.model}, the model under test, and a model does not grade itself`);
  }
}

/** The panel as it is named in a record: a hash of who judges, so that an admission is for this panel and not for another. */
export function panelId(judges: readonly Pick<Judge, "id" | "family" | "model">[]): string {
  return createHash("sha256").update(JSON.stringify([...judges].map((j) => [j.id, j.family, j.model]).sort())).digest("hex").slice(0, 12);
}

export interface PairInput {
  /** What the task asked for, as the person gave it. */
  task: string;
  a: string;
  b: string;
}

export interface JudgeResult {
  judge: string;
  /** The verdict over both orders: the change it preferred in both, or a tie when it did not prefer the same change in both. */
  verdict: Verdict | "grader_failed";
  /** What it said in each order, in terms of the order shown to it: "first", "second" or "tie". */
  asShown: ["first" | "second" | "tie" | null, "first" | "second" | "tie" | null];
  inconsistent: boolean;
}

export interface PairResult {
  judges: JudgeResult[];
  /** The majority of the valid verdicts, or null when there is none or fewer than two judges answered. */
  decision: Verdict | null;
  why: string;
  /** 1 for A, 0 for B, 0.5 for a tie or for a pair that was not decided. */
  raw: number | null;
}

const SYSTEM = [
  "You compare two changes to the same code, made by two different people trying to do the same task.",
  'Decide which change does the task better: correct, complete, and no more than the task asks. Do not prefer a change for being longer or for explaining itself.',
  'Reply with a JSON object only: {"winner": "first" | "second" | "tie", "reason": "one sentence"}.',
].join(" ");

const prompt = (task: string, first: string, second: string): string => [`Task:\n${task}`, `First change:\n${first || "(no change)"}`, `Second change:\n${second || "(no change)"}`].join("\n\n---\n\n");

function readWinner(content: string): "first" | "second" | "tie" | null {
  const m = /\{[\s\S]*\}/.exec(content);
  if (!m) return null;
  try {
    const w = (JSON.parse(m[0]) as { winner?: unknown }).winner;
    return w === "first" || w === "second" || w === "tie" ? w : null;
  } catch {
    return null;
  }
}

async function ask(j: Judge, task: string, first: string, second: string, variant: number): Promise<"first" | "second" | "tie" | null> {
  try {
    const r = await completeOwn(j.port, { role: `judge_${j.id}`, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt(task, first, second) }], json: true, temperature: 0, maxTokens: 400, variant }, 120_000);
    return readWinner(r.content);
  } catch {
    // A failed call is a failed grader and says nothing about the pair.
    return null;
  }
}

/** One pair to the whole panel, each judge in both orders. */
export async function judgePair(judges: readonly Judge[], input: PairInput): Promise<PairResult> {
  const results: JudgeResult[] = [];
  for (const j of judges) {
    const [x, y] = [await ask(j, input.task, input.a, input.b, 1), await ask(j, input.task, input.b, input.a, 2)];
    if (x === null || y === null) {
      results.push({ judge: j.id, verdict: "grader_failed", asShown: [x, y], inconsistent: false });
      continue;
    }
    // In the first order "first" is A; in the second order "first" is B.
    const one: Verdict = x === "first" ? "A" : x === "second" ? "B" : "tie";
    const two: Verdict = y === "first" ? "B" : y === "second" ? "A" : "tie";
    const same = one === two;
    results.push({ judge: j.id, verdict: same ? one : "tie", asShown: [x, y], inconsistent: !same });
  }
  const valid = results.filter((r): r is JudgeResult & { verdict: Verdict } => r.verdict !== "grader_failed");
  if (valid.length < 2) return { judges: results, decision: null, why: `${results.length - valid.length} of ${results.length} judges failed, so fewer than two gave a verdict`, raw: null };
  const tally = new Map<Verdict, number>();
  for (const r of valid) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
  const top = [...tally.entries()].sort((p, q) => q[1] - p[1])[0] as [Verdict, number];
  if (top[1] * 2 <= valid.length) return { judges: results, decision: null, why: `no verdict has a majority of the ${valid.length} valid votes (${[...tally].map(([k, v]) => `${k} ${v}`).join(", ")})`, raw: null };
  return { judges: results, decision: top[0], why: `${top[1]} of ${valid.length} valid votes for ${top[0]}`, raw: top[0] === "A" ? 1 : top[0] === "B" ? 0 : 0.5 };
}

/**
 * The length-normalised score of a decided pair: a win by the longer change, with no better test result, is a tie. `testsA` and `testsB` are what the change did to the tests that
 * decided the task, as a number that is higher for more of them passed.
 */
export function lengthNormalised(decision: Verdict | null, a: { length: number; tests: number }, b: { length: number; tests: number }): { score: number | null; penalised: boolean } {
  if (decision === null) return { score: null, penalised: false };
  if (decision === "tie") return { score: 0.5, penalised: false };
  const winner = decision === "A" ? a : b;
  const loser = decision === "A" ? b : a;
  const longer = loser.length > 0 ? winner.length > LENGTH_RATIO * loser.length : winner.length > 0;
  if (longer && winner.tests <= loser.tests) return { score: 0.5, penalised: true };
  return { score: decision === "A" ? 1 : 0, penalised: false };
}
