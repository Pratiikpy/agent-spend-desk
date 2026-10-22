import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MemoryTrace } from "../../../src/desk/agents/trace.ts";
import { cassettePath, configFromEnv, normaliseSql, readCassette, runLive, serve, SiloError, writeCassette, type ZetarisConfig } from "../../../src/sponsors/zetaris/silo-port.ts";

// A stand-in for the Zetaris REST route. Its behaviour is switched per test; the real instance is exercised by the live test below.
let server: Server;
let base = "";
let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void = () => {};
const seen: { url: string; headers: IncomingMessage["headers"]; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1.0`;
});
afterAll(() => server.close());
afterEach(() => {
  seen.length = 0;
  handler = () => {};
});

const KEY = ["test", "key", "value", "0123456789"].join("-");
const cfg = (over: Partial<ZetarisConfig> = {}): ZetarisConfig => ({ restUrl: base, apiKey: KEY, orgId: "1", timeoutMs: 2_000, ...over });
const reply = (status: number, body: unknown): typeof handler => (_req, res) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const OK = { headers: ["team", "n"], data: [["payments", "3"], ["growth", null]], total: 2 };

describe("runLive", () => {
  it("sends the verified request shape and returns the rows as strings, nulls as empty", async () => {
    handler = reply(200, OK);
    const r = await runLive(cfg(), "SELECT team, n FROM t;");
    expect(r.rows).toEqual([["payments", "3"], ["growth", ""]]);
    expect(r.servedFrom).toBe("live");
    const req = seen[0]!;
    expect(req.url).toBe("/api/v1.0/sql-editor/sqls/run");
    expect(req.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(req.headers["x-org-id"]).toBe("1");
    expect(req.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["limit", "queryId", "source", "sql"]);
    expect(body["source"]).toBe("SqlEditor");
    expect(body["sql"]).toBe("SELECT team, n FROM t");
  });

  it("gives a stable hash for the statement and the response", async () => {
    handler = reply(200, OK);
    const a = await runLive(cfg(), "SELECT 1");
    const b = await runLive(cfg(), "SELECT 1;");
    expect(a.reqHash).toBe(b.reqHash);
    expect(a.respHash).toBe(b.respHash);
  });

  it("maps each failure to a named kind and never leaks the key", async () => {
    const cases: [number, unknown, string][] = [
      [401, { msg: "Authorization header missing" }, "unauthorized"],
      [403, "forbidden", "unauthorized"],
      [400, { msg: `bad sql ${KEY}` }, "rejected"],
      [500, "boom", "rejected"],
      [200, "<html>not json</html>", "malformed"],
      [200, { headers: ["a"] }, "malformed"],
      [200, { headers: ["a", "b"], data: [["1"]], total: 1 }, "malformed"],
      [200, { headers: [1], data: [], total: 0 }, "malformed"],
      [200, { headers: ["a"], data: [["1"]], total: 7 }, "truncated"],
    ];
    for (const [status, body, kind] of cases) {
      handler = reply(status, body);
      const err = await runLive(cfg(), "SELECT 1").catch((e) => e as SiloError);
      expect(err, `${status} ${kind}`).toBeInstanceOf(SiloError);
      expect((err as SiloError).kind).toBe(kind);
      expect((err as SiloError).message).not.toContain(KEY);
    }
  });

  it("times out instead of hanging", async () => {
    handler = () => {};
    const err = await runLive(cfg({ timeoutMs: 150 }), "SELECT 1").catch((e) => e as SiloError);
    expect((err as SiloError).kind).toBe("timeout");
  });

  it("reports an unreachable instance", async () => {
    const err = await runLive(cfg({ restUrl: "http://127.0.0.1:1/api/v1.0" }), "SELECT 1").catch((e) => e as SiloError);
    expect((err as SiloError).kind).toBe("unreachable");
    expect((err as SiloError).message).not.toContain(KEY);
  });

  it("refuses an empty statement without calling out", async () => {
    for (const sql of ["", "   ", ";", " ; ;"]) {
      const err = await runLive(cfg(), sql).catch((e) => e as SiloError);
      expect((err as SiloError).kind).toBe("rejected");
    }
    expect(seen).toHaveLength(0);
  });

  it("does not interpolate anything: a statement with quotes and semicolons is sent as one string", async () => {
    handler = reply(200, OK);
    const nasty = "SELECT 'a; DROP TABLE x' AS v";
    await runLive(cfg(), nasty);
    expect((JSON.parse(seen[0]!.body) as { sql: string }).sql).toBe(nasty);
  });
});

describe("normaliseSql", () => {
  it("trims and drops trailing semicolons only", () => {
    expect(normaliseSql("  SELECT 1 ;; ")).toBe("SELECT 1");
    expect(normaliseSql("SELECT ';' AS x")).toBe("SELECT ';' AS x");
  });
});

describe("configFromEnv", () => {
  it("needs all three settings", () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ ZETARIS_REST_URL: "u", ZETARIS_API_KEY: "k" })).toBeNull();
    expect(configFromEnv({ ZETARIS_REST_URL: "u", ZETARIS_API_KEY: "k", ZETARIS_ORG_ID: "1" })).toEqual({ restUrl: "u", apiKey: "k", orgId: "1" });
  });
});

describe("cassettes", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-zcass-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("replays exactly what was recorded, marked as cassette, with the recording time", async () => {
    handler = reply(200, OK);
    const live = await runLive(cfg(), "SELECT team, n FROM t");
    writeCassette(dir, "SELECT team, n FROM t;", live, "2026-10-22T10:00:00.000Z");
    const back = readCassette(dir, "SELECT team, n FROM t");
    expect(back.rows).toEqual(live.rows);
    expect(back.headers).toEqual(live.headers);
    expect(back.respHash).toBe(live.respHash);
    expect(back.servedFrom).toBe("cassette");
    expect(back.recordedAt).toBe("2026-10-22T10:00:00.000Z");
    expect(JSON.parse(readFileSync(cassettePath(dir, "SELECT team, n FROM t"), "utf8")).sql).toBe("SELECT team, n FROM t");
  });

  it("is a miss, not a guess, for a statement that was never recorded", () => {
    expect(() => readCassette(dir, "SELECT something_else")).toThrowError(/no recording/);
  });
});

describe("serve", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-zserve-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("serves live, records on request, and traces the line from the spec", async () => {
    handler = reply(200, OK);
    const trace = new MemoryTrace();
    const s = await serve("SELECT team, n FROM t", { sample: false, cassetteDir: dir, record: true, config: cfg(), trace });
    expect(s.servedFrom).toBe("live");
    expect(s.result?.rows).toHaveLength(2);
    const line = trace.events[0]!;
    expect(line.event).toBe("desk.ingest");
    expect(line.detail).toMatchObject({ port: "silo", op: "zetaris.sql", servedFrom: "live", rows: 2 });
    expect(readCassette(dir, "SELECT team, n FROM t").rows).toEqual(s.result?.rows);
  });

  it("serves the recording in SAMPLE_MODE without touching the network", async () => {
    const trace = new MemoryTrace();
    const boom = (() => {
      throw new Error("network used");
    }) as unknown as typeof fetch;
    const s = await serve("SELECT team, n FROM t", { sample: true, cassetteDir: dir, record: false, config: cfg({ fetchImpl: boom }), trace });
    expect(s.servedFrom).toBe("cassette");
    expect(trace.events[0]!.detail).toMatchObject({ servedFrom: "cassette" });
    expect(seen).toHaveLength(0);
  });

  it("falls back, with the reason, when Zetaris is down, unconfigured, switched off or the recording is missing", async () => {
    const down = await serve("SELECT 1", { sample: false, cassetteDir: dir, record: false, config: cfg({ restUrl: "http://127.0.0.1:1/api/v1.0" }) });
    expect(down.servedFrom).toBe("fallback");
    expect(down.result).toBeNull();
    expect(down.reason).toMatch(/unreachable/);
    const none = await serve("SELECT 1", { sample: false, cassetteDir: dir, record: false, config: null });
    expect(none.reason).toMatch(/not_configured/);
    const off = await serve("SELECT 1", { sample: false, cassetteDir: dir, record: false, config: cfg(), disabled: true });
    expect(off.reason).toMatch(/switched off/);
    const miss = await serve("SELECT never_recorded", { sample: true, cassetteDir: dir, record: false, config: null });
    expect(miss.reason).toMatch(/cassette_miss/);
    expect(seen).toHaveLength(0);
  });

  it("never records a failed or truncated response", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "desk-zserve2-"));
    handler = reply(200, { headers: ["a"], data: [["1"]], total: 9 });
    const s = await serve("SELECT a FROM big", { sample: false, cassetteDir: d2, record: true, config: cfg() });
    expect(s.servedFrom).toBe("fallback");
    expect(() => readCassette(d2, "SELECT a FROM big")).toThrowError(/no recording/);
    rmSync(d2, { recursive: true, force: true });
  });
});
