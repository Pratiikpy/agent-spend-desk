import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Gate } from "../gate/gate.ts";
import { runHook } from "../gate/hook.ts";
import { stops, type HookTool } from "../gate/tools.ts";
import { startGateServer } from "../gate/http.ts";
import { fixedPolicy } from "../gate/policy-source.ts";
import { startGateway } from "../gateway/server.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import type { CheckResult, SurfaceResult } from "./ladder.ts";
import { installedVersion } from "./version.ts";

/**
 * The per-surface enforcement tests (DF-052). Each one stands up the Desk's own gate, sends it a call that is over the cap and a call that is not, and
 * checks that the first did not get through and the second did, and that a failure of the gate blocks rather than lets through. The hook has a live
 * variant that runs the real Claude Code. Nothing here calls a model except that live variant, which spends a few cents on the cheapest model.
 */

// Throwaway values for a gate that exists only for the length of a test, built at run time.
const OWNER_KEY = ["owner", "key", "for", "the", "self", "test", "0123456789"].join("-");
const TOKEN = ["gate", "token", "for", "the", "self", "test", "0123456789"].join("-");

const POLICY = `
version: 1
rules:
  - id: allow-claude
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "5.00", warn_at: 0.5, ask_at: 1.0 }
`;
const POLICY_ALL = "version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n";
const POLICY_NONE = 'version: 1\nrules:\n  - id: only-an-unused-model\n    kind: permit\n    when: { model: { in: ["never-used"] } }\n';

const check = (name: string, passed: boolean, detail: string): CheckResult => ({ name, passed, detail });
const result = (surface: SurfaceResult["surface"], mode: SurfaceResult["mode"], tool: string | null, toolVersion: string | null, checks: CheckResult[]): SurfaceResult => ({
  surface,
  mode,
  tool,
  toolVersion,
  testedAt: new Date().toISOString(),
  passed: checks.every((c) => c.passed),
  checks,
});

function makeGate(prices: PriceSnapshot, yaml: string, extra: { handoffDir?: string; hookProbeMicros?: number } = {}): { gate: Gate; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const gate = new Gate({ db, prices, policy: fixedPolicy(parsePolicyYaml(yaml)), person: "self-test", ownerKey: OWNER_KEY, shadowMs: 0, ...extra });
  return { gate, db };
}

const hookEvent = (session: string, tool: string, input?: Record<string, unknown>, kind: HookTool = "claude-code"): string => {
  const cwd = "/work/self-test";
  switch (kind) {
    case "cursor":
      return JSON.stringify({ hook_event_name: "preToolUse", conversation_id: session, tool_name: tool, workspace_roots: [cwd], model: "claude-opus-5", ...(input ? { tool_input: input } : {}) });
    case "gemini-cli":
      return JSON.stringify({ hook_event_name: "BeforeTool", session_id: session, tool_name: tool, cwd, ...(input ? { tool_input: input } : {}) });
    case "codex":
      return JSON.stringify({ hook_event_name: "PreToolUse", session_id: session, tool_name: tool, cwd, model: "claude-opus-5", ...(input ? { tool_input: input } : {}) });
    default:
      return JSON.stringify({ hook_event_name: "PreToolUse", session_id: session, tool_name: tool, cwd, ...(input ? { tool_input: input } : {}) });
  }
};

/** The tool's own name for its shell tool, and for the tool that writes a file, as its events carry them. */
const SHELL: Record<HookTool, string> = { "claude-code": "Bash", codex: "Bash", cursor: "Shell", "gemini-cli": "run_shell_command" };
const WRITE: Record<HookTool, string> = { "claude-code": "Write", codex: "apply_patch", cursor: "Write", "gemini-cli": "write_file" };

/** Whether the refusal on stdout is in the words this tool reads. */
function refusalIsInToolsWords(tool: HookTool, stdout: string): boolean {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>;
    if (tool === "cursor") return j["permission"] === "deny" && typeof j["agent_message"] === "string";
    if (tool === "gemini-cli") return j["decision"] === "deny" && typeof j["reason"] === "string";
    return (j["hookSpecificOutput"] as Record<string, unknown> | undefined)?.["permissionDecision"] === "deny";
  } catch {
    return false;
  }
}

/** The hook adapter against a real gate over HTTP: what it does with a refused call, a permitted one, a gate that is down, and a stopped session. */
export async function testHookContract(prices: PriceSnapshot, opts: { policyYaml?: string; tool?: HookTool } = {}): Promise<SurfaceResult> {
  const kind: HookTool = opts.tool ?? "claude-code";
  const run = (stdin: string, env: Parameters<typeof runHook>[1]) => runHook(stdin, env, undefined, kind);
  const sh = SHELL[kind];
  const checks: CheckResult[] = [];
  const handoffs = mkdtempSync(join(tmpdir(), "desk-enforce-handoff-"));
  const deny = makeGate(prices, opts.policyYaml ?? POLICY, { hookProbeMicros: 10_000_000, handoffDir: handoffs });
  const allow = makeGate(prices, POLICY_ALL);
  const s1 = await startGateServer({ gate: deny.gate, token: TOKEN });
  const s2 = await startGateServer({ gate: allow.gate, token: TOKEN });
  try {
    const refused = await run(hookEvent("t-1", sh, undefined, kind), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s1.url });
    checks.push(check("a call over the cap is blocked", stops(kind, refused) && (refused.stderr + refused.stdout).includes("Desk gate"), `exit ${refused.exitCode}`));
    checks.push(check("and the refusal is in the words this tool reads", refusalIsInToolsWords(kind, refused.stdout), refused.stdout.slice(0, 120)));
    const ok = await run(hookEvent("t-2", sh, undefined, kind), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s2.url });
    checks.push(check("a permitted call is let through", ok.exitCode === 0 && !stops(kind, ok) && ok.stderr === "" && (kind === "claude-code" || kind === "codex" ? ok.stdout === "" : ok.stdout.includes("allow")), `exit ${ok.exitCode}`));
    const down = await run(hookEvent("t-3", sh, undefined, kind), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: "http://127.0.0.1:1", DESK_GATE_TIMEOUT_MS: "300" });
    checks.push(check("a gate that cannot be reached blocks", stops(kind, down), `exit ${down.exitCode}`));
    const noToken = await run(hookEvent("t-4", sh, undefined, kind), { DESK_GATE_URL: s2.url });
    checks.push(check("a missing token blocks", stops(kind, noToken), `exit ${noToken.exitCode}`));
    const bad = await run("{not json", { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s2.url });
    checks.push(check("input that is not JSON blocks", stops(kind, bad), `exit ${bad.exitCode}`));
    const wrongEvent = await run(JSON.stringify({ hook_event_name: "PostToolUse", session_id: "t-5", conversation_id: "t-5", tool_name: sh }), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s2.url });
    checks.push(check("an event of another kind blocks", stops(kind, wrongEvent), `exit ${wrongEvent.exitCode}`));
    // The session stopped above (t-1) may write its handoff, and nothing else.
    const cp = deny.gate.checkpoints?.open("t-1");
    if (cp === undefined) checks.push(check("a stopped session has a checkpoint", false, "none was opened"));
    else {
      const wr = WRITE[kind];
      const patchOf = (path: string): Record<string, unknown> => ({ command: `*** Begin Patch
*** Add File: ${path}
+x
*** End Patch` });
      const body = (path: string): Record<string, unknown> => (kind === "codex" ? patchOf(path) : { file_path: path, content: "x" });
      const write = await run(hookEvent("t-1", wr, body(cp.handoff_path), kind), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s1.url });
      const other = await run(hookEvent("t-1", wr, body(join(handoffs, "other.md")), kind), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s1.url });
      const shell = await run(hookEvent("t-1", sh, { command: `echo x > ${cp.handoff_path}` }, kind), { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s1.url });
      checks.push(check("a stopped session may write its handoff", write.exitCode === 0 && !stops(kind, write), `exit ${write.exitCode}`));
      checks.push(check("and nothing else: another file and a shell are blocked", stops(kind, other) && stops(kind, shell), `exits ${other.exitCode}, ${shell.exitCode}`));
    }
  } finally {
    await s1.close();
    await s2.close();
    rmSync(handoffs, { recursive: true, force: true });
  }
  return result("hook", "contract", kind === "claude-code" ? null : kind.replace("-", "_"), null, checks);
}

interface Upstream {
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}

async function fakeUpstream(reply: string): Promise<Upstream> {
  let n = 0;
  const server: Server = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      n += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(reply);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, hits: () => n, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** One gateway door against a fake model endpoint: a permitted call is forwarded, an over-cap call is refused and never reaches the model, a gate that cannot write blocks. */
export async function testGatewayDoor(prices: PriceSnapshot, door: "openai" | "anthropic" | "responses", opts: { policyYaml?: string } = {}): Promise<SurfaceResult> {
  const checks: CheckResult[] = [];
  const reply =
    door === "openai"
      ? JSON.stringify({ id: "x", object: "chat.completion", model: "claude-opus-5", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })
      : door === "responses"
        ? JSON.stringify({ id: "resp_1", object: "response", status: "completed", model: "claude-opus-5", output: [], usage: { input_tokens: 10, output_tokens: 5 } })
        : JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
  const up = await fakeUpstream(reply);
  const { gate, db } = makeGate(prices, opts.policyYaml ?? POLICY);
  const gw = await startGateway({ upstream: up.url, gate, prices });
  const send = (maxTokens: number): Promise<Response> =>
    door === "openai"
      ? fetch(`${gw.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-self-test" }, body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }], max_tokens: maxTokens }) })
      : door === "responses"
        ? fetch(`${gw.url}/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-self-test" }, body: JSON.stringify({ model: "claude-opus-5", input: "hi", max_output_tokens: maxTokens }) })
        : fetch(`${gw.url}/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "sk-self-test", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-opus-5", max_tokens: maxTokens, messages: [{ role: "user", content: "hi" }] }) });
  try {
    const ok = await send(100);
    checks.push(check("a call within the cap is forwarded and answered", ok.status === 200 && up.hits() === 1, `status ${ok.status}, ${up.hits()} reached the model`));
    // 10 million output tokens on opus reserve far more than the $5 cap.
    const over = await send(10_000_000);
    await over.text();
    checks.push(check("a call over the cap is refused and never reaches the model", over.status >= 400 && over.status < 500 && up.hits() === 1, `status ${over.status}, ${up.hits()} reached the model`));
    // The ledger can no longer be written: every insert is refused.
    db.exec("CREATE TRIGGER selftest_unwritable BEFORE INSERT ON gate_event BEGIN SELECT RAISE(ABORT, 'the ledger cannot be written'); END");
    const broken = await send(100);
    await broken.text();
    checks.push(check("a gate that cannot write blocks the call instead of letting it through", broken.status >= 400 && up.hits() === 1, `status ${broken.status}, ${up.hits()} reached the model`));
  } finally {
    await gw.close();
    await up.close();
  }
  return result(door === "openai" ? "gateway_openai" : door === "responses" ? "gateway_responses" : "gateway_anthropic", "contract", null, null, checks);
}

function runTool(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, closeStdin = false): Promise<{ code: number | null; out: string }> {
  return new Promise((resolveRun) => {
    const quoted = args.map((a) => (/[\s"<>|&]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
    const child = spawn(bin, quoted, { cwd, env, shell: true, ...(closeStdin ? { stdio: ["ignore", "pipe", "pipe"] as const } : {}) });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, out });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolveRun({ code: null, out });
    });
  });
}

/**
 * The hook run against the real Claude Code: a gate that is down, a policy that refuses, and a policy that permits (the control that shows the refusal was the
 * policy and not the hook failing). In each run Claude is asked to write a marker file with its shell tool; the marker's presence is the evidence. Spends a few
 * cents on the cheapest model. Needs `claude` on the PATH and signed in.
 */
export async function testHookLive(prices: PriceSnapshot, opts: { hookMain?: string; timeoutMs?: number } = {}): Promise<SurfaceResult> {
  const version = installedVersion("claude --version");
  if (version === null) return result("hook", "live", "claude_code", null, [check("Claude Code is installed", false, "`claude --version` did not answer")]);
  const hookMain = resolve(opts.hookMain ?? "src/desk/gate/hook-main.ts");
  const checks: CheckResult[] = [];
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const runOne = async (name: string, yaml: string | null, expectMarker: boolean): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "desk-live-"));
    const settings = join(dir, "settings.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${hookMain}"` }] }] } }));
    let server: Awaited<ReturnType<typeof startGateServer>> | undefined;
    let url = "http://127.0.0.1:1";
    let db: DatabaseSync | undefined;
    if (yaml !== null) {
      const g = makeGate(prices, yaml);
      db = g.db;
      server = await startGateServer({ gate: g.gate, token: TOKEN });
      url = server.url;
    }
    try {
      const marker = join(dir, "marker.txt");
      await runTool("claude", 
        ["-p", "Use the Bash tool to run exactly this command and nothing else: echo ENFORCED_MARKER > marker.txt", "--settings", settings, "--allowedTools", "Bash", "--max-turns", "4", "--model", "haiku"],
        dir,
        { ...process.env, DESK_GATE_URL: url, DESK_GATE_TOKEN: TOKEN, DESK_GATE_TIMEOUT_MS: "1500" },
        timeoutMs,
      );
      const ran = existsSync(marker);
      const denied = db === undefined ? null : (db.prepare("SELECT COUNT(*) n FROM gate_event WHERE kind = 'denied'").get() as { n: number }).n;
      checks.push(check(name, ran === expectMarker, `${ran ? "the command ran" : "the command did not run"}${denied === null ? "" : `, ${denied} refusal${denied === 1 ? "" : "s"} recorded by the gate`}`));
    } finally {
      await server?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  await runOne("with no gate running, the call is blocked (fails closed)", null, false);
  await runOne("with a policy that refuses, the call is blocked", POLICY_NONE, false);
  await runOne("with a policy that permits, the call runs (the control)", POLICY_ALL, true);
  return result("hook", "live", "claude_code", version, checks);
}

/**
 * The hook run against the real Codex CLI: a gate that is down, a policy that refuses, and a policy that permits (the control). The hook is given inline, as `-c hooks.PreToolUse`,
 * with Codex's hook trust bypassed for the run (`--dangerously-bypass-hook-trust`): the run vets the one hook it was given itself, and no file of the owner's is touched. Without
 * that flag, or the owner's own review of the hook in Codex (`/hooks`), a hook that was merely installed does not run at all, which is why the install message says so.
 * Codex needs its standard input closed, or it waits for more of it. Spends a few cents.
 */
export async function testHookLiveCodex(prices: PriceSnapshot, opts: { hookMain?: string; timeoutMs?: number } = {}): Promise<SurfaceResult> {
  const version = installedVersion("codex --version");
  if (version === null) return result("hook", "live", "codex", null, [check("Codex CLI is installed", false, "`codex --version` did not answer")]);
  const hookMain = resolve(opts.hookMain ?? "src/desk/gate/hook-main.ts").replaceAll("\\", "/");
  const checks: CheckResult[] = [];
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const runOne = async (name: string, yaml: string | null, expectMarker: boolean): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "desk-live-codex-"));
    let server: Awaited<ReturnType<typeof startGateServer>> | undefined;
    let url = "http://127.0.0.1:1";
    let db: DatabaseSync | undefined;
    if (yaml !== null) {
      const g = makeGate(prices, yaml);
      db = g.db;
      server = await startGateServer({ gate: g.gate, token: TOKEN });
      url = server.url;
    }
    try {
      const marker = join(dir, "marker.txt");
      const hooks = `hooks.PreToolUse=[{matcher='.*',hooks=[{type='command',command='node ${hookMain} --tool codex',timeout=10}]}]`;
      await runTool(
        "codex",
        ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--dangerously-bypass-hook-trust", "-c", hooks, "Use your shell tool to run exactly this command and nothing else: echo ENFORCED_MARKER > marker.txt"],
        dir,
        { ...process.env, DESK_GATE_URL: url, DESK_GATE_TOKEN: TOKEN, DESK_GATE_TIMEOUT_MS: "1500" },
        timeoutMs,
        true,
      );
      const ran = existsSync(marker);
      const denied = db === undefined ? null : (db.prepare("SELECT COUNT(*) n FROM gate_event WHERE kind = 'denied'").get() as { n: number }).n;
      checks.push(check(name, ran === expectMarker, `${ran ? "the command ran" : "the command did not run"}${denied === null ? "" : `, ${denied} refusal${denied === 1 ? "" : "s"} recorded by the gate`}`));
    } finally {
      await server?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  await runOne("with no gate running, the call is blocked (fails closed)", null, false);
  await runOne("with a policy that refuses, the call is blocked", POLICY_NONE, false);
  await runOne("with a policy that permits, the call runs (the control)", POLICY_ALL, true);
  return result("hook", "live", "codex", version, checks);
}
