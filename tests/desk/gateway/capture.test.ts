import { afterEach, describe, expect, it } from "vitest";

import { saveCapture, trajectoryOf, type GatewayCapture } from "../../../src/desk/capture/gateway.ts";
import { openCapture } from "../../../src/desk/capture/store.ts";
import { trajectoryFromRecords } from "../../../src/desk/trajectory/read.ts";
import { classifyTool } from "../../../src/desk/trajectory/tools.ts";
import { replayability } from "../../../src/desk/trajectory/replayability.ts";
import { rig } from "../gate/harness.ts";
import { closeAll, gateway, ONLY_SONNET_POLICY, upstream } from "./helpers.ts";

afterEach(closeAll);

/** Trajectories kept at the gateway (DF-040): each family's conversation read into steps, keyed as the log reader keys them, and a capture that cannot harm a call. */
const CALL = { path: "src/a.ts" };
const t0 = "2026-10-25T10:00:00.000Z";

const openAi = (withResult: boolean): GatewayCapture => ({
  ts: t0, family: "openai", session: "s-openai", model: "claude-opus-5",
  request: { model: "claude-opus-5", messages: [
    { role: "user", content: "read the file" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: JSON.stringify({ file_path: CALL.path }) } }] },
    ...(withResult ? [{ role: "tool", tool_call_id: "call_1", content: "export const a = 1;" }] : []),
  ] },
  response: { choices: [{ message: { role: "assistant", content: "done" } }] },
});
const anthropic: GatewayCapture = {
  ts: t0, family: "anthropic", session: "s-anthropic", model: "claude-opus-5",
  request: { model: "claude-opus-5", max_tokens: 100, messages: [
    { role: "user", content: "read the file" },
    { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { file_path: CALL.path } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "export const a = 1;" }] }] },
  ] },
  response: { content: [{ type: "text", text: "done" }] },
};
const responses: GatewayCapture = {
  ts: t0, family: "responses", session: "s-responses", model: "claude-opus-5",
  request: { model: "claude-opus-5", input: [
    { type: "message", role: "user", content: "read the file" },
    { type: "function_call", call_id: "fc_1", name: "Read", arguments: JSON.stringify({ file_path: CALL.path }) },
    { type: "function_call_output", call_id: "fc_1", output: "export const a = 1;" },
  ] },
  response: { output: [{ type: "function_call", call_id: "fc_2", name: "Bash", arguments: JSON.stringify({ command: "npm test" }) }] },
};

describe("a conversation read into steps", () => {
  it("reads the tool calls and their results of each family, and the call a reply asks for as one with no result yet", () => {
    for (const c of [openAi(true), anthropic, responses]) {
      const t = trajectoryOf(c, { keepText: true });
      expect(t.sessionId).toBe(c.session);
      expect(t.steps[0], c.family).toMatchObject({ tool: "Read", kind: { class: "read_only" }, result: { present: true, text: "export const a = 1;", isError: false } });
      expect(t.prompts, c.family).toBe(1);
    }
    const r = trajectoryOf(responses);
    expect(r.steps.map((s) => [s.tool, s.result.present])).toEqual([["Read", true], ["Bash", false]]);
    const open = trajectoryOf(openAi(false));
    expect(open.steps.map((s) => s.result.present)).toEqual([false]);
  });

  it("gives a call the same key whether it came from the gateway or from the tool's own log", () => {
    const fromLog = trajectoryFromRecords([
      { type: "assistant", sessionId: "x", timestamp: t0, message: { content: [{ type: "tool_use", id: "t", name: "Read", input: { file_path: CALL.path } }] } },
      { type: "user", sessionId: "x", timestamp: t0, message: { content: [{ type: "tool_result", tool_use_id: "t", content: "export const a = 1;" }] } },
    ], "sha", 0);
    for (const c of [openAi(true), anthropic, responses]) expect(trajectoryOf(c).steps[0]!.keySha, c.family).toBe(fromLog.steps[0]!.keySha);
  });

  it("redacts a credential in a result, and keeps no text unless asked", () => {
    const secret = ["sk", "ant", "api03", "A".repeat(40)].join("-");
    const c = openAi(true);
    (c.request as { messages: { content?: string }[] }).messages[2]!.content = `KEY=${secret}`;
    const kept = trajectoryOf(c, { keepText: true });
    expect(JSON.stringify(kept)).not.toContain(secret);
    expect(kept.steps[0]!.result.text).toContain("(redacted)");
    expect(trajectoryOf(c).steps[0]!.result.text).toBeNull();
  });

  it("keeps a trajectory in the store as a gateway one, replaced by the latest of its session, apart from a log's", () => {
    const store = openCapture(":memory:");
    expect(saveCapture(store, openAi(false), { keep: true })).not.toBeNull();
    const id = saveCapture(store, openAi(true), { keep: true });
    expect(store.prepare("SELECT source, results_present AS p, results_missing AS m, eligible FROM trajectory WHERE trajectory_id = ?").get(id)).toMatchObject({ source: "gateway", p: 1, m: 0 });
    expect((store.prepare("SELECT COUNT(*) n FROM trajectory WHERE session_id = 's-openai'").get() as { n: number }).n).toBe(1);
    expect((store.prepare("SELECT COUNT(*) n FROM trajectory_step").get() as { n: number }).n).toBe(1);
    expect(saveCapture(store, { ...openAi(true), request: { messages: [{ role: "user", content: "hello" }] }, response: { choices: [{ message: { content: "hi" } }] } }, { keep: true })).toBeNull();
    expect(replayability(trajectoryOf(openAi(true))).class).toBe("full");
  });
});

describe("the names other tools give their tools", () => {
  it("takes Gemini CLI's and Codex's reading tools as reads, their writing tools as writes, and Codex's list-of-words shell by what it runs", () => {
    const kind = (name: string, input: unknown) => classifyTool(name, input);
    for (const n of ["read_file", "read_many_files", "list_directory", "glob", "search_file_content", "update_plan"]) expect(kind(n, {}), n).toMatchObject({ class: "read_only", effect: "workspace_read" });
    for (const n of ["google_web_search", "web_fetch"]) expect(kind(n, {}), n).toMatchObject({ class: "read_only", effect: "network_read" });
    for (const n of ["write_file", "replace", "apply_patch", "Delete"]) expect(kind(n, {}), n).toMatchObject({ class: "mutating", effect: "file_edit" });
    expect(kind("shell", { command: ["ls", "-la"] })).toMatchObject({ class: "read_only" });
    expect(kind("shell", { command: ["rm", "-rf", "build"] })).toMatchObject({ class: "mutating", effect: "shell" });
    expect(kind("run_shell_command", { command: "git status" })).toMatchObject({ class: "read_only" });
    expect(kind("run_shell_command", { command: "git push" })).toMatchObject({ class: "mutating" });
    expect(kind("mystery_tool", {})).toMatchObject({ class: "mutating", effect: "unknown" });
  });
});

describe("at the gateway", () => {
  const reply = (usage: Record<string, unknown>) => JSON.stringify({ id: "c", object: "chat.completion", model: "claude-opus-5", choices: [{ index: 0, message: { role: "assistant", content: "ok" } }], usage });
  const post = (url: string, body: unknown) => fetch(`${url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k", "x-desk-session": "s-live" }, body: JSON.stringify(body) });

  it("hands a finished call to the sink with the request and the whole reply, and nothing for a call that was refused or failed", async () => {
    const seen: GatewayCapture[] = [];
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(reply({ prompt_tokens: 10, completion_tokens: 5 }));
    });
    const r = rig({ policyYaml: ONLY_SONNET_POLICY });
    const g = await gateway(up.url, r, { capture: (c: GatewayCapture) => seen.push(c) });
    expect((await post(g.url, { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], max_tokens: 100 })).status).toBe(200);
    expect((await post(g.url, { model: "claude-opus-5", messages: [{ role: "user", content: "hi" }], max_tokens: 100 })).status).toBe(403);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ family: "openai", session: "s-live", model: "claude-sonnet-5-5", response: { choices: [{ message: { content: "ok" } }] } });
  });

  it("answers a call exactly as it would have when the sink throws, and counts the failure", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(reply({ prompt_tokens: 10, completion_tokens: 5 }));
    });
    const g = await gateway(up.url, rig(), { capture: () => { throw new Error("disk full"); } });
    const res = await post(g.url, { model: "claude-opus-5", messages: [{ role: "user", content: "hi" }], max_tokens: 100 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { choices: unknown[] }).choices).toHaveLength(1);
    expect(g.stats().captureFailed).toBe(1);
  });

  it("captures a stream without its reply, since the next request holds that turn", async () => {
    const seen: GatewayCapture[] = [];
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
    });
    const g = await gateway(up.url, rig(), { capture: (c: GatewayCapture) => seen.push(c) });
    await (await post(g.url, { model: "claude-opus-5", stream: true, messages: [{ role: "user", content: "hi" }], max_tokens: 100 })).text();
    await g.settled();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.response).toBeNull();
  });
});
