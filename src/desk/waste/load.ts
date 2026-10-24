import type { AutopsyCall, PerCall } from "../autopsy/engine.ts";
import type { Ledger } from "../ledger/db.ts";
import { detectWaste, type CallFacts, type WasteEvent } from "./detect.ts";

/**
 * What the waste rules need about each call beyond the autopsy's record: what each tool use returned (a folded hash, whether the tool said it
 * cut its output short, whether it failed) and which files it edited. Read from the ledger for the calls given, never from a log.
 */
export function loadCallFacts(db: Ledger, calls: readonly AutopsyCall[]): Map<string, CallFacts> {
  const out = new Map<string, CallFacts>();
  if (calls.length === 0) return out;
  const ids = new Set(calls.map((c) => c.callId));
  const sessions = [...new Set(calls.map((c) => c.sessionId))];
  const rows: { call_id: string; name: string; input_hash: string; result_hash: string | null; truncated: number | null; is_error: number | null; path: string | null }[] = [];
  // In slices of sessions, so that a long window does not become one enormous statement.
  for (let i = 0; i < sessions.length; i += 400) {
    const slice = sessions.slice(i, i + 400);
    const part = db
      .prepare(
        `SELECT t.call_id, t.name, t.input_hash, r.result_hash, r.truncated, r.is_error, e.path
         FROM tool_call t LEFT JOIN tool_result r ON r.tool_use_id = t.tool_use_id LEFT JOIN session_edit e ON e.tool_use_id = t.tool_use_id
         WHERE t.session_id IN (${slice.map(() => "?").join(",")})`,
      )
      .all(...slice) as unknown as typeof rows;
    for (const r of part) rows.push(r);
  }
  for (const r of rows) {
    if (!ids.has(r.call_id)) continue;
    const f = out.get(r.call_id) ?? { results: [], editedPaths: [] };
    f.results.push({ name: r.name, inputHash: r.input_hash, resultHash: r.result_hash, truncated: r.truncated === 1, isError: r.is_error === 1 });
    if (r.path !== null) f.editedPaths.push(r.path);
    out.set(r.call_id, f);
  }
  return out;
}

/** The waste events of these calls: the facts read from the ledger, then the rules. */
export function wasteEventsOf(db: Ledger, calls: readonly AutopsyCall[], analysis: ReadonlyMap<string, PerCall>, facts: ReadonlyMap<string, CallFacts> = loadCallFacts(db, calls)): WasteEvent[] {
  return detectWaste(calls, analysis, facts);
}
