import { closeSync, openSync, writeSync } from "node:fs";

import type { Ledger } from "../ledger/db.ts";
import { eventLine, EVENTS_SCHEMA, LIMITS, type CallRecord, type HeaderRecord, type SessionRecord } from "./events.ts";

/**
 * The Desk's record as `desk.events/1` (DF-063), for another tool to read. Facts only: when, which model, the tokens of each kind, what the source reported. No estimate
 * is written, because an estimate belongs to a price list and the reader brings its own. Folders and branches are left out unless asked for, since they name the
 * owner's projects; text fields the ledger holds are never prompts or results, so none can appear.
 */
export interface ExportOptions {
  since?: string;
  until?: string;
  /** Only sessions of this tool (`claude_code`, `codex`, ...). */
  tool?: string;
  withPaths?: boolean;
  now?: Date;
}

export interface ExportReport {
  file: string;
  sessions: number;
  calls: number;
  withReportedCost: number;
  withPaths: boolean;
  /** Calls left out because the ledger holds a value an event cannot carry (a model name too long, for one). */
  skipped: number;
}

interface CallRow {
  call_id: string;
  session_id: string;
  request_id: string | null;
  ts: string;
  model: string;
  is_sidechain: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cache_ttl_basis: string;
  service_tier: string | null;
  speed: string | null;
  stop_reason: string | null;
  is_api_error: number;
  tool_names: string;
  reported: number | null;
  currency: string | null;
}

/** Write the ledger's calls to a file. Streams, so a large ledger is not held in memory. */
export function exportEvents(db: Ledger, file: string, o: ExportOptions = {}): ExportReport | string {
  const since = o.since ?? "0000";
  const until = o.until ?? "9999";
  const tool = o.tool ?? null;
  const where = "m.ts >= ? AND m.ts < ? AND (? IS NULL OR s.tool = ?)";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE ${where}`).get(since, until, tool, tool) as { n: number }).n;
  if (total === 0) return "The ledger holds no call in that range, so there is nothing to write.";
  if (total > LIMITS.records - 100_000) return `${total.toLocaleString("en-US")} calls are in that range, more than one file holds (${LIMITS.records.toLocaleString("en-US")} records). Narrow it with --since and --until.`;

  const header: HeaderRecord = { schema: EVENTS_SCHEMA, type: "header", tool: "desk", tool_version: null, produced_at: (o.now ?? new Date()).toISOString() };
  const fd = openSync(file, "wx");
  let skipped = 0;
  let withReported = 0;
  let calls = 0;
  try {
    writeSync(fd, `${eventLine(header)}\n`);
    const sessions = db
      .prepare(`SELECT DISTINCT s.session_id AS id, s.tool AS tool, s.project_path AS project, s.git_branch AS branch, s.tool_version AS version FROM session s JOIN model_call m ON m.session_id = s.session_id WHERE ${where} ORDER BY s.session_id`)
      .all(since, until, tool, tool) as unknown as { id: string; tool: string; project: string | null; branch: string | null; version: string | null }[];
    let sessionCount = 0;
    let buf: string[] = [];
    const flush = (): void => {
      if (buf.length > 0) writeSync(fd, buf.join(""));
      buf = [];
    };
    for (const s of sessions) {
      const rec: SessionRecord = { type: "session", session_id: s.id, tool: /^[a-z][a-z0-9_-]{1,39}$/.test(s.tool) ? s.tool : null, project_path: o.withPaths ? s.project : null, git_branch: o.withPaths ? s.branch : null, tool_version: s.version };
      buf.push(`${eventLine(rec)}\n`);
      sessionCount += 1;
      if (buf.length >= 2_000) flush();
    }
    flush();
    const rows = db
      .prepare(
        `SELECT m.call_id, m.session_id, m.request_id, m.ts, m.model, m.is_sidechain, m.input_tokens, m.output_tokens, m.reasoning_tokens, m.cache_read_tokens, m.cache_write_5m_tokens,
                m.cache_write_1h_tokens, m.cache_ttl_basis, m.service_tier, m.speed, m.stop_reason, m.is_api_error, m.tool_names, r.amount_micros AS reported, r.currency AS currency
         FROM model_call m JOIN session s ON s.session_id = m.session_id LEFT JOIN call_reported_cost r ON r.call_id = m.call_id
         WHERE ${where} ORDER BY m.ts, m.call_id`,
      )
      .iterate(since, until, tool, tool) as IterableIterator<Record<string, unknown>>;
    for (const raw of rows) {
      const r = raw as unknown as CallRow;
      let names: string[] | null = null;
      try {
        const parsed: unknown = JSON.parse(r.tool_names);
        names = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= LIMITS.toolNameChars).slice(0, LIMITS.toolNames) : null;
      } catch {
        names = null;
      }
      const reported = r.reported !== null && r.currency !== null && /^[A-Z]{3}$/.test(r.currency);
      const rec: CallRecord = {
        type: "call", call_id: r.call_id, session_id: r.session_id, ts: r.ts, model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens,
        request_id: r.request_id, reasoning_tokens: r.reasoning_tokens, cache_read_tokens: r.cache_read_tokens,
        ...(r.cache_ttl_basis === "reported" ? { cache_write_5m_tokens: r.cache_write_5m_tokens, cache_write_1h_tokens: r.cache_write_1h_tokens } : { cache_write_tokens: r.cache_write_5m_tokens + r.cache_write_1h_tokens }),
        service_tier: r.service_tier, speed: r.speed, stop_reason: r.stop_reason, is_sidechain: r.is_sidechain === 1, is_api_error: r.is_api_error === 1, tool_names: names,
        ...(reported ? { reported_cost_micros: r.reported, reported_currency: r.currency } : {}),
      };
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(rec.ts) || rec.model.length > 200 || rec.call_id.length > LIMITS.idChars || rec.session_id.length > LIMITS.idChars) {
        skipped += 1;
        continue;
      }
      buf.push(`${eventLine(rec)}\n`);
      calls += 1;
      if (reported) withReported += 1;
      if (buf.length >= 2_000) flush();
    }
    flush();
    return { file, sessions: sessionCount, calls, withReportedCost: withReported, withPaths: o.withPaths === true, skipped };
  } finally {
    closeSync(fd);
  }
}
