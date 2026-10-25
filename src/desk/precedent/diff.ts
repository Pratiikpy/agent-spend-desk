import { formatUsd } from "../money.ts";
import { ruleToDoc } from "../policy/doc.ts";
import type { Policy, Rule } from "../policy/types.ts";

/**
 * What a policy change changed, rule by rule, in words a person would use: "day cap $10.00 to $15.00", "added stop-loops". The precedent record is made from this, and a new proposal is
 * matched against it, so the words are the same ones the policy screens use.
 */
export interface RuleChange {
  ruleId: string;
  kind: "added" | "removed" | "changed";
  /** One short phrase for the change, with the figures. */
  text: string;
}

type Doc = Record<string, unknown>;

const num = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? formatUsd(Math.round(n * 1_000_000)) : String(v);
};

function describeRule(r: Rule): string {
  if (r.kind === "forbid") return `forbid rule ${r.id} (${r.action})`;
  if (r.kind === "route") return `route rule ${r.id}`;
  const cap = r.cap;
  return cap ? `permit rule ${r.id} with a ${cap.window}${cap.per && cap.per !== "person" ? ` per ${cap.per}` : ""} cap of ${formatUsd(cap.maxMicros)}` : `permit rule ${r.id}`;
}

function conditionsOf(d: Doc): string {
  const when = (d["when"] ?? {}) as Doc;
  return Object.entries(when)
    .map(([k, v]) => `${k} ${typeof v === "object" && v !== null ? Object.entries(v as Doc).map(([op, x]) => `${op} ${Array.isArray(x) ? (x as unknown[]).join("/") : String(x)}`).join(" ") : String(v)}`)
    .join(", ");
}

/** The changes from one policy to the next, in rule order of the newer one with removals last. */
export function policyDiff(before: Policy, after: Policy): RuleChange[] {
  const a = new Map(before.rules.map((r) => [r.id, r]));
  const b = new Map(after.rules.map((r) => [r.id, r]));
  const out: RuleChange[] = [];
  for (const r of after.rules) {
    const old = a.get(r.id);
    if (old === undefined) {
      out.push({ ruleId: r.id, kind: "added", text: `added ${describeRule(r)}` });
      continue;
    }
    const x = ruleToDoc(old);
    const y = ruleToDoc(r);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const parts: string[] = [];
    const cx = (x["cap"] ?? null) as Doc | null;
    const cy = (y["cap"] ?? null) as Doc | null;
    if (cx && cy) {
      if (cx["max_usd"] !== cy["max_usd"] || cx["window"] !== cy["window"]) parts.push(`${String(cy["window"])} cap ${num(cx["max_usd"])} to ${num(cy["max_usd"])}`);
      if (cx["ask_at"] !== cy["ask_at"]) parts.push(`asks at ${Math.round(Number(cy["ask_at"]) * 100)}% of the cap (was ${Math.round(Number(cx["ask_at"]) * 100)}%)`);
    } else if (cx || cy) parts.push(cy ? "gained a cap" : "lost its cap");
    if (conditionsOf(x) !== conditionsOf(y)) parts.push(`condition ${conditionsOf(x) || "any"} to ${conditionsOf(y) || "any"}`);
    if (x["action"] !== y["action"]) parts.push(`action ${String(x["action"])} to ${String(y["action"])}`);
    if (JSON.stringify(x["route"]) !== JSON.stringify(y["route"])) parts.push("route changed");
    out.push({ ruleId: r.id, kind: "changed", text: `${r.id}: ${parts.join("; ") || "changed"}` });
  }
  for (const r of before.rules) if (!b.has(r.id)) out.push({ ruleId: r.id, kind: "removed", text: `removed ${describeRule(r)}` });
  return out;
}

/** The rules a policy change touched. */
export const ruleIdsOf = (d: readonly RuleChange[]): string[] => [...new Set(d.map((x) => x.ruleId))];
