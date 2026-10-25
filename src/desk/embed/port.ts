import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EgressEntry } from "../security/egress.ts";
import { declaredFetch, destination, EgressRefused, type Profile } from "../security/net.ts";
import { maskSecrets } from "../security/secrets.ts";

/**
 * Text embeddings, from a model, for the two places the Desk compares meaning: Scout Intent (is this request like one of the examples of a kind) and the owner's memory (is this
 * note about the question). The port is the same shape as the model port: a live endpoint, a recording of it, and a replay of the recording that needs no key and no network.
 *
 * A request carries text, so the same rules apply as for the chat model: only the declared endpoint is reachable, credential-shaped strings are masked before they leave, the egress
 * log records where it went and how big it was (never the text), and a failure is a typed error the caller turns into a fallback, never a guess.
 */
export type EmbedKind = "query" | "passage";
export type EmbedErrorKind = "transient" | "non_transient" | "cassette_miss" | "aborted";

export class EmbedError extends Error {
  constructor(readonly kind: EmbedErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "EmbedError";
  }
}

export interface Embedder {
  /** The model that made the vectors. Part of every cassette key, so a different model never reads another's recordings. */
  readonly id: string;
  readonly source: "live" | "cassette";
  /** Unit-length vectors, one per text, in the order given. */
  embed(texts: readonly string[], kind: EmbedKind, deadlineMs?: number): Promise<Float32Array[]>;
}

export const DEFAULT_EMBED_MODEL = "nvidia/nemotron-3-embed-1b";
/** The longest text sent in one piece; the endpoint refuses more, and a question or a note is nowhere near it. */
export const MAX_EMBED_CHARS = 8_000;
const MAX_BATCH = 32;

export function unit(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i += 1) n += (v[i] as number) * (v[i] as number);
  const norm = Math.sqrt(n);
  const out = new Float32Array(v.length);
  if (norm === 0 || !Number.isFinite(norm)) return out;
  for (let i = 0; i < v.length; i += 1) out[i] = (v[i] as number) / norm;
  return out;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += (a[i] as number) * (b[i] as number);
  return s;
}

/** The text as it is sent and as it is keyed: normalised, credential shapes masked, cut to the limit. */
export function prepare(text: string, known: readonly string[] = []): { text: string; masked: number } {
  const m = maskSecrets(text.normalize("NFKC").trim(), known);
  return { text: m.text.slice(0, MAX_EMBED_CHARS), masked: m.count };
}

/** A text with nothing in it has no meaning to compare. It gets a vector of length zero, whose dot product with anything is zero, and is never sent or recorded. */
export const NO_MEANING = new Float32Array(0);
export const isBlank = (text: string): boolean => prepare(text).text === "";

export function cassetteKey(model: string, kind: EmbedKind, text: string): string {
  return createHash("sha256").update(`${model}\u0000${kind}\u0000${prepare(text).text}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The live endpoint
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface LiveEmbedderConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  profile?: Profile;
  /** Pauses between retries; the number of entries is the retry cap. Injected so tests do not wait. */
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
  onEgress?: (e: EgressEntry) => void;
  /** Where one batch may spend at most this long when the caller gives no deadline. */
  defaultDeadlineMs?: number;
}

export class LiveEmbedder implements Embedder {
  readonly id: string;
  readonly source = "live" as const;
  private readonly cfg: Required<Omit<LiveEmbedderConfig, "fetchImpl" | "onEgress" | "profile" | "model">> & { fetchImpl: typeof fetch; onEgress?: (e: EgressEntry) => void };

  constructor(cfg: LiveEmbedderConfig) {
    this.id = cfg.model ?? DEFAULT_EMBED_MODEL;
    const declared = destination("embedding", cfg.baseUrl, "text to embed, with credential shapes masked", "DESK_EMBED_BASE_URL or NVIDIA_BASE_URL");
    this.cfg = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      backoffMs: cfg.backoffMs ?? [1_000, 3_000],
      sleep: cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: cfg.random ?? Math.random,
      defaultDeadlineMs: cfg.defaultDeadlineMs ?? 20_000,
      fetchImpl: cfg.fetchImpl ?? declaredFetch(declared === null ? [] : [declared], cfg.profile === undefined ? {} : { profile: cfg.profile }),
      ...(cfg.onEgress ? { onEgress: cfg.onEgress } : {}),
    };
  }

  async embed(texts: readonly string[], kind: EmbedKind, deadlineMs?: number): Promise<Float32Array[]> {
    const started = Date.now();
    const budget = deadlineMs ?? this.cfg.defaultDeadlineMs;
    const asked = texts.filter((t) => !isBlank(t));
    const got: Float32Array[] = [];
    for (let i = 0; i < asked.length; i += MAX_BATCH) {
      const left = budget - (Date.now() - started);
      got.push(...(await this.batch(asked.slice(i, i + MAX_BATCH), kind, left)));
    }
    let next = 0;
    return texts.map((t) => (isBlank(t) ? NO_MEANING : (got[next++] as Float32Array)));
  }

  private async batch(texts: readonly string[], kind: EmbedKind, budgetMs: number): Promise<Float32Array[]> {
    const started = Date.now();
    const retries = this.cfg.backoffMs.length;
    let last: EmbedError | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const left = budgetMs - (Date.now() - started);
      if (left <= 0) throw last ?? new EmbedError("aborted", "deadline reached before the call");
      try {
        return await this.once(texts, kind, left);
      } catch (e) {
        if (!(e instanceof EmbedError) || e.kind !== "transient") throw e;
        last = e;
        if (attempt === retries) break;
        const wait = Math.round((this.cfg.backoffMs[attempt] ?? 0) * (0.5 + this.cfg.random()));
        if (wait >= budgetMs - (Date.now() - started)) break;
        await this.cfg.sleep(wait);
      }
    }
    throw last ?? new EmbedError("transient", "no attempt completed");
  }

  private async once(texts: readonly string[], kind: EmbedKind, timeoutMs: number): Promise<Float32Array[]> {
    let masked = 0;
    const input = texts.map((t) => {
      const p = prepare(t, [this.cfg.apiKey]);
      masked += p.masked;
      return p.text;
    });
    const payload = JSON.stringify({ model: this.id, input, input_type: kind, encoding_format: "float", truncate: "END" });
    const scrub = (text: string): string => maskSecrets(text, [this.cfg.apiKey]).text;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.cfg.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
        body: payload,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof EgressRefused) throw new EmbedError("non_transient", e.message);
      this.logEgress(payload, masked);
      if (controller.signal.aborted) throw new EmbedError("transient", `no reply within ${timeoutMs} ms`);
      throw new EmbedError("transient", scrub(`network error: ${(e as Error).message}`));
    } finally {
      clearTimeout(timer);
    }
    this.logEgress(payload, masked);
    if (res.status === 429 || res.status >= 500) throw new EmbedError("transient", `HTTP ${res.status}`, res.status);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new EmbedError("non_transient", scrub(`HTTP ${res.status}${body ? `: ${body.replace(/\s+/g, " ").slice(0, 200)}` : ""}`), res.status);
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new EmbedError("non_transient", "reply was not JSON");
    }
    return this.read(parsed, texts.length);
  }

  private read(raw: unknown, expected: number): Float32Array[] {
    const rows = (raw as { data?: { index?: unknown; embedding?: unknown }[] } | null)?.data;
    if (!Array.isArray(rows) || rows.length !== expected) throw new EmbedError("non_transient", `expected ${expected} vectors, got ${Array.isArray(rows) ? rows.length : "none"}`);
    const ordered = rows.map((r, i) => ({ index: typeof r.index === "number" ? r.index : i, embedding: r.embedding })).sort((a, b) => a.index - b.index);
    let dims = -1;
    return ordered.map((r) => {
      const e = r.embedding;
      if (!Array.isArray(e) || e.length === 0 || e.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new EmbedError("non_transient", "a vector was missing or held a value that is not a number");
      if (dims === -1) dims = e.length;
      if (e.length !== dims) throw new EmbedError("non_transient", "vectors in one reply had different lengths");
      return unit(e as number[]);
    });
  }

  private logEgress(payload: string, redactions: number): void {
    if (!this.cfg.onEgress) return;
    try {
      let host = "unknown";
      try {
        host = new URL(this.cfg.baseUrl).hostname;
      } catch {
        /* keep "unknown" */
      }
      this.cfg.onEgress({ ts: new Date().toISOString(), host, role: "embed", bytes: Buffer.byteLength(payload), sha256: createHash("sha256").update(payload).digest("hex"), redactions });
    } catch {
      /* a failing log must never stop a call */
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * A recording stores each vector as one scale (a float32) followed by one signed byte per dimension, in base64: about 2.7 KB for a 2,048-dimension vector instead of 15 KB as
 * text. The rounding moves a cosine by about 0.001, which is below anything the Desk compares. Entries are grouped into 16 files by the first character of their key, so adding a
 * recording changes one file and no file grows past a size the repository accepts.
 */
interface ShardFile {
  model: string;
  dims: number;
  format: "int8-scaled-base64";
  entries: Record<string, string>;
}

const slug = (model: string): string => model.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const shardPath = (dir: string, model: string, key: string): string => join(dir, `embed-${slug(model)}-${key.charAt(0)}.json`);

export function encodeVector(v: Float32Array): string {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max === 0 ? 1 : max / 127;
  const buf = Buffer.alloc(4 + v.length);
  buf.writeFloatLE(scale, 0);
  for (let i = 0; i < v.length; i += 1) buf.writeInt8(Math.max(-127, Math.min(127, Math.round((v[i] as number) / scale))), 4 + i);
  return buf.toString("base64");
}

export function decodeVector(text: string): Float32Array {
  const buf = Buffer.from(text, "base64");
  if (buf.length < 5) throw new EmbedError("non_transient", "a recorded vector is too short");
  const scale = buf.readFloatLE(0);
  const out = new Float32Array(buf.length - 4);
  for (let i = 0; i < out.length; i += 1) out[i] = buf.readInt8(4 + i) * scale;
  return unit(out);
}

export class CassetteEmbedder implements Embedder {
  readonly id: string;
  readonly source = "cassette" as const;
  private readonly shards = new Map<string, ShardFile | null>();

  constructor(private readonly dir: string, model: string = DEFAULT_EMBED_MODEL) {
    this.id = model;
  }

  private shard(key: string): ShardFile | null {
    const file = shardPath(this.dir, this.id, key);
    if (!this.shards.has(file)) {
      let parsed: ShardFile | null = null;
      if (existsSync(file)) {
        try {
          const p = JSON.parse(readFileSync(file, "utf8")) as ShardFile;
          if (p.model === this.id && p.format === "int8-scaled-base64" && p.entries && typeof p.entries === "object") parsed = p;
        } catch {
          parsed = null;
        }
      }
      this.shards.set(file, parsed);
    }
    return this.shards.get(file) ?? null;
  }

  /** Read the files again on the next lookup, after something else has written them. */
  forget(): void {
    this.shards.clear();
  }

  has(kind: EmbedKind, text: string): boolean {
    if (isBlank(text)) return true;
    const key = cassetteKey(this.id, kind, text);
    return this.shard(key)?.entries[key] !== undefined;
  }

  async embed(texts: readonly string[], kind: EmbedKind): Promise<Float32Array[]> {
    return texts.map((t) => {
      if (isBlank(t)) return NO_MEANING;
      const key = cassetteKey(this.id, kind, t);
      const hit = this.shard(key)?.entries[key];
      if (hit === undefined) throw new EmbedError("cassette_miss", `E_CASSETTE_MISS: no recorded embedding for this ${kind} text (${key}). Record it live with: desk record --role embed`);
      return decodeVector(hit);
    });
  }
}

/** Replays a recording when there is one and calls the live endpoint, recording the reply, when there is not. */
export class ReplayOrRecordEmbedder implements Embedder {
  readonly id: string;
  readonly source = "live" as const;
  private readonly replay: CassetteEmbedder;

  constructor(private readonly live: Embedder, private readonly dir: string) {
    this.id = live.id;
    this.replay = new CassetteEmbedder(dir, live.id);
    mkdirSync(dir, { recursive: true });
  }

  async embed(texts: readonly string[], kind: EmbedKind, deadlineMs?: number): Promise<Float32Array[]> {
    const missing = texts.filter((t) => !this.replay.has(kind, t));
    if (missing.length > 0) {
      const unique = [...new Set(missing.map((t) => prepare(t).text))];
      const vectors = await this.live.embed(unique, kind, deadlineMs);
      this.record(unique, vectors, kind);
    }
    return this.replay.embed(texts, kind);
  }

  private record(texts: readonly string[], vectors: readonly Float32Array[], kind: EmbedKind): void {
    const byFile = new Map<string, Map<string, string>>();
    texts.forEach((t, i) => {
      const key = cassetteKey(this.id, kind, t);
      const file = shardPath(this.dir, this.id, key);
      if (!byFile.has(file)) byFile.set(file, new Map());
      byFile.get(file)?.set(key, encodeVector(vectors[i] as Float32Array));
    });
    for (const [file, add] of byFile) {
      let current: ShardFile = { model: this.id, dims: (vectors[0] as Float32Array).length, format: "int8-scaled-base64", entries: {} };
      if (existsSync(file)) {
        try {
          const p = JSON.parse(readFileSync(file, "utf8")) as ShardFile;
          if (p.model === this.id) current = p;
        } catch {
          /* a damaged recording is replaced by what is recorded now */
        }
      }
      for (const [k, v] of add) current.entries[k] = v;
      const keys = Object.keys(current.entries).sort();
      const body = keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(current.entries[k])}`).join(",\n");
      writeFileSync(file, `{\n  "model": ${JSON.stringify(current.model)},\n  "dims": ${current.dims},\n  "format": "int8-scaled-base64",\n  "entries": {\n${body}\n  }\n}\n`);
    }
    this.replay.forget();
  }
}
