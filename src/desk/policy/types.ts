/**
 * The Desk's spend policy language (spec 10.1). A small closed fragment: finite sets, integer
 * intervals and caps, so that "this edit only narrows" can be decided by exhaustive evaluation of
 * a finite grid, with no solver. Money is integer micro-dollars everywhere.
 */
export const FINITE_DIMS = ["project", "person", "agent", "model", "task_type", "waste_rule", "action"] as const;
export type FiniteDim = (typeof FINITE_DIMS)[number];

export const NUMERIC_DIMS = ["recoverable_micros", "day_spend_after_micros", "month_spend_after_micros"] as const;
export type NumericDim = (typeof NUMERIC_DIMS)[number];

export type Verdict = "allow" | "ask" | "deny";
export const VERDICT_ORDER: Record<Verdict, number> = { deny: 0, ask: 1, allow: 2 };

/** An inclusive or exclusive integer interval; infinite ends are +/-Infinity. */
export interface Interval {
  lo: number;
  loOpen: boolean;
  hi: number;
  hiOpen: boolean;
}

export interface Condition {
  finite: Partial<Record<FiniteDim, readonly string[]>>;
  numeric: Partial<Record<NumericDim, Interval>>;
}

export interface Cap {
  window: "day" | "month";
  maxMicros: number;
  warnAt: number;
  askAt: number;
}

export type Rule =
  | { id: string; kind: "permit"; when: Condition; cap?: Cap }
  | { id: string; kind: "forbid"; when: Condition; action: string }
  | { id: string; kind: "route"; when: Condition; modelMap: Readonly<Record<string, string>> };

export interface Approval {
  when: Condition;
  approvers: readonly string[];
}

export interface Policy {
  version: number;
  rules: readonly Rule[];
  approvals: readonly Approval[];
}

/** One request to the gate, reduced to the dimensions the language can talk about. */
export interface Request {
  project: string;
  person: string;
  agent: string;
  model: string;
  task_type: string;
  waste_rule: string;
  action: string;
  recoverable_micros: number;
  day_spend_after_micros: number;
  month_spend_after_micros: number;
}

export interface Decision {
  verdict: Verdict;
  /** True only when the policy could not be evaluated; callers must treat it as deny. */
  failed: boolean;
  reasons: string[];
  /** Rules that matched, in policy order. */
  matched: string[];
  /** The action named by a matching forbid rule, if any (for example pause_with_checkpoint). */
  action?: string;
}
