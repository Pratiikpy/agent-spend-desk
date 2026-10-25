import { randomUUID } from "node:crypto";

import { NULL_TRACE } from "../agents/trace.ts";
import { buildWorldModel } from "../engines/world.ts";
import type { Ledger } from "../ledger/db.ts";
import { parseProgram, type AnswerProgram } from "./program.ts";
import { DEFAULT_CLAIM_TOKENS, ledgerCoverage, runStep, type Engines, type StepResult } from "./specialists.ts";

/**
 * Does an answer come from the ledger? (DF-108). The answer's own steps are run again after the ledger has been changed by one known call, inside a savepoint that is
 * rolled back, so nothing is kept. A call is added inside the dates the answer covers, on a model it reads, and the figures must move; a call is added outside every date
 * the answer covers, and nothing may move. The added call costs a million dollars and goes on the quietest day of the dates, in a session that began then. A call of a dollar
 * moves a total but not the busiest session, the median day or a count of days over a figure, which an answer built from the ledger may well be: the first version added a
 * dollar and failed four of fifty real answers for exactly that reason. A call that large, there, becomes the busiest session and the busiest day, crosses the median and any
 * threshold, and counts as a session. A step that does not move when a row it reads is added is not reading the ledger; a step that moves when a row it does not read is
 * added is reading more than it says. Either is a failure, and it is the failure a hard-coded answer would show.
 *
 * Every step is run in both cases and its result hash compared with the unperturbed run. For a spend step the expectation is exact: it must move if the row is inside its dates
 * and on its model, and hold if it is not. Other steps are held only to the aggregate rule, because what a single call does to a list of the largest sessions depends on the list.
 */
export interface PerturbCase {
  /** Where the added row was put. */
  day: string;
  model: string;
  moved: string[];
  held: string[];
}

export interface PerturbReport {
  answerId: string;
  found: boolean;
  verdict: "pass" | "fail" | "not_run";
  inside: PerturbCase | null;
  outside: PerturbCase | null;
  /** Spend steps that the row was inside but whose result held, and spend steps it was outside but whose result moved. */
  expectedToMove: string[];
  shouldHaveHeld: string[];
  note: string;
}

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const dayOf = (ms: number): string => iso(ms).slice(0, 10);

interface DatedStep {
  id: string;
  op: string;
  from: string;
  to: string;
  model?: string;
}

/**
 * The steps that have dates, and the one the added row is built around: the first spend step, or failing that the first dated step. The row goes inside that step's own
 * dates and on its model, so it is inside at least one step even when the steps leave gaps between them; it goes before the earliest date of any step to be outside all of them.
 */
function dated(p: AnswerProgram): { steps: DatedStep[]; anchor: DatedStep; earliest: string } | null {
  const steps = (p.steps as unknown as { id: string; op: string; from?: string; to?: string; model?: string }[]).filter((s): s is DatedStep => typeof s.from === "string" && typeof s.to === "string");
  const anchor = steps.find((s) => s.op === "spend") ?? steps[0];
  if (!anchor) return null;
  return { steps, anchor, earliest: steps.reduce((m, s) => (s.from < m ? s.from : m), anchor.from) };
}

async function run(db: Ledger, program: AnswerProgram): Promise<Map<string, StepResult>> {
  const engines: Engines = { world: await buildWorldModel(db), memory: null, markovian: true };
  const results = new Map<string, StepResult>();
  const ctx = { db, engines, coverage: ledgerCoverage(db), claimTokenBudget: DEFAULT_CLAIM_TOKENS, results, trace: NULL_TRACE };
  for (const step of program.steps) results.set(step.id, await runStep(step, ctx));
  return results;
}

/** What the added call costs, in micro-dollars: a million dollars, so that it outranks anything a real ledger holds. */
export const PERTURB_MICROS = 1_000_000_000_000;

/** Add one call that cost exactly `PERTURB_MICROS`, on a model and a day of the caller's choosing, in a session that began then. The caller rolls it back. */
function addCall(db: Ledger, day: string, model: string): void {
  const snapshot = (db.prepare("SELECT snapshot_id FROM price_snapshot ORDER BY rowid LIMIT 1").get() as { snapshot_id: string } | undefined)?.snapshot_id;
  if (!snapshot) throw new Error("the ledger holds no price snapshot, so a priced call cannot be added to it");
  const callId = `perturb-${randomUUID()}`;
  const ts = `${day}T12:00:00.000Z`;
  db.prepare("INSERT OR IGNORE INTO session (session_id, tool, started_at, ended_at) VALUES ('desk-perturbation', 'claude_code', ?, ?)").run(ts, ts);
  db.prepare(
    "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, 'desk-perturbation', ?, ?, 0, 0, 1, 0, 0, 0, 0, 'reported', 0, 0)",
  ).run(callId, ts, model);
  db.prepare(
    "INSERT INTO cost_event (call_id, class, snapshot_id, matched_as, total_micros, input_micros, output_micros, cache_read_micros, cache_write_5m_micros, cache_write_1h_micros) VALUES (?, 'estimated', ?, ?, ?, 0, ?, 0, 0, 0)",
  ).run(callId, snapshot, model, PERTURB_MICROS, PERTURB_MICROS);
}

/** How the steps are run. The product runs the real specialists; a test can hand in a runner that reads nothing or reads too much, to see the check say so. */
export type StepRunner = (db: Ledger, program: AnswerProgram) => Promise<Map<string, Pick<StepResult, "resultHash">>>;

async function perturbed(db: Ledger, program: AnswerProgram, base: Map<string, Pick<StepResult, "resultHash">>, day: string, model: string, runSteps: StepRunner): Promise<PerturbCase> {
  // A savepoint, not a transaction of its own: whatever the caller had open stays open, and the added rows are never part of it.
  db.exec("SAVEPOINT desk_perturb");
  try {
    addCall(db, day, model);
    const after = await runSteps(db, program);
    const moved: string[] = [];
    const held: string[] = [];
    for (const step of program.steps) (after.get(step.id)?.resultHash === base.get(step.id)?.resultHash ? held : moved).push(step.id);
    return { day, model, moved, held };
  } finally {
    db.exec("ROLLBACK TO SAVEPOINT desk_perturb; RELEASE SAVEPOINT desk_perturb");
  }
}

export async function perturbProgram(db: Ledger, program: AnswerProgram, answerId = "(program)", runSteps: StepRunner = run): Promise<PerturbReport> {
  const none = (note: string): PerturbReport => ({ answerId, found: true, verdict: "not_run", inside: null, outside: null, expectedToMove: [], shouldHaveHeld: [], note });
  const d = dated(program);
  if (!d) return none("This answer's steps carry no dates (a recalled note, say), so there is no row to add inside or outside them.");
  const base = await runSteps(db, program);
  // The model the row is on: the anchor step's, or the model with the most calls inside its dates.
  const busiest = (db.prepare("SELECT model FROM model_call WHERE substr(ts, 1, 10) >= ? AND substr(ts, 1, 10) <= ? AND model NOT LIKE '<%' GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1").get(d.anchor.from, d.anchor.to) as { model: string } | undefined)?.model;
  const model = d.anchor.model ?? busiest;
  if (!model) return none("The ledger holds no model call inside the dates this answer covers, so there is nothing for it to read.");
  // The quietest day of the anchor step's dates, so that a call of this size crosses a median or a threshold there; the middle of the dates when none of them has spend.
  const quiet = db
    .prepare("SELECT substr(m.ts, 1, 10) AS day FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'estimated' AND substr(m.ts, 1, 10) >= ? AND substr(m.ts, 1, 10) <= ? GROUP BY day ORDER BY SUM(c.total_micros) ASC, day ASC LIMIT 1")
    .get(d.anchor.from, d.anchor.to) as { day: string } | undefined;
  const start = Date.parse(`${d.anchor.from}T00:00:00Z`);
  const insideDay = quiet?.day ?? dayOf(start + Math.floor((Date.parse(`${d.anchor.to}T00:00:00Z`) - start) / 2 / DAY) * DAY);
  const outsideDay = dayOf(Date.parse(`${d.earliest}T00:00:00Z`) - 400 * DAY);
  const inside = await perturbed(db, program, base, insideDay, model, runSteps);
  const outside = await perturbed(db, program, base, outsideDay, model, runSteps);
  // A spend step is held to the exact rule: it moves if and only if the row is inside its dates and on its model.
  const expectedToMove: string[] = [];
  const shouldHaveHeld: string[] = [];
  for (const s of d.steps) {
    if (s.op !== "spend") continue;
    const covers = s.from <= insideDay && insideDay <= s.to && (s.model === undefined || s.model === model);
    if (covers && !inside.moved.includes(s.id)) expectedToMove.push(s.id);
    if (!covers && inside.moved.includes(s.id)) shouldHaveHeld.push(s.id);
    if (outside.moved.includes(s.id) && !shouldHaveHeld.includes(s.id)) shouldHaveHeld.push(s.id);
  }
  const pass = inside.moved.length > 0 && outside.moved.length === 0 && expectedToMove.length === 0 && shouldHaveHeld.length === 0;
  const note = pass
    ? `A call costing a million dollars, added on the quietest day inside the answer's dates, moved ${inside.moved.join(", ")} and nothing else; added ${outsideDay}, outside every date it covers, it moved nothing. Both were rolled back.`
    : inside.moved.length === 0
      ? `A call costing a million dollars, added inside the answer's dates (${insideDay}, ${model}), moved no step: the answer is not reading the rows it says it reads.`
      : outside.moved.length > 0
        ? `A call costing a million dollars, added outside every date the answer covers (${outsideDay}), moved ${outside.moved.join(", ")}: those steps read more than their dates.`
        : expectedToMove.length > 0
          ? `Step ${expectedToMove.join(", ")} covers the added call and did not move.`
          : `Step ${shouldHaveHeld.join(", ")} moved for a call it does not cover.`;
  return { answerId, found: true, verdict: pass ? "pass" : "fail", inside, outside, expectedToMove, shouldHaveHeld, note };
}

/** The recorded answer's program, perturbed. */
export async function perturbAnswer(db: Ledger, answerId: string): Promise<PerturbReport> {
  const row = db.prepare("SELECT program_json FROM ask_answer WHERE answer_id = ?").get(answerId) as { program_json: string | null } | undefined;
  if (!row) return { answerId, found: false, verdict: "not_run", inside: null, outside: null, expectedToMove: [], shouldHaveHeld: [], note: "No such answer is recorded." };
  if (!row.program_json) return { answerId, found: true, verdict: "not_run", inside: null, outside: null, expectedToMove: [], shouldHaveHeld: [], note: "This answer ran no steps, so there is nothing to perturb." };
  const parsed = parseProgram(JSON.parse(row.program_json));
  if (!parsed.ok) return { answerId, found: true, verdict: "not_run", inside: null, outside: null, expectedToMove: [], shouldHaveHeld: [], note: "The recorded program no longer passes its schema." };
  return perturbProgram(db, parsed.value, answerId);
}
