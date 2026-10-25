import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { branchOf, branchTaskType } from "../../src/desk/autonomy/branch.ts";
import { autonomyCommand, gatePush, type Push } from "../../src/desk/autonomy/command.ts";
import { AUTONOMY, classify, decide, digestOf, type CommitFact, type TaskFact, type Tier, type WorkflowEvidence } from "../../src/desk/autonomy/matrix.ts";
import { applyDecisions, approvePromotion, echoOf, evaluateAll, history, setBlocked, storedTiers } from "../../src/desk/autonomy/store.ts";
import { startGateServer } from "../../src/desk/gate/http.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { scanRepo } from "../../src/desk/outcomes/git.ts";
import { call, rig, USD } from "./gate/harness.ts";

/**
 * Earned autonomy (DF-093): which kinds of work may go on without a question at a soft limit, how that is earned and lost, and what the gate does with it.
 */
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const ago = (days: number): number => NOW - days * DAY;
const commit = (o: Partial<CommitFact> & { ageDays: number }): CommitFact => ({ authoredAtMs: ago(o.ageDays), merged: o.merged ?? true, reverted: o.reverted ?? false, revertedAtMs: o.revertedAtMs ?? null });
const task = (workflow: string, ...commits: CommitFact[]): TaskFact => ({ taskId: `${workflow}-${Math.random()}`, workflow, commits });

describe("judging a task", () => {
  it("is a success once merged work is two weeks old and has not been reverted, and pending before", () => {
    expect(classify(task("feat", commit({ ageDays: 20 })), NOW).outcome).toBe("success");
    expect(classify(task("feat", commit({ ageDays: 14 })), NOW).outcome).toBe("success");
    expect(classify(task("feat", commit({ ageDays: 13.9 })), NOW).outcome).toBe("pending");
    expect(classify(task("feat", commit({ ageDays: 20 }), commit({ ageDays: 3 })), NOW).outcome).toBe("pending");
  });

  it("is a failure when any commit was reverted, at any age, and says when", () => {
    const c = classify(task("feat", commit({ ageDays: 40, reverted: true, revertedAtMs: ago(2) })), NOW);
    expect(c).toEqual({ outcome: "failure", revertedAtMs: ago(2) });
    expect(classify(task("feat", commit({ ageDays: 1, reverted: true, revertedAtMs: ago(0.5) })), NOW).outcome).toBe("failure");
    expect(classify(task("feat", commit({ ageDays: 40, reverted: true, revertedAtMs: null })), NOW)).toEqual({ outcome: "failure", revertedAtMs: null });
  });

  it("is a failure when committed work never merged for two weeks, and pending before", () => {
    expect(classify(task("fix", commit({ ageDays: 20, merged: false })), NOW).outcome).toBe("failure");
    expect(classify(task("fix", commit({ ageDays: 5, merged: false })), NOW).outcome).toBe("pending");
    expect(classify(task("fix", commit({ ageDays: 30, merged: false }), commit({ ageDays: 2, merged: false })), NOW).outcome).toBe("pending");
  });
});

function evidence(o: Partial<WorkflowEvidence> & { workflow?: string; success?: number; failure?: number }): WorkflowEvidence {
  const success = o.success ?? 0;
  const failure = o.failure ?? 0;
  const n = success + failure;
  const z2 = 1.959964 ** 2;
  const lower = n === 0 ? null : (success / n + z2 / (2 * n) - 1.959964 * Math.sqrt((success / n) * (1 - success / n) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { workflow: o.workflow ?? "feat", success, failure, pending: o.pending ?? 0, unlinked: o.unlinked ?? 0, n, rate: n === 0 ? null : success / n, lower, upper: null, lastRevertMs: o.lastRevertMs ?? null, recentRevert: o.recentRevert ?? false, revertedSha7: o.revertedSha7 ?? null };
}
const only = (e: WorkflowEvidence, tier: Tier | undefined) => decide([e], new Map(tier === undefined ? [] : [[e.workflow, tier]]), NOW)[0]!;

describe("deciding a tier", () => {
  it("holds a kind with too few finished runs, and says how many it has", () => {
    const d = only(evidence({ success: 29 }), undefined);
    expect(d).toMatchObject({ action: "hold", next: "supervised" });
    expect(d.reason).toBe("29 finished runs; it needs 30 before it can be promoted");
    expect(only(evidence({ success: 1 }), undefined).reason).toBe("1 finished run; it needs 30 before it can be promoted");
  });

  it("needs a lower bound of 90%, which 30 clean tasks do not give: it takes 35", () => {
    expect(only(evidence({ success: 30 }), undefined)).toMatchObject({ action: "hold" });
    expect(only(evidence({ success: 30 }), undefined).reason).toMatch(/lower bound of its success rate is 88\.\d% over 30 finished runs; promotion needs 90\.0%/);
    expect(only(evidence({ success: 34 }), undefined).action).toBe("hold");
    expect(only(evidence({ success: 35 }), undefined)).toMatchObject({ action: "propose_promotion", next: "guarded_auto" });
    // One failure among many still clears it once there are enough.
    expect(only(evidence({ success: 120, failure: 1 }), undefined).action).toBe("propose_promotion");
    expect(only(evidence({ success: 100, failure: 8 }), undefined).action).toBe("hold");
  });

  it("holds a promotion while a revert is inside the last two weeks, even with a good record", () => {
    const d = only(evidence({ success: 200, failure: 1, lastRevertMs: ago(10) }), undefined);
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/reverted on 2026-10-15, inside the last 14 days/);
    expect(only(evidence({ success: 200, failure: 1, lastRevertMs: ago(15) }), undefined).action).toBe("propose_promotion");
  });

  it("demotes a promoted kind the moment a commit of it was reverted in the last week, however good its record", () => {
    const d = only(evidence({ success: 400, failure: 1, lastRevertMs: ago(2), recentRevert: true, revertedSha7: "abc1234" }), "guarded_auto");
    expect(d).toMatchObject({ action: "demote", next: "supervised" });
    expect(d.reason).toBe("a commit of this work was reverted on 2026-10-23 (abc1234), inside the last 7 days");
    expect(only(evidence({ success: 400, failure: 1, lastRevertMs: ago(2), recentRevert: true }), "unassisted_auto").action).toBe("demote");
  });

  it("demotes a promoted kind whose lower bound falls under 85%, and keeps one that stays above", () => {
    expect(only(evidence({ success: 80, failure: 20 }), "guarded_auto")).toMatchObject({ action: "demote" });
    expect(only(evidence({ success: 95, failure: 5 }), "guarded_auto").action).toBe("none");
    expect(only(evidence({ success: 5, failure: 5 }), "guarded_auto").action).toBe("none"); // under the minimum cohort the bound is not read
  });

  it("never touches a block, and never promotes past guarded_auto by itself", () => {
    expect(only(evidence({ success: 500 }), "blocked")).toMatchObject({ action: "none", next: "blocked" });
    expect(only(evidence({ success: 500 }), "guarded_auto")).toMatchObject({ action: "none", next: "guarded_auto" });
  });

  it("gives the same digest for the same evidence on the same day and a different one when any of it changes", () => {
    const e = evidence({ success: 40 });
    expect(digestOf(e, NOW)).toBe(digestOf({ ...e }, NOW));
    expect(digestOf(e, NOW)).not.toBe(digestOf({ ...e, success: 41 }, NOW));
    expect(digestOf(e, NOW)).not.toBe(digestOf({ ...e, lastRevertMs: ago(30) }, NOW));
    expect(digestOf(e, NOW)).not.toBe(digestOf(e, NOW + DAY));
  });
});

/** A ledger with tasks that have sessions, calls, a repository and commits, as `desk landing` would leave it. */
function seed(db: Ledger): { addTask(workflow: string, i: number, c: { ageDays: number; merged?: boolean; reverted?: boolean; revertedAgoDays?: number; confidence?: string }): string } {
  db.prepare("INSERT INTO repo (root, default_ref, scanned_at) VALUES ('/work/repo', 'main', ?)").run(new Date(NOW).toISOString());
  const repoId = (db.prepare("SELECT repo_id FROM repo").get() as { repo_id: number }).repo_id;
  return {
    addTask(workflow, i, c) {
      const session = `s-${workflow}-${i}`;
      const sha = createHash("sha1").update(`${workflow}/${i}`).digest("hex");
      db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at) VALUES (?, 'claude_code', '/work/repo', ?, ?)").run(session, `${workflow}/task-${i}`, new Date(ago(c.ageDays + 1)).toISOString());
      db.prepare(
        `INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error, tool_names, block_lines, usage_conflicts)
         VALUES (?, ?, ?, 'claude-opus-5', 0, 1, 1, 0, 0, 0, 0, 'assumed-5m', 0, 0, '[]', 1, 0)`,
      ).run(`c-${session}`, session, new Date(ago(c.ageDays + 1)).toISOString());
      db.prepare("INSERT INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted, reverted_at) VALUES (?, ?, ?, 'x', 0, '[]', ?, ?, ?)").run(
        repoId, sha, new Date(ago(c.ageDays)).toISOString(), c.merged === false ? 0 : 1, c.reverted ? 1 : 0, c.reverted ? new Date(ago(c.revertedAgoDays ?? 1)).toISOString() : null,
      );
      db.prepare("INSERT INTO session_commit (session_id, repo_id, sha, method, confidence) VALUES (?, ?, ?, 'file_overlap', ?)").run(session, repoId, sha, c.confidence ?? "high");
      return sha;
    },
  };
}

describe("from the ledger", () => {
  let db: Ledger;
  beforeEach(() => {
    db = openLedger(":memory:");
  });
  afterEach(() => db.close());

  const cleanFeat = (n = 40): ReturnType<typeof seed> => {
    const s = seed(db);
    for (let i = 0; i < n; i += 1) s.addTask("feat", i, { ageDays: 20 + (i % 5) });
    for (let i = 0; i < 5; i += 1) s.addTask("fix", i, { ageDays: 25 });
    return s;
  };

  it("counts each kind from its tasks, leaves out what is not settled or not tied to a commit, and ignores a low-confidence link", () => {
    const s = seed(db);
    for (let i = 0; i < 3; i += 1) s.addTask("feat", i, { ageDays: 30 });
    s.addTask("feat", 3, { ageDays: 5 }); // not yet two weeks old
    s.addTask("feat", 4, { ageDays: 40, reverted: true, revertedAgoDays: 20 });
    s.addTask("feat", 5, { ageDays: 30, confidence: "low" }); // a guess: counts as not tied to a commit
    const e = evaluateAll(db, NOW).find((d) => d.workflow === "feat")!.evidence;
    expect(e).toMatchObject({ success: 3, failure: 1, pending: 1, unlinked: 1, n: 4 });
    expect(e.recentRevert).toBe(false);
    expect(e.lastRevertMs).toBe(ago(20));
  });

  it("proposes a kind with a long clean record, records the proposal once, and leaves a young kind alone", () => {
    cleanFeat();
    const ds = evaluateAll(db, NOW);
    expect(ds.find((d) => d.workflow === "feat")).toMatchObject({ action: "propose_promotion", tier: "supervised" });
    expect(ds.find((d) => d.workflow === "fix")).toMatchObject({ action: "hold" });
    expect(applyDecisions(db, ds, NOW).proposed.map((d) => d.workflow)).toEqual(["feat"]);
    expect(applyDecisions(db, evaluateAll(db, NOW), NOW + 1000).proposed).toEqual([]); // the same evidence is not proposed again
    expect(db.prepare("SELECT COUNT(*) AS n FROM autonomy_event WHERE kind = 'proposed'").get()).toEqual({ n: 1 });
    expect(storedTiers(db).size).toBe(0); // a proposal changes no tier
  });

  it("promotes only when the owner echoes the digest of the evidence as it stands, and refuses a code that is wrong, stale or for the wrong kind", () => {
    cleanFeat();
    const d = evaluateAll(db, NOW).find((x) => x.workflow === "feat")!;
    expect(approvePromotion(db, "feat", "", NOW)).toMatchObject({ ok: false });
    expect(approvePromotion(db, "feat", "00000000", NOW)).toMatchObject({ ok: false, reason: expect.stringContaining(`is ${echoOf(d.digest)} now`) });
    expect(approvePromotion(db, "feat", "not-hex!", NOW).ok).toBe(false);
    expect(approvePromotion(db, "fix", echoOf(d.digest), NOW)).toMatchObject({ ok: false, reason: expect.stringContaining("is not proposed for promotion now") });
    expect(approvePromotion(db, "nothing", echoOf(d.digest), NOW)).toMatchObject({ ok: false, reason: expect.stringContaining("no finished or unfinished run of kind") });
    // The evidence moves on (a day passes), so the old code no longer matches.
    expect(approvePromotion(db, "feat", echoOf(d.digest), NOW + DAY).ok).toBe(false);
    const ok = approvePromotion(db, "feat", echoOf(d.digest).toUpperCase(), NOW);
    expect(ok.ok).toBe(true);
    expect(storedTiers(db).get("feat")).toMatchObject({ tier: "guarded_auto" });
    expect(history(db, "feat").map((h) => h.kind)).toEqual(["promoted"]);
    expect(approvePromotion(db, "feat", echoOf(d.digest), NOW).ok).toBe(false); // already promoted: nothing to approve
  });

  it("demotes at once on a planted revert, records why, and will not promote again while the revert is recent", () => {
    const s = cleanFeat();
    const first = evaluateAll(db, NOW).find((x) => x.workflow === "feat")!;
    approvePromotion(db, "feat", echoOf(first.digest), NOW);
    // A commit of that work is reverted two days ago.
    const sha = s.addTask("feat", 99, { ageDays: 30, reverted: true, revertedAgoDays: 2 });
    const ds = evaluateAll(db, NOW);
    const d = ds.find((x) => x.workflow === "feat")!;
    expect(d).toMatchObject({ action: "demote", tier: "guarded_auto", next: "supervised" });
    expect(d.reason).toBe(`a commit of this work was reverted on 2026-10-23 (${sha.slice(0, 7)}), inside the last 7 days`);
    const applied = applyDecisions(db, ds, NOW);
    expect(applied.demoted.map((x) => x.workflow)).toEqual(["feat"]);
    expect(storedTiers(db).get("feat")).toMatchObject({ tier: "supervised" });
    expect(history(db, "feat").map((h) => `${h.kind}:${h.from}>${h.to}`)).toEqual(["demoted:guarded_auto>supervised", "promoted:supervised>guarded_auto"]);
    // Two days of waiting do not bring it back: a revert inside two weeks holds a new proposal.
    const later = evaluateAll(db, NOW + 3 * DAY).find((x) => x.workflow === "feat")!;
    expect(later.action).toBe("hold");
    expect(later.reason).toMatch(/reverted on 2026-10-23, inside the last 14 days/);
  });

  it("lets the owner block a kind and lift the block, and a lifted block returns to supervised, not to an earned tier", () => {
    cleanFeat();
    expect(setBlocked(db, "fix", true, NOW, "").ok).toBe(true);
    expect(setBlocked(db, "fix", true, NOW, "").message).toMatch(/blocked already/);
    expect(storedTiers(db).get("fix")?.tier).toBe("blocked");
    expect(evaluateAll(db, NOW).find((x) => x.workflow === "fix")).toMatchObject({ action: "none", next: "blocked" });
    expect(setBlocked(db, "fix", false, NOW, "").message).toMatch(/supervised again, not promoted/);
    expect(setBlocked(db, "fix", false, NOW, "").message).toMatch(/not blocked/);
    expect(setBlocked(db, "Bad Name", true, NOW, "").ok).toBe(false);
    // A kind blocked before it has any task still shows.
    setBlocked(db, "docs", true, NOW, "owner");
    expect(evaluateAll(db, NOW).some((x) => x.workflow === "docs" && x.tier === "blocked")).toBe(true);
  });

  it("reports through the command, tells the gate, and says plainly when the gate was not told", async () => {
    cleanFeat();
    const pushed: unknown[] = [];
    const push: Push = async (changes) => {
      pushed.push(changes);
      return { ok: true, detail: `the gate holds ${changes.length}` };
    };
    const status = await autonomyCommand(["status"], db, { nowMs: NOW });
    expect(status.text).toContain("feat");
    expect(status.text).toMatch(/40 of 40 landed and stayed \(100\.0%, lower bound 91\.2%\)/);
    expect(status.text).toMatch(/to approve: desk autonomy approve feat [0-9a-f]{8}/);
    const dry = await autonomyCommand(["evaluate"], db, { nowMs: NOW, push });
    expect(dry.text).toContain("Nothing was changed.");
    expect(pushed).toEqual([]);
    const applied = await autonomyCommand(["evaluate"], db, { nowMs: NOW, push, apply: true });
    expect(applied.text).toMatch(/Proposed feat for guarded_auto\. Nothing changes until you approve: desk autonomy approve feat [0-9a-f]{8}/);
    expect(applied.text).toContain("Gate: nothing to tell the gate.");
    const code = /approve feat ([0-9a-f]{8})/.exec(applied.text)![1]!;
    const approved = await autonomyCommand(["approve", "feat", code], db, { nowMs: NOW, push });
    expect(approved.ok).toBe(true);
    expect(pushed).toEqual([[expect.objectContaining({ workflow: "feat", tier: "guarded_auto" })]]);
    const untold = await autonomyCommand(["block", "fix"], db, { nowMs: NOW });
    expect(untold.ok).toBe(false);
    expect(untold.text).toContain("the gate was not told: set DESK_GATE_OWNER_TOKEN");
    expect(storedTiers(db).get("fix")?.tier).toBe("blocked"); // the ledger holds it; the gate is not enforcing it
    await expect(autonomyCommand(["approve"], db, {})).rejects.toThrow(/Use: desk autonomy approve/);
    await expect(autonomyCommand(["bogus"], db, {})).rejects.toThrow(/Use: desk autonomy status/);
    expect((await autonomyCommand(["history", "feat"], db, {})).text).toMatch(/promoted/);
    expect((await autonomyCommand(["history", "ghost"], db, {})).text).toBe('No change has been recorded for "ghost".');
    expect((await autonomyCommand(["status"], openLedger(":memory:"), {})).text).toMatch(/Run desk landing first/);
  });

  it("only builds a push to the gate when the owner token is set, and reports a gate that cannot be reached", async () => {
    expect(gatePush({})).toBeUndefined();
    const push = gatePush({ DESK_GATE_OWNER_TOKEN: ["owner", "token", "0123456789abcdef"].join("-"), DESK_GATE_URL: "http://127.0.0.1:9" })!;
    const r = await push([{ workflow: "feat", tier: "supervised", reason: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/http:\/\/127\.0\.0\.1:9 could not be reached|answered/);
  });
});

describe("reading git", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-autonomy-git-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]): string => execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" }).trim();

  it("records when a commit was reverted, as the time of the revert commit", () => {
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "1");
    git("add", "-A");
    execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "work"], { env: { ...process.env, GIT_AUTHOR_DATE: "2026-10-01T10:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T10:00:00Z" } });
    const sha = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "b.txt"), "2");
    git("add", "-A");
    execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", `Revert work\n\nThis reverts commit ${sha}.`], { env: { ...process.env, GIT_AUTHOR_DATE: "2026-10-04T08:30:00Z", GIT_COMMITTER_DATE: "2026-10-04T08:30:00Z" } });
    const scan = scanRepo(dir);
    const c = scan.commits.find((x) => x.sha === sha)!;
    expect(c.reverted).toBe(true);
    expect(Date.parse(c.revertedAt as string)).toBe(Date.parse("2026-10-04T08:30:00Z"));
    expect(scan.commits.find((x) => x.sha !== sha)!.reverted).toBe(false);
  });

  it("types a folder by its branch without starting a process", () => {
    git("init", "-q", "-b", "main");
    expect(branchOf(dir)).toBe("main");
    expect(branchTaskType(dir, () => 1)).toBe("branch");
    git("checkout", "-q", "-b", "feat/login");
    expect(branchTaskType(dir, () => 100_000)).toBe("feat");
    mkdirSync(join(dir, "src", "deep"), { recursive: true });
    expect(branchTaskType(join(dir, "src", "deep"), () => 100_000)).toBe("feat"); // a folder inside the repository
    writeFileSync(join(dir, "a.txt"), "1");
    git("add", "-A");
    git("commit", "-q", "-m", "x");
    git("checkout", "-q", "--detach");
    expect(branchTaskType(dir, () => 200_000)).toBe("session");
    expect(branchTaskType(null)).toBe("code");
    expect(branchTaskType(mkdtempSync(join(tmpdir(), "desk-no-repo-")), () => 1)).toBe("code");
    // The answer is held for a few seconds, so the hook does not read the disk on every call.
    git("checkout", "-q", "-b", "fix/crash");
    expect(branchTaskType(dir, () => 200_100)).toBe("session");
    expect(branchTaskType(dir, () => 300_000)).toBe("fix");
  });
});

describe("in the gate", () => {
  const POLICY = `
version: 1
rules:
  - id: allow-claude
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "10.00", warn_at: 0.1, ask_at: 0.2 }
approvals:
  - when: { action: { in: ["cap.raise"] } }
    approvers: ["owner"]
`;
  // A call reserving $2.50 is over the soft limit at $2.00 and under the cap at $10.00.
  const ask = (r: ReturnType<typeof rig>, taskType: string, extra: Record<string, unknown> = {}) => r.gate.authorize(call({ idempotency_key: `${taskType}-${Math.random()}`, task_type: taskType, ...extra }));

  it("asks at a soft limit for a supervised kind and not for a promoted one, with the reason on the record", () => {
    const r = rig({ policyYaml: POLICY });
    expect(ask(r, "feat")).toMatchObject({ verdict: "ask", reasonCode: "ask_required" });
    r.gate.setAutonomy("feat", "guarded_auto", "approved by the owner");
    const d = ask(r, "feat");
    expect(d).toMatchObject({ verdict: "allow", reasonCode: "earned_autonomy" });
    expect(d.reasons.join(" ")).toContain('earned autonomy: work of kind "feat" has landed and stayed (guarded_auto), so the soft limit did not ask');
    expect(ask(r, "fix")).toMatchObject({ verdict: "ask" }); // another kind is not covered
    r.gate.setAutonomy("feat", "unassisted_auto", "set by the owner");
    expect(ask(r, "feat").verdict).toBe("allow");
  });

  it("goes back to asking on the very next call after a demotion", () => {
    const r = rig({ policyYaml: POLICY });
    r.gate.setAutonomy("feat", "guarded_auto", "approved");
    expect(ask(r, "feat").verdict).toBe("allow");
    r.gate.setAutonomy("feat", "supervised", "a commit of this work was reverted");
    expect(ask(r, "feat").verdict).toBe("ask");
  });

  it("never turns a hard cap, a forbidden action or a different kind of ask into an allow", () => {
    const r = rig({ policyYaml: POLICY });
    r.gate.setAutonomy("feat", "guarded_auto", "approved");
    // A request that would take the day past $10.00 is denied however much the kind has earned.
    expect(ask(r, "feat", { max_tokens: 500_000 })).toMatchObject({ verdict: "deny" });
    // An approval-gated action is not a spend, so earned autonomy does not answer it.
    expect(ask(r, "feat", { action: "cap.raise" }).verdict).not.toBe("allow");
  });

  it("refuses the requests of a blocked kind, whatever the policy said, and not those of other kinds", () => {
    const r = rig({ policyYaml: POLICY });
    r.gate.setAutonomy("docs", "blocked", "owner");
    const d = ask(r, "docs", { max_tokens: 100 });
    expect(d).toMatchObject({ verdict: "deny", reasonCode: "workflow_blocked" });
    expect(d.reasons.join(" ")).toContain('the owner blocked work of kind "docs"');
    expect(ask(r, "feat", { max_tokens: 100 }).verdict).toBe("allow");
  });

  it("reads the same through the hook path, where the folder's branch decides the kind of work", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-autonomy-hook-"));
    try {
      execFileSync("git", ["-C", dir, "init", "-q", "-b", "feat/search"]);
      const r = rig({ policyYaml: POLICY, taskTypeOf: (cwd) => branchTaskType(cwd, () => Date.now() + Math.random() * 1e9), hookProbeMicros: USD(2.5) });
      const hook = () => r.gate.hookPreToolUse({ hook_event_name: "PreToolUse", session_id: `h-${Math.random()}`, tool_name: "Edit", cwd: dir, tool_input: {} });
      expect(hook().decision).toBe("ask");
      r.gate.setAutonomy("feat", "guarded_auto", "approved");
      expect(hook().decision).toBe("allow");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is set only through the owner's route, validates what it is given, and survives a restart of the gate on the same database", async () => {
    const OWNER = ["owner", "bearer", "for", "tests", "0123456789"].join("-");
    const TOKEN = ["gate", "token", "for", "tests", "0123456789"].join("-");
    const r = rig({ policyYaml: POLICY });
    const s = await startGateServer({ gate: r.gate, token: TOKEN, ownerToken: OWNER });
    const post = (body: unknown, token: string): Promise<Response> => fetch(`${s.url}/v1/admin/autonomy`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    try {
      expect((await post({ workflow: "feat", tier: "guarded_auto" }, TOKEN)).status).toBe(403);
      expect(r.gate.autonomyTiers().size).toBe(0);
      expect((await post({ workflow: "feat", tier: "guarded_auto", reason: "approved" }, OWNER)).status).toBe(200);
      expect((await post({ set: [{ workflow: "fix", tier: "blocked" }, { workflow: "docs", tier: "supervised" }] }, OWNER)).status).toBe(200);
      expect(Object.fromEntries(r.gate.autonomyTiers())).toEqual({ feat: "guarded_auto", fix: "blocked", docs: "supervised" });
      expect((await post({ workflow: "feat", tier: "god_mode" }, OWNER)).status).toBe(400);
      expect((await post({ workflow: "Feat Work", tier: "supervised" }, OWNER)).status).toBe(400);
      expect((await post({ set: [] }, OWNER)).status).toBe(400);
      expect((await post({ workflow: "feat" }, OWNER)).status).toBe(400);
      expect(r.gate.autonomyTiers().get("feat")).toBe("guarded_auto");
    } finally {
      await s.close();
    }
    const again = rig({ db: r.db, policyYaml: POLICY });
    expect(again.gate.autonomyTiers().get("feat")).toBe("guarded_auto");
  });
});

describe("from the ledger to the gate, over HTTP", () => {
  it("promotes in the ledger, pushes to a running gate, and the next call is not asked; a revert then demotes and the call after that is asked again", async () => {
    const OWNER = ["owner", "bearer", "for", "tests", "0123456789"].join("-");
    const TOKEN = ["gate", "token", "for", "tests", "0123456789"].join("-");
    const POLICY = `version: 1
rules:
  - id: allow-claude
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "10.00", warn_at: 0.1, ask_at: 0.2 }
`;
    const r = rig({ policyYaml: POLICY });
    const s = await startGateServer({ gate: r.gate, token: TOKEN, ownerToken: OWNER });
    const db = openLedger(":memory:");
    try {
      const seeded = seed(db);
      for (let i = 0; i < 40; i += 1) seeded.addTask("feat", i, { ageDays: 21 });
      const env = { DESK_GATE_OWNER_TOKEN: OWNER, DESK_GATE_URL: s.url };
      const push = gatePush(env)!;
      const reserve = (key: string): Promise<{ verdict: string; reasonCode: string }> =>
        fetch(`${s.url}/v1/reserve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(call({ idempotency_key: key, task_type: "feat" })) }).then((x) => x.json() as Promise<{ verdict: string; reasonCode: string }>);
      expect((await reserve("before")).verdict).toBe("ask");
      const proposed = await autonomyCommand(["evaluate"], db, { nowMs: NOW, push, apply: true });
      const code = /approve feat ([0-9a-f]{8})/.exec(proposed.text)![1]!;
      const approved = await autonomyCommand(["approve", "feat", code], db, { nowMs: NOW, push });
      expect(approved.text).toContain("Gate: the gate at");
      expect(approved.ok).toBe(true);
      expect(await reserve("after-promotion")).toMatchObject({ verdict: "allow", reasonCode: "earned_autonomy" });
      seeded.addTask("feat", 99, { ageDays: 30, reverted: true, revertedAgoDays: 1 });
      const demoted = await autonomyCommand(["evaluate"], db, { nowMs: NOW, push, apply: true });
      expect(demoted.text).toMatch(/Demoted feat to supervised: a commit of this work was reverted on 2026-10-24/);
      expect(demoted.ok).toBe(true);
      expect((await reserve("after-revert")).verdict).toBe("ask");
    } finally {
      db.close();
      await s.close();
    }
  });
});

void AUTONOMY;
