import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stringify } from "yaml";

import { formatUsd } from "../money.ts";
import { policyToDoc } from "../policy/doc.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import type { Policy } from "../policy/types.ts";
import { DAY, replayPolicy, type ReplaySession } from "../replay/policy-replay.ts";
import { windTunnel } from "../replay/wind-tunnel.ts";

/**
 * The decision regret ledger. When a policy is proposed, the Desk writes down what it expected of each option
 * (the one on offer, the policy already in force, the draft before hardening) as a range from the wind tunnel.
 * After the month that followed, it replays every option on what actually happened and says how far the
 * expectation was off and what a rejected option would have done. It is a record of the Desk's own judgement,
 * kept so that the judgement can be checked: it changes no policy.
 */
export type Decision = "proposed" | "approved" | "denied" | "abstained";
export type OptionKind = "chosen" | "rejected" | "abstained";

export interface OptionInput {
  option: OptionKind;
  label: string;
  policy: Policy;
}

export interface DecisionInput {
  decisionId: string;
  requestId: string | null;
  /** The instant the decision was made; the month that counts starts here. */
  decidedAtMs: number;
  decision: Decision;
  /** The sessions known at that instant: the wind tunnel is built from these and nothing later. */
  history: readonly ReplaySession[];
  options: readonly OptionInput[];
}

/** The days of later data needed before a decision is scored. A shorter record stays pending. */
export const MIN_DAYS_TO_SCORE = 21;
/** The month a decision is judged on. */
export const SCORE_WINDOW_DAYS = 30;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decision (
  decision_id TEXT PRIMARY KEY,
  request_id TEXT,
  decided_at_ms INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('proposed','approved','denied','abstained')),
  history_sessions INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS decision_regret (
  decision_id TEXT NOT NULL REFERENCES decision(decision_id),
  option TEXT NOT NULL CHECK (option IN ('chosen','rejected','abstained')),
  label TEXT NOT NULL,
  policy_yaml TEXT NOT NULL,
  predicted_low_micros INTEGER,
  predicted_high_micros INTEGER,
  predicted_mean_micros INTEGER,
  history_may_not_predict INTEGER,
  realised_micros INTEGER,
  blocked_landed INTEGER,
  regret_micros INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending','scored')),
  scored_at TEXT,
  PRIMARY KEY (decision_id, label)
);
`;

export function openRegret(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Writes a decision and its options with the wind tunnel's expectation of each. Recording the same decision again changes nothing. */
export function recordDecision(db: DatabaseSync, d: DecisionInput): { recorded: boolean } {
  const existing = db.prepare("SELECT 1 FROM decision WHERE decision_id = ?").get(d.decisionId);
  if (existing) return { recorded: false };
  db.prepare("INSERT INTO decision (decision_id, request_id, decided_at_ms, decision, history_sessions) VALUES (?, ?, ?, ?, ?)").run(d.decisionId, d.requestId, d.decidedAtMs, d.decision, d.history.length);
  const ins = db.prepare(
    "INSERT INTO decision_regret (decision_id, option, label, policy_yaml, predicted_low_micros, predicted_high_micros, predicted_mean_micros, history_may_not_predict, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
  );
  for (const o of d.options) {
    const t = windTunnel(o.policy, d.history);
    const ok = t.status === "ok";
    ins.run(d.decisionId, o.option, o.label, stringify(policyToDoc(o.policy)), ok ? Math.round(t.savedMonthSpread.p05) : null, ok ? Math.round(t.savedMonthSpread.p95) : null, ok ? Math.round(t.savedMicros.mid) : null, ok ? (t.historyMayNotPredict ? 1 : 0) : null);
  }
  return { recorded: true };
}

/** The owner's answer arrives after the proposal: mark the decision made on a request. */
export function markDecision(db: DatabaseSync, requestId: string, decision: Decision): boolean {
  return Number(db.prepare("UPDATE decision SET decision = ? WHERE request_id = ?").run(decision, requestId).changes) > 0;
}

export interface OptionLine {
  option: OptionKind;
  label: string;
  predictedLow: number | null;
  predictedHigh: number | null;
  predictedMean: number | null;
  historyMayNotPredict: boolean | null;
  realised: number | null;
  blockedLanded: number | null;
  regret: number | null;
  inside: boolean | null;
  status: "pending" | "scored";
}

export interface DecisionLine {
  decisionId: string;
  decision: Decision;
  decidedAtMs: number;
  historySessions: number;
  /** How many days of later data there are, and the month they are judged on. */
  laterDays: number;
  options: OptionLine[];
}

interface Row {
  decision_id: string;
  option: OptionKind;
  label: string;
  policy_yaml: string;
  predicted_low_micros: number | null;
  predicted_high_micros: number | null;
  predicted_mean_micros: number | null;
  history_may_not_predict: number | null;
  realised_micros: number | null;
  blocked_landed: number | null;
  regret_micros: number | null;
  status: "pending" | "scored";
}

/**
 * Scores every pending decision that has at least MIN_DAYS_TO_SCORE days of later sessions. Each option is replayed on the
 * month that followed. Regret is on the chosen option: the most a rejected option would have saved beyond it without
 * blocking more landed work than it did, never below zero.
 */
export function scoreDecisions(db: DatabaseSync, sessions: readonly ReplaySession[], now: () => Date = () => new Date()): DecisionLine[] {
  const decisions = db.prepare("SELECT decision_id, decision, decided_at_ms, history_sessions FROM decision ORDER BY decided_at_ms, decision_id").all() as unknown as { decision_id: string; decision: Decision; decided_at_ms: number; history_sessions: number }[];
  const lastMs = sessions.reduce((m, s) => Math.max(m, s.startMs), 0);
  const lines: DecisionLine[] = [];
  for (const d of decisions) {
    const laterDays = Math.max(0, (lastMs - d.decided_at_ms) / DAY);
    const rows = db.prepare("SELECT * FROM decision_regret WHERE decision_id = ? ORDER BY CASE option WHEN 'chosen' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, label").all(d.decision_id) as unknown as Row[];
    if (rows.some((r) => r.status === "pending") && laterDays >= MIN_DAYS_TO_SCORE) {
      const month = sessions.filter((s) => s.startMs >= d.decided_at_ms && s.startMs < d.decided_at_ms + SCORE_WINDOW_DAYS * DAY);
      const replays = new Map<string, { saved: number; blocked: number }>();
      for (const r of rows) {
        const result = replayPolicy(parsePolicyYaml(r.policy_yaml), month);
        replays.set(r.label, { saved: Math.round(result.savedMicros), blocked: result.landedBlocked.length });
      }
      const chosen = rows.find((r) => r.option === "chosen");
      const chosenRun = chosen ? replays.get(chosen.label) : undefined;
      const alternatives = rows.filter((r) => r.option !== "chosen").map((r) => replays.get(r.label)!);
      const admissible = chosenRun ? alternatives.filter((a) => a.blocked <= chosenRun.blocked) : [];
      const regret = chosenRun ? Math.max(0, ...admissible.map((a) => a.saved - chosenRun.saved)) : null;
      const upd = db.prepare("UPDATE decision_regret SET realised_micros = ?, blocked_landed = ?, regret_micros = ?, status = 'scored', scored_at = ? WHERE decision_id = ? AND label = ?");
      for (const r of rows) {
        const run = replays.get(r.label)!;
        upd.run(run.saved, run.blocked, r.option === "chosen" ? regret : null, now().toISOString(), d.decision_id, r.label);
      }
    }
    const after = db.prepare("SELECT * FROM decision_regret WHERE decision_id = ? ORDER BY CASE option WHEN 'chosen' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, label").all(d.decision_id) as unknown as Row[];
    lines.push({
      decisionId: d.decision_id,
      decision: d.decision,
      decidedAtMs: d.decided_at_ms,
      historySessions: d.history_sessions,
      laterDays,
      options: after.map((r) => ({
        option: r.option,
        label: r.label,
        predictedLow: r.predicted_low_micros,
        predictedHigh: r.predicted_high_micros,
        predictedMean: r.predicted_mean_micros,
        historyMayNotPredict: r.history_may_not_predict === null ? null : r.history_may_not_predict === 1,
        realised: r.realised_micros,
        blockedLanded: r.blocked_landed,
        regret: r.regret_micros,
        inside: r.status === "scored" && r.predicted_low_micros !== null && r.predicted_high_micros !== null && r.realised_micros !== null ? r.realised_micros >= r.predicted_low_micros && r.realised_micros <= r.predicted_high_micros : null,
        status: r.status,
      })),
    });
  }
  return lines;
}

export interface Coverage {
  scored: number;
  inside: number;
  totalRegretMicros: number;
}

export function coverage(lines: readonly DecisionLine[]): Coverage {
  const opts = lines.flatMap((l) => l.options).filter((o) => o.status === "scored" && o.inside !== null);
  return { scored: opts.length, inside: opts.filter((o) => o.inside).length, totalRegretMicros: lines.flatMap((l) => l.options).reduce((a, o) => a + (o.regret ?? 0), 0) };
}

export function renderRegret(lines: readonly DecisionLine[]): string {
  if (lines.length === 0) return "No decisions are recorded yet. `desk propose` writes one down each time it proposes a policy, with what it expected of each option.";
  const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const out: string[] = ["Decision regret ledger"];
  for (const l of lines) {
    out.push("", `decision ${l.decisionId.slice(0, 12)}  ${l.decision}  made ${day(l.decidedAtMs)} from ${l.historySessions} earlier sessions`);
    const pending = l.options.some((o) => o.status === "pending");
    if (pending) out.push(`  PENDING: ${l.laterDays.toFixed(0)} days of later sessions so far; it is scored once ${MIN_DAYS_TO_SCORE} days are in, on the month that followed.`);
    for (const o of l.options) {
      const expect = o.predictedLow === null ? "no expectation (too little history to simulate)" : `expected ${formatUsd(o.predictedLow)} to ${formatUsd(o.predictedHigh!)} saved in a month${o.historyMayNotPredict ? " (history may not predict)" : ""}`;
      if (o.status === "pending") {
        out.push(`  ${o.option.padEnd(8)} ${o.label}: ${expect}`);
      } else {
        out.push(`  ${o.option.padEnd(8)} ${o.label}: ${expect}; the month saved ${formatUsd(o.realised!)}, blocked ${o.blockedLanded} landed sessions${o.inside === null ? "" : o.inside ? ", inside the expected range" : ", OUTSIDE the expected range"}${o.regret !== null ? `; regret ${formatUsd(o.regret)}` : ""}`);
      }
    }
  }
  const c = coverage(lines);
  out.push("");
  if (c.scored === 0) out.push("Nothing is scored yet, so there is no coverage or regret to report.");
  else out.push(`Scored options: ${c.scored}; the realised month was inside the expected range for ${c.inside} of them. Regret summed over chosen options: ${formatUsd(c.totalRegretMicros)}. With this few decisions, a coverage figure is a count, not an estimate.`);
  out.push("The saving is an upper bound: it assumes a paused session does nothing more. Regret compares options on the same recorded month; it does not say what the owner should have done.");
  return out.join("\n");
}
