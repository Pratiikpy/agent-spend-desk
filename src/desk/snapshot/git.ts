import { spawnSync } from "node:child_process";

/** Run git in a repository and return what it wrote. A failure throws with git's own message; nothing here changes a working tree or the real index unless the arguments say so. */
export class GitError extends Error {
  constructor(message: string, readonly code: number | null, readonly args: readonly string[]) {
    super(message);
  }
}

export interface GitOptions {
  cwd: string;
  env?: Record<string, string>;
  input?: string | Buffer;
  /** Largest output kept, in bytes. */
  maxBuffer?: number;
  timeoutMs?: number;
}

/** The environment a snapshot's git runs under: no pager, no prompt, no user hooks or filters that could alter what is written, and the language fixed so a message can be read. */
function baseEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C", ...extra };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) if (!(extra && k in extra)) delete env[k];
  return env;
}

export function gitBuffer(args: readonly string[], o: GitOptions): Buffer {
  const r = spawnSync("git", ["-c", "core.quotepath=off", "-c", "core.fsmonitor=false", ...args], {
    cwd: o.cwd,
    env: baseEnv(o.env),
    input: o.input,
    maxBuffer: o.maxBuffer ?? 256 * 1024 * 1024,
    timeout: o.timeoutMs ?? 120_000,
    windowsHide: true,
  });
  if (r.error) throw new GitError(`git could not be run: ${r.error.message}`, null, args);
  if (r.status !== 0) throw new GitError(`git ${args.slice(0, 3).join(" ")} failed: ${(r.stderr?.toString("utf8") || "").trim().split("\n")[0] ?? ""}`, r.status, args);
  return r.stdout as Buffer;
}

export function git(args: readonly string[], o: GitOptions): string {
  return gitBuffer(args, o).toString("utf8");
}
