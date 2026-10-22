import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { seeded } from "../replay/wind-tunnel.ts";

/**
 * A constructed scenario, not a real team's history: a fictional team of engineers using a coding agent over a
 * few months, written as real-format Claude Code logs and real git repositories, with waste PLANTED at known
 * places (loops, idle polling, cache misses, sub-agent fan-out). The Desk reads these files with the same code
 * it uses on a person's own logs, so the demo exercises the real pipeline, and tests can compare what the
 * autopsy finds against what was planted (truth.json).
 */
export interface SampleOptions {
  outDir: string;
  seed: number;
  /** First day of the scenario, UTC. */
  start: string;
  /** Number of 30-day-ish months to generate (calendar days: months * 30). */
  months: number;
  engineers: number;
}

export const DEFAULT_SAMPLE: Omit<SampleOptions, "outDir"> = { seed: 20261022, start: "2026-09-01", months: 2, engineers: 14 };

export type Archetype = "feature" | "bugfix" | "docs" | "loop_stuck" | "loop_brief";
export type Fate = "landed" | "unlanded" | "reverted";

export interface TruthSession {
  id: string;
  repo: string;
  engineer: string;
  archetype: Archetype;
  fate: Fate;
  startIso: string;
  endIso: string;
  calls: number;
  loopCalls: number;
  subagentCalls: number;
  idleCalls: number;
  missCalls: number;
}

export interface Truth {
  seed: number;
  start: string;
  months: number;
  sessions: TruthSession[];
  note: string;
}

const REPOS = ["payments-api", "web-app", "data-pipeline", "mobile-client", "infra"];
const MODULES = ["auth", "billing", "search", "ui", "jobs", "cache", "report"];
const MODEL_MIX: [string, number][] = [["claude-opus-5", 0.6], ["claude-sonnet-5-5", 0.35], ["claude-haiku-5-5", 0.05]];

type Rng = () => number;
const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const int = (r: Rng, lo: number, hi: number) => Math.floor(between(r, lo, hi + 1));
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
function weighted<T>(r: Rng, xs: readonly [T, number][]): T {
  let x = r() * xs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of xs) {
    x -= w;
    if (x <= 0) return v;
  }
  return xs[xs.length - 1]![0];
}
const iso = (ms: number) => new Date(ms).toISOString();

interface Planned {
  id: string;
  repo: string;
  engineer: string;
  archetype: Archetype;
  fate: Fate;
  startMs: number;
}

interface ThreadSpec {
  calls: number;
  /** Index (within the thread) at which a loop begins, and how many repeats. */
  loopAt: number | null;
  loopRepeats: number;
  sidechain: boolean;
  model: string;
  switchModelAt: number | null;
}

function toolFor(r: Rng, repoPath: string): { name: string; input: Record<string, unknown>; chars: number } {
  const file = join(repoPath, "src", pick(r, MODULES), `${pick(r, ["index", "service", "model", "util", "handler"])}.ts`);
  const kind = weighted(r, [["Read", 0.4], ["Edit", 0.2], ["Bash", 0.2], ["Grep", 0.15], ["Write", 0.05]] as [string, number][]);
  if (kind === "Read") return { name: "Read", input: { file_path: file }, chars: int(r, 1500, 28000) };
  if (kind === "Edit") return { name: "Edit", input: { file_path: file, old_string: `a${int(r, 1, 1e6)}`, new_string: `b${int(r, 1, 1e6)}` }, chars: int(r, 80, 400) };
  if (kind === "Write") return { name: "Write", input: { file_path: file, content: `c${int(r, 1, 1e6)}` }, chars: int(r, 60, 200) };
  if (kind === "Grep") return { name: "Grep", input: { pattern: `p${int(r, 1, 1e6)}`, path: repoPath }, chars: int(r, 400, 6000) };
  return { name: "Bash", input: { command: `ls ${int(r, 1, 1e6)}` }, chars: int(r, 300, 8000) };
}

interface ThreadOut {
  lines: string[];
  endMs: number;
  edited: Set<string>;
  loopCalls: number;
  missCalls: number;
}

/** One agent thread: a sequence of API calls with a growing, cached context. */
function genThread(r: Rng, p: Planned, spec: ThreadSpec, repoPath: string, startMs: number, counter: { n: number }, humanEvery: number | null): ThreadOut {
  const lines: string[] = [];
  const edited = new Set<string>();
  let t = startMs;
  let ctx = int(r, 18_000, 32_000) + (spec.sidechain ? 0 : int(r, 0, 20_000));
  let prevCtx = 0;
  let prevT = 0;
  let model = spec.model;
  let loopCalls = 0;
  let missCalls = 0;
  const loopTool: { name: string; input: Record<string, unknown>; chars: number } = { name: "Bash", input: { command: "npm test -- --runInBand" }, chars: int(r, 3000, 6500) };
  let pendingResultChars = 0;

  for (let k = 0; k < spec.calls; k += 1) {
    counter.n += 1;
    const id = `msg_${p.id}_${counter.n}`;
    if (spec.switchModelAt !== null && k === spec.switchModelAt) model = model === "claude-opus-5" ? "claude-sonnet-5-5" : "claude-opus-5";

    // time since the previous call
    const longGap = r() < 0.03;
    t += k === 0 ? 0 : longGap ? int(r, 65, 140) * 60_000 : int(r, 4, 110) * 1000;

    // human prompts open a session and recur now and then
    if (k === 0 || (humanEvery !== null && k % humanEvery === 0)) {
      lines.push(JSON.stringify({ type: "user", isSidechain: spec.sidechain, uuid: `h-${id}`, timestamp: iso(t - 2000), sessionId: p.id, cwd: repoPath, message: { role: "user", content: "please continue with the task" } }));
    }

    const inLoop = spec.loopAt !== null && k >= spec.loopAt && k < spec.loopAt + spec.loopRepeats;
    const tool = inLoop ? loopTool : toolFor(r, repoPath);
    if (inLoop) loopCalls += 1;
    if (tool.name === "Edit" || tool.name === "Write") edited.add(tool.input["file_path"] as string);

    const delta = Math.round(pendingResultChars / 4) + int(r, 200, 1800);
    const gapMs = t - prevT;
    const expired = k > 0 && gapMs > 3_600_000;
    const switched = spec.switchModelAt !== null && k === spec.switchModelAt;
    const prefixChanged = k > 0 && r() < 0.01;
    let read = 0;
    let write = 0;
    if (k === 0 || expired || switched || prefixChanged) {
      write = ctx + delta;
      read = prefixChanged && !expired && !switched ? Math.round(ctx * 0.12) : 0;
      write = ctx + delta - read;
      if (k > 0) missCalls += 1;
    } else {
      read = prevCtx;
      write = delta;
    }
    ctx += delta;
    prevCtx = ctx;
    prevT = t;

    const output = int(r, 120, 2600);
    lines.push(JSON.stringify({
      parentUuid: null, isSidechain: spec.sidechain, type: "assistant", uuid: `${id}-0`, timestamp: iso(t), sessionId: p.id, requestId: `req_${id}`, apiBlockIndex: 0,
      cwd: repoPath, gitBranch: "main", version: "sample-1",
      message: {
        id, type: "message", role: "assistant", model, stop_reason: "tool_use",
        content: [{ type: "tool_use", id: `tu_${id}`, name: tool.name, input: tool.input }],
        usage: {
          input_tokens: int(r, 3, 40), cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output,
          output_tokens_details: { thinking_tokens: r() < 0.3 ? int(r, 50, Math.min(output, 800)) : 0 },
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write }, service_tier: "standard", speed: "standard",
        },
      },
    }));
    pendingResultChars = tool.chars;
    lines.push(JSON.stringify({
      type: "user", isSidechain: spec.sidechain, uuid: `res-${id}`, timestamp: iso(t + int(r, 1, 30) * 1000), sessionId: p.id,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${id}`, content: "x".repeat(tool.chars), is_error: inLoop }] },
    }));
  }
  return { lines, endMs: t, edited, loopCalls, missCalls };
}

function plan(opts: SampleOptions, r: Rng): Planned[] {
  const engineers = Array.from({ length: opts.engineers }, (_, i) => `eng${String(i + 1).padStart(2, "0")}`);
  const out: Planned[] = [];
  const day0 = Date.parse(`${opts.start}T00:00:00Z`);
  let n = 0;
  for (let d = 0; d < opts.months * 30; d += 1) {
    const day = day0 + d * 86_400_000;
    const dow = new Date(day).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const eng of engineers) {
      const sessions = r() < 0.12 ? 0 : weighted(r, [[1, 0.45], [2, 0.35], [3, 0.15], [4, 0.05]] as [number, number][]);
      for (let s = 0; s < sessions; s += 1) {
        n += 1;
        const archetype = weighted<Archetype>(r, [["feature", 0.4], ["bugfix", 0.25], ["docs", 0.1], ["loop_stuck", 0.12], ["loop_brief", 0.13]]);
        const fate: Fate =
          archetype === "loop_stuck" ? (r() < 0.85 ? "unlanded" : "landed")
          : archetype === "docs" ? (r() < 0.1 ? "unlanded" : "landed")
          : archetype === "loop_brief" ? "landed"
          : r() < 0.25 ? "unlanded" : r() < 0.07 ? "reverted" : "landed";
        out.push({ id: `sess-${String(n).padStart(5, "0")}`, repo: pick(r, REPOS), engineer: eng, archetype, fate, startMs: day + int(r, 9, 17) * 3_600_000 + int(r, 0, 59) * 60_000 });
      }
    }
  }
  return out;
}

interface Commit {
  repo: string;
  sha?: string;
  atMs: number;
  engineer: string;
  files: string[];
  trailer: boolean;
  merged: boolean;
  revert: boolean;
  session: string;
  mark: number;
}

function runFastImport(repoDir: string, stream: string, importMarks: string | null, exportMarks: string): void {
  const args = ["-C", repoDir, "fast-import", "--quiet", `--export-marks=${exportMarks}`, ...(importMarks ? [`--import-marks=${importMarks}`] : [])];
  execFileSync("git", args, { input: stream, maxBuffer: 512 * 1024 * 1024 });
}

function commitBlock(ref: string, c: { mark: number; engineer: string; atMs: number; message: string; from: string | null; files: string[]; tag: string }): string {
  const sec = Math.floor(c.atMs / 1000);
  const who = `${c.engineer} <${c.engineer}@example.test> ${sec} +0000`;
  let s = `commit ${ref}\nmark :${c.mark}\nauthor ${who}\ncommitter ${who}\ndata ${Buffer.byteLength(c.message)}\n${c.message}\n`;
  if (c.from) s += `from ${c.from}\n`;
  for (const f of c.files) {
    const body = `${f} edited by ${c.tag}\n`;
    s += `M 100644 inline ${f}\ndata ${Buffer.byteLength(body)}\n${body}\n`;
  }
  return s + "\n";
}

export function buildSample(partial: Partial<SampleOptions> & { outDir: string }): Truth {
  const opts: SampleOptions = { ...DEFAULT_SAMPLE, ...partial };
  const r = seeded(opts.seed);
  const out = resolve(opts.outDir);
  rmSync(out, { recursive: true, force: true });
  const claudeRoot = join(out, "claude", "projects");
  const reposRoot = join(out, "repos");
  for (const repo of REPOS) {
    const dir = join(reposRoot, repo);
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  }
  const planned = plan(opts, r);
  const counter = { n: 0 };
  const truth: Truth = { seed: opts.seed, start: opts.start, months: opts.months, sessions: [], note: "Constructed scenario. Every session, cost and commit here was generated from the seed; none is a real team's history." };
  const commits: Commit[] = [];
  let mark = 0;

  for (const p of planned) {
    const repoPath = join(reposRoot, p.repo);
    const slug = repoPath.replace(/[^A-Za-z0-9]/g, "-");
    const dir = join(claudeRoot, slug);
    mkdirSync(dir, { recursive: true });
    const model = weighted(r, MODEL_MIX);
    const baseCalls = p.archetype === "docs" ? int(r, 5, 15) : p.archetype === "bugfix" ? int(r, 10, 30) : int(r, 18, 55);
    const loopRepeats = p.archetype === "loop_stuck" ? int(r, 14, 40) : p.archetype === "loop_brief" ? int(r, 3, 5) : 0;
    const main = genThread(r, p, { calls: baseCalls + loopRepeats, loopAt: loopRepeats > 0 ? int(r, 4, Math.max(5, baseCalls - 2)) : null, loopRepeats, sidechain: false, model, switchModelAt: r() < 0.03 ? int(r, 3, 8) : null }, repoPath, p.startMs, counter, int(r, 9, 22));
    writeFileSync(join(dir, `${p.id}.jsonl`), main.lines.join("\n") + "\n");

    let subCalls = 0;
    const fan = r() < 0.3 ? (r() < 0.17 ? int(r, 4, 9) : int(r, 1, 3)) : 0;
    let end = main.endMs;
    let missCalls = main.missCalls;
    for (let a = 0; a < fan; a += 1) {
      const sub = genThread(r, p, { calls: int(r, 12, 70), loopAt: null, loopRepeats: 0, sidechain: true, model, switchModelAt: null }, repoPath, p.startMs + int(r, 1, Math.max(2, Math.floor((main.endMs - p.startMs) / 60_000))) * 60_000, counter, null);
      const subDir = join(dir, p.id, "subagents");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, `agent-${String(a + 1).padStart(2, "0")}.jsonl`), sub.lines.join("\n") + "\n");
      subCalls += sub.lines.filter((l) => l.includes('"type":"assistant"')).length;
      end = Math.max(end, sub.endMs);
      missCalls += sub.missCalls;
      for (const f of sub.edited) main.edited.add(f);
    }

    // background polling after the session: assistant calls nobody asked for, hours after the last prompt
    let idleCalls = 0;
    if (r() < 0.06) {
      idleCalls = int(r, 6, 14);
      const poll = genThread(r, p, { calls: idleCalls, loopAt: null, loopRepeats: 0, sidechain: false, model, switchModelAt: null }, repoPath, end + 45 * 60_000, counter, null);
      // strip the polling thread's own human prompt and tool results so the calls read as unattended
      const unattended = poll.lines.filter((l) => !l.includes('"uuid":"h-') && !l.includes('"tool_result"'));
      appendFileSync(join(dir, `${p.id}.jsonl`), unattended.join("\n") + "\n");
      end = Math.max(end, poll.endMs);
    }

    const fate: Fate = main.edited.size === 0 ? "unlanded" : p.fate;
    truth.sessions.push({ id: p.id, repo: p.repo, engineer: p.engineer, archetype: p.archetype, fate, startIso: iso(p.startMs), endIso: iso(end), calls: baseCalls + loopRepeats + subCalls + idleCalls, loopCalls: main.loopCalls, subagentCalls: subCalls, idleCalls, missCalls });

    if (p.fate !== "unlanded" && main.edited.size > 0) {
      const files = [...main.edited].map((f) => f.slice(repoPath.length + 1).split("\\").join("/")).slice(0, 4);
      mark += 1;
      commits.push({ repo: p.repo, atMs: main.endMs + int(r, 3, 20) * 60_000, engineer: p.engineer, files, trailer: r() < 0.7, merged: r() < 0.92, revert: false, session: p.id, mark });
      if (p.fate === "reverted") {
        mark += 1;
        commits.push({ repo: p.repo, atMs: main.endMs + int(r, 1, 6) * 86_400_000, engineer: p.engineer, files, trailer: false, merged: true, revert: true, session: p.id, mark });
      }
    }
  }

  // git: one fast-import per repository; reverts go in a second pass because they need the reverted commit's sha
  for (const repo of REPOS) {
    const dir = join(reposRoot, repo);
    const mine = commits.filter((c) => c.repo === repo && !c.revert).sort((a, b) => a.atMs - b.atMs);
    const firstAt = (mine[0]?.atMs ?? Date.parse(`${opts.start}T00:00:00Z`)) - 86_400_000;
    let stream = commitBlock("refs/heads/main", { mark: 1_000_000, engineer: "eng01", atMs: firstAt, message: "Initial commit", from: null, files: ["README.md"], tag: "init" });
    let lastMain = ":1000000";
    let branchN = 0;
    for (const c of mine) {
      const trailer = c.trailer ? "\n\nCo-Authored-By: Claude <noreply@anthropic.com>" : "";
      const message = `Work from ${c.session}${trailer}`;
      if (c.merged) {
        stream += commitBlock("refs/heads/main", { mark: c.mark, engineer: c.engineer, atMs: c.atMs, message, from: lastMain, files: c.files, tag: c.session });
        lastMain = `:${c.mark}`;
      } else {
        branchN += 1;
        stream += commitBlock(`refs/heads/feature-${branchN}`, { mark: c.mark, engineer: c.engineer, atMs: c.atMs, message, from: lastMain, files: c.files, tag: c.session });
      }
    }
    const marksFile = join(out, `${repo}.marks`);
    runFastImport(dir, stream, null, marksFile);

    const marks = new Map<number, string>();
    for (const line of readFileSync(marksFile, "utf8").split("\n")) {
      const m = /^:(\d+) ([0-9a-f]{40})$/.exec(line);
      if (m) marks.set(Number(m[1]), m[2] as string);
    }
    const reverts = commits.filter((c) => c.repo === repo && c.revert).sort((a, b) => a.atMs - b.atMs);
    if (reverts.length > 0) {
      let rs = "";
      let from = "refs/heads/main^0";
      for (const rv of reverts) {
        const original = commits.find((c) => c.session === rv.session && !c.revert);
        const sha = original ? marks.get(original.mark) : undefined;
        if (!sha) continue;
        rs += commitBlock("refs/heads/main", { mark: rv.mark, engineer: rv.engineer, atMs: rv.atMs, message: `Revert work from ${rv.session}\n\nThis reverts commit ${sha}.`, from, files: rv.files, tag: `revert ${rv.session}` });
        from = `:${rv.mark}`;
      }
      if (rs) runFastImport(dir, rs, marksFile, marksFile);
    }
    rmSync(marksFile, { force: true });
  }

  writeFileSync(join(out, "truth.json"), JSON.stringify(truth, null, 1));
  return truth;
}

export function sampleLogsDir(outDir: string): string {
  return join(resolve(outDir), "claude", "projects");
}

export function sampleReposDir(outDir: string): string {
  return join(resolve(outDir), "repos");
}

export function readTruth(outDir: string): Truth {
  const p = join(resolve(outDir), "truth.json");
  if (!existsSync(p)) throw new Error(`no sample at ${dirname(p)}: build one with: desk sample build`);
  return JSON.parse(readFileSync(p, "utf8")) as Truth;
}
