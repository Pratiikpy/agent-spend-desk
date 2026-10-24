import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ModelError, OpenAiPort } from "../../src/desk/agents/model.ts";
import { deliver, type DeliveryDeps } from "../../src/desk/alerts/deliver.ts";
import { callGate } from "../../src/desk/gate/client.ts";
import { describeManifest, declaredFetch, destination, EgressRefused, isLoopbackHost, manifestFromEnv, originOf, profileOf } from "../../src/desk/security/net.ts";
import { runLive, SiloError } from "../../src/sponsors/zetaris/silo-port.ts";

// Stand-in credentials, assembled at run time so that nothing in this file looks like a real one.
const MODEL_KEY = ["stand", "in", "model", "0123456789"].join("-");
const SILO_KEY = ["stand", "in", "silo", "9876543210"].join("-");
const GATE_TOKEN = ["stand", "in", "gate", "5555555555"].join("-");

interface Listener {
  server: Server;
  origin: string;
  connections: number;
  requests: string[];
}

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => { s.closeAllConnections?.(); s.close(() => r()); })));
});

const ok = (_req: IncomingMessage, res: ServerResponse): void => {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end("{}");
};

/** A server on a free loopback port that counts connections, which is what a network monitor sees. */
async function listen(respond: (req: IncomingMessage, res: ServerResponse) => void = ok): Promise<Listener> {
  const l: Listener = { server: createServer(), origin: "", connections: 0, requests: [] };
  l.server.on("connection", () => { l.connections += 1; });
  l.server.on("request", (req, res) => { l.requests.push(`${req.method} ${req.url}`); respond(req, res); });
  await new Promise<void>((r) => l.server.listen(0, "127.0.0.1", r));
  l.origin = `http://127.0.0.1:${(l.server.address() as AddressInfo).port}`;
  open.push(l.server);
  return l;
}

const dest = (url: string, kind: "model" | "webhook" = "model") => destination(kind, url, "test", "test") as NonNullable<ReturnType<typeof destination>>;

describe("addresses", () => {
  it("reads an origin, and nothing that is not http or https", () => {
    expect(originOf("https://integrate.api.nvidia.com/v1/chat")).toBe("https://integrate.api.nvidia.com");
    expect(originOf("http://127.0.0.1:8088/v1")).toBe("http://127.0.0.1:8088");
    for (const bad of ["file:///etc/passwd", "ftp://example.com/x", "not a url", "", "javascript:alert(1)"]) expect(originOf(bad), bad).toBeNull();
  });

  it("knows which hosts are on this machine", () => {
    for (const h of ["localhost", "127.0.0.1", "127.9.9.9", "[::1]", "::1", "app.localhost"]) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["example.com", "10.0.0.5", "192.168.1.2", "127.0.0.1.evil.com", "localhost.evil.com", "0.0.0.0"]) expect(isLoopbackHost(h), h).toBe(false);
  });
});

describe("a fetch that reaches only what was declared", () => {
  it("reaches a declared destination", async () => {
    const a = await listen();
    const r = await declaredFetch([dest(a.origin)])(`${a.origin}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(r.status).toBe(200);
    expect(a.requests).toEqual(["POST /v1/chat/completions"]);
  });

  it("refuses an undeclared destination before a connection is made", async () => {
    const declared = await listen();
    const other = await listen();
    const err = (await declaredFetch([dest(declared.origin)])(`${other.origin}/steal`, { method: "POST", body: "payload" }).catch((e: unknown) => e)) as EgressRefused;
    expect(err).toBeInstanceOf(EgressRefused);
    expect(err.code).toBe("E_EGRESS_UNDECLARED");
    expect(err.message).toContain(`is not a declared destination (declared: ${declared.origin})`);
    expect(other.connections).toBe(0); // the monitor saw nothing
    expect(other.requests).toEqual([]);
  });

  it("refuses the same host on another port, another scheme, and a look-alike host", async () => {
    const a = await listen();
    const f = declaredFetch([dest(a.origin)]);
    const port = Number(new URL(a.origin).port);
    for (const url of [`http://127.0.0.1:${port + 1}/x`, `https://127.0.0.1:${port}/x`, `http://localhost:${port}/x`, `http://127.0.0.1.evil.example:${port}/x`, `http://[::1]:${port}/x`]) {
      await expect(f(url), url).rejects.toBeInstanceOf(EgressRefused);
    }
    expect(a.connections).toBe(0);
  });

  it("refuses an address that is not http or https", async () => {
    const f = declaredFetch([dest("http://127.0.0.1:9")]);
    await expect(f("file:///etc/passwd")).rejects.toThrow(/not an http or https address/);
    await expect(f("not a url")).rejects.toBeInstanceOf(EgressRefused);
  });

  it("refuses every request when nothing is declared", async () => {
    const a = await listen();
    await expect(declaredFetch([])(`${a.origin}/x`)).rejects.toThrow(/declared: none/);
    expect(a.connections).toBe(0);
  });

  it("does not follow a redirect to a place nobody declared", async () => {
    const trap = await listen();
    const declared = await listen((_req, res) => { res.statusCode = 302; res.setHeader("location", `${trap.origin}/collect`); res.end(); });
    const r = await declaredFetch([dest(declared.origin)])(`${declared.origin}/v1`, { method: "POST", body: "payload" });
    expect(r.status).toBe(302);
    expect(trap.connections).toBe(0);
    expect(trap.requests).toEqual([]);
  });

  it("in the local profile refuses a declared destination that is not on this machine", async () => {
    const f = declaredFetch([dest("https://models.example.com/v1")], { profile: "local" });
    await expect(f("https://models.example.com/v1/chat")).rejects.toThrow(/declared but not on this machine/);
    const a = await listen();
    expect((await declaredFetch([dest(a.origin)], { profile: "local" })(`${a.origin}/x`)).status).toBe(200);
  });
});

describe("the manifest", () => {
  it("lists only what is set, and says what is refused in the local profile", () => {
    const m = manifestFromEnv({ MODEL_BASE_URL: "https://integrate.api.nvidia.com/v1", ZETARIS_REST_URL: "http://localhost:8888/api", DESK_MODEL_PROFILE: "local" });
    expect(m.profile).toBe("local");
    expect(m.destinations.map((d) => [d.kind, d.origin, d.loopback])).toEqual([
      ["model", "https://integrate.api.nvidia.com", false],
      ["zetaris", "http://localhost:8888", true],
      ["gate", "http://127.0.0.1:8765", true],
    ]);
    const text = describeManifest(m).join("\n");
    expect(text).toContain("Profile: local");
    expect(text).toContain("https://integrate.api.nvidia.com: model requests");
    expect(text).toContain("Refused in the local profile.");
    expect(text).toContain("Any other address is refused before a connection is made.");
  });

  it("with no model set declares no model, and says nothing leaves for one", () => {
    expect(manifestFromEnv({}).destinations.map((d) => d.kind)).toEqual(["gate"]);
    expect(profileOf({})).toBe("standard");
    expect(profileOf({ DESK_MODEL_PROFILE: " LOCAL " })).toBe("local");
    expect(describeManifest({ profile: "standard", destinations: [] }).join("\n")).toContain("nothing leaves this machine");
  });
});

describe("the call sites use it", () => {
  const chat = { choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: "m" };

  it("the model port reaches its endpoint and logs the request as sent", async () => {
    const good = await listen((_req, res) => { res.statusCode = 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(chat)); });
    const entries: string[] = [];
    const port = new OpenAiPort({ baseUrl: `${good.origin}/v1`, apiKey: MODEL_KEY, model: "m", onEgress: (e) => entries.push(e.host), backoffMs: [] });
    const r = await port.complete({ role: "t", messages: [{ role: "user", content: "hi" }] }, 5_000);
    expect(r.content).toBe("ok");
    expect(entries).toEqual(["127.0.0.1"]);
  });

  it("the model port does not follow a redirect to another address, and the key never reaches it", async () => {
    const trap = await listen();
    const bounce = await listen((_req, res) => { res.statusCode = 307; res.setHeader("location", `${trap.origin}/collect`); res.end(); });
    const port = new OpenAiPort({ baseUrl: `${bounce.origin}/v1`, apiKey: MODEL_KEY, model: "m", backoffMs: [] });
    await expect(port.complete({ role: "t", messages: [{ role: "user", content: "hi" }] }, 5_000)).rejects.toBeInstanceOf(ModelError);
    expect(trap.connections).toBe(0);
  });

  it("the model port in the local profile refuses a remote endpoint at once, once, and does not log it as sent", async () => {
    const entries: string[] = [];
    let slept = 0;
    const port = new OpenAiPort({ baseUrl: "https://models.example.invalid/v1", apiKey: MODEL_KEY, model: "m", profile: "local", onEgress: (e) => entries.push(e.host), sleep: async () => { slept += 1; } });
    const err = (await port.complete({ role: "t", messages: [{ role: "user", content: "hi" }] }, 5_000).catch((e: unknown) => e)) as ModelError;
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe("non_transient");
    expect(err.message).toContain("E_EGRESS_UNDECLARED");
    expect(slept).toBe(0); // not retried
    expect(entries).toEqual([]); // nothing left, so nothing is logged as sent
  });

  it("the Zetaris port in the local profile refuses a remote instance, and its key is not in the message", async () => {
    const err = (await runLive({ restUrl: "https://zetaris.example.invalid/api", apiKey: SILO_KEY, orgId: "o", profile: "local" }, "SELECT 1").catch((e: unknown) => e)) as SiloError;
    expect(err).toBeInstanceOf(SiloError);
    expect(err.message).toContain("E_EGRESS_UNDECLARED");
    expect(err.message).not.toContain(SILO_KEY);
  });

  it("the gate client sends its token only to this machine", async () => {
    const a = await listen();
    for (const bad of ["https://gate.example.invalid", "http://127.0.0.1.evil.example:8765", "http://10.0.0.5:8765", "not an address"]) {
      await expect(callGate(bad, GATE_TOKEN, "/x", {}, 1_000), bad).rejects.toThrow(/E_EGRESS_UNDECLARED/);
    }
    const r = await callGate(a.origin, GATE_TOKEN, "/reserve", { x: 1 }, 2_000);
    expect(r.status).toBe(200);
  });

  it("an alert webhook is not redirected, and in the local profile a remote one is refused", async () => {
    const trap = await listen();
    const hook = await listen((_req, res) => { res.statusCode = 302; res.setHeader("location", `${trap.origin}/collect`); res.end(); });
    const deps = (profile: "standard" | "local"): DeliveryDeps => ({
      fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return declaredFetch([dest(raw, "webhook")], { profile })(input, init);
      }) as typeof fetch,
      run: () => ({ status: 0 }), sleep: async () => {}, print: () => {}, platform: "linux", webhookAttempts: 1,
    });
    const alert = { key: "k", state: "needs_you", title: "t", body: "b", evidence: "e", ts: "2026-10-25T00:00:00Z" } as never;
    const sent = await deliver(alert, { webhook: `${hook.origin}/h` }, deps("standard"));
    expect(trap.connections).toBe(0);
    expect(sent.find((d) => d.channel === "webhook")?.ok).toBe(false);
    const remote = await deliver(alert, { webhook: "https://hooks.example.invalid/x" }, deps("local"));
    expect(remote.find((d) => d.channel === "webhook")?.detail).toContain("E_EGRESS_UNDECLARED");
  });
});

/** Every file under src that can open a connection by itself, found by what it calls. A new one must be added here, on purpose, with the reason it is safe. */
describe("no other code in the product reaches the network", () => {
  const ALLOWED: Record<string, string> = {
    "src/desk/security/net.ts": "the guard itself: the only place the global fetch is the base of a request to a declared destination",
    "src/desk/gate/client.ts": "the hook's client, which refuses any address that is not loopback before it sends the token",
    "src/desk/ui/client/app.js": "the browser page, which asks only the server that served it",
    "src/desk/enforce/selftest.ts": "talks to stand-in servers it starts itself on loopback",
    "src/desk/prove/run.ts": "talks to stand-in servers it starts itself on loopback",
  };
  const CALLS = /\?\?\s*fetch\b|fetchImpl:\s*fetch\b|(?<![\w.$])fetch\s*\(|\bhttps?\.(?:request|get)\s*\(|\bnet\.(?:connect|createConnection)\s*\(|\btls\.connect\s*\(|\bnew\s+WebSocket\s*\(|\bhttp2\.connect\s*\(|\bdgram\b|\bundici\b|XMLHttpRequest|\bEventSource\s*\(/;

  function files(root: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(root)) {
      const p = join(root, name).replace(/\\/g, "/");
      if (statSync(p).isDirectory()) out.push(...files(p));
      else if (/\.(ts|js|mjs|cjs)$/.test(name)) out.push(p);
    }
    return out;
  }
  const code = (f: string): string => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("lists, among the product's source files, only the ones named above that make a request on their own", () => {
    const found = files("src").filter((f) => CALLS.test(code(f)));
    const unexpected = found.filter((f) => ALLOWED[f] === undefined);
    expect(unexpected, `these files can open a connection and are not declared in the egress manifest test: ${unexpected.join(", ")}`).toEqual([]);
    // The allowlist does not rot: each file named in it still does what it is listed for.
    const stale = Object.keys(ALLOWED).filter((f) => !found.includes(f));
    expect(stale, `listed but no longer calling the network: ${stale.join(", ")}`).toEqual([]);
  });
});
