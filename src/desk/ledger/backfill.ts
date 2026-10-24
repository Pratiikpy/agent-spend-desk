import { readJsonlLines } from "../ingest/jsonl.ts";
import { parseClaudeCodeLine } from "../ingest/claude-code.ts";
import type { Ledger } from "./db.ts";

export interface BackfillReport {
  files: number;
  callsSeen: number;
  inferenceGeoFilled: number;
  /** Tool results that now carry a hash of what they said and whether the tool cut them short (schema version 14). */
  resultFactsFilled: number;
}

/**
 * Fill a field into calls that were ingested before the field was read (`inference_geo`, added in schema version 8, and the hash and
 * truncation mark of a tool result, added in version 14).
 * It reads the logs again but writes only the empty field of a call that already exists: no token count, cost or
 * timestamp is touched, a field that already has a value is never replaced, and running it twice changes nothing.
 * Prices that depend on the field are updated afterwards by `desk prices reprice`.
 */
export async function backfillClaudeCodeFields(db: Ledger, files: readonly string[]): Promise<BackfillReport> {
  const fill = db.prepare("UPDATE model_call SET inference_geo = ? WHERE call_id = ? AND inference_geo IS NULL");
  const fillResult = db.prepare("UPDATE tool_result SET result_hash = ?, truncated = ? WHERE tool_use_id = ? AND result_hash IS NULL");
  const report: BackfillReport = { files: 0, callsSeen: 0, inferenceGeoFilled: 0, resultFactsFilled: 0 };
  for (const file of files) {
    report.files += 1;
    db.exec("BEGIN");
    try {
      for await (const line of readJsonlLines(file, 0)) {
        const outcome = parseClaudeCodeLine(line.text);
        if (outcome.kind === "tool_results") {
          for (const r of outcome.results) if (r.resultHash !== null) report.resultFactsFilled += Number(fillResult.run(r.resultHash, r.truncated ? 1 : 0, r.toolUseId).changes);
          continue;
        }
        if (outcome.kind !== "call") continue;
        report.callsSeen += 1;
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
