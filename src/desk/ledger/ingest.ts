import { explainSqliteError, rollbackQuietly } from "./db.ts";
import { assertChain, sealIngest } from "./chain.ts";
import { flagUntrustedText } from "../security/flag.ts";
import { statSync } from "node:fs";

import { priceCall } from "../cost/price-call.ts";
import { parseClaudeCodeLine, workflowRunOfPath, type ParsedCall } from "../ingest/claude-code.ts";
import { readJsonlLines } from "../ingest/jsonl.ts";
import { maskStored } from "../security/secrets.ts";
import { type PriceSnapshot } from "../pricing/pricebook.ts";
import type { Ledger } from "./db.ts";

export interface IngestReport {
  files: number;
  linesRead: number;
  callsNew: number;
  callsMerged: number;
  malformedLines: number;
  malformedReasons: Record<string, number>;
  truncatedTails: number;
  usageConflicts: number;
  /** Lines whose time is more than a minute earlier than a line before it in the same file: a clock that was set back, or a log stitched from two. */
  skewedLines: number;
  /** Lines stamped later than five minutes after the ingest: a clock that was set forward. */
  futureLines: number;
  /** A later line of a call reported a smaller output count than an earlier one (read order, not data loss). */
  outputRegressions: number;
  resetFiles: number;
  toolCalls: number;
  toolResults: number;
  humanPrompts: number;
  /** Compactions the logs record (an agent summarising its conversation to make room). */
  compactions: number;
  /** Delegated agents whose starter the logs name (the agent that started one is the agent whose log holds the result naming it). */
  delegations: number;
  /** Workflow runs the logs launch (a script that starts a batch of agents). */
  workflows: number;
  unpricedCalls: number;
  unpricedModels: Record<string, string>;
}

interface ExistingCall {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  tool_names: string;
  block_lines: number;
  usage_conflicts: number;
}

export function recordSnapshot(db: Ledger, snapshot: PriceSnapshot): void {
  db.prepare(
    `INSERT OR IGNORE INTO price_snapshot (snapshot_id, source, source_url, fetched_at, license, upstream_sha256, content_hash, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(snapshot.snapshotId, snapshot.source, snapshot.sourceUrl, snapshot.fetchedAt, snapshot.license, snapshot.upstreamSha256, snapshot.contentHash, snapshot.note);
}

/**
 * Ingest Claude Code session logs into the ledger. Incremental: each file remembers the byte
 * offset it was read to, so a re-run reads only what was appended. Re-running over the same
 * bytes changes nothing (calls are keyed by message id, so a resumed session that copies earlier
 * messages into a new file is not counted twice). A final line without a newline that is not
 * yet valid JSON is left for the next run and is not counted as bad data.
 */
const SKEW_MS = 60_000;
const FUTURE_MS = 5 * 60_000;

export async function ingestClaudeCode(
  db: Ledger,
  files: readonly string[],
  snapshot: PriceSnapshot,
  now: () => Date = () => new Date(),
): Promise<IngestReport> {
  assertChain(db);
  const started = now().toISOString();
  recordSnapshot(db, snapshot);
  const report: IngestReport = {
    files: 0,
    linesRead: 0,
    callsNew: 0,
    callsMerged: 0,
    malformedLines: 0,
    malformedReasons: {},
    truncatedTails: 0,
    usageConflicts: 0,
    skewedLines: 0,
    futureLines: 0,
    outputRegressions: 0,
    resetFiles: 0,
    toolCalls: 0,
    toolResults: 0,
    humanPrompts: 0,
    compactions: 0,
    delegations: 0,
    workflows: 0,
    unpricedCalls: 0,
    unpricedModels: {},
  };

  const getSource = db.prepare("SELECT id, size_bytes, offset_bytes FROM ingest_source WHERE path = ?");
  const putSource = db.prepare(
    `INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('claude_code', ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET size_bytes = excluded.size_bytes, offset_bytes = excluded.offset_bytes, last_ingested_at = excluded.last_ingested_at`,
  );
  const getCall = db.prepare("SELECT * FROM model_call WHERE call_id = ?");
  const insertSession = db.prepare(
    `INSERT INTO session (session_id, tool, project_path, git_branch, tool_version) VALUES (?, 'claude_code', ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       project_path = COALESCE(session.project_path, excluded.project_path),
       git_branch = COALESCE(session.git_branch, excluded.git_branch),
       tool_version = COALESCE(session.tool_version, excluded.tool_version)`,
  );
  const insertCall = db.prepare(
    `INSERT INTO model_call (call_id, session_id, request_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, service_tier, speed,
       stop_reason, is_api_error, tool_names, block_lines, usage_conflicts, source_id, inference_geo, tool_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
  );
  const mergeCall = db.prepare(
    `UPDATE model_call SET input_tokens = ?, output_tokens = ?, reasoning_tokens = ?, cache_read_tokens = ?, cache_write_5m_tokens = ?,
       cache_write_1h_tokens = ?, tool_names = ?, block_lines = ?, usage_conflicts = ?, inference_geo = COALESCE(inference_geo, ?), tool_version = COALESCE(tool_version, ?) WHERE call_id = ?`,
  );

  const insertToolCall = db.prepare(
    "INSERT OR IGNORE INTO tool_call (tool_use_id, call_id, session_id, name, input_hash, ts) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const upsertToolResult = db.prepare(
    "INSERT OR REPLACE INTO tool_result (tool_use_id, session_id, ts, is_error, result_chars, result_hash, truncated) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEdit = db.prepare("INSERT OR IGNORE INTO session_edit (tool_use_id, session_id, path, ts) VALUES (?, ?, ?, ?)");
  const insertCompaction = db.prepare(
    "INSERT OR IGNORE INTO session_compaction (session_id, ts, trigger, pre_tokens, post_tokens, duration_ms, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEdge = db.prepare("INSERT OR IGNORE INTO delegation_edge (session_id, child_agent_id, parent_source_id, ts) VALUES (?, ?, ?, ?)");
  const nameSource = db.prepare("UPDATE ingest_source SET agent_id = ? WHERE id = ? AND agent_id IS NULL");
  const insertRun = db.prepare("INSERT OR IGNORE INTO workflow_run (session_id, run_id, parent_source_id, name, ts) VALUES (?, ?, ?, ?, ?)");
  const placeSource = db.prepare("UPDATE ingest_source SET workflow_run = ? WHERE id = ? AND workflow_run IS NULL");
  const insertPrompt = db.prepare("INSERT OR IGNORE INTO human_prompt (prompt_id, session_id, ts) VALUES (?, ?, ?)");
  const getReported = db.prepare("SELECT total_micros FROM reported_cost WHERE session_id = ? AND process_start_ms = ?");
  const putReported = db.prepare(
    `INSERT OR REPLACE INTO reported_cost (session_id, process_start_ms, total_micros, api_duration_ms, lines_added, lines_removed, unknown_model_cost, observed_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const clearReportedModels = db.prepare("DELETE FROM reported_model_usage WHERE session_id = ? AND process_start_ms = ?");
  const putReportedModel = db.prepare(
    `INSERT INTO reported_model_usage (session_id, process_start_ms, model, input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_write_tokens, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const touched = new Set<string>();
  const touchedSessions = new Set<string>();

  for (const file of files) {
    const stat = statSync(file);
    const known = getSource.get(file) as { id: number; size_bytes: number; offset_bytes: number } | undefined;
    let offset = known?.offset_bytes ?? 0;
    // A file that has not grown since it was last read has nothing to add: do not open a transaction or look anything up for it.
    if (known && stat.size === offset) {
      report.files += 1;
      continue;
    }
    if (known && stat.size < offset) {
      offset = 0; // the file shrank or was replaced: read it again from the start; call ids keep this idempotent
      report.resetFiles += 1;
    }
    report.files += 1;
    let committedOffset = offset;
    // The latest message time seen in this file so far, so a cost record can say how far its counter reached. A file read
    // in several runs starts from what the earlier runs stored.
    let lastTs: string | null = (db.prepare("SELECT MAX(m.ts) AS t FROM model_call m JOIN ingest_source s ON s.id = m.source_id WHERE s.path = ?").get(file) as { t: string | null }).t;
    let fileSkew = 0;
    let fileFuture = 0;
    const seenAt = (ts: string): void => {
      const t = Date.parse(ts);
      if (!Number.isNaN(t)) {
        // The order of lines in the file is the order they were written; a time that falls behind what came before it is flagged, and a time in the future is too.
        if (lastTs !== null && t < Date.parse(lastTs) - SKEW_MS) fileSkew += 1;
        if (t > Date.parse(started) + FUTURE_MS) fileFuture += 1;
      }
      if (lastTs === null || t > Date.parse(lastTs)) lastTs = ts;
    };

    db.exec("BEGIN");
    try {
      // ensure a source row exists so calls can reference it
      putSource.run(file, stat.size, committedOffset, started);
      const sourceId = (getSource.get(file) as { id: number }).id;
      let namedSource = false;
      const run = workflowRunOfPath(file);
      if (run !== null) placeSource.run(run, sourceId);

      for await (const line of readJsonlLines(file, offset)) {
        report.linesRead += 1;
        const outcome = parseClaudeCodeLine(line.text);
        if (outcome.agentId !== undefined && !namedSource) {
          nameSource.run(outcome.agentId, sourceId);
          namedSource = true;
        }
        if (outcome.kind === "malformed") {
          if (!line.terminated && outcome.reason === "invalid-json") {
            report.truncatedTails += 1;
            break; // a partial last line: leave it for the next run
          }
          report.malformedLines += 1;
          report.malformedReasons[outcome.reason] = (report.malformedReasons[outcome.reason] ?? 0) + 1;
        } else if (outcome.kind === "call") {
          mergeOrInsert(outcome.call, sourceId);
          seenAt(outcome.call.ts);
        } else if (outcome.kind === "cost_state") {
          // The counters only grow within a process, so the largest record is the latest one.
          const s = outcome.state;
          const known = getReported.get(s.sessionId, s.processStartMs) as { total_micros: number } | undefined;
          if (!known || s.totalMicros >= known.total_micros) {
            putReported.run(s.sessionId, s.processStartMs, s.totalMicros, s.apiDurationMs, s.linesAdded, s.linesRemoved, s.unknownModelCost ? 1 : 0, lastTs);
            clearReportedModels.run(s.sessionId, s.processStartMs);
            for (const m of s.models) putReportedModel.run(s.sessionId, s.processStartMs, m.model, m.inputTokens, m.outputTokens, m.thinkingTokens, m.cacheReadTokens, m.cacheWriteTokens, m.costMicros);
          }
        } else if (outcome.kind === "tool_results") {
          for (const w of outcome.workflows ?? []) report.workflows += Number(insertRun.run(w.sessionId, w.runId, sourceId, w.name, w.ts).changes);
          for (const dl of outcome.delegations ?? []) report.delegations += Number(insertEdge.run(dl.sessionId, dl.childAgentId, sourceId, dl.ts).changes);
          for (const r of outcome.results) {
            upsertToolResult.run(r.toolUseId, r.sessionId, r.ts, r.isError ? 1 : 0, r.resultChars, r.resultHash, r.truncated ? 1 : 0);
            seenAt(r.ts);
            report.toolResults += 1;
          }
        } else if (outcome.kind === "delegation_notice") {
          for (const dl of outcome.delegations) report.delegations += Number(insertEdge.run(dl.sessionId, dl.childAgentId, sourceId, dl.ts).changes);
          seenAt(outcome.delegations[0]!.ts);
        } else if (outcome.kind === "compaction") {
          const c = outcome.compaction;
          report.compactions += Number(insertCompaction.run(c.sessionId, c.ts, c.trigger, c.preTokens, c.postTokens, c.durationMs, sourceId).changes);
          seenAt(c.ts);
        } else if (outcome.kind === "human_prompt") {
          insertPrompt.run(outcome.prompt.promptId, outcome.prompt.sessionId, outcome.prompt.ts);
          seenAt(outcome.prompt.ts);
          report.humanPrompts += 1;
        }
        committedOffset = line.endOffset;
      }
      putSource.run(file, stat.size, committedOffset, started);
      if (fileSkew > 0 || fileFuture > 0) db.prepare("UPDATE ingest_source SET skewed_lines = skewed_lines + ?, future_lines = future_lines + ? WHERE id = ?").run(fileSkew, fileFuture, sourceId);
      report.skewedLines += fileSkew;
      report.futureLines += fileFuture;
      db.exec("COMMIT");
    } catch (error) {
      rollbackQuietly(db);
      throw explainSqliteError(db, error);
    }
  }

  recomputeCosts(db, snapshot, touched, report);
  updateSessionSpans(db, touchedSessions);

  db.prepare(
    `INSERT INTO ingest_run (kind, started_at, finished_at, files, lines_read, calls_new, calls_merged, malformed_lines, truncated_tails, usage_conflicts, skewed_lines, future_lines)
     VALUES ('claude_code', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(started, now().toISOString(), report.files, report.linesRead, report.callsNew, report.callsMerged, report.malformedLines, report.truncatedTails, report.usageConflicts, report.skewedLines, report.futureLines);
  flagUntrustedText(db, new Date().toISOString());
  sealIngest(db, "claude_code", started, { files: report.files, callsNew: report.callsNew, callsMerged: report.callsMerged });
  return report;

  function mergeOrInsert(call: ParsedCall, sourceId: number): void {
    touched.add(call.callId);
    touchedSessions.add(call.sessionId);
    insertSession.run(call.sessionId, maskStored(call.cwd), maskStored(call.gitBranch), maskStored(call.toolVersion));
    const existing = getCall.get(call.callId) as ExistingCall | undefined;
    if (!existing) {
      insertCall.run(
        call.callId, call.sessionId, call.requestId, call.ts, call.model, call.isSidechain ? 1 : 0, call.inputTokens, call.outputTokens,
        call.reasoningTokens, call.cacheReadTokens, call.cacheWrite5mTokens, call.cacheWrite1hTokens, call.cacheTtlBasis,
        call.cacheSplitMismatch ? 1 : 0, call.serviceTier, call.speed, call.stopReason, call.isApiError ? 1 : 0,
        JSON.stringify([...new Set(call.toolNames)]), sourceId, call.inferenceGeo, maskStored(call.toolVersion),
      );
      report.callsNew += 1;
      recordToolUses(call);
      return;
    }
    // Another content block of a call already seen. Real logs (checked on subagent logs) show that the
    // output token count grows from block to block while the call streams (5, then 143), and that the
    // input and cache counts never change. So output takes the larger value and that is normal; any
    // change to an input or cache field, or an output that goes down, is a real conflict and is counted.
    const next = {
      input: Math.max(existing.input_tokens, call.inputTokens),
      output: Math.max(existing.output_tokens, call.outputTokens),
      reasoning: Math.max(existing.reasoning_tokens, call.reasoningTokens),
      read: Math.max(existing.cache_read_tokens, call.cacheReadTokens),
      w5: Math.max(existing.cache_write_5m_tokens, call.cacheWrite5mTokens),
      w1: Math.max(existing.cache_write_1h_tokens, call.cacheWrite1hTokens),
    };
    const inputOrCacheChanged =
      existing.input_tokens !== call.inputTokens || existing.cache_read_tokens !== call.cacheReadTokens ||
      existing.cache_write_5m_tokens !== call.cacheWrite5mTokens || existing.cache_write_1h_tokens !== call.cacheWrite1hTokens;
    const outputRegressed = call.outputTokens < existing.output_tokens;
    const differs = inputOrCacheChanged || outputRegressed;
    if (outputRegressed) report.outputRegressions += 1;
    const tools = [...new Set([...(JSON.parse(existing.tool_names) as string[]), ...call.toolNames])];
    const conflicts = existing.usage_conflicts + (differs ? 1 : 0);
    if (inputOrCacheChanged) report.usageConflicts += 1;
    mergeCall.run(next.input, next.output, next.reasoning, next.read, next.w5, next.w1, JSON.stringify(tools), existing.block_lines + 1, conflicts, call.inferenceGeo, maskStored(call.toolVersion), call.callId);
    report.callsMerged += 1;
    recordToolUses(call);
  }

  function recordToolUses(call: ParsedCall): void {
    for (const t of call.toolUses) {
      const r = insertToolCall.run(t.toolUseId, call.callId, call.sessionId, t.name, t.inputHash, call.ts);
      report.toolCalls += Number(r.changes);
      if (t.editedPath) insertEdit.run(t.toolUseId, call.sessionId, maskStored(t.editedPath), call.ts);
    }
  }
}

export function recomputeCosts(db: Ledger, snapshot: PriceSnapshot, callIds: ReadonlySet<string>, report: Pick<IngestReport, "unpricedCalls" | "unpricedModels">): void {
  if (callIds.size === 0) return;
  const load = db.prepare(
    `SELECT call_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, speed, inference_geo FROM model_call WHERE call_id = ?`,
  );
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO cost_event (call_id, class, snapshot_id, matched_as, ladder_step, unpriced_reason, total_micros, input_micros,
       output_micros, cache_read_micros, cache_write_5m_micros, cache_write_1h_micros, rule_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const id of callIds) {
      const r = load.get(id) as {
        call_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number;
        cache_write_5m_tokens: number; cache_write_1h_tokens: number; speed: string | null; inference_geo: string | null;
      };
      const priced = priceCall(snapshot, {
        model: r.model,
        tokens: {
          inputTokens: r.input_tokens, outputTokens: r.output_tokens, cacheReadTokens: r.cache_read_tokens,
          cacheWrite5mTokens: r.cache_write_5m_tokens, cacheWrite1hTokens: r.cache_write_1h_tokens,
        },
        speed: r.speed,
        inferenceGeo: r.inference_geo,
      });
      if (priced.kind === "unpriced") {
        upsert.run(id, "unpriced", null, null, null, priced.reason, null, null, null, null, null, null, "[]");
        report.unpricedCalls += 1;
        report.unpricedModels[r.model] = priced.reason;
        continue;
      }
      const c = priced.components;
      upsert.run(id, "estimated", snapshot.snapshotId, priced.matchedAs, priced.ladderStep, null, priced.totalMicros, c.input, c.output, c.cacheRead, c.cacheWrite5m, c.cacheWrite1h, JSON.stringify(priced.ruleIds));
    }
    db.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(db);
    throw explainSqliteError(db, error);
  }
}

export function updateSessionSpans(db: Ledger, sessionIds: ReadonlySet<string>): void {
  if (sessionIds.size === 0) return;
  const update = db.prepare(
    `UPDATE session SET started_at = (SELECT MIN(ts) FROM model_call WHERE session_id = ?), ended_at = (SELECT MAX(ts) FROM model_call WHERE session_id = ?)
     WHERE session_id = ?`,
  );
  db.exec("BEGIN");
  try {
    for (const id of sessionIds) update.run(id, id, id);
    db.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(db);
    throw explainSqliteError(db, error);
  }
}
