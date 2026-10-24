import { readJsonlLines } from "../ingest/jsonl.ts";
import { parseClaudeCodeLine, workflowRunOfPath } from "../ingest/claude-code.ts";
import type { Ledger } from "./db.ts";
import { maskStored } from "../security/secrets.ts";

export interface BackfillReport {
  files: number;
  callsSeen: number;
  inferenceGeoFilled: number;
  /** Tool results that now carry a hash of what they said and whether the tool cut them short (schema version 14). */
  resultFactsFilled: number;
  /** Calls that now carry the client version, and compactions the logs record (schema version 15). */
  toolVersionFilled: number;
  compactionsFilled: number;
  /** Delegation edges and agent names read from logs ingested before schema version 16. */
  delegationsFilled: number;
  agentsNamed: number;
  /** Workflow runs and the logs placed in one (schema version 17). */
  workflowsFilled: number;
  logsPlaced: number;
}

/**
 * Fill a field into calls that were ingested before the field was read (`inference_geo`, added in schema version 8, and the hash and
 * truncation mark of a tool result, added in version 14, and the client version of a call and the compactions of a session, added in version 15).
 * It reads the logs again but writes only the empty field of a call that already exists: no token count, cost or
 * timestamp is touched, a field that already has a value is never replaced, and running it twice changes nothing.
 * Prices that depend on the field are updated afterwards by `desk prices reprice`.
 */
export async function backfillClaudeCodeFields(db: Ledger, files: readonly string[]): Promise<BackfillReport> {
  const fill = db.prepare("UPDATE model_call SET inference_geo = ? WHERE call_id = ? AND inference_geo IS NULL");
  const fillResult = db.prepare("UPDATE tool_result SET result_hash = ?, truncated = ? WHERE tool_use_id = ? AND result_hash IS NULL");
  const fillVersion = db.prepare("UPDATE model_call SET tool_version = ? WHERE call_id = ? AND tool_version IS NULL");
  const fillCompaction = db.prepare("INSERT OR IGNORE INTO session_compaction (session_id, ts, trigger, pre_tokens, post_tokens, duration_ms, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const sourceOf = db.prepare("SELECT id FROM ingest_source WHERE path = ?");
  const report: BackfillReport = { files: 0, callsSeen: 0, inferenceGeoFilled: 0, resultFactsFilled: 0, toolVersionFilled: 0, compactionsFilled: 0, delegationsFilled: 0, agentsNamed: 0, workflowsFilled: 0, logsPlaced: 0 };
  const fillRun = db.prepare("INSERT OR IGNORE INTO workflow_run (session_id, run_id, parent_source_id, name, ts) VALUES (?, ?, ?, ?, ?)");
  const placeSource = db.prepare("UPDATE ingest_source SET workflow_run = ? WHERE id = ? AND workflow_run IS NULL");
  const fillEdge = db.prepare("INSERT OR IGNORE INTO delegation_edge (session_id, child_agent_id, parent_source_id, ts) VALUES (?, ?, ?, ?)");
  const nameSource = db.prepare("UPDATE ingest_source SET agent_id = ? WHERE id = ? AND agent_id IS NULL");
  for (const file of files) {
    report.files += 1;
    const sourceId = (sourceOf.get(file) as { id: number } | undefined)?.id ?? null;
    let named = false;
    const run = workflowRunOfPath(file);
    if (run !== null && sourceId !== null) report.logsPlaced += Number(placeSource.run(run, sourceId).changes);
    db.exec("BEGIN");
    try {
      for await (const line of readJsonlLines(file, 0)) {
        const outcome = parseClaudeCodeLine(line.text);
        if (outcome.agentId !== undefined && !named && sourceId !== null) {
          report.agentsNamed += Number(nameSource.run(outcome.agentId, sourceId).changes);
          named = true;
        }
        if (outcome.kind === "tool_results") {
          if (sourceId !== null) for (const w of outcome.workflows ?? []) report.workflowsFilled += Number(fillRun.run(w.sessionId, w.runId, sourceId, w.name, w.ts).changes);
          if (sourceId !== null) for (const dl of outcome.delegations ?? []) report.delegationsFilled += Number(fillEdge.run(dl.sessionId, dl.childAgentId, sourceId, dl.ts).changes);
          for (const r of outcome.results) if (r.resultHash !== null) report.resultFactsFilled += Number(fillResult.run(r.resultHash, r.truncated ? 1 : 0, r.toolUseId).changes);
          continue;
        }
        if (outcome.kind === "delegation_notice") {
          if (sourceId !== null) for (const dl of outcome.delegations) report.delegationsFilled += Number(fillEdge.run(dl.sessionId, dl.childAgentId, sourceId, dl.ts).changes);
          continue;
        }
        if (outcome.kind === "compaction") {
          const c = outcome.compaction;
          report.compactionsFilled += Number(fillCompaction.run(c.sessionId, c.ts, c.trigger, c.preTokens, c.postTokens, c.durationMs, sourceId).changes);
          continue;
        }
        if (outcome.kind !== "call") continue;
        report.callsSeen += 1;
        if (outcome.call.toolVersion !== null) report.toolVersionFilled += Number(fillVersion.run(maskStored(outcome.call.toolVersion), outcome.call.callId).changes);
        if (outcome.call.inferenceGeo !== null) report.inferenceGeoFilled += Number(fill.run(outcome.call.inferenceGeo, outcome.call.callId).changes);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return report;
}
