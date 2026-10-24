import type { Evasion } from "../agents/attacker.ts";
import { ClaimLedger, type Claim } from "../agents/claims.ts";
import { folderName } from "../engines/label.ts";
import { formatUsd } from "../money.ts";
import { policyToDoc } from "../policy/doc.ts";
import { evaluate } from "../policy/evaluate.ts";
import type { Policy } from "../policy/types.ts";
import { restrictCheck } from "../policy/restrict.ts";
import { replayPolicy, type ReplaySession } from "../replay/policy-replay.ts";
import type { Row } from "../verify/format.ts";
import { auditedSentences, type ApprovalCard } from "./approval.ts";
import type { ClaimInput, DossierInput, SentenceInput } from "./build.ts";
import { policyId } from "./build.ts";
import { MemoryLog } from "./log.ts";

/**
 * A dossier for a proposed policy change. The log carries the sessions the proposal was checked on, one row per
 * session with its calls, in two streams: the period it was drafted from and the later period held out. Every
 * figure the dossier states about the proposal is a `policy_replay@1` computation over those rows and the bundled
 * policy documents, so a stranger recomputes it, and the restrict-only claim is a `restrict_narrows@1` computation
 * over the two bundled policies. Folder names stand for project paths, so no home directory is published.
 */
export interface PolicyChangeInput {
  current: Policy;
  proposed: Policy;
  trainingSessions: readonly ReplaySession[];
  heldOutSessions: readonly ReplaySession[];
  tenant: string;
  period: { from: string; to: string };
  createdAt: string;
  /** What the Attacker found that the proposal still allows; they go on the card as typed fields. */
  unresolvedEvasions?: readonly Evasion[];
}

export interface PolicyChangePack {
  /** Everything needed to build the signed dossier after the approval arrives; stored beside the request. */
  log: Row[];
  claims: ClaimInput[];
  sentences: SentenceInput[];
  policies: { docs: unknown[]; changes: { from: string; to: string }[] };
  card: ApprovalCard;
  currentId: string;
  proposedId: string;
  meta: Pick<DossierInput, "kind" | "tenant" | "period" | "createdAt" | "audience" | "disclosure">;
  ruleIdsAdded: string[];
}

const hex = (id: string): string => id.slice("sha256:".length);

function rowOf(s: ReplaySession): Record<string, unknown> {
  return {
    id: s.id,
    person: s.person,
    project: folderName(s.project),
    agent: s.agent,
    task_type: s.taskType,
    landed: s.landed,
    start_ms: s.startMs,
    calls: s.calls.map((c) => ({ o: c.offsetMs, c: c.costMicros, m: c.model, w: c.wasteRule, r: c.recoverableMicros })),
  };
}

const usd = formatUsd;

export function buildPolicyChangePack(input: PolicyChangeInput): PolicyChangePack {
  const log = new MemoryLog();
  for (const s of input.trainingSessions) log.append("replay_training", "session", rowOf(s));
  for (const s of input.heldOutSessions) log.append("replay_heldout", "session", rowOf(s));
  const train = input.trainingSessions.length;
  const held = input.heldOutSessions.length;
  if (train === 0 || held === 0) throw new RangeError("a policy-change dossier needs sessions in both the training and the held-out period");

  const prevDoc = policyToDoc(input.current);
  const nextDoc = policyToDoc(input.proposed);
  const currentId = policyId(prevDoc);
  const proposedId = policyId(nextDoc);
  const heldResult = replayPolicy(input.proposed, input.heldOutSessions);
  const trainResult = replayPolicy(input.proposed, input.trainingSessions);
  const narrows = restrictCheck(input.current, input.proposed);

  const comp = (stream: string, count: number, metric: string): ClaimInput["computation"] => ({ fn: "policy_replay@1", args: { policy: hex(proposedId), metric }, range: { stream, from: 0, to: count - 1 } });
  const num = (id: string, text: string, stream: string, count: number, metric: string, unit: "usd" | "count"): ClaimInput => ({
    id, kind: "number", text, unit, class: "computed", decimals: unit === "usd" ? 2 : 0, divisor: unit === "usd" ? 1_000_000 : 1, computation: comp(stream, count, metric),
  });
  const claims: ClaimInput[] = [
    num("h_sessions", "Sessions in the held-out period", "replay_heldout", held, "sessions", "count"),
    num("h_paused", "Sessions the proposed policy would have paused in the held-out period", "replay_heldout", held, "paused", "count"),
    num("h_landed", "Sessions in the held-out period whose work landed", "replay_heldout", held, "landed_total", "count"),
    num("h_blocked", "Landed sessions the proposed policy would have paused in the held-out period", "replay_heldout", held, "landed_blocked", "count"),
    num("h_saved", "Spend not made in the held-out period if paused sessions did nothing more", "replay_heldout", held, "saved_micros", "usd"),
    num("t_paused", "Sessions the proposed policy would have paused in the training period", "replay_training", train, "paused", "count"),
    num("t_landed", "Sessions in the training period whose work landed", "replay_training", train, "landed_total", "count"),
    num("t_blocked", "Landed sessions the proposed policy would have paused in the training period", "replay_training", train, "landed_blocked", "count"),
    num("t_saved", "Spend not made in the training period if paused sessions did nothing more", "replay_training", train, "saved_micros", "usd"),
    { id: "restrict", kind: "fact", text: narrows.narrows ? "The proposed policy only narrows the current one" : "The proposed policy does not only narrow the current one", decimals: 0, divisor: 1, computation: { fn: "restrict_narrows@1", args: { from: hex(currentId), to: hex(proposedId) } } },
  ];
  const sentences: SentenceInput[] = [
    { id: "s1", text: `On the held-out period, ${heldResult.paused.length} sessions would have been paused and ${usd(heldResult.savedMicros)} not spent, an upper bound that assumes a paused session does nothing more.`, cites: ["h_paused", "h_saved"] },
    { id: "s2", text: `${heldResult.landedBlocked.length} of ${heldResult.landedTotal} landed sessions would have been paused on the held-out period.`, cites: ["h_blocked", "h_landed"] },
    { id: "s3", text: `On the period it was drafted from, ${trainResult.paused.length} sessions would have been paused, ${trainResult.landedBlocked.length} of ${trainResult.landedTotal} of them landed.`, cites: ["t_paused", "t_blocked", "t_landed"] },
    { id: "s4", text: narrows.narrows ? "The proposed policy only narrows the current one." : "The proposed policy does not only narrow the current one.", cites: ["restrict"] },
  ];

  // The approval card may show only sentences that pass the Auditor against the same figures.
  const asClaim = (id: string, text: string, value: number | undefined, unit: Claim["unit"]): Claim => ({ id, kind: id === "restrict" ? "fact" : "number", text, ...(value !== undefined ? { value, unit: unit as NonNullable<Claim["unit"]> } : {}), class: "computed", source: "policy_replay@1" });
  const ledger = new ClaimLedger([
    asClaim("h_paused", claims[1]!.text, heldResult.paused.length, "count"),
    asClaim("h_saved", claims[4]!.text, Math.round(heldResult.savedMicros / 1e4) / 100, "usd"),
    asClaim("h_blocked", claims[3]!.text, heldResult.landedBlocked.length, "count"),
    asClaim("h_landed", claims[2]!.text, heldResult.landedTotal, "count"),
    asClaim("t_paused", claims[5]!.text, trainResult.paused.length, "count"),
    asClaim("t_blocked", claims[7]!.text, trainResult.landedBlocked.length, "count"),
    asClaim("t_landed", claims[6]!.text, trainResult.landedTotal, "count"),
    asClaim("restrict", claims[9]!.text, undefined, undefined),
  ]);
  const accepted = auditedSentences(sentences.map((s) => ({ text: s.text, cites: s.cites })), ledger);
  const ruleIdsAdded = input.proposed.rules.filter((r) => !input.current.rules.some((c) => c.id === r.id)).map((r) => r.id);

  const card: ApprovalCard = {
    diff: { added: ruleIdsAdded, from: currentId, to: proposedId },
    replay: { paused: heldResult.paused.length, landed_blocked: heldResult.landedBlocked.length, saved_micros: heldResult.savedMicros },
    restrict: { narrows: narrows.narrows, grid_size: narrows.gridSize },
    dollars_affected_micros: heldResult.savedMicros,
    tasks_affected: heldResult.paused.length,
    claims: accepted,
    // An evasion the proposed policy would deny is not unresolved, so only requests it allows or merely asks about are listed.
    unresolved_evasions: (input.unresolvedEvasions ?? []).flatMap((e) => {
      const verdict = evaluate(input.proposed, e.request).verdict;
      return verdict === "allow" || verdict === "ask" ? [{ source: e.source, dimension: e.dimension, waste_rule: e.request.waste_rule, recoverable_micros: e.request.recoverable_micros, action: e.request.action, verdict }] : [];
    }),
  };
  return {
    log: log.rows,
    claims,
    sentences,
    policies: { docs: [prevDoc, nextDoc], changes: [{ from: currentId, to: proposedId }] },
    card,
    currentId,
    proposedId,
    meta: { kind: "policy_change", tenant: input.tenant, period: input.period, createdAt: input.createdAt, audience: "reviewer", disclosure: "full" },
    ruleIdsAdded,
  };
}
