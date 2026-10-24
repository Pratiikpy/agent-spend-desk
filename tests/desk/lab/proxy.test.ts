import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { startProxy, type Proxy, type ProxyEntry } from "../../../src/desk/lab/proxy.ts";

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>;

interface Fake {
  url: string;
  seen: { headers: IncomingMessage["headers"]; body: string; path: string }[];
  maxInFlight: () => number;
  close: () => Promise<void>;
}

const open: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

/** A model endpoint that answers each request with the next handler in the list (the last one repeats). */
async function fakeUpstream(handlers: Handler[]): Promise<Fake> {
  const seen: Fake["seen"] = [];
  let inFlight = 0;
  let peak = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ headers: req.headers, body, path: req.url ?? "" });
      const h = handlers[Math.min(seen.length - 1, handlers.length - 1)] as Handler;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      res.on("close", () => {
        inFlight -= 1;
      });
      void Promise.resolve(h(req, res, body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const fake: Fake = {
    url,
    seen,
    maxInFlight: () => peak,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
  open.push(fake);
  return fake;
}

async function proxyFor(upstream: string, extra: Partial<Parameters<typeof startProxy>[0]> = {}): Promise<{ proxy: Proxy; entries: ProxyEntry[] }> {
  const entries: ProxyEntry[] = [];
  const proxy = await startProxy({ upstream, apiKey: "upstream-secret-key", onEntry: (e) => entries.push(e), sleep: async () => undefined, ...extra });
  open.push(proxy);
  return { proxy, entries };
}

const json = (obj: unknown): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const chunk = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
const sse = (events: string[]): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(e);
  res.end();
};

const REPLY = { model: "m-1", choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 3 } };
const post = (url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("the lab proxy: what it sends upstream", () => {
  it("replaces the client's key with its own and gives every call a scope of its own", async () => {
    const up = await fakeUpstream([json(REPLY)]);
    const { proxy } = await proxyFor(up.url);
    await post(proxy.runUrl("r1"), { messages: [] }, { authorization: "Bearer client-dummy" });
    await post(proxy.runUrl("r1"), { messages: [] });
    expect(up.seen[0]?.headers["authorization"]).toBe("Bearer upstream-secret-key");
    const scopes = up.seen.map((s) => String(s.headers["meterless-scope"]));
    expect(scopes[0]).toMatch(/^lab-r1-/);
    expect(new Set(scopes).size).toBe(2);
    expect(up.seen[0]?.path).toBe("/v1/chat/completions");
  });

  it("passes the request body through untouched", async () => {
    const up = await fakeUpstream([json(REPLY)]);
    const { proxy } = await proxyFor(up.url);
    await post(proxy.runUrl("r1"), { model: "x", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(JSON.parse(up.seen[0]?.body ?? "{}")).toEqual({ model: "x", messages: [{ role: "user", content: "hi" }], tools: [] });
  });

  it("refuses a path that is not under a run, and a run id with odd characters", async () => {
    const up = await fakeUpstream([json(REPLY)]);
    const { proxy } = await proxyFor(up.url);
    const base = `http://127.0.0.1:${proxy.port}`;
    expect((await fetch(`${base}/v1/chat/completions`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/run/a%20b/v1/chat/completions`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/run/../v1/chat/completions`, { method: "POST", body: "{}" })).status).toBe(404);
    expect(up.seen).toHaveLength(0);
  });
});

describe("the lab proxy: what it records", () => {
  it("records tokens, model, latency and size for a plain reply, and never the text", async () => {
    const up = await fakeUpstream([json(REPLY)]);
    const { proxy, entries } = await proxyFor(up.url);
    const r = await post(proxy.runUrl("r1"), { messages: [{ role: "user", content: "a secret prompt" }] });
    expect(((await r.json()) as typeof REPLY).choices[0]?.message.content).toBe("hello");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ run: "r1", status: 200, stream: false, model: "m-1", promptTokens: 11, completionTokens: 3, finishReason: "stop", retries: 0, toolCalls: 0 });
    expect(entries[0]?.requestBytes).toBeGreaterThan(10);
    const text = JSON.stringify(entries);
    expect(text).not.toContain("a secret prompt");
    expect(text).not.toContain("hello");
    expect(text).not.toContain("upstream-secret-key");
  });

  it("forwards a stream in order and records usage, tool calls, finish reason and the Nightshift receipt", async () => {
    const receipt = { schema: "meterless.compute_receipt.v1", receipt_id: "rc_1", usage: { latency_ms: 5 } };
    const events = [
      chunk({ model: "m-1", choices: [{ delta: { role: "assistant" } }], usage: null }),
      chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read", arguments: "{" } }] } }] }),
      chunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "edit", arguments: "{}" } }] } }] }),
      chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }], meterless: receipt }),
      chunk({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 2 } } }),
      "data: [DONE]\n\n",
    ];
    const up = await fakeUpstream([sse(events)]);
    const { proxy, entries } = await proxyFor(up.url);
    const r = await post(proxy.runUrl("r2"), { stream: true });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const text = await r.text();
    expect(text).toBe(events.join(""));
    expect(entries[0]).toMatchObject({ stream: true, promptTokens: 40, completionTokens: 9, reasoningTokens: 2, finishReason: "tool_calls", toolCalls: 2, receiptId: "rc_1" });
  });

  it("takes the receipt id from a stream block that has no schema field, as Nightshift sends it", async () => {
    const up = await fakeUpstream([sse([chunk({ choices: [{ delta: { content: "hi" } }], meterless: { receipt_id: "rcpt_req_abc", decision_id: "req_abc", from_cache: false } }), chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }), "data: [DONE]\n\n"])]);
    const { proxy, entries } = await proxyFor(up.url);
    await (await post(proxy.runUrl("r1"), { stream: true })).text();
    expect(entries[0]?.receiptId).toBe("rcpt_req_abc");
    expect(entries[0]?.fromCache).toBeUndefined();
  });

  it("flags a reply Nightshift served from its cache", async () => {
    const up = await fakeUpstream([json({ ...REPLY, meterless: { from_cache: true } })]);
    const { proxy, entries } = await proxyFor(up.url);
    await post(proxy.runUrl("r1"), {});
    expect(entries[0]?.fromCache).toBe(true);
  });
});

describe("the lab proxy: retries", () => {
  it("repeats a call that got a 429 and hands the client the good reply", async () => {
    const limited: Handler = (_req, res) => {
      res.writeHead(429, { "retry-after": "1" });
      res.end("slow down");
    };
    const up = await fakeUpstream([limited, limited, json(REPLY)]);
    const { proxy, entries } = await proxyFor(up.url);
    const r = await post(proxy.runUrl("r1"), {});
    expect(r.status).toBe(200);
    expect(up.seen).toHaveLength(3);
    expect(entries[0]).toMatchObject({ status: 200, retries: 2 });
  });

  it("repeats a stream that failed with a rate limit before any content, and the client never sees the failure", async () => {
    const bad = sse([chunk({ choices: [{ delta: { role: "assistant" } }] }), chunk({ error: { message: '429: {"status":429,"title":"Too Many Requests"}', code: "provider_error" } }), "data: [DONE]\n\n"]);
    const good = sse([chunk({ choices: [{ delta: { role: "assistant" } }] }), chunk({ choices: [{ delta: { content: "ok" } }] }), chunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), "data: [DONE]\n\n"]);
    const up = await fakeUpstream([bad, good]);
    const { proxy, entries } = await proxyFor(up.url);
    const r = await post(proxy.runUrl("r1"), { stream: true });
    const text = await r.text();
    expect(text).toContain('"content":"ok"');
    expect(text).not.toContain("Too Many Requests");
    expect(entries[0]).toMatchObject({ retries: 1, promptTokens: 5 });
    expect(entries[0]?.error).toBeUndefined();
  });

  it("repeats a stream the model endpoint ended with an empty response before any content", async () => {
    const empty = sse([chunk({ choices: [{ delta: { role: "assistant" } }] }), chunk({ error: { message: "/model-x_empty_response", code: "provider_error" } }), "data: [DONE]\n\n"]);
    const good = sse([chunk({ choices: [{ delta: { content: "ok" } }] }), chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }), "data: [DONE]\n\n"]);
    const up = await fakeUpstream([empty, good]);
    const { proxy, entries } = await proxyFor(up.url);
    const text = await (await post(proxy.runUrl("r1"), { stream: true })).text();
    expect(text).toContain("ok");
    expect(text).not.toContain("empty_response");
    expect(entries[0]?.retries).toBe(1);
  });

  it("does not repeat a stream that failed after content was already sent, and records the error", async () => {
    const partial = sse([chunk({ choices: [{ delta: { content: "half" } }] }), chunk({ error: { message: "502 bad gateway", code: "provider_error" } }), "data: [DONE]\n\n"]);
    const up = await fakeUpstream([partial, json(REPLY)]);
    const { proxy, entries } = await proxyFor(up.url);
    const r = await post(proxy.runUrl("r1"), { stream: true });
    expect(await r.text()).toContain("half");
    expect(up.seen).toHaveLength(1);
    expect(entries[0]?.retries).toBe(0);
    expect(entries[0]?.error).toMatch(/502/);
  });

  it("gives up after the limit and passes on the last status, with the error recorded", async () => {
    const limited: Handler = (_req, res) => {
      res.writeHead(429);
      res.end("no");
    };
    const up = await fakeUpstream([limited]);
    const { proxy, entries } = await proxyFor(up.url, { maxRetries: 2 });
    const r = await post(proxy.runUrl("r1"), {});
    expect(r.status).toBe(429);
    expect(up.seen).toHaveLength(3);
    expect(entries[0]).toMatchObject({ status: 429, retries: 2 });
  });

  it("does not repeat a client error such as a 400", async () => {
    const up = await fakeUpstream([(_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad request", code: "invalid" } }));
    }]);
    const { proxy, entries } = await proxyFor(up.url);
    const r = await post(proxy.runUrl("r1"), {});
    expect(r.status).toBe(400);
    expect(up.seen).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 400, retries: 0 });
    expect(entries[0]?.error).toMatch(/bad request/);
  });

  it("answers 502 when the model endpoint cannot be reached at all", async () => {
    const { proxy, entries } = await proxyFor("http://127.0.0.1:1/v1", { maxRetries: 1 });
    const r = await post(proxy.runUrl("r1"), {});
    expect(r.status).toBe(502);
    expect(entries[0]?.error).toMatch(/unreachable/);
    expect(entries[0]?.retries).toBe(1);
  });

  it("repeats a stream that stalls, then reports it if it keeps stalling", async () => {
    const stall = (_req: IncomingMessage, res: ServerResponse): void => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk({ choices: [{ delta: { role: "assistant" } }] }));
    };
    const up = await fakeUpstream([stall, json(REPLY)]);
    const { proxy, entries } = await proxyFor(up.url, { firstByteMs: 150 });
    const r = await post(proxy.runUrl("r1"), {});
    expect(r.status).toBe(200);
    expect(entries[0]?.retries).toBe(1);
  });
});

describe("the lab proxy: an endpoint that stalls", () => {
  const stall = (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ choices: [{ delta: { role: "assistant" } }] }));
  };

  it("gives up after the call budget and answers 504, instead of holding the run open or sending an empty stream", async () => {
    const up = await fakeUpstream([stall]);
    const { proxy, entries } = await proxyFor(up.url, { firstByteMs: 60, maxCallMs: 200, maxRetries: 50 });
    const t0 = Date.now();
    const r = await post(proxy.runUrl("r1"), { stream: true });
    expect(r.status).toBe(504);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(entries[0]).toMatchObject({ status: 504 });
    expect(entries[0]?.error).toMatch(/stream broke/);
    expect(up.seen.length).toBeLessThan(10);
  });

  it("lists a run's open calls while they are open and none after, and settle waits for the last record", async () => {
    const hang: Handler = () => undefined;
    const up = await fakeUpstream([hang]);
    const { proxy, entries } = await proxyFor(up.url, { abandonedErrorMs: 50 });
    expect(proxy.inflight("r1")).toEqual([]);
    const ctl = new AbortController();
    const gone = fetch(`${proxy.runUrl("r1")}/chat/completions`, { method: "POST", body: "{}", signal: ctl.signal }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
    expect(proxy.inflight("r1")).toHaveLength(1);
    expect(proxy.inflight("r1")[0]!.ageMs).toBeGreaterThanOrEqual(100);
    expect(proxy.inflight("other")).toEqual([]);
    ctl.abort();
    await gone;
    await proxy.settle("r1");
    expect(proxy.inflight("r1")).toEqual([]);
    expect(entries.at(-1)?.error).toMatch(/client stopped waiting/);
  });

  it("does not call a short call the client dropped an error", async () => {
    const hang: Handler = () => undefined;
    const up = await fakeUpstream([hang]);
    const { proxy, entries } = await proxyFor(up.url, { abandonedErrorMs: 60_000 });
    const ctl = new AbortController();
    const gone = fetch(`${proxy.runUrl("r1")}/chat/completions`, { method: "POST", body: "{}", signal: ctl.signal }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 80));
    ctl.abort();
    await gone;
    await proxy.settle("r1");
    expect(entries.at(-1)?.error).toBeUndefined();
  });
});

describe("the lab proxy: sharing the endpoint", () => {
  it("lets no more calls through at once than it was told to", async () => {
    const slow: Handler = async (_req, res) => {
      await new Promise((r) => setTimeout(r, 80));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(REPLY));
    };
    const up = await fakeUpstream([slow]);
    const { proxy } = await proxyFor(up.url, { maxConcurrent: 2 });
    await Promise.all(Array.from({ length: 6 }, (_, i) => post(proxy.runUrl(`r${i}`), {})));
    expect(up.maxInFlight()).toBeLessThanOrEqual(2);
    expect(up.seen).toHaveLength(6);
  });

  it("stops the upstream call when the client goes away, logs it, and keeps serving", async () => {
    let aborted = false;
    const hang: Handler = (_req, res) => {
      res.on("close", () => {
        aborted = true;
      });
    };
    const up = await fakeUpstream([hang, json(REPLY)]);
    const { proxy, entries } = await proxyFor(up.url);
    const ctl = new AbortController();
    const gone = fetch(`${proxy.runUrl("r9")}/chat/completions`, { method: "POST", body: "{}", signal: ctl.signal }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    ctl.abort();
    await gone;
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(true);
    const ok = await post(proxy.runUrl("r2"), {});
    expect(ok.status).toBe(200);
    expect(entries.some((e) => e.run === "r2" && e.status === 200)).toBe(true);
  });
});
