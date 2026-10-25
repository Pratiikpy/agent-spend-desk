import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { taskType } from "../estimate/estimate.ts";

/**
 * The kind of work a folder is being used for, from the branch it is on: `feat/login` is `feat`, `main` is `branch`, a detached HEAD is `session`. It is what the Desk's tasks are
 * typed by, so that a rule on `task_type` and earned autonomy mean the same thing in the gate as they do in the ledger. A folder that is not in a repository is `code`, which is what
 * a request without a branch has always been.
 *
 * It reads `.git/HEAD` (or the file a worktree's `.git` points to) and nothing else: no process is started, because this runs on the path of every tool call.
 */
const cache = new Map<string, { at: number; value: string }>();
const TTL_MS = 5_000;

function headOf(dir: string): string | null {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return null;
  try {
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
      if (m === null) return null;
      gitDir = isAbsolute(m[1] as string) ? (m[1] as string).trim() : resolve(dir, (m[1] as string).trim());
    }
    return readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
}

export function branchOf(cwd: string): string | null | undefined {
  let dir = resolve(cwd);
  for (let i = 0; i < 12; i += 1) {
    const head = headOf(dir);
    if (head !== null) {
      const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      return m === null ? null : (m[1] as string);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** `code` outside a repository, `session` on a detached HEAD, otherwise the branch's type. */
export function branchTaskType(cwd: string | null, now: () => number = Date.now): string {
  if (cwd === null || cwd === "") return "code";
  const hit = cache.get(cwd);
  const t = now();
  if (hit !== undefined && t - hit.at < TTL_MS) return hit.value;
  const branch = branchOf(cwd);
  const value = branch === undefined ? "code" : branch === null ? "session" : taskType("branch", branch).replace(/[^a-z0-9_-]/g, "-").slice(0, 40) || "branch";
  cache.set(cwd, { at: t, value });
  if (cache.size > 500) cache.clear();
  return value;
}
