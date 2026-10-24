import { declaredFetch, destination, EgressRefused } from "../../desk/security/net.ts";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NULL_TRACE, type Trace } from "../../desk/agents/trace.ts";

/**
 * The one door to Zetaris (spec 13.1, D-032). Every organisational source reaches the Desk as rows from one SQL
 * statement run on the local Zetaris instance over its REST route, as verified on 2026-10-16 and 2026-10-22
 * (docs/sponsors/zetaris-local-setup.md): POST /sql-editor/sqls/run with a bearer key, X-Org-ID, X-Request-ID and
 * a body of exactly {queryId, sql, source: "SqlEditor", limit}. Values come back as strings.
 *
 * Three ways a result is served, and each row set says which:
 *   live      the query ran on the local Zetaris instance now;
 *   cassette  the response was recorded from a real live run and is replayed byte for byte (SAMPLE_MODE);
 *   fallback  Zetaris was down or not configured: there are no rows, and the caller must say so.
 */
export type ServedFrom = "live" | "cassette" | "fallback";

export interface SiloRows {
  headers: string[];
  rows: string[][];
  total: number;
  servedFrom: Exclude<ServedFrom, "fallback">;
  /** Hash of the statement and of the response, so a trace line can be checked against the data. */
  reqHash: string;
  respHash: string;
  /** For a cassette, when the live response was recorded. */
  recordedAt?: string;
}

export type SiloErrorKind = "not_configured" | "unreachable" | "timeout" | "unauthorized" | "rejected" | "malformed" | "truncated" | "cassette_miss";

export class SiloError extends Error {
  constructor(readonly kind: SiloErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "SiloError";
  }
}

export interface ZetarisConfig {
  restUrl: string;
  apiKey: string;
  orgId: string;
  /** Spec 15.6: live when the instance answers within 15 s. */
  timeoutMs?: number;
  /** Most rows one statement may return. A result that reports more rows than it carries is an error, never a partial answer. */
  limit?: number;
  fetchImpl?: typeof fetch;
  /** `local` allows only an instance on this machine. */
  profile?: "standard" | "local";
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_LIMIT = 5_000;

/** Statements are one per call and take no trailing semicolon (verified rule of the Lightning dialect). */
export function normaliseSql(sql: string): string {
  return sql.replace(/[\s;]+$/, "").trim();
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Read the settings from the environment. Returns null when any of the three is missing; never throws and never prints a value. */
export function configFromEnv(env: Record<string, string | undefined>): ZetarisConfig | null {
  const restUrl = env["ZETARIS_REST_URL"];
  const apiKey = env["ZETARIS_API_KEY"];
  const orgId = env["ZETARIS_ORG_ID"];
  if (!restUrl || !apiKey || !orgId) return null;
  return { restUrl, apiKey, orgId, ...(env["DESK_MODEL_PROFILE"]?.trim().toLowerCase() === "local" ? { profile: "local" as const } : {}) };
}

function scrub(text: string, cfg: ZetarisConfig): string {
  return text.split(cfg.apiKey).join("(key)");
}

/** Run one statement on the live instance. Throws SiloError; the message never contains the key. */
export async function runLive(cfg: ZetarisConfig, sql: string): Promise<SiloRows> {
  const statement = normaliseSql(sql);
  if (statement.length === 0) throw new SiloError("rejected", "empty statement");
  const limit = cfg.limit ?? DEFAULT_LIMIT;
  const declared = destination("zetaris", cfg.restUrl, "read-only SQL statements over the invoice, CI and roster silos", "ZETARIS_REST_URL");
  const doFetch = cfg.fetchImpl ?? declaredFetch(declared === null ? [] : [declared], cfg.profile === undefined ? {} : { profile: cfg.profile });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(`${cfg.restUrl.replace(/\/+$/, "")}/sql-editor/sqls/run`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "X-Org-ID": cfg.orgId, "X-Request-ID": randomUUID(), "Content-Type": "application/json" },
      body: JSON.stringify({ queryId: randomUUID(), sql: statement, source: "SqlEditor", limit }),
    });
  } catch (e) {
    if (e instanceof EgressRefused) throw new SiloError("unreachable", scrub(e.message, cfg));
    const aborted = (e as Error).name === "AbortError";
    throw new SiloError(aborted ? "timeout" : "unreachable", scrub(aborted ? "Zetaris did not answer in time" : `Zetaris is not reachable: ${(e as Error).message}`, cfg));
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) throw new SiloError("unauthorized", `Zetaris refused the key (HTTP ${res.status})`, res.status);
  if (res.status >= 400) throw new SiloError("rejected", scrub(`Zetaris rejected the statement (HTTP ${res.status}): ${text.slice(0, 300)}`, cfg), res.status);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SiloError("malformed", "Zetaris returned something that is not JSON", res.status);
  }
  return toRows(body, statement);
}

function toRows(body: unknown, statement: string): SiloRows {
  const o = body as { headers?: unknown; data?: unknown; total?: unknown };
  if (!o || !Array.isArray(o.headers) || !Array.isArray(o.data) || !o.headers.every((h) => typeof h === "string") || !o.data.every((r) => Array.isArray(r))) {
    throw new SiloError("malformed", "Zetaris response has no headers and data arrays");
  }
  const headers = o.headers as string[];
  const rows = (o.data as unknown[][]).map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v))));
  if (rows.some((r) => r.length !== headers.length)) throw new SiloError("malformed", "a row does not match the header width");
  const total = typeof o.total === "number" ? o.total : rows.length;
  if (total > rows.length) throw new SiloError("truncated", `Zetaris reports ${total} rows but returned ${rows.length}; narrow the statement rather than use a partial answer`);
  return { headers, rows, total, servedFrom: "live", reqHash: `sha256:${sha(statement)}`, respHash: `sha256:${sha(JSON.stringify({ headers, rows }))}` };
}

// ---- cassettes ----------------------------------------------------------------------------------------------

interface CassetteFile {
  sql: string;
  recordedAt: string;
  headers: string[];
  rows: string[][];
  total: number;
}

export function cassettePath(dir: string, sql: string): string {
  return join(dir, `zetaris-${sha(normaliseSql(sql)).slice(0, 32)}.json`);
}

export function writeCassette(dir: string, sql: string, rows: SiloRows, recordedAt = new Date().toISOString()): string {
  mkdirSync(dir, { recursive: true });
  const file: CassetteFile = { sql: normaliseSql(sql), recordedAt, headers: rows.headers, rows: rows.rows, total: rows.total };
  const path = cassettePath(dir, sql);
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  return path;
}

export function readCassette(dir: string, sql: string): SiloRows {
  const path = cassettePath(dir, sql);
  if (!existsSync(path)) throw new SiloError("cassette_miss", `no recording for this statement (${sha(normaliseSql(sql)).slice(0, 12)}). Record it with a live run: desk silos --record`);
  const f = JSON.parse(readFileSync(path, "utf8")) as CassetteFile;
  const statement = normaliseSql(sql);
  return { headers: f.headers, rows: f.rows, total: f.total, servedFrom: "cassette", reqHash: `sha256:${sha(statement)}`, respHash: `sha256:${sha(JSON.stringify({ headers: f.headers, rows: f.rows }))}`, recordedAt: f.recordedAt };
}

// ---- the serving rule ---------------------------------------------------------------------------------------

export interface ServeOptions {
  /** SAMPLE_MODE: cassettes only, no network. */
  sample: boolean;
  cassetteDir: string;
  /** Write each live response as a cassette. */
  record: boolean;
  /** Null when the settings are absent. */
  config: ZetarisConfig | null;
  /** Switch Zetaris off on purpose, to show what the answer is without it. */
  disabled?: boolean;
  trace?: Trace;
}

export interface Served {
  /** Null means fallback: there are no rows and the caller must degrade and say so. */
  result: SiloRows | null;
  servedFrom: ServedFrom;
  reason?: string;
}

/**
 * Serve one statement under the three-mode rule. A failure is never an exception for the caller: it is a
 * `fallback` with the reason, and the trace line says so. What the fallback changes is the caller's job to show.
 */
export async function serve(sql: string, o: ServeOptions): Promise<Served> {
  const trace = o.trace ?? NULL_TRACE;
  const emit = (servedFrom: ServedFrom, extra: Record<string, unknown>): void =>
    trace.emit({ event: "desk.ingest", why: "computed", detail: { port: "silo", op: "zetaris.sql", servedFrom, ...extra } });
  const statement = normaliseSql(sql);
  const reqHash = `sha256:${sha(statement)}`;
  if (o.disabled) {
    emit("fallback", { reqHash, reason: "switched off" });
    return { result: null, servedFrom: "fallback", reason: "Zetaris switched off" };
  }
  try {
    if (o.sample) {
      const rows = readCassette(o.cassetteDir, statement);
      emit("cassette", { reqHash, respHash: rows.respHash, rows: rows.rows.length, recordedAt: rows.recordedAt });
      return { result: rows, servedFrom: "cassette" };
    }
    if (!o.config) throw new SiloError("not_configured", "ZETARIS_REST_URL, ZETARIS_API_KEY and ZETARIS_ORG_ID are not all set");
    const rows = await runLive(o.config, statement);
    if (o.record) writeCassette(o.cassetteDir, statement, rows);
    emit("live", { reqHash, respHash: rows.respHash, rows: rows.rows.length });
    return { result: rows, servedFrom: "live" };
  } catch (e) {
    if (!(e instanceof SiloError)) throw e;
    emit("fallback", { reqHash, reason: e.kind, message: e.message });
    return { result: null, servedFrom: "fallback", reason: `${e.kind}: ${e.message}` };
  }
}
