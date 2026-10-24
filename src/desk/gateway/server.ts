import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from "node:stream/web";

import { listPriceCost } from "../cost/cost.ts";
import type { Gate } from "../gate/gate.ts";
import type { GateDecision } from "../gate/types.ts";
import { resolvePrice, type PriceSnapshot } from "../pricing/pricebook.ts";

/**
 * The gateway door. An agent that can be pointed at an OpenAI-compatible base URL (an environment variable or a setting)
 * is pointed here instead of at the model endpoint, and every chat completion it sends is reserved against the gate before
 * it goes out and settled for the tokens it used when it comes back. This is the door for tools with no hook of their own.
 *
 * What it does and does not see. It sees what passes through it: nothing else the agent does, and nothing sent to the
 * endpoint by another route. It meters one route, `POST /v1/chat/completions`. Reads (listing models) pass through
 * unmetered and are counted as such. Any other write is refused as a route that cannot be metered, because letting it
 * through would let money leave unseen. The caller's own Authorization header is passed on and never stored or logged.
 * It listens on the loopback interface only, and refuses a request whose Host header is not its own address.
 */
export interface GatewayEntry {
  ts: string;
  path: string;
  method: string;
  status: number;
  ms: number;
  model?: string;
  routedModel?: string;
  verdict?: string;
  reasonCode?: string;
  reservedMicros?: number;
  settledMicros?: number;
  stream?: boolean;
  settledAtWorstCase?: boolean;
  error?: string;
}

export interface GatewayStats {
  /** Requests that reached the gateway. */
  seen: number;
  /** Requests it reserved against the gate. */
  controlled: number;
  allowed: number;
  denied: number;
  /** Refused because the gate could not decide. */
  failedClosed: number;
  /** Reads passed through without a reservation, and writes refused because they cannot be metered. */
  unmetered: number;
  unmeteredRefused: number;
  /** Calls settled for what was reserved because the tokens used were never reported (or the caller hung up). */
  settledAtWorstCase: number;
  voided: number;
  routed: number;
}

export interface GatewayOptions {
  /** The model endpoint's base URL, including /v1. */
  upstream: string;
  gate: Gate;
  prices: PriceSnapshot;
  port?: number;
  maxBodyBytes?: number;
  /** How long to wait for the upstream's first byte, and between chunks of a stream. */
  firstByteMs?: number;
  onEntry?: (e: GatewayEntry) => void;
  fetchImpl?: typeof fetch;
}

export interface Gateway {
  port: number;
  /** The base URL to give an agent: it ends in /v1, like the endpoint's own. */
  url: string;
  stats(): GatewayStats;
  /** Wait for every settlement in progress, including those of callers that hung up. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"]);
const METERED = "/chat/completions";
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

function errorBody(code: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error: { message, type: code === "gate_unavailable" || code === "gateway_error" ? "desk_gateway_error" : "desk_gate_denied", code, ...extra } });
}

/** The status and code a refusal is given, from the gate's reason. */
function refusal(d: GateDecision): { status: number; code: string } {
  if (d.verdict === "ask") return { status: 403, code: "approval_required" };
  if (d.reasonCode === "cap_exceeded" || d.reasonCode === "capacity") return { status: 429, code: "budget_exceeded" };
  if (d.reasonCode === "unpriced_model" || d.reasonCode === "no_estimate") return { status: 403, code: "unmetered_model" };
  return { status: 403, code: "policy_denied" };
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

function readUsage(o: Record<string, unknown>): Usage | null {
  const u = o["usage"];
  if (u === null || typeof u !== "object") return null;
  const x = u as Record<string, unknown>;
  if (typeof x["prompt_tokens"] !== "number" || typeof x["completion_tokens"] !== "number") return null;
  const d = x["prompt_tokens_details"];
  const cached = d !== null && typeof d === "object" && typeof (d as Record<string, unknown>)["cached_tokens"] === "number" ? ((d as Record<string, number>)["cached_tokens"] as number) : 0;
  const prompt = x["prompt_tokens"];
  const completion = x["completion_tokens"];
  if (![prompt, completion, cached].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return { promptTokens: prompt, completionTokens: completion, cachedTokens: Math.min(cached, prompt) };
}

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no data for ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const upstream = opts.upstream.replace(/\/$/, "");
  const maxBody = opts.maxBodyBytes ?? 8 * 1024 * 1024;
  const firstByteMs = opts.firstByteMs ?? 120_000;
  const stats: GatewayStats = { seen: 0, controlled: 0, allowed: 0, denied: 0, failedClosed: 0, unmetered: 0, unmeteredRefused: 0, settledAtWorstCase: 0, voided: 0, routed: 0 };
  const pending = new Set<Promise<void>>();
  let port = 0;

  const server: Server = createServer((req, res) => {
    const work = handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) send(res, 500, errorBody("gateway_error", `gateway error: ${(e as Error).message}`));
      else res.end();
    });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });

  function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(body);
  }

  async function readBody(req: IncomingMessage): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > maxBody) return null;
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  function forwardHeaders(req: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP.has(k) || k.startsWith("x-desk-")) continue;
      out[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    out["accept-encoding"] = "identity";
    return out;
  }

  function relayHeaders(up: Response): Record<string, string> {
    const out: Record<string, string> = {};
    up.headers.forEach((v, k) => {
      if (!HOP.has(k) && k !== "content-encoding") out[k] = v;
    });
    return out;
  }

  function priced(model: string, usage: Usage): number | null {
    const r = resolvePrice(opts.prices, model);
    if (r.kind !== "priced") return null;
    return listPriceCost({ inputTokens: usage.promptTokens - usage.cachedTokens, outputTokens: usage.completionTokens, cacheReadTokens: usage.cachedTokens, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, r.row).totalMicros;
  }

  function settle(d: GateDecision, model: string, usage: Usage | null, entry: GatewayEntry): void {
    if (d.reservationId === null) return;
    let micros = usage === null ? null : priced(model, usage);
    if (micros === null) {
      // The tokens used were not reported, or the model has no price: what was reserved is the honest figure.
      micros = d.reservedMicros;
      entry.settledAtWorstCase = true;
      stats.settledAtWorstCase += 1;
    }
    try {
      opts.gate.settle({ reservation_id: d.reservationId, actual_micros: micros });
      entry.settledMicros = micros;
    } catch (e) {
      entry.error = `settle failed: ${(e as Error).message}`.slice(0, 200);
    }
  }

  function free(d: GateDecision, entry: GatewayEntry): void {
    if (d.reservationId === null) return;
    try {
      opts.gate.voidReservation({ reservation_id: d.reservationId });
      stats.voided += 1;
    } catch (e) {
      entry.error = `${entry.error ?? ""} void failed: ${(e as Error).message}`.trim().slice(0, 200);
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    stats.seen += 1;
    const method = req.method ?? "GET";
    const url = (req.url ?? "").split("?");
    const path = url[0] ?? "";
    const query = url[1] ? `?${url[1]}` : "";
    const entry: GatewayEntry = { ts: new Date().toISOString(), path, method, status: 0, ms: 0 };
    const finish = (status: number): void => {
      entry.status = status;
      entry.ms = Date.now() - started;
      opts.onEntry?.(entry);
    };
    const reply = (status: number, body: string, headers: Record<string, string> = {}): void => {
      send(res, status, body, headers);
      finish(status);
    };

    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? "")) return reply(421, errorBody("gateway_error", "this gateway answers only on its own loopback address"));
    if (!path.startsWith("/v1/") && path !== "/v1") return reply(404, errorBody("gateway_error", "use the /v1 base URL"));
    const rest = path.slice("/v1".length);

    if (method !== "POST" || rest !== METERED) {
      if (!READS.has(method)) {
        stats.unmeteredRefused += 1;
        return reply(403, errorBody("unmetered_route", `${method} ${path} cannot be metered by this gateway, so it is refused: only POST /v1/chat/completions is metered, and reads pass through`));
      }
      stats.unmetered += 1;
      const up = await fetchImpl(`${upstream}${rest}${query}`, { method, headers: forwardHeaders(req), signal: AbortSignal.timeout(firstByteMs) }).catch((e: unknown) => e as Error);
      if (up instanceof Error) return reply(502, errorBody("gateway_error", `upstream unreachable: ${up.message}`.slice(0, 200)));
      const text = await up.text();
      res.writeHead(up.status, relayHeaders(up));
      res.end(method === "HEAD" ? undefined : text);
      return finish(up.status);
    }

    const raw = await readBody(req);
    if (raw === null) return reply(413, errorBody("request_too_large", `the request body is over ${maxBody} bytes`));
    let body: Record<string, unknown>;
    try {
      const v = JSON.parse(raw.toString("utf8")) as unknown;
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      body = v as Record<string, unknown>;
    } catch {
      return reply(400, errorBody("bad_request", "the request body must be a JSON object"));
    }
    const model = body["model"];
    if (typeof model !== "string" || model === "") return reply(400, errorBody("bad_request", "the request names no model"));
    entry.model = model;
    entry.stream = body["stream"] === true;

    const header = (name: string): string | undefined => {
      const v = req.headers[name];
      return typeof v === "string" && v !== "" ? v.slice(0, 200) : undefined;
    };
    const maxTokens = typeof body["max_completion_tokens"] === "number" ? body["max_completion_tokens"] : typeof body["max_tokens"] === "number" ? body["max_tokens"] : null;
    const n = typeof body["n"] === "number" && Number.isSafeInteger(body["n"]) && body["n"] >= 1 ? body["n"] : 1;
    stats.controlled += 1;
    let decision: GateDecision;
    try {
      decision = opts.gate.authorize({
        session_id: header("x-desk-session") ?? "gateway",
        person: opts.gate.person,
        project: header("x-desk-project") ?? "unknown",
        agent: header("x-desk-agent") ?? "agent:gateway",
        model,
        task_type: header("x-desk-task-type") ?? "unknown",
        input_tokens: Math.ceil(raw.length / 3),
        max_tokens: maxTokens !== null && Number.isSafeInteger(maxTokens) && maxTokens >= 0 ? maxTokens : null,
        n,
        idempotency_key: randomUUID(),
      });
    } catch (e) {
      stats.failedClosed += 1;
      entry.error = `gate: ${(e as Error).message}`.slice(0, 200);
      return reply(503, errorBody("gate_unavailable", "the gate could not decide, so the call was not sent"));
    }
    entry.verdict = decision.verdict;
    entry.reasonCode = decision.reasonCode;
    entry.reservedMicros = decision.reservedMicros;
    if (decision.verdict !== "allow") {
      stats.denied += 1;
      const r = refusal(decision);
      const standing = decision.standing.find((s) => s.window === "day");
      return reply(r.status, errorBody(r.code, decision.reasons[0] ?? "the gate refused this call", { reasons: decision.reasons, ...(standing?.remainingMicros != null ? { remaining_usd: standing.remainingMicros / 1e6 } : {}), ...(decision.approvalRequest ? { approval_request_id: decision.approvalRequest.approval_request_id } : {}) }));
    }
    stats.allowed += 1;

    const routedModel = decision.routedModel || model;
    const out: Record<string, unknown> = { ...body, model: routedModel };
    if (routedModel !== model) {
      stats.routed += 1;
      entry.routedModel = routedModel;
    }
    if (body["stream"] === true) {
      const so = body["stream_options"] !== null && typeof body["stream_options"] === "object" && !Array.isArray(body["stream_options"]) ? (body["stream_options"] as Record<string, unknown>) : {};
      out["stream_options"] = { ...so, include_usage: true };
    }

    const controller = new AbortController();
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        controller.abort();
      }
    });
    const timer = setTimeout(() => controller.abort(), firstByteMs);
    let up: Response;
    try {
      up = await fetchImpl(`${upstream}${rest}${query}`, { method: "POST", headers: { ...forwardHeaders(req), "content-type": "application/json" }, body: JSON.stringify(out), signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      free(decision, entry);
      if (clientGone) {
        entry.error = "the caller hung up before the upstream answered";
        return finish(499);
      }
      const timedOut = controller.signal.aborted;
      entry.error = `upstream ${timedOut ? "did not answer in time" : "unreachable"}: ${(e as Error).message}`.slice(0, 200);
      return reply(timedOut ? 504 : 502, errorBody("gateway_error", entry.error));
    }
    clearTimeout(timer);
    const ctype = up.headers.get("content-type") ?? "";
    const routedHeader = routedModel !== model ? { "x-desk-routed-from": model } : {};

    if (up.status >= 400) {
      const text = await up.text().catch(() => "");
      free(decision, entry);
      res.writeHead(up.status, { ...relayHeaders(up), ...routedHeader });
      res.end(text);
      return finish(up.status);
    }

    if (!ctype.includes("text/event-stream")) {
      let text: string;
      try {
        text = await up.text();
      } catch (e) {
        free(decision, entry);
        entry.error = `upstream reply broke: ${(e as Error).message}`.slice(0, 200);
        return reply(502, errorBody("gateway_error", entry.error));
      }
      let usage: Usage | null = null;
      try {
        const v = JSON.parse(text) as unknown;
        if (v !== null && typeof v === "object" && !Array.isArray(v)) usage = readUsage(v as Record<string, unknown>);
      } catch {
        /* not JSON: relayed as it is, and settled at the worst case */
      }
      settle(decision, routedModel, usage, entry);
      res.writeHead(up.status, { ...relayHeaders(up), ...routedHeader });
      res.end(text);
      return finish(up.status);
    }

    // A stream: pass each chunk on as it comes and read the events for the usage the upstream reports last.
    res.writeHead(up.status, { ...relayHeaders(up), ...routedHeader });
    const reader = up.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: Usage | null = null;
    let broke: string | null = null;
    if (reader) {
      for (;;) {
        let step: ReadableStreamReadResult<Uint8Array>;
        try {
          step = await readWithin(reader, firstByteMs);
        } catch (e) {
          broke = clientGone ? "the caller hung up" : (e as Error).message;
          controller.abort();
          break;
        }
        if (step.done) break;
        if (!res.write(step.value)) await new Promise<void>((r) => res.once("drain", r));
        buffer += decoder.decode(step.value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const eventText = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const line of eventText.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "" || payload === "[DONE]") continue;
            try {
              const v = JSON.parse(payload) as unknown;
              if (v !== null && typeof v === "object" && !Array.isArray(v)) usage = readUsage(v as Record<string, unknown>) ?? usage;
            } catch {
              /* a data line that is not JSON is passed on untouched */
            }
          }
        }
      }
    }
    settle(decision, routedModel, usage, entry);
    if (broke !== null) entry.error = `stream ended early: ${broke}`.slice(0, 200);
    if (!res.writableEnded) res.end();
    finish(up.status);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}/v1`,
    stats: () => ({ ...stats }),
    settled: async () => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    close: async () => {
      await Promise.allSettled([...pending]);
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
