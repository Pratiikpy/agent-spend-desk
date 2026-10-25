import type { DatabaseSync } from "node:sqlite";

import type { OwnerMemory } from "../engines/memory.ts";
import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { DAY, replayPolicy } from "../replay/policy-replay.ts";
import { policyDiff, ruleIdsOf, type RuleChange } from "./diff.ts";

/**
 * Precedent memory (DF-105). Every policy change the owner approved is kept as a precedent: what it changed, what it was expected to do, and what it did to the sessions that followed,
 * measured 7, 14 and 30 days after it was adopted. A later proposal that touches the same rules is shown the closest precedents with those outcomes: "you set this cap on 3 September;
 * since then it paused 14 sessions and blocked none of the landed runs". A change to a rule that an earlier precedent also changed replaces it in the memory (it is marked superseded,
 * never deleted), so the older word is still there to be explained and no longer ranks as current.
 *
 * The outcomes are replays: the adopted policy is run over the sessions that followed it, as the gate would have seen them. They are not the gate's own record of what it stopped, which
 * differs when the owner approved asks or the gate was not running; the lines say so.
 */
export const HORIZONS = [7, 14, 30] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface Outcome {
  horizonDays: Horizon;
  measuredAt: string;
  sessions: number;
  paused: number;
  askedCalls: number;
  deniedCalls: number;
  savedMicros: number;
  landedTotal: number;
  landedBlocked: number;
}

export interface Precedent {
  precedentId: string;
  memoryId: string;
  adoptedAtMs: number;
  ruleIds: string[];
  summary: string;
  diff: RuleChange[];
  forecast: { lowMicros: number | null; highMicros: number | null; meanMicros: number | null; historyMayNotPredict: boolean | null; historySessions: number };
  policyYaml: string;
  supersededBy: string | null;
  outcomes: Outcome[];
}

const IN_FORCE = "the policy already in force";
const PROPOSED = "the proposed policy";

interface DecisionRow {
  decision_id: string;
  decided_at_ms: number;
  history_sessions: number;
}
interface OptionRow {
  label: string;
  option: string;
  policy_yaml: string;
  predicted_low_micros: number | null;
  predicted_high_micros: number | null;
  predicted_mean_micros: number | null;
  history_may_not_predict: number | null;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function summaryOf(diff: readonly RuleChange[], adoptedMs: number, f: Precedent["forecast"]): string {
  const what = diff.length === 0 ? "a policy with no rule change" : diff.map((d) => d.text).join("; ");
  const expected =
    f.lowMicros !== null && f.highMicros !== null && f.meanMicros !== null
      ? ` It was expected to save between ${formatUsd(f.lowMicros)} and ${formatUsd(f.highMicros)} over a month (about ${formatUsd(f.meanMicros)}), on ${f.historySessions} recorded sessions${f.historyMayNotPredict ? ", and the history may not predict the month" : ""}.`
      : "";
  return `On ${day(adoptedMs)} the owner approved a policy change: ${what}.${expected}`;
}

export interface SyncResult {
  added: string[];
  superseded: { older: string; newer: string }[];
  skipped: { decisionId: string; why: string }[];
}

/**
 * Make a precedent of every approved decision in the regret ledger that is not one yet. The decision's chosen policy is compared with "the policy already in force" that was
 * recorded beside it; a decision recorded without that option cannot be diffed and is skipped, with the reason.
 */
export function syncPrecedents(db: Ledger, regret: DatabaseSync, memory: OwnerMemory): SyncResult {
  const out: SyncResult = { added: [], superseded: [], skipped: [] };
  const decisions = regret.prepare("SELECT decision_id, decided_at_ms, history_sessions FROM decision WHERE decision = 'approved' ORDER BY decided_at_ms, decision_id").all() as unknown as DecisionRow[];
  const have = new Set((db.prepare("SELECT precedent_id FROM policy_precedent").all() as unknown as { precedent_id: string }[]).map((r) => r.precedent_id));
  for (const d of decisions) {
    if (have.has(d.decision_id)) continue;
    const rows = regret.prepare("SELECT label, option, policy_yaml, predicted_low_micros, predicted_high_micros, predicted_mean_micros, history_may_not_predict FROM decision_regret WHERE decision_id = ?").all(d.decision_id) as unknown as OptionRow[];
    const chosen = rows.find((r) => r.option === "chosen" && r.label === PROPOSED) ?? rows.find((r) => r.option === "chosen");
    const before = rows.find((r) => r.label === IN_FORCE);
    if (!chosen || !before) {
      out.skipped.push({ decisionId: d.decision_id, why: !chosen ? "no chosen option was recorded" : `the policy in force was not recorded beside it, so there is nothing to compare` });
      continue;
    }
    let diff: RuleChange[];
    try {
      diff = policyDiff(parsePolicyYaml(before.policy_yaml), parsePolicyYaml(chosen.policy_yaml));
    } catch (e) {
      out.skipped.push({ decisionId: d.decision_id, why: `a recorded policy did not parse: ${(e as Error).message.slice(0, 80)}` });
      continue;
    }
    const ruleIds = ruleIdsOf(diff);
    const forecast: Precedent["forecast"] = { lowMicros: chosen.predicted_low_micros, highMicros: chosen.predicted_high_micros, meanMicros: chosen.predicted_mean_micros, historyMayNotPredict: chosen.history_may_not_predict === null ? null : chosen.history_may_not_predict === 1, historySessions: d.history_sessions };
    const summary = summaryOf(diff, d.decided_at_ms, forecast);
    // An earlier precedent that changed any of the same rules, and is still current, is replaced by this one.
    const earlier = (db.prepare("SELECT precedent_id, memory_id, rule_ids FROM policy_precedent WHERE superseded_by IS NULL ORDER BY adopted_at_ms DESC").all() as unknown as { precedent_id: string; memory_id: string; rule_ids: string }[]).find((p) =>
      (JSON.parse(p.rule_ids) as string[]).some((r) => ruleIds.includes(r)),
    );
    // The memory holds the change in the words a new proposal will use, short enough that the engine's ranking finds it; the forecast and the outcomes stay with the precedent row.
    const record = memory.addPrecedent({ content: `Policy change approved ${day(d.decided_at_ms)}: ${diff.length === 0 ? "no rule changed" : diff.map((x) => x.text).join("; ")}`, ruleIds, decisionId: d.decision_id, ...(earlier ? { supersedes: earlier.memory_id } : {}), at: d.decided_at_ms });
    db.prepare("INSERT INTO policy_precedent (precedent_id, memory_id, adopted_at_ms, rule_ids, summary, diff, forecast, policy_yaml, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(
      d.decision_id, record.id, d.decided_at_ms, JSON.stringify(ruleIds), summary, JSON.stringify(diff), JSON.stringify(forecast), chosen.policy_yaml,
    );
    out.added.push(d.decision_id);
    if (earlier) {
      db.prepare("UPDATE policy_precedent SET superseded_by = ? WHERE precedent_id = ?").run(d.decision_id, earlier.precedent_id);
      out.superseded.push({ older: earlier.precedent_id, newer: d.decision_id });
    }
  }
  return out;
}

export interface TrackResult {
  measured: { precedentId: string; horizonDays: Horizon }[];
  waiting: { precedentId: string; daysLeft: number }[];
}

/**
 * Measure each precedent at 7, 14 and 30 days after its adoption, for every horizon that has fully passed in the ledger and has not been measured. The ledger's own last day is the
 * present when it is later than the clock, as for the other judgements of age.
 */
export function trackOutcomes(db: Ledger, snapshot: PriceSnapshot, nowMs: number): TrackResult {
  const newest = (db.prepare("SELECT MAX(ts) AS t FROM model_call").get() as { t: string | null }).t;
  const asOf = newest === null ? nowMs : Math.max(nowMs, Date.parse(newest));
  const out: TrackResult = { measured: [], waiting: [] };
  const rows = db.prepare("SELECT precedent_id, adopted_at_ms, policy_yaml FROM policy_precedent ORDER BY adopted_at_ms").all() as unknown as { precedent_id: string; adopted_at_ms: number; policy_yaml: string }[];
  for (const p of rows) {
    const done = new Set((db.prepare("SELECT horizon_days FROM precedent_outcome WHERE precedent_id = ?").all(p.precedent_id) as unknown as { horizon_days: number }[]).map((r) => r.horizon_days));
    const policy = parsePolicyYaml(p.policy_yaml);
    for (const h of HORIZONS) {
      if (done.has(h)) continue;
      const until = p.adopted_at_ms + h * DAY;
      if (asOf < until) {
        if (!out.waiting.some((w) => w.precedentId === p.precedent_id)) out.waiting.push({ precedentId: p.precedent_id, daysLeft: Math.ceil((until - asOf) / DAY) });
        continue;
      }
      const sessions = replaySessionsFromLedger(db, snapshot, new Date(p.adopted_at_ms).toISOString(), new Date(until).toISOString());
      if (sessions.length === 0) continue;
      const r = replayPolicy(policy, sessions);
      db.prepare("INSERT INTO precedent_outcome (precedent_id, horizon_days, measured_at, sessions, paused, asked_calls, denied_calls, saved_micros, landed_total, landed_blocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        p.precedent_id, h, new Date(asOf).toISOString(), sessions.length, r.paused.length, r.askedCalls, r.deniedCalls, Math.round(r.savedMicros), r.landedTotal, r.landedBlocked.length,
      );
      out.measured.push({ precedentId: p.precedent_id, horizonDays: h });
    }
  }
  return out;
}

export function loadPrecedents(db: Ledger): Precedent[] {
  const rows = db.prepare("SELECT * FROM policy_precedent ORDER BY adopted_at_ms, precedent_id").all() as unknown as {
    precedent_id: string; memory_id: string; adopted_at_ms: number; rule_ids: string; summary: string; diff: string; forecast: string; policy_yaml: string; superseded_by: string | null;
  }[];
  return rows.map((r) => ({
    precedentId: r.precedent_id, memoryId: r.memory_id, adoptedAtMs: r.adopted_at_ms, ruleIds: JSON.parse(r.rule_ids) as string[], summary: r.summary, diff: JSON.parse(r.diff) as RuleChange[],
    forecast: JSON.parse(r.forecast) as Precedent["forecast"], policyYaml: r.policy_yaml, supersededBy: r.superseded_by,
    outcomes: (db.prepare("SELECT horizon_days, measured_at, sessions, paused, asked_calls, denied_calls, saved_micros, landed_total, landed_blocked FROM precedent_outcome WHERE precedent_id = ? ORDER BY horizon_days").all(r.precedent_id) as unknown as {
      horizon_days: Horizon; measured_at: string; sessions: number; paused: number; asked_calls: number; denied_calls: number; saved_micros: number; landed_total: number; landed_blocked: number;
    }[]).map((o) => ({ horizonDays: o.horizon_days, measuredAt: o.measured_at, sessions: o.sessions, paused: o.paused, askedCalls: o.asked_calls, deniedCalls: o.denied_calls, savedMicros: o.saved_micros, landedTotal: o.landed_total, landedBlocked: o.landed_blocked })),
  }));
}
