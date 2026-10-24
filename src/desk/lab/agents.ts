import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { LabTask } from "./task.ts";

/** What an agent under test is given for one run. */
export interface AgentContext {
  task: LabTask;
  /** The repository the agent works in. It already holds the task's starting state. */
  workspace: string;
  /** A folder private to this run, for the agent's own configuration and state. */
  runDir: string;
  /** The accounting proxy's base URL for this run, ending in /v1. */
  modelUrl: string;
  model: string;
  timeoutMs: number;
}

export interface AgentResult {
  exitCode: number | null;
  timedOut: boolean;
  /** Everything the agent printed, capped. Kept in a transcript file, never in the run record. */
  output: string;
}

export interface AgentAdapter {
  name: string;
  /** The agent's own version, recorded with every run so a result is tied to the build that produced it. */
  version(): string;
  run(ctx: AgentContext): Promise<AgentResult>;
}

const OUTPUT_CAP = 512 * 1024;

/** End a process and everything it started. */
export function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

/** Run a command to completion or to its time limit, capturing what it prints. */
export function runProcess(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<AgentResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (b: Buffer): void => {
      if (output.length < OUTPUT_CAP) output += b.toString("utf8").slice(0, OUTPUT_CAP - output.length);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut: false, output: `${output}\n[spawn error: ${e.message}]` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // The agent may have left helper processes running; end whatever is still in its tree.
      if (child.pid !== undefined && !timedOut) killTree(child.pid);
      resolve({ exitCode: code, timedOut, output });
    });
  });
}

/**
 * The OpenCode executable. On Windows the npm shim is a .cmd file, and a prompt passed through cmd.exe would be
 * re-parsed (quotes, percent signs), so the real executable the shim starts is used and no shell is involved.
 */
export function resolveOpenCodeBin(explicit?: string): string {
  if (explicit) return explicit;
  if (process.platform === "win32") {
    for (const dir of (process.env["PATH"] ?? process.env["Path"] ?? "").split(";")) {
      if (dir !== "" && existsSync(join(dir, "opencode.cmd"))) {
        const exe = join(dir, "node_modules", "opencode-ai", "bin", "opencode.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return "opencode";
}

/** The commands an agent may run from its shell tool. Not a security boundary: see the threat model. */
export const BASH_ALLOW = ["node *", "npm *", "npx *", "ls *", "dir *", "cat *", "type *", "grep *", "rg *", "head *", "tail *", "wc *", "echo *", "pwd", "git status*", "git diff*", "git log*", "git show*"];

export interface OpenCodeOptions {
  /** The executable. Defaults to `opencode` on the path. */
  bin?: string;
  /** A cache folder shared by every run, so the provider package is fetched once. */
  cacheDir: string;
  /** Extra tools to switch off. */
  extraPermission?: Record<string, unknown>;
  /** Have the agent print its own debug log into the transcript, to find out why a run failed to start. */
  debug?: boolean;
}

/**
 * OpenCode (MIT) as the agent under test, in its own isolated configuration: only the lab's model provider, no global
 * settings, no plugins, no sharing, no web access, file tools confined to the workspace and a short shell allow-list.
 * Its model calls go to the accounting proxy, so the run's cost is measured by the lab and not reported by the agent.
 */
export function openCodeAgent(options: OpenCodeOptions): AgentAdapter {
  const bin = resolveOpenCodeBin(options.bin);
  return {
    name: "opencode",
    version(): string {
      const r = spawnSync(bin, ["--version"], { encoding: "utf8", windowsHide: true });
      return (r.stdout ?? "").trim() || "unknown";
    },
    async run(ctx: AgentContext): Promise<AgentResult> {
      const dir = join(ctx.runDir, "opencode");
      for (const d of ["config", "data", "state"]) mkdirSync(join(dir, d), { recursive: true });
      const cacheDir = resolve(options.cacheDir);
      mkdirSync(cacheDir, { recursive: true });
      const config = {
        $schema: "https://opencode.ai/config.json",
        model: `lab/${ctx.model}`,
        small_model: `lab/${ctx.model}`,
        autoupdate: false,
        share: "disabled",
        provider: {
          lab: {
            npm: "@ai-sdk/openai-compatible",
            name: "Lab model endpoint",
            options: { baseURL: ctx.modelUrl, apiKey: "lab-proxy" },
            models: { [ctx.model]: { name: ctx.model, limit: { context: 131072, output: 8192 } } },
          },
        },
        permission: {
          edit: "allow",
          read: "allow",
          webfetch: "deny",
          external_directory: "deny",
          bash: { "*": "deny", ...Object.fromEntries(BASH_ALLOW.map((p) => [p, "allow"])) },
          ...(options.extraPermission ?? {}),
        },
      };
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCODE_CONFIG: configPath,
        XDG_CONFIG_HOME: join(dir, "config"),
        XDG_DATA_HOME: join(dir, "data"),
        XDG_STATE_HOME: join(dir, "state"),
        XDG_CACHE_HOME: cacheDir,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
      };
      // The task's prompt is passed as one argument, never through a shell.
      return runProcess(bin, ["run", "--pure", "--auto", ...(options.debug ? ["--print-logs", "--log-level", "DEBUG"] : []), "--format", "json", "--dir", ctx.workspace, "--model", `lab/${ctx.model}`, ctx.task.prompt], { cwd: ctx.workspace, env, timeoutMs: ctx.timeoutMs });
    },
  };
}

/** An agent that is a function, for testing the harness itself. */
export function scriptedAgent(name: string, fn: (ctx: AgentContext) => void | Promise<void>, behaviour: { exitCode?: number; delayMs?: number } = {}): AgentAdapter {
  return {
    name,
    version: () => "scripted",
    async run(ctx: AgentContext): Promise<AgentResult> {
      if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));
      await fn(ctx);
      return { exitCode: behaviour.exitCode ?? 0, timedOut: false, output: `${name} finished` };
    },
  };
}
