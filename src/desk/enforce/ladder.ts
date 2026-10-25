import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The enforcement ladder (DF-052): for each tool the Desk reads, whether the Desk can actually stop it, and on what evidence.
 *
 *   enforced     a surface the Desk has TESTED stops the tool: the hook of a tool whose hook was run live and blocked a call, or a gateway door the
 *                tool is known to use and whose block was tested
 *   advisory     the tool can be stopped or asked, but nothing has been shown to do it: an MCP self-check (the agent may ignore it), a hook that has not
 *                been run live, a gateway door tested without the tool, or a tool at a different version from the one tested
 *   notify only  nothing the Desk can use: no pre-call hook and no model traffic it can meter. Caps on it produce notices and month-end findings
 *
 * "Enforced" is never assumed. It needs a recorded test result, and a tool that has changed version since is advisory again until it is re-tested.
 */
export type Level = "enforced" | "advisory" | "notify_only";
export type Surface = "hook" | "gateway_openai" | "gateway_anthropic" | "gateway_responses" | "mcp";

export interface ToolDecl {
  tool: string;
  label: string;
  /** The surface that stops it, when the tool has one, and how it is reached. */
  hook?: { how: string };
  gateway?: { door: "openai" | "anthropic" | "responses"; how: string };
  mcp: boolean;
  /** Why there is no surface, when there is none; or what stands in the way of a surface the tool nearly has. */
  limit?: string;
  /** The command that prints this tool's version, when it has one, so that a result is tied to the version tested. */
  versionCommand?: string;
}

export const TOOLS: readonly ToolDecl[] = [
  {
    tool: "claude_code",
    label: "Claude Code",
    hook: { how: "a PreToolUse hook (`node src/desk/gate/hook-main.ts`) that asks the gate before every tool call" },
    gateway: { door: "anthropic", how: "ANTHROPIC_BASE_URL pointed at the gateway door" },
    mcp: true,
    versionCommand: "claude --version",
  },
  {
    tool: "codex",
    label: "Codex CLI",
    hook: { how: "a PreToolUse hook (`node src/desk/gate/hook-main.ts --tool codex`) in ~/.codex/hooks.json that asks the gate before every tool call" },
    gateway: { door: "responses", how: "a model provider whose base URL is the gateway door, which meters the Responses route" },
    mcp: true,
    versionCommand: "codex --version",
    limit: "the hook stops a tool call from a session the gate has paused or a cap it has reached; Codex's own model spend reaches the gate only through the gateway, which was run against a fake upstream",
  },
  {
    tool: "opencode",
    label: "OpenCode",
    gateway: { door: "anthropic", how: "a provider base URL pointed at the gateway door" },
    mcp: true,
    limit: "its traffic can be pointed at the gateway, but OpenCode itself has not been run through it",
  },
  {
    tool: "cline",
    label: "Cline",
    gateway: { door: "openai", how: "an OpenAI-compatible base URL pointed at the gateway door" },
    mcp: true,
    limit: "its traffic can be pointed at the gateway, but Cline itself has not been run through it",
  },
  {
    tool: "cursor",
    label: "Cursor",
    hook: { how: "a preToolUse hook (`node src/desk/gate/hook-main.ts --tool cursor`, marked failClosed) in ~/.cursor/hooks.json" },
    mcp: false,
    versionCommand: "cursor --version",
    limit: "a hosted IDE agent: its hook can stop a tool call, but its model traffic goes through its own servers, not a base URL the Desk can take, so its spend is not seen",
  },
  { tool: "copilot_cli", label: "GitHub Copilot CLI", mcp: false, limit: "no pre-call hook is known and its model traffic cannot be pointed at a gateway (not verified)" },
  {
    tool: "gemini_cli",
    label: "Gemini CLI",
    hook: { how: "a BeforeTool hook (`node src/desk/gate/hook-main.ts --tool gemini-cli`) in ~/.gemini/settings.json" },
    mcp: true,
    versionCommand: "gemini --version",
    limit: "it speaks Google's API, which no gateway door meters, so its spend is not seen",
  },
];

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

/** One recorded test of one surface. `live` means the real tool was run; `contract` means the Desk's side was exercised with the tool's documented behaviour. */
export interface SurfaceResult {
  surface: Surface;
  mode: "live" | "contract";
  tool: string | null;
  /** The tool's version when the test ran, for a live test. */
  toolVersion: string | null;
  testedAt: string;
  passed: boolean;
  checks: CheckResult[];
}

export interface Results {
  version: 1;
  results: SurfaceResult[];
}

export interface SurfaceRow {
  surface: Surface;
  level: Level;
  /** What the evidence is, in words: tested live on a version, the door tested without the tool, declared and not tested. */
  evidence: string;
}

export interface ToolRow {
  tool: string;
  label: string;
  level: Level;
  /** The sentence the Policy screen shows. */
  reason: string;
  surfaces: SurfaceRow[];
}

export function readResults(path: string): Results {
  if (!existsSync(path)) return { version: 1, results: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Results;
    return parsed.version === 1 && Array.isArray(parsed.results) ? parsed : { version: 1, results: [] };
  } catch {
    return { version: 1, results: [] };
  }
}

/** Keep the newest result of each (surface, mode, tool) and write the file. */
export function recordResults(path: string, fresh: readonly SurfaceResult[]): Results {
  const old = readResults(path);
  const key = (r: SurfaceResult): string => `${r.surface}|${r.mode}|${r.tool ?? ""}`;
  const map = new Map(old.results.map((r) => [key(r), r]));
  for (const r of fresh) map.set(key(r), r);
  const out: Results = { version: 1, results: [...map.values()].sort((a, b) => key(a).localeCompare(key(b))) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

const newest = (results: readonly SurfaceResult[], surface: Surface, mode: SurfaceResult["mode"], tool: string | null): SurfaceResult | undefined =>
  results.filter((r) => r.surface === surface && r.mode === mode && r.tool === tool).sort((a, b) => b.testedAt.localeCompare(a.testedAt))[0];

/**
 * Each tool's level and the reason, from what the tool declares and what has been tested. `installed` gives the version of a tool found on this machine, so a
 * live result for another version does not count.
 */
export function ladder(results: readonly SurfaceResult[], installed: Readonly<Record<string, string | null>> = {}): ToolRow[] {
  return TOOLS.map((t) => {
    const surfaces: SurfaceRow[] = [];
    if (t.hook) {
      const live = newest(results, "hook", "live", t.tool);
      const contract = newest(results, "hook", "contract", t.tool === "claude_code" ? null : t.tool);
      const now = installed[t.tool] ?? null;
      if (live?.passed && (now === null || live.toolVersion === null || live.toolVersion === now)) {
        surfaces.push({ surface: "hook", level: "enforced", evidence: `run live against ${t.label} ${live.toolVersion ?? ""} on ${live.testedAt.slice(0, 10)}: a denied call did not run, an unreachable gate blocked, a permitted call ran`.replace("  ", " ") });
      } else if (live?.passed) {
        surfaces.push({ surface: "hook", level: "advisory", evidence: `passed live on ${t.label} ${live.toolVersion}, but this machine runs ${now}: advisory until it is run again` });
      } else if (live && !live.passed) {
        surfaces.push({ surface: "hook", level: "advisory", evidence: `the live test on ${live.testedAt.slice(0, 10)} FAILED (${live.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}): the hook is not shown to stop anything` });
      } else {
        surfaces.push({ surface: "hook", level: "advisory", evidence: contract?.passed ? "the Desk's side of the hook passed a contract test, but it has not been run live against the tool: advisory, not tested" : "declared, not tested: advisory, not tested" });
      }
    }
    if (t.gateway) {
      const door: Surface = t.gateway.door === "openai" ? "gateway_openai" : t.gateway.door === "responses" ? "gateway_responses" : "gateway_anthropic";
      const doorTest = newest(results, door, "contract", null);
      const live = newest(results, door, "live", t.tool);
      if (live?.passed) surfaces.push({ surface: door, level: "enforced", evidence: `${t.label} was run through the ${t.gateway.door} door on ${live.testedAt.slice(0, 10)} and a refused call did not reach the model` });
      else if (doorTest?.passed) surfaces.push({ surface: door, level: "advisory", evidence: `the ${t.gateway.door} door refuses over-cap calls (tested ${doorTest.testedAt.slice(0, 10)}), but ${t.label} has not been run through it: advisory, not tested` });
      else surfaces.push({ surface: door, level: "advisory", evidence: `declared, not tested: advisory, not tested` });
    }
    if (t.mcp) surfaces.push({ surface: "mcp", level: "advisory", evidence: "the agent calls authorize itself and may ignore the answer: advisory by nature" });
    const best: Level = surfaces.some((s) => s.level === "enforced") ? "enforced" : surfaces.length > 0 ? "advisory" : "notify_only";
    const enforcedVia = surfaces.find((s) => s.level === "enforced");
    const how = enforcedVia ? (enforcedVia.surface === "hook" ? t.hook?.how : t.gateway?.how) : undefined;
    const reason =
      best === "enforced"
        ? `enforced: ${how ?? ""}. ${enforcedVia?.evidence ?? ""}.`
        : best === "advisory"
          ? `advisory: ${surfaces.map((s) => s.evidence).join("; ")}${t.limit ? `. ${t.limit.charAt(0).toUpperCase()}${t.limit.slice(1)}` : ""}.`
          : `notify only: ${t.limit ?? "this tool exposes no pre-call hook the Desk can use"}. Caps on it produce notices and month-end findings only.`;
    return { tool: t.tool, label: t.label, level: best, reason, surfaces };
  });
}

export const LEVEL_WORDS: Record<Level, string> = { enforced: "enforced", advisory: "advisory", notify_only: "notify only" };

/** The ladder in words, one block per tool. */
export function renderLadder(rows: readonly ToolRow[]): string {
  const out: string[] = ["Enforcement surfaces: what the Desk can actually stop, and on what evidence."];
  for (const r of rows) out.push(`${r.label.padEnd(20)} ${LEVEL_WORDS[r.level].padEnd(12)} ${r.reason}`);
  out.push("", '"Enforced" needs a recorded test: run desk enforcement test (add --live to run the real tool). An untested surface is advisory, and a tool that changed version since its test is advisory again.');
  return out.join("\n");
}
