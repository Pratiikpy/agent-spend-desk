import { existsSync, lstatSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { findJsonlLogs } from "../ingest/discover.ts";

/**
 * Every source the Desk can read, and what each can and cannot tell it (DF-001). A capability is declared once, here, and shown
 * wherever a source is shown, so a reader never has to infer from a missing number that a tool does not report it. "No" is a
 * statement: the source does not carry the thing, and the Desk leaves a gap there, never a zero.
 */
export type Level = "yes" | "partial" | "no";
export interface Capability {
  level: Level;
  note: string;
}

export const CAPABILITY_KEYS = ["tokens", "cache_split", "reported_cost", "tool_results", "prompts", "plan_limits", "sub_agents", "speed_and_geography", "project_context"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const CAPABILITY_TITLE: Record<CapabilityKey, string> = {
  tokens: "Tokens per call",
  cache_split: "Cache writes split by lifetime",
  reported_cost: "The tool's own cost",
  tool_results: "Tool results",
  prompts: "Your prompts",
  plan_limits: "Plan-limit readings",
  sub_agents: "Delegated agents",
  speed_and_geography: "Speed and inference geography",
  project_context: "Folder and branch",
};

export interface AdapterDecl {
  id: string;
  title: string;
  /** The tool or product whose data it is. */
  tool: string;
  /** How it is read. */
  form: "jsonl_folder" | "sqlite_file" | "file";
  /** How it gets into the ledger: read from where the tool keeps it, or imported from a file the owner names. */
  how: "automatic" | "import";
  /** The command that reads it, for a source that is imported. */
  command?: string;
  /** The kind of source it is recorded as in the ledger, when it is recorded as one. */
  ledgerKind: string | null;
  /** Where the Desk looks by default, given the environment and the home folder. */
  paths: (env: Readonly<Record<string, string | undefined>>, home: string) => string[];
  /** The option that points the Desk somewhere else. */
  override: string;
  capabilities: Record<CapabilityKey, Capability>;
}

const yes = (note: string): Capability => ({ level: "yes", note });
const partial = (note: string): Capability => ({ level: "partial", note });
const no = (note: string): Capability => ({ level: "no", note });

/** A comma- or path-separated list from an environment variable: Claude Code accepts several configuration folders. */
const listOf = (raw: string | undefined): string[] => (raw ?? "").split(new RegExp(`[,${delimiter === ";" ? ";" : ":"}]`)).map((s) => s.trim()).filter((s) => s !== "");

export const ADAPTERS: readonly AdapterDecl[] = [
  {
    id: "claude_code",
    title: "Claude Code local logs",
    tool: "Claude Code",
    form: "jsonl_folder",
    how: "automatic",
    ledgerKind: "claude_code",
    override: "--claude-dir",
    paths: (env, home) => {
      const dirs = listOf(env["CLAUDE_CONFIG_DIR"]);
      return dirs.length > 0 ? dirs.map((d) => join(d, "projects")) : [join(home, ".claude", "projects"), join(home, ".config", "claude", "projects")];
    },
    capabilities: {
      tokens: yes("input, output, cache reads and cache writes of every call, with a call logged across several lines read as one"),
      cache_split: yes("5-minute and 1-hour cache writes, when the log carries the split; a call without it is priced and marked"),
      reported_cost: partial("the tool's running cost for a process, in versions that write it; older versions write none"),
      tool_results: partial("whether each result was an error and how long it was; the text is not kept"),
      prompts: partial("when you sent a prompt, never what it said"),
      plan_limits: partial("only through the status line, once `desk statusline install` has turned it on"),
      sub_agents: yes("delegated agents' calls are marked and counted with the session that started them"),
      speed_and_geography: yes("the speed and inference geography each call says it ran with; a call that says nothing is priced standard and marked"),
      project_context: yes("the working folder, the branch and the tool version"),
    },
  },
  {
    id: "codex",
    title: "Codex CLI session logs",
    tool: "Codex",
    form: "jsonl_folder",
    how: "automatic",
    ledgerKind: "codex",
    override: "--codex-dir",
    paths: (env, home) => [join(env["CODEX_HOME"] ?? join(home, ".codex"), "sessions")],
    capabilities: {
      tokens: partial("each call is the growth of the session's cumulative total; requests merged into one reading are marked, a part that went down or more cache than input is flagged, and a counter that restarted is counted"),
      cache_split: no("Codex reports cached input as one number, with no 5-minute or 1-hour split"),
      reported_cost: no("Codex writes no cost"),
      tool_results: no("the Desk does not read this from these logs"),
      prompts: no("the Desk does not read this from these logs"),
      plan_limits: yes("the percent of each window used and when it resets, written beside the token counts"),
      sub_agents: yes("a session started by another is marked, and a forked session's replayed history is left out"),
      speed_and_geography: no("the log does not record it"),
      project_context: yes("the working folder, the branch and the CLI version"),
    },
  },
  {
    id: "opencode",
    title: "OpenCode database",
    tool: "OpenCode",
    form: "sqlite_file",
    how: "automatic",
    ledgerKind: "opencode",
    override: "--opencode-db",
    paths: (env, home) => [join(env["XDG_DATA_HOME"] ?? join(home, ".local", "share"), "opencode", "opencode.db")],
    capabilities: {
      tokens: yes("input, output, reasoning and cache tokens of each message; read only from the database, never its credential tables"),
      cache_split: partial("cache reads and writes, without a lifetime for the writes"),
      reported_cost: partial("OpenCode's own cost per message when it is above zero, kept beside the estimate and never replacing it; a zero says nothing and is not kept"),
      tool_results: no("tool names only"),
      prompts: no("the Desk does not read this from these logs"),
      plan_limits: no("the tool does not report it"),
      sub_agents: yes("a message in a child session is marked"),
      speed_and_geography: no("the tool does not record it"),
      project_context: yes("the project folder"),
    },
  },
  {
    id: "litellm",
    title: "LiteLLM spend log (gateway)",
    tool: "LiteLLM gateway",
    form: "file",
    how: "import",
    command: "desk gateway import <file>",
    ledgerKind: "gateway",
    override: "the file you name",
    paths: () => [],
    capabilities: {
      tokens: yes("prompt and completion tokens of each request, with the cache split out of the prompt when the row's usage object says it"),
      cache_split: partial("cache reads and writes when the usage object carries them, with no lifetime for the writes; otherwise all prompt tokens count as fresh input and the row is counted"),
      reported_cost: yes("the gateway's own `spend` per request, kept beside the estimate and never replacing it"),
      tool_results: no("a spend log does not hold it"),
      prompts: no("the conversation columns are never read"),
      plan_limits: no("a gateway has no plan window"),
      sub_agents: no("a spend log does not hold it"),
      speed_and_geography: no("a spend log does not hold it"),
      project_context: no("a gateway session id, or a pseudonym of the user: never a name or a folder"),
    },
  },
  {
    id: "otel_genai",
    title: "OpenTelemetry GenAI spans",
    tool: "any OpenTelemetry exporter",
    form: "file",
    how: "import",
    command: "desk otel import <file>",
    ledgerKind: "otel",
    override: "the file you name",
    paths: () => [],
    capabilities: {
      tokens: yes("input and output tokens of each leaf model span, in the current and the earlier attribute names; a span with none is a gap"),
      cache_split: partial("cache reads and creations when the exporter writes them, under either spelling, with no lifetime for the writes"),
      reported_cost: partial("only where an exporter writes a cost attribute, which the conventions do not define: a few spellings are read"),
      tool_results: no("tool spans are not read"),
      prompts: no("prompts and completions are never read"),
      plan_limits: no("a span does not hold it"),
      sub_agents: no("a parent span that totals its children is skipped; delegation is not marked"),
      speed_and_geography: no("a span does not hold it"),
      project_context: partial("the service name only"),
    },
  },
  {
    id: "statusline",
    title: "Claude Code status line readings",
    tool: "Claude Code",
    form: "file",
    how: "automatic",
    ledgerKind: null,
    override: "DESK_STATUSLINE_LOG",
    paths: (env, home) => [env["DESK_STATUSLINE_LOG"] ?? join(home, ".desk", "statusline.jsonl")],
    capabilities: {
      tokens: no("only plan percentages, no tokens"),
      cache_split: no("the status line does not carry it"),
      reported_cost: partial("the cost the status line shows for the session, when forwarded"),
      tool_results: no("the status line does not carry it"),
      prompts: no("the status line does not carry it"),
      plan_limits: yes("the 5-hour and weekly windows as Claude Code reports them: percent used and reset time"),
      sub_agents: no("the status line does not carry it"),
      speed_and_geography: no("the status line does not carry it"),
      project_context: no("the status line does not carry it"),
    },
  },
];

/** Tools the Desk knows exist and cannot read, and why: said, never silently skipped. */
export const NO_ADAPTER: readonly { tool: string; paths: (home: string) => string[]; why: string }[] = [
  { tool: "Gemini CLI", paths: (h) => [join(h, ".gemini")], why: "no adapter has been written; its session format has not been checked" },
  { tool: "Cline", paths: (h) => [join(h, ".cline")], why: "no adapter has been written; its task history has not been checked" },
  { tool: "Cursor", paths: (h) => [join(h, ".cursor")], why: "no adapter has been written; its usage is kept in its own cloud account, not in files here" },
  { tool: "GitHub Copilot CLI", paths: (h) => [join(h, ".copilot")], why: "its local store holds turns and no token counts (checked 2026-10-24), so it cannot be read" },
];

export interface FoundSource {
  path: string;
  files: number;
  bytes: number;
  /** The dates the files were last changed between, as a stand-in for the span of the logs (the files are not opened). */
  changedFrom: string | null;
  changedTo: string | null;
}

export interface SourceReport {
  adapter: AdapterDecl;
  /** Every path looked at, found or not. */
  searched: string[];
  found: FoundSource[];
}

export interface NoAdapterReport {
  tool: string;
  searched: string[];
  present: boolean;
  why: string;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function inspect(adapter: AdapterDecl, path: string): FoundSource | null {
  if (!existsSync(path)) return null;
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) return null;
  if (adapter.form === "jsonl_folder") {
    if (!st.isDirectory()) return null;
    const files = findJsonlLogs(path);
    if (files.length === 0) return { path, files: 0, bytes: 0, changedFrom: null, changedTo: null };
    let bytes = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of files) {
      try {
        const s = statSync(f);
        bytes += s.size;
        lo = Math.min(lo, s.mtimeMs);
        hi = Math.max(hi, s.mtimeMs);
      } catch {
        /* a file that vanished while walking is skipped */
      }
    }
    return { path, files: files.length, bytes, changedFrom: Number.isFinite(lo) ? day(lo) : null, changedTo: Number.isFinite(hi) ? day(hi) : null };
  }
  if (!st.isFile()) return null;
  return { path, files: 1, bytes: st.size, changedFrom: day(st.mtimeMs), changedTo: day(st.mtimeMs) };
}

/** Look for every adapter's source where it normally lives. An adapter that reads an imported file has nothing to find; it is read when its command is run. Read-only: nothing is opened beyond file sizes and times. */
export function discoverSources(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): { sources: SourceReport[]; noAdapter: NoAdapterReport[] } {
  const sources = ADAPTERS.map((adapter) => {
    const searched = adapter.paths(env, home);
    const found = searched.map((p) => inspect(adapter, p)).filter((f): f is FoundSource => f !== null);
    return { adapter, searched, found };
  });
  const noAdapter = NO_ADAPTER.map((n) => {
    const searched = n.paths(home);
    return { tool: n.tool, searched, present: searched.some((p) => existsSync(p)), why: n.why };
  });
  return { sources, noAdapter };
}

const LEVEL_MARK: Record<Level, string> = { yes: "yes    ", partial: "partly ", no: "no     " };
const kb = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The discovery as text: each source found or not, where it looked, and what the source can and cannot say. */
export function renderSources(d: ReturnType<typeof discoverSources>): string {
  const out: string[] = [];
  for (const s of d.sources) {
    const total = s.found.reduce((n, f) => n + f.files, 0);
    out.push(`${s.adapter.title} (adapter ${s.adapter.id})`);
    if (s.adapter.how === "import") {
      out.push(`  read when you import a file: ${s.adapter.command}`);
      for (const key of CAPABILITY_KEYS) out.push(`    ${LEVEL_MARK[s.adapter.capabilities[key].level]}${CAPABILITY_TITLE[key]}: ${s.adapter.capabilities[key].note}`);
      out.push("");
      continue;
    }
    if (s.found.length === 0) out.push(`  not found. Looked in: ${s.searched.join("; ")}. ${s.adapter.override} names another place.`);
    for (const f of s.found) out.push(`  ${f.path}: ${f.files} file${f.files === 1 ? "" : "s"}, ${kb(f.bytes)}${f.changedFrom ? `, changed ${f.changedFrom === f.changedTo ? f.changedFrom : `${f.changedFrom} to ${f.changedTo}`}` : ""}`);
    if (total > 0 || s.found.length > 0) for (const key of CAPABILITY_KEYS) out.push(`    ${LEVEL_MARK[s.adapter.capabilities[key].level]}${CAPABILITY_TITLE[key]}: ${s.adapter.capabilities[key].note}`);
    out.push("");
  }
  out.push("Tools with no adapter");
  for (const n of d.noAdapter) out.push(`  ${n.tool}: ${n.present ? "found on this machine, " : ""}no adapter: ${n.why}.`);
  return out.join("\n");
}
