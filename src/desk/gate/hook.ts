import { callGate } from "./client.ts";
import { normalise, render, type HookTool } from "./tools.ts";

export interface HookOutcome {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}

export interface HookEnv {
  DESK_GATE_URL?: string | undefined;
  DESK_GATE_TOKEN?: string | undefined;
  DESK_GATE_TIMEOUT_MS?: string | undefined;
}

/** Spec 10.5 gives the endpoint 250 ms; the hook also pays for the first look at a long transcript, so it allows more. */
export const DEFAULT_HOOK_TIMEOUT_MS = 1_000;

const block = (tool: HookTool, reason: string, failed: boolean): HookOutcome => {
  return render(tool, { decision: "deny", reason, failedClosed: failed });
};

/**
 * Claude Code PreToolUse adapter. Contract read from the Claude Code hooks documentation on 2026-10-22: the
 * hook receives the event as JSON on stdin; exit code 2 blocks the tool call and its stderr (or the reason in a
 * deny decision) goes to Claude; exit 0 with a `hookSpecificOutput.permissionDecision` of deny or ask decides;
 * any other exit code, or output that does not parse, lets the call go ahead. So every failure here is turned
 * into exit 2, and the settings must also carry `"onFailure": "block"` for the cases this process never starts.
 *
 * An allow prints nothing: returning permissionDecision "allow" would skip the user's own permission prompts,
 * which is not the gate's decision to make.
 */
export async function runHook(stdin: string, env: HookEnv, fetchGate: typeof callGate = callGate, tool: HookTool = "claude-code"): Promise<HookOutcome> {
  const token = env.DESK_GATE_TOKEN;
  if (token === undefined || token.length === 0) return block(tool, "DESK_GATE_TOKEN is not set", true);
  const url = env.DESK_GATE_URL ?? "http://127.0.0.1:8765";
  let timeout = DEFAULT_HOOK_TIMEOUT_MS;
  if (env.DESK_GATE_TIMEOUT_MS !== undefined) {
    const t = Number(env.DESK_GATE_TIMEOUT_MS);
    if (!Number.isInteger(t) || t < 50 || t > 30_000) return block(tool, "DESK_GATE_TIMEOUT_MS must be a whole number from 50 to 30000", true);
    timeout = t;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch {
    return block(tool, "the hook input was not valid JSON", true);
  }
  const normal = normalise(tool, parsed);
  if (!normal.ok) return block(tool, normal.reason, true);
  const event = normal.event;
  let result;
  try {
    result = await fetchGate(url, token, "/v1/hook/pretooluse", event, timeout);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const what = name === "TimeoutError" || name === "AbortError" ? `no answer within ${timeout} ms` : `the gate at ${url} is not reachable`;
    return block(tool, what, true);
  }
  const body = result.body as { decision?: unknown; reason?: unknown; error?: { message?: unknown } } | null;
  if (result.status !== 200 || body === null || typeof body !== "object") {
    const why = typeof body?.error?.message === "string" ? body.error.message : `the gate answered HTTP ${result.status}`;
    return block(tool, why, true);
  }
  const reason = typeof body.reason === "string" ? body.reason : "no reason given";
  if (body.decision === "allow" || body.decision === "ask" || body.decision === "deny") {
    const r = render(tool, { decision: body.decision, reason, failedClosed: false });
    return r;
  }
  return block(tool, `the gate sent an answer this adapter does not understand (${String(body.decision)})`, true);
}
