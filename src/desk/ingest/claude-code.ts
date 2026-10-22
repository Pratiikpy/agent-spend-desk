/**
 * Claude Code local log adapter (spec 5.2). Written from the structure of real session logs
 * (checked 2026-10-22 on a 95,000-call log): one API call is written as several lines, one
 * per content block (`apiBlockIndex` 0, 1, ...), all with the same `message.id` and identical
 * `usage`. Counting every line would multiply the cost, so a call is keyed by `message.id`
 * and merged, never summed. Message content is never read into the ledger; only counts,
 * model, timing and tool names are kept.
 */
export interface ParsedCall {
  callId: string;
  requestId: string | null;
  sessionId: string;
  ts: string;
  model: string;
  isSidechain: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  /** `reported` when cache_creation splits 5m and 1h; `assumed-5m` when only the total exists. */
  cacheTtlBasis: "reported" | "assumed-5m";
  /** True when the 5m and 1h parts did not add up to the reported total. */
  cacheSplitMismatch: boolean;
  serviceTier: string | null;
  speed: string | null;
  stopReason: string | null;
  isApiError: boolean;
  toolNames: string[];
  cwd: string | null;
  gitBranch: string | null;
  toolVersion: string | null;
}

export type LineOutcome =
  | { kind: "call"; call: ParsedCall }
  | { kind: "ignored" }
  | { kind: "malformed"; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseClaudeCodeLine(line: string): LineOutcome {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { kind: "ignored" };
  let d: unknown;
  try {
    d = JSON.parse(trimmed);
  } catch {
    return { kind: "malformed", reason: "invalid-json" };
  }
  if (!isObject(d)) return { kind: "malformed", reason: "not-an-object" };
  if (d["type"] !== "assistant") return { kind: "ignored" };
  const message = d["message"];
  if (!isObject(message)) return { kind: "malformed", reason: "assistant-without-message" };
  const usage = message["usage"];
  if (!isObject(usage)) return { kind: "ignored" };

  const callId = text(message["id"]);
  if (!callId) return { kind: "malformed", reason: "assistant-without-message-id" };
  const sessionId = text(d["sessionId"]) ?? text(d["session_id"]);
  if (!sessionId) return { kind: "malformed", reason: "assistant-without-session" };
  const ts = text(d["timestamp"]);
  if (!ts || Number.isNaN(Date.parse(ts))) return { kind: "malformed", reason: "assistant-without-timestamp" };
  const model = text(message["model"]);
  if (!model) return { kind: "malformed", reason: "assistant-without-model" };

  const cc = usage["cache_creation"];
  let cacheWrite5m: number;
  let cacheWrite1h: number;
  let basis: ParsedCall["cacheTtlBasis"];
  let mismatch = false;
  const totalWrite = count(usage["cache_creation_input_tokens"]);
  if (isObject(cc)) {
    cacheWrite5m = count(cc["ephemeral_5m_input_tokens"]);
    cacheWrite1h = count(cc["ephemeral_1h_input_tokens"]);
    basis = "reported";
    mismatch = cacheWrite5m + cacheWrite1h !== totalWrite;
  } else {
    cacheWrite5m = totalWrite;
    cacheWrite1h = 0;
    basis = "assumed-5m";
  }

  const details = usage["output_tokens_details"];
  const reasoning = isObject(details) ? count(details["thinking_tokens"]) : 0;

  const toolNames: string[] = [];
  const content = message["content"];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isObject(block) && block["type"] === "tool_use") {
        const name = text(block["name"]);
        if (name) toolNames.push(name);
      }
    }
  }

  return {
    kind: "call",
    call: {
      callId,
      requestId: text(d["requestId"]),
      sessionId,
      ts,
      model,
      isSidechain: d["isSidechain"] === true,
      inputTokens: count(usage["input_tokens"]),
      outputTokens: count(usage["output_tokens"]),
      reasoningTokens: reasoning,
      cacheReadTokens: count(usage["cache_read_input_tokens"]),
      cacheWrite5mTokens: cacheWrite5m,
      cacheWrite1hTokens: cacheWrite1h,
      cacheTtlBasis: basis,
      cacheSplitMismatch: mismatch,
      serviceTier: text(usage["service_tier"]),
      speed: text(usage["speed"]),
      stopReason: text(message["stop_reason"]),
      isApiError: d["isApiErrorMessage"] === true,
      toolNames,
      cwd: text(d["cwd"]),
      gitBranch: text(d["gitBranch"]),
      toolVersion: text(d["version"]),
    },
  };
}
