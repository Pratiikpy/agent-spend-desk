/**
 * Scout Intent, as the Meterless specification describes it (engines/scout-intent, Apache-2.0): five stages, Sense, Interpret, Guard, Route and Recommend, ending in a signed
 * execution contract that downstream engines verify before they act. This is an implementation written from that specification; where it leaves a choice open the choice is
 * ours and is marked.
 */
export type RiskClass = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high" | "block";

export interface ParameterSchema {
  type?: string;
  properties?: Record<string, ParameterProperty>;
  required?: string[];
}

export interface ParameterProperty {
  type?: "string" | "integer" | "number" | "boolean" | "array" | "object";
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
  optional?: boolean;
}

export interface Intent {
  id: string;
  category: string;
  description: string;
  parameters: ParameterSchema;
  capabilities: string[];
  riskClass: RiskClass;
  surfaces: string[];
  roles: string[];
  examples: string[];
  version: number;
}

export interface UserRef {
  id: string;
  role: string;
}

export interface DecideInput {
  prompt: string;
  user?: Partial<UserRef>;
  surface: string;
  context?: DecideContext;
}

/** What Scout is told about the conversation around the prompt. Every field is optional; a missing one is a term that scores zero. */
export interface DecideContext {
  /** The intents of the last few turns, newest first. */
  recentIntents?: string[];
  /** The intent of the workflow the user is in, when there is one. */
  activeWorkflow?: string;
  /** Text retrieved from memory for this prompt (H-MEM), used as extra evidence for the contextual term. */
  memory?: string[];
  /** Entities the surface already knows, by the name they are called: `{ Acme: "acct-1" }`. */
  entities?: Record<string, string>;
}

export interface IntentCandidate {
  intent: string;
  score: number;
  /** The part of the prompt this candidate is about. */
  span?: string;
}

export interface Band {
  name: "high" | "medium" | "low" | "reject";
  min: number;
}

export type ClarificationTrigger = "low-band" | "tie" | "params" | "high-risk" | "reference";

export interface Clarification {
  trigger: ClarificationTrigger;
  question: string;
  options: { label: string; intent: string }[];
}

export interface RiskFlag {
  layer: "injection" | "policy" | "scope" | "pii" | "rate";
  level: "warn" | "block";
  kind: string;
  reason: string;
  score?: number;
  evidence?: string[];
}

export interface Redaction {
  kind: string;
  count: number;
}

export interface ApprovalSpec {
  kind: "user-confirm" | "operator-review";
  why: string;
}

export interface ApprovalRecord {
  kind: "user-confirm" | "operator-review";
  at: string;
  by?: string;
  decision?: string;
  confirmation?: string;
}

export interface Risk {
  level: RiskLevel;
  flags: RiskFlag[];
  redactions: Redaction[];
  reason?: string;
  approvalsRequired?: ApprovalSpec[];
}

export interface ToolStep {
  capability: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface ModelProfile {
  id: string;
  provider: string;
  model: string;
  context: number;
  cost: { in: number; out: number };
  latency: { p95Ms: number };
  capabilities: string[];
  dataClasses: string[];
  fallbacks?: string[];
  local?: boolean;
}

export interface ModelProfileRef {
  id: string;
  provider: string;
  model: string;
  local: boolean;
}

export interface ExecutionContract {
  contractId: string;
  parentId?: string;
  traceId: string;
  intent: {
    primary: { id: string };
    parameters: Record<string, unknown>;
    references: Record<string, string>;
    confidence: number;
    alternates: IntentCandidate[];
    /** Further intents of a multi-intent plan, in the order the prompt gives them. */
    secondary?: IntentCandidate[];
  };
  risk: { level: Exclude<RiskLevel, "block">; flags: RiskFlag[]; redactions: Redaction[]; approvals: ApprovalRecord[] };
  toolPlan: ToolStep[];
  modelProfile: ModelProfileRef;
  scope: { user: UserRef; surface: string; capabilities: string[]; deadline?: string; budget?: { tokensMax?: number; costMaxUSD?: number } };
  issuedAt: string;
  expiresAt: string;
  registryVersion: number;
  policyPackVersion: string;
  signature: string;
  signedBy: "scout";
}

export interface Decision {
  traceId: string;
  /** Top-k scored candidates, never a single label. */
  candidates: IntentCandidate[];
  /** More than one intent when two candidates are both High and cover different parts of the prompt. */
  intents: IntentCandidate[];
  band: Band["name"];
  stage2: "used" | "skipped";
  intent: string | null;
  parameters: Record<string, unknown>;
  references: Record<string, string>;
  clarification?: Clarification;
  risk: Risk;
  toolPlan: ToolStep[];
  /** Absent when the decision is a block, a clarification or an unresolvable plan: nothing is signed that must not be acted on. */
  executionContract?: ExecutionContract;
  /** Optional capabilities (named with a trailing ?) that could not be resolved and were left out of the plan. */
  degraded?: string[];
  /** A typed reason when routing could not produce a plan. */
  unresolved?: { kind: "unresolvable-capability" | "permission" | "unavailable"; capability: string; detail: string };
  /** Set when the surface strips instruction-like text before scoring: which patterns matched, and the request that was left. */
  injection?: { ids: string[]; residual: string };
  latencyMs: number;
}

export interface TelemetryEvent {
  event: "scout.decision" | "contract.issued" | "contract.verified" | "contract.expired" | "contract.refused" | "scout.clarification" | "scout.override";
  traceId: string;
  at: string;
  detail: Record<string, unknown>;
}

export type TelemetrySink = (e: TelemetryEvent) => void;
