import { createHash } from "node:crypto";

import type { Ledger } from "../ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../ledger/ingest.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";

/**
 * OpenTelemetry GenAI spans as a source (DF-022). An OTLP/JSON export of traces, one document or one per line, is read into calls: each
 * leaf span that made a model request and says what it used becomes one call, priced at list price from its tokens like any other.
 *
 * The rules, each one a choice that could be made the other way and is not hidden:
 *  - A span is a call only when it carries token counts. A span with none is a gap, never a zero.
 *  - Only the leaf counts. An agent or workflow span that carries a total of its children's usage is skipped when a descendant carries
 *    its own, so nothing is counted twice.
 *  - Spans of a trace that was not sampled (trace flags without the sampled bit) are left out, and counted.
 *  - Names are read in both generations: `gen_ai.provider.name` or `gen_ai.system`; `gen_ai.usage.input_tokens` or `prompt_tokens`;
 *    `gen_ai.usage.output_tokens` or `completion_tokens`; cache tokens under the dotted and the underscore spellings. The version of the
 *    GenAI conventions each exporter followed is not recorded in a span, and the specification was not checked here (NOT VERIFIED).
 *  - Whether cache tokens are part of the input count depends on the provider's convention: Anthropic's counts them apart; the others'
 *    include them, and then they are taken out of the input. When the cache count exceeds the input, it is read as apart.
 *  - A cost attribute is not standardised. A few spellings are read as the cost the exporter reported and stored beside the estimate.
 *  - Content (prompts, completions, tool arguments) is never read.
 */
export interface OtelCall {
  callId: string;
  traceId: string;
  spanId: string;
  startedAt: string;
  model: string;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  session: string;
  service: string | null;
  /** The cost the exporter reported, micro-dollars, when it said one. */
  reportedMicros: number | null;
  /** The task and outcome the Desk's own export carries, kept so that a round trip is whole. */
  taskId: string | null;
  outcomeState: string | null;
  inconsistent: boolean;
}

export interface OtelParse {
  spans: number;
  calls: OtelCall[];
  skipped: Record<string, number>;
  unsampled: number;
  /** Attribute names read as a cost the exporter reported, and any `gen_ai.*` name not recognised at all. */
  unknownGenAiAttributes: string[];
  format: "json" | "jsonl";
}

type Attrs = Map<string, string | number | boolean>;

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  startNs: string;
  flags: number | null;
  attrs: Attrs;
  service: string | null;
}

const INFERENCE_OPS = new Set(["chat", "text_completion", "generate_content", "completion", "completions", "responses", "invoke_model", "converse"]);

const KNOWN = new Set([
  "gen_ai.operation.name", "gen_ai.provider.name", "gen_ai.system", "gen_ai.request.model", "gen_ai.response.model", "gen_ai.response.id",
  "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens", "gen_ai.usage.prompt_tokens", "gen_ai.usage.completion_tokens", "gen_ai.usage.total_tokens",
  "gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cache_creation.input_tokens", "gen_ai.usage.cache_read_input_tokens", "gen_ai.usage.cache_creation_input_tokens",
  "gen_ai.conversation.id", "gen_ai.agent.name", "gen_ai.agent.id", "gen_ai.tool.name", "gen_ai.response.finish_reasons", "gen_ai.request.max_tokens", "gen_ai.request.temperature",
  "gen_ai.request.top_p", "gen_ai.request.stop_sequences", "gen_ai.output.type", "gen_ai.usage.reasoning.output_tokens", "gen_ai.usage.reasoning_tokens",
]);
/** Content-bearing names, never read, and not listed as unknown either. */
const CONTENT = /^gen_ai\.(prompt|completion|input\.messages|output\.messages|system_instructions|tool\.(call|definitions)|content)/;

const COST_ATTRS = ["desk.cost.reported_usd", "gen_ai.usage.cost", "llm.usage.cost", "gen_ai.cost.total", "gen_ai.usage.total_cost"] as const;

function attrValue(v: unknown): string | number | boolean | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o["stringValue"] === "string") return o["stringValue"];
  if (typeof o["intValue"] === "string" || typeof o["intValue"] === "number") {
    const n = Number(o["intValue"]);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof o["doubleValue"] === "number") return o["doubleValue"];
  if (typeof o["boolValue"] === "boolean") return o["boolValue"];
  return null;
}

function attrsOf(list: unknown): Attrs {
  const out: Attrs = new Map();
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    if (typeof a !== "object" || a === null) continue;
    const k = (a as { key?: unknown }).key;
    const v = attrValue((a as { value?: unknown }).value);
    if (typeof k === "string" && v !== null) out.set(k, v);
  }
  return out;
}

const str = (a: Attrs, ...names: string[]): string | null => {
  for (const n of names) {
    const v = a.get(n);
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
};

const count = (a: Attrs, ...names: string[]): number | null => {
  for (const n of names) {
    const v = a.get(n);
    const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isSafeInteger(x) && x >= 0) return x;
  }
  return null;
};

function documents(text: string): { docs: unknown[]; format: OtelParse["format"] } | string {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const trimmed = t.trim();
  if (trimmed === "") return "The file is empty.";
  try {
    return { docs: [JSON.parse(trimmed)], format: "json" };
  } catch {
    const docs: unknown[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        docs.push(JSON.parse(line));
      } catch {
        return "The file is neither one OTLP/JSON document nor one document per line.";
      }
    }
    return { docs, format: "jsonl" };
  }
}

function spansOf(doc: unknown): Span[] {
  const out: Span[] = [];
  const rs = typeof doc === "object" && doc !== null ? (doc as { resourceSpans?: unknown }).resourceSpans : undefined;
  if (!Array.isArray(rs)) return out;
  for (const r of rs) {
    if (typeof r !== "object" || r === null) continue;
    const resource = attrsOf((r as { resource?: { attributes?: unknown } }).resource?.attributes);
    const service = str(resource, "service.name");
    const scopes = (r as { scopeSpans?: unknown }).scopeSpans;
    if (!Array.isArray(scopes)) continue;
    for (const sc of scopes) {
      const list = typeof sc === "object" && sc !== null ? (sc as { spans?: unknown }).spans : undefined;
      if (!Array.isArray(list)) continue;
      for (const s of list) {
        if (typeof s !== "object" || s === null) continue;
        const o = s as Record<string, unknown>;
        if (typeof o["traceId"] !== "string" || typeof o["spanId"] !== "string") continue;
        const flags = typeof o["flags"] === "number" ? o["flags"] : null;
        out.push({
          traceId: o["traceId"],
          spanId: o["spanId"],
          parentSpanId: typeof o["parentSpanId"] === "string" ? o["parentSpanId"] : "",
          name: typeof o["name"] === "string" ? o["name"] : "",
          startNs: typeof o["startTimeUnixNano"] === "string" || typeof o["startTimeUnixNano"] === "number" ? String(o["startTimeUnixNano"]) : "",
          flags,
          attrs: attrsOf(o["attributes"]),
          service,
        });
      }
    }
  }
  return out;
}

const hasUsage = (a: Attrs): boolean => count(a, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens") !== null || count(a, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens") !== null;

export function parseOtel(text: string): OtelParse | string {
  const d = documents(text);
  if (typeof d === "string") return d;
  const spans = d.docs.flatMap(spansOf);
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const unknown = new Set<string>();
  // The tree of each trace, so that a span that totals its children is not counted with them.
  const parents = new Map<string, string>();
  for (const s of spans) parents.set(`${s.traceId}/${s.spanId}`, s.parentSpanId === "" ? "" : `${s.traceId}/${s.parentSpanId}`);
  const hasUsageBelow = new Set<string>();
  for (const s of spans) {
    if (!hasUsage(s.attrs)) continue;
    let up = parents.get(`${s.traceId}/${s.spanId}`) ?? "";
    for (let depth = 0; up !== "" && depth < 64; depth += 1) {
      hasUsageBelow.add(up);
      up = parents.get(up) ?? "";
    }
  }
  let unsampled = 0;
  const calls: OtelCall[] = [];
  const seen = new Set<string>();
  for (const s of spans) {
    for (const k of s.attrs.keys()) if (k.startsWith("gen_ai.") && !KNOWN.has(k) && !CONTENT.test(k)) unknown.add(k);
    const op = str(s.attrs, "gen_ai.operation.name");
    const isModelSpan = op !== null ? INFERENCE_OPS.has(op) : hasUsage(s.attrs) && str(s.attrs, "gen_ai.request.model", "gen_ai.response.model") !== null;
    if (!isModelSpan) continue;
    if (s.flags !== null && (s.flags & 1) === 0) { unsampled += 1; continue; }
    if (hasUsageBelow.has(`${s.traceId}/${s.spanId}`)) { skip("a span that totals the calls beneath it (counted once, at the leaf)"); continue; }
    const input = count(s.attrs, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens");
    const output = count(s.attrs, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens");
    if (input === null && output === null) { skip("no token counts (a gap, not a zero)"); continue; }
    const model = str(s.attrs, "gen_ai.response.model", "gen_ai.request.model");
    if (model === null) { skip("no model name"); continue; }
    const ns = s.startNs === "" ? NaN : Number(BigInt(s.startNs.replace(/\D/g, "") || "0") / 1_000_000n);
    if (!Number.isFinite(ns) || ns <= 0) { skip("no usable start time"); continue; }
    const key = `${s.traceId}/${s.spanId}`;
    if (seen.has(key)) { skip("the same span twice"); continue; }
    seen.add(key);
    const provider = str(s.attrs, "gen_ai.provider.name", "gen_ai.system");
    let inTok = input ?? 0;
    const read = count(s.attrs, "gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cache_read_input_tokens") ?? 0;
    const write = count(s.attrs, "gen_ai.usage.cache_creation.input_tokens", "gen_ai.usage.cache_creation_input_tokens") ?? 0;
    // Anthropic's input count leaves the cache out; other providers' include it. A cache count above the input count can only be apart.
    const apart = (provider !== null && provider.toLowerCase().includes("anthropic")) || read + write > inTok;
    if (!apart) inTok = Math.max(0, inTok - read - write);
    let reported: number | null = null;
    for (const name of COST_ATTRS) {
      const v = s.attrs.get(name);
      const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (Number.isFinite(x) && x >= 0 && x < 1e9) { reported = Math.round(x * 1_000_000); break; }
    }
    const session = str(s.attrs, "gen_ai.conversation.id", "session.id", "langfuse.session.id") ?? `trace-${s.traceId.slice(0, 16)}`;
    calls.push({
      callId: `otel:${s.traceId}:${s.spanId}`,
      traceId: s.traceId,
      spanId: s.spanId,
      startedAt: new Date(ns).toISOString(),
      model,
      provider,
      inputTokens: inTok,
      outputTokens: output ?? 0,
      cacheReadTokens: read,
      cacheWriteTokens: write,
      session,
      service: s.service,
      reportedMicros: reported,
      taskId: str(s.attrs, "desk.task.id"),
      outcomeState: str(s.attrs, "desk.outcome.state"),
      inconsistent: false,
    });
  }
  return { spans: spans.length, calls, skipped, unsampled, unknownGenAiAttributes: [...unknown].sort(), format: d.format };
}

export interface OtelImport {
  file: string;
  format: OtelParse["format"];
  spans: number;
  calls: number;
  callsNew: number;
  callsAlreadyHeld: number;
  skipped: Record<string, number>;
  unsampled: number;
  unknownGenAiAttributes: string[];
  withReportedCost: number;
  unpricedCalls: number;
  unpricedModels: Record<string, string>;
}

export function importOtel(db: Ledger, text: string, file: string, snapshot: PriceSnapshot, now: () => Date = () => new Date()): OtelImport | string {
  const parsed = parseOtel(text);
  if (typeof parsed === "string") return parsed;
  recordSnapshot(db, snapshot);
  const observed = now().toISOString();
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const putSource = db.prepare(
    `INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('otel', ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET size_bytes = excluded.size_bytes, offset_bytes = excluded.offset_bytes, last_ingested_at = excluded.last_ingested_at`,
  );
  const putSession = db.prepare("INSERT OR IGNORE INTO session (session_id, tool, project_path, git_branch, tool_version) VALUES (?, 'otel', ?, NULL, NULL)");
  const putCall = db.prepare(
    `INSERT OR IGNORE INTO model_call (call_id, session_id, request_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens,
       cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, service_tier, speed,
       stop_reason, is_api_error, tool_names, block_lines, usage_conflicts, source_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, 0, 'assumed-5m', 0, NULL, NULL, NULL, 0, '[]', 1, 0, ?)`,
  );
  const putReported = db.prepare("INSERT OR REPLACE INTO call_reported_cost (call_id, source, currency, amount_micros, observed_at) VALUES (?, 'otel', 'USD', ?, ?)");
  const inserted = new Set<string>();
  const sessions = new Set<string>();
  let held = 0;
  let withReported = 0;
  db.exec("BEGIN");
  try {
    const label = `otel:${digest}`;
    putSource.run(label, Buffer.byteLength(text), Buffer.byteLength(text), observed);
    const sourceId = (db.prepare("SELECT id FROM ingest_source WHERE path = ?").get(label) as { id: number }).id;
    for (const c of parsed.calls) {
      const session = `otel:${c.session}`;
      if (!sessions.has(session)) {
        putSession.run(session, c.service);
        sessions.add(session);
      }
      const res = putCall.run(c.callId, session, c.spanId, c.startedAt, c.model, c.inputTokens, c.outputTokens, c.cacheReadTokens, c.cacheWriteTokens, sourceId);
      if (Number(res.changes) > 0) inserted.add(c.callId);
      else held += 1;
      if (c.reportedMicros !== null) {
        putReported.run(c.callId, c.reportedMicros, observed);
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
     VALUES ('otel', ?, ?, 1, ?, ?, 0, 0, 0, 0)`,
  ).run(observed, now().toISOString(), parsed.spans, inserted.size);
  return { file, format: parsed.format, spans: parsed.spans, calls: parsed.calls.length, callsNew: inserted.size, callsAlreadyHeld: held, skipped: parsed.skipped, unsampled: parsed.unsampled, unknownGenAiAttributes: parsed.unknownGenAiAttributes, withReportedCost: withReported, unpricedCalls: costReport.unpricedCalls, unpricedModels: costReport.unpricedModels };
}

export function renderOtelImport(r: OtelImport): string {
  const n = (x: number): string => x.toLocaleString("en-US");
  const out = [`Read ${n(r.spans)} span${r.spans === 1 ? "" : "s"} from ${r.file} (OTLP/${r.format === "json" ? "JSON" : "JSON Lines"}): ${n(r.callsNew)} new call${r.callsNew === 1 ? "" : "s"}, ${n(r.callsAlreadyHeld)} already held.`];
  const skipped = Object.entries(r.skipped);
  if (skipped.length > 0) out.push(`  Not counted as calls: ${skipped.map(([why, c]) => `${n(c)} ${why}`).join("; ")}.`);
  if (r.unsampled > 0) out.push(`  ${n(r.unsampled)} span${r.unsampled === 1 ? "" : "s"} of traces that were not sampled left out.`);
  if (r.withReportedCost > 0) out.push(`  ${n(r.withReportedCost)} call${r.withReportedCost === 1 ? "" : "s"} carried a cost the exporter reported: kept beside the list-price estimate, replacing nothing.`);
  if (r.unpricedCalls > 0) out.push(`  ${n(r.unpricedCalls)} call${r.unpricedCalls === 1 ? " is" : "s are"} on a model with no price (${Object.keys(r.unpricedModels).slice(0, 5).join(", ")}): tokens counted, no dollars invented.`);
  if (r.unknownGenAiAttributes.length > 0) out.push(`  gen_ai attributes not recognised and ignored: ${r.unknownGenAiAttributes.join(", ")}.`);
  out.push("  Prompts and completions are never read.");
  return out.join("\n");
}
