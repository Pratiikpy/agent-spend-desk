import { parsePolicy } from "./parse.ts";
import type { Policy } from "./types.ts";

export function policyWithRules(current: Policy, addRules: unknown[]): Policy {
  // Existing rules go back through the same document form the owner writes, so one parser checks old and new alike.
  const doc = {
    version: current.version + 1,
    rules: [...current.rules.map((r) => ruleToDoc(r)), ...addRules],
    approvals: current.approvals.map((a) => ({ when: condToDoc(a.when), approvers: a.approvers })),
  };
  return parsePolicy(doc);
}

export function condToDoc(c: Policy["rules"][number]["when"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [dim, set] of Object.entries(c.finite)) out[dim] = { in: set };
  for (const [dim, iv] of Object.entries(c.numeric)) {
    const key = dim.replace(/_micros$/, "_usd");
    const o: Record<string, string> = {};
    if (Number.isFinite(iv.lo)) o[iv.loOpen ? "gt" : "gte"] = usdString(iv.lo);
    if (Number.isFinite(iv.hi)) o[iv.hiOpen ? "lt" : "lte"] = usdString(iv.hi);
    out[key] = o;
  }
  return out;
}

export function usdString(micros: number): string {
  return (micros / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");
}

export function ruleToDoc(r: Policy["rules"][number]): Record<string, unknown> {
  const doc: Record<string, unknown> = { id: r.id, kind: r.kind, when: condToDoc(r.when) };
  if (r.kind === "permit" && r.cap) doc["cap"] = { window: r.cap.window, ...(r.cap.per === undefined || r.cap.per === "person" ? {} : { per: r.cap.per }), max_usd: usdString(r.cap.maxMicros), warn_at: r.cap.warnAt, ask_at: r.cap.askAt };
  if (r.kind === "forbid") doc["action"] = r.action;
  if (r.kind === "route") doc["route"] = { model_map: r.modelMap };
  return doc;
}


/** The document form of a whole policy: what the owner would write, and what parsePolicy reads back. */
export function policyToDoc(p: Policy): Record<string, unknown> {
  return {
    version: p.version,
    rules: p.rules.map((r) => ruleToDoc(r)),
    approvals: p.approvals.map((a) => ({ when: condToDoc(a.when), approvers: a.approvers })),
  };
}
