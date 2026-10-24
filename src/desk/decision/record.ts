import { hashJson } from "../../runtime/canonical.ts";
import { array, boolean, literal, nullable, number, object, oneOf, parseOrThrow, refine, string, type Infer, type Result, type Schema } from "../../runtime/schema.ts";

/**
 * The decision record: the bridge between a recommendation and the evidence it rests on. Every important decision the
 * product makes carries one: what was decided, on what evidence, which alternatives were weighed (doing nothing is
 * always one of them), what was predicted with what uncertainty, which tests it passed, who approved it, what was
 * enforced, and, later, what was observed. The schema refuses a record that skips any of that, and refuses to call a
 * decision "experimentally supported" unless a passed Lab experiment is on the record.
 */
export const EVIDENCE_LEVELS = ["observed", "estimated", "experimentally_supported"] as const;
export const TEST_KINDS = ["restrict_check", "held_out_replay", "lab_experiment", "attack", "unit"] as const;

const isoTime = string({ pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/ });
const isoDay = string({ pattern: /^\d{4}-\d{2}-\d{2}$/ });
const text = string({ minLength: 1, maxLength: 600 });

const alternative = object({ id: string({ minLength: 1, maxLength: 32 }), summary: text, outcome: oneOf(["chosen", "rejected"] as const), reason: text });
const prediction = object({ metric: text, unit: string({ minLength: 1, maxLength: 40 }), expected: number(), low: number(), high: number(), level: number({ min: 0.5, max: 0.999 }) });
const testRun = object({ id: string({ minLength: 1, maxLength: 32 }), kind: oneOf(TEST_KINDS), passed: boolean(), detail: text });
const result = object({ metric: text, value: number() });

const recordSchema = object({
  schema: literal("desk.decision_record.v1"),
  id: string({ minLength: 1, maxLength: 64 }),
  createdAt: isoTime,
  decision: text,
  context: object({ question: text, window: object({ from: isoDay, to: isoDay }), population: text }),
  evidenceIds: array(string({ minLength: 1, maxLength: 200 }), { minItems: 1 }),
  memoryVersions: array(string({ minLength: 1, maxLength: 200 })),
  alternatives: array(alternative, { minItems: 2, maxItems: 12 }),
  chosen: string({ minLength: 1, maxLength: 32 }),
  predictions: array(prediction),
  tests: array(testRun),
  approver: nullable(string({ minLength: 1, maxLength: 120 })),
  enforcement: nullable(object({ action: text, surface: text, coverage: nullable(number({ min: 0, max: 1 })) })),
  observed: nullable(object({ measuredAt: isoTime, results: array(result, { minItems: 1 }) })),
  evidenceLevel: oneOf(EVIDENCE_LEVELS),
  limits: array(text, { minItems: 1 }),
});

function check(r: Infer<typeof recordSchema>): string | null {
  const chosen = r.alternatives.filter((a) => a.outcome === "chosen");
  if (chosen.length !== 1) return `exactly one alternative must be chosen, found ${chosen.length}`;
  if (chosen[0]!.id !== r.chosen) return `chosen names ${r.chosen}, but the chosen alternative is ${chosen[0]!.id}`;
  if (new Set(r.alternatives.map((a) => a.id)).size !== r.alternatives.length) return "alternative ids are not unique";
  if (!r.alternatives.some((a) => /\bdo(ing)? nothing\b|\bno change\b|\bkeep(ing)? the (current|established)\b/i.test(a.summary))) return "doing nothing must be one of the alternatives weighed";
  for (const p of r.predictions) if (!(p.low <= p.expected && p.expected <= p.high)) return `prediction "${p.metric}" has an interval that does not contain its expected value`;
  if (r.evidenceLevel === "experimentally_supported") {
    const lab = r.tests.filter((t) => t.kind === "lab_experiment");
    if (lab.length === 0) return "experimentally supported needs a lab_experiment test on the record";
    if (lab.some((t) => !t.passed)) return "experimentally supported cannot rest on a lab_experiment that did not pass";
  }
  if (r.observed && Date.parse(r.observed.measuredAt) <= Date.parse(r.createdAt)) return "an observed result cannot predate the decision it measures";
  return null;
}

export const decisionRecordSchema: Schema<Infer<typeof recordSchema>> = refine(recordSchema, check, "decision_record");
export type DecisionRecord = Infer<typeof decisionRecordSchema>;

export function parseDecisionRecord(input: unknown): Result<DecisionRecord> {
  return decisionRecordSchema.parse(input);
}

export function mustParseDecisionRecord(input: unknown): DecisionRecord {
  return parseOrThrow(decisionRecordSchema, input, "decision record");
}

export function decisionRecordHash(r: DecisionRecord): string {
  return hashJson(r);
}
