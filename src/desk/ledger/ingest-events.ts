import { createHash } from "node:crypto";
import { statSync } from "node:fs";

import { readJsonlLines } from "../ingest/jsonl.ts";
import { EventReader, NATIVE_TOOLS, type CallRecord, type ParsedEvents, type SessionRecord } from "../open/events.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { flagUntrustedText } from "../security/flag.ts";
import { maskStored } from "../security/secrets.ts";
import { assertChain, sealIngest } from "./chain.ts";
import { explainSqliteError, rollbackQuietly, type Ledger } from "./db.ts";
import { recomputeCosts, recordSnapshot, updateSessionSpans } from "./ingest.ts";

/**
 * Read a file of `desk.events/1` records into the ledger (DF-063). The file is checked whole before anything is written: one invalid line refuses the file, with the line
 * numbers, because a ledger that drops the calls it could not read understates what was spent. Calls are priced here at list price from their tokens like any other call;
 * a cost the tool reported is kept beside the estimate and never in place of it. Ids are prefixed with the tool, so two tools that number their calls from 1 cannot collide,
 * and reading a file again stores nothing twice.
 */
export interface EventsImport {
  file: string;
  tool: string;
  sessions: number;
  calls: number;
  callsNew: number;
  callsAlreadyHeld: number;
  withReportedCost: number;
  cacheWriteUnsplit: number;
  unpricedCalls: number;
  unpricedModels: Record<string, string>;
}

export type EventsRefusal = { kind: "refused"; reason: string; problems: { line: number; field: string | null; message: string }[]; moreProblems: number };

/** Read and check a file without touching any ledger. */
export async function readEventsFile(file: string): Promise<ParsedEvents> {
  const reader = new EventReader();
  let n = 0;
  for await (const line of readJsonlLines(file, 0)) {
    n += 1;
    reader.feed(line.text, n);
  }
  return reader.finish();
}

export const prefix = (tool: string, id: string): string => `ev:${tool}:${id}`;

function refusal(reason: string): EventsRefusal {
  return { kind: "refused", reason, problems: [], moreProblems: 0 };
}

/** Store checked events. The caller has already refused a file with problems; this refuses the one thing a valid file can still get wrong, a native tool's name. */
export function storeEvents(db: Ledger, parsed: ParsedEvents, file: string, size: number, digest: string, snapshot: PriceSnapshot, now: () => Date = () => new Date()): EventsImport | EventsRefusal {
  const header = parsed.header;
  if (header === null) return refusal("the file has no header record");
  const tool = header.tool;
  const nativeIn = NATIVE_TOOLS.includes(tool) ? tool : parsed.sessions.map((s) => s.tool).find((t): t is string => typeof t === "string" && NATIVE_TOOLS.includes(t));
  if (nativeIn !== undefined) return refusal(`the file says it is from "${nativeIn}", a source the Desk reads itself; importing its calls too would count them twice. Use the Desk's own reader for it.`);
  assertChain(db);
  const started = now().toISOString();
  recordSnapshot(db, snapshot);
  const putSource = db.prepare(
    `INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('events', ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET size_bytes = excluded.size_bytes, offset_bytes = excluded.offset_bytes, last_ingested_at = excluded.last_ingested_at`,
  );
  const putSession = db.prepare(
    `INSERT INTO session (session_id, tool, project_path, git_branch, tool_version) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET project_path = COALESCE(session.project_path, excluded.project_path), git_branch = COALESCE(session.git_branch, excluded.git_branch), tool_version = COALESCE(session.tool_version, excluded.tool_version)`,
  );
  const putCall = db.prepare(
    `INSERT OR IGNORE INTO model_call (call_id, session_id, request_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, service_tier, speed,
       stop_reason, is_api_error, tool_names, block_lines, usage_conflicts, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, 0, ?)`,
  );
  const putReported = db.prepare("INSERT OR REPLACE INTO call_reported_cost (call_id, source, currency, amount_micros, observed_at) VALUES (?, ?, ?, ?, ?)");
  const sessionIds = new Set<string>();
  const inserted = new Set<string>();
  let held = 0;
  let withReported = 0;
  let unsplit = 0;
  const describe = new Map<string, SessionRecord>(parsed.sessions.map((s) => [s.session_id, s]));
  db.exec("BEGIN");
  try {
    const label = `events:${tool}:${digest.slice(0, 16)}`;
    putSource.run(label, size, size, started);
    const sourceId = (db.prepare("SELECT id FROM ingest_source WHERE path = ?").get(label) as { id: number }).id;
    const ensure = (sid: string): string => {
      const id = prefix(tool, sid);
      if (!sessionIds.has(id)) {
        const d = describe.get(sid);
        putSession.run(id, d?.tool ?? tool, maskStored(d?.project_path ?? null), maskStored(d?.git_branch ?? null), maskStored(d?.tool_version ?? header.tool_version ?? null));
        sessionIds.add(id);
      }
      return id;
    };
    for (const s of parsed.sessions) ensure(s.session_id);
    for (const c of parsed.calls as CallRecord[]) {
      const sid = ensure(c.session_id);
      const split = c.cache_write_5m_tokens != null || c.cache_write_1h_tokens != null;
      const write5m = split ? (c.cache_write_5m_tokens ?? 0) : (c.cache_write_tokens ?? 0);
      if (!split && (c.cache_write_tokens ?? 0) > 0) unsplit += 1;
      const id = prefix(tool, c.call_id);
      const res = putCall.run(
        id, sid, c.request_id ?? null, c.ts, c.model, c.is_sidechain ? 1 : 0, c.input_tokens, c.output_tokens, c.reasoning_tokens ?? 0, c.cache_read_tokens ?? 0, write5m, c.cache_write_1h_tokens ?? 0,
        split ? "reported" : "assumed-5m", c.service_tier ?? null, c.speed ?? null, c.stop_reason ?? null, c.is_api_error ? 1 : 0, JSON.stringify(c.tool_names ?? []), sourceId,
      );
      if (Number(res.changes) > 0) inserted.add(id);
      else held += 1;
      if (c.reported_cost_micros != null && c.reported_currency != null) {
        putReported.run(id, `ev:${tool}`, c.reported_currency, c.reported_cost_micros, started);
        withReported += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(db);
    throw explainSqliteError(db, error);
  }
  const costReport = { unpricedCalls: 0, unpricedModels: {} as Record<string, string> };
  recomputeCosts(db, snapshot, inserted, costReport);
  updateSessionSpans(db, sessionIds);
  db.prepare(
    `INSERT INTO ingest_run (kind, started_at, finished_at, files, lines_read, calls_new, calls_merged, malformed_lines, truncated_tails, usage_conflicts)
     VALUES ('events', ?, ?, 1, ?, ?, 0, 0, 0, 0)`,
  ).run(started, now().toISOString(), parsed.lines, inserted.size);
  flagUntrustedText(db, started);
  sealIngest(db, "events", started, { files: 1, callsNew: inserted.size, callsMerged: 0 });
  return { file, tool, sessions: sessionIds.size, calls: parsed.calls.length, callsNew: inserted.size, callsAlreadyHeld: held, withReportedCost: withReported, cacheWriteUnsplit: unsplit, unpricedCalls: costReport.unpricedCalls, unpricedModels: costReport.unpricedModels };
}

/** Check a file, then store it. A file with any invalid line is refused and nothing is written. */
export async function importEventsFile(db: Ledger, file: string, snapshot: PriceSnapshot, now: () => Date = () => new Date()): Promise<EventsImport | EventsRefusal> {
  const stat = statSync(file);
  const parsed = await readEventsFile(file);
  if (parsed.problems.length > 0) return { kind: "refused", reason: `${file} is not a valid desk.events/1 file`, problems: parsed.problems, moreProblems: parsed.moreProblems };
  const hash = createHash("sha256");
  for await (const line of readJsonlLines(file, 0)) hash.update(line.text + "\n");
  return storeEvents(db, parsed, file, stat.size, hash.digest("hex"), snapshot, now);
}
