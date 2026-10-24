import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from "node:stream/web";

import { isNvidiaHost, readNightshiftReceipt } from "../agents/model.ts";

/**
 * The Lab's accounting proxy. An agent under test talks to this instead of to the model endpoint, and gets four things
 * it cannot get from its own logs: a complete, comparable record of every model call (tokens, latency, Nightshift
 * receipt, retries, errors), a model-side response cache that can never answer one run with another run's reply, one
 * shared limit on concurrent calls so runs do not starve each other, and transparent retries of rate-limit and
 * server errors, so a measured pass rate reflects the agent and not luck with the endpoint's quota.
 *
 * It never stores prompt or reply text. A record holds sizes, token counts, timings and identifiers only.
 */
export interface ProxyEntry {
  ts: string;
  run: string;
  path: string;
  status: number;
  ms: number;
  stream: boolean;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  toolCalls: number;
  receiptId?: string;
  fromCache?: boolean;
  /** How many times the upstream call was repeated before this reply (rate limits, server errors, in-stream errors). */
  retries: number;
  /** Set when the client was given an error, after all retries. */
  error?: string;
  requestBytes: number;
  responseBytes: number;
}

export interface ProxyOptions {
  /** The model endpoint's base URL, including /v1. */
  upstream: string;
  apiKey: string;
  port?: number;
  maxConcurrent?: number;
  maxRetries?: number;
  backoffMs?: number[];
  /** How long to wait for the upstream's first byte. */
  firstByteMs?: number;
  onEntry?: (e: ProxyEntry) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface Proxy {
  port: number;
  /** The base URL an agent should use for one run: it ends in /v1, like the endpoint's own. */
  runUrl(runId: string): string;
  close(): Promise<void>;
}

const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRIABLE_TEXT = /\b(429|500|502|503|504)\b|timeout|timed out|overloaded|rate.?limit|too many requests|temporarily|empty[_ ]response/i;
const MAX_BODY = 32 * 1024 * 1024;

class Gate {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async take(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

interface Seen {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  toolIndexes: Set<number>;
  receiptId?: string;
  fromCache?: boolean;
  error?: string;
  meaningful: boolean;
}

function fresh(): Seen {
  return { toolIndexes: new Set(), meaningful: false };
}

/** Fold one decoded JSON object (a stream chunk or a whole reply) into what we keep about the call. */
function absorb(seen: Seen, o: Record<string, unknown>): void {
  if (typeof o["model"] === "string") seen.model = o["model"];
  const usage = o["usage"];
  if (usage !== null && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    if (typeof u["prompt_tokens"] === "number") seen.promptTokens = u["prompt_tokens"];
    if (typeof u["completion_tokens"] === "number") seen.completionTokens = u["completion_tokens"];
    const d = u["completion_tokens_details"];
    if (d !== null && typeof d === "object" && typeof (d as Record<string, unknown>)["reasoning_tokens"] === "number") seen.reasoningTokens = (d as Record<string, number>)["reasoning_tokens"];
  }
  const m = o["meterless"];
  if (m !== null && typeof m === "object") {
    // A whole reply carries the schema-tagged receipt; a stream carries the same runtime block with a receipt_id and a
    // decision, without the schema field. Both are issued by the Nightshift runtime, so both count as its receipt.
    const r = readNightshiftReceipt(m);
    const plain = (m as Record<string, unknown>)["receipt_id"];
    if (r) seen.receiptId = r.id;
    else if (typeof plain === "string" && plain !== "") seen.receiptId = plain;
    if ((m as Record<string, unknown>)["from_cache"] === true) seen.fromCache = true;
  }
  if (o["from_cache"] === true) seen.fromCache = true;
  const err = o["error"];
  if (err !== null && typeof err === "object") {
    const e = err as Record<string, unknown>;
    seen.error = `${typeof e["code"] === "string" ? e["code"] : "error"}: ${typeof e["message"] === "string" ? e["message"].slice(0, 160) : "no message"}`;
  }
  const choice = Array.isArray(o["choices"]) ? (o["choices"][0] as Record<string, unknown> | undefined) : undefined;
  if (choice) {
    if (typeof choice["finish_reason"] === "string") {
      seen.finishReason = choice["finish_reason"];
      seen.meaningful = true;
    }
    for (const key of ["delta", "message"]) {
      const part = choice[key];
      if (part === null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if ((typeof p["content"] === "string" && p["content"] !== "") || (typeof p["reasoning_content"] === "string" && p["reasoning_content"] !== "") || (typeof p["reasoning"] === "string" && p["reasoning"] !== "")) seen.meaningful = true;
      if (Array.isArray(p["tool_calls"])) {
        seen.meaningful = true;
        (p["tool_calls"] as Record<string, unknown>[]).forEach((tc, i) => seen.toolIndexes.add(typeof tc["index"] === "number" ? tc["index"] : i));
      }
    }
  }
}

/** One read from a stream, failing if nothing arrives in time, so a stalled upstream cannot hold a run open forever. */
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

export async function startProxy(opts: ProxyOptions): Promise<Proxy> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gate = new Gate(opts.maxConcurrent ?? 2);
  // The free endpoint rate-limits in bursts, so the wait grows to a minute and stays there: a run should not be lost to a busy minute.
  const maxRetries = opts.maxRetries ?? 8;
  const backoff = opts.backoffMs ?? [3_000, 6_000, 12_000, 24_000, 45_000, 60_000];
  const firstByteMs = opts.firstByteMs ?? 240_000;
  const upstream = opts.upstream.replace(/\/$/, "");

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) fail(res, 500, `proxy error: ${(e as Error).message}`);
      else res.end();
    });
  });

  function fail(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message, type: "lab_proxy_error", code: "lab_proxy_error" } }));
  }

  async function readBody(req: IncomingMessage): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) return null;
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const m = /^\/run\/([^/]+)\/v1(\/.*)?$/.exec((req.url ?? "").split("?")[0] ?? "");
    if (!m || !RUN_ID.test(m[1] ?? "")) return fail(res, 404, "use /run/<id>/v1/...");
    const run = m[1] as string;
    const rest = m[2] ?? "";
    const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : Buffer.alloc(0);
    if (body === null) return fail(res, 413, "request body too large");

    const release = await gate.take();
    let current: AbortController | null = null;
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        current?.abort();
      }
    });

    const entry: ProxyEntry = { ts: new Date().toISOString(), run, path: rest, status: 0, ms: 0, stream: false, toolCalls: 0, retries: 0, requestBytes: body.length, responseBytes: 0 };
    const seen = fresh();
    try {
      let attempt = 0;
      for (;;) {
        if (clientGone) return;
        const controller = new AbortController();
        current = controller;
        const timer = setTimeout(() => controller.abort(), firstByteMs);
        let up: Response;
        try {
          up = await fetchImpl(`${upstream}${rest}`, {
            method: req.method ?? "GET",
            headers: {
              ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}),
              ...(req.headers["accept"] ? { accept: String(req.headers["accept"]) } : {}),
              authorization: `Bearer ${opts.apiKey}`,
              // A scope no other request shares, so Nightshift's response cache cannot answer this call with another's reply.
              ...(isNvidiaHost(opts.upstream) ? {} : { "meterless-scope": `lab-${run}-${randomUUID()}`, "meterless-ttfb-ms": String(firstByteMs) }),
            },
            ...(body.length > 0 ? { body } : {}),
            signal: controller.signal,
          });
        } catch (e) {
          clearTimeout(timer);
          if (clientGone) return;
          if (attempt < maxRetries) {
            entry.retries += 1;
            await sleep(backoff[Math.min(attempt, backoff.length - 1)] ?? 1000);
            attempt += 1;
            continue;
          }
          entry.status = 502;
          entry.error = `upstream unreachable: ${(e as Error).message}`.slice(0, 200);
          return fail(res, 502, entry.error);
        }
        clearTimeout(timer);

        if (RETRIABLE_STATUS.has(up.status) && attempt < maxRetries) {
          await up.body?.cancel().catch(() => undefined);
          entry.retries += 1;
          const ra = Number(up.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : (backoff[Math.min(attempt, backoff.length - 1)] ?? 1000));
          attempt += 1;
          continue;
        }

        const ctype = up.headers.get("content-type") ?? "";
        entry.status = up.status;
        entry.stream = ctype.includes("text/event-stream");

        if (!entry.stream) {
          const text = await up.text();
          entry.responseBytes = text.length;
          let parsed: Record<string, unknown> | null = null;
          try {
            const v = JSON.parse(text) as unknown;
            if (v !== null && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
          } catch {
            /* not JSON: pass it on as it is */
          }
          const local = fresh();
          if (parsed) absorb(local, parsed);
          if (local.error && RETRIABLE_TEXT.test(local.error) && attempt < maxRetries) {
            entry.retries += 1;
            await sleep(backoff[Math.min(attempt, backoff.length - 1)] ?? 1000);
            attempt += 1;
            continue;
          }
          Object.assign(seen, local);
          res.writeHead(up.status, { "content-type": ctype || "application/json", "cache-control": "no-store" });
          res.end(text);
          return;
        }

        // Streaming. Hold the opening chunks (the role-only delta) until the first one that carries content, a tool call or
        // an end, or an error. An error before that point is retried without the client ever seeing the stream; after it,
        // the client has been given text and the call cannot be repeated.
        const reader = up.body?.getReader();
        if (!reader) {
          entry.error = "upstream sent no body";
          return fail(res, 502, entry.error);
        }
        const decoder = new TextDecoder();
        let buffer = "";
        const held: Uint8Array[] = [];
        let committed = false;
        let retry = false;
        const local = fresh();
        const writeOut = async (chunk: Uint8Array): Promise<void> => {
          entry.responseBytes += chunk.length;
          if (!res.write(chunk)) await new Promise<void>((r) => res.once("drain", r));
        };
        const commit = async (): Promise<void> => {
          if (committed) return;
          committed = true;
          res.writeHead(up.status, { "content-type": ctype, "cache-control": "no-store", connection: "keep-alive" });
          for (const h of held) await writeOut(h);
          held.length = 0;
        };
        for (;;) {
          let step: ReadableStreamReadResult<Uint8Array>;
          try {
            step = await readWithin(reader, firstByteMs);
          } catch (e) {
            if (clientGone) return;
            if (!committed && attempt < maxRetries) {
              retry = true;
              break;
            }
            entry.error = `stream broke: ${(e as Error).message}`.slice(0, 200);
            break;
          }
          if (step.done) break;
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
                if (v !== null && typeof v === "object" && !Array.isArray(v)) absorb(local, v as Record<string, unknown>);
              } catch {
                /* a partial or non-JSON data line is passed on untouched */
              }
            }
            const bytes = new TextEncoder().encode(`${eventText}\n\n`);
            if (!committed && local.error && RETRIABLE_TEXT.test(local.error) && attempt < maxRetries && !local.meaningful) {
              retry = true;
              break;
            }
            if (!committed) {
              held.push(bytes);
              if (local.meaningful || local.error || /\[DONE\]/.test(eventText)) await commit();
            } else {
              await writeOut(bytes);
            }
          }
          if (retry) break;
        }
        if (retry) {
          await reader.cancel().catch(() => undefined);
          entry.retries += 1;
          await sleep(backoff[Math.min(attempt, backoff.length - 1)] ?? 1000);
          attempt += 1;
          continue;
        }
        if (!committed) await commit();
        if (buffer !== "") await writeOut(new TextEncoder().encode(buffer));
        Object.assign(seen, local);
        res.end();
        return;
      }
    } finally {
      release();
      entry.ms = Date.now() - started;
      if (seen.model !== undefined) entry.model = seen.model;
      if (seen.promptTokens !== undefined) entry.promptTokens = seen.promptTokens;
      if (seen.completionTokens !== undefined) entry.completionTokens = seen.completionTokens;
      if (seen.reasoningTokens !== undefined) entry.reasoningTokens = seen.reasoningTokens;
      if (seen.finishReason !== undefined) entry.finishReason = seen.finishReason;
      if (seen.receiptId !== undefined) entry.receiptId = seen.receiptId;
      if (seen.fromCache) entry.fromCache = true;
      entry.toolCalls = seen.toolIndexes.size;
      if (seen.error && entry.error === undefined) entry.error = seen.error;
      try {
        opts.onEntry?.(entry);
      } catch {
        /* a failing log must never stop a call */
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    runUrl: (runId: string) => `http://127.0.0.1:${port}/run/${runId}/v1`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
