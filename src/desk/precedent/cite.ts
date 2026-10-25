import type { OwnerMemory } from "../engines/memory.ts";
import { PRECEDENT_TAG } from "../engines/memory.ts";
import { formatUsd } from "../money.ts";
import { policyDiff } from "./diff.ts";
import type { Policy } from "../policy/types.ts";
import { loadPrecedents, type Precedent } from "./store.ts";
import type { Ledger } from "../ledger/db.ts";

/**
 * What a proposal is told about earlier ones (DF-105). The words of the change are put to the memory as a question; the engine ranks its precedents by its hybrid score and returns those
 * above its threshold of 0.35, at most three. Each comes with what happened to the sessions that followed it. When the memory has nothing close, or cannot be opened, the answer is
 * "no historical precedent found" and the proposal is drafted without one: a missing memory never stops a draft.
 */
export interface Citation {
  precedentId: string;
  memoryId: string;
  relevance: number;
  superseded: boolean;
  line: string;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const n = (x: number): string => x.toLocaleString("en-US");

/** One sentence for a precedent: when it was set, what it changed, and what it has done since, at the longest horizon measured. */
export function describePrecedent(p: Precedent, nowMs: number): string {
  const set = `On ${day(p.adoptedAtMs)} you approved: ${p.diff.length === 0 ? "a policy with no rule change" : p.diff.map((d) => d.text).join("; ")}.`;
  const o = p.outcomes[p.outcomes.length - 1];
  if (!o) {
    const age = Math.floor((nowMs - p.adoptedAtMs) / 86_400_000);
    return `${set} It is ${age < 1 ? "less than a day" : `${age} day${age === 1 ? "" : "s"}`} old, too recent to have an outcome: the first is measured at 7 days.`;
  }
  const blocked = o.landedBlocked === 0 ? `blocked none of the ${n(o.landedTotal)} landed runs` : `blocked ${n(o.landedBlocked)} of ${n(o.landedTotal)} landed runs`;
  return `${set} Since then (${o.horizonDays} days, replayed on the ${n(o.sessions)} sessions that followed) it paused ${n(o.paused)} session${o.paused === 1 ? "" : "s"}, would have saved ${formatUsd(o.savedMicros)} and ${blocked}.`;
}

export function citePrecedents(db: Ledger, memory: OwnerMemory | null, change: { before: Policy; after: Policy } | string, nowMs: number): { citations: Citation[]; note: string } {
  if (memory === null) return { citations: [], note: "No memory is available, so no earlier precedent was read." };
  const text = typeof change === "string" ? change : policyDiff(change.before, change.after).map((d) => d.text).join("; ");
  if (text.trim() === "") return { citations: [], note: "The change touches no rule, so there is no precedent to compare it with." };
  const all = loadPrecedents(db);
  const byMemory = new Map(all.map((p) => [p.memoryId, p]));
  const byId = new Map(all.map((p) => [p.precedentId, p]));
  const hits = memory.recallTagged(PRECEDENT_TAG, text, 3, 0.35);
  const citations: Citation[] = [];
  for (const h of hits) {
    const p = byMemory.get(h.id);
    if (!p) continue;
    const next = p.supersededBy === null ? undefined : byId.get(p.supersededBy);
    const later = next === undefined ? "" : ` (replaced by the change of ${day(next.adoptedAtMs)})`;
    citations.push({ precedentId: p.precedentId, memoryId: h.id, relevance: h.relevance, superseded: h.superseded, line: `${describePrecedent(p, nowMs)}${later}` });
  }
  return { citations, note: citations.length === 0 ? "No historical precedent found." : "" };
}
