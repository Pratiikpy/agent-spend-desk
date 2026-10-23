import { hashJson } from "../../runtime/canonical.ts";
import { array, integer, literal, object, oneOf, optional, parseOrThrow, refine, string, variants, type Infer, type Result, type Schema } from "../../runtime/schema.ts";
import { daysBetween, isIsoDate } from "../engines/days.ts";

/**
 * An AnswerProgram is the only thing a model may hand to the Desk when it plans an answer: a short list of
 * typed steps with no free text values and no query language. Code runs the steps. A date, a group or a
 * model name is checked here before anything touches the ledger, and an unknown key is an error, so a
 * field smuggled into the program is refused instead of being ignored.
 */
const day = refine(string({ pattern: /^\d{4}-\d{2}-\d{2}$/ }), (v) => (isIsoDate(v) ? null : "not a calendar date"), "date");
const stepId = string({ pattern: /^[a-z][a-z0-9_]{0,15}$/ });

export const MAX_STEPS = 5;
export const MAX_SPAN_DAYS = 3660;
export const GROUPS = ["none", "day", "week", "model"] as const;

const spend = object({ id: stepId, op: literal("spend"), from: day, to: day, group: oneOf(GROUPS), model: optional(string({ minLength: 1, maxLength: 80 })) });
const topSessions = object({ id: stepId, op: literal("top_sessions"), from: day, to: day, limit: integer({ min: 1, max: 10 }) });
const landing = object({ id: stepId, op: literal("landing"), from: day, to: day });
const changesBefore = object({ id: stepId, op: literal("changes_before"), date: day, days: integer({ min: 1, max: 60 }) });
const rangeDigest = object({ id: stepId, op: literal("range_digest"), from: day, to: day });
const recall = object({ id: stepId, op: literal("recall"), query: string({ minLength: 1, maxLength: 200 }) });
const compare = object({ id: stepId, op: literal("compare"), a: stepId, b: stepId });
/** A figure derived by code from earlier spend steps, so a model never has to do the arithmetic itself. */
const share = object({ id: stepId, op: literal("share"), part: stepId, whole: stepId });
const perDay = object({ id: stepId, op: literal("per_day"), of: stepId });
const percentOf = object({ id: stepId, op: literal("percent_of"), of: stepId, percent: integer({ min: 1, max: 100 }) });
const daysAbove = object({ id: stepId, op: literal("days_above"), from: day, to: day, usd: integer({ min: 1, max: 1_000_000 }) });

const step = variants("op", { spend, top_sessions: topSessions, landing, changes_before: changesBefore, range_digest: rangeDigest, recall, compare, share, per_day: perDay, percent_of: percentOf, days_above: daysAbove });

export type Step = Infer<typeof step>;
export type StepOp = Step["op"];

function check(program: { steps: Step[] }): string | null {
  const seen = new Map<string, Step>();
  for (const s of program.steps) {
    if (seen.has(s.id)) return `step id ${s.id} is used twice`;
    if (s.op === "spend" || s.op === "top_sessions" || s.op === "landing" || s.op === "range_digest" || s.op === "days_above") {
      if (s.from > s.to) return `step ${s.id}: from is after to`;
      if (daysBetween(s.from, s.to) + 1 > MAX_SPAN_DAYS) return `step ${s.id}: the range is longer than ${MAX_SPAN_DAYS} days`;
    }
    if (s.op === "compare") {
      for (const ref of [s.a, s.b]) {
        const target = seen.get(ref);
        if (!target) return `step ${s.id}: ${ref} is not an earlier step`;
        if (target.op !== "spend" || target.group !== "none") return `step ${s.id}: ${ref} must be a spend step with group none`;
      }
      if (s.a === s.b) return `step ${s.id}: compares a step with itself`;
    }
    if (s.op === "share") {
      for (const ref of [s.part, s.whole]) {
        const target = seen.get(ref);
        if (!target) return `step ${s.id}: ${ref} is not an earlier step`;
        if (target.op !== "spend" || target.group !== "none") return `step ${s.id}: ${ref} must be a spend step with group none`;
      }
      if (s.part === s.whole) return `step ${s.id}: takes a share of a step in itself`;
    }
    if (s.op === "per_day" || s.op === "percent_of") {
      const target = seen.get(s.of);
      if (!target) return `step ${s.id}: ${s.of} is not an earlier step`;
      if (target.op !== "spend" || target.group !== "none") return `step ${s.id}: ${s.of} must be a spend step with group none`;
    }
    seen.set(s.id, s);
  }
  return null;
}

export const programSchema: Schema<{ steps: Step[] }> = refine(object({ steps: array(step, { minItems: 1, maxItems: MAX_STEPS }) }), check, "answer_program");
export type AnswerProgram = Infer<typeof programSchema>;

export function parseProgram(input: unknown): Result<AnswerProgram> {
  return programSchema.parse(input);
}

export function mustParseProgram(input: unknown): AnswerProgram {
  return parseOrThrow(programSchema, input, "answer program");
}

export function stepHash(s: Step): string {
  return hashJson(s);
}

export function programHash(p: AnswerProgram): string {
  return hashJson(p);
}

/** The program schema in the form a model's tool-calling interface takes. */
export function programJsonSchema(): Record<string, unknown> {
  return programSchema.toJsonSchema() as Record<string, unknown>;
}
