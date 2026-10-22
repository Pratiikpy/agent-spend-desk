import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Gate } from "./gate.ts";
import { GateError } from "./types.ts";

export interface GateServerOptions {
  gate: Gate;
  /** Bearer token that agents and hooks present. The server refuses to start without one. */
  token: string;
  /** Bearer token for owner-only routes (approve, switch, pause). Without it those routes answer 403. */
  ownerToken?: string;
  maxBodyBytes?: number;
  /** Per-request budget for reading the request. */
  requestTimeoutMs?: number;
  port?: number;
}

export interface RunningGate {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

function tokenOk(presented: string | undefined, want: string): boolean {
  if (presented === undefined) return false;
  return timingSafeEqual(digest(presented), digest(want));
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m?.[1];
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", "x-desk-gate": "1", ...extra });
  res.end(text);
}

function fail(res: ServerResponse, status: number, code: string, message: string, detail?: Record<string, unknown>): void {
  send(res, status, { error: { code, message, ...(detail !== undefined ? { detail } : {}) } });
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const declared = req.headers["content-length"];
  if (typeof declared === "string" && Number(declared) > limit) throw new GateError("E_TOO_LARGE", `request body over ${limit} bytes`, 413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limit) throw new GateError("E_TOO_LARGE", `request body over ${limit} bytes`, 413);
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function loopback(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/**
 * The local reserve endpoint (spec 10.5): a small process with no model and no network dependency. It listens
 * on loopback only, requires a bearer token, refuses anything it cannot parse or check, and answers 503 with a
 * reason when it cannot decide. It never answers "allow" because something went wrong.
 */
export async function startGateServer(opts: GateServerOptions): Promise<RunningGate> {
  if (typeof opts.token !== "string" || opts.token.length < 16) {
    throw new GateError("E_NO_TOKEN", "the gate needs a bearer token of at least 16 characters (DESK_GATE_TOKEN); it will not start open", 500);
  }
  const limit = opts.maxBodyBytes ?? 65_536;
  const gate = opts.gate;
  let boundPort = 0;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (!loopback(req.socket.remoteAddress)) return fail(res, 403, "E_NOT_LOOPBACK", "the gate answers loopback clients only");
      const host = req.headers["host"] ?? "";
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return fail(res, 403, "E_BAD_HOST", "unexpected Host header");
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;

      if (path === "/healthz" && req.method === "GET") return send(res, 200, { ok: true });

      const presented = bearer(req);
      // Two tokens, two roles: agents and hooks present the agent token; the owner presents the owner token, which
      // is not an agent token and so cannot be used to reserve under someone else's name by mistake, and vice versa.
      const isOwner = opts.ownerToken !== undefined && tokenOk(presented, opts.ownerToken);
      if (!isOwner && !tokenOk(presented, opts.token)) {
        return fail(res, 401, "E_UNAUTHORIZED", "a valid bearer token is required");
      }

      if (req.method !== "POST") return fail(res, 405, "E_METHOD", "use POST");
      const ctype = req.headers["content-type"] ?? "";
      if (!/^application\/json\b/i.test(ctype)) return fail(res, 415, "E_CONTENT_TYPE", "send application/json");

      let body: unknown;
      try {
        const text = await readBody(req, limit);
        body = text.length === 0 ? {} : JSON.parse(text);
      } catch (error) {
        if (error instanceof GateError) return fail(res, error.httpStatus, error.code, error.message);
        return fail(res, 400, "E_JSON", "the body is not valid JSON");
      }

      switch (path) {
        case "/v1/reserve": {
          const d = gate.authorize(body);
          return send(res, d.verdict === "allow" ? 200 : 403, d);
        }
        case "/v1/settle":
          return send(res, 200, gate.settle(body));
        case "/v1/void":
          return send(res, 200, gate.voidReservation(body));
        case "/v1/budget":
          return send(res, 200, gate.budgetLeft(body));
        case "/v1/tool/begin": {
          const r = gate.toolBegin(body);
          return send(res, r.status === "in_flight" ? 409 : r.decision !== null && r.decision.verdict !== "allow" ? 403 : 200, r);
        }
        case "/v1/tool/complete":
          return send(res, 200, gate.toolComplete(body));
        case "/v1/hook/pretooluse":
          return send(res, 200, gate.hookPreToolUse(body));
        case "/v1/admin/approve": {
          if (!isOwner) return fail(res, 403, "E_OWNER_ONLY", "approving needs the owner token");
          return send(res, 200, gate.approve(body, "owner"));
        }
        case "/v1/admin/bypass": {
          if (!isOwner) return fail(res, 403, "E_OWNER_ONLY", "the emergency switch needs the owner token");
          const o = (body ?? {}) as Record<string, unknown>;
          if (o["close"] === true) return send(res, 200, { closed: true, event: gate.closeBypass("owner").id });
          const forMs = o["for_ms"];
          if (typeof forMs !== "number") return fail(res, 400, "E_INVALID", "for_ms is required");
          const row = gate.openBypass(forMs, "owner");
          return send(res, 200, { opened: true, expiresAt: row.expires_at, event: row.id });
        }
        case "/v1/admin/pause":
        case "/v1/admin/resume": {
          if (!isOwner) return fail(res, 403, "E_OWNER_ONLY", "pausing and resuming need the owner token");
          const o = (body ?? {}) as Record<string, unknown>;
          if (typeof o["person"] !== "string" || o["person"].length === 0) return fail(res, 400, "E_INVALID", "person is required");
          if (path === "/v1/admin/pause") gate.pause(o["person"], "owner", typeof o["reason"] === "string" ? o["reason"] : "paused by the owner");
          else gate.resume(o["person"], "owner");
          return send(res, 200, { ok: true });
        }
        default:
          return fail(res, 404, "E_NOT_FOUND", `no route ${path}`);
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof GateError) return fail(res, error.httpStatus, error.code, error.message, error.detail);
      // A ledger that cannot be written, a lock that cannot be taken, a bug: refuse with a reason, never allow.
      const message = error instanceof Error ? error.message : String(error);
      return fail(res, 503, "E_GATE_UNAVAILABLE", `the gate cannot decide and is refusing as a precaution: ${message}`);
    }
  };

  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.headersTimeout = opts.requestTimeoutMs ?? 5_000;
  server.requestTimeout = opts.requestTimeoutMs ?? 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 50;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  boundPort = (server.address() as AddressInfo).port;
  return {
    server,
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
