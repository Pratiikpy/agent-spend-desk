/** Builders for lines in the structure real Codex session logs have (checked 2026-10-24 on logs from this machine, Codex 0.125 to 0.130). */

interface Usage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

interface Window {
  used: number;
  minutes: number;
  resetsAt: number;
}

interface Limits {
  primary?: Window;
  secondary?: Window;
  plan?: string;
}

const tokens = (u: Usage) => ({ input_tokens: u.input, cached_input_tokens: u.cached, output_tokens: u.output, reasoning_output_tokens: u.reasoning, total_tokens: u.input + u.output });

function meta(o: { id: string; ts?: string; at?: string; cwd?: string; branch?: string; version?: string; provider?: string; forkedFrom?: string; subagent?: boolean }): string {
  const ts = o.ts ?? "2026-10-01T10:00:00.000Z";
  // A replayed parent session keeps its own start time in the payload, while the line is written at the moment of the fork.
  return JSON.stringify({
    timestamp: o.at ?? ts,
    type: "session_meta",
    payload: {
      id: o.id,
      ...(o.forkedFrom ? { forked_from_id: o.forkedFrom } : {}),
      timestamp: ts,
      cwd: o.cwd ?? "/work/app",
      originator: "codex-tui",
      cli_version: o.version ?? "0.130.0",
      source: o.subagent ? { subagent: { thread_spawn: { parent_thread_id: o.forkedFrom ?? null, depth: 1 } } } : "cli",
      ...(o.subagent ? { thread_source: "subagent" } : {}),
      model_provider: o.provider ?? "openai",
      git: { commit_hash: "0".repeat(40), branch: o.branch ?? "main", repository_url: "https://example.invalid/repo.git" },
    },
  });
}

function turn(ts: string, model: string): string {
  return JSON.stringify({ timestamp: ts, type: "turn_context", payload: { turn_id: "t", cwd: "/work/app", model } });
}

/** A token_count event. `total` is the cumulative usage so far; `last` defaults to the growth since the previous event, so pass it when a test needs them to differ. */
function count(ts: string, total: Usage | null, last?: Usage, limits?: Limits): string {
  const win = (w: Window | undefined) => (w ? { used_percent: w.used, window_minutes: w.minutes, resets_at: w.resetsAt } : undefined);
  return JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: total === null ? null : { total_token_usage: tokens(total), last_token_usage: tokens(last ?? total), model_context_window: 258_400 },
      ...(limits ? { rate_limits: { limit_id: "codex", limit_name: null, primary: win(limits.primary), secondary: win(limits.secondary), credits: null, plan_type: limits.plan ?? null, rate_limit_reached_type: null } } : {}),
    },
  });
}

/** An event of another kind, which the reader must skip. */
function other(ts: string, kind: string): string {
  return JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: kind, info: null } });
}

export const codexLines = { meta, turn, count, other };
