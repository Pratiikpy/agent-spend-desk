/**
 * Hook adapters per agent tool (DF-056). Each tool that exposes a blocking hook before a tool call has its own input and its own way to say "stop". An adapter turns the
 * tool's event into the shape the gate reads, and the gate's answer into the tool's way of blocking. The contracts were read from each tool's own documentation on 2026-10-25:
 *
 *   claude-code  PreToolUse; exit 2 blocks (run live against Claude Code 2.1.308), any other failure lets the call through.
 *   codex        PreToolUse in the same wire shape as Claude Code's, with a `model` field. Its documentation says exit 2 blocks. Run live against Codex 0.154.0 on 2026-10-25, a hook
 *                that exited 2 was reported "PreToolUse Failed" and the command ran, while a hook that exited 0 with a `permissionDecision` of deny was reported "Blocked" and the
 *                command did not run. So Codex is answered with exit 0 and the deny on stdout.
 *   cursor       preToolUse (camelCase) with `conversation_id` and `workspace_roots`; `{"permission":"deny"}` or exit 2 blocks, `ask` is not enforced for it, and other failures
 *                let the call through unless the hook is marked `failClosed`. Not run live (Cursor is not installed here); answered as Codex is, with the deny on stdout, since
 *                that is the documented output and exit 2 was seen not to block in the tool next door.
 *   gemini-cli   BeforeTool; the documentation prefers exit 0 with `{"decision":"deny"}` and also lists exit 2. Not run live (no sign-in here); answered with the deny on stdout.
 *
 * Every failure inside an adapter becomes a block, because the tools above would otherwise let the call through. None of these tools' transcript formats is read: spend that a
 * tool made is seen by the gate only through the gateway, the spend log and the ledger, and what a hook adds is that a paused session, a closed switch or a cap already reached stops
 * the next tool call.
 */
export const HOOK_TOOLS = ["claude-code", "codex", "cursor", "gemini-cli"] as const;
export type HookTool = (typeof HOOK_TOOLS)[number];

export const isHookTool = (s: string): s is HookTool => (HOOK_TOOLS as readonly string[]).includes(s);

export interface GateAnswer {
  decision: "allow" | "ask" | "deny";
  reason: string;
  failedClosed: boolean;
}

export interface Rendered {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}

/** Whether an answer stops the call, in the way the tool reads: exit 2 for Claude Code, a deny on stdout for the others. */
export function stops(tool: HookTool, r: Rendered): boolean {
  if (r.exitCode === 2) return tool === "claude-code";
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    if (tool === "cursor") return j["permission"] === "deny";
    if (tool === "gemini-cli") return j["decision"] === "deny";
    if (tool === "codex") return (j["hookSpecificOutput"] as Record<string, unknown> | undefined)?.["permissionDecision"] === "deny";
  } catch {
    return false;
  }
  return false;
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The event in the shape the gate reads, or why this tool's event cannot be read. */
export function normalise(tool: HookTool, input: unknown): { ok: true; event: Record<string, unknown> } | { ok: false; reason: string } {
  const o = obj(input);
  if (o === null) return { ok: false, reason: "the hook input was not a JSON object" };
  switch (tool) {
    case "claude-code":
      return { ok: true, event: o };
    case "codex": {
      // Codex says its transcript format is not a stable interface for hooks, and it is not Claude Code's, so the gate is not given the path to read.
      const { transcript_path: _dropped, ...rest } = o;
      return { ok: true, event: rest };
    }
    case "cursor": {
      if (o["hook_event_name"] !== "preToolUse") return { ok: false, reason: `this adapter handles preToolUse, not ${String(o["hook_event_name"])}` };
      const session = text(o["conversation_id"]);
      const name = text(o["tool_name"]);
      if (session === null || name === null) return { ok: false, reason: "the Cursor event names no conversation or tool" };
      const roots = Array.isArray(o["workspace_roots"]) ? o["workspace_roots"] : [];
      const cwd = text(roots[0]) ?? text(o["cwd"]);
      return { ok: true, event: { hook_event_name: "PreToolUse", session_id: session, tool_name: name, tool_input: o["tool_input"], ...(cwd ? { cwd } : {}), ...(text(o["model"]) ? { model: o["model"] } : {}) } };
    }
    case "gemini-cli": {
      if (o["hook_event_name"] !== "BeforeTool") return { ok: false, reason: `this adapter handles BeforeTool, not ${String(o["hook_event_name"])}` };
      const session = text(o["session_id"]);
      const name = text(o["tool_name"]);
      if (session === null || name === null) return { ok: false, reason: "the Gemini CLI event names no session or tool" };
      const cwd = text(o["cwd"]);
      return { ok: true, event: { hook_event_name: "PreToolUse", session_id: session, tool_name: name, tool_input: o["tool_input"], ...(cwd ? { cwd } : {}) } };
    }
  }
}

const precaution = (a: GateAnswer): string => (a.failedClosed ? `Desk gate could not decide and is blocking as a precaution: ${a.reason}` : a.reason);

/** The tool's way of letting a call through, asking, or stopping it. */
export function render(tool: HookTool, a: GateAnswer): Rendered {
  const why = precaution(a);
  switch (tool) {
    case "claude-code":
    case "codex": {
      if (a.decision === "allow") return { exitCode: 0, stdout: "", stderr: "" };
      if (a.decision === "ask" && tool === "claude-code") return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: a.reason } }), stderr: "" };
      // Codex does not take an `ask` from a PreToolUse hook, so a question the owner would be asked is a stop there. It reads a stop from a deny on stdout with exit 0 (see above).
      const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } });
      return tool === "codex" ? { exitCode: 0, stdout: deny, stderr: "" } : { exitCode: 2, stdout: deny, stderr: why };
    }
    case "cursor": {
      if (a.decision === "allow") return { exitCode: 0, stdout: JSON.stringify({ permission: "allow" }), stderr: "" };
      // `ask` is not enforced for preToolUse in Cursor, so it is a stop, with the reason shown to the owner and to the agent.
      return { exitCode: 0, stdout: JSON.stringify({ permission: "deny", user_message: why, agent_message: why }), stderr: "" };
    }
    case "gemini-cli": {
      if (a.decision === "allow") return { exitCode: 0, stdout: JSON.stringify({ decision: "allow" }), stderr: "" };
      return { exitCode: 0, stdout: JSON.stringify({ decision: "deny", reason: why }), stderr: "" };
    }
  }
}

/** The failure of an adapter that could not even read its input or reach the gate. */
export const blocked = (tool: HookTool, reason: string): Rendered => render(tool, { decision: "deny", reason, failedClosed: true });

export interface ConfigTarget {
  /** Where the tool reads hooks from, as a path under the home folder (user) or under the project (project). */
  user: string;
  project: string;
}

export const CONFIG_FILES: Record<HookTool, ConfigTarget> = {
  "claude-code": { user: ".claude/settings.json", project: ".claude/settings.json" },
  codex: { user: ".codex/hooks.json", project: ".codex/hooks.json" },
  cursor: { user: ".cursor/hooks.json", project: ".cursor/hooks.json" },
  "gemini-cli": { user: ".gemini/settings.json", project: ".gemini/settings.json" },
};

/** The command a tool runs for its hook. A tool's own default command line is `node <hook-main> --tool <name>`. */
export function hookCommand(tool: HookTool, hookMain: string): string {
  return `node "${hookMain}" --tool ${tool}`;
}

const MARK = "desk-gate";

/**
 * The config with the Desk's hook added, written the way the tool reads it, leaving every other entry as it was. Running it twice adds nothing the second time. Claude Code's
 * and Codex's layouts are the same: events, each a list of matchers, each with a list of commands.
 */
export function withHook(tool: HookTool, existing: unknown, command: string): Record<string, unknown> {
  const doc = obj(existing) ?? {};
  const hooks = obj(doc["hooks"]) ?? {};
  const clone = (x: unknown): unknown[] => (Array.isArray(x) ? [...x] : []);
  const isOurs = (c: unknown): boolean => typeof obj(c)?.["command"] === "string" && /hook-main(\.ts)?"?\s+--tool|hook-main(\.ts)?"?$/.test(String(obj(c)?.["command"]));
  switch (tool) {
    case "claude-code":
    case "codex": {
      const pre = clone(hooks["PreToolUse"]).filter((e) => !(Array.isArray(obj(e)?.["hooks"]) && (obj(e)?.["hooks"] as unknown[]).some(isOurs)));
      pre.push({ matcher: tool === "claude-code" ? "*" : ".*", hooks: [{ type: "command", command, timeout: 10, statusMessage: "Checking the spend gate" }] });
      return { ...doc, hooks: { ...hooks, PreToolUse: pre } };
    }
    case "cursor": {
      const pre = clone(hooks["preToolUse"]).filter((e) => !isOurs(e));
      pre.push({ command, failClosed: true, timeout: 10 });
      return { version: 1, ...doc, hooks: { ...hooks, preToolUse: pre } };
    }
    case "gemini-cli": {
      const pre = clone(hooks["BeforeTool"]).filter((e) => !(Array.isArray(obj(e)?.["hooks"]) && (obj(e)?.["hooks"] as unknown[]).some(isOurs)));
      pre.push({ matcher: ".*", sequential: true, hooks: [{ type: "command", command, name: MARK, timeout: 10_000, description: "Asks the Desk's spend gate before a tool runs" }] });
      return { ...doc, hooks: { ...hooks, BeforeTool: pre } };
    }
  }
}

/** Whether the Desk's hook is in a tool's config. */
export function hasHook(tool: HookTool, config: unknown): boolean {
  const hooks = obj(obj(config)?.["hooks"]);
  if (hooks === null) return false;
  const ours = (c: unknown): boolean => typeof obj(c)?.["command"] === "string" && /hook-main(\.ts)?"?\s+--tool|hook-main(\.ts)?"?$/.test(String(obj(c)?.["command"]));
  const nested = (list: unknown): boolean => Array.isArray(list) && list.some((e) => Array.isArray(obj(e)?.["hooks"]) && (obj(e)?.["hooks"] as unknown[]).some(ours));
  switch (tool) {
    case "claude-code":
    case "codex":
      return nested(hooks["PreToolUse"]);
    case "cursor":
      return Array.isArray(hooks["preToolUse"]) && (hooks["preToolUse"] as unknown[]).some(ours);
    case "gemini-cli":
      return nested(hooks["BeforeTool"]);
  }
}
