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
  /** Where the request ran (`global`, `us`, `not_available`, or empty); null when the log does not carry the field. */
  inferenceGeo: string | null;
  stopReason: string | null;
  isApiError: boolean;
  toolNames: string[];
  toolUses: ParsedToolUse[];
  cwd: string | null;
  gitBranch: string | null;
  toolVersion: string | null;
}

/**
 * A tool result as the Desk keeps it: its size, whether it was an error, a hash of what it said with numbers and identifiers folded away
 * (so the same error with a new line number reads as the same error), and whether the tool says it cut its own output short. The text
 * itself is never kept.
 */
export interface ParsedToolResult {
  toolUseId: string;
  sessionId: string;
  ts: string;
  isError: boolean;
  /** Length in characters of the text of the result; images and other blocks count as zero. */
  resultChars: number;
  resultHash: string | null;
  truncated: boolean;
}

/** A compaction the log records: when, what started it, and the tokens the context held before and after. Nothing the summary said is read. */
export interface ParsedCompaction {
  sessionId: string;
  ts: string;
  trigger: string;
  preTokens: number;
  postTokens: number | null;
  durationMs: number | null;
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

/** A delegated agent that a tool result names: the agent that started it is the one whose log holds the result. */
export interface ParsedDelegation {
  sessionId: string;
  childAgentId: string;
  ts: string;
}

/** A workflow run a tool result launched: a script that starts a batch of agents, whose agent logs sit in a folder named after the run. */
export interface ParsedWorkflow {
  sessionId: string;
  runId: string;
  /** The owner's own label for the script, cut short; its summary and the paths in the result are not read. */
  name: string | null;
  ts: string;
}

/** The run a delegated agent's log belongs to, from where the log sits: `.../subagents/workflows/<run>/agent-<id>.jsonl`. */
export function workflowRunOfPath(path: string): string | null {
  const m = /[\\/]workflows[\\/](wf_[A-Za-z0-9_-]{3,60})[\\/]/.exec(path);
  return m ? (m[1] as string) : null;
}

export type LineOutcome = LineKind & {
  /** The agent id the log line carries: set on every line a delegated agent writes, so the log file can be named after it. */
  agentId?: string;
};

type LineKind =
  | { kind: "call"; call: ParsedCall }
  | { kind: "cost_state"; state: ParsedCostState }
  | { kind: "tool_results"; results: ParsedToolResult[]; delegations?: ParsedDelegation[]; workflows?: ParsedWorkflow[] }
  | { kind: "human_prompt"; prompt: ParsedHumanPrompt }
  | { kind: "compaction"; compaction: ParsedCompaction }
  | { kind: "delegation_notice"; delegations: ParsedDelegation[] }
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
  const outcome: LineOutcome = parseObject(d);
  const agentId = text(d["agentId"]);
  return agentId !== null && outcome.kind !== "malformed" ? { ...outcome, agentId } : outcome;
}

function parseObject(d: Record<string, unknown>): LineKind {
  if (d["type"] === "user") return parseUserLine(d);
  if (d["type"] === "cost-state") return parseCostState(d);
  if (d["type"] === "system" && d["subtype"] === "compact_boundary") return parseCompaction(d);
  if (d["type"] === "queue-operation" && d["operation"] === "enqueue") return parseTaskNotice(d);
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
      inferenceGeo: text(usage["inference_geo"]),
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

/**
 * Phrases a tool uses to say it did not return everything: Claude Code's "output too large, full output saved to a file", a size limit that was
 * exceeded, a count of lines or characters left out. The bare word is not enough (a result may print a field called truncated, or a test of that name).
 * Only the start and the end of a result are read.
 */
const TRUNCATION = /<persisted-output>|\boutput (?:was |is )?too (?:large|long)\b|\bexceeds? (?:the )?maximum allowed\b|\b(?:output|results?|content|response|text|lines?) (?:was |were |is |has been |have been )?truncated\b|\btruncated (?:to|at|after|from|\()|\[\s*truncated\s*\]|\.\.\.\s*truncated|\[\d[\d,]* (?:more )?(?:lines?|chars?|characters?|bytes?|tokens?) (?:truncated|omitted|hidden|elided)\]|\.\.\. ?\[?\d[\d,]* (?:more )?(?:lines?|chars?|characters?|bytes?|tokens?)/i;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (isObject(b) && typeof b["text"] === "string" ? b["text"] : "")).join("\n");
  return "";
}

/**
 * Fold what changes from one run to the next out of a result, so that the same failure compares equal: digit runs, long hex and uuid-like
 * identifiers, whitespace and case. Only the start of a result is compared (the first 200 characters after folding): the head of an error
 * says what failed, and a long tail often carries a path or a time that differs.
 */
export function foldResult(text: string): string {
  return text
    .slice(0, 20_000)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\b[0-9a-f]{12,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** A bare exit status, or a few characters, says too little to tell one failure from another: a search with no match and a build that broke both read "exit code 1". */
const UNINFORMATIVE = /^exit code #\.?$/;

export function resultFacts(content: unknown): { hash: string | null; truncated: boolean } {
  const t = textOf(content);
  if (t === "") return { hash: null, truncated: false };
  const ends = t.length <= 4_000 ? t : `${t.slice(0, 2_000)}\n${t.slice(-2_000)}`;
  const folded = foldResult(t);
  const informative = folded.length >= 8 && !UNINFORMATIVE.test(folded);
  return { hash: informative ? createHash("sha256").update(folded).digest("hex").slice(0, 16) : null, truncated: TRUNCATION.test(ends) };
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

const AGENT_ID = /^[0-9a-f]{8,40}$/i;
const WORKFLOW_RUN = /^wf_[A-Za-z0-9_-]{3,60}$/;

/**
 * An older client does not put the agent's id in the result that launched it. It does queue a notice when the agent finishes, which names the agent
 * and the tool use that launched it, in the log of the agent that started it. The notice is read for the id only.
 */
const TASK_AGENT_ID = /^a[0-9a-f]{16}$/;

function parseTaskNotice(d: Record<string, unknown>): LineKind {
  const content = d["content"];
  const sessionId = text(d["sessionId"]) ?? text(d["session_id"]);
  const ts = text(d["timestamp"]);
  if (typeof content !== "string" || !content.startsWith("<task-notification>") || !sessionId || !ts || Number.isNaN(Date.parse(ts))) return { kind: "ignored" };
  const m = /<task-id>([^<]{1,64})<\/task-id>/.exec(content);
  return m && TASK_AGENT_ID.test(m[1] as string) ? { kind: "delegation_notice", delegations: [{ sessionId, childAgentId: m[1] as string, ts }] } : { kind: "ignored" };
}

const wholeOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function parseCompaction(d: Record<string, unknown>): LineOutcome {
  const meta = d["compactMetadata"];
  const sessionId = text(d["sessionId"]) ?? text(d["session_id"]);
  const ts = text(d["timestamp"]);
  if (!sessionId) return { kind: "malformed", reason: "compaction-without-session" };
  if (!ts || Number.isNaN(Date.parse(ts))) return { kind: "malformed", reason: "compaction-without-timestamp" };
  if (!isObject(meta)) return { kind: "malformed", reason: "compaction-without-metadata" };
  const preTokens = wholeOrNull(meta["preTokens"]);
  if (preTokens === null) return { kind: "malformed", reason: "compaction-without-token-count" };
  const trigger = text(meta["trigger"]) ?? "unknown";
  return { kind: "compaction", compaction: { sessionId, ts, trigger: trigger.slice(0, 40), preTokens, postTokens: wholeOrNull(meta["postTokens"]), durationMs: wholeOrNull(meta["durationMs"]) } };
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
        if (toolUseId) {
          const facts = resultFacts(block["content"]);
          results.push({ toolUseId, sessionId, ts, isError: block["is_error"] === true, resultChars: textLength(block["content"]), resultHash: facts.hash, truncated: facts.truncated });
        }
      }
    }
    // A tool result that launched a delegated agent names its id in the structured result: the agent whose log holds this line started it.
    const launched = d["toolUseResult"];
    const childId = isObject(launched) ? text(launched["agentId"]) : null;
    const delegations: ParsedDelegation[] = childId !== null && AGENT_ID.test(childId) ? [{ sessionId, childAgentId: childId, ts }] : [];
    const runId = isObject(launched) && launched["taskType"] === "local_workflow" ? text(launched["runId"]) : null;
    const workflows: ParsedWorkflow[] = runId !== null && WORKFLOW_RUN.test(runId) ? [{ sessionId, runId, name: (text((launched as Record<string, unknown>)["workflowName"]) ?? "").slice(0, 60) || null, ts }] : [];
    if (results.length > 0) return { kind: "tool_results", results, ...(delegations.length > 0 ? { delegations } : {}), ...(workflows.length > 0 ? { workflows } : {}) };
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
