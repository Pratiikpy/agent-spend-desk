import { policyToDoc, usdString } from "../policy/doc.ts";
import { parsePolicy } from "../policy/parse.ts";
import { OTHER, restrictCheck, type RestrictResult } from "../policy/restrict.ts";
import type { Policy } from "../policy/types.ts";
import { replayPolicy, type ReplayResult, type ReplaySession } from "../replay/policy-replay.ts";

/**
 * Which of the policy's rules stop work that later landed (DF-034). A rule is checked the one way history can check it: the policy is replayed over the recorded sessions,
 * and each session it stopped or asked about is looked at to see whether its work landed afterwards. A session that landed after a rule stopped it is a flag that was
 * probably wrong; a rule whose flags landed more than a fifth of the time, over at least twenty flags, "misfires on your data".
 *
 * Nothing is changed. For a rule with a number in it (a dollar threshold on recoverable waste, or a cap) the table also tries higher values, replays each, and offers the
 * lowest that brings the landed share under the limit, with what that costs in dollars not stopped. A higher threshold is a loosening, so the offer is a policy file
 * and the answer of the restrict-only check, which names a request the new policy allows that the old one did not; applying it is the owner's own edit.
 *
 * Sessions whose landing is not known (no repository scanned for them) are left out of the share, because "not landed" cannot be read from "not known".
 */
export const CALIBRATION = { minFlags: 20, maxLandedShare: 0.2, multipliers: [1.25, 1.5, 2, 3, 5, 10] } as const;

export type RuleStatus = "ok" | "misfires" | "not_enough_data" | "never_fired";

export interface Proposal {
  /** The factor the threshold was multiplied by, and what it reads after. */
  multiplier: number;
  threshold: string;
  flags: number;
  labelled: number;
  landed: number;
  landedShare: number | null;
  dollarsMicros: number;
  /** Dollars the rule no longer stops, against the current threshold. */
  dollarsGivenUpMicros: number;
  policy: Policy;
  restrict: RestrictResult;
  /** The replay of the whole proposed policy over the same sessions. */
  replay: ReplayResult;
}

export interface RuleCalibration {
  ruleId: string;
  /** What kind of thing the rule is and what its number is, in words; null for a rule with no number to move. */
  what: string;
  threshold: string | null;
  /** Sessions the rule stopped or asked about (an ask counts, because the owner may have said no), and how many of them have a known landing. */
  flags: number;
  labelled: number;
  landed: number;
  landedShare: number | null;
  /** Spend from the stop point to the end of each flagged session: an upper bound on what the rule saved. */
  dollarsMicros: number;
  status: RuleStatus;
  /** Present for a rule that misfires and has a number: the lowest higher threshold that brings it under the limit, or why there is none. */
  proposal?: Proposal | { none: string };
}

interface Edit {
  /** The rule's number in words, and the function that reads it from a document rule. */
  describe(doc: Record<string, unknown>): { what: string; threshold: string } | null;
  /** The rule document with its number scaled; null when it cannot be (a lower bound of zero has nothing to scale). */
  scale(doc: Record<string, unknown>, factor: number): Record<string, unknown> | null;
}

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
const asUsd = (v: unknown): number | null => (typeof v === "string" && Number.isFinite(Number(v)) ? Math.round(Number(v) * 1_000_000) : null);

/** A forbid rule that fires above some recoverable dollars, and a permit rule with a cap, are the two rules with a number to raise. */
const EDITS: Edit[] = [
  {
    describe(doc) {
      const when = doc["when"] as Record<string, Record<string, string>> | undefined;
      const r = when?.["recoverable_usd"];
      const bound = r?.["gt"] ?? r?.["gte"];
      return doc["kind"] === "forbid" && bound !== undefined ? { what: "stops when recoverable waste is over", threshold: usd(asUsd(bound) ?? 0) } : null;
    },
    scale(doc, factor) {
      const when = { ...(doc["when"] as Record<string, Record<string, string>>) };
      const r = { ...(when["recoverable_usd"] as Record<string, string>) };
      const key = r["gt"] !== undefined ? "gt" : "gte";
      const old = asUsd(r[key]);
      if (old === null) return null;
      // A threshold of zero has nothing to multiply: it is moved to the factor in tenths of a dollar, so 1.25 reads as 12 cents and 10 as a dollar.
      const next = old === 0 ? Math.round(factor * 100_000) : Math.round(old * factor);
      r[key] = usdString(next);
      when["recoverable_usd"] = r;
      return { ...doc, when };
    },
  },
  {
    describe(doc) {
      const cap = doc["cap"] as { window?: string; per?: string; max_usd?: string } | undefined;
      const max = asUsd(cap?.max_usd);
      return doc["kind"] === "permit" && cap && max !== null ? { what: `cap on the ${cap.window}${cap.per ? ` per ${cap.per}` : ""}`, threshold: usd(max) } : null;
    },
    scale(doc, factor) {
      const cap = doc["cap"] as Record<string, unknown>;
      const max = asUsd(cap["max_usd"]);
      if (max === null) return null;
      return { ...doc, cap: { ...cap, max_usd: usdString(Math.round(max * factor)) } };
    },
  },
];

function editOf(doc: Record<string, unknown>): { edit: Edit; what: string; threshold: string } | null {
  for (const edit of EDITS) {
    const d = edit.describe(doc);
    if (d) return { edit, ...d };
  }
  return null;
}

/** The rule ids a stop or an ask is put down to: `forbid stop-loops`, `cap per-session: deny (session)`, and the default deny. */
export function rulesOf(reason: string): string[] {
  const ids: string[] = [];
  for (const part of reason.split("; ")) {
    const f = /^forbid (.+)$/.exec(part);
    const c = /^cap (.+?): (?:deny|ask)/.exec(part);
    if (f) ids.push(f[1] as string);
    else if (c) ids.push(c[1] as string);
    else if (part.startsWith("no permit matches")) ids.push("(no rule permits it)");
  }
  return ids;
}

function flagged(policy: Policy, sessions: readonly ReplaySession[], known: ReadonlySet<string> | null): { byRule: Map<string, { sessions: string[]; labelled: number; landed: number; micros: number }>; replay: ReplayResult } {
  // An ask is counted as a stop: the owner may have said no, and "a rule that asks about work that lands" is as much a misfire as one that stops it.
  const replay = replayPolicy(policy, sessions, { askAs: "denied" });
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const byRule = new Map<string, { sessions: string[]; labelled: number; landed: number; micros: number }>();
  for (const p of replay.paused) {
    const s = byId.get(p.sessionId);
    if (!s) continue;
    const after = s.calls.filter((c) => s.startMs + c.offsetMs >= p.at).reduce((t, c) => t + c.costMicros, 0);
    for (const id of new Set(rulesOf(p.verdictReason))) {
      const e = byRule.get(id) ?? { sessions: [], labelled: 0, landed: 0, micros: 0 };
      e.sessions.push(p.sessionId);
      e.micros += after;
      if (known === null || known.has(p.sessionId)) {
        e.labelled += 1;
        if (p.landed) e.landed += 1;
      }
      byRule.set(id, e);
    }
  }
  return { byRule, replay };
}

export function calibrateRules(policy: Policy, sessions: readonly ReplaySession[], known: ReadonlySet<string> | null = null): RuleCalibration[] {
  const base = flagged(policy, sessions, known);
  const doc = policyToDoc(policy) as { rules: Record<string, unknown>[] };
  const out: RuleCalibration[] = [];
  for (const rule of doc.rules) {
    const id = String(rule["id"]);
    const hit = base.byRule.get(id);
    const e = editOf(rule);
    const flags = hit?.sessions.length ?? 0;
    const labelled = hit?.labelled ?? 0;
    const landed = hit?.landed ?? 0;
    const share = labelled === 0 ? null : landed / labelled;
    const status: RuleStatus = flags === 0 ? "never_fired" : labelled < CALIBRATION.minFlags ? "not_enough_data" : share !== null && share > CALIBRATION.maxLandedShare ? "misfires" : "ok";
    const row: RuleCalibration = {
      ruleId: id,
      what: e?.what ?? (rule["kind"] === "route" ? "routes to another model" : "has no number to move"),
      threshold: e?.threshold ?? null,
      flags,
      labelled,
      landed,
      landedShare: share,
      dollarsMicros: hit?.micros ?? 0,
      status,
    };
    if (status === "misfires" && e) row.proposal = propose(policy, rule, e, sessions, known, row);
    else if (status === "misfires") row.proposal = { none: "this rule has no number to raise, so the only change that would help is to edit what it matches" };
    out.push(row);
  }
  // Stops the policy makes with no rule to name: a default deny is its own row, so the table accounts for every stop.
  const orphan = base.byRule.get("(no rule permits it)");
  if (orphan) {
    const share = orphan.labelled === 0 ? null : orphan.landed / orphan.labelled;
    out.push({ ruleId: "(no rule permits it)", what: "the default deny: no permit matched", threshold: null, flags: orphan.sessions.length, labelled: orphan.labelled, landed: orphan.landed, landedShare: share, dollarsMicros: orphan.micros, status: orphan.labelled < CALIBRATION.minFlags ? "not_enough_data" : share !== null && share > CALIBRATION.maxLandedShare ? "misfires" : "ok" });
  }
  return out;
}

function propose(policy: Policy, rule: Record<string, unknown>, e: { edit: Edit; threshold: string }, sessions: readonly ReplaySession[], known: ReadonlySet<string> | null, current: RuleCalibration): Proposal | { none: string } {
  let tried = 0;
  for (const factor of CALIBRATION.multipliers) {
    const scaled = e.edit.scale(rule, factor);
    if (!scaled) return { none: "its threshold is not a number this check can raise" };
    tried += 1;
    const doc = policyToDoc(policy) as { version: number; rules: Record<string, unknown>[] };
    const next = parsePolicy({ ...doc, version: doc.version + 1, rules: doc.rules.map((r) => (r["id"] === rule["id"] ? scaled : r)) });
    const after = flagged(next, sessions, known);
    const hit = after.byRule.get(String(rule["id"]));
    const flags = hit?.sessions.length ?? 0;
    const labelled = hit?.labelled ?? 0;
    const landed = hit?.landed ?? 0;
    const share = labelled === 0 ? null : landed / labelled;
    // Under the limit means the flags that remain landed no more than a fifth of the time, or the rule has stopped firing at all.
    if (flags === 0 || (share !== null && share <= CALIBRATION.maxLandedShare)) {
      const newThreshold = editOf(scaled)?.threshold ?? e.threshold;
      return { multiplier: factor, threshold: newThreshold, flags, labelled, landed, landedShare: share, dollarsMicros: hit?.micros ?? 0, dollarsGivenUpMicros: Math.max(0, current.dollarsMicros - (hit?.micros ?? 0)), policy: next, restrict: restrictCheck(policy, next), replay: after.replay };
    }
  }
  return { none: `raising it up to ${CALIBRATION.multipliers[CALIBRATION.multipliers.length - 1]} times (${tried} values tried) did not bring the flags that remain under ${CALIBRATION.maxLandedShare * 100}% landed` };
}

/** The first request the loosened policy treats more permissively, in a line. */
function describeWidening(w: NonNullable<RestrictResult["widening"]>): string {
  const r = w.request;
  // The grid names a value it has no rule for by a placeholder; say it as the plain thing it stands for.
  const model = r.model.replaceAll("~", "*");
  const waste = /^C-[A-Z]/.test(r.waste_rule) ? `waste rule ${r.waste_rule}` : "no waste rule";
  return `a call on ${model.startsWith(OTHER) ? "any other model" : model} with ${waste} and ${usd(r.recoverable_micros)} recoverable is now ${w.now}, was ${w.was}`;
}

const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);

/** The table, one line per rule, and for a rule that misfires what raising its number would do. */
export function renderCalibration(rows: readonly RuleCalibration[], period: string): string {
  const out: string[] = [`Rule calibration over ${period}: each rule's stops and asks, and how many of those sessions landed work afterwards.`];
  for (const r of rows) {
    const label = r.threshold ? `${r.what} ${r.threshold}` : r.what;
    if (r.status === "never_fired") {
      out.push(`${r.ruleId}  (${label}): never stopped or asked about a session in this period.`);
      continue;
    }
    const base = `${r.ruleId}  (${label}): ${r.flags} session${r.flags === 1 ? "" : "s"} stopped or asked about, ${r.labelled} with a known landing, ${r.landed} landed (${pct(r.landedShare)}), ${usd(r.dollarsMicros)} after the stop points.`;
    if (r.status === "not_enough_data") out.push(`${base} Not enough data: fewer than ${CALIBRATION.minFlags} flags with a known landing.${r.labelled < r.flags ? " `desk landing` ties more sessions to the commits they produced, and each one tied is one more this check can read." : ""}`);
    else if (r.status === "ok") out.push(`${base} Holds up: no more than ${CALIBRATION.maxLandedShare * 100}% of what it flagged landed.`);
    else {
      out.push(`${base} This rule misfires on your data: more than ${CALIBRATION.maxLandedShare * 100}% of what it flagged landed.`);
      const p = r.proposal;
      if (p && "none" in p) out.push(`    No higher threshold offered: ${p.none}.`);
      else if (p) {
        out.push(`    Offer: raise it to ${p.threshold} (${p.multiplier} times). Replayed over the same sessions it flags ${p.flags}, ${p.landed} of ${p.labelled} labelled landed (${pct(p.landedShare)}), and stops ${usd(p.dollarsGivenUpMicros)} less.`);
        out.push(`    It is a loosening, so it is a file and a question, not an approval: ${p.restrict.narrows ? "the restrict-only check says it narrows" : p.restrict.widening ? `the restrict-only check names a request it allows that the current policy did not: ${describeWidening(p.restrict.widening)}` : "the restrict-only check says it widens"}. Applying it is your own edit.`);
      }
    }
  }
  out.push("A flag is a session the rule stopped or asked about; a session whose landing is not known is left out of the share, because unknown is not the same as not landed. Nothing here changes the policy.");
  return out.join("\n");
}
