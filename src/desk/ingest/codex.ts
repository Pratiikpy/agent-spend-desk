/**
 * Codex session-log adapter. Written from the structure of real Codex logs (checked 2026-10-24 on 87 files, 12,527
 * token_count events, Codex 0.125 to 0.130): one `session_meta` line, `turn_context` lines that name the model, and
 * `event_msg` lines of type `token_count` that carry the cumulative token usage of the session and, beside it, the
 * plan's rate limit as percent used with the window and its reset time.
 *
 * Three things in the real logs would make a naive count wrong, and each is handled here:
 * - the same token_count event is written many times with an unchanged total (1,371 repeats in the sample), so a call
 *   is a growth of the cumulative total and nothing else;
 * - between two events the total can grow by more than the last request (4 cases), so a call's tokens are the growth
 *   of the cumulative counters, which always add up to the tool's own final total, and the call is marked as merged;
 * - a forked session replays its parent's whole history into the child's file in the milliseconds after the fork
 *   (one file on this machine: 782 replayed calls and 119 million tokens beside 7 calls of its own), so everything
 *   written in the first contiguous burst after a fork is history, not usage of the child.
 * Message text is never read; only counts, model names, times and the limit readings are kept.
 */

export interface CodexSessionInfo {
  sessionId: string;
  startedAt: string;
  cwd: string | null;
  gitBranch: string | null;
  cliVersion: string | null;
  modelProvider: string | null;
  forkedFromId: string | null;
  subagent: boolean;
}

export interface CodexCall {
  /** `codex:<session>:<n>`, n counting the session's own calls from 1, so the same file always gives the same ids. */
  callId: string;
  ts: string;
  /** The model of the latest turn, or `unknown`. */
  model: string;
  /** Fresh input: input tokens that were not read from cache. */
  inputTokens: number;
  cachedInputTokens: number;
  /** Output tokens as the tool counts them: reasoning tokens are part of them. */
  outputTokens: number;
  reasoningTokens: number;
  /** True when the cumulative total grew by more than the last request, so the call stands for two or more requests. */
  mergedRequests: boolean;
}

export interface CodexLimitSample {
  ts: string;
  kind: "primary" | "secondary";
  windowMinutes: number;
  usedPercent: number;
  /** When the window resets, in seconds since the epoch. Readings with the same value belong to one window. */
  resetsAt: number;
  planType: string | null;
  limitId: string | null;
}

export interface CodexParse {
  session: CodexSessionInfo | null;
  calls: CodexCall[];
  limits: CodexLimitSample[];
  malformedLines: number;
  replayedCalls: number;
  replayedTokens: number;
  /** The session's own cumulative total_tokens at the last event, replay included: the tool's figure for itself. */
  totalTokens: number;
}

/** A forked session's replay is a burst of lines written within milliseconds; a gap longer than this ends it. */
export const REPLAY_GAP_MS = 1000;

interface Cumulative {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function whole(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

function cumulative(v: unknown): Cumulative | null {
  if (!isObject(v)) return null;
  const input = whole(v["input_tokens"]);
  const output = whole(v["output_tokens"]);
  return { input, cached: whole(v["cached_input_tokens"]), output, reasoning: whole(v["reasoning_output_tokens"]), total: typeof v["total_tokens"] === "number" ? whole(v["total_tokens"]) : input + output };
}

export class CodexParser {
  private session: CodexSessionInfo | null = null;
  private readonly calls: CodexCall[] = [];
  private readonly limits: CodexLimitSample[] = [];
  private malformed = 0;
  private replayedCalls = 0;
  private replayedTokens = 0;
  private previous: Cumulative = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };
  private model = "unknown";
  private replaying = false;
  private lastLineMs: number | null = null;
  private readonly lastLimit = new Map<string, string>();

  feed(line: string): void {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let d: unknown;
    try {
      d = JSON.parse(trimmed);
    } catch {
      this.malformed += 1;
      return;
    }
    if (!isObject(d)) {
      this.malformed += 1;
      return;
    }
    const ts = text(d["timestamp"]);
    const ms = ts === null ? NaN : Date.parse(ts);
    const payload = d["payload"];

    if (d["type"] === "session_meta" && isObject(payload)) {
      if (this.session === null) this.startSession(payload, ts ?? text(payload["timestamp"]) ?? "");
      this.advance(ms);
      return;
    }
    this.advance(ms);
    if (this.session === null || !isObject(payload)) return;

    if (d["type"] === "turn_context") {
      const m = text(payload["model"]);
      if (m) this.model = m;
      return;
    }
    if (d["type"] !== "event_msg" || payload["type"] !== "token_count" || ts === null) return;
    this.tokenCount(ts, payload);
  }

  result(): CodexParse {
    return {
      session: this.session,
      calls: this.calls,
      limits: this.limits,
      malformedLines: this.malformed,
      replayedCalls: this.replayedCalls,
      replayedTokens: this.replayedTokens,
      totalTokens: this.previous.total,
    };
  }

  private startSession(payload: Record<string, unknown>, at: string): void {
    const id = text(payload["id"]);
    if (id === null) return;
    const git = payload["git"];
    const src = payload["source"];
    const forked = text(payload["forked_from_id"]);
    this.session = {
      sessionId: id,
      startedAt: text(payload["timestamp"]) ?? at,
      cwd: text(payload["cwd"]),
      gitBranch: isObject(git) ? text(git["branch"]) : null,
      cliVersion: text(payload["cli_version"]),
      modelProvider: text(payload["model_provider"]),
      forkedFromId: forked,
      subagent: payload["thread_source"] === "subagent" || (isObject(src) && "subagent" in src),
    };
    this.replaying = forked !== null;
    this.lastLineMs = Number.isNaN(Date.parse(at)) ? null : Date.parse(at);
  }

  /** Track the burst of lines written at the moment of a fork: it ends at the first gap after it. */
  private advance(ms: number): void {
    if (Number.isNaN(ms)) return;
    if (this.replaying && this.lastLineMs !== null && ms - this.lastLineMs > REPLAY_GAP_MS) this.replaying = false;
    this.lastLineMs = ms;
  }

  private tokenCount(ts: string, payload: Record<string, unknown>): void {
    const info = payload["info"];
    const usage = isObject(info) ? cumulative(info["total_token_usage"]) : null;
    let call: CodexCall | null = null;
    if (usage !== null && usage.total > this.previous.total) {
      const dInput = Math.max(0, usage.input - this.previous.input);
      const dCached = Math.max(0, usage.cached - this.previous.cached);
      const dTotal = usage.total - this.previous.total;
      const last = isObject(info) ? cumulative(info["last_token_usage"]) : null;
      const delta: Pick<CodexCall, "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens"> = {
        inputTokens: Math.max(0, dInput - dCached),
        cachedInputTokens: dCached,
        outputTokens: Math.max(0, usage.output - this.previous.output),
        reasoningTokens: Math.max(0, usage.reasoning - this.previous.reasoning),
      };
      if (this.replaying) {
        this.replayedCalls += 1;
        this.replayedTokens += dTotal;
      } else {
        call = { callId: `codex:${this.session?.sessionId}:${this.calls.length + 1}`, ts, model: this.model, ...delta, mergedRequests: last !== null && last.total !== dTotal };
        this.calls.push(call);
      }
      this.previous = usage;
    }
    if (!this.replaying) this.readLimits(ts, payload["rate_limits"]);
  }

  private readLimits(ts: string, raw: unknown): void {
    if (!isObject(raw)) return;
    const planType = text(raw["plan_type"]);
    const limitId = text(raw["limit_id"]);
    for (const kind of ["primary", "secondary"] as const) {
      const w = raw[kind];
      if (!isObject(w)) continue;
      const used = w["used_percent"];
      const minutes = w["window_minutes"];
      const resets = w["resets_at"];
      if (typeof used !== "number" || !Number.isFinite(used) || typeof minutes !== "number" || typeof resets !== "number") continue;
      const key = `${used}|${resets}`;
      if (this.lastLimit.get(kind) === key) continue;
      this.lastLimit.set(kind, key);
      this.limits.push({ ts, kind, windowMinutes: Math.round(minutes), usedPercent: used, resetsAt: Math.round(resets), planType, limitId });
    }
  }
}

/** Parse a whole log held in memory. */
export function parseCodexLog(lines: Iterable<string>): CodexParse {
  const p = new CodexParser();
  for (const l of lines) p.feed(l);
  return p.result();
}
