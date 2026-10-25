import { afterEach, describe, expect, it } from "vitest";

import { rig } from "../gate/harness.ts";
import { closeAll, dayStanding, gateway, ONLY_SONNET_POLICY, upstream, type Handler } from "./helpers.ts";

afterEach(closeAll);

/** The OpenAI Responses route of the gateway (DF-055): it reserves before it forwards, settles from the usage block, and refuses what it cannot meter. */
const responseBody = (model: string, usage: Record<string, unknown>): string => JSON.stringify({ id: "resp_1", object: "response", status: "completed", model, output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage });
const okResponse =
  (model = "claude-opus-5", usage: Record<string, unknown> = { input_tokens: 1000, output_tokens: 500 }): Handler =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(responseBody(model, usage));
  };
const request = (model = "claude-opus-5", extra: Record<string, unknown> = {}) => ({ model, input: "hello", max_output_tokens: 100_000, ...extra });
const post = (url: string, body: unknown, path = "/responses"): Promise<Response> => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-upstream-key-for-tests" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("the gateway: the Responses route", () => {
  it("reserves from max_output_tokens, passes the caller's key on, and settles for the reported usage", async () => {
    const up = await upstream(okResponse());
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, request());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { object: string }).object).toBe("response");
    expect(up.seen[0]?.url).toBe("/v1/responses");
    expect(up.seen[0]?.headers["authorization"]).toBe("Bearer sk-upstream-key-for-tests");
    // $5 in and $25 out per million: 1000 in and 500 out is $0.0175.
    expect(dayStanding(r)).toMatchObject({ spentMicros: 17_500, reservedMicros: 0 });
    expect(g.stats()).toMatchObject({ controlled: 1, allowed: 1 });
  });

  it("reads the cached part out of the input count, and bills reasoning tokens as output", async () => {
    const up = await upstream(okResponse("claude-opus-5", { input_tokens: 10_000, input_tokens_details: { cached_tokens: 8000 }, output_tokens: 1000, output_tokens_details: { reasoning_tokens: 700 } }));
    const r = rig();
    const g = await gateway(up.url, r);
    await post(g.url, request());
    // 2000 in at $5, 8000 cache reads at $0.50, 1000 out at $25 per million: $0.010 + $0.004 + $0.025.
    expect(dayStanding(r).spentMicros).toBe(39_000);
  });

  it("settles a stream from the usage on the response that ends it, and relays the bytes as they came", async () => {
    const sse = (events: [string, object][]): string => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    const stream = sse([
      ["response.created", { type: "response.created", response: { id: "resp_1", status: "in_progress", usage: null } }],
      ["response.output_text.delta", { type: "response.output_text.delta", delta: "hi" }],
      ["response.completed", { type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 2000, output_tokens: 1000 } } }],
    ]);
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(stream);
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, request("claude-opus-5", { stream: true }));
    expect(await res.text()).toBe(stream);
    expect(JSON.parse(up.seen[0]!.body)).not.toHaveProperty("stream_options");
    expect(dayStanding(r)).toMatchObject({ spentMicros: 35_000, reservedMicros: 0 });
  });

  it("settles at the worst case when a stream ends without saying what it used, and frees the reservation when the upstream errors", async () => {
    const cut = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}\n\n`);
    });
    const r1 = rig();
    const g1 = await gateway(cut.url, r1);
    await (await post(g1.url, request("claude-opus-5", { stream: true, max_output_tokens: 1000 }))).text();
    await g1.settled();
    expect(dayStanding(r1).reservedMicros).toBe(0);
    expect(dayStanding(r1).spentMicros).toBeGreaterThan(0);

    const bad = await upstream((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "boom" } }));
    });
    const r2 = rig();
    const g2 = await gateway(bad.url, r2);
    expect((await post(g2.url, request())).status).toBe(500);
    expect(dayStanding(r2)).toMatchObject({ spentMicros: 0, reservedMicros: 0 });
  });

  it("refuses a background response, which reports its cost after the call returns, without forwarding it", async () => {
    const up = await upstream(okResponse());
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, request("claude-opus-5", { background: true }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "unmetered_route" });
    expect(up.seen).toHaveLength(0);
  });

  it("answers a refusal in the OpenAI shape, for a model the policy does not permit and for one with no price", async () => {
    const up = await upstream(okResponse());
    const r = rig({ policyYaml: ONLY_SONNET_POLICY });
    const g = await gateway(up.url, r);
    const denied = await post(g.url, request("claude-opus-5"));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("policy_denied");
    const unknown = await post(g.url, request("gpt-9-unpriced"));
    expect(unknown.status).toBe(403);
    expect(up.seen).toHaveLength(0);
    expect((await post(g.url, request("claude-sonnet-5-5"))).status).toBe(200);
  });

  it("lets a cancel and a token count through without metering, and still refuses other writes to the route", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const r = rig();
    const g = await gateway(up.url, r);
    expect((await post(g.url, {}, "/responses/resp_abc123/cancel")).status).toBe(200);
    expect((await post(g.url, { model: "claude-opus-5", input: "x" }, "/responses/input_tokens")).status).toBe(200);
    expect(g.stats().unmetered).toBe(2);
    const del = await fetch(`${g.url}/responses/resp_abc123`, { method: "DELETE", headers: { authorization: "Bearer k" } });
    expect(del.status).toBe(403);
    expect((await post(g.url, {}, "/responses/../admin/cancel")).status).not.toBe(200);
  });
});
