import { createHash } from "node:crypto";

import { parseCsv } from "../billing/csv.ts";
import type { Ledger } from "../ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../ledger/ingest.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";

/**
 * A gateway's spend log (DF-023): LiteLLM's `LiteLLM_SpendLogs` as exported from its admin pages or its database, as JSON, JSON Lines
 * or CSV. Each row is one request: a model, tokens, and the cost the gateway computed. The tokens are priced here at list price like
 * any other call; the cost the gateway reports is stored beside that estimate and never in place of it, so the two can be compared.
 *
 * The columns that hold a conversation (`messages`, `response`, `proxy_server_request`) are never read, whatever the file holds, and
 * neither are keys or addresses. A column that is not recognised is listed, not guessed at.
 */
export interface GatewayRow {
  requestId: string;
  model: string;
  /** ISO time the request started. */
  startedAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Micro-dollars the gateway says the request cost; null when the row has no usable spend. */
  spendMicros: number | null;
  /** The gateway's own session, else a pseudonym of the end user or user, else none. */
  session: string | null;
  /** The prompt count could not be split into fresh input and cache: all of it is priced as fresh input, an upper bound for a model with cheaper cache reads. */
  cacheUnsplit: boolean;
  /** The split in the row did not add up (cache tokens above the prompt total): the row is kept with the cache clamped, and counted. */
  inconsistent: boolean;
}

export interface SpendLogParse {
  format: "json" | "jsonl" | "csv";
  rows: GatewayRow[];
  skipped: Record<string, number>;
  /** Columns the Desk does not use and has no reason to: listed so that nothing is silently dropped. */
  unknownColumns: string[];
  /** Columns that hold content or secrets and were not read. */
  contentColumnsNotRead: string[];
  /** Rows with a repeated request id: the first is used. */
  duplicates: number;
}

const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string> = {
  requestid: "requestId", id: "requestId",
  model: "model", modelgroup: "modelGroup",
  starttime: "startedAt", starttimeutc: "startedAt", createdat: "startedAt", starttimestamp: "startedAt",
  spend: "spend", cost: "spend", responsecost: "spend",
  prompttokens: "promptTokens", inputtokens: "promptTokens",
  completiontokens: "completionTokens", outputtokens: "completionTokens",
  totaltokens: "totalTokens",
  sessionid: "session", user: "user", enduser: "endUser",
  metadata: "metadata", cachehit: "cacheHit", calltype: "callType", status: "status",
  cachereadinputtokens: "cacheRead", cachecreationinputtokens: "cacheWrite",
};

/** Present in a LiteLLM export and deliberately never read. */
const CONTENT_COLUMNS = new Set(["messages", "response", "proxyserverrequest", "apikey", "requesteripaddress", "cachekey", "requesttags", "teamid", "apibase", "modelid", "endtime", "completionstarttime", "customllmprovider", "organizationid", "agentid", "mcptoolcalls", "requestduration"]);
const CONTENT_LABEL: Record<string, string> = { messages: "messages", response: "response", proxyserverrequest: "proxy_server_request", apikey: "api_key", requesteripaddress: "requester_ip_address", cachekey: "cache_key" };

const whole = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function usageObject(metadata: unknown): Record<string, unknown> | null {
  let m: unknown = metadata;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      return null;
    }
  }
  if (typeof m !== "object" || m === null) return null;
  const u = (m as Record<string, unknown>)["usage_object"];
  return typeof u === "object" && u !== null ? (u as Record<string, unknown>) : null;
}

function microsOf(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return null;
  return Math.round(n * 1_000_000);
}

/** Split the gateway's records into JSON objects, whichever way the file holds them. */
function records(text: string): { format: SpendLogParse["format"]; rows: Record<string, unknown>[] } | string {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const trimmed = t.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const doc: unknown = JSON.parse(trimmed);
      const list = Array.isArray(doc) ? doc : typeof doc === "object" && doc !== null && Array.isArray((doc as { data?: unknown }).data) ? (doc as { data: unknown[] }).data : typeof doc === "object" && doc !== null && Array.isArray((doc as { logs?: unknown }).logs) ? (doc as { logs: unknown[] }).logs : [doc];
      return { format: "json", rows: list.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)) };
    } catch {
      const out: Record<string, unknown>[] = [];
      for (const line of trimmed.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        try {
          const o: unknown = JSON.parse(line);
          if (typeof o === "object" && o !== null && !Array.isArray(o)) out.push(o as Record<string, unknown>);
        } catch {
          return "The file starts like JSON but is neither one JSON document nor one object per line.";
        }
      }
      return { format: "jsonl", rows: out };
    }
  }
  let recs;
  try {
    recs = parseCsv(t);
  } catch (e) {
    return `The file is not readable as CSV: ${(e as Error).message}`;
  }
  if (recs.length < 2) return "The file has no data row.";
  const header = recs[0]!.fields;
  return { format: "csv", rows: recs.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r.fields[i] ?? ""]))) };
}

export function parseSpendLog(text: string): SpendLogParse | string {
  const got = records(text);
  if (typeof got === "string") return got;
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const unknown = new Set<string>();
  const content = new Set<string>();
  const rows: GatewayRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const raw of got.rows) {
    const rec: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const n = norm(key);
      const a = ALIASES[n];
      if (a !== undefined) rec[a] ??= value;
      else if (CONTENT_COLUMNS.has(n)) {
        if (CONTENT_LABEL[n] !== undefined) content.add(CONTENT_LABEL[n] as string);
      } else unknown.add(key);
    }
    const requestId = typeof rec["requestId"] === "string" && rec["requestId"] !== "" ? (rec["requestId"] as string) : typeof rec["requestId"] === "number" ? String(rec["requestId"]) : null;
    const model = typeof rec["model"] === "string" && rec["model"] !== "" ? rec["model"] : typeof rec["modelGroup"] === "string" && rec["modelGroup"] !== "" ? rec["modelGroup"] : null;
    if (requestId === null) { skip("no request id"); continue; }
    if (model === null) { skip("no model"); continue; }
    const start = typeof rec["startedAt"] === "string" || typeof rec["startedAt"] === "number" ? new Date(rec["startedAt"] as string | number) : null;
    if (start === null || Number.isNaN(start.getTime())) { skip("no usable start time"); continue; }
    if (rec["cacheHit"] === true || (typeof rec["cacheHit"] === "string" && rec["cacheHit"].toLowerCase() === "true")) { skip("served from the gateway's own cache (no model call)"); continue; }
    const status = typeof rec["status"] === "string" ? rec["status"].toLowerCase() : "";
    if (status === "failure" || status === "failed") { skip("a failed request"); continue; }
    if (seen.has(requestId)) { duplicates += 1; continue; }
    seen.add(requestId);
    let prompt = whole(rec["promptTokens"]);
    let completion = whole(rec["completionTokens"]);
    const total = whole(rec["totalTokens"]);
    if (prompt === null && completion === null && total !== null) { prompt = total; completion = 0; skip("only a total (all counted as input)"); }
    if (prompt === null || completion === null) { skip("no usable token counts"); continue; }
    const u = usageObject(rec["metadata"]);
    const details = u && typeof u["prompt_tokens_details"] === "object" && u["prompt_tokens_details"] !== null ? (u["prompt_tokens_details"] as Record<string, unknown>) : null;
    const read = whole(rec["cacheRead"]) ?? (u ? (whole(u["cache_read_input_tokens"]) ?? (details ? whole(details["cached_tokens"]) : null)) : null);
    const write = whole(rec["cacheWrite"]) ?? (u ? (whole(u["cache_creation_input_tokens"]) ?? (details ? whole(details["cache_creation_tokens"]) : null)) : null);
    const split = read !== null || write !== null;
    let inputTokens = prompt;
    let cacheRead = 0;
    let cacheWrite = 0;
    let inconsistent = false;
    if (split) {
      cacheRead = read ?? 0;
      cacheWrite = write ?? 0;
      // The gateway reports a prompt count that includes cache tokens (the OpenAI convention). More cache than prompt is a row that does not add up.
      if (cacheRead + cacheWrite > prompt) {
        inconsistent = true;
        const scale = (prompt || 0) / (cacheRead + cacheWrite);
        cacheRead = Math.floor(cacheRead * scale);
        cacheWrite = Math.floor(cacheWrite * scale);
      }
      inputTokens = Math.max(0, prompt - cacheRead - cacheWrite);
    }
    // A gateway's own session id is kept as it is. A person's name or id is not: it becomes a stable pseudonym, so one person's calls stay together without the ledger holding who they are.
    const userRaw = rec["endUser"] ?? rec["user"];
    const sessionRaw = typeof rec["session"] === "string" && rec["session"] !== "" ? rec["session"] : typeof userRaw === "string" && userRaw !== "" ? `user-${createHash("sha256").update(userRaw).digest("hex").slice(0, 8)}` : null;
    rows.push({
      requestId, model, startedAt: start.toISOString(), inputTokens, outputTokens: completion, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
      spendMicros: microsOf(rec["spend"]), session: sessionRaw, cacheUnsplit: !split, inconsistent,
    });
  }
  return { format: got.format, rows, skipped, unknownColumns: [...unknown].sort(), contentColumnsNotRead: [...content].sort(), duplicates };
}

export interface SpendLogImport {
  file: string;
  format: SpendLogParse["format"];
  rows: number;
  callsNew: number;
  callsAlreadyHeld: number;
  skipped: Record<string, number>;
  duplicates: number;
  unknownColumns: string[];
  contentColumnsNotRead: string[];
  withReportedCost: number;
  withoutReportedCost: number;
  cacheUnsplit: number;
  inconsistent: number;
  unpricedCalls: number;
  /** Model names with no price, each with the reason the price book gave. */
  unpricedModels: Record<string, string>;
}

/** Store the rows as calls of a tool called `litellm`, price them at list price, and keep the gateway's cost beside the estimate. Idempotent: the same file read twice adds nothing. */
export function importSpendLog(db: Ledger, text: string, file: string, snapshot: PriceSnapshot, now: () => Date = () => new Date()): SpendLogImport | string {
  const parsed = parseSpendLog(text);
  if (typeof parsed === "string") return parsed;
  recordSnapshot(db, snapshot);
  const observed = now().toISOString();
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const putSource = db.prepare(
    `INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('gateway', ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET size_bytes = excluded.size_bytes, offset_bytes = excluded.offset_bytes, last_ingested_at = excluded.last_ingested_at`,
  );
  const putSession = db.prepare("INSERT OR IGNORE INTO session (session_id, tool, project_path, git_branch, tool_version) VALUES (?, 'litellm', NULL, NULL, NULL)");
  const putCall = db.prepare(
    `INSERT OR IGNORE INTO model_call (call_id, session_id, request_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, service_tier, speed,
       stop_reason, is_api_error, tool_names, block_lines, usage_conflicts, source_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, 0, 'assumed-5m', 0, NULL, NULL, NULL, 0, '[]', 1, ?, ?)`,
  );
  const putReported = db.prepare("INSERT OR REPLACE INTO call_reported_cost (call_id, source, currency, amount_micros, observed_at) VALUES (?, 'litellm', 'USD', ?, ?)");
  const inserted = new Set<string>();
  const sessions = new Set<string>();
  let held = 0;
  let withReported = 0;
  db.exec("BEGIN");
  try {
    // A file is identified by its content, so a renamed copy is the same source and a changed export is a new one.
    const label = `gateway:${digest}`;
    putSource.run(label, Buffer.byteLength(text), Buffer.byteLength(text), observed);
    const sourceId = (db.prepare("SELECT id FROM ingest_source WHERE path = ?").get(label) as { id: number }).id;
    for (const r of parsed.rows) {
      const session = `litellm:${r.session ?? "gateway"}`;
      if (!sessions.has(session)) {
        putSession.run(session);
        sessions.add(session);
      }
      const id = `litellm:${r.requestId}`;
      const res = putCall.run(id, session, r.requestId, r.startedAt, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.inconsistent ? 1 : 0, sourceId);
      if (Number(res.changes) > 0) inserted.add(id);
      else held += 1;
      if (r.spendMicros !== null) {
        putReported.run(id, r.spendMicros, observed);
        withReported += 1;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const costReport = { unpricedCalls: 0, unpricedModels: {} as Record<string, string> };
  recomputeCosts(db, snapshot, inserted, costReport);
  for (const s of sessions) db.prepare("UPDATE session SET started_at = COALESCE(started_at, (SELECT MIN(ts) FROM model_call WHERE session_id = ?)), ended_at = (SELECT MAX(ts) FROM model_call WHERE session_id = ?) WHERE session_id = ?").run(s, s, s);
  db.prepare(
    `INSERT INTO ingest_run (kind, started_at, finished_at, files, lines_read, calls_new, calls_merged, malformed_lines, truncated_tails, usage_conflicts)
     VALUES ('gateway', ?, ?, 1, ?, ?, 0, 0, 0, ?)`,
  ).run(observed, now().toISOString(), parsed.rows.length, inserted.size, parsed.rows.filter((r) => r.inconsistent).length);
  return {
    file, format: parsed.format, rows: parsed.rows.length, callsNew: inserted.size, callsAlreadyHeld: held, skipped: parsed.skipped, duplicates: parsed.duplicates,
    unknownColumns: parsed.unknownColumns, contentColumnsNotRead: parsed.contentColumnsNotRead, withReportedCost: withReported, withoutReportedCost: parsed.rows.length - withReported,
    cacheUnsplit: parsed.rows.filter((r) => r.cacheUnsplit).length, inconsistent: parsed.rows.filter((r) => r.inconsistent).length, unpricedCalls: costReport.unpricedCalls, unpricedModels: costReport.unpricedModels,
  };
}

export interface GatewaySummaryRow {
  model: string;
  calls: number;
  /** Calls that carry a cost the gateway reported. */
  withReported: number;
  estimatedMicros: number;
  reportedMicros: number;
  /** Reported over estimated, minus one, as a fraction; null when nothing is reported. */
  gap: number | null;
}

/** What the gateway said against what the tokens come to at list price, model by model, over the calls that have both. */
export function gatewaySummary(db: Ledger): GatewaySummaryRow[] {
  const rows = db
    .prepare(
      `SELECT m.model model, COUNT(*) calls, SUM(CASE WHEN r.call_id IS NOT NULL THEN 1 ELSE 0 END) withReported,
              SUM(CASE WHEN r.call_id IS NOT NULL THEN COALESCE(c.total_micros, 0) ELSE 0 END) estimated, SUM(COALESCE(r.amount_micros, 0)) reported
       FROM model_call m JOIN session s ON s.session_id = m.session_id LEFT JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       LEFT JOIN call_reported_cost r ON r.call_id = m.call_id AND r.source = 'litellm' WHERE s.tool = 'litellm' GROUP BY m.model ORDER BY reported DESC, m.model`,
    )
    .all() as unknown as { model: string; calls: number; withReported: number; estimated: number; reported: number }[];
  return rows.map((r) => ({ model: r.model, calls: r.calls, withReported: r.withReported, estimatedMicros: r.estimated, reportedMicros: r.reported, gap: r.withReported === 0 || r.estimated === 0 ? null : r.reported / r.estimated - 1 }));
}
