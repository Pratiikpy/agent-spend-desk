import { spawnSync } from "node:child_process";

let cache: { at: number; value: Record<string, string | null> } | null = null;

/** The version a tool prints, or null when it is not installed. */
export function installedVersion(command: string): string | null {
  const [bin, ...args] = command.split(" ");
  const r = spawnSync(bin as string, args, { shell: true, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) return null;
  const m = /(\d+\.\d+\.\d+)/.exec(r.stdout);
  return m ? (m[1] as string) : null;
}

/** The versions of the tools that have one, looked up at most once in ten minutes: asking a tool for its version is slow, and a screen asks often. */
export function installedVersions(commands: Readonly<Record<string, string>>, now: number = Date.now()): Record<string, string | null> {
  if (cache !== null && now - cache.at < 600_000) return cache.value;
  const value: Record<string, string | null> = {};
  for (const [tool, cmd] of Object.entries(commands)) value[tool] = installedVersion(cmd);
  cache = { at: now, value };
  return value;
}
