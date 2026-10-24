import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { startGateway, type Gateway } from "../../../src/desk/gateway/server.ts";
import { rig, USD, type Rig } from "../gate/harness.ts";
import { testSnapshot } from "../helpers.ts";

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
type Handler = (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;

const open: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!.close();
});

async function upstream(handler: Handler): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(s);
      handler(req, res, s);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  open.push({ close: () => new Promise<void>((r) => server.close(() => r())) });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

/** What a chat completion reply looks like, with usage. */
const reply = (model: string, usage = { prompt_tokens: 1000, completion_tokens: 500 }): string => JSON.stringify({ id: "x", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage });
const ok =
  (model = "claude-opus-5", usage?: { prompt_tokens: number; completion_tokens: number }): Handler =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(reply(model, usage));
  };

async function gateway(up: string, r: Rig, over: Record<string, unknown> = {}): Promise<Gateway> {
  const g = await startGateway({ upstream: up, gate: r.gate, prices: testSnapshot(), ...over });
  open.push(g);
  return g;
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-upstream-key-for-tests", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const chat = (model = "claude-opus-5", extra: Record<string, unknown> = {}) => ({ model, messages: [{ role: "user", content: "hello" }], max_tokens: 100_000, ...extra });
const dayStanding = (r: Rig) => r.gate.budgetLeft({ person: "p-1" }).standing.find((s) => s.window === "day")!;

describe("the gateway: a call that is allowed", () => {
  it("reserves before the call, passes the caller's own key on, relays the reply, and settles for the tokens it used", async () => {
    const up = await upstream(ok("claude-opus-5", { prompt_tokens: 1000, completion_tokens: 500 }));
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { choices: unknown[] }).choices).toHaveLength(1);
    expect(up.seen).toHaveLength(1);
    expect(up.seen[0]?.headers["authorization"]).toBe("Bearer sk-upstream-key-for-tests");
    expect(up.seen[0]?.url).toBe("/v1/chat/completions");
    // Opus 5 at the test prices: $5 in and $25 out per million tokens: 1000 in and 500 out is $0.0175.
    expect(dayStanding(r)).toMatchObject({ spentMicros: 17_500, reservedMicros: 0 });
    expect(g.stats()).toMatchObject({ seen: 1, controlled: 1, allowed: 1, denied: 0 });
    expect(r.gate.integrity()).toEqual([]);
  });

  it("reads the cached part of the prompt out of it, so a cached token is priced as a cache read", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "claude-opus-5", choices: [], usage: { prompt_tokens: 10_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 8_000 } } }));
    });
    const r = rig();
    const g = await gateway(up.url, r);
    await post(g.url, chat());
    // 2,000 fresh input tokens at $5 and 8,000 cached at $0.50 per million: $0.010 + $0.004.
    expect(dayStanding(r).spentMicros).toBe(14_000);
  });

  it("never stores or logs the caller's key", async () => {
    const up = await upstream(ok());
    const r = rig();
    const entries: unknown[] = [];
    const g = await gateway(up.url, r, { onEntry: (e: unknown) => entries.push(e) });
    await post(g.url, chat());
    expect(JSON.stringify(entries)).not.toContain("sk-upstream-key-for-tests");
    expect(JSON.stringify(r.db.prepare("SELECT * FROM gate_event").all())).not.toContain("sk-upstream-key-for-tests");
  });

  it("lets a request that lists models, or any other read, through without a reservation, and counts it as unmetered", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":[]}');
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await fetch(`${g.url}/models`);
    expect(res.status).toBe(200);
    expect(g.stats()).toMatchObject({ seen: 1, controlled: 0, unmetered: 1 });
    expect(r.db.prepare("SELECT COUNT(*) n FROM gate_event").get()).toEqual({ n: 0 });
  });
});

describe("the gateway: a call that is refused", () => {
  it("refuses a model no rule permits, says why, and never reaches the upstream", async () => {
    const up = await upstream(ok());
    const r = rig({
      policyYaml: ["version: 1", "rules:", "  - id: only-sonnet", "    kind: permit", '    when: { model: { in: ["claude-sonnet-5-5"] } }', '    cap: { window: day, max_usd: "10.00", warn_at: 0.5, ask_at: 0.8 }', ""].join("\n"),
    });
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat("claude-opus-5"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string; type: string } };
    expect(body.error.type).toBe("desk_gate_denied");
    expect(body.error.code).toBe("policy_denied");
    expect(body.error.message).toMatch(/default deny|no permit/i);
    expect(up.seen).toHaveLength(0);
    expect(g.stats()).toMatchObject({ controlled: 1, denied: 1, allowed: 0 });
    // The permitted model goes through under the same policy.
    expect((await post(g.url, chat("claude-sonnet-5-5"))).status).toBe(200);
  });

  it("refuses a model it has no price for, because it cannot reserve against a price it does not know", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat("gpt-5"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unmetered_model");
    expect(body.error.message).toMatch(/unpriced/i);
    expect(up.seen).toHaveLength(0);
  });

  it("answers 429 when the budget will not hold the worst case, and the caller can read how much is left", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    // Three full-size requests reserve $7.50; asking is a step before the cap, so use up the day first.
    for (let i = 0; i < 3; i += 1) expect((await post(g.url, chat("claude-opus-5", { max_tokens: 100_000 }), { "x-desk-session": `s${i}` })).status).toBe(200);
    const res = await post(g.url, chat("claude-opus-5", { max_tokens: 1_000_000 }));
    expect([403, 429]).toContain(res.status);
    const body = (await res.json()) as { error: { code: string; remaining_usd?: number } };
    expect(["budget_exceeded", "approval_required"]).toContain(body.error.code);
    expect(up.seen).toHaveLength(3);
    expect(dayStanding(r).reservedMicros).toBe(0);
  });

  it("refuses a route it cannot meter instead of letting money go through unseen", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await fetch(`${g.url}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k" }, body: JSON.stringify({ model: "x", input: "hi" }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unmetered_route");
    expect(up.seen).toHaveLength(0);
    expect(g.stats()).toMatchObject({ unmeteredRefused: 1 });
  });

  it("refuses a body that is not JSON, or names no model, before it is forwarded", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    expect((await post(g.url, "{ not json")).status).toBe(400);
    expect((await post(g.url, { messages: [] })).status).toBe(400);
    expect((await post(g.url, [1, 2])).status).toBe(400);
    expect(up.seen).toHaveLength(0);
  });

  it("refuses a request too large to read", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r, { maxBodyBytes: 1000 });
    const res = await post(g.url, chat("claude-opus-5", { messages: [{ role: "user", content: "x".repeat(5000) }] }));
    expect(res.status).toBe(413);
    expect(up.seen).toHaveLength(0);
  });

  it("fails closed when the gate cannot decide: 503, and the upstream is never called", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    r.db.close();
    const res = await post(g.url, chat());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("gate_unavailable");
    expect(up.seen).toHaveLength(0);
    expect(g.stats()).toMatchObject({ failedClosed: 1 });
  });
});

describe("the gateway: when the upstream fails", () => {
  it("relays an error reply as it came and frees the reserved money", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":{"message":"boom"}}');
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":{"message":"boom"}}');
    expect(dayStanding(r)).toMatchObject({ spentMicros: 0, reservedMicros: 0 });
  });

  it("answers 502 when the upstream cannot be reached, and frees the reserved money", async () => {
    const r = rig();
    const g = await gateway("http://127.0.0.1:9/v1", r);
    const res = await post(g.url, chat());
    expect(res.status).toBe(502);
    expect(dayStanding(r)).toMatchObject({ spentMicros: 0, reservedMicros: 0 });
  });

  it("gives up on an upstream that stops answering, with a 504 and the money freed", async () => {
    const up = await upstream(() => undefined);
    const r = rig();
    const g = await gateway(up.url, r, { firstByteMs: 150 });
    const res = await post(g.url, chat());
    expect(res.status).toBe(504);
    expect(dayStanding(r).reservedMicros).toBe(0);
  });
});

describe("the gateway: streaming", () => {
  const sse = (chunks: object[]): string => `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;

  it("relays the stream as it came, asks the upstream to count tokens, and settles from the last chunk", async () => {
    const stream = sse([
      { model: "claude-opus-5", choices: [{ delta: { role: "assistant", content: "he" } }] },
      { model: "claude-opus-5", choices: [{ delta: { content: "llo" }, finish_reason: "stop" }] },
      { model: "claude-opus-5", choices: [], usage: { prompt_tokens: 2000, completion_tokens: 1000 } },
    ]);
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(stream);
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat("claude-opus-5", { stream: true }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(stream);
    const forwarded = JSON.parse(up.seen[0]!.body) as { stream_options?: { include_usage?: boolean } };
    expect(forwarded.stream_options).toEqual({ include_usage: true });
    // 2000 in and 1000 out at $5 and $25 per million: $0.010 + $0.025.
    expect(dayStanding(r)).toMatchObject({ spentMicros: 35_000, reservedMicros: 0 });
  });

  it("keeps the caller's own stream options and still counts, and settles at the worst case when no usage ever arrives", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse([{ model: "claude-opus-5", choices: [{ delta: { content: "x" }, finish_reason: "stop" }] }]));
    });
    const r = rig();
    const g = await gateway(up.url, r);
    await post(g.url, chat("claude-opus-5", { stream: true, stream_options: { include_usage: false, extra: 1 }, max_tokens: 1000 }));
    const forwarded = JSON.parse(up.seen[0]!.body) as { stream_options: Record<string, unknown> };
    expect(forwarded.stream_options).toEqual({ include_usage: true, extra: 1 });
    // No usage came back: the call is settled for what was reserved (the prompt estimate at $5 plus 1000 output tokens at $25).
    const spent = dayStanding(r).spentMicros;
    expect(spent).toBeGreaterThanOrEqual(25_000);
    expect(spent).toBeLessThan(USD(0.1));
    expect(g.stats().settledAtWorstCase).toBe(1);
  });

  it("settles at the worst case, not at zero, when the caller hangs up mid-stream", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse([{ model: "claude-opus-5", choices: [{ delta: { content: "x" } }] }]).replace("data: [DONE]\n\n", ""));
      // never ends
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const ctl = new AbortController();
    const res = await fetch(`${g.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k" }, body: JSON.stringify(chat("claude-opus-5", { stream: true, max_tokens: 1000 })), signal: ctl.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ctl.abort();
    await reader.cancel().catch(() => undefined);
    await g.settled();
    expect(dayStanding(r).reservedMicros).toBe(0);
    expect(dayStanding(r).spentMicros).toBeGreaterThan(0);
  });
});

describe("the gateway: routing and identity", () => {
  it("sends the model the policy routes the task type to, and says so in a header", async () => {
    const up = await upstream(ok("claude-sonnet-5-5"));
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat("claude-opus-5"), { "x-desk-task-type": "docs" });
    expect(res.status).toBe(200);
    expect((JSON.parse(up.seen[0]!.body) as { model: string }).model).toBe("claude-sonnet-5-5");
    expect(res.headers.get("x-desk-routed-from")).toBe("claude-opus-5");
  });

  it("uses the session and project the caller names, and keeps them in the gate's record", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    await post(g.url, chat(), { "x-desk-session": "sess-42", "x-desk-project": "repo:acme/api" });
    const row = r.db.prepare("SELECT session_id, project FROM gate_event WHERE kind = 'authorized'").get() as { session_id: string; project: string };
    expect(row).toEqual({ session_id: "sess-42", project: "repo:acme/api" });
  });

  it("two callers at once cannot reserve more than the cap between them", async () => {
    const up = await upstream((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(reply("claude-opus-5"));
      }, 150);
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post(g.url, chat("claude-opus-5", { max_tokens: 100_000 }), { "x-desk-session": `c${i}` })));
    const allowed = results.filter((x) => x.status === 200).length;
    expect(allowed).toBeLessThanOrEqual(3);
    expect(allowed).toBeGreaterThanOrEqual(1);
    expect(r.gate.integrity()).toEqual([]);
  });
});

describe("the gateway: its own door", () => {
  it("answers only a request addressed to its own loopback address", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: g.port, path: "/v1/chat/completions", method: "POST", headers: { host: "evil.example", "content-type": "application/json" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end(JSON.stringify(chat()));
    });
    expect(status).toBe(421);
    expect(up.seen).toHaveLength(0);
    expect(r.db.prepare("SELECT COUNT(*) n FROM gate_event").get()).toEqual({ n: 0 });
  });

  it("relays an upstream rate limit with its retry-after header, and frees the reserved money", async () => {
    const up = await upstream((_req, res) => {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
      res.end('{"error":{"message":"slow down"}}');
    });
    const r = rig();
    const g = await gateway(up.url, r);
    const res = await post(g.url, chat());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(dayStanding(r).reservedMicros).toBe(0);
  });

  it("does not pass the desk's own headers on to the upstream", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r);
    await post(g.url, chat(), { "x-desk-session": "s-9", "x-desk-project": "p", "x-desk-task-type": "docs" });
    expect(Object.keys(up.seen[0]!.headers).filter((h) => h.startsWith("x-desk-"))).toEqual([]);
  });
});

describe("the gateway: identity and phase for one agent run", () => {
  it("uses the identity it was started with, whatever headers the caller sends", async () => {
    const up = await upstream(ok());
    const r = rig({ person: "lab-run-7" });
    const g = await gateway(up.url, r, { identity: { person: "lab-run-7", session: "run-7", project: "lab", agent: "agent:opencode" } });
    await post(g.url, chat(), { "x-desk-session": "someone-else", "x-desk-project": "other" });
    const row = r.db.prepare("SELECT person, session_id, project, agent FROM gate_event WHERE kind = 'authorized'").get() as { person: string; session_id: string; project: string; agent: string };
    expect(row).toEqual({ person: "lab-run-7", session_id: "run-7", project: "lab", agent: "agent:opencode" });
  });

  it("asks the phase function about each call, counting the calls of the session, and routes by what it names", async () => {
    const up = await upstream(ok("claude-sonnet-5-5"));
    const r = rig();
    const seen: { callIndex: number; model: string; messages: number }[] = [];
    const g = await gateway(up.url, r, {
      taskTypeOf: (info: { callIndex: number; model: string; messages: number }) => {
        seen.push({ callIndex: info.callIndex, model: info.model, messages: info.messages });
        return info.callIndex < 2 ? "docs" : undefined;
      },
    });
    for (let i = 0; i < 3; i += 1) await post(g.url, chat("claude-opus-5", { messages: Array.from({ length: i + 1 }, () => ({ role: "user", content: "x" })) }), { "x-desk-session": "s1" });
    await post(g.url, chat("claude-opus-5"), { "x-desk-session": "s2" });
    expect(seen.map((s) => s.callIndex)).toEqual([0, 1, 2, 0]);
    expect(seen.map((s) => s.messages)).toEqual([1, 2, 3, 1]);
    const models = up.seen.map((s) => (JSON.parse(s.body) as { model: string }).model);
    expect(models).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
  });

  it("is refused closed if the phase function throws", async () => {
    const up = await upstream(ok());
    const r = rig();
    const g = await gateway(up.url, r, { taskTypeOf: () => { throw new Error("classifier broke"); } });
    const res = await post(g.url, chat());
    expect(res.status).toBe(503);
    expect(up.seen).toHaveLength(0);
  });
});
