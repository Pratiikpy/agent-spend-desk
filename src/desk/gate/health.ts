import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { declaredFetch, destination } from "../security/net.ts";
import { CONFIG_FILES, HOOK_TOOLS, hasHook, type HookTool } from "./tools.ts";

/**
 * Is enforcement down? Two facts decide it: whether a Claude Code settings file on this machine installs the Desk's PreToolUse hook (so tool calls wait for the
 * gate), and whether the gate answers on its health route within 250 ms. A hook that is installed while the gate is not answering blocks every tool call, by
 * design (the hook fails closed), so the person must be told at once, and told how to open the gate. With no hook installed nothing is blocked, and nothing is said.
 */
export interface GateHealth {
  hookInstalled: boolean;
  /** The settings file that installs the hook, or null. */
  hookIn: string | null;
  url: string;
  reachable: boolean;
  /** How long the probe took, when it got an answer. */
  ms: number | null;
}

export function hookInstalledIn(home: string, cwd: string): string | null {
  // Claude Code's settings first (including the local file), then the other tools' own configs, user and project.
  const candidates: { file: string; tool: HookTool }[] = [
    { file: join(home, ".claude", "settings.json"), tool: "claude-code" },
    { file: join(cwd, ".claude", "settings.json"), tool: "claude-code" },
    { file: join(cwd, ".claude", "settings.local.json"), tool: "claude-code" },
    ...HOOK_TOOLS.filter((t) => t !== "claude-code").flatMap((t) => [
      { file: join(home, CONFIG_FILES[t].user), tool: t },
      { file: join(cwd, CONFIG_FILES[t].project), tool: t },
    ]),
  ];
  for (const { file, tool } of candidates) {
    if (!existsSync(file)) continue;
    try {
      if (hasHook(tool, JSON.parse(readFileSync(file, "utf8")))) return file;
    } catch {
      /* a settings file that is not JSON installs nothing we can read */
    }
  }
  return null;
}

export async function gateHealth(o: { env: Record<string, string | undefined>; home?: string; cwd?: string; timeoutMs?: number; base?: typeof fetch }): Promise<GateHealth> {
  const url = (o.env["DESK_GATE_URL"] ?? "http://127.0.0.1:8765").replace(/\/+$/, "");
  const hookIn = hookInstalledIn(o.home ?? homedir(), o.cwd ?? process.cwd());
  const declared = destination("gate", url, "the local spend gate's health route", "DESK_GATE_URL");
  let reachable = false;
  let ms: number | null = null;
  if (declared !== null && declared.loopback) {
    const started = Date.now();
    try {
      const f = declaredFetch([declared], o.base ? { base: o.base } : {});
      const res = await f(`${url}/healthz`, { signal: AbortSignal.timeout(o.timeoutMs ?? 250) });
      reachable = res.ok;
      ms = Date.now() - started;
    } catch {
      reachable = false;
    }
  }
  return { hookInstalled: hookIn !== null, hookIn, url, reachable, ms };
}
