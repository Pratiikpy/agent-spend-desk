import type { Json } from "./json.ts";

/**
 * Error classes are values the runtime routes on, never substrings of messages.
 * - transient: worth a bounded retry (timeout, rate limit, 5xx)
 * - validation: the output failed a schema or validator; re-prompt at most N times
 * - budget: a hard limit was reached; route to finalisation
 * - policy: a gate refused; never retried
 * - fatal: cannot continue (auth, unsupported configuration, cassette miss)
 */
export type ErrorClass = "transient" | "validation" | "budget" | "policy" | "fatal";

export class PlumblineError extends Error {
  readonly errorClass: ErrorClass;
  readonly code: string;
  readonly details: Json | undefined;

  constructor(errorClass: ErrorClass, code: string, message: string, details?: Json) {
    super(message);
    this.name = new.target.name;
    this.errorClass = errorClass;
    this.code = code;
    this.details = details;
  }
}

export interface Issue {
  path: string;
  message: string;
}

export class SchemaError extends PlumblineError {
  readonly issues: readonly Issue[];

  constructor(issues: readonly Issue[], context?: string) {
    const head = issues
      .slice(0, 5)
      .map((i) => `${i.path || "$"}: ${i.message}`)
      .join("; ");
    const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
    super("validation", "schema", `${context ? `${context}: ` : ""}${head}${more}`, {
      issues: issues.map((i) => ({ path: i.path, message: i.message })),
    });
    this.issues = issues;
  }
}

export type BudgetDimension =
  | "turns"
  | "modelCalls"
  | "toolCalls"
  | "wallClockMs"
  | "inputTokens"
  | "outputTokens";

export class BudgetExceeded extends PlumblineError {
  readonly dimension: BudgetDimension;

  constructor(dimension: BudgetDimension, detail: string, details?: Json) {
    super("budget", "budget_exceeded", `budget exceeded (${dimension}): ${detail}`, details);
    this.dimension = dimension;
  }
}

export class CassetteMiss extends PlumblineError {
  readonly effectKey: string;

  constructor(effectKey: string, hint: string) {
    super("fatal", "cassette_miss", `no recorded response for effect ${effectKey}; ${hint}`, {
      effectKey,
    });
    this.effectKey = effectKey;
  }
}

export class PolicyRefusal extends PlumblineError {
  constructor(code: string, message: string, details?: Json) {
    super("policy", code, message, details);
  }
}
