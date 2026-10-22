import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { createRedactor } from "../card/redact.ts";
import { openLedger, type Ledger } from "../ledger/db.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import * as q from "./queries.ts";
import { askScreen, canaryScreen, dossiersScreen, silosScreen, type ExtraPaths } from "./extra.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = join(HERE, "client");
const FONT_DIR = join(HERE, "..", "..", "..", "assets", "fonts");
const FONT_FILES = ["Outfit-Regular.ttf", "Outfit-SemiBold.ttf", "JetBrainsMono-Regular.ttf", "JetBrainsMono-Medium.ttf"];

const MAX_URL_CHARS = 2048;
const CACHE_TTL_MS = 60_000;
const SCHEMA_VERSION = 3;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export interface UiOptions {
  ledgerPath: string;
  pricesPath: string;
  policiesDir: string;
  /** Folders the Ask, Organisation and Dossiers screens read. Defaults sit under data/. */
  extra?: Partial<ExtraPaths>;
  /** 0 picks a free port. */
  port: number;
  mode: "sample" | "own_logs";
  /** Overrides the random per-launch token; tests use it to assert on a known value. */
  token?: string;
  env?: Readonly<Record<string, string | undefined>>;
  nowMs?: () => number;
}

export interface UiServer {
  server: Server;
  url: string;
  origin: string;
  token: string;
  port: number;
  /** Set when the ledger could not be opened as it is; the screens then show an empty state saying why. */
  ledgerProblem: string | null;
  close(): Promise<void>;
}

/** Open the ledger read-only. A missing or old ledger becomes an empty in-memory one plus a stated problem: the page still loads and says why. */
function openReadOnly(path: string): { db: Ledger; problem: string | null } {
  const name = basename(path);
  if (!existsSync(path)) return { db: openLedger(":memory:"), problem: `No ledger was found at ${name}.` };
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (v < SCHEMA_VERSION) {
      db.close();
      return { db: openLedger(":memory:"), problem: `${name} was written by an older build (schema ${v}, this build reads ${SCHEMA_VERSION}). Run \`desk ingest\` once to upgrade it.` };
    }
    if (v > SCHEMA_VERSION) {
      db.close();
      return { db: openLedger(":memory:"), problem: `${name} is newer than this build (schema ${v}).` };
    }
    db.prepare("SELECT 1 FROM model_call LIMIT 1").get();
    return { db, problem: null };
  } catch (e) {
    return { db: openLedger(":memory:"), problem: `${name} could not be opened read-only: ${createRedactor().clean(e instanceof Error ? e.message : "unknown error")}` };
  }
}

function walk(dir: string, prefix: string, out: Map<string, string>): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, `${prefix}${name}/`, out);
    else if (st.isFile() && TYPES[name.slice(name.lastIndexOf("."))]) out.set(`${prefix}${name}`, full);
  }
}

function staticMap(): Map<string, string> {
  const files = new Map<string, string>();
  walk(CLIENT_DIR, "/", files);
  for (const f of FONT_FILES) {
    const p = join(FONT_DIR, f);
    if (existsSync(p)) files.set(`/fonts/${f}`, p);
  }
  files.set("/", join(CLIENT_DIR, "index.html"));
  return files;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}, headOnly = false): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": Buffer.byteLength(body), ...extra });
  res.end(headOnly ? undefined : body);
}

function sendJson(res: ServerResponse, status: number, value: unknown, headOnly = false): void {
  send(res, status, JSON.stringify(value), TYPES[".json"]!, { "Cache-Control": "no-store" }, headOnly);
}

function tokenOk(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startUiServer(opts: UiOptions): Promise<UiServer> {
  const { db, problem } = openReadOnly(opts.ledgerPath);
  const snapshot = loadSnapshot(opts.pricesPath);
  const ctx: q.UiContext = {
    db,
    snapshot,
    policiesDir: opts.policiesDir,
    mode: opts.mode,
    ledgerName: basename(opts.ledgerPath),
    env: opts.env ?? process.env,
    nowMs: opts.nowMs ?? Date.now,
  };
  const token = opts.token ?? randomBytes(24).toString("hex");
  const statics = staticMap();
  const cache = new Map<string, { at: number; json: string }>();
  let port = 0;

  const allowedHosts = (): Set<string> => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const extra: ExtraPaths = { cassetteDir: "data/sample/cassettes", memoryDir: "data/desk/memory", dossiersDir: "data/desk/dossiers", pendingDir: "data/desk/pending", ...opts.extra };

  const route = (path: string, p: URLSearchParams): unknown => {
    switch (path) {
      case "/api/meta":
        return { ...(q.meta(ctx) as object), ledgerProblem: problem };
      case "/api/brief":
        return withProblem(q.brief(ctx));
      case "/api/bill":
        return withProblem(q.bill(ctx, q.parseRange(p.get("range"), db)));
      case "/api/autopsy":
        return withProblem(q.autopsy(ctx, q.parseInt0(p.get("hours"), "hours", 5, 1, 168), q.parseInt0(p.get("days"), "days", 14, 1, 365)));
      case "/api/sessions":
        return withProblem(q.sessions(ctx, q.parseRange(p.get("range"), db), p.get("sort") ?? "cost", q.parseInt0(p.get("limit"), "limit", 50, 1, 200), q.parseInt0(p.get("offset"), "offset", 0, 0, 10_000_000)));
      case "/api/session":
        return withProblem(q.session(ctx, p.get("id") ?? ""));
      case "/api/outcomes":
        return withProblem(q.outcomes(ctx, q.parseRange(p.get("range"), db)));
      case "/api/policy":
        return withProblem(q.policy(ctx, q.parseRange(p.get("range"), db), p.get("from"), p.get("to")));
      case "/api/policy/tunnel":
        return withProblem(q.tunnel(ctx, q.parseRange(p.get("range"), db), p.get("policy") ?? ""));
      case "/api/ask":
        return askScreen(ctx, extra, p.get("q") ?? "", p.get("ablate") ?? "");
      case "/api/canary":
        return canaryScreen(ctx);
      case "/api/silos":
        return silosScreen(ctx, extra);
      case "/api/dossiers":
        return dossiersScreen(extra);
      case "/api/sources":
        return withProblem(q.sources(ctx));
      default:
        return undefined;
    }
  };

  /** When the ledger itself could not be opened, every screen says so instead of showing a bare empty state. */
  const withProblem = (v: object): object => {
    if (problem && (v as { state?: string }).state === "empty") return { ...v, reason: problem };
    return v;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      send(res, 405, "method not allowed", "text/plain; charset=utf-8", { Allow: "GET, HEAD" });
      return;
    }
    const head = method === "HEAD";
    const raw = req.url ?? "";
    if (raw.length > MAX_URL_CHARS) {
      send(res, 414, "uri too long", "text/plain; charset=utf-8", {}, head);
      return;
    }
    if (!raw.startsWith("/") || raw.startsWith("//")) {
      send(res, 400, "bad request", "text/plain; charset=utf-8", {}, head);
      return;
    }
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts().has(host)) {
      send(res, 403, "host not allowed", "text/plain; charset=utf-8", {}, head);
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) {
      send(res, 403, "origin not allowed", "text/plain; charset=utf-8", {}, head);
      return;
    }
    let url: URL;
    try {
      url = new URL(raw, `http://${host}`);
    } catch {
      send(res, 400, "bad request", "text/plain; charset=utf-8", {}, head);
      return;
    }
    const path = url.pathname;

    if (!path.startsWith("/api/")) {
      // Only names built at startup are served, so no part of the request ever reaches the file system.
      const file = statics.get(path);
      if (!file) {
        send(res, 404, "not found", "text/plain; charset=utf-8", {}, head);
        return;
      }
      const ext = file.slice(file.lastIndexOf("."));
      send(res, 200, readFileSync(file), TYPES[ext] ?? "application/octet-stream", { "Cache-Control": "no-cache" }, head);
      return;
    }

    const given = (req.headers["x-desk-token"] as string | undefined) ?? url.searchParams.get("t") ?? undefined;
    if (!tokenOk(given, token)) {
      sendJson(res, 401, { state: "error", message: "A launch token is required. Open the address that `desk ui` printed." }, head);
      return;
    }
    const params = new URLSearchParams(url.searchParams);
    params.delete("t");
    const key = `${path}?${[...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&")}`;
    const hit = cache.get(key);
    if (hit && ctx.nowMs() - hit.at < CACHE_TTL_MS) {
      send(res, 200, hit.json, TYPES[".json"]!, { "Cache-Control": "no-store", "X-Desk-Cache": "hit" }, head);
      return;
    }
    try {
      const out = await route(path, params);
      if (out === undefined) {
        sendJson(res, 404, { state: "error", message: "No such endpoint." }, head);
        return;
      }
      const json = JSON.stringify(out);
      if (cache.size > 200) cache.clear();
      cache.set(key, { at: ctx.nowMs(), json });
      send(res, 200, json, TYPES[".json"]!, { "Cache-Control": "no-store" }, head);
    } catch (e) {
      if (e instanceof q.BadParam) {
        sendJson(res, 400, { state: "error", message: e.message }, head);
        return;
      }
      process.stderr.write(`desk ui: ${path} failed: ${createRedactor().clean(e instanceof Error ? e.message : String(e))}\n`);
      sendJson(res, 500, { state: "error", message: "The Desk could not compute this screen. The terminal that runs `desk ui` has the reason." }, head);
    }
  };

  const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { state: "error", message: "The Desk could not compute this screen." });
      else res.destroy();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    server,
    url: `${origin}/?t=${token}`,
    origin,
    token,
    port,
    ledgerProblem: problem,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
