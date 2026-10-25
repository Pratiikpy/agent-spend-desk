import { readFileSync } from "node:fs";

import { probeEvasions, type Evasion, type HarmClass } from "../agents/attacker.ts";
import { evaluate } from "../policy/evaluate.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { FINITE_DIMS, type Policy, type Request } from "../policy/types.ts";
import { fuzzRestrictCheck } from "../prove/fuzz.ts";

/**
 * `desk attack POLICY` (DF-126): what steps around a policy, and a statement of how hard the restrict check was tried. The corpus is the Policy Attacker's probes (each value outside a
 * forbid rule that a permit still accepts, and each threshold at its exact edge), and each one it reports was decided by the policy's own evaluator, not judged. The fuzz line says
 * how many generated pairs the restrict check was held to, the seed, and what it found. A judge's own request can be tried with --try.
 */
export interface AttackOptions {
  file: string;
  /** "waste_rule:min_usd", repeated; by default every waste rule a forbid rule names, at the rule's own threshold. */
  harm?: string[];
  pairs?: number;
  seed?: number;
  /** A request to evaluate, as key=value pairs. */
  attempt?: string;
}

export function harmFrom(policy: Policy, given: readonly string[] | undefined): { harm: HarmClass[]; error?: string } {
  if (given && given.length > 0) {
    const harm: HarmClass[] = [];
    for (const g of given) {
      const m = /^([A-Za-z0-9_*.-]+):(\d+(?:\.\d+)?)$/.exec(g);
      if (!m) return { harm: [], error: `--harm is waste_rule:minimum_usd, such as C-LOOP-1:2.00 (got ${JSON.stringify(g)})` };
      harm.push({ wasteRule: m[1] as string, minRecoverableMicros: Math.round(Number(m[2]) * 1_000_000) });
    }
    return { harm };
  }
  const harm: HarmClass[] = [];
  for (const r of policy.rules) {
    if (r.kind !== "forbid") continue;
    const rules = r.when.finite.waste_rule ?? [];
    const lo = r.when.numeric.recoverable_micros?.lo;
    for (const w of rules) if (!w.includes("*")) harm.push({ wasteRule: w, minRecoverableMicros: lo !== undefined && Number.isFinite(lo) ? Math.max(0, r.when.numeric.recoverable_micros?.loOpen ? lo + 1 : lo) : 0 });
  }
  return { harm };
}

const NUM: Record<string, keyof Request> = { recoverable_usd: "recoverable_micros", day_spend_after_usd: "day_spend_after_micros", month_spend_after_usd: "month_spend_after_micros" };

export function requestFrom(text: string): Request | string {
  const r: Request = { project: "x", person: "x", agent: "x", model: "x", task_type: "x", waste_rule: "none", action: "call", recoverable_micros: 0, day_spend_after_micros: 0, month_spend_after_micros: 0 } as Request;
  for (const part of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z_]+)=(.+)$/.exec(part);
    if (!m) return `${JSON.stringify(part)} is not key=value`;
    const key = m[1] as string;
    if (key in NUM) {
      if (!/^\d+(\.\d+)?$/.test(m[2] as string)) return `${key} is a dollar amount such as 2.50`;
      (r as unknown as Record<string, number>)[NUM[key] as string] = Math.round(Number(m[2]) * 1_000_000);
    } else if ((FINITE_DIMS as readonly string[]).includes(key) || key === "action") (r as unknown as Record<string, string>)[key] = m[2] as string;
    else return `${key} is not a field of a request (${[...FINITE_DIMS, "action", ...Object.keys(NUM)].join(", ")})`;
  }
  return r;
}

export function attack(o: AttackOptions): { text: string; code: number } {
  let policy: Policy;
  try {
    policy = parsePolicyYaml(readFileSync(o.file, "utf8"));
  } catch (e) {
    return { text: `Could not read the policy: ${(e as Error).message}`, code: 2 };
  }
  const lines: string[] = [];
  if (o.attempt !== undefined) {
    const req = requestFrom(o.attempt);
    if (typeof req === "string") return { text: `Could not read the request: ${req}`, code: 2 };
    const v = evaluate(policy, req);
    lines.push(`Your request: ${v.verdict}${v.verdict !== "allow" && v.reasons.length > 0 ? ` (${v.reasons.join(", ")})` : ""}.`);
  }
  const { harm, error } = harmFrom(policy, o.harm);
  if (error) return { text: error, code: 2 };
  let evasions: Evasion[] = [];
  if (harm.length === 0) lines.push("The corpus has nothing to aim at: this policy has no forbid rule that names a waste rule, and --harm was not given. Say what it must stop: --harm C-LOOP-1:2.00");
  else {
    evasions = probeEvasions(policy, harm);
    lines.push(`Corpus: ${harm.map((h) => `${h.wasteRule} from $${(h.minRecoverableMicros / 1e6).toFixed(2)}`).join("; ")}.`);
    if (evasions.length === 0) lines.push("No request in the corpus steps around the policy: every probe inside that harm class was stopped.");
    for (const e of evasions) {
      const v = evaluate(policy, e.request);
      lines.push(`EVASION: ${e.why}.`, `  the request: ${Object.entries(e.request).filter(([k]) => k !== "action" || e.request.action !== "call").map(([k, val]) => `${k}=${val}`).join(", ")}`, `  the policy's own evaluator says: ${v.verdict}`);
    }
  }
  const pairs = o.pairs ?? 2000;
  const seed = o.seed ?? 20261025;
  const f = fuzzRestrictCheck({ pairs, seed });
  lines.push(f.escapes.length === 0 && f.misses.length === 0 ? `Restrict check: no widening escape found in ${f.pairs.toLocaleString("en-US")} generated policy pairs (seed ${seed}; ${f.narrowing.toLocaleString("en-US")} called narrowing). This is the number tried, not a proof.` : `Restrict check: ${f.escapes.length} widening escape${f.escapes.length === 1 ? "" : "s"} and ${f.misses.length} missed widening${f.misses.length === 1 ? "" : "s"} in ${f.pairs.toLocaleString("en-US")} pairs (seed ${seed}). A widening escape fails the build.`);
  return { text: lines.join("\n"), code: evasions.length > 0 || f.escapes.length > 0 ? 1 : 0 };
}

export const ATTACK_USAGE = "desk attack POLICY [--harm WASTE_RULE:MIN_USD ...] [--pairs N] [--seed N] [--try 'waste_rule=C-LOOP-1,model=m,recoverable_usd=3']";
