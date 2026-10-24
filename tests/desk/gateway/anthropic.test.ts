import { afterEach, describe, expect, it } from "vitest";

import { rig } from "../gate/harness.ts";
import { closeAll, dayStanding, gateway, ONLY_SONNET_POLICY, upstream, type Handler } from "./helpers.ts";

afterEach(closeAll);

const messageReply = (model: string, usage: Record<string, unknown>): string => JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage });
const okMessage =
  (model = "claude-opus-5", usage: Record<string, unknown> = { input_tokens: 1000, output_tokens: 500 }): Handler =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(messageReply(model, usage));
  };
const message = (model = "claude-opus-5", extra: Record<string, unknown> = {}) => ({ model, max_tokens: 100_000, messages: [{ role: "user", content: "hello" }], ...extra });
const postMessage = (url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${url}/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "sk-ant-key-for-tests", "anthropic-version": "2023-06-01", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("the gateway: the Anthropic messages route", () => {
  it("reserves from max_tokens, passes the key and version on, and settles for the reported usage", async () => {
    const up = await upstream(okMessage());
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await postMessage(g.url, message());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { type: string }).type).toBe("message");
    expect(up.seen[0]?.url).toBe("/v1/messages");
    expect(up.seen[0]?.headers["x-api-key"]).toBe("sk-ant-key-for-tests");
    expect(up.seen[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(dayStanding(r)).toMatchObject({ spentMicros: 17_500, reservedMicros: 0 });
    expect(g.stats()).toMatchObject({ controlled: 1, allowed: 1 });
  });

  it("prices cache reads and the two kinds of cache write at their own rates", async () => {
    const up = await upstream(okMessage("claude-opus-5", { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 8000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } }));
    const r = rig();
    const g = await gateway(up.url, r);
    await postMessage(g.url, message());
    // $5 in, $0.50 cache read, $6.25 five-minute write and $10 one-hour write per million tokens.
    expect(dayStanding(r).spentMicros).toBe(500 + 4000 + 3125 + 15_000);
  });

  it("counts all cache writes as five-minute ones when the reply does not split them", async () => {
    const up = await upstream(okMessage("claude-opus-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2000 }));
    const r = rig();
    const g = await gateway(up.url, r);
    await postMessage(g.url, message());
    expect(dayStanding(r).spentMicros).toBe(12_500);
  });

  it("relays a stream as it came and settles from the usage in its first and last events, which are cumulative", async () => {
    const sse = (events: [string, object][]): string => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    const stream = sse([
      ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], usage: { input_tokens: 2000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }],
      ["ping", { type: "ping" }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 400 } }],
      ["message_delta", { type: "message_delta", delta: {}, usage: { output_tokens: 1000 } }],
      ["message_stop", { type: "message_stop" }],
    ]);
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(stream);
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await postMessage(g.url, message("claude-opus-5", { stream: true }));
    expect(await res.text()).toBe(stream);
    expect(JSON.parse(up.seen[0]!.body)).not.toHaveProperty("stream_options");
    // 2000 in at $5 and 1000 out at $25 per million: $0.010 + $0.025.
    expect(dayStanding(r)).toMatchObject({ spentMicros: 35_000, reservedMicros: 0 });
  });

  it("answers a refusal in the shape an Anthropic client reads, with the reason", async () => {
    const up = await upstream(okMessage());
    const r = rig({ policyYaml: ONLY_SONNET_POLICY });
    const g = await gateway(up.url, r);
    const denied = await postMessage(g.url, message("claude-opus-5"));
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as { type: string; error: { type: string; message: string; desk_code: string } };
    expect(body).toMatchObject({ type: "error", error: { type: "permission_error", desk_code: "policy_denied" } });
    expect(body.error.message).toMatch(/default deny|no permit/i);
    const over = await postMessage(g.url, message("claude-sonnet-5-5", { max_tokens: 1_000_000 }));
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: { type: string } }).error.type).toBe("rate_limit_error");
    expect(up.seen).toHaveLength(0);
  });

  it("fails closed with an api_error when the gate cannot decide, and refuses a body with no model", async () => {
    const up = await upstream(okMessage());
    const r = rig();
    const g = await gateway(up.url, r);
    const missing = await postMessage(g.url, { max_tokens: 10, messages: [] });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { type: string } }).error.type).toBe("invalid_request_error");
    r.db.close();
    const res = await postMessage(g.url, message());
    expect(res.status).toBe(503);
    expect((await res.json()) as { type: string; error: { type: string } }).toMatchObject({ type: "error", error: { type: "api_error" } });
    expect(up.seen).toHaveLength(0);
  });

  it("relays an upstream error as it came and frees the reserved money", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(529, { "content-type": "application/json" });
      res.end('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await postMessage(g.url, message());
    expect(res.status).toBe(529);
    expect(await res.text()).toBe('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
    expect(dayStanding(r).reservedMicros).toBe(0);
  });

  it("lets token counting through without a reservation, because it costs nothing", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"input_tokens": 12}');
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await fetch(`${g.url}/messages/count_tokens`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" }, body: JSON.stringify(message()) });
    expect(res.status).toBe(200);
    expect(g.stats()).toMatchObject({ unmetered: 1, unmeteredRefused: 0, controlled: 0 });
    expect(r.db.prepare("SELECT COUNT(*) n FROM gate_event").get()).toEqual({ n: 0 });
  });

  it("routes the task type to the model the policy names, and the reply says so", async () => {
    const up = await upstream(okMessage("claude-sonnet-5-5"));
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await postMessage(g.url, message("claude-opus-5"), { "x-desk-task-type": "docs" });
    expect((JSON.parse(up.seen[0]!.body) as { model: string }).model).toBe("claude-sonnet-5-5");
    expect(res.headers.get("x-desk-routed-from")).toBe("claude-opus-5");
  });
});
