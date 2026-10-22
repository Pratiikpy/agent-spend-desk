import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

import { Budget, DRAFT_LIVE } from "../agents/budget.ts";
import { draftPolicy, type DraftResult, type Finding } from "../agents/drafter.ts";
import { hardenPolicy, type HardenResult } from "../agents/harden.ts";
import type { HarmClass } from "../agents/attacker.ts";
import type { ModelPort } from "../agents/model.ts";
import { MemoryTrace, type TraceLine } from "../agents/trace.ts";
import { formatUsd } from "../money.ts";
import { policyToDoc } from "../policy/doc.ts";
import { dropRedundantRules } from "../policy/simplify.ts";
import { restrictCheck, type RestrictResult } from "../policy/restrict.ts";
import type { Policy } from "../policy/types.ts";
import { replayPolicy, type ReplayResult, type ReplaySession } from "../replay/policy-replay.ts";
import { hashJson } from "../../runtime/canonical.ts";

/**
 * The spine of the demo: draft a policy from one period, check that it narrows the current policy, attack it,
 * and then replay it on a LATER period that was not used while drafting. The held-out figure is the headline;
 * the in-sample figure is shown smaller and labelled. If the held-out replay blocks landed work, that is what
 * gets reported (spec 1.4).
 */
export interface ProposeInput {
  current: Policy;
  /** Every replay session, oldest first. */
  sessions: readonly ReplaySession[];
  /** Sessions starting before this instant are the training period; the rest are held out. */
  splitMs: number;
  /** The smallest recoverable amount per waste run the owner wants stopped. */
  targetMinMicros: number;
  port: ModelPort | null;
  trace?: MemoryTrace;
  /** Budget for the whole proposal; the default is the drafting budget from the spec. */
  budget?: Budget;
}

export interface ProposeResult {
  trainingSessions: number;
  heldOutSessions: number;
  findings: Finding[];
  draft: DraftResult;
  hardened: HardenResult;
  final: Policy;
  restrict: RestrictResult;
  inSample: ReplayResult;
  heldOut: ReplayResult;
  /** Ids of rules dropped because an earlier rule already says the same thing. */
  redundantRemoved: string[];
  /** For each rule of the proposal, how many sessions it paused in each period. A rule at zero in both never fired. */
  activity: { id: string; trained: number; heldOut: number }[];
  /** Content hash of the proposed policy document, so an approval can bind to exactly this text. */
  policyHash: string;
  trace: readonly TraceLine[];
}

/** Waste runs of one rule in the training sessions: a run starts at the first flagged call and its recoverable figure is the whole run. */
export function findingsFrom(sessions: readonly ReplaySession[], targetMinMicros: number): Finding[] {
  const byRule = new Map<string, { micros: number; runs: number }>();
  for (const s of sessions) {
    let prev = "none";
    for (const c of s.calls) {
      if (c.wasteRule !== "none" && c.wasteRule !== prev) {
        const e = byRule.get(c.wasteRule) ?? { micros: 0, runs: 0 };
        e.micros += c.recoverableMicros;
        e.runs += 1;
        byRule.set(c.wasteRule, e);
      }
      prev = c.wasteRule;
    }
  }
  return [...byRule]
    .filter(([, e]) => e.micros >= targetMinMicros)
    .map(([wasteRule, e]) => ({ wasteRule, recoverableMicros: e.micros, occurrences: e.runs, targetMinMicros }))
    .sort((a, b) => b.recoverableMicros - a.recoverableMicros || a.wasteRule.localeCompare(b.wasteRule));
}

export async function propose(input: ProposeInput): Promise<ProposeResult> {
  const trace = input.trace ?? new MemoryTrace();
  const budget = input.budget ?? new Budget(DRAFT_LIVE);
  const training = input.sessions.filter((s) => s.startMs < input.splitMs);
  const heldOut = input.sessions.filter((s) => s.startMs >= input.splitMs);
  const findings = findingsFrom(training, input.targetMinMicros);
  const harm: HarmClass[] = findings.map((f) => ({ wasteRule: f.wasteRule, minRecoverableMicros: f.targetMinMicros }));
  trace.emit({ event: "desk.propose", why: "computed", role: "policy_drafter", detail: { training: training.length, held_out: heldOut.length, findings: findings.map((f) => ({ rule: f.wasteRule, usd: f.recoverableMicros / 1e6, runs: f.occurrences })) } });

  const draft = await draftPolicy({ current: input.current, findings, training, port: input.port, budget, trace });
  const hardened = await hardenPolicy({ original: input.current, drafted: draft.policy, harm, training, port: input.port, budget, trace });
  const simplified = dropRedundantRules(hardened.policy);
  const final = simplified.policy;
  const restrict = restrictCheck(input.current, final);
  const inSample = replayPolicy(final, training);
  const heldOutResult = replayPolicy(final, heldOut);
  const firedBy = (r: ReplayResult, id: string): number => r.paused.filter((p) => p.verdictReason.split("; ").some((x) => x === `forbid ${id}` || x === `cap ${id}: deny`)).length;
  const doc = policyToDoc(final);
  return {
    trainingSessions: training.length,
    heldOutSessions: heldOut.length,
    findings,
    draft,
    hardened,
    final,
    restrict,
    inSample,
    heldOut: heldOutResult,
    redundantRemoved: simplified.removed,
    activity: final.rules.filter((r) => !input.current.rules.some((c) => c.id === r.id)).map((r) => ({ id: r.id, trained: firedBy(inSample, r.id), heldOut: firedBy(heldOutResult, r.id) })),
    policyHash: hashJson(doc as never),
    trace: trace.events,
  };
}

function range(sessions: readonly ReplaySession[]): string {
  if (sessions.length === 0) return "no sessions";
  const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return `${day(sessions[0]!.startMs)} to ${day(sessions[sessions.length - 1]!.startMs)}`;
}

/** The report. Held-out first and largest; in-sample smaller and labelled; limits stated. */
export function renderProposal(r: ProposeResult, input: Pick<ProposeInput, "sessions" | "splitMs">): string {
  const training = input.sessions.filter((s) => s.startMs < input.splitMs);
  const held = input.sessions.filter((s) => s.startMs >= input.splitMs);
  const out: string[] = [];
  out.push(`Policy proposal, drafted from ${range(training)} (${training.length} sessions), checked on ${range(held)} (${held.length} sessions, held out: not used while drafting)`);
  out.push("");
  if (r.findings.length === 0) out.push("No waste run in the training period was large enough to propose a rule.");
  for (const f of r.findings) out.push(`finding  ${f.wasteRule}: ${f.occurrences} runs, ${formatUsd(f.recoverableMicros)} recoverable`);
  out.push("");
  out.push(r.restrict.narrows ? `restrict check: narrows only, over all ${r.restrict.gridSize} cells` : "restrict check: WIDENS the policy, so this proposal must not be applied");
  if (r.restrict.routeChanges.length > 0) out.push(`route rules change behaviour, not a narrowing: ${r.restrict.routeChanges.length} changes need their own approval`);
  out.push(`attacker: ${r.hardened.closed.length} evasions closed, ${r.hardened.unresolved.length} unresolved${r.hardened.unresolved.length > 0 ? " (shown on the approval card)" : ""}`);
  out.push(`drafter: ${r.draft.usedFallback ? "rule brain (model not used or failed)" : "model draft, checked by code"}; ${r.draft.rounds} round(s)`);
  if (r.draft.escalation) out.push(`escalation: ${r.draft.escalation}`);
  for (const a of r.activity) out.push(`rule ${a.id}: paused ${a.trained} sessions in the training period, ${a.heldOut} in the held-out period${a.trained + a.heldOut === 0 ? " (never fired in either)" : ""}`);
  if (r.redundantRemoved.length > 0) out.push(`dropped as redundant (an earlier rule says the same): ${r.redundantRemoved.join(", ")}`);
  out.push("");
  const h = r.heldOut;
  out.push(`HELD OUT ${range(held)}: ${h.paused.length} sessions paused, ${formatUsd(h.savedMicros)} not spent (upper bound), ${h.landedBlocked.length} of ${h.landedTotal} landed sessions blocked`);
  const i = r.inSample;
  out.push(`in-sample ${range(training)} (the period it was drafted from): ${i.paused.length} paused, ${formatUsd(i.savedMicros)} not spent, ${i.landedBlocked.length} of ${i.landedTotal} landed blocked`);
  out.push("The saving assumes a paused session does nothing more, including useful work. The replay is a counterfactual on recorded sessions.");
  out.push(`policy hash ${r.policyHash.slice(0, 19)}`);
  return out.join("\n");
}

export function writeProposal(r: ProposeResult, dir: string): { policyPath: string; tracePath: string } {
  mkdirSync(dir, { recursive: true });
  const id = r.policyHash.replace("sha256:", "").slice(0, 12);
  const policyPath = join(dir, `proposal-${id}.yaml`);
  const tracePath = join(dir, `proposal-${id}.trace.jsonl`);
  writeFileSync(policyPath, stringify(policyToDoc(r.final)));
  mkdirSync(dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, r.trace.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { policyPath, tracePath };
}
