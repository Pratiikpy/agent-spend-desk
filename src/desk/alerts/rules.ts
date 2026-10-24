import { formatUsd } from "../money.ts";
import type { PeriodReconciliation } from "../billing/reconcile.ts";
import type { Gauge } from "../gauge/gauge.ts";
import type { Verdict } from "../canary/verdict.ts";
import type { RuleResult } from "./engine.ts";

/**
 * The rules that feed the alert engine. Each is a plain function of the state it is given, so each can be tested with a
 * constructed state, and each names the evidence the alert points at.
 */

export interface CapStanding {
  person: string;
  window: "day" | "month";
  limitMicros: number | null;
  spentMicros: number;
  reservedMicros: number;
  /** The fractions at which the policy starts to warn and to ask, when it says. */
  warnAt?: number;
  askAt?: number;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** A cap at its warn fraction or ask fraction is a WARNING; at 85% or above, or reached, an ALERT. A person with no cap has no rule. */
export function capRules(standings: readonly CapStanding[]): RuleResult[] {
  const out: RuleResult[] = [];
  for (const s of standings) {
    if (s.limitMicros === null || s.limitMicros <= 0) continue;
    const used = s.spentMicros + s.reservedMicros;
    const frac = used / s.limitMicros;
    const warn = s.warnAt ?? 0.5;
    const ask = s.askAt ?? 0.8;
    let state: RuleResult["state"] = "OK";
    let what = "inside its limits";
    if (frac >= 1) {
      state = "ALERT";
      what = "reached";
    } else if (frac >= 0.85) {
      state = "ALERT";
      what = "at 85% or more";
    } else if (frac >= ask) {
      state = "WARNING";
      what = `past the ${pct(ask)} where the gate starts asking`;
    } else if (frac >= warn) {
      state = "WARNING";
      what = `past the ${pct(warn)} warning`;
    }
    out.push({
      key: `cap:${s.person}:${s.window}`,
      suite: "cap",
      state,
      title: `${s.person}'s ${s.window} cap is ${pct(frac)} used`,
      body: `${formatUsd(used)} of ${formatUsd(s.limitMicros)} (${formatUsd(s.spentMicros)} spent, ${formatUsd(s.reservedMicros)} held for calls in flight): ${what}.`,
      evidence: "desk gate status",
    });
  }
  return out;
}

/** A person the gate paused after a budget overshoot is an ALERT until the owner resumes them. */
export function pauseRules(people: readonly { person: string; paused: boolean }[]): RuleResult[] {
  return people.map((p) => ({
    key: `gate:paused:${p.person}`,
    suite: "gate" as const,
    state: p.paused ? ("ALERT" as const) : ("OK" as const),
    title: p.paused ? `${p.person} is paused after a budget overshoot` : `${p.person} is not paused`,
    body: p.paused ? "The gate refuses their calls until the owner resumes them." : "Calls are being decided as usual.",
    evidence: "desk gate status",
  }));
}

/** Idle or background work that cost real money in the last hour: $2 is a WARNING, $10 an ALERT. */
export function idleRule(g: Gauge, warnMicros = 2_000_000, alertMicros = 10_000_000): RuleResult {
  const base = { key: "idle:agents", suite: "idle" as const, evidence: "desk gauge --hours 1" };
  if (g.calls === 0) return { ...base, state: "NO_DATA", title: "No calls in the last hour", body: "Nothing to judge." };
  const idle = g.split.find((s) => s.cause === "idle")?.micros ?? 0;
  const state = idle >= alertMicros ? "ALERT" : idle >= warnMicros ? "WARNING" : "OK";
  return { ...base, state, title: `Idle or background work cost ${formatUsd(idle)} in the last hour`, body: `Calls no one asked for, such as agents polling or looping with no one at the keyboard: ${formatUsd(idle)} of ${formatUsd(g.spendMicros ?? 0)} spent in the last ${g.hours} hours.` };
}

export interface CanaryInput {
  verdict: Verdict | null;
  /** The calendar date (YYYY-MM-DD) of the newest run, or null when there is none. */
  lastRunDate: string | null;
  now: Date;
}

/** A canary file whose newest date is still to come holds a recorded scenario with assigned dates, not daily runs: it must not raise an alert. */
export function datesAreAssigned(lastRunDate: string | null, now: Date): boolean {
  return lastRunDate !== null && Date.parse(`${lastRunDate}T00:00:00Z`) > now.getTime() + 86_400_000;
}

const DAY = 86_400_000;

/** Two rules: whether the canary says the agent got worse, and whether it has stopped running. */
export function canaryRules(c: CanaryInput): RuleResult[] {
  const out: RuleResult[] = [];
  if (datesAreAssigned(c.lastRunDate, c.now)) {
    const body = `The canary file's newest date (${c.lastRunDate}) is still to come, so it holds a recorded scenario with assigned dates, not daily runs. Run desk canary run for real ones.`;
    return [
      { key: "canary:verdict", suite: "canary", state: "NO_DATA", title: "The canary file is a recorded scenario", body, evidence: "desk canary" },
      { key: "canary:running", suite: "canary", state: "NO_DATA", title: "The canary file is a recorded scenario", body, evidence: "desk canary run" },
    ];
  }
  if (c.verdict === null) out.push({ key: "canary:verdict", suite: "canary", state: "NO_DATA", title: "The canary has no verdict yet", body: "It needs a baseline and two windows of runs.", evidence: "desk canary" });
  else {
    const v = c.verdict.verdict;
    out.push({
      key: "canary:verdict",
      suite: "canary",
      state: v === "regressed" ? "ALERT" : v === "harness_or_platform" ? "WARNING" : "OK",
      title: v === "regressed" ? "The canary says the agent got worse" : v === "harness_or_platform" ? "The canary cannot tell: the harness or the platform changed" : `The canary says: ${v}`,
      body: v === "regressed" ? "The pass rate fell against the baseline by more than noise, with the control arm flat." : v === "harness_or_platform" ? "A change to the harness or the platform makes the comparison unsafe, so a new baseline is needed." : "No call to make.",
      evidence: "desk canary",
    });
  }
  if (c.lastRunDate === null) out.push({ key: "canary:running", suite: "canary", state: "NO_DATA", title: "The canary has never run", body: "There is nothing to be late.", evidence: "desk canary run" });
  else {
    const days = Math.floor((c.now.getTime() - Date.parse(`${c.lastRunDate}T00:00:00Z`)) / DAY);
    out.push({
      key: "canary:running",
      suite: "canary",
      state: days >= 3 ? "ALERT" : "OK",
      title: days >= 3 ? `The canary has not run for ${days} days` : "The canary is running",
      body: days >= 3 ? `Its last run was on ${c.lastRunDate}. A regression in that time would go unseen.` : `Its last run was on ${c.lastRunDate}.`,
      evidence: "desk canary run",
    });
  }
  return out;
}

/** A month whose invoice and estimate are further apart than the tolerance is a WARNING. Only months with an invoice are judged. */
export function reconciliationRules(rows: readonly PeriodReconciliation[]): RuleResult[] {
  return rows
    .filter((r) => r.billedMicros !== null)
    .map((r) => ({
      key: `reconciliation:${r.vendor}:${r.period}`,
      suite: "reconciliation" as const,
      state: r.status === "unreconciled" ? ("WARNING" as const) : ("OK" as const),
      title: r.status === "unreconciled" ? `${r.vendor} ${r.period} does not reconcile` : `${r.vendor} ${r.period} ${r.status}`,
      body: r.reason,
      evidence: "desk invoices reconcile",
    }));
}
