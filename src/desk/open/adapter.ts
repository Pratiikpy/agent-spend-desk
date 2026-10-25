import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EVENTS_SCHEMA, formatEvents, parseEvents, type CallRecord, type HeaderRecord, type SessionRecord } from "./events.ts";

/**
 * The adapter SDK (DF-063). An adapter teaches the Desk to read one more tool's files. It is a single module with two pure functions, `detect` and `parse`, and a manifest
 * that names the real sample file it was built from and the golden outputs it must reproduce. The Desk does not load an adapter whose fixtures fail, whose sample is not the
 * file the manifest pins, or that claims every file it is shown.
 *
 * An adapter is code someone else wrote, run on the owner's machine. It runs in a process of its own with Node's permission model on (it reads its own folder and nothing else,
 * writes nowhere, starts no process) and may import only a short list of built-in modules; nothing leaves but the JSON it returns. That stops a careless adapter from doing
 * damage and a curious one from reading files. It does not make a hostile adapter safe, and the owner reads an adapter before running it, as with any package.
 */
export interface AdapterManifest {
  id: string;
  tool: string;
  version: string;
  description: string;
  license: string;
  schema: typeof EVENTS_SCHEMA;
  /** The adapter module, a file in the adapter's folder ending in .mjs. */
  entry: string;
  sample: {
    /** The file the adapter was built from, in the adapter's folder. */
    file: string;
    sha256: string;
    /** A real file from a real run of the tool, or one the author made up to show how an adapter is written. A made-up sample is for learning: the Desk tests such an adapter and will not import with it. */
    kind: "real" | "constructed";
    /** Where it came from: the tool, its version, when it was captured. The Desk cannot check this; it is the author's statement. */
    origin: string;
    capturedAt: string;
  };
  fixtures: { input: string; golden: string }[];
}

export interface AdapterOutput {
  sessions: Omit<SessionRecord, "type">[];
  calls: Omit<CallRecord, "type">[];
  notes?: string[];
}

export interface DeskAdapter {
  /** True when the first bytes of a file (up to 8 KB) look like this tool's. Pure. */
  detect(head: string): boolean;
  /** Turn a whole file into events. Pure and deterministic: the same text gives the same events, with no clock, randomness, network or other file. */
  parse(text: string, ctx: { fileName: string }): AdapterOutput | Promise<AdapterOutput>;
}

export const MANIFEST_FILE = "adapter.json";
export const LIMITS_ADAPTER = { manifestBytes: 64 * 1024, entryBytes: 256 * 1024, fileBytes: 64 * 1024 * 1024, headBytes: 8 * 1024, runMs: 30_000, outputBytes: 128 * 1024 * 1024, heapMb: 512, fixtures: 20 } as const;

const ID = /^[a-z][a-z0-9_-]{1,39}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{64}$/;

const hex = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** A path in a manifest must stay inside the adapter's folder. */
function inside(dir: string, rel: unknown, what: string): string | { error: string } {
  if (typeof rel !== "string" || rel === "" || rel.length > 200) return { error: `${what} must be a path inside the adapter's folder` };
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return { error: `${what} (${rel}) points outside the adapter's folder` };
  const full = resolve(dir, rel);
  const back = relative(dir, full);
  if (back.startsWith("..") || isAbsolute(back)) return { error: `${what} (${rel}) points outside the adapter's folder` };
  return full;
}

export type ManifestResult = { ok: true; manifest: AdapterManifest } | { ok: false; error: string };

export function parseManifest(raw: unknown): ManifestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "adapter.json must be a JSON object" };
  const o = raw as Record<string, unknown>;
  const known = ["id", "tool", "version", "description", "license", "schema", "entry", "sample", "fixtures"];
  for (const k of Object.keys(o)) if (!known.includes(k)) return { ok: false, error: `adapter.json has a field "${k}" that is not known (known: ${known.join(", ")})` };
  const need = (k: string, ok: boolean, why: string): string | null => (ok ? null : `${k} ${why}`);
  const text = (v: unknown, max = 200): boolean => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
  const problems = [
    need("id", typeof o["id"] === "string" && ID.test(o["id"]), "must be 2 to 40 lowercase letters, digits, hyphens or underscores, starting with a letter"),
    need("tool", text(o["tool"], 80), "must be the name of the tool it reads"),
    need("version", typeof o["version"] === "string" && SEMVER.test(o["version"]), "must be a version such as 1.0.0"),
    need("description", text(o["description"], 400), "must say in a sentence what it reads"),
    need("license", text(o["license"], 60), "must be a licence such as MIT"),
    need("schema", o["schema"] === EVENTS_SCHEMA, `must be "${EVENTS_SCHEMA}"`),
    need("entry", typeof o["entry"] === "string" && /\.mjs$/.test(o["entry"]), "must name a .mjs file"),
  ].filter((x): x is string => x !== null);
  if (problems.length > 0) return { ok: false, error: problems[0] as string };
  const s = o["sample"] as Record<string, unknown> | null;
  if (typeof s !== "object" || s === null || Array.isArray(s)) return { ok: false, error: "sample must be an object naming the file the adapter was built from" };
  for (const k of Object.keys(s)) if (!["file", "sha256", "kind", "origin", "capturedAt"].includes(k)) return { ok: false, error: `sample has a field "${k}" that is not known` };
  if (!text(s["file"])) return { ok: false, error: "sample.file must be the sample file's path" };
  if (typeof s["sha256"] !== "string" || !SHA.test(s["sha256"])) return { ok: false, error: "sample.sha256 must be the file's SHA-256 in lowercase hex" };
  if (s["kind"] !== "real" && s["kind"] !== "constructed") return { ok: false, error: 'sample.kind must be "real" (a file from a real run of the tool) or "constructed" (made up to show how an adapter is written)' };
  if (!text(s["origin"], 400)) return { ok: false, error: "sample.origin must say where the file came from: the tool, its version and when it was captured" };
  if (typeof s["capturedAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s["capturedAt"])) return { ok: false, error: "sample.capturedAt must be a date such as 2026-10-20" };
  const f = o["fixtures"];
  if (!Array.isArray(f) || f.length === 0 || f.length > LIMITS_ADAPTER.fixtures) return { ok: false, error: `fixtures must list from 1 to ${LIMITS_ADAPTER.fixtures} pairs of an input file and its golden output` };
  for (const [i, x] of f.entries()) {
    const p = x as Record<string, unknown> | null;
    if (typeof p !== "object" || p === null || Array.isArray(p) || Object.keys(p).some((k) => k !== "input" && k !== "golden") || !text(p["input"]) || !text(p["golden"])) return { ok: false, error: `fixtures[${i}] must be { "input": path, "golden": path }` };
  }
  return { ok: true, manifest: raw as AdapterManifest };
}

export interface LoadedAdapter {
  dir: string;
  manifest: AdapterManifest;
  entryUrl: string;
  entryPath: string;
}

export interface FixtureResult {
  input: string;
  ok: boolean;
  detail: string;
}

export interface AdapterTest {
  dir: string;
  id: string | null;
  loaded: LoadedAdapter | null;
  /** Why the adapter is not loaded, when it is not. */
  refusal: string | null;
  fixtures: FixtureResult[];
  /** True for an adapter whose sample is made up: it is tested, and it will not import. */
  illustrative: boolean;
  notes: string[];
}

export interface SandboxReply<T> {
  ok: boolean;
  out?: T;
  error?: string;
}

const RUNNER = fileURLToPath(new URL("./adapter-runner.mjs", import.meta.url));

/** Whether this Node can run an adapter in its sandbox. When it cannot, no adapter is run: the sandbox is not optional. */
export function sandboxAvailable(): { ok: boolean; reason: string } {
  const r = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${RUNNER}`, "-e", "process.stdout.write('ok')"], { encoding: "utf8", timeout: 15_000, env: {} });
  if (r.status === 0 && r.stdout === "ok") return { ok: true, reason: "" };
  return { ok: false, reason: `this Node (${process.version}) could not start with its permission model on (${(r.stderr || String(r.error ?? "")).split("\n")[0]?.slice(0, 160) ?? ""}); adapters run only inside it, so none is run` };
}

/** Run one operation of an adapter in its sandbox. */
export function runInSandbox<T>(a: Pick<LoadedAdapter, "dir" | "entryUrl">, op: "detect" | "parse", text: string, fileName: string, limits: { runMs?: number } = {}): SandboxReply<T> {
  const request = JSON.stringify({ entry: a.entryUrl, op, text, fileName });
  const r = spawnSync(process.execPath, ["--permission", `--allow-fs-read=${a.dir}`, `--allow-fs-read=${RUNNER}`, `--max-old-space-size=${LIMITS_ADAPTER.heapMb}`, RUNNER], {
    input: request, encoding: "utf8", timeout: limits.runMs ?? LIMITS_ADAPTER.runMs, maxBuffer: LIMITS_ADAPTER.outputBytes, env: {}, windowsHide: true,
  });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    return { ok: false, error: code === "ETIMEDOUT" ? `the adapter did not finish in ${(limits.runMs ?? LIMITS_ADAPTER.runMs) / 1000} seconds and was stopped` : code === "ENOBUFS" ? "the adapter's output was larger than the limit" : String(r.error.message).slice(0, 300) };
  }
  if (r.status !== 0) return { ok: false, error: `the adapter's process ended with status ${String(r.status)}: ${(r.stderr || "").split("\n").find((l) => l.trim() !== "")?.slice(0, 300) ?? "no message"}` };
  try {
    return JSON.parse(r.stdout) as SandboxReply<T>;
  } catch {
    return { ok: false, error: "the adapter wrote something that is not the reply the Desk expects" };
  }
}

/** The events text for an adapter's output: the header the Desk writes (the adapter does not choose its own tool id), then the adapter's sessions and calls, checked. */
export function eventsFrom(m: AdapterManifest, out: AdapterOutput, producedAt: string | null = null): { text: string } | { error: string } {
  if (typeof out !== "object" || out === null || !Array.isArray(out.sessions) || !Array.isArray(out.calls)) return { error: "parse must return { sessions: [...], calls: [...] }" };
  const header: HeaderRecord = { schema: EVENTS_SCHEMA, type: "header", tool: m.id, tool_version: m.version, produced_at: producedAt };
  const text = formatEvents(header, out.sessions.map((s) => ({ ...s, type: "session" as const })) as SessionRecord[], out.calls.map((c) => ({ ...c, type: "call" as const })) as CallRecord[]);
  const parsed = parseEvents(text);
  if (parsed.problems.length > 0) {
    const p = parsed.problems[0]!;
    return { error: `the adapter's output is not valid desk.events/1: record ${p.line - 1}${p.field ? `, ${p.field}` : ""}: ${p.message}${parsed.problems.length > 1 ? ` (and ${parsed.problems.length - 1 + parsed.moreProblems} more)` : ""}` };
  }
  return { text };
}

/**
 * Check an adapter's folder and run its fixtures. The adapter is loaded only if all of it holds: a valid manifest, an entry and a sample that are the files the manifest names,
 * a sample whose hash is the one pinned, at least one fixture on that sample, every golden output reproduced byte for byte, the same output on a second run, a `detect`
 * that recognises the sample and does not recognise a file that is not the tool's.
 */
export function testAdapter(dir: string): AdapterTest {
  const root = resolve(dir);
  const out: AdapterTest = { dir: root, id: null, loaded: null, refusal: null, fixtures: [], illustrative: false, notes: [] };
  const refuse = (why: string): AdapterTest => ({ ...out, refusal: why });
  const mpath = join(root, MANIFEST_FILE);
  if (!existsSync(mpath)) return refuse(`there is no ${MANIFEST_FILE} in ${root}`);
  if (statSync(mpath).size > LIMITS_ADAPTER.manifestBytes) return refuse(`${MANIFEST_FILE} is larger than ${LIMITS_ADAPTER.manifestBytes} bytes`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(mpath, "utf8"));
  } catch {
    return refuse(`${MANIFEST_FILE} is not valid JSON`);
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok) return refuse(parsed.error);
  const m = parsed.manifest;
  out.id = m.id;
  out.illustrative = m.sample.kind === "constructed";
  const entry = inside(root, m.entry, "entry");
  if (typeof entry !== "string") return refuse(entry.error);
  if (!existsSync(entry) || statSync(entry).size > LIMITS_ADAPTER.entryBytes) return refuse(`the entry ${m.entry} is missing or larger than ${LIMITS_ADAPTER.entryBytes} bytes`);
  const sample = inside(root, m.sample.file, "sample.file");
  if (typeof sample !== "string") return refuse(sample.error);
  if (!existsSync(sample)) return refuse(`the sample ${m.sample.file} is missing, so the adapter is not built from a sample the Desk can see`);
  if (hex(readFileSync(sample)) !== m.sample.sha256) return refuse(`the sample ${m.sample.file} is not the file the manifest pins (its SHA-256 differs)`);
  const pairs: { input: string; golden: string; inputRel: string }[] = [];
  for (const f of m.fixtures) {
    const i = inside(root, f.input, "a fixture input");
    const g = inside(root, f.golden, "a fixture golden");
    if (typeof i !== "string") return refuse(i.error);
    if (typeof g !== "string") return refuse(g.error);
    if (!existsSync(i) || !existsSync(g)) return refuse(`fixture ${f.input} or its golden ${f.golden} is missing`);
    if (statSync(i).size > LIMITS_ADAPTER.fileBytes || statSync(g).size > LIMITS_ADAPTER.fileBytes) return refuse(`fixture ${f.input} is larger than ${LIMITS_ADAPTER.fileBytes} bytes`);
    pairs.push({ input: i, golden: g, inputRel: f.input });
  }
  if (!pairs.some((p) => p.input === sample)) return refuse("no fixture runs on the sample: the adapter must reproduce a golden output from the real file it was built from");
  const sb = sandboxAvailable();
  if (!sb.ok) return refuse(sb.reason);

  const entryUrl = pathToFileURL(entry).href;
  const adapter: LoadedAdapter = { dir: root, manifest: m, entryUrl, entryPath: entry };
  let allOk = true;
  for (const p of pairs) {
    const text = readFileSync(p.input, "utf8");
    const first = runInSandbox<AdapterOutput>(adapter, "parse", text, p.inputRel);
    if (!first.ok || first.out === undefined) {
      out.fixtures.push({ input: p.inputRel, ok: false, detail: first.error ?? "no output" });
      allOk = false;
      continue;
    }
    const built = eventsFrom(m, first.out);
    if ("error" in built) {
      out.fixtures.push({ input: p.inputRel, ok: false, detail: built.error });
      allOk = false;
      continue;
    }
    const golden = readFileSync(p.golden, "utf8");
    if (built.text !== golden) {
      const a = built.text.split("\n");
      const b = golden.split("\n");
      const at = a.findIndex((l, i) => l !== b[i]);
      out.fixtures.push({ input: p.inputRel, ok: false, detail: `the output differs from ${relative(root, p.golden).split(sep).join("/")} at line ${at + 1}: got ${(a[at] ?? "(end of file)").slice(0, 160)}; expected ${(b[at] ?? "(end of file)").slice(0, 160)}` });
      allOk = false;
      continue;
    }
    const second = runInSandbox<AdapterOutput>(adapter, "parse", text, p.inputRel);
    const again = second.ok && second.out !== undefined ? eventsFrom(m, second.out) : null;
    if (again === null || "error" in again || again.text !== built.text) {
      out.fixtures.push({ input: p.inputRel, ok: false, detail: "a second run on the same file gave a different output; parse must be deterministic" });
      allOk = false;
      continue;
    }
    out.fixtures.push({ input: p.inputRel, ok: true, detail: `${built.text.split("\n").length - 1} records, identical to ${relative(root, p.golden).split(sep).join("/")} on two runs` });
  }
  if (!allOk) return { ...out, refusal: "a fixture failed, so the adapter is not loaded" };

  const head = (s: string): string => s.slice(0, LIMITS_ADAPTER.headBytes);
  const sampleDetect = runInSandbox<boolean>(adapter, "detect", head(readFileSync(sample, "utf8")), m.sample.file);
  if (!sampleDetect.ok || sampleDetect.out !== true) return { ...out, refusal: `detect does not recognise the sample it was built from${sampleDetect.error ? ` (${sampleDetect.error})` : ""}` };
  for (const [label, probe] of [["an empty file", ""], ["a JSON object that is not the tool's", '{"hello":"world"}'], ["a desk.events/1 file", `{"schema":"${EVENTS_SCHEMA}","type":"header","tool":"other"}\n`]] as const) {
    const r = runInSandbox<boolean>(adapter, "detect", probe, "probe");
    if (!r.ok || r.out !== false) return { ...out, refusal: `detect says it recognises ${label}; an adapter that claims files that are not its tool's is not loaded${r.error ? ` (${r.error})` : ""}` };
  }
  return { ...out, loaded: adapter, notes: out.illustrative ? ["The sample is marked constructed: this adapter passes its tests and shows how one is written, and the Desk will not import with it."] : ["The sample's origin is the author's statement; the Desk checks that the file is the pinned one, not that it came from a real run."] };
}

/**
 * Write the golden file of every fixture that has none, from the adapter's own output. The author reads each against the sample before relying on it: a golden made from the
 * adapter proves nothing until a person has checked it, so the command says so. A golden that exists is never overwritten.
 */
export function writeMissingGoldens(dir: string): { lines: string[] } | { error: string } {
  const root = resolve(dir);
  const mpath = join(root, MANIFEST_FILE);
  if (!existsSync(mpath)) return { error: `there is no ${MANIFEST_FILE} in ${root}` };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(mpath, "utf8"));
  } catch {
    return { error: `${MANIFEST_FILE} is not valid JSON` };
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok) return { error: parsed.error };
  const m = parsed.manifest;
  const entry = inside(root, m.entry, "entry");
  if (typeof entry !== "string") return { error: entry.error };
  if (!existsSync(entry)) return { error: `the entry ${m.entry} is missing` };
  const sb = sandboxAvailable();
  if (!sb.ok) return { error: sb.reason };
  const adapter: LoadedAdapter = { dir: root, manifest: m, entryUrl: pathToFileURL(entry).href, entryPath: entry };
  const lines: string[] = [];
  for (const f of m.fixtures) {
    const input = inside(root, f.input, "a fixture input");
    const golden = inside(root, f.golden, "a fixture golden");
    if (typeof input !== "string") return { error: input.error };
    if (typeof golden !== "string") return { error: golden.error };
    if (existsSync(golden)) {
      lines.push(`${f.golden} exists and was left alone.`);
      continue;
    }
    if (!existsSync(input)) return { error: `fixture input ${f.input} is missing` };
    const r = runInSandbox<AdapterOutput>(adapter, "parse", readFileSync(input, "utf8"), f.input);
    if (!r.ok || r.out === undefined) return { error: `${f.input}: parse failed: ${r.error ?? "no reply"}` };
    const built = eventsFrom(m, r.out);
    if ("error" in built) return { error: `${f.input}: ${built.error}` };
    writeFileSync(golden, built.text);
    lines.push(`Wrote ${f.golden} from the adapter's own output (${built.text.trimEnd().split(String.fromCharCode(10)).length} records). Read it against ${f.input} line by line before you rely on it: a golden made by the adapter proves nothing until a person has checked it.`);
  }
  return { lines };
}

export interface AdapterSet {
  tested: AdapterTest[];
  loaded: LoadedAdapter[];
}

/** Test every adapter folder directly under a root. */
export function loadAdapters(root: string): AdapterSet {
  const base = resolve(root);
  const tested: AdapterTest[] = [];
  if (existsSync(base)) {
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith("_") || d.name.startsWith(".")) continue;
      tested.push(testAdapter(join(base, d.name)));
    }
  }
  return { tested, loaded: tested.flatMap((t) => (t.loaded ? [t.loaded] : [])) };
}

export interface AdapterRun {
  tool: string;
  text: string;
  notes: string[];
}

/** Run a loaded adapter over a file of the owner's and return the events it makes, checked. */
export function runAdapter(a: LoadedAdapter, file: string): AdapterRun | { error: string } {
  const sb = sandboxAvailable();
  if (!sb.ok) return { error: sb.reason };
  if (a.manifest.sample.kind !== "real") return { error: `${a.manifest.id} was built from a sample marked ${a.manifest.sample.kind}; only an adapter built from a real file imports` };
  const size = statSync(file).size;
  if (size > LIMITS_ADAPTER.fileBytes) return { error: `${file} is ${size.toLocaleString("en-US")} bytes; an adapter reads at most ${LIMITS_ADAPTER.fileBytes.toLocaleString("en-US")}. Split the file.` };
  const text = readFileSync(file, "utf8");
  const head = runInSandbox<boolean>(a, "detect", text.slice(0, LIMITS_ADAPTER.headBytes), file);
  if (!head.ok) return { error: `detect failed: ${head.error ?? "no reply"}` };
  if (head.out !== true) return { error: `${a.manifest.id} does not recognise ${file} as a ${a.manifest.tool} file` };
  const r = runInSandbox<AdapterOutput>(a, "parse", text, file);
  if (!r.ok || r.out === undefined) return { error: `parse failed: ${r.error ?? "no reply"}` };
  const built = eventsFrom(a.manifest, r.out, null);
  if ("error" in built) return { error: built.error };
  return { tool: a.manifest.id, text: built.text, notes: Array.isArray(r.out.notes) ? r.out.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 300)).slice(0, 20) : [] };
}
