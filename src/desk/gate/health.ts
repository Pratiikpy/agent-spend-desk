import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { declaredFetch, destination } from "../security/net.ts";

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

const HOOK_COMMAND = /hook-main(\.ts)?|desk[^"]*gate[^"]*hook/i;

export function hookInstalledIn(home: string, cwd: string): string | null {
  const candidates = [join(home, ".claude", "settings.json"), join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as { hooks?: { PreToolUse?: { hooks?: { command?: string }[] }[] } };
      for (const entry of j.hooks?.PreToolUse ?? []) for (const h of entry.hooks ?? []) if (typeof h.command === "string" && HOOK_COMMAND.test(h.command)) return file;
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
