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

// Fields are assigned in the constructor, not declared as parameter properties: the offline verifier runs on plain Node,
// whose type stripping does not accept parameter properties, and this module is in its import chain.
export class AgentError extends Error {
  readonly errorClass: ErrorClass;
  readonly code: string;
  readonly details?: Json;
  constructor(errorClass: ErrorClass, code: string, message: string, details?: Json) {
    super(message);
    this.name = new.target.name;
    this.errorClass = errorClass;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** One or more places where a value did not fit its schema, each with the path to it. */
export class SchemaError extends AgentError {
  readonly issues: readonly Issue[];
  constructor(issues: readonly Issue[], context?: string) {
    const shown = issues.slice(0, 5).map((i) => `${i.path || "$"}: ${i.message}`);
    const rest = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : "";
    super("validation", "schema", `${context ? `${context}: ` : ""}${shown.join("; ")}${rest}`, { issues: issues.map((i) => ({ path: i.path, message: i.message })) });
    this.issues = issues;
  }
}

export type BudgetDimension = "turns" | "modelCalls" | "toolCalls" | "wallClockMs" | "inputTokens" | "outputTokens";

export class BudgetExceeded extends AgentError {
  readonly dimension: BudgetDimension;
  constructor(dimension: BudgetDimension, detail: string, details?: Json) {
    super("budget", "budget_exceeded", `budget exceeded (${dimension}): ${detail}`, details);
    this.dimension = dimension;
  }
}

/** A replay was asked for a response nobody recorded. It is an error, never a guess. */
export class CassetteMiss extends AgentError {
  readonly effectKey: string;
  constructor(effectKey: string, hint: string) {
    super("fatal", "cassette_miss", `no recorded response for effect ${effectKey}; ${hint}`, { effectKey });
    this.effectKey = effectKey;
  }
}

export class PolicyRefusal extends AgentError {
  constructor(code: string, message: string, details?: Json) {
    super("policy", code, message, details);
  }
}
