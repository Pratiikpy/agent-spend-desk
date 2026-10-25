import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { isHandoffWrite } from "../../../src/desk/gate/checkpoint.ts";
import { installHook } from "../../../src/desk/gate/install.ts";
import { blocked, hasHook, HOOK_TOOLS, hookCommand, normalise, render, stops, withHook, type GateAnswer, type HookTool } from "../../../src/desk/gate/tools.ts";

/** The hook adapters of four tools (DF-056): their events in, their words out, every failure a block, and an install that touches nothing else. */
const root = mkdtempSync(join(tmpdir(), "desk-tools-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const HOOK_MAIN = resolve("src/desk/gate/hook-main.ts");
const ans = (decision: GateAnswer["decision"], reason = "over the cap", failedClosed = false): GateAnswer => ({ decision, reason, failedClosed });

describe("events in", () => {
  it("reads Cursor's preToolUse by its conversation and first workspace root, and refuses an event of another kind", () => {
    const r = normalise("cursor", { hook_event_name: "preToolUse", conversation_id: "c-1", tool_name: "Shell", tool_input: { command: "ls" }, workspace_roots: ["/work/a", "/work/b"], model: "claude-opus-5", transcript_path: "/x/cursor.txt" });
    expect(r).toEqual({ ok: true, event: { hook_event_name: "PreToolUse", session_id: "c-1", tool_name: "Shell", tool_input: { command: "ls" }, cwd: "/work/a", model: "claude-opus-5" } });
    expect(JSON.stringify(r)).not.toContain("transcript");
    expect(normalise("cursor", { hook_event_name: "beforeShellExecution", conversation_id: "c", tool_name: "x" })).toMatchObject({ ok: false });
    expect(normalise("cursor", { hook_event_name: "preToolUse", tool_name: "Shell" })).toMatchObject({ ok: false, reason: expect.stringMatching(/no conversation or tool/) });
  });

  it("reads Gemini CLI's BeforeTool, drops its transcript, and passes Claude Code's and Codex's events as they are", () => {
    expect(normalise("gemini-cli", { hook_event_name: "BeforeTool", session_id: "g-1", transcript_path: "/x/g.json", cwd: "/w", tool_name: "run_shell_command", tool_input: { command: "ls" } })).toEqual({ ok: true, event: { hook_event_name: "PreToolUse", session_id: "g-1", tool_name: "run_shell_command", tool_input: { command: "ls" }, cwd: "/w" } });
    expect(normalise("gemini-cli", { hook_event_name: "AfterTool", session_id: "g", tool_name: "x" })).toMatchObject({ ok: false });
    const claude = { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash" };
    expect(normalise("claude-code", claude)).toEqual({ ok: true, event: claude });
    expect(normalise("codex", { ...claude, model: "gpt-5" })).toMatchObject({ ok: true });
    // Codex's rollout file is not Claude Code's log, and the gate must not be asked to read it as one.
    const codex = normalise("codex", { ...claude, model: "gpt-5", transcript_path: ["", "elsewhere", ".codex", "sessions", "rollout.jsonl"].join("/") });
    expect(codex).toEqual({ ok: true, event: { ...claude, model: "gpt-5" } });
    for (const t of HOOK_TOOLS) expect(normalise(t, "text")).toMatchObject({ ok: false });
    for (const t of HOOK_TOOLS) expect(normalise(t, [1])).toMatchObject({ ok: false });
  });
});

describe("answers out", () => {
  it("lets a call through in the way each tool reads, and says nothing where silence is the way", () => {
    expect(render("claude-code", ans("allow"))).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(render("codex", ans("allow"))).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(JSON.parse(render("cursor", ans("allow")).stdout)).toEqual({ permission: "allow" });
    expect(JSON.parse(render("gemini-cli", ans("allow")).stdout)).toEqual({ decision: "allow" });
  });

  it("stops a call the way each tool was seen to read a stop: exit 2 for Claude Code, a deny on stdout with exit 0 for the others", () => {
    for (const t of HOOK_TOOLS) {
      const r = render(t, ans("deny", "no permit matches"));
      expect(stops(t, r), t).toBe(true);
      expect(r.exitCode, t).toBe(t === "claude-code" ? 2 : 0);
      expect(r.stdout.length, t).toBeGreaterThan(0);
    }
    expect(render("claude-code", ans("deny", "no permit matches")).stderr).toBe("no permit matches");
    expect(JSON.parse(render("claude-code", ans("deny")).stdout).hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(JSON.parse(render("codex", ans("deny")).stdout).hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "over the cap" });
    expect(JSON.parse(render("cursor", ans("deny")).stdout)).toMatchObject({ permission: "deny", user_message: "over the cap", agent_message: "over the cap" });
    expect(JSON.parse(render("gemini-cli", ans("deny")).stdout)).toMatchObject({ decision: "deny", reason: "over the cap" });
  });

  it("does not take a let-through for a stop, nor a stop for a let-through, nor garbage for either", () => {
    for (const t of HOOK_TOOLS) {
      expect(stops(t, render(t, ans("allow"))), t).toBe(false);
      expect(stops(t, { exitCode: 0, stdout: "", stderr: "" }), t).toBe(false);
      expect(stops(t, { exitCode: 0, stdout: "not json", stderr: "" }), t).toBe(false);
    }
    // Exit 2 is a stop only where it was seen to be one.
    expect(stops("claude-code", { exitCode: 2, stdout: "", stderr: "x" })).toBe(true);
    expect(stops("codex", { exitCode: 2, stdout: "", stderr: "x" })).toBe(false);
  });

  it("asks only where the tool can ask, and stops where it cannot", () => {
    const ask = render("claude-code", ans("ask", "needs the owner"));
    expect(ask.exitCode).toBe(0);
    expect(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
    expect(stops("claude-code", ask)).toBe(false);
    for (const t of ["codex", "cursor", "gemini-cli"] as const) expect(stops(t, render(t, ans("ask", "needs the owner"))), t).toBe(true);
  });

  it("calls a failure what it is, and blocks on it, for every tool", () => {
    for (const t of HOOK_TOOLS) {
      const r = blocked(t, "the gate is not reachable");
      expect(stops(t, r), t).toBe(true);
      expect(r.stdout + r.stderr).toContain("Desk gate could not decide and is blocking as a precaution: the gate is not reachable");
    }
  });
});

describe("the hook command, run as a tool would run it", () => {
  const run = (args: string[], stdin: string, env: Record<string, string> = {}) =>
    spawnSync("node", [HOOK_MAIN, ...args], { input: stdin, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", ...env }, timeout: 30_000 });

  it("blocks with no token, in the tool's words, for each tool", () => {
    for (const t of HOOK_TOOLS) {
      const r = run(["--tool", t], "{}");
      expect(r.status, t).toBe(t === "claude-code" ? 2 : 0);
      expect(r.stderr + r.stdout, t).toContain("DESK_GATE_TOKEN is not set");
      expect(stops(t, { exitCode: r.status === 2 ? 2 : 0, stdout: r.stdout.trim(), stderr: r.stderr }), t).toBe(true);
    }
    expect(JSON.parse(run(["--tool", "cursor"], "{}").stdout)).toMatchObject({ permission: "deny" });
    expect(JSON.parse(run(["--tool", "gemini-cli"], "{}").stdout)).toMatchObject({ decision: "deny" });
  });

  it("blocks when it is given a tool it does not know, or none after --tool", () => {
    expect(run(["--tool", "vim"], "{}")).toMatchObject({ status: 2 });
    expect(run(["--tool", "vim"], "{}").stderr).toMatch(/does not know the tool "vim"/);
    expect(run(["--tool"], "{}").status).toBe(2);
  });

  it("keeps Claude Code's old command line, with no --tool, working as it did", () => {
    const r = run([], JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash" }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("DESK_GATE_TOKEN is not set");
  });
});

describe("a paused session may write its handoff, in each tool's way, and nothing else", () => {
  const handoff = join(root, "handoff.md");
  it("takes Write and Edit, write_file and replace, and a patch that touches only the handoff", () => {
    for (const name of ["Write", "Edit", "MultiEdit", "write_file", "replace"]) expect(isHandoffWrite(handoff, name, { file_path: handoff }), name).toBe(true);
    expect(isHandoffWrite(handoff, "Write", { file_path: join(root, "other.md") })).toBe(false);
    expect(isHandoffWrite(handoff, "run_shell_command", { file_path: handoff })).toBe(false);
    const patch = (body: string): { command: string } => ({ command: `*** Begin Patch\n${body}\n*** End Patch` });
    expect(isHandoffWrite(handoff, "apply_patch", patch(`*** Add File: ${handoff}\n+x`))).toBe(true);
    expect(isHandoffWrite(handoff, "apply_patch", patch(`*** Update File: ${handoff}\n@@\n-a\n+b`))).toBe(true);
    expect(isHandoffWrite(handoff, "apply_patch", patch(`*** Add File: ${handoff}\n+x\n*** Add File: ${join(root, "other.md")}\n+y`))).toBe(false);
    expect(isHandoffWrite(handoff, "apply_patch", patch(`*** Delete File: ${handoff}`))).toBe(false);
    expect(isHandoffWrite(handoff, "apply_patch", patch(`*** Update File: ${handoff}\n*** Move to: ${join(root, "x.md")}`))).toBe(false);
    expect(isHandoffWrite(handoff, "apply_patch", { command: "echo no patch" })).toBe(false);
    expect(isHandoffWrite(handoff, "apply_patch", "text")).toBe(false);
  });
});

describe("installing the hook", () => {
  const opts = (tool: HookTool, dir: string, over: Record<string, unknown> = {}) => ({ tool, scope: "user" as const, home: dir, cwd: dir, hookMain: HOOK_MAIN, write: false, ...over });
  const dirFor = (name: string): string => {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    return d;
  };

  it("reports without writing, then adds the hook in each tool's layout, beside what was there, and keeps a copy of the file", () => {
    const layouts: Record<HookTool, { file: string; before: unknown; check: (j: Record<string, any>) => void }> = {
      "claude-code": { file: ".claude/settings.json", before: { theme: "dark", hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "mine.sh" }] }] } }, check: (j) => expect(j.hooks.PreToolUse).toHaveLength(2) },
      codex: { file: ".codex/hooks.json", before: { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "mine.sh" }] }] } }, check: (j) => expect(j.hooks.SessionStart).toHaveLength(1) },
      cursor: { file: ".cursor/hooks.json", before: { version: 1, hooks: { afterFileEdit: [{ command: "fmt.sh" }] } }, check: (j) => { expect(j.hooks.afterFileEdit).toHaveLength(1); expect(j.hooks.preToolUse[0]).toMatchObject({ failClosed: true }); } },
      "gemini-cli": { file: ".gemini/settings.json", before: { general: { vimMode: true } }, check: (j) => { expect(j.general.vimMode).toBe(true); expect(j.hooks.BeforeTool[0].hooks[0]).toMatchObject({ type: "command", name: "desk-gate", timeout: 10_000 }); } },
    };
    for (const t of HOOK_TOOLS) {
      const d = dirFor(`inst-${t}`);
      const L = layouts[t];
      mkdirSync(join(d, L.file, ".."), { recursive: true });
      writeFileSync(join(d, L.file), JSON.stringify(L.before));
      const look = installHook(opts(t, d));
      expect(look).toMatchObject({ state: "absent", wrote: false });
      expect(JSON.parse(readFileSync(join(d, L.file), "utf8"))).toEqual(L.before);
      const done = installHook(opts(t, d, { write: true }));
      expect(done).toMatchObject({ state: "present", wrote: true });
      expect(done.message).toMatch(/not enforced until `desk enforcement test` passes/);
      const written = JSON.parse(readFileSync(join(d, L.file), "utf8"));
      L.check(written);
      expect(hasHook(t, written)).toBe(true);
      expect(JSON.parse(readFileSync(`${join(d, L.file)}.desk-backup`, "utf8"))).toEqual(L.before);
      expect(installHook(opts(t, d))).toMatchObject({ state: "present" });
    }
  });

  it("adds nothing the second time and does not overwrite the first copy", () => {
    for (const t of HOOK_TOOLS) {
      const d = dirFor(`twice-${t}`);
      installHook(opts(t, d, { write: true }));
      const once = readFileSync(installHook(opts(t, d)).file, "utf8");
      installHook(opts(t, d, { write: true }));
      expect(readFileSync(installHook(opts(t, d)).file, "utf8"), t).toBe(once);
      expect(existsSync(`${installHook(opts(t, d)).file}.desk-backup`), t).toBe(true);
    }
    const d = dirFor("twice-backup");
    mkdirSync(join(d, ".cursor"), { recursive: true });
    writeFileSync(join(d, ".cursor", "hooks.json"), '{"version":1,"hooks":{}}');
    installHook(opts("cursor", d, { write: true }));
    installHook(opts("cursor", d, { write: true }));
    expect(readFileSync(join(d, ".cursor", "hooks.json.desk-backup"), "utf8")).toBe('{"version":1,"hooks":{}}');
  });

  it("leaves a config that is not JSON exactly as it is, and uses the project's file for the project scope", () => {
    const d = dirFor("broken");
    mkdirSync(join(d, ".gemini"), { recursive: true });
    writeFileSync(join(d, ".gemini", "settings.json"), "{ not json // comment");
    const r = installHook(opts("gemini-cli", d, { write: true }));
    expect(r).toMatchObject({ state: "unreadable", wrote: false });
    expect(readFileSync(join(d, ".gemini", "settings.json"), "utf8")).toBe("{ not json // comment");
    const proj = dirFor("proj");
    const home = dirFor("proj-home");
    const p = installHook({ tool: "cursor", scope: "project", home, cwd: proj, hookMain: HOOK_MAIN, write: true });
    expect(p.file).toBe(resolve(proj, ".cursor", "hooks.json"));
    expect(existsSync(join(home, ".cursor", "hooks.json"))).toBe(false);
  });

  it("names the command with the tool, and recognises a hook installed before there was a --tool flag", () => {
    expect(hookCommand("codex", "/a/hook-main.ts")).toBe('node "/a/hook-main.ts" --tool codex');
    const old = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "/a/hook-main.ts"' }] }] } };
    expect(hasHook("claude-code", old)).toBe(true);
    const next = withHook("claude-code", old, hookCommand("claude-code", "/a/hook-main.ts"));
    expect((next as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse).toHaveLength(1);
    expect(hasHook("cursor", old)).toBe(false);
  });
});
