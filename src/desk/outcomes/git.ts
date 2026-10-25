import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

export interface GitCommit {
  sha: string;
  authoredAt: string;
  authorEmail: string;
  /** True when a Co-Authored-By trailer names an agent vendor. Anyone can write a trailer, so it is only a signal. */
  agentTrailer: boolean;
  /** Paths changed, relative to the repository root with forward slashes. */
  files: string[];
  /** Reachable from the default branch. */
  merged: boolean;
  /** Named by a later "This reverts commit <sha>" message. */
  reverted: boolean;
  /** When the earliest such revert commit was made, ISO; null when the commit was not reverted. */
  revertedAt?: string | null;
}

export interface RepoScan {
  root: string;
  defaultRef: string;
  commits: GitCommit[];
}

const AGENT_TRAILER = /anthropic\.com|claude|codex|openai\.com|cursoragent|copilot/i;

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function findRepoRoot(path: string): string | null {
  try {
    return resolve(git(path, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return null;
  }
}

function defaultRef(root: string): string {
  const candidates = ["refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master", "refs/heads/trunk"];
  for (const ref of candidates) {
    try {
      git(root, ["rev-parse", "--verify", "--quiet", ref]);
      return ref === "refs/remotes/origin/HEAD" ? git(root, ["symbolic-ref", "--quiet", ref]).trim() : ref;
    } catch {
      /* try the next one */
    }
  }
  return "HEAD";
}

/**
 * Read commits (all branches) since a date from a local repository. Only metadata is read: sha,
 * author time and email, trailers and changed paths. Commit messages are scanned for revert markers
 * and discarded. A repository with no commits yields an empty scan.
 */
export function scanRepo(root: string, sinceIso?: string): RepoScan {
  const ref = defaultRef(root);
  let log = "";
  try {
    log = git(root, ["log", "--all", ...(sinceIso ? [`--since=${sinceIso}`] : []), "--name-only", "--format=%x1e%H%x1f%aI%x1f%ae%x1f%(trailers:key=Co-Authored-By,valueonly,separator=%x1d)"]);
  } catch {
    return { root, defaultRef: ref, commits: [] };
  }
  let mergedSet = new Set<string>();
  try {
    mergedSet = new Set(git(root, ["rev-list", ref]).split("\n").filter(Boolean));
  } catch {
    /* no default branch yet */
  }
  const revertedAt = new Map<string, string>();
  try {
    const messages = git(root, ["log", "--all", "--grep=This reverts commit", "--format=%aI%x1f%B%x1e"]);
    for (const block of messages.split("")) {
      const [when = "", ...body] = block.replace(/^\s+/, "").split("");
      for (const m of body.join("").matchAll(/This reverts commit ([0-9a-f]{40})/g)) {
        const sha = m[1] as string;
        const earlier = revertedAt.get(sha);
        if (when !== "" && (earlier === undefined || when < earlier)) revertedAt.set(sha, when);
        else if (when === "" && earlier === undefined) revertedAt.set(sha, "");
      }
    }
  } catch {
    /* none */
  }
  const commits: GitCommit[] = [];
  for (const block of log.split("\u001e")) {
    if (!block.trim()) continue;
    const [header = "", ...rest] = block.split("\n");
    const [sha = "", authoredAt = "", authorEmail = "", trailers = ""] = header.split("\u001f");
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    commits.push({
      sha,
      authoredAt,
      authorEmail,
      agentTrailer: trailers.split("\u001d").some((t) => AGENT_TRAILER.test(t)),
      files: rest.map((l) => l.trim()).filter(Boolean),
      merged: mergedSet.has(sha),
      reverted: revertedAt.has(sha),
      revertedAt: revertedAt.get(sha) || null,
    });
  }
  return { root, defaultRef: ref, commits };
}

/** Make an absolute edited path relative to a repository root, or null if it is outside it. */
export function relativeTo(root: string, absolute: string): string | null {
  const rel = relative(root, resolve(absolute));
  if (rel === "" || rel.startsWith("..") || resolve(rel) === rel) return null;
  return rel.split(sep).join("/");
}

/** The commits on `head` that are not on `base`, oldest first, merge commits left out: the commits of a change. */
export function commitsInRange(root: string, base: string, head: string): string[] {
  try {
    const out = git(root, ["rev-list", "--reverse", "--no-merges", `${base}..${head}`]).trim();
    return out === "" ? [] : out.split("\n");
  } catch (error) {
    throw new Error(`cannot list the commits in ${base}..${head}: ${(error as Error).message.split("\n")[0]}`);
  }
}

/** The branch the repository's other branches are measured against, as a ref a person can read (origin's head, else main, master or trunk). */
export function baseRef(root: string): string {
  return defaultRef(root);
}
