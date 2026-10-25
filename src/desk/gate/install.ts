import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CONFIG_FILES, hasHook, hookCommand, withHook, type HookTool } from "./tools.ts";

/**
 * Put the Desk's hook into a tool's own config, or say whether it is there (DF-056). The config is read, the hook is added beside whatever else it holds, and the file is written
 * back only if the person asked for it. The first time a file is changed a copy of it is kept beside it. A config that is not JSON is left alone and said so, because writing over
 * it would lose what it holds. Putting a hook in place does not make the tool enforced: that needs `desk enforcement test` to pass, and the ladder says so.
 */
export interface InstallOptions {
  tool: HookTool;
  scope: "user" | "project";
  home: string;
  cwd: string;
  /** The config file to use instead of the tool's usual one. */
  config?: string;
  hookMain: string;
  /** Write the file. Without it nothing on disk changes. */
  write: boolean;
}

export interface InstallResult {
  file: string;
  state: "absent" | "present" | "unreadable";
  wrote: boolean;
  backup: string | null;
  command: string;
  message: string;
}

export function installHook(o: InstallOptions): InstallResult {
  const target = CONFIG_FILES[o.tool];
  const file = resolve(o.config ?? (o.scope === "user" ? join(o.home, target.user) : join(o.cwd, target.project)));
  const command = hookCommand(o.tool, resolve(o.hookMain).replaceAll("\\", "/"));
  let existing: unknown = {};
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return { file, state: "unreadable", wrote: false, backup: null, command, message: `${file} is not JSON, so it was left as it is. Fix or move it, then run this again.` };
    }
  }
  const present = hasHook(o.tool, existing);
  if (!o.write) {
    return { file, state: present ? "present" : "absent", wrote: false, backup: null, command, message: present ? `The hook is in ${file}.` : `The hook is not in ${file}. --install adds it.` };
  }
  const next = withHook(o.tool, existing, command);
  mkdirSync(dirname(file), { recursive: true });
  let backup: string | null = null;
  if (existsSync(file)) {
    backup = `${file}.desk-backup`;
    if (!existsSync(backup)) copyFileSync(file, backup);
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { file, state: "present", wrote: true, backup, command, message: `${present ? "Refreshed" : "Added"} the hook in ${file}${backup ? ` (the file as it was is kept as ${backup})` : ""}. It is not enforced until \`desk enforcement test\` passes.` };
}
