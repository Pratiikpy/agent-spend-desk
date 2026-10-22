import { FINITE_DIMS, NUMERIC_DIMS, type Cap, type Condition, type Decision, type Interval, type Policy, type Request, type Verdict } from "./types.ts";

/** `*` matches any run of characters; everything else is literal. Used for model patterns such as claude-*. */
export function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const parts = pattern.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (i === 0) {
      if (!value.startsWith(part)) return false;
      pos = part.length;
    } else if (i === parts.length - 1) {
      return value.length - pos >= part.length && value.endsWith(part);
    } else {
      const at = value.indexOf(part, pos);
      if (at === -1) return false;
      pos = at + part.length;
    }
  }
  return true;
}

export function inInterval(i: Interval, x: number): boolean {
  const aboveLo = i.loOpen ? x > i.lo : x >= i.lo;
  const belowHi = i.hiOpen ? x < i.hi : x <= i.hi;
  return aboveLo && belowHi;
}

export function matches(cond: Condition, req: Request): boolean {
  for (const dim of FINITE_DIMS) {
    const set = cond.finite[dim];
    if (set !== undefined && !set.some((m) => globMatch(m, req[dim]))) return false;
  }
  for (const dim of NUMERIC_DIMS) {
    const interval = cond.numeric[dim];
    if (interval !== undefined && !inInterval(interval, req[dim])) return false;
  }
  return true;
}

/** The smallest spend that asks. Rounded through thousandths so a decimal fraction like 0.8 is exact. */
export function askThresholdMicros(cap: Cap): number {
  return Math.ceil(Math.round(cap.maxMicros * cap.askAt * 1000) / 1000);
}

function capVerdict(cap: Cap, req: Request): Verdict {
  const spend = cap.window === "day" ? req.day_spend_after_micros : req.month_spend_after_micros;
  if (spend > cap.maxMicros) return "deny";
  if (spend >= askThresholdMicros(cap)) return "ask";
  return "allow";
}

/**
 * The one interpreter of a spend policy. Forbid overrides permit, the default is deny, every cap of
 * every matching permit must have room, and an approval rule can only turn allow into ask.
 * A route rule never changes the verdict (see routeOf).
 */
export function evaluate(policy: Policy, req: Request): Decision {
  const matched: string[] = [];
  const reasons: string[] = [];
  let forbidAction: string | undefined;
  for (const rule of policy.rules) {
    if (rule.kind === "forbid" && matches(rule.when, req)) {
      matched.push(rule.id);
      forbidAction ??= rule.action;
      reasons.push(`forbid ${rule.id}`);
    }
  }
  if (forbidAction !== undefined) return { verdict: "deny", failed: false, reasons, matched, action: forbidAction };

  let permitted = false;
  let verdict: Verdict = "allow";
  for (const rule of policy.rules) {
    if (rule.kind !== "permit" || !matches(rule.when, req)) continue;
    permitted = true;
    matched.push(rule.id);
    if (rule.cap) {
      const v = capVerdict(rule.cap, req);
      if (v !== "allow") reasons.push(`cap ${rule.id}: ${v}`);
      if (v === "deny" || (v === "ask" && verdict === "allow")) verdict = v;
    }
  }
  if (!permitted) return { verdict: "deny", failed: false, reasons: ["no permit matches (default deny)"], matched };
  if (verdict === "allow") {
    for (const a of policy.approvals) {
      if (matches(a.when, req)) {
        verdict = "ask";
        reasons.push(`approval required from ${a.approvers.join(", ")}`);
        break;
      }
    }
  }
  return { verdict, failed: false, reasons, matched };
}

/** The model a request is routed to: the first matching route rule's map, else the requested model. */
export function routeOf(policy: Policy, req: Request): string {
  for (const rule of policy.rules) {
    if (rule.kind === "route" && matches(rule.when, req)) {
      for (const [from, to] of Object.entries(rule.modelMap)) if (globMatch(from, req.model)) return to;
    }
  }
  return req.model;
}
