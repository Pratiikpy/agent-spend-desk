import { describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { githubSlug, parsePrCommits, parsePrs, PR_COMMIT_LIMIT, PR_LIMIT, PrError, syncPrs, type PrRunners } from "../../src/desk/outcomes/prs.ts";
import { describeManifest } from "../../src/desk/security/net.ts";
import { loadOutcomeFacts } from "../../src/desk/waste/load.ts";

const sha = (n: number): string => n.toString(16).padStart(40, "0");

describe("the github.com repository behind an origin", () => {
  it("reads owner and repository from every way GitHub writes an address, with or without .git or a trailing slash", () => {
    for (const url of ["https://github.com/acme/shop", "https://github.com/acme/shop.git", "https://github.com/acme/shop/", "https://user:token@github.com/acme/shop.git", "http://github.com/acme/shop", "git@github.com:acme/shop.git", "git@github.com:acme/shop", "ssh://git@github.com/acme/shop.git"]) {
      expect(githubSlug(url), url).toBe("acme/shop");
    }
    expect(githubSlug("https://github.com/a-b_c.d/x.y-z")).toBe("a-b_c.d/x.y-z");
  });

  it("says nothing for another host, a host that only looks like GitHub, a path, a half address, or no remote", () => {
    for (const url of ["https://gitlab.com/acme/shop", "git@bitbucket.org:acme/shop.git", "https://github.com.evil.example/acme/shop", "https://evilgithub.com/acme/shop", "https://github.example.com/acme/shop", "/srv/git/shop.git", "D:/work/shop", "https://github.com/acme", "https://github.com/acme/shop/issues", "", "   "]) {
      expect(githubSlug(url), url).toBeNull();
    }
    expect(githubSlug(null)).toBeNull();
  });
});

describe("what gh returns", () => {
  // The shape `gh pr list --json number,state,mergedAt,closedAt,headRefName` returns, as read from a real repository.
  const real = JSON.stringify([
    { closedAt: "2026-10-23T20:08:02Z", headRefName: "feature/attach", mergedAt: "2026-10-23T20:08:02Z", number: 14805, state: "MERGED" },
    { closedAt: "2026-10-22T09:00:00Z", headRefName: "spike", mergedAt: null, number: 14790, state: "CLOSED" },
    { closedAt: null, headRefName: "wip", mergedAt: null, number: 14801, state: "OPEN" },
  ]);

  it("maps a merged, a closed-without-merge and an open pull request, keeping only numbers, states, dates and branches", () => {
    const prs = parsePrs(real);
    expect(prs.map((p) => [p.number, p.state])).toEqual([[14805, "merged"], [14790, "closed_unmerged"], [14801, "open"]]);
    expect(prs[1]).toEqual({ number: 14790, state: "closed_unmerged", closedAt: "2026-10-22T09:00:00Z", headRef: "spike", commits: [] });
  });

  it("calls a pull request with a merge time merged even if gh says CLOSED", () => {
    const [p] = parsePrs(JSON.stringify([{ number: 1, state: "CLOSED", mergedAt: "2026-10-01T00:00:00Z", closedAt: "2026-10-01T00:00:00Z", headRefName: "x" }]));
    expect(p).toMatchObject({ state: "merged" });
  });

  it("reads the shas of one pull request's commits and discards names, e-mail addresses and messages", () => {
    const text = JSON.stringify({ commits: [{ authoredDate: "2026-10-23T19:50:28Z", authors: [{ email: "someone@users.noreply.github.com", login: "someone", name: "Someone" }], messageBody: "Co-authored-by: A <a@b.c>", messageHeadline: "Defer the check", oid: sha(1) }, { oid: sha(2) }, { oid: "short" }, { oid: 7 }, {}] });
    const shas = parsePrCommits(text);
    expect(shas).toEqual([sha(1), sha(2)]);
    expect(JSON.stringify(shas)).not.toMatch(/@|someone|Defer/);
  });

  it("refuses a response that is not what was asked for, instead of reading it as no pull requests", () => {
    expect(() => parsePrs("not json")).toThrowError(PrError);
    expect(() => parsePrs('{"message":"Bad credentials"}')).toThrowError(/list of pull requests/);
    expect(() => parsePrs('[{"state":"OPEN"}]')).toThrowError(/no number/);
    expect(() => parsePrs('[{"number":1.5,"state":"OPEN"}]')).toThrowError(/no number/);
    expect(() => parsePrs('[{"number":3,"state":"DRAFT"}]')).toThrowError(/no state gh documents/);
    expect(parsePrs("[]")).toEqual([]);
    expect(() => parsePrCommits("not json")).toThrowError(PrError);
    expect(() => parsePrCommits('{"message":"Not Found"}')).toThrowError(/commits of the pull request/);
  });
});

describe("asking GitHub for the pull requests of the scanned repositories", () => {
  const ledgerWith = (...roots: string[]): Ledger => {
    const db = openLedger(":memory:");
    roots.forEach((root, i) => db.prepare("INSERT INTO repo (repo_id, root, default_ref, scanned_at) VALUES (?, ?, 'main', '2026-10-20T00:00:00Z')").run(i + 1, root));
    return db;
  };
  const NOW = new Date("2026-10-25T12:00:00Z");
  const item = (number: number, state: string, head: string, mergedAt: string | null = null) => ({ number, state, mergedAt, closedAt: state === "OPEN" ? null : "2026-10-20T00:00:00Z", headRefName: head });
  /** A fake gh: the list for a repository, and the commits of a pull request by number. */
  const runners = (remotes: Record<string, string | null>, lists: Record<string, unknown[]>, commits: Record<number, string[]> = {}, fail: (args: readonly string[]) => void = () => {}): PrRunners & { calls: string[][] } => {
    const calls: string[][] = [];
    return {
      calls,
      remote: (root) => remotes[root] ?? null,
      gh: (args) => {
        calls.push([...args]);
        fail(args);
        const repo = args[args.indexOf("--repo") + 1] as string;
        if (args[1] === "list") return JSON.stringify(lists[repo] ?? []);
        const n = Number(args[2]);
        return JSON.stringify({ commits: (commits[n] ?? []).map((oid) => ({ oid, authors: [{ email: "x@y.z" }] })) });
      },
    };
  };

  it("stores the pull requests of a github.com repository with the commits of the open and unmerged ones only, and leaves alone a repository that is not on github.com", () => {
    const db = ledgerWith("/work/shop", "/work/lab");
    const run = runners({ "/work/shop": "git@github.com:acme/shop.git", "/work/lab": "https://gitlab.com/acme/lab" }, { "acme/shop": [item(1, "MERGED", "a", "2026-10-02T00:00:00Z"), item(2, "CLOSED", "b"), item(3, "OPEN", "c")] }, { 2: [sha(2), sha(3)], 3: [sha(4)] });
    const report = syncPrs(db, run, NOW);
    expect(report.repos).toEqual([{ root: "/work/shop", slug: "acme/shop", pullRequests: 3, closedUnmerged: 1, superseded: 0, commitsNotRead: 0 }]);
    expect(report.skipped).toEqual([{ root: "/work/lab", reason: "its origin is not on github.com, so there are no pull requests to ask for" }]);
    expect(run.calls.map((c) => c.slice(0, 3).join(" "))).toEqual(["pr list --repo", "pr view 3", "pr view 2"]);
    expect(run.calls[0]).toEqual(["pr", "list", "--repo", "acme/shop", "--state", "all", "--limit", String(PR_LIMIT), "--json", "number,state,mergedAt,closedAt,headRefName"]);
    expect(run.calls[1]).toEqual(["pr", "view", "3", "--repo", "acme/shop", "--json", "commits"]);
    const rows = db.prepare("SELECT repo_id, number, state, closed_at, head_ref, commit_shas, fetched_at FROM pr_fact ORDER BY number").all() as { repo_id: number; number: number; state: string; commit_shas: string; fetched_at: string }[];
    expect(rows.map((r) => [r.number, r.state, JSON.parse(r.commit_shas)])).toEqual([[1, "merged", []], [2, "closed_unmerged", [sha(2), sha(3)]], [3, "open", [sha(4)]]]);
    expect(rows[0]!.fetched_at).toBe(NOW.toISOString());
    expect(JSON.stringify(rows)).not.toContain("x@y.z");
  });

  it("calls a pull request superseded when its branch was taken up again by a later one that is open or merged, and an unmerged one with no such successor abandoned", () => {
    const db = ledgerWith("/work/shop");
    const run = runners({ "/work/shop": "https://github.com/acme/shop" }, { "acme/shop": [item(5, "CLOSED", "feature"), item(6, "MERGED", "feature", "2026-10-09T00:00:00Z"), item(7, "CLOSED", "dead-end"), item(8, "CLOSED", "retry"), item(9, "CLOSED", "retry")] }, { 5: [sha(5)], 7: [sha(7)], 8: [sha(8)], 9: [sha(9)] });
    const report = syncPrs(db, run, NOW);
    expect(report.repos[0]).toMatchObject({ closedUnmerged: 3, superseded: 1 });
    const states = Object.fromEntries((db.prepare("SELECT number, state FROM pr_fact").all() as { number: number; state: string }[]).map((r) => [r.number, r.state]));
    // 5 was followed by a merged pull request from the same branch. 8 was followed by 9, which was also closed, so neither was taken up.
    expect(states).toEqual({ 5: "superseded", 6: "merged", 7: "closed_unmerged", 8: "closed_unmerged", 9: "closed_unmerged" });
    // A superseded pull request's commits are not read: they cannot make a session abandoned.
    expect(run.calls.some((c) => c[1] === "view" && c[2] === "5")).toBe(false);
  });

  it("reads the commits of the newest pull requests only, up to a limit, and says how many it left", () => {
    const db = ledgerWith("/work/shop");
    const many = Array.from({ length: PR_COMMIT_LIMIT + 3 }, (_, i) => item(i + 1, "CLOSED", `b${i + 1}`));
    const run = runners({ "/work/shop": "https://github.com/acme/shop" }, { "acme/shop": many });
    const report = syncPrs(db, run, NOW);
    expect(report.repos[0]).toMatchObject({ pullRequests: PR_COMMIT_LIMIT + 3, commitsNotRead: 3 });
    expect(run.calls.filter((c) => c[1] === "view")).toHaveLength(PR_COMMIT_LIMIT);
    expect(run.calls.filter((c) => c[1] === "view").some((c) => c[2] === "1")).toBe(false);
  });

  it("replaces what it had for a repository, and keeps the old facts of one where gh failed, naming only the first line of the failure", () => {
    const db = ledgerWith("/work/shop", "/work/api");
    const remotes = { "/work/shop": "https://github.com/acme/shop", "/work/api": "https://github.com/acme/api" };
    syncPrs(db, runners(remotes, { "acme/shop": [item(1, "CLOSED", "a"), item(2, "CLOSED", "b")], "acme/api": [item(1, "CLOSED", "a")] }, { 1: [sha(1)], 2: [sha(2)] }), NOW);
    expect((db.prepare("SELECT COUNT(*) AS n FROM pr_fact").get() as { n: number }).n).toBe(3);
    const second = syncPrs(db, runners(remotes, { "acme/shop": [item(7, "MERGED", "m", "2026-10-03T00:00:00Z")], "acme/api": [] }, {}, (a) => {
      if (a.includes("acme/api")) throw new Error("gh: HTTP 401: Bad credentials (token ghp_example)\nTry authenticating with: gh auth login");
    }), NOW);
    expect(second.repos.map((r) => r.slug)).toEqual(["acme/shop"]);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0]!.reason).toMatch(/^gh failed: gh: HTTP 401: Bad credentials/);
    expect(second.skipped[0]!.reason).not.toContain("gh auth login");
    const left = db.prepare("SELECT repo_id, number FROM pr_fact ORDER BY repo_id, number").all() as { repo_id: number; number: number }[];
    expect(left.map((r) => `${r.repo_id}#${r.number}`)).toEqual(["1#7", "2#1"]);
  });

  it("stores nothing for a repository when a call fails half way through it, so the old facts stand", () => {
    const db = ledgerWith("/work/shop");
    const remotes = { "/work/shop": "https://github.com/acme/shop" };
    syncPrs(db, runners(remotes, { "acme/shop": [item(1, "CLOSED", "a")] }, { 1: [sha(1)] }), NOW);
    const report = syncPrs(db, runners(remotes, { "acme/shop": [item(1, "CLOSED", "a"), item(2, "CLOSED", "b")] }, {}, (a) => {
      if (a[1] === "view" && a[2] === "1") throw new Error("gh: HTTP 502");
    }), NOW);
    expect(report.skipped[0]!.reason).toMatch(/gh failed: gh: HTTP 502/);
    expect((db.prepare("SELECT number FROM pr_fact").all() as { number: number }[]).map((r) => r.number)).toEqual([1]);
  });

  it("does not ask about a relative repository root, which names a different folder on every run", () => {
    const db = ledgerWith(".", "./sub", "/work/shop");
    const run = runners({ ".": "https://github.com/acme/shop", "./sub": "https://github.com/acme/shop", "/work/shop": "https://github.com/acme/shop" }, { "acme/shop": [item(1, "OPEN", "a")] }, { 1: [sha(1)] });
    const report = syncPrs(db, run, NOW);
    expect(report.repos.map((r) => r.root)).toEqual(["/work/shop"]);
    expect(report.skipped.map((s) => s.root).sort()).toEqual([".", "./sub"]);
    expect(report.skipped[0]!.reason).toMatch(/relative path/);
    expect(run.calls.filter((c) => c[1] === "list")).toHaveLength(1);
  });

  it("stores nothing when what gh returned is not a list of pull requests", () => {
    const db = ledgerWith("/work/shop");
    const run: PrRunners = { remote: () => "https://github.com/acme/shop", gh: () => '{"message":"Not Found"}' };
    const report = syncPrs(db, run, NOW);
    expect(report.repos).toEqual([]);
    expect(report.skipped[0]!.reason).toMatch(/gh failed: gh did not return a list of pull requests/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM pr_fact").get() as { n: number }).n).toBe(0);
  });
});

describe("a session whose commits are in pull requests that were turned down", () => {
  /** One repository, sessions linked to commits at various confidences, and pull requests in each state. */
  function ledger(withPrs = true): Ledger {
    const db = openLedger(":memory:");
    db.prepare("INSERT INTO repo (repo_id, root, default_ref, scanned_at) VALUES (1, '/work/shop', 'main', '2026-10-20T00:00:00Z')").run();
    const session = db.prepare("INSERT INTO session (session_id, tool, project_path) VALUES (?, 'claude_code', '/work/shop')");
    const call = db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, '2026-10-10T10:00:00.000Z', 'claude-opus-5', 0, 0, 1, 0, 0, 0, 0, 'reported', 0, 0)");
    const outcome = db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, ?, 1, '2026-10-20T00:00:00Z')");
    const link = db.prepare("INSERT INTO session_commit (session_id, repo_id, sha, method, confidence) VALUES (?, 1, ?, 'file_overlap', ?)");
    const commit = db.prepare("INSERT INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted) VALUES (1, ?, '2026-10-10T11:00:00Z', 'a', 0, '[]', 0, 0)");
    const rows: [string, string, string, number[], string][] = [
      // session, state, best confidence, commits linked, link confidence
      ["turned-down", "committed", "high", [1, 2], "high"],
      ["one-merged", "committed", "high", [3, 4], "high"],
      ["no-pr", "committed", "high", [5], "high"],
      ["landed", "merged", "high", [6], "high"],
      ["weak-link", "committed", "low", [7], "low"],
      ["reopened", "committed", "medium", [8], "medium"],
    ];
    for (const [id, state, conf, shas, lc] of rows) {
      session.run(id);
      call.run(`c-${id}`, id);
      outcome.run(id, state, conf);
      for (const n of shas) {
        commit.run(sha(n));
        link.run(id, sha(n), lc);
      }
    }
    if (withPrs) {
      const pr = db.prepare("INSERT INTO pr_fact (repo_id, number, state, closed_at, head_ref, commit_shas, fetched_at) VALUES (1, ?, ?, NULL, NULL, ?, '2026-10-21T00:00:00Z')");
      pr.run(10, "closed_unmerged", JSON.stringify([sha(1), sha(2)]));
      pr.run(11, "closed_unmerged", JSON.stringify([sha(3)]));
      pr.run(12, "merged", JSON.stringify([sha(4)]));
      pr.run(13, "closed_unmerged", JSON.stringify([sha(6)]));
      pr.run(14, "closed_unmerged", JSON.stringify([sha(7)]));
      pr.run(15, "closed_unmerged", JSON.stringify([sha(8)]));
      pr.run(16, "open", JSON.stringify([sha(8)]));
    }
    return db;
  }

  it("names the pull requests when every trusted commit of a committed session is in pull requests closed without a merge and in no other", () => {
    const facts = loadOutcomeFacts(ledger())!;
    expect(facts.abandonedPrs("turned-down")).toEqual([10]);
  });

  it("names nothing when any commit is in a merged or open pull request, or in none", () => {
    const facts = loadOutcomeFacts(ledger())!;
    expect(facts.abandonedPrs("one-merged")).toBeNull(); // one commit is in a merged pull request
    expect(facts.abandonedPrs("no-pr")).toBeNull(); // a commit in no pull request
    expect(facts.abandonedPrs("reopened")).toBeNull(); // also in an open pull request
  });

  it("names nothing for work that landed by another route, a link too weak to trust, or a session that does not exist", () => {
    const facts = loadOutcomeFacts(ledger())!;
    expect(facts.abandonedPrs("landed")).toBeNull();
    expect(facts.abandonedPrs("weak-link")).toBeNull();
    expect(facts.abandonedPrs("nobody")).toBeNull();
  });

  it("names nothing at all when pull requests were never asked for", () => {
    const facts = loadOutcomeFacts(ledger(false))!;
    expect(facts.abandonedPrs("turned-down")).toBeNull();
  });
});

describe("what the egress list says about gh", () => {
  it("says that gh is not a connection the Desk makes, runs only on request, and is refused in the local profile", () => {
    const text = describeManifest({ profile: "standard", destinations: [] }).join("\n");
    expect(text).toMatch(/`desk landing --prs` runs your own `gh`, which asks api\.github\.com/);
    expect(text).toMatch(/only when you pass that flag, and it is refused in the local profile/);
  });
});
