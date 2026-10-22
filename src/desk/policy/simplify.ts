import { policyToDoc } from "./doc.ts";
import { parsePolicy } from "./parse.ts";
import type { Policy } from "./types.ts";

/**
 * Remove rules that cannot change any verdict because an earlier rule of the same kind has the same condition
 * and action. A forbid that repeats an earlier forbid, or a route that repeats an earlier route, is redundant:
 * the first one already decides. Order is kept, the first copy stays, and the version number is unchanged.
 * Returns the ids that were removed so the caller can say so.
 */
export function dropRedundantRules(policy: Policy): { policy: Policy; removed: string[] } {
  const doc = policyToDoc(policy) as { version: number; rules: Record<string, unknown>[]; approvals: unknown[] };
  const seen = new Set<string>();
  const removed: string[] = [];
  const kept: Record<string, unknown>[] = [];
  for (const rule of doc.rules) {
    if (rule["kind"] === "permit") {
      kept.push(rule);
      continue;
    }
    const { id, ...rest } = rule;
    const key = JSON.stringify(rest);
    if (seen.has(key)) {
      removed.push(String(id));
      continue;
    }
    seen.add(key);
    kept.push(rule);
  }
  if (removed.length === 0) return { policy, removed };
  return { policy: parsePolicy({ ...doc, rules: kept }), removed };
}
