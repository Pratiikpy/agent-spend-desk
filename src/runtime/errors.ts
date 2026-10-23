import type { Json } from "./json.ts";

/**
 * Failures carry a class that code routes on, never a message that code parses.
 *   transient   a bounded retry may help: a timeout, a rate limit, a 5xx
 *   validation  an output failed its schema; ask again a limited number of times
 *   budget      a hard limit was reached; finish with what exists
 *   policy      a gate said no; never retried
 *   fatal       nothing can continue: bad configuration, a recording that does not exist
 */
export type ErrorClass = "transient" | "validation" | "budget" | "policy" | "fatal";

export interface Issue {
  path: string;
  message: string;
}

export class AgentError extends Error {
  constructor(
    readonly errorClass: ErrorClass,
    readonly code: string,
    message: string,
    readonly details?: Json,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** One or more places where a value did not fit its schema, each with the path to it. */
export class SchemaError extends AgentError {
  constructor(readonly issues: readonly Issue[], context?: string) {
    const shown = issues.slice(0, 5).map((i) => `${i.path || "$"}: ${i.message}`);
    const rest = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : "";
    super("validation", "schema", `${context ? `${context}: ` : ""}${shown.join("; ")}${rest}`, { issues: issues.map((i) => ({ path: i.path, message: i.message })) });
  }
}

export type BudgetDimension = "turns" | "modelCalls" | "toolCalls" | "wallClockMs" | "inputTokens" | "outputTokens";

export class BudgetExceeded extends AgentError {
  constructor(readonly dimension: BudgetDimension, detail: string, details?: Json) {
    super("budget", "budget_exceeded", `budget exceeded (${dimension}): ${detail}`, details);
  }
}

/** A replay was asked for a response nobody recorded. It is an error, never a guess. */
export class CassetteMiss extends AgentError {
  constructor(readonly effectKey: string, hint: string) {
    super("fatal", "cassette_miss", `no recorded response for effect ${effectKey}; ${hint}`, { effectKey });
  }
}

export class PolicyRefusal extends AgentError {
  constructor(code: string, message: string, details?: Json) {
    super("policy", code, message, details);
  }
}
