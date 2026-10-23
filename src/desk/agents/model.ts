import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Budget } from "./budget.ts";
import { NULL_TRACE, type Trace } from "./trace.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  /** On an assistant turn that called tools: the calls, in the form the chat API expects them back. */
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  /** Which agent role is asking. It is part of the cassette key and of every trace line. */
  role: string;
  messages: readonly ChatMessage[];
  tools?: readonly ToolSpec[];
  /** Ask for a JSON object as the reply. */
  json?: boolean;
  maxTokens?: number;
  /** Sampling temperature; 0 unless a caller (the canary) wants real sampling noise. */
  temperature?: number;
  /** Which repeat of a sampled run this is, so each repeat has its own recording. Part of the key only when set. */
  variant?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
  servedBy: "nightshift" | "nvidia" | "cassette" | "other";
  servedModel: string;
  source: "live" | "cassette";
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number } | null;
}

export type ModelErrorKind = "transient" | "non_transient" | "cassette_miss" | "aborted";

export class ModelError extends Error {
  constructor(readonly kind: ModelErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "ModelError";
  }
}

export interface ModelPort {
  complete(request: ModelRequest, deadlineMs: number): Promise<ModelResponse>;
}

/** The request as it is hashed for a cassette: nothing that varies from run to run. */
export function requestKey(request: ModelRequest): string {
  const stable = {
    role: request.role,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content, tool_call_id: m.tool_call_id ?? null, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) })),
    tools: (request.tools ?? []).map((t) => ({ name: t.name, parameters: t.parameters })),
    json: request.json ?? false,
    ...(request.variant ? { variant: request.variant } : {}),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32);
}

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Pauses between retries (jittered). Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Backoff base delays in ms; the number of entries is the retry cap. Default two retries. */
  backoffMs?: readonly number[];
  random?: () => number;
  fetchImpl?: typeof fetch;
}

function servedByFor(baseUrl: string): ModelResponse["servedBy"] {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local")) return "nightshift";
    if (host.endsWith("nvidia.com")) return "nvidia";
  } catch {
    /* fall through */
  }
  return "other";
}

/** An OpenAI-compatible chat endpoint: NVIDIA's API or a local Meterless Nightshift URL. Only the three settings differ. */
export class OpenAiPort implements ModelPort {
  private readonly cfg: Required<Omit<OpenAiConfig, "fetchImpl">> & { fetchImpl: typeof fetch };
  constructor(cfg: OpenAiConfig) {
    this.cfg = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      backoffMs: [5_000, 15_000],
      random: Math.random,
      fetchImpl: fetch,
      ...cfg,
    };
  }

  async complete(request: ModelRequest, deadlineMs: number): Promise<ModelResponse> {
    const started = Date.now();
    const retries = this.cfg.backoffMs.length;
    let last: ModelError | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const left = deadlineMs - (Date.now() - started);
      if (left <= 0) throw last ?? new ModelError("aborted", "deadline reached before the call");
      try {
        return await this.once(request, left);
      } catch (e) {
        if (!(e instanceof ModelError) || e.kind !== "transient") throw e;
        last = e;
        if (attempt === retries) break;
        const base = this.cfg.backoffMs[attempt] ?? 0;
        const wait = Math.round(base * (0.5 + this.cfg.random()));
        if (wait >= deadlineMs - (Date.now() - started)) break;
        await this.cfg.sleep(wait);
      }
    }
    throw last ?? new ModelError("transient", "no attempt completed");
  }

  private async once(request: ModelRequest, timeoutMs: number): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (request.tools && request.tools.length > 0) {
      body["tools"] = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
    if (request.json) body["response_format"] = { type: "json_object" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.cfg.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw new ModelError("transient", `no reply within ${timeoutMs} ms`);
      throw new ModelError("transient", `network error: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status >= 500) throw new ModelError("transient", `HTTP ${res.status}`, res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ModelError("non_transient", `HTTP ${res.status}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 200)}` : ""}`, res.status);
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new ModelError("non_transient", "reply was not JSON");
    }
    return this.read(parsed);
  }

  private read(raw: unknown): ModelResponse {
    const o = raw as {
      model?: unknown;
      choices?: { message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    const message = o.choices?.[0]?.message;
    if (!message) throw new ModelError("non_transient", "reply had no choices");
    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls: ToolCall[] = [];
    for (const tc of message.tool_calls ?? []) {
      const name = tc.function?.name;
      if (typeof name !== "string") throw new ModelError("non_transient", "tool call without a name");
      let args: Record<string, unknown> = {};
      const rawArgs = tc.function?.arguments;
      if (typeof rawArgs === "string" && rawArgs.trim() !== "") {
        try {
          const v = JSON.parse(rawArgs) as unknown;
          if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
          args = v as Record<string, unknown>;
        } catch {
          throw new ModelError("non_transient", `tool call arguments were not a JSON object (${name})`);
        }
      }
      toolCalls.push({ id: typeof tc.id === "string" ? tc.id : `call_${toolCalls.length + 1}`, name, arguments: args });
    }
    if (content.trim() === "" && toolCalls.length === 0) {
      const reasoningOnly = typeof message.reasoning_content === "string" && message.reasoning_content.length > 0;
      throw new ModelError("non_transient", reasoningOnly ? "reasoning-only reply, no answer" : "empty reply");
    }
    const usage = o.usage
      ? { inputTokens: o.usage.prompt_tokens ?? 0, outputTokens: o.usage.completion_tokens ?? 0, reasoningTokens: o.usage.completion_tokens_details?.reasoning_tokens ?? 0 }
      : null;
    return { content, toolCalls, servedBy: servedByFor(this.cfg.baseUrl), servedModel: typeof o.model === "string" ? o.model : this.cfg.model, source: "live", usage };
  }
}

interface CassetteFile {
  key: string;
  recordedAt: string;
  role: string;
  response: Omit<ModelResponse, "source" | "servedBy"> & { servedBy: ModelResponse["servedBy"] };
}

/** Replays recorded model replies. A request with no recording is a miss, not a guess. */
export class CassettePort implements ModelPort {
  constructor(private readonly dir: string) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const key = requestKey(request);
    const file = join(this.dir, `${request.role}-${key}.json`);
    if (!existsSync(file)) {
      throw new ModelError("cassette_miss", `E_CASSETTE_MISS: no recording for role ${request.role} (${key}). Record it live with: desk record --role ${request.role}`);
    }
    const c = JSON.parse(readFileSync(file, "utf8")) as CassetteFile;
    return { ...c.response, source: "cassette", servedBy: "cassette", servedModel: c.response.servedModel };
  }
}

/** Calls a live port and writes each reply as a cassette, so a later run can replay it offline. */
export class RecordingPort implements ModelPort {
  constructor(private readonly inner: ModelPort, private readonly dir: string, private readonly now: () => string = () => new Date().toISOString()) {
    mkdirSync(dir, { recursive: true });
  }

  async complete(request: ModelRequest, deadlineMs: number): Promise<ModelResponse> {
    const response = await this.inner.complete(request, deadlineMs);
    const key = requestKey(request);
    const file: CassetteFile = { key, recordedAt: this.now(), role: request.role, response: { content: response.content, toolCalls: response.toolCalls, servedBy: response.servedBy, servedModel: response.servedModel, usage: response.usage } };
    writeFileSync(join(this.dir, `${request.role}-${key}.json`), JSON.stringify(file, null, 2));
    return response;
  }
}

export interface CallContext {
  budget: Budget;
  trace?: Trace;
}

/** One model call under the run's budget, with a trace line. Retries inside the port count toward the deadline, not the call count. */
export async function callModel(port: ModelPort, request: ModelRequest, ctx: CallContext): Promise<ModelResponse> {
  const trace = ctx.trace ?? NULL_TRACE;
  ctx.budget.useModelCall();
  const deadline = ctx.budget.nextCallDeadlineMs();
  const started = Date.now();
  try {
    const r = await port.complete(request, deadline);
    trace.emit({
      event: "desk.model",
      why: "computed",
      role: request.role,
      detail: { served_by: r.servedBy, served_model: r.servedModel, served_from: r.source, ms: Date.now() - started, usage: r.usage, tool_calls: r.toolCalls.map((t) => t.name) },
    });
    return r;
  } catch (e) {
    const err = e as ModelError;
    trace.emit({ event: "desk.model.failed", why: "computed", role: request.role, detail: { kind: err.kind ?? "unknown", message: err.message, ms: Date.now() - started } });
    throw e;
  }
}

/** Build the port from environment settings. SAMPLE_MODE=true replays cassettes from `cassetteDir`; no key or network is needed. */
export function portFromEnv(env: Record<string, string | undefined>, cassetteDir: string, opts: { backoffMs?: readonly number[] } = {}): ModelPort {
  if (env["SAMPLE_MODE"] === "true") return new CassettePort(cassetteDir);
  const baseUrl = env["MODEL_BASE_URL"] ?? env["NVIDIA_BASE_URL"];
  const apiKey = env["MODEL_API_KEY"] ?? env["NVIDIA_API_KEY"];
  const model = env["NEMOTRON_MODEL"] ?? env["NVIDIA_MODEL"];
  if (!baseUrl || !apiKey || !model) {
    throw new ModelError("non_transient", "model not configured: set MODEL_BASE_URL, MODEL_API_KEY and NEMOTRON_MODEL (or the NVIDIA_ names), or run with SAMPLE_MODE=true");
  }
  return new OpenAiPort({ baseUrl, apiKey, model, ...(opts.backoffMs ? { backoffMs: opts.backoffMs } : {}) });
}
