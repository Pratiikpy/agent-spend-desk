import { canonicalJson, hashJson, sha256Hex } from "../../runtime/canonical.ts";
import { Budget, DRAFT_LIVE, type BudgetLimits } from "../agents/budget.ts";
import { ModelError, requestKey, type ModelErrorKind, type ModelPort, type ModelRequest, type ModelResponse } from "../agents/model.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { policyToDoc } from "../policy/doc.ts";
import { propose, type ProposeResult } from "../propose/run.ts";
import type { PolicyChangePack } from "../dossier/policy-change.ts";
import type { Policy } from "../policy/types.ts";
import type { Row } from "../verify/format.ts";
import type { ReplayResult, ReplaySession } from "./policy-replay.ts";

/**
 * Re-execute a recorded policy decision (DF-110). A decision is the pipeline `propose()` runs on one period: findings, the Drafter's draft, the Attacker's round, the
 * simplification, the restrict-only check and the replay on the held-out period. When a proposal is issued, every reply the model gave and every stage's output is
 * recorded; when it is approved, that record is signed beside the dossier and tied to it by the dossier's manifest digest. Replaying it runs the same code on the sessions
 * in the dossier, serves each model request from the recording (an unrecorded request, or one whose text changed, is a divergence and not a guess), and compares every
 * stage with what was attested, byte for byte, stopping at the first that differs.
 */
export const DECISION_PAYLOAD_TYPE = "application/vnd.desk.decision+json";
export const DECISION_PREDICATE = "urn:desk:decision:v1";

export type StageId = "findings" | "draft" | "harden" | "simplify" | "restrict" | "replay" | "activity" | "final";
export const STAGE_ORDER: readonly StageId[] = ["findings", "draft", "harden", "simplify", "restrict", "replay", "activity", "final"];

export interface Stage {
  id: StageId;
  /** `sha256:` of the stage's canonical text. */
  digest: string;
  value: unknown;
}

export type RecordedOutcome =
  | { ok: true; response: Pick<ModelResponse, "content" | "toolCalls" | "servedBy" | "servedModel" | "usage"> }
  | { ok: false; kind: ModelErrorKind; message: string };

export interface RecordedCall {
  role: string;
  key: string;
  outcome: RecordedOutcome;
}

export interface DecisionInputs {
  currentPolicyId: string;
  proposedPolicyId: string;
  targetMinMicros: number;
  splitMs: number;
  trainingSessions: number;
  heldOutSessions: number;
  /** Digest of the sessions as the dossier carries them, so the record names the inputs the replay will read. */
  sessionsDigest: string;
}

export interface DecisionRecord {
  version: 1;
  kind: "policy_change";
  brain: "rules" | "model";
  inputs: DecisionInputs;
  /** The limits that shape what the pipeline asks of a model. Wall-clock time is not one of them: a replay takes none. */
  budget: Pick<BudgetLimits, "modelCalls" | "toolCalls" | "turns">;
  calls: RecordedCall[];
  stages: Stage[];
}

/** What a model-calling run leaves behind: every request's key, role and outcome, success or error, in order. */
export function recordingPort(inner: ModelPort): { port: ModelPort; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const port: ModelPort = {
    async complete(request: ModelRequest, deadlineMs: number): Promise<ModelResponse> {
      const key = requestKey(request);
      try {
        const r = await inner.complete(request, deadlineMs);
        calls.push({ role: request.role, key, outcome: { ok: true, response: { content: r.content, toolCalls: r.toolCalls, servedBy: r.servedBy, servedModel: r.servedModel, usage: r.usage } } });
        return r;
      } catch (e) {
        if (e instanceof ModelError) calls.push({ role: request.role, key, outcome: { ok: false, kind: e.kind, message: e.message.slice(0, 300) } });
        throw e;
      }
    },
  };
  return { port, calls };
}

export class ReplayDivergence extends Error {
  constructor(readonly role: string, readonly key: string, readonly expected: string | null) {
    super(expected === null ? `the pipeline asked for a model reply that was not recorded (role ${role}, request ${key})` : `the pipeline asked for a different request than the one recorded next (role ${role}, request ${key}, recorded ${expected})`);
    this.name = "ReplayDivergence";
  }
}

/** Serves the recorded outcomes in the order they were given. A request that is not the next one recorded for its key is a divergence. */
export function replayPort(calls: readonly RecordedCall[]): ModelPort {
  const queue = new Map<string, RecordedCall[]>();
  for (const c of calls) queue.set(c.key, [...(queue.get(c.key) ?? []), c]);
  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const key = requestKey(request);
      const next = queue.get(key)?.shift();
      if (!next) throw new ReplayDivergence(request.role, key, calls.find((c) => c.role === request.role)?.key ?? null);
      if (!next.outcome.ok) throw new ModelError(next.outcome.kind, next.outcome.message);
      const r = next.outcome.response;
      return { content: r.content, toolCalls: r.toolCalls, servedBy: r.servedBy, servedModel: r.servedModel, usage: r.usage, source: "cassette" };
    },
  };
}

const rid = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

function summarise(r: ReplayResult): unknown {
  return {
    totalMicros: r.totalMicros,
    savedMicros: r.savedMicros,
    askedCalls: r.askedCalls,
    deniedCalls: r.deniedCalls,
    landedTotal: r.landedTotal,
    landedBlocked: [...r.landedBlocked].sort(),
    paused: r.paused.map((p) => rid(p)),
  };
}

function stage(id: StageId, value: unknown): Stage {
  const v = rid(value);
  return { id, digest: hashJson(v), value: v };
}

/** The pipeline's output at each stage, in the order it runs. No timestamp, duration or identifier that varies between runs is in any of them. */
export function stagesOf(r: ProposeResult): Stage[] {
  return [
    stage("findings", r.findings),
    stage("draft", { policy: policyToDoc(r.draft.policy), accepted: r.draft.accepted, rounds: r.draft.rounds, usedFallback: r.draft.usedFallback, check: r.draft.check, escalation: r.draft.escalation }),
    stage("harden", { policy: policyToDoc(r.hardened.policy), rounds: r.hardened.rounds, closed: r.hardened.closed, unresolved: r.hardened.unresolved }),
    stage("simplify", { removed: r.redundantRemoved, policy: policyToDoc(r.final) }),
    stage("restrict", r.restrict),
    stage("replay", { inSample: summarise(r.inSample), heldOut: summarise(r.heldOut), trainingSessions: r.trainingSessions, heldOutSessions: r.heldOutSessions }),
    stage("activity", r.activity),
    stage("final", { policyHash: r.policyHash }),
  ];
}

/** The sessions of a policy-change dossier, from its two replay streams (the inverse of how the dossier writes them). */
export function sessionsFromRows(training: readonly Row[], heldOut: readonly Row[]): ReplaySession[] {
  const one = (row: Row): ReplaySession => {
    const d = row.data as { id: string; person: string; project: string; agent: string; task_type: string; landed: boolean; start_ms: number; calls: { o: number; c: number; m: string; w: string; r: number }[] };
    return {
      id: d.id, person: d.person, project: d.project, agent: d.agent, taskType: d.task_type, landed: d.landed, startMs: d.start_ms,
      calls: d.calls.map((c) => ({ offsetMs: c.o, costMicros: c.c, model: c.m, wasteRule: c.w, recoverableMicros: c.r })),
    };
  };
  return [...training, ...heldOut].map(one);
}

export const sessionsDigest = (training: readonly Row[], heldOut: readonly Row[]): string => `sha256:${sha256Hex(canonicalJson({ training: training.map((r) => r.row_hash), heldOut: heldOut.map((r) => r.row_hash) }))}`;

/** Attach the decision to the pack a proposal issues, if it replays from the sessions the dossier will carry. */
export async function attachDecision(pack: PolicyChangePack, i: Omit<CaptureInput, "training" | "heldOut" | "currentPolicyId" | "proposedPolicyId">): Promise<PolicyChangePack> {
  const captured = await captureDecision({
    ...i,
    training: pack.log.filter((r) => r.stream === "replay_training"),
    heldOut: pack.log.filter((r) => r.stream === "replay_heldout"),
    currentPolicyId: pack.currentId,
    proposedPolicyId: pack.proposedId,
  });
  return captured.record ? { ...pack, decision: captured.record } : { ...pack, decisionNote: captured.why };
}

export interface RunInput {
  current: Policy;
  sessions: readonly ReplaySession[];
  splitMs: number;
  targetMinMicros: number;
  port: ModelPort | null;
  budget: Pick<BudgetLimits, "modelCalls" | "toolCalls" | "turns">;
}

/** Run the pipeline once. The time limits of a live run are not part of a decision, so they are set high enough never to act. */
export async function runPipeline(i: RunInput): Promise<ProposeResult> {
  const limits: BudgetLimits = { ...DRAFT_LIVE, ...i.budget, wallClockMs: 24 * 60 * 60 * 1000, callDeadlineMs: 60_000 };
  return propose({ current: i.current, sessions: i.sessions, splitMs: i.splitMs, targetMinMicros: i.targetMinMicros, port: i.port, trace: new MemoryTrace(), budget: new Budget(limits) });
}

export type Comparison = { same: true } | { same: false; stage: StageId; differences: { path: string; recorded: unknown; recomputed: unknown }[] };

/** Every path at which two JSON values differ, at most `limit` of them, for a message a person can read. */
export function jsonDiff(a: unknown, b: unknown, path = "$", out: { path: string; recorded: unknown; recomputed: unknown }[] = [], limit = 12): { path: string; recorded: unknown; recomputed: unknown }[] {
  if (out.length >= limit) return out;
  const text = (v: unknown): string => (v === undefined ? "undefined" : canonicalJson(v));
  if (text(a) === text(b)) return out;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i += 1) jsonDiff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (out.length >= limit) break;
      jsonDiff(a[k], b[k], `${path}.${k}`, out, limit);
    }
    return out;
  }
  out.push({ path, recorded: a, recomputed: b });
  return out;
}

/** Compare recomputed stages with the attested ones in order, and stop at the first difference. */
export function compareStages(attested: readonly Stage[], recomputed: readonly Stage[]): Comparison {
  for (const want of attested) {
    const got = recomputed.find((s) => s.id === want.id);
    if (!got) return { same: false, stage: want.id, differences: [{ path: "$", recorded: want.value, recomputed: null }] };
    if (got.digest !== want.digest || canonicalJson(got.value) !== canonicalJson(want.value)) return { same: false, stage: want.id, differences: jsonDiff(want.value, got.value) };
  }
  return { same: true };
}

export interface CaptureInput {
  current: Policy;
  /** The sessions as the dossier carries them (rows), in the two periods. */
  training: readonly Row[];
  heldOut: readonly Row[];
  splitMs: number;
  targetMinMicros: number;
  brain: "rules" | "model";
  calls: readonly RecordedCall[];
  /** The result of the live run, whose stages are attested. */
  result: ProposeResult;
  currentPolicyId: string;
  proposedPolicyId: string;
}

/**
 * The record of a decision, attested only if it replays: the pipeline is run again from the sessions as the dossier will carry them and the recordings, and every stage must
 * equal the live run's. A decision that does not replay (a redaction changed what a rule saw, a reply was not recorded, a time limit ended a run) is not attested, and the
 * reason is returned instead.
 */
export async function captureDecision(i: CaptureInput): Promise<{ record: DecisionRecord } | { record: null; why: string }> {
  const budget = { modelCalls: DRAFT_LIVE.modelCalls, toolCalls: DRAFT_LIVE.toolCalls, turns: DRAFT_LIVE.turns };
  const live = stagesOf(i.result);
  const record: DecisionRecord = {
    version: 1,
    kind: "policy_change",
    brain: i.brain,
    inputs: { currentPolicyId: i.currentPolicyId, proposedPolicyId: i.proposedPolicyId, targetMinMicros: i.targetMinMicros, splitMs: i.splitMs, trainingSessions: i.training.length, heldOutSessions: i.heldOut.length, sessionsDigest: sessionsDigest(i.training, i.heldOut) },
    budget,
    calls: [...i.calls],
    stages: live,
  };
  try {
    const again = await runPipeline({ current: i.current, sessions: sessionsFromRows(i.training, i.heldOut), splitMs: i.splitMs, targetMinMicros: i.targetMinMicros, port: i.brain === "model" ? replayPort(i.calls) : null, budget });
    const cmp = compareStages(live, stagesOf(again));
    if (!cmp.same) return { record: null, why: `the decision does not replay from the dossier's own sessions: stage ${cmp.stage} differs at ${cmp.differences[0]?.path ?? "$"}` };
  } catch (e) {
    return { record: null, why: `the decision does not replay from the dossier's own sessions: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { record };
}
