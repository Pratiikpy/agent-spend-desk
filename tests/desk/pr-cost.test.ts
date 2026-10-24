import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { commitsInRange } from "../../src/desk/outcomes/git.ts";
import { prCost, renderPr } from "../../src/desk/pr/cost.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const SHA = (n: number): string => String(n).repeat(40).slice(0, 40);

let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
  db.prepare("INSERT INTO repo (repo_id, root, default_ref, scanned_at) VALUES (1, '/work/app', 'refs/heads/main', '2026-10-24T00:00:00Z')").run();
  for (let n = 1; n <= 6; n += 1) {
    db.prepare("INSERT INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted) VALUES (1, ?, '2026-10-20T10:00:00Z', 'h:abc', 0, '[]', 0, 0)").run(SHA(n));
  }
});
afterEach(() => {
  db.close();
  dir.dispose();
});

/** A session of `calls` Opus calls, each with 1,000,000 output tokens ($25 each at the test prices). */
async function session(id: string, calls: number, project = "/work/app"): Promise<void> {
  const lines = Array.from({ length: calls }, (_, i) => assistantLine({ id: `${id}-${i}`, session: id, ts: `2026-10-20T10:${String(i).padStart(2, "0")}:00Z`, output: 1_000_000, model: "claude-opus-5" }));
  await ingestClaudeCode(db, [dir.file(`${id}.jsonl`, lines)], testSnapshot());
  db.prepare("UPDATE session SET project_path = ? WHERE session_id = ?").run(project, id);
}
const link = (sessionId: string, n: number, confidence: "high" | "medium" | "low" = "high"): void => {
  db.prepare("INSERT INTO session_commit (session_id, repo_id, sha, method, confidence) VALUES (?, 1, ?, 'explicit', ?)").run(sessionId, SHA(n), confidence);
};

describe("what an agent-written change cost", () => {
  it("counts each session in proportion to the commits of it that are in the change", async () => {
    await session("alpha", 2); // $50
    await session("beta", 1); // $25
    link("alpha", 1);
    link("alpha", 2);
    link("alpha", 3);
    link("alpha", 4); // alpha has four commits, two of them in this change
    link("beta", 2);
    const r = prCost(db, "/work/app", [SHA(1), SHA(2)]);
    expect(r.sessions.map((s) => s.sessionId).sort()).toEqual(["alpha", "beta"]);
    const a = r.sessions.find((s) => s.sessionId === "alpha")!;
    expect(a).toMatchObject({ commitsInChange: 2, commitsInAll: 4, calls: 2, fullMicros: 50_000_000, shareMicros: 25_000_000 });
    expect(r.sessions.find((s) => s.sessionId === "beta")).toMatchObject({ commitsInChange: 1, commitsInAll: 1, fullMicros: 25_000_000, shareMicros: 25_000_000 });
    expect(r.shareMicros).toBe(50_000_000);
    expect(r.fullMicros).toBe(75_000_000);
  });

  it("rates a session by its weakest link in the change, and totals the share by that rating", async () => {
    await session("alpha", 1);
    await session("beta", 1);
    link("alpha", 1, "high");
    link("alpha", 2, "low");
    link("beta", 3, "medium");
    const r = prCost(db, "/work/app", [SHA(1), SHA(2), SHA(3)]);
    expect(r.sessions.find((s) => s.sessionId === "alpha")?.weakest).toBe("low");
    expect(r.byConfidence).toEqual({ high: 0, medium: 25_000_000, low: 25_000_000 });
  });

  it("says how many of the change's commits no session is tied to, and how many the ledger has not seen", async () => {
    await session("alpha", 1);
    link("alpha", 1);
    const r = prCost(db, "/work/app", [SHA(1), SHA(2), SHA(9)]);
    expect(r).toMatchObject({ commits: 3, tiedCommits: 1, untiedCommits: 1, unseenCommits: 1 });
  });

  it("does not invent a dollar for a session on a model with no price, and says so", async () => {
    const lines = [assistantLine({ id: "u-1", session: "unp", ts: "2026-10-20T10:00:00Z", output: 1000, model: "claude-unheard-of-9" })];
    await ingestClaudeCode(db, [dir.file("unp.jsonl", lines)], testSnapshot());
    link("unp", 1);
    const r = prCost(db, "/work/app", [SHA(1)]);
    expect(r.sessions[0]).toMatchObject({ fullMicros: null, shareMicros: null, unpricedCalls: 1 });
    expect(r.shareMicros).toBe(0);
    expect(r.unpricedCalls).toBe(1);
  });

  it("returns an empty result for a change with no commits or for a repository the ledger does not know", () => {
    expect(prCost(db, "/work/app", [])).toMatchObject({ commits: 0, sessions: [], shareMicros: 0 });
    expect(prCost(db, "/elsewhere", [SHA(1)])).toMatchObject({ commits: 1, unseenCommits: 1, sessions: [] });
  });

  it("writes a description a reviewer can read, with the dollars, the evidence and what is not counted", async () => {
    await session("alpha-1234567", 2);
    link("alpha-1234567", 1, "high");
    link("alpha-1234567", 2, "high");
    const text = renderPr(prCost(db, "/work/app", [SHA(1), SHA(2), SHA(3)]));
    expect(text).toMatch(/Agent cost of this change/);
    expect(text).toMatch(/\$50\.00/);
    expect(text).toMatch(/1 session/);
    expect(text).toMatch(/alpha-12/);
    expect(text).toMatch(/2 of 3 commits/);
    expect(text).toMatch(/not an invoice/i);
    expect(text).toMatch(/left no commit/i);
    expect(renderPr(prCost(db, "/work/app", [SHA(5)]))).toMatch(/No agent session is tied to any of the 1 commit/);
  });
});

describe("the commits of a change", () => {
  const git = (root: string, args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  it("lists the commits on a branch that are not on its base, leaving out merges", () => {
    const repo = join(dir.path, "repo");
    mkdirSync(repo, { recursive: true });
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "dev@example.com"]);
    git(repo, ["config", "user.name", "Dev"]);
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "base"]);
    git(repo, ["checkout", "-q", "-b", "feature"]);
    for (const n of ["two", "three"]) {
      writeFileSync(join(repo, "a.txt"), `${n}\n`);
      git(repo, ["commit", "-q", "-am", n]);
    }
    const expected = git(repo, ["rev-list", "--reverse", "main..feature"]).split("\n");
    expect(commitsInRange(repo, "main", "feature")).toEqual(expected);
    expect(commitsInRange(repo, "main", "feature")).toHaveLength(2);
    expect(commitsInRange(repo, "feature", "feature")).toEqual([]);
    expect(() => commitsInRange(repo, "no-such-ref", "feature")).toThrow(/no-such-ref/);
  });
});
