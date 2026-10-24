/**
 * The Desk's spend policy language (spec 10.1). A small closed fragment: finite sets, integer
 * intervals and caps, so that "this edit only narrows" can be decided by exhaustive evaluation of
 * a finite grid, with no solver. Money is integer micro-dollars everywhere.
 */
export const FINITE_DIMS = ["project", "person", "agent", "model", "task_type", "waste_rule", "action"] as const;
export type FiniteDim = (typeof FINITE_DIMS)[number];

/**
 * The numbers a rule can talk about. The spend ones are what the person (or one model, or one project) would have spent in a window if this request went
 * through: the day and month of the person, the session, the last ten minutes and the last hour (velocity), and the day and month of one model or one project.
 * The language stays closed: a cap picks one of these, so that "this edit only narrows" is still decided on a finite grid.
 */
export const NUMERIC_DIMS = [
  "recoverable_micros",
  "day_spend_after_micros",
  "month_spend_after_micros",
  "session_spend_after_micros",
  "spend_10m_after_micros",
  "spend_1h_after_micros",
  "model_day_spend_after_micros",
  "model_month_spend_after_micros",
  "project_day_spend_after_micros",
  "project_month_spend_after_micros",
] as const;
export type NumericDim = (typeof NUMERIC_DIMS)[number];

/** The dimensions beyond the first three: their value is 0 on a request that does not carry them. */
export type OptionalNumericDim = Exclude<NumericDim, "recoverable_micros" | "day_spend_after_micros" | "month_spend_after_micros">;

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

/** `day` and `month` are calendar UTC; `session` is one session; `10m` and `1h` slide back from now. */
export type CapWindow = "day" | "month" | "session" | "10m" | "1h";
/** Whose spend a cap counts: the person's whole (the default), or only the spend on the request's own model or project. */
export type CapPer = "person" | "model" | "project";

export interface Cap {
  window: CapWindow;
  /** Absent means the person's whole spend, as every cap meant before windows and scopes were added. */
  per?: CapPer;
  maxMicros: number;
  warnAt: number;
  askAt: number;
}

const PERSON_DIM: Record<CapWindow, NumericDim> = {
  day: "day_spend_after_micros",
  month: "month_spend_after_micros",
  session: "session_spend_after_micros",
  "10m": "spend_10m_after_micros",
  "1h": "spend_1h_after_micros",
};

/** The number a cap is measured against. A scope other than the person's has only a day and a month. */
export function capDim(cap: Cap): NumericDim {
  const per = cap.per ?? "person";
  if (per === "person") return PERSON_DIM[cap.window];
  if (cap.window !== "day" && cap.window !== "month") throw new RangeError(`a cap per ${per} has a day or a month window, not ${cap.window}`);
  return `${per}_${cap.window}_spend_after_micros` as NumericDim;
}

/** How a cap reads aloud: "day", "session", "last 10 minutes", "day per model". */
export function capLabel(cap: Cap): string {
  const w = cap.window === "10m" ? "last 10 minutes" : cap.window === "1h" ? "last hour" : cap.window;
  return cap.per === undefined || cap.per === "person" ? w : `${w} per ${cap.per}`;
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
  session_spend_after_micros?: number;
  spend_10m_after_micros?: number;
  spend_1h_after_micros?: number;
  model_day_spend_after_micros?: number;
  model_month_spend_after_micros?: number;
  project_day_spend_after_micros?: number;
  project_month_spend_after_micros?: number;
}

/** The value of a numeric dimension on a request: 0 where the request does not carry it. */
export function numericOf(req: Request, dim: NumericDim): number {
  return req[dim] ?? 0;
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
