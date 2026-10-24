import { addDays } from "../engines/days.ts";
import { namedDays, resolvePeriod, spanDays } from "./dates.ts";
import type { AnswerProgram, Step } from "./program.ts";
import type { Coverage } from "./specialists.ts";

/**
 * The rule planner: fixed plan templates per question type (spec 12.3). It is both the fallback when the
 * model planner is unavailable and the planner used in every ablation run, so an ablation compares the same
 * program with and without an engine. It never invents a value; a question it cannot map gets no program.
 */
export interface RulePlan {
  program: AnswerProgram | null;
  intent: string;
  /** For a question with no program: what to ask instead. */
  hint?: string;
}

const MODEL_TOKEN = /\b(?:claude|gpt|gemini|kimi|glm|llama|mistral|qwen|deepseek|nemotron|opus|sonnet|haiku|fable)[a-z0-9._-]*\b/i;

export const SUPPORTED_QUESTIONS = [
  "How much did we spend in September?",
  "Which model cost the most in the last 30 days?",
  "What were the five most expensive sessions in September?",
  "How much of our spend landed?",
  "What changed before 2026-09-23?",
  "Summarise the whole ledger.",
  "What did I tell you about landed work?",
];

export function rulePlan(question: string, cov: Coverage, knownModels: readonly string[] = []): RulePlan {
  const q = question.toLowerCase();
  const period = resolvePeriod(question, cov);
  const days = namedDays(question, cov);
  const span = spanDays(period);
  const steps: Step[] = [];

  if (/\b(remember|recall|told you|tell you|you know about|my notes?|my definitions?|my corrections?)\b|what did i (say|tell)/.test(q)) {
    steps.push({ id: "s1", op: "recall", query: question.trim().slice(0, 200) });
    return { program: { steps }, intent: "recall" };
  }

  if (/\bwhat (has |have )?changed\b|\bchanged (before|since|around|on)\b|\bwhat happened (before|around|on)\b|\bwhy did\b[^?]*\b(jump|spike|rise|increase|drop|fall|change|go up|go down)\b|\bwhat (was|is) different\b/.test(q)) {
    const date = days[0];
    if (!date) return { program: null, intent: "changes", hint: "Name the date, for example: What changed before 2026-09-23?" };
    steps.push({ id: "s1", op: "changes_before", date, days: 14 });
    if (/\b(cost|spend|spent|bill|price|jump|spike|rise|increase|drop|fall)\b/.test(q) && date > addDays(cov.start, 1) && date <= cov.end) {
      const beforeFrom = addDays(date, -14) < cov.start ? cov.start : addDays(date, -14);
      const afterTo = addDays(date, 13) > cov.end ? cov.end : addDays(date, 13);
      steps.push({ id: "s2", op: "spend", from: beforeFrom, to: addDays(date, -1), group: "none" });
      steps.push({ id: "s3", op: "spend", from: date, to: afterTo, group: "none" });
      steps.push({ id: "s4", op: "compare", a: "s2", b: "s3" });
    }
    return { program: { steps }, intent: "changes" };
  }

  if (/\b(land(?:ed|ing)?|merge[ds]?|kept|revert(?:ed)?|wasted?|unlinked|outcomes?|worth it|useful|productive)\b/.test(q)) {
    steps.push({ id: "s1", op: "landing", from: period.from, to: period.to });
    return { program: { steps }, intent: "landing" };
  }

  if (/\bmedian\b/.test(q) && /\b(spend|spent|cost|costs|daily|day)\b/.test(q)) {
    const all = /\bevery day\b|\ball days\b|\beach day\b|\bincluding (days|empty|zero)\b/.test(q) && !/\bonly days\b|\bdays with (any )?(spend|cost)\b|\bactive days\b/.test(q);
    steps.push({ id: "s1", op: "median_day", from: period.from, to: period.to, days: all ? "all" : "active" });
    return { program: { steps }, intent: "median_day" };
  }

  if (/\b(how many|number of|count of)\s+(\w+\s+)?sessions\b/.test(q) && !/\b(most expensive|costliest|priciest|top|highest)\b/.test(q)) {
    steps.push({ id: "s1", op: "count_sessions", from: period.from, to: period.to });
    return { program: { steps }, intent: "count_sessions" };
  }

  if (/\b(most expensive|costliest|priciest|biggest|top|highest)\b[^?]*\b(sessions?|runs?|tasks?)\b|\bsessions?\b[^?]*\b(most expensive|costliest|top|highest)\b/.test(q)) {
    const n = /\btop (\d{1,2})\b/.exec(q);
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const w = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(q);
    const limit = Math.min(10, Math.max(1, n ? Number(n[1]) : w ? (words[w[1] as string] as number) : 5));
    steps.push({ id: "s1", op: "top_sessions", from: period.from, to: period.to, limit });
    return { program: { steps }, intent: "top_sessions" };
  }

  const named = MODEL_TOKEN.exec(question)?.[0];
  const byModel = /\b(per|by|which|each|every)\s+model\b|\bmodels?\b[^?]*\b(cost|spend|spent|used?|expensive)\b|\bwhich model\b/.test(q);
  if (named || byModel) {
    const known = named ? knownModels.find((m) => m.toLowerCase() === named.toLowerCase()) : undefined;
    if (named && (known || /\d/.test(named))) {
      const model = known ?? named.slice(0, 80);
      steps.push({ id: "s1", op: "spend", from: period.from, to: period.to, group: "none", model });
      if (/\b(share|percentage|percent|proportion|fraction)\b/.test(q)) {
        steps.push({ id: "s2", op: "spend", from: period.from, to: period.to, group: "none" });
        steps.push({ id: "s3", op: "share", part: "s1", whole: "s2" });
        return { program: { steps }, intent: "share_model" };
      }
      return { program: { steps }, intent: "spend_model" };
    }
    steps.push({ id: "s1", op: "spend", from: period.from, to: period.to, group: "model" });
    return { program: { steps }, intent: "spend_by_model" };
  }

  if (/\b(by|per|each|every)\s+day\b|\bdaily\b|\b(which|what) day\b|\b(busiest|costliest|priciest) day\b/.test(q)) {
    steps.push({ id: "s1", op: "spend", from: period.from, to: period.to, group: "day" });
    return { program: { steps }, intent: "spend_by_day" };
  }
  if (/\b(by|per|each|every)\s+week\b|\bweekly\b/.test(q)) {
    steps.push({ id: "s1", op: "spend", from: period.from, to: period.to, group: "week" });
    return { program: { steps }, intent: "spend_by_week" };
  }

  if (/\b(summari[sz]e|summary|overview|trend|whole ledger|everything|year|quarter)\b/.test(q) || (span > 62 && /\b(spend|spent|cost|costs|how much)\b/.test(q))) {
    steps.push({ id: "s1", op: "range_digest", from: period.from, to: period.to });
    return { program: { steps }, intent: "range_digest" };
  }

  if (/\b(spend|spent|spending|cost|costs|bill|billed|how much|paid|price|expensive|budget)\b/.test(q)) {
    steps.push({ id: "s1", op: "spend", from: period.from, to: period.to, group: "none" });
    return { program: { steps }, intent: "spend" };
  }
  return { program: null, intent: "unknown", hint: `This question is not one the Desk can answer from the ledger. Questions it can answer look like: ${SUPPORTED_QUESTIONS.slice(0, 4).join(" ")}` };
}

/** Ops used by a program, in order, for comparing two plans. */
export function opsOf(p: AnswerProgram): string[] {
  return p.steps.map((s) => s.op);
}
