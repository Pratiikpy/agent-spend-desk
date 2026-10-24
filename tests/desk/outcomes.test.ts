import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assignCommits, outcomeOf, type SessionFacts } from "../../src/desk/outcomes/attribute.ts";
import { scanRepo, relativeTo, findRepoRoot, type GitCommit } from "../../src/desk/outcomes/git.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-30T00:00:00Z");

function commit(over: Partial<GitCommit> = {}): GitCommit {
  return { sha: "a".repeat(40), authoredAt: "2026-10-20T10:20:00Z", authorEmail: "dev@example.com", agentTrailer: false, files: ["src/a.ts"], merged: false, reverted: false, ...over };
}
const session = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  sessionId: "s1", startMs: Date.parse("2026-10-20T10:00:00Z"), endMs: Date.parse("2026-10-20T11:00:00Z"), calls: 20, editedFiles: ["src/a.ts"], ...over,
});

describe("attribution", () => {
  const one = (sess: SessionFacts, c: GitCommit) => assignCommits([sess], [c])[0];

  it("rates an agent trailer, the matching files and the window high", () => {
    expect(one(session(), commit({ agentTrailer: true }))).toMatchObject({ method: "trailer_window", confidence: "high" });
  });

  it("rates matching files inside the window medium, and files outside the window low", () => {
    expect(one(session(), commit())).toMatchObject({ method: "file_overlap", confidence: "medium" });
    expect(one(session(), commit({ authoredAt: "2026-10-25T10:00:00Z" }))).toMatchObject({ method: "file_overlap", confidence: "low" });
  });

  it("needs at least half of the commit's files to have been written by the session", () => {
    expect(one(session(), commit({ files: ["src/a.ts", "x.ts", "y.ts"] }))).toMatchObject({ confidence: "low" });
    expect(one(session(), commit({ files: ["src/a.ts", "x.ts"] }))).toMatchObject({ confidence: "medium" });
  });

  it("gives the time window alone only to a session with enough calls", () => {
    const c = commit({ files: ["other.ts"] });
    expect(assignCommits([session({ editedFiles: [], calls: 2 })], [c])).toEqual([]);
    expect(assignCommits([session({ editedFiles: [], calls: 9 })], [c])[0]).toMatchObject({ method: "time_window", confidence: "low" });
  });

  it("allows a commit up to 30 minutes after the session and not 31", () => {
    const end = Date.parse("2026-10-20T11:00:00Z");
    const near = commit({ files: ["x"], authoredAt: new Date(end + 30 * 60_000).toISOString() });
    const far = commit({ files: ["x"], authoredAt: new Date(end + 31 * 60_000).toISOString() });
    expect(assignCommits([session({ editedFiles: [] })], [near])).toHaveLength(1);
    expect(assignCommits([session({ editedFiles: [] })], [far])).toHaveLength(0);
  });

  it("ignores a commit with a bad date instead of crashing", () => {
    expect(assignCommits([session()], [commit({ authoredAt: "not a date" })])).toEqual([]);
  });

  it("gives one commit to the one session that wrote its files, not to every session in the window", () => {
    const author = session({ sessionId: "author", editedFiles: ["src/a.ts"], lastEditMs: Date.parse("2026-10-20T10:15:00Z") });
    const bystander = session({ sessionId: "other", editedFiles: ["src/zzz.ts"], calls: 30 });
    const links = assignCommits([bystander, author], [commit()]);
    expect(links).toEqual([expect.objectContaining({ sessionId: "author", confidence: "medium" })]);
  });

  it("prefers the session that finished its edit just before the commit over one still running", () => {
    const author = session({ sessionId: "author", endMs: Date.parse("2026-10-20T10:12:00Z"), lastEditMs: Date.parse("2026-10-20T10:12:00Z") });
    const running = session({ sessionId: "running", endMs: Date.parse("2026-10-20T11:30:00Z"), lastEditMs: Date.parse("2026-10-20T10:55:00Z") });
    expect(assignCommits([running, author], [commit()])).toEqual([expect.objectContaining({ sessionId: "author" })]);
  });

  it("links two equally good sessions at low confidence, because the data cannot tell them apart", () => {
    const links = assignCommits([session({ sessionId: "a" }), session({ sessionId: "b" })], [commit()]);
    expect(links.map((l) => [l.sessionId, l.confidence])).toEqual([["a", "low"], ["b", "low"]]);
  });
});

describe("landing state", () => {
  const link = (sha: string) => ({ sessionId: "s1", sha, method: "trailer_window" as const, confidence: "high" as const });

  it("is unlinked with no links, committed for an unmerged commit, merged then kept with age", () => {
    expect(outcomeOf([], new Map(), NOW).state).toBe("unlinked");
    const c = commit({ sha: "b".repeat(40) });
    expect(outcomeOf([link(c.sha)], new Map([[c.sha, c]]), NOW).state).toBe("committed");
    const m = commit({ sha: "c".repeat(40), merged: true, authoredAt: "2026-10-29T00:00:00Z" });
    expect(outcomeOf([link(m.sha)], new Map([[m.sha, m]]), NOW).state).toBe("merged");
    const k = commit({ sha: "d".repeat(40), merged: true, authoredAt: "2026-10-01T00:00:00Z" });
    expect(outcomeOf([link(k.sha)], new Map([[k.sha, k]]), NOW).state).toBe("kept");
  });

  it("lets a low-confidence link count but not move the state", () => {
    const m = commit({ sha: "f".repeat(40), merged: true, reverted: true, authoredAt: "2026-10-01T00:00:00Z" });
    const weak = { sessionId: "s1", sha: m.sha, method: "time_window" as const, confidence: "low" as const };
    expect(outcomeOf([weak], new Map([[m.sha, m]]), NOW)).toEqual({ state: "unlinked", bestConfidence: "low", commits: 1 });
  });

  it("lets a revert win over a merge, because undone work did not land", () => {
    const r = commit({ sha: "e".repeat(40), merged: true, reverted: true, authoredAt: "2026-10-01T00:00:00Z" });
    expect(outcomeOf([link(r.sha)], new Map([[r.sha, r]]), NOW).state).toBe("reverted");
  });
});

// Real git repositories: the reader is only trusted if it agrees with git itself.
function git(root: string, args: string[], date?: string): string {
  return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim();
}

describe("git reader and the full pipeline", () => {
  let dir: TempDir;
  let db: Ledger;
  let repo: string;
  beforeEach(() => {
    dir = new TempDir();
    db = openLedger(":memory:");
    repo = join(dir.path, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
  });
  afterEach(() => {
    db.close();
    dir.dispose();
  });

  function write(file: string, text: string): void {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), text);
  }

  it("reads commits, trailers, files, merged and reverted flags the way git reports them", () => {
    write("a.txt", "1");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "first", "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"], "2026-10-20T10:20:00Z");
    git(repo, ["checkout", "-q", "-b", "feature"]);
    write("src/b.txt", "2");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "feature work"], "2026-10-21T10:00:00Z");
    git(repo, ["checkout", "-q", "main"]);
    write("c.txt", "3");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "to be reverted"], "2026-10-22T10:00:00Z");
    const revertedSha = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["revert", "--no-edit", "HEAD"], "2026-10-23T10:00:00Z");

    const scan = scanRepo(repo);
    expect(scan.defaultRef).toBe("refs/heads/main");
    const bySubject = new Map(scan.commits.map((c) => [c.sha, c]));
    expect(scan.commits).toHaveLength(4);
    const first = scan.commits.find((c) => c.files.includes("a.txt"));
    expect(first).toMatchObject({ agentTrailer: true, merged: true, reverted: false });
    const feature = scan.commits.find((c) => c.files.includes("src/b.txt"));
    expect(feature).toMatchObject({ merged: false, agentTrailer: false });
    expect(bySubject.get(revertedSha)).toMatchObject({ reverted: true, merged: true });
  });

  it("returns an empty scan for a repository with no commits, and null for a folder that is not a repo", () => {
    expect(scanRepo(repo).commits).toEqual([]);
    expect(findRepoRoot(dir.path)).toBeNull();
    expect(findRepoRoot(repo)).not.toBeNull();
  });

  it("makes edited paths relative and refuses paths outside the repository", () => {
    expect(relativeTo(repo, join(repo, "src", "a.ts"))).toBe("src/a.ts");
    expect(relativeTo(repo, join(dir.path, "elsewhere", "x.ts"))).toBeNull();
  });

  it("links a session to its commits and computes the landing state end to end", async () => {
    write("src/app.ts", "x");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "app"], "2026-10-20T10:20:00Z");
    const log = dir.file("a.jsonl", [
      assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 10, tools: ["Edit"], toolInputs: [{ file_path: join(repo, "src", "app.ts") }] }),
      ...Array.from({ length: 6 }, (_, i) => assistantLine({ id: `m${i + 2}`, ts: `2026-10-20T10:${String(5 + i * 5).padStart(2, "0")}:00Z`, output: 10 })),
      assistantLine({ id: "other", session: "s2", ts: "2026-10-20T10:01:00Z", output: 10 }),
    ]);
    await ingestClaudeCode(db, [log], testSnapshot());
    const r = linkOutcomes(db, [repo], NOW);
    expect(r.repos).toBe(1);
    expect(r.byState.kept).toBe(1);
    expect(r.byState.unlinked).toBe(1);
    const o = db.prepare("SELECT state, best_confidence FROM session_outcome WHERE session_id = 'sess-1'").get() as { state: string; best_confidence: string };
    expect(o).toEqual({ state: "kept", best_confidence: "medium" });
    const again = linkOutcomes(db, [repo], NOW);
    expect(again.byState).toEqual(r.byState); // recomputing changes nothing
    expect((db.prepare("SELECT COUNT(*) n FROM session_commit").get() as { n: number }).n).toBe(1);
  });

  it("stores a commit's author as a pseudonym and never as an e-mail address", async () => {
    write("src/app.ts", "x");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "app"], "2026-10-20T10:20:00Z");
    const log = dir.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 10, tools: ["Edit"], toolInputs: [{ file_path: join(repo, "src", "app.ts") }] })]);
    await ingestClaudeCode(db, [log], testSnapshot());
    linkOutcomes(db, [repo], NOW);
    const authors = (db.prepare("SELECT author_email FROM git_commit").all() as { author_email: string }[]).map((r) => r.author_email);
    expect(authors.length).toBeGreaterThan(0);
    for (const a of authors) {
      expect(a).toMatch(/^h:[0-9a-f]{12}$/);
      expect(a).not.toContain("test@example.com");
    }
  });

  it("marks a session whose commit was later reverted as reverted", async () => {
    write("src/app.ts", "x");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "app"], "2026-10-20T10:20:00Z");
    git(repo, ["revert", "--no-edit", "HEAD"], "2026-10-21T10:00:00Z");
    const log = dir.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 10, tools: ["Write"], toolInputs: [{ file_path: join(repo, "src", "app.ts") }] })]);
    await ingestClaudeCode(db, [log], testSnapshot());
    linkOutcomes(db, [repo], NOW);
    expect((db.prepare("SELECT state FROM session_outcome WHERE session_id = 'sess-1'").get() as { state: string }).state).toBe("reverted");
  });

  it("treats a session with no repository at all as unlinked, not as waste", async () => {
    const log = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 10 })]);
    await ingestClaudeCode(db, [log], testSnapshot());
    const r = linkOutcomes(db, [], NOW);
    expect(r.byState.unlinked).toBe(1);
    expect(HOUR).toBeGreaterThan(0);
  });
});
