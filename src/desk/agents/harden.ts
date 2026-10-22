import { stringify } from "yaml";

import { policyToDoc } from "../policy/doc.ts";
import { parsePolicy } from "../policy/parse.ts";
import { restrictCheck } from "../policy/restrict.ts";
import type { Policy } from "../policy/types.ts";
import { replayPolicy, type ReplaySession } from "../replay/policy-replay.ts";
import type { Budget } from "./budget.ts";
import { probeEvasions, proposeEvasions, type Evasion, type HarmClass } from "./attacker.ts";
import type { ModelPort } from "./model.ts";
import { NULL_TRACE, type Trace } from "./trace.ts";

/** Attack rounds after a draft passes (spec 12.3, loop 4). */
export const MAX_ATTACK_ROUNDS = 2;

export interface HardenResult {
  policy: Policy;
  rounds: number;
  /** Evasions found and then closed by a rule change that still narrowed the policy and blocked no landed session. */
  closed: Evasion[];
  /** Evasions that remain. They are shown on the approval card and never hidden. */
  unresolved: Evasion[];
}

type Doc = { rules: Record<string, unknown>[] } & Record<string, unknown>;

/**
 * Close one evasion by editing the forbid rules that target the harm class. A stepped-around dimension is
 * dropped from the rule's conditions (a broader forbid); a threshold is lowered to the owner's target.
 * Returns null when no edit applies.
 */
function closeEvasion(policy: Policy, e: Evasion, harm: readonly HarmClass[]): Policy | null {
  const doc = JSON.parse(JSON.stringify(policyToDoc(policy))) as Doc;
  const h = harm.find((x) => x.wasteRule === e.request.waste_rule);
  let changed = false;
  for (const r of doc.rules) {
    if (r["kind"] !== "forbid") continue;
    const when = r["when"] as Record<string, unknown>;
    const targets = (when["waste_rule"] as { in?: string[] } | undefined)?.in?.includes(e.request.waste_rule) ?? true;
    if (!targets) continue;
    if (e.dimension === "recoverable_micros" && h && when["recoverable_usd"]) {
      when["recoverable_usd"] = { gte: (h.minRecoverableMicros / 1e6).toFixed(2) };
      changed = true;
    } else if (e.dimension && e.dimension !== "recoverable_micros" && when[e.dimension]) {
      delete when[e.dimension];
      changed = true;
    } else if (e.dimension === null && h) {
      // Nothing covers the harm class at all: add a plain forbid for it.
      continue;
    }
  }
  if (e.dimension === null && h && !changed) {
    doc.rules.push({ id: `stop-${h.wasteRule.toLowerCase()}-target`, kind: "forbid", when: { waste_rule: { in: [h.wasteRule] }, recoverable_usd: { gte: (h.minRecoverableMicros / 1e6).toFixed(2) } }, action: "pause_with_checkpoint" });
    changed = true;
  }
  if (!changed) return null;
  doc["version"] = policy.version + 1;
  try {
    return parsePolicy(doc);
  } catch {
    return null;
  }
}

/**
 * Attack the drafted policy and close what can be closed. Each round the code probes, the attacker model
 * adds proposals the evaluator confirms, and every fix must still narrow the original policy and pause no
 * landed session on the training window. A fix that fails those checks is not applied, and its evasion
 * stays on the list.
 */
export async function hardenPolicy(opts: {
  original: Policy;
  drafted: Policy;
  harm: readonly HarmClass[];
  training: readonly ReplaySession[];
  port: ModelPort | null;
  budget: Budget;
  trace?: Trace;
}): Promise<HardenResult> {
  const trace = opts.trace ?? NULL_TRACE;
  let policy = opts.drafted;
  const closed: Evasion[] = [];
  let unresolved: Evasion[] = [];
  let rounds = 0;

  for (let round = 1; round <= MAX_ATTACK_ROUNDS; round += 1) {
    rounds = round;
    let found = probeEvasions(policy, opts.harm);
    if (opts.port) found = found.concat(await proposeEvasions(stringify(policyToDoc(policy)), policy, opts.harm, opts.port, opts.budget, trace));
    trace.emit({ event: "desk.attack", why: "computed", role: "policy_attacker", detail: { round, evasions: found.map((f) => ({ source: f.source, dimension: f.dimension, why: f.why })) } });
    if (found.length === 0) {
      unresolved = [];
      break;
    }
    unresolved = [];
    for (const e of found) {
      const fixed = closeEvasion(policy, e, opts.harm);
      const ok = fixed && restrictCheck(opts.original, fixed).narrows && replayPolicy(fixed, opts.training).landedBlocked.length === 0;
      if (fixed && ok) {
        policy = fixed;
        closed.push(e);
        trace.emit({ event: "revision.applied", why: "computed", role: "policy_drafter", detail: { round, closed: e.why } });
      } else {
        unresolved.push(e);
      }
    }
    if (unresolved.length === found.length) break;
  }
  // Re-probe once so the unresolved list reflects the final policy, not an earlier one.
  unresolved = probeEvasions(policy, opts.harm);
  return { policy, rounds, closed, unresolved };
}
