import { statSync } from "node:fs";

import { CodexParser } from "../ingest/codex.ts";
import { readJsonlLines } from "../ingest/jsonl.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { maskStored } from "../security/secrets.ts";
import type { Ledger } from "./db.ts";
import { recomputeCosts, recordSnapshot, updateSessionSpans } from "./ingest.ts";

export interface CodexIngestReport {
  files: number;
  unchangedFiles: number;
  /** Files with no session in them: not Codex logs, or empty. They are noted so they are not read again until they grow. */
  skippedFiles: number;
  callsNew: number;
  /** Calls whose cumulative total grew by more than the last request, so they stand for several requests. */
  mergedRequests: number;
  /** Calls written into a forked session's file at the moment of the fork: the parent's history, not counted. */
  replayedCalls: number;
  replayedTokens: number;
  limitSamples: number;
  malformedLines: number;
  /** Calls whose cumulative counts disagreed with themselves (a part went down, or more was cached than arrived): clamped, flagged, and counted here. */
  inconsistentBuckets: number;
  /** Calls with more tokens in one reading than any request holds: kept and flagged. */
  implausibleSize: number;
  /** Times a session's counter started again: the tokens between the last reading and the restart are not known. */
  counterResets: number;
  unpricedCalls: number;
  unpricedModels: Record<string, string>;
}

/**
 * Read Codex session logs into the ledger. A log is re-read whole when it has grown, because a call is defined by the
 * growth of the session's cumulative total and the replay of a fork is only known from the start of the file; call
 * ids are `codex:<session>:<n>`, so reading a file again stores nothing twice. An unfinished last line is left for
 * the next run. Prices come from the snapshot when it has the model, and otherwise the call is unpriced with the
 * reason: Codex is mostly used on a plan whose limit, not a price, is the currency.
 */
export async function ingestCodex(db: Ledger, files: readonly string[], snapshot: PriceSnapshot, now: () => Date = () => new Date()): Promise<CodexIngestReport> {
  const started = now().toISOString();
  recordSnapshot(db, snapshot);
  const report: CodexIngestReport = { files: 0, unchangedFiles: 0, skippedFiles: 0, callsNew: 0, mergedRequests: 0, replayedCalls: 0, replayedTokens: 0, limitSamples: 0, malformedLines: 0, inconsistentBuckets: 0, implausibleSize: 0, counterResets: 0, unpricedCalls: 0, unpricedModels: {} };

  const getSource = db.prepare("SELECT id, size_bytes, offset_bytes FROM ingest_source WHERE path = ?");
  const putSource = db.prepare(
    `INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('codex', ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET size_bytes = excluded.size_bytes, offset_bytes = excluded.offset_bytes, last_ingested_at = excluded.last_ingested_at`,
  );
  const putSession = db.prepare(
    `INSERT INTO session (session_id, tool, project_path, git_branch, tool_version) VALUES (?, 'codex', ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       project_path = COALESCE(session.project_path, excluded.project_path),
       git_branch = COALESCE(session.git_branch, excluded.git_branch),
       tool_version = COALESCE(session.tool_version, excluded.tool_version)`,
  );
  const putCall = db.prepare(
    `INSERT OR IGNORE INTO model_call (call_id, session_id, request_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, service_tier, speed,
       stop_reason, is_api_error, tool_names, block_lines, usage_conflicts, source_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'assumed-5m', 0, NULL, NULL, NULL, 0, '[]', 1, ?, ?)`,
  );
  const putLimit = db.prepare(
    `INSERT OR IGNORE INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inserted = new Set<string>();
  const sessions = new Set<string>();

  for (const file of files) {
    const stat = statSync(file);
    const known = getSource.get(file) as { id: number; size_bytes: number; offset_bytes: number } | undefined;
    report.files += 1;
    if (known && known.size_bytes === stat.size && known.offset_bytes === stat.size) {
      report.unchangedFiles += 1;
      continue;
    }
    const parser = new CodexParser();
    let committed = 0;
    for await (const line of readJsonlLines(file, 0)) {
      if (!line.terminated) {
        // A last line with no newline: take it only if it is already whole.
        try {
          JSON.parse(line.text);
        } catch {
          break;
        }
      }
      parser.feed(line.text);
      committed = line.endOffset;
    }
    const r = parser.result();
    report.malformedLines += r.malformedLines;
    db.exec("BEGIN");
    try {
      putSource.run(file, stat.size, committed, started);
      const sourceId = (getSource.get(file) as { id: number }).id;
      if (r.session === null) {
        report.skippedFiles += 1;
      } else {
        const s = r.session;
        putSession.run(s.sessionId, maskStored(s.cwd), maskStored(s.gitBranch), maskStored(s.cliVersion));
        sessions.add(s.sessionId);
        report.replayedCalls += r.replayedCalls;
        report.replayedTokens += r.replayedTokens;
        report.counterResets += r.counterResets;
        for (const c of r.calls) {
          const res = putCall.run(c.callId, s.sessionId, c.ts, c.model, s.subagent ? 1 : 0, c.inputTokens, c.outputTokens, c.reasoningTokens, c.cachedInputTokens, c.flags.length, sourceId);
          if (Number(res.changes) > 0) {
            report.callsNew += 1;
            if (c.mergedRequests) report.mergedRequests += 1;
            if (c.flags.includes("inconsistent_buckets")) report.inconsistentBuckets += 1;
            if (c.flags.includes("implausible_size")) report.implausibleSize += 1;
            inserted.add(c.callId);
          }
        }
        for (const l of r.limits) {
          const res = putLimit.run(s.sessionId, l.ts, l.kind, l.windowMinutes, l.usedPercent, l.resetsAt, l.planType, l.limitId);
          report.limitSamples += Number(res.changes);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  recomputeCosts(db, snapshot, inserted, report);
  updateSessionSpans(db, sessions);
  db.prepare(
    `INSERT INTO ingest_run (kind, started_at, finished_at, files, lines_read, calls_new, calls_merged, malformed_lines, truncated_tails, usage_conflicts)
     VALUES ('codex', ?, ?, ?, 0, ?, ?, ?, 0, ?)`,
  ).run(started, now().toISOString(), report.files, report.callsNew, report.mergedRequests, report.malformedLines, report.inconsistentBuckets + report.implausibleSize);
  return report;
}
