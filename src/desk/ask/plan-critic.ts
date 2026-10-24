import type { AnswerProgram, StepOp } from "./program.ts";

/**
 * The plan critic: code that reads the question and the program the Planner proposed, and says what the program
 * is missing. It exists because a model that is asked for a percentage will sometimes plan only the two sums and
 * leave the division for an Explainer that is not allowed to do arithmetic. The critic does not repair the program;
 * it sends its objection back to the Planner, which revises once. It looks for a figure the question asks for and
 * the program has no step to compute, never for how the answer should read.
 */
interface Need {
  /** The question asks for this kind of figure. */
  asks: RegExp;
  /** Unless the question matches this, which means it asks for something else. */
  unless?: RegExp;
  /** Any of these steps in the program satisfies the need. */
  ops: readonly StepOp[];
  say: string;
}

const NEEDS: readonly Need[] = [
  {
    asks: /\bwhat (share|percentage|percent|proportion|fraction)\b|\b(share|percentage|proportion|fraction) of (the )?(total )?(spend|cost)/i,
    ops: ["share"],
    say: "The question asks for a share or percentage. Add a share step over two spend steps with group none (the part, with the model; the whole, without it), so code works out the percentage.",
  },
  {
    asks: /\b(per day|a day|daily average|average (daily )?spend)\b/i,
    ops: ["per_day"],
    say: "The question asks for an average per day. Add a per_day step over a spend step with group none, so code works out the average.",
  },
  {
    asks: /\bhow many days\b[^?]*\b(above|over|more than|exceed|exceeded|higher than)\b/i,
    ops: ["days_above"],
    say: "The question asks how many days were above an amount. Use a days_above step with the dollar amount, so code does the counting.",
  },
  {
    asks: /\b(\d+|[a-z]+) percent (lower|less|cheaper|cut|smaller|higher|more)\b[^?]*\?/i,
    unless: /\bwhy\b/i,
    ops: ["percent_of"],
    say: "The question asks what a percentage change would be worth. Add a percent_of step over a spend step with group none and the percentage, so code works out the amount.",
  },
  {
    asks: /\bmedian\b/i,
    ops: ["median_day"],
    say: "The question asks for a median day. Use a median_day step (days active counts only days with any spend, all counts every day of the range), so code finds the median.",
  },
  {
    asks: /\b(how many|number of|count of)\s+(\w+\s+)?sessions\b/i,
    unless: /\b(expensive|costliest|priciest|most|top|highest)\b/i,
    ops: ["count_sessions"],
    say: "The question asks how many sessions started. Use a count_sessions step over the range, so code does the counting.",
  },
  {
    asks: /\bin thousands\b/i,
    ops: ["in_thousands"],
    say: "The question asks for the amount in thousands of dollars. Add an in_thousands step over a spend step with group none, so code does the conversion.",
  },
];

/** What the program lacks for this question, one sentence each. Empty means the program covers every figure asked for. */
export function critiquePlan(question: string, program: AnswerProgram): string[] {
  const have = new Set<StepOp>(program.steps.map((s) => s.op));
  return NEEDS.filter((n) => n.asks.test(question) && !(n.unless && n.unless.test(question)) && !n.ops.some((op) => have.has(op))).map((n) => n.say);
}
