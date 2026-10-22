import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Read a .env file into the environment. Values in the file win over variables already set in the shell:
 * a stale key left in the user's profile once made every live call fail with 403 while the project's own
 * key was fine. Returns the names it set, never the values.
 */
export function loadDotenv(path = ".env", env: Record<string, string | undefined> = process.env): string[] {
  if (!existsSync(path)) return [];
  const parsed = parseEnv(readFileSync(path, "utf8"));
  const names: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    env[name] = value;
    names.push(name);
  }
  return names;
}
