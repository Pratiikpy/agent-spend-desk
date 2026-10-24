import { statSync } from "node:fs";

import { readOpenCode, type ReasoningCheck } from "../ingest/opencode.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { maskStored } from "../security/secrets.ts";
import type { Ledger } from "./db.ts";
import { recomputeCosts, recordSnapshot, updateSessionSpans } from "./ingest.ts";

export interface OpenCodeIngestReport {
  /** Messages in the database, of every kind. */
  messages: number;
  callsNew: number;
  /** Messages that are not finished model calls, by reason. */
  skipped: Record<string, number>;
  /** New calls, by whether the message's own step totals show reasoning tokens as separate from output tokens. */
  reasoningInOutput: Record<ReasoningCheck, number>;
  unpricedCalls: number;
  unpricedModels: Record<string, string>;
}

/**
 * Read an OpenCode database into the ledger. Call ids are `opencode:<message id>` and a finished message does not
 * change, so reading the database again stores nothing twice and picks up what finished since. Prices come from the
 * snapshot only for first-party models; a model reached through another provider is unpriced, with the reason.
 */
export async function ingestOpenCode(db: Ledger, dbPath: string, snapshot: PriceSnapshot, now: () => Date = () => new Date()): Promise<OpenCodeIngestReport> {
  const started = now().toISOString();
  recordSnapshot(db, snapshot);
  const known = new Set((db.prepare("SELECT call_id FROM model_call WHERE call_id LIKE 'opencode:%'").all() as { call_id: string }[]).map((r) => r.call_id));
  const read = readOpenCode(dbPath, known);
  const report: OpenCodeIngestReport = {
    messages: read.messages,
    callsNew: 0,
    skipped: read.skipped,
    reasoningInOutput: { confirmed: 0, contradicted: 0, unchecked: 0 },
    unpricedCalls: 0,
    unpricedModels: {},
  };

  const putSource = db.prepare(
    `INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('opencode', ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET size_bytes = excluded.size_bytes, offset_bytes = excluded.offset_bytes, last_ingested_at = excluded.last_ingested_at`,
  );
  const putSession = db.prepare(
    `INSERT INTO session (session_id, tool, project_path, git_branch, tool_version) VALUES (?, 'opencode', ?, NULL, ?)
     ON CONFLICT (session_id) DO UPDATE SET project_path = COALESCE(session.project_path, excluded.project_path), tool_version = COALESCE(session.tool_version, excluded.tool_version)`,
  );
  const putCall = db.prepare(
    `INSERT OR IGNORE INTO model_call (call_id, session_id, request_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, service_tier, speed,
       stop_reason, is_api_error, tool_names, block_lines, usage_conflicts, source_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'assumed-5m', 0, NULL, NULL, ?, ?, ?, 1, 0, ?)`,
  );
  const inserted = new Set<string>();
  const sessions = new Set<string>();
  db.exec("BEGIN");
  try {
    putSource.run(dbPath, statSync(dbPath).size, statSync(dbPath).size, started);
    const sourceId = (db.prepare("SELECT id FROM ingest_source WHERE path = ?").get(dbPath) as { id: number }).id;
    for (const s of read.sessions) {
      putSession.run(s.sessionId, s.directory === null ? null : maskStored(s.directory), s.version === null ? null : maskStored(s.version));
      sessions.add(s.sessionId);
    }
    for (const c of read.calls) {
      const res = putCall.run(c.callId, c.sessionId, c.ts, c.model, c.isSidechain ? 1 : 0, c.inputTokens, c.outputTokens, c.reasoningTokens, c.cacheReadTokens, c.cacheWriteTokens, c.stopReason, c.isApiError ? 1 : 0, JSON.stringify(c.toolNames), sourceId);
      if (Number(res.changes) > 0) {
        report.callsNew += 1;
        report.reasoningInOutput[c.reasoningInOutput] += 1;
        inserted.add(c.callId);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  recomputeCosts(db, snapshot, inserted, report);
  updateSessionSpans(db, sessions);
  db.prepare(
    `INSERT INTO ingest_run (kind, started_at, finished_at, files, lines_read, calls_new, calls_merged, malformed_lines, truncated_tails, usage_conflicts)
     VALUES ('opencode', ?, ?, 1, ?, ?, 0, ?, 0, 0)`,
  ).run(started, now().toISOString(), read.messages, report.callsNew, read.skipped["malformed"] ?? 0);
  return report;
}
