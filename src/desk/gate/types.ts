import type { Micros } from "../money.ts";
import type { Verdict } from "../policy/types.ts";

export type WindowKind = "day" | "month";

export type EventKind =
  | "authorized"
  | "settled"
  | "voided"
  | "expired"
  | "overage"
  | "observed"
  | "denied"
  | "asked"
  | "approved"
  | "shadow_would_deny"
  | "idempotent_replayed"
  | "paused"
  | "resumed"
  | "bypass_opened"
  | "bypass_closed"
  | "bypass_allowed";

export interface BudgetRef {
  budgetId: string;
  window: WindowKind;
  /** The cap that applied when the event was written; null when the scope is not enforced (no cap, or shadow mode). */
  limitMicros: Micros | null;
}

/** One row of the append-only event table. */
export interface GateEventRow {
  id: number;
  ts: string;
  kind: EventKind;
  reservation_id: number | null;
  idempotency_key: string | null;
  budget_set: string | null;
  session_id: string | null;
  person: string | null;
  project: string | null;
  agent: string | null;
  model: string | null;
  tool: string | null;
  call_ref: string | null;
  amount_micros: Micros;
  expires_at: string | null;
  reason_code: string | null;
  reason: string | null;
  verdict: Verdict | null;
  policy_version: number | null;
  approval_id: number | null;
  basis: string;
  prev_hash: string;
  hash: string;
  sig: string | null;
}

export type EventInput = Partial<Omit<GateEventRow, "id" | "ts" | "kind" | "prev_hash" | "hash" | "basis" | "sig">> & {
  kind: EventKind;
  basis?: unknown;
  budgets?: readonly BudgetRef[];
  /** When set, the event's hash is signed with HMAC-SHA-256 under this key (used for the emergency switch). */
  signKey?: string;
};

export type ReservationState = "open" | "settled" | "voided" | "expired" | "late_settled";

export interface ReservationView {
  id: number;
  authorized: GateEventRow;
  budgets: BudgetRef[];
  state: ReservationState;
  settled: GateEventRow | undefined;
  overage: GateEventRow | undefined;
  closing: GateEventRow | undefined;
}

export interface BudgetTotals {
  budgetId: string;
  window: WindowKind;
  spent: Micros;
  reserved: Micros;
  /** Money that may lawfully sit above the limit: recorded overage and late settles. */
  excused: Micros;
  limit: Micros | null;
}

export interface Violation {
  invariant: "I-R1" | "I-R2" | "I-R3" | "I-R4" | "I-R5" | "chain" | "shape";
  eventId: number | null;
  message: string;
}

export interface GateRequest {
  session_id: string;
  person: string;
  project: string;
  agent: string;
  model: string;
  task_type: string;
  waste_rule: string;
  action: string;
  tool: string | null;
  recoverable_micros: Micros;
  idempotency_key: string | null;
  /** An explicit worst-case amount; combined with the token estimate by taking the larger. */
  estimate_micros: Micros | null;
  input_tokens: number | null;
  max_tokens: number | null;
  n: number;
  ttl_ms: number | null;
  call_ref: string | null;
  approval_id: number | null;
}

export interface BudgetStanding {
  window: WindowKind;
  budgetId: string;
  spentMicros: Micros;
  reservedMicros: Micros;
  limitMicros: Micros | null;
  remainingMicros: Micros | null;
}

export interface GateDecision {
  verdict: Verdict;
  /** True when the gate could not evaluate and is refusing as a precaution. */
  failed: boolean;
  /** True when shadow mode turned a deny or ask into an allow. */
  shadow: boolean;
  reasonCode: string;
  reasons: string[];
  matched: string[];
  /** Named by a matching forbid rule, for example pause_with_checkpoint. */
  action: string | null;
  reservationId: number | null;
  idempotencyKey: string;
  /** True when this is the first decision, returned again for a repeated key. */
  idempotent: boolean;
  reservedMicros: Micros;
  expiresAt: string | null;
  routedModel: string;
  standing: BudgetStanding[];
  policyVersion: number | null;
  approvalRequest: { approval_request_id: number; action_digest: string } | null;
  basis: Record<string, unknown>;
}

export class GateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GateError";
  }
}
