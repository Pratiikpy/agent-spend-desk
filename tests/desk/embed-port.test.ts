import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { embedderFromEnv } from "../../src/desk/embed/env.ts";
import { CassetteEmbedder, cassetteKey, decodeVector, dot, encodeVector, EmbedError, LiveEmbedder, prepare, ReplayOrRecordEmbedder, unit } from "../../src/desk/embed/port.ts";
import type { EgressEntry } from "../../src/desk/security/egress.ts";

const work = mkdtempSync(join(tmpdir(), "desk-embed-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
// Built here so that no literal sits beside a key name.
const KEY = ["not", "a", "real", "key", "for", "tests"].join("-");
const BASE = "https://embed.example.test/v1";

/** A vector that depends on the text, so that equal texts get equal vectors and different texts do not. */
function fake(text: string, dims = 16): number[] {
  const v = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i += 1) v[(text.charCodeAt(i) * 7 + i) % dims] = (v[(text.charCodeAt(i) * 7 + i) % dims] as number) + (text.charCodeAt(i) % 13) + 1;
  return v;
}

interface Call {
  url: string;
  body: { model: string; input: string[]; input_type: string; truncate: string };
  auth: string | null;
}
function server(handler?: (n: number, body: Call["body"]) => Response | null): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Call["body"];
    calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
    const custom = handler?.(calls.length, body);
    if (custom) return custom;
    const data = body.input.map((t, index) => ({ object: "embedding", index, embedding: fake(t) })).reverse();
    return new Response(JSON.stringify({ object: "list", data, usage: { prompt_tokens: 1, total_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const live = (s: ReturnType<typeof server>, extra: Partial<ConstructorParameters<typeof LiveEmbedder>[0]> = {}): LiveEmbedder =>
  new LiveEmbedder({ baseUrl: BASE, apiKey: KEY, fetchImpl: s.fetchImpl, sleep: async () => {}, random: () => 0.5, ...extra });

describe("the live embedder", () => {
  it("returns one unit-length vector per text, in the order asked, whatever order the endpoint answers in", async () => {
    const s = server();
    const out = await live(s).embed(["alpha", "beta", "gamma"], "query");
    expect(out).toHaveLength(3);
    for (const v of out) expect(dot(v, v)).toBeCloseTo(1, 5);
    expect(dot(out[0] as Float32Array, unit(fake("alpha")))).toBeCloseTo(1, 5);
    expect(dot(out[2] as Float32Array, unit(fake("gamma")))).toBeCloseTo(1, 5);
    expect(s.calls[0]?.url).toBe(`${BASE}/embeddings`);
    expect(s.calls[0]?.body).toMatchObject({ model: "nvidia/nemotron-3-embed-1b", input_type: "query", truncate: "END" });
    expect(s.calls[0]?.auth).toBe(`Bearer ${KEY}`);
  });

  it("sends at most 32 texts in a request", async () => {
    const s = server();
    await live(s).embed(Array.from({ length: 70 }, (_, i) => `text ${i}`), "passage");
    expect(s.calls.map((c) => c.body.input.length)).toEqual([32, 32, 6]);
  });

  it("masks credential shapes and its own key before the text leaves, and says how many it masked, never what", async () => {
    const s = server();
    const egress: EgressEntry[] = [];
    const secret = ["sk", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-");
    await live(s, { onEgress: (e) => egress.push(e) }).embed([`the key is ${secret} and ${KEY}`], "passage");
    const sent = s.calls[0]?.body.input[0] ?? "";
    expect(sent).not.toContain(secret);
    expect(sent).not.toContain(KEY);
    expect(egress).toHaveLength(1);
    expect(egress[0]?.redactions).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(egress[0])).not.toContain("the key is");
    expect(egress[0]).toMatchObject({ host: "embed.example.test", role: "embed" });
  });

  it("retries a rate limit and a server error, and gives up with a typed error when the retries are spent", async () => {
    const flaky = server((n) => (n < 3 ? new Response("slow down", { status: n === 1 ? 429 : 503 }) : null));
    const ok = await live(flaky).embed(["x"], "query");
    expect(ok).toHaveLength(1);
    expect(flaky.calls).toHaveLength(3);
    const down = server(() => new Response("no", { status: 503 }));
    await expect(live(down).embed(["x"], "query")).rejects.toMatchObject({ kind: "transient" });
    expect(down.calls).toHaveLength(3);
  });

  it("does not retry an error the same request would meet again", async () => {
    const bad = server(() => new Response(JSON.stringify({ message: "input_type must be one of query, passage" }), { status: 400 }));
    await expect(live(bad).embed(["x"], "query")).rejects.toMatchObject({ kind: "non_transient", status: 400 });
    expect(bad.calls).toHaveLength(1);
  });

  it.each([
    ["a missing vector", { object: "list", data: [] }],
    ["a vector that is not numbers", { object: "list", data: [{ index: 0, embedding: ["a", "b"] }] }],
    ["a vector with a missing number", { object: "list", data: [{ index: 0, embedding: [1, null, 3] }] }],
    ["an empty vector", { object: "list", data: [{ index: 0, embedding: [] }] }],
    ["no data at all", { object: "list" }],
  ])("refuses %s in a reply", async (_name, reply) => {
    const s = server(() => new Response(JSON.stringify(reply), { status: 200 }));
    await expect(live(s).embed(["x"], "query")).rejects.toMatchObject({ kind: "non_transient" });
  });

  it("refuses a reply that is not JSON, and a reply whose vectors differ in length", async () => {
    await expect(live(server(() => new Response("<html>", { status: 200 }))).embed(["x"], "query")).rejects.toMatchObject({ kind: "non_transient", message: "reply was not JSON" });
    const mixed = server(() => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [1, 2, 3] }] }), { status: 200 }));
    await expect(live(mixed).embed(["a", "b"], "query")).rejects.toMatchObject({ kind: "non_transient" });
  });

  it("gives up at the deadline instead of waiting for the endpoint", async () => {
    const hang = (async (_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    const e = new LiveEmbedder({ baseUrl: BASE, apiKey: KEY, fetchImpl: hang, backoffMs: [], sleep: async () => {} });
    const t = Date.now();
    await expect(e.embed(["x"], "query", 60)).rejects.toMatchObject({ kind: "transient" });
    expect(Date.now() - t).toBeLessThan(1_500);
  });

  it("reaches only the declared endpoint, and in the local profile only this machine", async () => {
    const seen: string[] = [];
    const base = (async (u: string) => {
      seen.push(u);
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = base;
    try {
      const remoteLocalProfile = new LiveEmbedder({ baseUrl: BASE, apiKey: KEY, profile: "local", backoffMs: [] });
      await expect(remoteLocalProfile.embed(["x"], "query")).rejects.toMatchObject({ kind: "non_transient", message: expect.stringContaining("E_EGRESS_UNDECLARED") });
      expect(seen).toEqual([]);
      const loopback = new LiveEmbedder({ baseUrl: "http://127.0.0.1:9/v1", apiKey: KEY, profile: "local", backoffMs: [] });
      expect(await loopback.embed(["x"], "query")).toHaveLength(1);
      expect(seen).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("recordings", () => {
  it("round-trip a vector to within the rounding of one signed byte, and say a text with no recording is a miss", async () => {
    const v = unit(Array.from({ length: 2048 }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * 0.11)));
    const back = decodeVector(encodeVector(v));
    expect(dot(v, back)).toBeGreaterThan(0.9995);
    expect(encodeVector(v).length).toBeLessThan(2900);
    const empty = new CassetteEmbedder(join(work, "none"));
    await expect(empty.embed(["never recorded"], "query")).rejects.toMatchObject({ kind: "cassette_miss" });
  });

  it("key on the model, the kind and the masked text, not on spacing or the order of calls", () => {
    const m = "nvidia/nemotron-3-embed-1b";
    expect(cassetteKey(m, "query", "How much?")).toBe(cassetteKey(m, "query", "  How much?  "));
    expect(cassetteKey(m, "query", "How much?")).not.toBe(cassetteKey(m, "passage", "How much?"));
    expect(cassetteKey(m, "query", "How much?")).not.toBe(cassetteKey("another/model", "query", "How much?"));
    expect(prepare("x".repeat(20_000)).text).toHaveLength(8_000);
  });

  it("are written by a live run and replayed by a run with no key and no network, which asks the endpoint only for what is not recorded", async () => {
    const dir = join(work, "cassettes");
    const s = server();
    const recording = new ReplayOrRecordEmbedder(live(s), dir);
    const first = await recording.embed(["one", "two", "three"], "query");
    expect(s.calls).toHaveLength(1);
    const again = await recording.embed(["two", "four"], "query");
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]?.body.input).toEqual(["four"]);
    const replayOnly = new CassetteEmbedder(dir);
    const replayed = await replayOnly.embed(["one", "two", "three", "four"], "query");
    expect(dot(replayed[0] as Float32Array, first[0] as Float32Array)).toBeGreaterThan(0.999);
    expect(dot(replayed[1] as Float32Array, again[0] as Float32Array)).toBeGreaterThan(0.999);
    await expect(replayOnly.embed(["one"], "passage")).rejects.toBeInstanceOf(EmbedError);
    for (const f of readdirSync(dir)) expect(statSync(join(dir, f)).size).toBeLessThan(900 * 1024);
  });

  it("are written in a stable order, so that the same recordings give the same files", async () => {
    const a = join(work, "order-a");
    const b = join(work, "order-b");
    await new ReplayOrRecordEmbedder(live(server()), a).embed(["p", "q", "r", "s"], "passage");
    const rb = new ReplayOrRecordEmbedder(live(server()), b);
    await rb.embed(["s", "r"], "passage");
    await rb.embed(["q", "p"], "passage");
    const read = (d: string): Record<string, string> => Object.fromEntries(readdirSync(d).map((f) => [f, readFileSync(join(d, f), "utf8")]));
    expect(read(a)).toEqual(read(b));
  });

  it("are not read for another model", async () => {
    const dir = join(work, "models");
    await new ReplayOrRecordEmbedder(live(server()), dir).embed(["hello"], "query");
    await expect(new CassetteEmbedder(dir, "someone/else").embed(["hello"], "query")).rejects.toMatchObject({ kind: "cassette_miss" });
  });
});

describe("choosing an embedder", () => {
  it("uses recordings in sample mode, whatever the environment holds", async () => {
    const c = embedderFromEnv({ NVIDIA_API_KEY: KEY, NVIDIA_BASE_URL: BASE }, join(work, "cassettes"), { sampleMode: true });
    expect(c.embedder?.source).toBe("cassette");
    expect(c.label).toMatch(/recorded .* vectors \(sample mode\)/);
  });

  it("uses none when a run is told to use no model, when embeddings are not switched on, or when no endpoint is configured, and says so", () => {
    expect(embedderFromEnv({ NVIDIA_API_KEY: KEY, NVIDIA_BASE_URL: BASE, DESK_EMBED: "on" }, "x", { sampleMode: false, noModel: true }).embedder).toBeNull();
    const off = embedderFromEnv({ NVIDIA_API_KEY: KEY, NVIDIA_BASE_URL: BASE }, "x", { sampleMode: false });
    expect(off.embedder).toBeNull();
    expect(off.label).toMatch(/embeddings are off/);
    const none = embedderFromEnv({ DESK_EMBED: "on" }, "x", { sampleMode: false });
    expect(none.embedder).toBeNull();
    expect(none.label).toMatch(/no embedding endpoint configured/);
  });

  it("goes live only when switched on, with the NVIDIA settings or its own, and records when asked", () => {
    const env = { NVIDIA_API_KEY: KEY, NVIDIA_BASE_URL: BASE, DESK_EGRESS_LOG: "off", DESK_EMBED: "on" };
    expect(embedderFromEnv(env, "x", { sampleMode: false }).embedder?.source).toBe("live");
    expect(embedderFromEnv(env, "x", { sampleMode: false, record: true }).label).toMatch(/recording/);
    expect(embedderFromEnv({ ...env, DESK_EMBED_MODEL: "other/model" }, "x", { sampleMode: false }).embedder?.id).toBe("other/model");
    expect(embedderFromEnv({ ...env, DESK_EMBED_BASE_URL: "http://127.0.0.1:9/v1", DESK_EMBED_API_KEY: KEY }, "x", { sampleMode: false }).label).toMatch(/127\.0\.0\.1/);
  });

  it("goes live without the switch only for the commands that exist to call the endpoint", () => {
    const env = { NVIDIA_API_KEY: KEY, NVIDIA_BASE_URL: BASE, DESK_EGRESS_LOG: "off" };
    expect(embedderFromEnv(env, "x", { sampleMode: false, force: true }).embedder?.source).toBe("live");
  });
});
