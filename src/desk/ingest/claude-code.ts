/**
 * Claude Code local log adapter (spec 5.2). Written from the structure of real session logs
 * (checked 2026-10-22 on a 95,000-call log): one API call is written as several lines, one
 * per content block (`apiBlockIndex` 0, 1, ...), all with the same `message.id` and identical
 * `usage`. Counting every line would multiply the cost, so a call is keyed by `message.id`
 * and merged, never summed. Message content is never read into the ledger; only counts,
 * model, timing and tool names are kept.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "../../runtime/canonical.ts";
import type { Json } from "../../runtime/json.ts";

export interface ParsedToolUse {
  toolUseId: string;
  name: string;
  /** First 16 hex characters of the SHA-256 of the canonical JSON of the tool input. The input itself is never stored. */
  inputHash: string;
  /** For file-editing tools only: the file the tool wrote to, kept in the local ledger to link a session to commits. */
  editedPath?: string;
}

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
  toolUses: ParsedToolUse[];
  cwd: string | null;
  gitBranch: string | null;
  toolVersion: string | null;
}

export interface ParsedToolResult {
  toolUseId: string;
  sessionId: string;
  ts: string;
  isError: boolean;
  /** Length in characters of the text of the result; images and other blocks count as zero. */
  resultChars: number;
}

export interface ParsedHumanPrompt {
  promptId: string;
  sessionId: string;
  ts: string;
}

/**
 * Claude Code writes a `cost-state` line into the session log with the cost it has itself counted for the running
 * process (checked 2026-10-24 on logs from this machine). The counters are cumulative from `startTime`, the start of
 * that process, so a log that was resumed has calls from before the counter began. It is the tool's own figure, and
 * the one a computed estimate can be checked against.
 */
export interface ParsedCostModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
}

export interface ParsedCostState {
  sessionId: string;
  processStartMs: number;
  totalMicros: number;
  apiDurationMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  unknownModelCost: boolean;
  models: ParsedCostModel[];
}

export type LineOutcome =
  | { kind: "call"; call: ParsedCall }
  | { kind: "cost_state"; state: ParsedCostState }
  | { kind: "tool_results"; results: ParsedToolResult[] }
  | { kind: "human_prompt"; prompt: ParsedHumanPrompt }
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

function micros(usd: unknown): number | null {
  return typeof usd === "number" && Number.isFinite(usd) && usd >= 0 ? Math.round(usd * 1_000_000) : null;
}

function optionalCount(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function parseCostState(d: Record<string, unknown>): LineOutcome {
  const sessionId = text(d["sessionId"]);
  if (!sessionId) return { kind: "malformed", reason: "cost-state-without-session" };
  const start = d["startTime"];
  if (typeof start !== "number" || !Number.isFinite(start) || start <= 0) return { kind: "malformed", reason: "cost-state-without-start" };
  const total = micros(d["totalCostUSD"]);
  if (total === null) return { kind: "malformed", reason: "cost-state-without-total" };
  const models: ParsedCostModel[] = [];
  const usage = d["modelUsage"];
  if (isObject(usage)) {
    for (const [model, u] of Object.entries(usage)) {
      if (!isObject(u)) continue;
      const cost = micros(u["costUSD"]);
      if (cost === null) continue;
      models.push({ model, inputTokens: count(u["inputTokens"]), outputTokens: count(u["outputTokens"]), thinkingTokens: count(u["thinkingTokens"]), cacheReadTokens: count(u["cacheReadInputTokens"]), cacheWriteTokens: count(u["cacheCreationInputTokens"]), costMicros: cost });
    }
  }
  return {
    kind: "cost_state",
    state: {
      sessionId,
      processStartMs: start,
      totalMicros: total,
      apiDurationMs: optionalCount(d["totalAPIDuration"]),
      linesAdded: optionalCount(d["totalLinesAdded"]),
      linesRemoved: optionalCount(d["totalLinesRemoved"]),
      unknownModelCost: d["hasUnknownModelCost"] === true,
      models,
    },
  };
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
  if (d["type"] === "user") return parseUserLine(d);
  if (d["type"] === "cost-state") return parseCostState(d);
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
  const toolUses: ParsedToolUse[] = [];
  const content = message["content"];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isObject(block) && block["type"] === "tool_use") {
        const name = text(block["name"]);
        if (!name) continue;
        toolNames.push(name);
        const id = text(block["id"]);
        if (id) {
          const edited = EDIT_TOOLS.has(name) ? editedPathOf(block["input"]) : undefined;
          toolUses.push({ toolUseId: id, name, inputHash: hashInput(block["input"]), ...(edited ? { editedPath: edited } : {}) });
        }
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
      toolUses,
      cwd: text(d["cwd"]),
      gitBranch: text(d["gitBranch"]),
      toolVersion: text(d["version"]),
    },
  };
}

function hashInput(input: unknown): string {
  let canonical: string;
  try {
    canonical = canonicalJson(input as Json);
  } catch {
    canonical = JSON.stringify(input) ?? "";
  }
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function textLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const b of content) if (isObject(b) && typeof b["text"] === "string") n += b["text"].length;
    return n;
  }
  return 0;
}

function parseUserLine(d: Record<string, unknown>): LineOutcome {
  const message = d["message"];
  if (!isObject(message)) return { kind: "ignored" };
  const sessionId = text(d["sessionId"]) ?? text(d["session_id"]);
  const ts = text(d["timestamp"]);
  if (!sessionId || !ts || Number.isNaN(Date.parse(ts))) return { kind: "ignored" };
  const content = message["content"];
  if (Array.isArray(content)) {
    const results: ParsedToolResult[] = [];
    for (const block of content) {
      if (isObject(block) && block["type"] === "tool_result") {
        const toolUseId = text(block["tool_use_id"]);
        if (toolUseId) results.push({ toolUseId, sessionId, ts, isError: block["is_error"] === true, resultChars: textLength(block["content"]) });
      }
    }
    if (results.length > 0) return { kind: "tool_results", results };
  }
  // A human prompt is a user-role message in the main conversation that is not a tool result and
  // not synthetic meta text. Prompts inside a subagent log are written by the main agent, not a person.
  if (d["isSidechain"] === true || d["isMeta"] === true) return { kind: "ignored" };
  const hasText = typeof content === "string" ? content.trim().length > 0 : Array.isArray(content) && content.some((b) => isObject(b) && b["type"] === "text");
  const promptId = text(d["uuid"]);
  if (!hasText || !promptId) return { kind: "ignored" };
  return { kind: "human_prompt", prompt: { promptId, sessionId, ts } };
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function editedPathOf(input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  return text(input["file_path"]) ?? text(input["notebook_path"]) ?? undefined;
}
