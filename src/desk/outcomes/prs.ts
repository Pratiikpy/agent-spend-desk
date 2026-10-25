import { execFileSync } from "node:child_process";

import type { Ledger } from "../ledger/db.ts";

/**
 * Pull request facts, for the one waste class git alone cannot see: a pull request closed without being merged (C-PR, the specification's `closed_unmerged`).
 * Git has no pull requests; GitHub does. The Desk asks for them only when the owner passes `--prs` to `desk landing`, and only through the owner's own `gh`, signed in
 * as the owner, for a repository whose `origin` is on github.com. What is kept is the number, the state, when it closed, the branch and, for the pull requests that
 * can matter to the rule, the shas of their commits. Titles, bodies, author names and e-mail addresses come back in the response and are discarded before anything is written.
 *
 * Two calls, because one is too big: asking `gh pr list` for the commits of 300 pull requests exceeds GitHub's limit of 500,000 nodes (found on the first real run). The list
 * is asked for without commits, and the commits are asked for one pull request at a time, only for those that are open or were closed without a merge. A pull request closed
 * without a merge whose branch was then opened again as a later pull request that is open or merged is `superseded`: the work went on, so it is not abandoned.
 */
export type PrState = "open" | "merged" | "closed_unmerged" | "superseded";

export interface PrFact {
  number: number;
  state: PrState;
  closedAt: string | null;
  headRef: string | null;
  commits: string[];
}

export class PrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrError";
  }
}

/** `owner/repo` from a remote URL that points at github.com, or null for anything else (another host, a local path, nothing). */
export function githubSlug(remote: string | null): string | null {
  if (!remote) return null;
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The shas of the commits `gh pr view --json commits` returns for one pull request. */
export function parsePrCommits(text: string): string[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new PrError("gh did not return JSON");
  }
  const list = (v as { commits?: unknown } | null)?.commits;
  if (!Array.isArray(list)) throw new PrError("gh did not return the commits of the pull request");
  return (list as { oid?: unknown }[]).map((c) => c?.oid).filter((x): x is string => typeof x === "string" && /^[0-9a-f]{40}$/.test(x));
}

/** What `gh pr list --json ...` returns, checked field by field. A response that is not what was asked for is an error, never a table of nothing. */
export function parsePrs(text: string): PrFact[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new PrError("gh did not return JSON");
  }
  if (!Array.isArray(v)) throw new PrError("gh did not return a list of pull requests");
  return v.map((raw, i) => {
    const o = raw as Record<string, unknown>;
    const number = o["number"];
    if (typeof number !== "number" || !Number.isInteger(number) || number < 1) throw new PrError(`pull request ${i + 1} has no number`);
    const state = o["state"];
    if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") throw new PrError(`pull request #${number} has no state gh documents (${JSON.stringify(state)})`);
    const merged = typeof o["mergedAt"] === "string" && o["mergedAt"] !== "";
    // A pull request that is closed with a merge time was merged; gh also says MERGED for it. Anything CLOSED with no merge time was closed unmerged.
    const mapped: PrState = state === "OPEN" ? "open" : state === "MERGED" || merged ? "merged" : "closed_unmerged";
    const commits = Array.isArray(o["commits"]) ? (o["commits"] as { oid?: unknown }[]).map((c) => c?.oid).filter((x): x is string => typeof x === "string" && /^[0-9a-f]{40}$/.test(x)) : [];
    return {
      number,
      state: mapped,
      closedAt: typeof o["closedAt"] === "string" && o["closedAt"] !== "" ? o["closedAt"] : null,
      headRef: typeof o["headRefName"] === "string" ? o["headRefName"].slice(0, 200) : null,
      commits,
    };
  });
}

export interface PrRunners {
  /** Run `gh` with these arguments and return its standard output. Throws when it fails. */
  gh(args: readonly string[]): string;
  /** The `origin` remote of the repository at this root, or null when it has none. */
  remote(root: string): string | null;
}

export function realRunners(): PrRunners {
  return {
    gh: (args) => {
      try {
        return execFileSync("gh", [...args], { encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        // What gh said on its error stream is the reason; the message Node builds from the command line is not.
        const said = String((e as { stderr?: unknown }).stderr ?? "").split("\n").map((l) => l.trim()).find((l) => l !== "");
        throw new Error(said ?? (e instanceof Error ? e.message.split("\n")[0]! : "gh failed"));
      }
    },
    remote: (root) => {
      try {
        return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
      } catch {
        return null;
      }
    },
  };
}

export const PR_LIMIT = 500;
/** How many open or closed-unmerged pull requests, newest first, have their commits read; a repository with more says so. */
export const PR_COMMIT_LIMIT = 200;

export interface PrSyncReport {
  repos: { root: string; slug: string; pullRequests: number; closedUnmerged: number; superseded: number; commitsNotRead: number }[];
  /** Repositories with no github.com origin, and repositories where `gh` failed, each with the reason. Nothing is guessed for either. */
  skipped: { root: string; reason: string }[];
}

/** Ask for the pull requests of every scanned repository that is on github.com and keep what the waste rule needs. A failure in one repository leaves the others and the old facts of that one. */
export function syncPrs(db: Ledger, run: PrRunners, now: Date): PrSyncReport {
  const report: PrSyncReport = { repos: [], skipped: [] };
  const repos = db.prepare("SELECT repo_id, root FROM repo ORDER BY root").all() as unknown as { repo_id: number; root: string }[];
  for (const r of repos) {
    // A relative root ("." from a run inside the repository) names whatever folder the command was run from, and the same repository is usually there again by its full path.
    if (r.root === "." || r.root.startsWith("./") || r.root.startsWith(".\\")) {
      report.skipped.push({ root: r.root, reason: "its root is a relative path, which names a different folder on every run; the same repository is read by its full path when it was scanned that way" });
      continue;
    }
    const slug = githubSlug(run.remote(r.root));
    if (!slug) {
      report.skipped.push({ root: r.root, reason: "its origin is not on github.com, so there are no pull requests to ask for" });
      continue;
    }
    let prs: PrFact[];
    let commitsNotRead = 0;
    try {
      prs = parsePrs(run.gh(["pr", "list", "--repo", slug, "--state", "all", "--limit", String(PR_LIMIT), "--json", "number,state,mergedAt,closedAt,headRefName"]));
      // A closed-unmerged pull request whose branch a later open or merged pull request took up again was not abandoned.
      for (const p of prs) {
        if (p.state === "closed_unmerged" && p.headRef !== null && prs.some((q) => q.number > p.number && q.headRef === p.headRef && (q.state === "open" || q.state === "merged"))) p.state = "superseded";
      }
      const needCommits = prs.filter((p) => p.state === "open" || p.state === "closed_unmerged").sort((a, b) => b.number - a.number);
      for (const [i, p] of needCommits.entries()) {
        if (i >= PR_COMMIT_LIMIT) {
          commitsNotRead += 1;
          continue;
        }
        p.commits = parsePrCommits(run.gh(["pr", "view", String(p.number), "--repo", slug, "--json", "commits"]));
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      // The first line only: gh's error text can carry a token hint or a URL, never kept longer than a line.
      report.skipped.push({ root: r.root, reason: `gh failed: ${text.split("\n")[0]!.slice(0, 160)}` });
      continue;
    }
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM pr_fact WHERE repo_id = ?").run(r.repo_id);
      const put = db.prepare("INSERT INTO pr_fact (repo_id, number, state, closed_at, head_ref, commit_shas, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const p of prs) put.run(r.repo_id, p.number, p.state, p.closedAt, p.headRef, JSON.stringify(p.commits), now.toISOString());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    report.repos.push({ root: r.root, slug, pullRequests: prs.length, closedUnmerged: prs.filter((p) => p.state === "closed_unmerged").length, superseded: prs.filter((p) => p.state === "superseded").length, commitsNotRead });
  }
  return report;
}
