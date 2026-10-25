/**
 * The open ledger format, `desk.events/1` (DF-063): what the Desk keeps about each model call, as JSON Lines that any other tool can read or write. A file is a
 * header, then sessions, then calls, one JSON object to a line. It holds facts a tool observed (when, which model, how many tokens of each kind, what it reported for
 * cost) and never an estimate: a reader prices the tokens against a price list of its own, as the Desk does. A field that is not known is left out or null, never zero.
 *
 * The reader is strict. A line that is not valid is reported with its line number and the field, and a file with any invalid line is refused whole, because a ledger
 * that quietly drops the calls it could not read understates what was spent.
 */
export const EVENTS_SCHEMA = "desk.events/1";

/** Tool ids the Desk reads natively or writes itself. Events claiming one of these are refused: importing them would count a call twice. */
export const NATIVE_TOOLS: readonly string[] = ["claude_code", "codex", "opencode", "litellm", "otel", "desk", "statusline", "gateway"];

export const LIMITS = {
  /** The longest line, in bytes. */
  lineBytes: 65_536,
  /** The most records in a file; a larger export is split. */
  records: 1_000_000,
  idChars: 200,
  textChars: 1_024,
  toolNames: 100,
  toolNameChars: 64,
  tokens: 10_000_000_000,
  /** Timestamps outside this span are refused as implausible, not because they are in the future. */
  tsMin: "2015-01-01T00:00:00.000Z",
  tsMax: "2100-01-01T00:00:00.000Z",
  problemsListed: 50,
} as const;

export interface HeaderRecord {
  schema: typeof EVENTS_SCHEMA;
  type: "header";
  /** Who wrote the file, as an id: `aider`, `my-gateway`. */
  tool: string;
  tool_version?: string | null;
  produced_at?: string | null;
}

export interface SessionRecord {
  type: "session";
  session_id: string;
  /** The tool the session belongs to; the header's tool when left out. */
  tool?: string | null;
  project_path?: string | null;
  git_branch?: string | null;
  tool_version?: string | null;
}

export interface CallRecord {
  type: "call";
  call_id: string;
  session_id: string;
  /** When the call was made, ISO 8601 in UTC with a trailing Z. */
  ts: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  request_id?: string | null;
  /** Tokens spent reasoning that are already inside `output_tokens`; informational, never added to it. */
  reasoning_tokens?: number | null;
  cache_read_tokens?: number | null;
  /** Cache writes when the tool does not say how long they are kept; priced as 5-minute writes and marked as assumed. Not allowed beside the two below. */
  cache_write_tokens?: number | null;
  cache_write_5m_tokens?: number | null;
  cache_write_1h_tokens?: number | null;
  service_tier?: string | null;
  speed?: string | null;
  stop_reason?: string | null;
  is_sidechain?: boolean | null;
  is_api_error?: boolean | null;
  tool_names?: string[] | null;
  /** What the tool itself said the call cost, in millionths of `reported_currency`. Kept beside the estimate, never in place of it. */
  reported_cost_micros?: number | null;
  reported_currency?: string | null;
}

export type EventRecord = HeaderRecord | SessionRecord | CallRecord;

export interface Problem {
  line: number;
  field: string | null;
  message: string;
}

/** The key order of each record type, so that a file written twice is the same bytes. */
export const KEY_ORDER = {
  header: ["schema", "type", "tool", "tool_version", "produced_at"],
  session: ["type", "session_id", "tool", "project_path", "git_branch", "tool_version"],
  call: [
    "type", "call_id", "session_id", "ts", "model", "input_tokens", "output_tokens", "request_id", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens",
    "cache_write_5m_tokens", "cache_write_1h_tokens", "service_tier", "speed", "stop_reason", "is_sidechain", "is_api_error", "tool_names", "reported_cost_micros", "reported_currency",
  ],
} as const;

const REQUIRED = {
  header: ["schema", "type", "tool"],
  session: ["type", "session_id"],
  call: ["type", "call_id", "session_id", "ts", "model", "input_tokens", "output_tokens"],
} as const;

type Kind = keyof typeof KEY_ORDER;

const TOOL_ID = /^[a-z][a-z0-9_-]{1,39}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const CURRENCY = /^[A-Z]{3}$/;

function text(v: unknown, max: number, field: string, out: string[], opts: { nullable?: boolean; nonEmpty?: boolean } = {}): void {
  if (v === null && opts.nullable) return;
  if (typeof v !== "string") return void out.push(`${field} must be text${opts.nullable ? " or null" : ""}`);
  if (opts.nonEmpty && v.length === 0) return void out.push(`${field} must not be empty`);
  if (v.length > max) return void out.push(`${field} is ${v.length} characters; the most is ${max}`);
  if (CONTROL.test(v)) out.push(`${field} has a control character in it`);
}

function count(v: unknown, field: string, out: string[], nullable = true): void {
  if (v === null && nullable) return;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > LIMITS.tokens) out.push(`${field} must be a whole number from 0 to ${LIMITS.tokens.toLocaleString("en-US")}${nullable ? " or null" : ""}`);
}

/** The problems with one parsed record of a known kind, as plain sentences naming the field; empty when it is valid. */
export function checkRecord(kind: Kind, rec: Record<string, unknown>): { field: string | null; message: string }[] {
  const msgs: string[] = [];
  const keys = KEY_ORDER[kind] as readonly string[];
  for (const k of Object.keys(rec)) if (!keys.includes(k)) msgs.push(`${k} is not a field of a ${kind} record (known: ${keys.join(", ")})`);
  for (const k of REQUIRED[kind] as readonly string[]) if (rec[k] === undefined) msgs.push(`${k} is required`);
  const has = (k: string): boolean => rec[k] !== undefined;
  if (kind === "header") {
    if (has("schema") && rec["schema"] !== EVENTS_SCHEMA) {
      const m = /^desk\.events\/(\d+)$/.exec(String(rec["schema"]));
      msgs.push(m && Number(m[1]) > 1 ? `schema ${String(rec["schema"])} is newer than this reader understands (${EVENTS_SCHEMA}); update the Desk` : `schema must be "${EVENTS_SCHEMA}"`);
    }
    if (has("tool") && (typeof rec["tool"] !== "string" || !TOOL_ID.test(rec["tool"]))) msgs.push("tool must be an id of 2 to 40 lowercase letters, digits, hyphens and underscores, starting with a letter");
    if (has("tool_version")) text(rec["tool_version"], 64, "tool_version", msgs, { nullable: true });
    if (has("produced_at") && rec["produced_at"] !== null) {
      if (typeof rec["produced_at"] !== "string" || !TS.test(rec["produced_at"]) || Number.isNaN(Date.parse(rec["produced_at"]))) msgs.push("produced_at must be an ISO 8601 UTC time ending in Z, or null");
    }
  } else if (kind === "session") {
    if (has("session_id")) text(rec["session_id"], LIMITS.idChars, "session_id", msgs, { nonEmpty: true });
    if (has("tool") && rec["tool"] !== null && (typeof rec["tool"] !== "string" || !TOOL_ID.test(rec["tool"]))) msgs.push("tool must be an id of 2 to 40 lowercase letters, digits, hyphens and underscores, or null");
    for (const k of ["project_path", "git_branch"]) if (has(k)) text(rec[k], LIMITS.textChars, k, msgs, { nullable: true });
    if (has("tool_version")) text(rec["tool_version"], 64, "tool_version", msgs, { nullable: true });
  } else {
    for (const k of ["call_id", "session_id"]) if (has(k)) text(rec[k], LIMITS.idChars, k, msgs, { nonEmpty: true });
    if (has("request_id")) text(rec["request_id"], LIMITS.idChars, "request_id", msgs, { nullable: true });
    if (has("model")) text(rec["model"], 200, "model", msgs, { nonEmpty: true });
    if (has("ts")) {
      const t = rec["ts"];
      if (typeof t !== "string" || !TS.test(t) || Number.isNaN(Date.parse(t))) msgs.push("ts must be an ISO 8601 UTC time ending in Z, such as 2026-10-20T10:00:00.000Z");
      else if (Date.parse(t) < Date.parse(LIMITS.tsMin) || Date.parse(t) >= Date.parse(LIMITS.tsMax)) msgs.push(`ts ${t} is outside ${LIMITS.tsMin.slice(0, 4)} to ${LIMITS.tsMax.slice(0, 4)}, which no real call is`);
    }
    count(rec["input_tokens"], "input_tokens", msgs, false);
    count(rec["output_tokens"], "output_tokens", msgs, false);
    for (const k of ["reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens"]) if (has(k)) count(rec[k], k, msgs);
    if (rec["cache_write_tokens"] != null && (rec["cache_write_5m_tokens"] != null || rec["cache_write_1h_tokens"] != null)) msgs.push("cache_write_tokens and the 5m/1h split are both given; give one");
    if (typeof rec["reasoning_tokens"] === "number" && typeof rec["output_tokens"] === "number" && rec["reasoning_tokens"] > rec["output_tokens"]) msgs.push("reasoning_tokens is more than output_tokens, but it is a part of it");
    for (const k of ["service_tier", "speed", "stop_reason"]) if (has(k)) text(rec[k], 64, k, msgs, { nullable: true });
    for (const k of ["is_sidechain", "is_api_error"]) if (has(k) && rec[k] !== null && typeof rec[k] !== "boolean") msgs.push(`${k} must be true, false or null`);
    if (has("tool_names") && rec["tool_names"] !== null) {
      const t = rec["tool_names"];
      if (!Array.isArray(t) || t.length > LIMITS.toolNames) msgs.push(`tool_names must be a list of at most ${LIMITS.toolNames} names, or null`);
      else for (const [i, n] of t.entries()) text(n, LIMITS.toolNameChars, `tool_names[${i}]`, msgs, { nonEmpty: true });
    }
    if (has("reported_cost_micros")) count(rec["reported_cost_micros"], "reported_cost_micros", msgs);
    if (has("reported_currency") && rec["reported_currency"] !== null && (typeof rec["reported_currency"] !== "string" || !CURRENCY.test(rec["reported_currency"]))) msgs.push("reported_currency must be a three-letter code such as USD, or null");
    if (rec["reported_cost_micros"] != null && rec["reported_currency"] == null) msgs.push("reported_cost_micros needs reported_currency, because the Desk does not guess a currency");
  }
  return msgs.map((message) => {
    const m = /^([a-z_0-9]+(?:\[\d+\])?)\b/.exec(message);
    return { field: m?.[1] ?? null, message };
  });
}

export interface ParsedEvents {
  header: HeaderRecord | null;
  sessions: SessionRecord[];
  calls: CallRecord[];
  problems: Problem[];
  /** Problems beyond the ones listed. */
  moreProblems: number;
  lines: number;
}

/** Reads a file line by line and keeps what it finds, the problems with line numbers, and nothing else. */
export class EventReader {
  header: HeaderRecord | null = null;
  readonly sessions: SessionRecord[] = [];
  readonly calls: CallRecord[] = [];
  readonly problems: Problem[] = [];
  moreProblems = 0;
  lines = 0;
  private records = 0;
  private readonly callIds = new Set<string>();
  private readonly sessionIds = new Set<string>();

  private problem(line: number, field: string | null, message: string): void {
    if (this.problems.length < LIMITS.problemsListed) this.problems.push({ line, field, message });
    else this.moreProblems += 1;
  }

  feed(raw: string, lineNo: number): void {
    this.lines = Math.max(this.lines, lineNo);
    if (raw.trim() === "") return;
    if (Buffer.byteLength(raw) > LIMITS.lineBytes) return this.problem(lineNo, null, `the line is longer than ${LIMITS.lineBytes.toLocaleString("en-US")} bytes`);
    let rec: unknown;
    try {
      rec = JSON.parse(raw);
    } catch {
      return this.problem(lineNo, null, "the line is not valid JSON");
    }
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return this.problem(lineNo, null, "the line is not a JSON object");
    const o = rec as Record<string, unknown>;
    const type = o["type"];
    if (type !== "header" && type !== "session" && type !== "call") return this.problem(lineNo, "type", `type must be "header", "session" or "call", not ${JSON.stringify(type)}`);
    if (this.header === null && type !== "header") {
      this.problem(lineNo, "type", `the first record must be the header ({"schema":"${EVENTS_SCHEMA}","type":"header","tool":"..."}), not a ${type}`);
      return;
    }
    const found = checkRecord(type, o);
    for (const p of found) this.problem(lineNo, p.field, p.message);
    if (found.length > 0) return;
    this.records += 1;
    if (this.records > LIMITS.records) return this.problem(lineNo, null, `the file holds more than ${LIMITS.records.toLocaleString("en-US")} records; split it`);
    if (type === "header") {
      if (this.header !== null) return this.problem(lineNo, "type", "a second header; a file has one");
      this.header = o as unknown as HeaderRecord;
    } else if (type === "session") {
      const s = o as unknown as SessionRecord;
      if (this.sessionIds.has(s.session_id)) return this.problem(lineNo, "session_id", `session ${s.session_id} is described twice`);
      this.sessionIds.add(s.session_id);
      this.sessions.push(s);
    } else {
      const c = o as unknown as CallRecord;
      if (this.callIds.has(c.call_id)) return this.problem(lineNo, "call_id", `call ${c.call_id} appears twice`);
      this.callIds.add(c.call_id);
      this.calls.push(c);
    }
  }

  finish(): ParsedEvents {
    if (this.header === null && this.problems.length === 0) this.problem(1, null, "the file is empty; it needs a header record");
    return { header: this.header, sessions: this.sessions, calls: this.calls, problems: this.problems, moreProblems: this.moreProblems, lines: this.lines };
  }
}

/** Read a whole text. Used for small inputs (an adapter's output, a fixture); a big file is read by `readEventsFile`. */
export function parseEvents(textIn: string): ParsedEvents {
  const r = new EventReader();
  const lines = textIn.split(/\r?\n/);
  lines.forEach((l, i) => r.feed(l, i + 1));
  return r.finish();
}

/** One record as a line, with its keys in the fixed order and nothing left undefined, so the same record is always the same bytes. */
export function eventLine(rec: EventRecord): string {
  const order = KEY_ORDER[rec.type] as readonly string[];
  const o = rec as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of order) if (o[k] !== undefined) out[k] = o[k];
  return JSON.stringify(out);
}

/** A full file: the header, the sessions, then the calls in time order. */
export function formatEvents(header: HeaderRecord, sessions: readonly SessionRecord[], calls: readonly CallRecord[]): string {
  const ordered = [...calls].sort((a, b) => a.ts.localeCompare(b.ts) || a.call_id.localeCompare(b.call_id));
  return [header, ...[...sessions].sort((a, b) => a.session_id.localeCompare(b.session_id)), ...ordered].map((r) => eventLine(r)).join("\n") + "\n";
}

/** The JSON Schema of one record type, written from the same tables the reader uses, for tools in other languages. */
export function jsonSchema(): Record<string, unknown> {
  const str = (max: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: "string", maxLength: max, ...extra });
  const nstr = (max: number): Record<string, unknown> => ({ type: ["string", "null"], maxLength: max });
  const cnt = (nullable: boolean): Record<string, unknown> => ({ type: nullable ? ["integer", "null"] : "integer", minimum: 0, maximum: LIMITS.tokens });
  const ts = { type: "string", pattern: TS.source, description: "ISO 8601 UTC, ending in Z" };
  const toolId = { type: "string", pattern: TOOL_ID.source };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: EVENTS_SCHEMA,
    description: "One record of a desk.events/1 file (JSON Lines). The first record is the header.",
    oneOf: [
      { title: "header", type: "object", additionalProperties: false, required: [...REQUIRED.header], properties: { schema: { const: EVENTS_SCHEMA }, type: { const: "header" }, tool: toolId, tool_version: nstr(64), produced_at: { ...ts, type: ["string", "null"] } } },
      {
        title: "session", type: "object", additionalProperties: false, required: [...REQUIRED.session],
        properties: { type: { const: "session" }, session_id: str(LIMITS.idChars, { minLength: 1 }), tool: { ...toolId, type: ["string", "null"] }, project_path: nstr(LIMITS.textChars), git_branch: nstr(LIMITS.textChars), tool_version: nstr(64) },
      },
      {
        title: "call", type: "object", additionalProperties: false, required: [...REQUIRED.call],
        properties: {
          type: { const: "call" }, call_id: str(LIMITS.idChars, { minLength: 1 }), session_id: str(LIMITS.idChars, { minLength: 1 }), ts, model: str(200, { minLength: 1 }),
          input_tokens: cnt(false), output_tokens: cnt(false), request_id: nstr(LIMITS.idChars), reasoning_tokens: cnt(true), cache_read_tokens: cnt(true), cache_write_tokens: cnt(true),
          cache_write_5m_tokens: cnt(true), cache_write_1h_tokens: cnt(true), service_tier: nstr(64), speed: nstr(64), stop_reason: nstr(64), is_sidechain: { type: ["boolean", "null"] },
          is_api_error: { type: ["boolean", "null"] }, tool_names: { type: ["array", "null"], maxItems: LIMITS.toolNames, items: str(LIMITS.toolNameChars, { minLength: 1 }) },
          reported_cost_micros: cnt(true), reported_currency: { type: ["string", "null"], pattern: CURRENCY.source },
        },
      },
    ],
  };
}
