import { createHash } from "node:crypto";

import { findSessionLog } from "../capture/prompts.ts";
import type { CaptureDb } from "../capture/store.ts";
import type { Ledger } from "../ledger/db.ts";
import { readTrajectory, type Trajectory } from "./read.ts";
import { REASON_LABEL, replayability, type ReplayClass, type Replayability } from "./replayability.ts";

/**
 * How much of the last month's work can be replayed, and why the rest cannot (DF-040). Every session the ledger saw in the period is accounted for exactly once: its log was not
 * found, it had nothing to replay, or it is eligible and is `full`, `tools_only` or `insufficient`. The numbers add up by construction and a test holds them to it: eligible is
 * replayable (full and tools-only) plus insufficient.
 */
export interface AccountOptions {
  sinceIso: string;
  untilIso: string;
  /** Keep each eligible session's redacted calls and results in the capture store, so that a replay can serve them. Without it only counts are kept. */
  keep?: boolean;
  /** Where to keep them. Without a store nothing is written. */
  store?: CaptureDb;
  nowIso?: string;
}

export interface Accounting {
  sessions: number;
  logNotFound: number;
  /** Sessions whose log was read but that made no tool call or held no prompt. */
  nothingToReplay: number;
  eligible: number;
  full: number;
  toolsOnly: number;
  insufficient: number;
  /** Results the tool had kept in a file of its own, read back whole. */
  recovered: number;
  /** Why sessions are not `full`, and why some had nothing to replay: the reason, and how many sessions it applies to. */
  whyNot: Record<string, number>;
  whyNothing: Record<string, number>;
  /** Calls across eligible sessions, by what they can do. */
  calls: Record<string, number>;
  sessionList: { sessionId: string; class: ReplayClass | null; reasons: string[]; toolCalls: number }[];
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export function persistTrajectory(db: CaptureDb, t: Trajectory, r: Replayability, keep: boolean, nowIso: string, source: "log" | "gateway" | "wrapper" = "log"): string {
  const id = sha(`${t.sessionId}|${source}`).slice(0, 16);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM trajectory WHERE trajectory_id = ?").run(id);
    db.prepare(
      `INSERT INTO trajectory (trajectory_id, session_id, source, log_sha, started_at, ended_at, prompts, assistant_messages, compactions, sidechain_lines, malformed_lines, tool_calls, read_only_calls, mutating_calls, results_present, results_missing, results_cut_short, eligible, replay_class, reasons_json, kept_text, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, t.sessionId, source, t.logSha, t.startedAt, t.endedAt, t.prompts, t.assistantMessages, t.compactions, t.sidechainLines, t.malformedLines, r.counts.toolCalls, r.counts.readOnly, r.counts.mutating, r.counts.resultsPresent, r.counts.resultsMissing, r.counts.resultsCutShort, r.eligible ? 1 : 0, r.class, JSON.stringify(r.reasons), keep ? 1 : 0, nowIso);
    if (keep) {
      const ins = db.prepare(
        `INSERT INTO trajectory_step (trajectory_id, seq, ts, tool, tool_class, effect, key_sha, input_text, result_present, result_text, result_chars, result_truncated, is_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of t.steps) ins.run(id, s.seq, s.ts || null, s.tool, s.kind.class, s.kind.effect, s.keySha, s.input, s.result.present ? 1 : 0, s.result.text, s.result.chars, s.result.truncated ? 1 : 0, s.result.isError ? 1 : 0);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return id;
}

export function accountTrajectories(ledger: Ledger, o: AccountOptions): Accounting {
  const rows = ledger
    .prepare("SELECT session_id, started_at FROM session WHERE tool = 'claude_code' AND started_at IS NOT NULL AND started_at >= ? AND started_at <= ? ORDER BY started_at")
    .all(o.sinceIso, o.untilIso) as { session_id: string; started_at: string }[];
  const a: Accounting = { sessions: rows.length, logNotFound: 0, nothingToReplay: 0, eligible: 0, full: 0, toolsOnly: 0, insufficient: 0, recovered: 0, whyNot: {}, whyNothing: {}, calls: { workspace_read: 0, network_read: 0, file_edit: 0, shell: 0, agent: 0, unknown: 0 }, sessionList: [] };
  for (const row of rows) {
    const log = findSessionLog(ledger, row.session_id);
    if (!log) {
      a.logNotFound += 1;
      a.sessionList.push({ sessionId: row.session_id, class: null, reasons: ["its log was not found where the ledger read it"], toolCalls: 0 });
      continue;
    }
    const t = readTrajectory(log, { keepText: o.keep === true });
    const r = replayability(t);
    if (o.store) persistTrajectory(o.store, t, r, o.keep === true && r.eligible, o.nowIso ?? new Date().toISOString());
    a.sessionList.push({ sessionId: row.session_id, class: r.class, reasons: r.reasons, toolCalls: r.counts.toolCalls });
    if (!r.eligible) {
      a.nothingToReplay += 1;
      for (const c of r.codes) a.whyNothing[REASON_LABEL[c]] = (a.whyNothing[REASON_LABEL[c]] ?? 0) + 1;
      continue;
    }
    a.eligible += 1;
    if (r.class === "full") a.full += 1;
    else if (r.class === "tools_only") a.toolsOnly += 1;
    else a.insufficient += 1;
    for (const c of r.codes) a.whyNot[REASON_LABEL[c]] = (a.whyNot[REASON_LABEL[c]] ?? 0) + 1;
    a.recovered += r.counts.resultsRecovered;
    for (const [k, v] of Object.entries(r.counts.byEffect)) a.calls[k] = (a.calls[k] ?? 0) + v;
  }
  return a;
}

export function renderAccounting(a: Accounting, days: number): string {
  const lines = [`The last ${days} days: ${a.sessions} session${a.sessions === 1 ? "" : "s"} in the ledger.`];
  if (a.logNotFound > 0) lines.push(`  ${a.logNotFound} could not be looked at: the log is not where the ledger read it.`);
  lines.push(`  ${a.nothingToReplay} had nothing to replay${Object.keys(a.whyNothing).length > 0 ? ` (${Object.entries(a.whyNothing).map(([w, n]) => `${n} ${w}`).join("; ")})` : ""}.`);
  lines.push(`  ${a.eligible} could have been replayed, if recorded well enough:`);
  lines.push(`    ${a.full} full: nothing is missing`);
  lines.push(`    ${a.toolsOnly} tools only: re-runnable from the prompt, with gaps in the transcript`);
  lines.push(`    ${a.insufficient} insufficient: a call that cannot be run again has no whole result, so these are not replayed`);
  lines.push(`  replayable (${a.full} + ${a.toolsOnly} = ${a.full + a.toolsOnly}) and insufficient (${a.insufficient}) make the ${a.eligible} eligible.`);
  const why = Object.entries(a.whyNot).sort((x, y) => y[1] - x[1]);
  if (why.length > 0) {
    lines.push("why they are not all full:");
    for (const [w, n] of why) lines.push(`  ${String(n).padStart(5)}  ${w}`);
  }
  const c = a.calls;
  if (a.recovered > 0) lines.push(`${a.recovered} large results were read back whole from the files the tool kept them in.`);
  lines.push(`calls in the eligible sessions: ${c["workspace_read"]} read the workspace, ${c["file_edit"]} edit a file, ${c["shell"]} shell commands that change something or cannot be shown not to, ${c["network_read"]} read the network, ${c["agent"]} start an agent, ${c["unknown"]} are tools not known.`);
  return lines.join("\n");
}
