import { adoptionFailures, MIN_HELD_OUT_PAUSES } from "./adoption.ts";
import { describeFlip } from "../flip.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatUsd } from "../money.ts";
import { proposalFlips } from "../propose/flip.ts";
import type { ProposeResult } from "../propose/run.ts";
import type { ReplaySession } from "../replay/policy-replay.ts";
import { wilson } from "../stats/intervals.ts";
import { mustParseDecisionRecord, type DecisionRecord } from "./record.ts";

export { adoptionFailures, MIN_HELD_OUT_PAUSES };

export interface ProposalRecordInput {
  result: ProposeResult;
  sessions: readonly ReplaySession[];
  /** Sessions starting before this instant trained the draft; the rest were held out. */
  splitMs: number;
  now: Date;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const clip = (s: string, n = 590): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * The decision record for a proposed policy: what is recommended and why, the alternative of doing nothing weighed
 * beside it, the tests the proposal passed or failed, what is predicted with its uncertainty, and what the evidence
 * cannot show. It recommends conservatively: a proposal is adopted only if it narrows the policy in force, would have
 * paused no session whose work landed in the held-out period, and paused enough held-out sessions to be told from
 * chance. The record is written when the proposal is made; its approver, enforcement and observed outcome are filled
 * in by later steps. The evidence level stays `estimated`: a replay on recorded sessions is a counterfactual without
 * randomised assignment.
 */
export function proposalDecisionRecord(input: ProposalRecordInput): DecisionRecord {
  const { result: r, sessions, splitMs } = input;
  const h = r.heldOut;
  const hash12 = r.policyHash.replace("sha256:", "").slice(0, 12);
  const added = r.activity.map((a) => a.id);

  const failures = adoptionFailures({ narrows: r.restrict.narrows, landedBlocked: h.landedBlocked.length, landedTotal: h.landedTotal, paused: h.paused.length });
  const adopt = failures.length === 0;
  const hasRules = added.length > 0;

  const adoptReason = adopt
    ? `Narrows the policy over all ${r.restrict.gridSize} cells, paused ${h.paused.length} held-out sessions and blocked none of the ${h.landedTotal} that landed; at most ${formatUsd(h.savedMicros)} not spent in the held-out period if paused sessions did nothing more`
    : `Not recommended: ${failures.join("; ")}`;
  const keepReason = adopt
    ? `Gives up the held-out saving of up to ${formatUsd(h.savedMicros)} (an upper bound) from the waste the training period showed`
    : hasRules
      ? "The established policy stays until the proposal passes every check; weak evidence does not change it"
      : "No waste run in the training period was large enough to propose a rule, so there is nothing to adopt";

  const first = sessions.length > 0 ? day(sessions[0]!.startMs) : day(splitMs);
  const last = sessions.length > 0 ? day(sessions[sessions.length - 1]!.startMs) : day(splitMs);

  const record = {
    schema: "desk.decision_record.v1" as const,
    id: `dr-${hash12}`,
    createdAt: input.now.toISOString(),
    decision: adopt ? clip(`Add ${added.length} rule(s) (${added.join(", ")}) to the policy in force`) : "Keep the policy in force; do not add the proposed rules",
    context: {
      question: "Which rules, added to the policy in force, would have stopped the waste in the training period without pausing work that landed in the later, held-out period?",
      window: { from: first, to: last },
      population: `${r.trainingSessions} training and ${r.heldOutSessions} held-out sessions from this ledger`,
    },
    evidenceIds: [`policy:${r.policyHash}`, `replay:training:${r.trainingSessions}`, `replay:held-out:${r.heldOutSessions}`],
    memoryVersions: [] as string[],
    alternatives: [
      { id: "a1", summary: "Do nothing: keep the policy in force", outcome: adopt ? ("rejected" as const) : ("chosen" as const), reason: clip(keepReason) },
      { id: "a2", summary: clip(hasRules ? `Adopt the proposed policy ${hash12}, which adds ${added.join(", ")}` : `Adopt the proposed policy ${hash12}, which adds no rule`), outcome: adopt ? ("chosen" as const) : ("rejected" as const), reason: clip(adoptReason) },
    ],
    chosen: adopt ? "a2" : "a1",
    predictions: [] as DecisionRecord["predictions"],
    tests: [
      { id: "t1", kind: "restrict_check" as const, passed: r.restrict.narrows, detail: r.restrict.narrows ? `narrows only, over all ${r.restrict.gridSize} cells` : "widens the policy in force" },
      { id: "t2", kind: "held_out_replay" as const, passed: h.landedBlocked.length === 0, detail: `${h.landedBlocked.length} of ${h.landedTotal} landed sessions would have been paused on the held-out period; ${h.paused.length} sessions paused in all` },
      { id: "t3", kind: "attack" as const, passed: r.hardened.unresolved.length === 0, detail: `${r.hardened.closed.length} evasions closed, ${r.hardened.unresolved.length} unresolved` },
    ],
    approver: null,
    enforcement: null,
    observed: null,
    evidenceLevel: "estimated" as const,
    limits: [
      "The saving assumes a paused session does nothing more, including useful work, so it is an upper bound and not a forecast.",
      "A replay on recorded sessions is a counterfactual without randomised assignment: what a paused session would have done is not observed.",
      `Drafted from ${r.trainingSessions} sessions and checked on ${r.heldOutSessions} later ones from one ledger; a different period or team can behave differently.`,
      ...(r.hardened.unresolved.length > 0 ? [`The attacker left ${r.hardened.unresolved.length} evasion(s) unresolved; they are shown on the approval card.`] : []),
      `What would flip this recommendation: ${describeFlip(proposalFlips(h, r.restrict.narrows))}`,
    ].map((s) => clip(s)),
  };

  if (h.landedTotal > 0) {
    const ci = wilson(h.landedBlocked.length, h.landedTotal);
    record.predictions.push({
      metric: "share of landed sessions the policy would pause on a period like the held-out one",
      unit: "share",
      expected: h.landedBlocked.length / h.landedTotal,
      low: ci.low,
      high: ci.high,
      level: 0.95,
    });
  }
  return mustParseDecisionRecord(record);
}

/** Write the record beside the proposal's policy and trace, as readable JSON, and return where it went. */
export function writeDecisionRecord(record: DecisionRecord, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `proposal-${record.id.replace(/^dr-/, "")}.decision.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

/** One line for the proposal report: what is recommended, and where the whole record is. */
export function describeRecord(record: DecisionRecord, path: string): string {
  const recommends = record.chosen === "a2" ? "recommends adopting the proposal" : "recommends keeping the policy in force";
  const failed = record.tests.filter((t) => !t.passed).map((t) => t.kind.replace(/_/g, " "));
  return `decision record: ${recommends}${failed.length > 0 ? ` (failed: ${failed.join(", ")})` : ""}; evidence level ${record.evidenceLevel}; written to ${path}`;
}
