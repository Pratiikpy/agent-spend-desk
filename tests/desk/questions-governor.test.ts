import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Gate } from "../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../src/desk/gate/policy-source.ts";
import { readAttentionLoad } from "../../src/desk/gate/readout.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { answerQuestion, askLoop, openQuestions } from "../../src/desk/outcomes/questions.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { buildReview, renderReview } from "../../src/desk/review/review.ts";
import { decide, governQuestions, heldBack, interruptionCost, policyWaitCost, priorYes, recordDecisions, stakesOf, VOI } from "../../src/desk/questions/governor.ts";
import { POLICY_YAML, call } from "./gate/harness.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

/** The value-of-information governor for questions to the owner (DF-107): ask now only when the answer is worth more than the interruption; queue it otherwise. */
const NOW = Date.parse("2026-10-30T00:00:00Z");
const WEEK = { label: "2026-W44", startMs: Date.parse("2026-10-26T00:00:00Z"), endMs: Date.parse("2026-11-02T00:00:00Z") };
const BASE_COST = (VOI.reviewSeconds + VOI.switchSeconds) * VOI.microsPerSecond;

describe("what an interruption costs and when it is worth it", () => {
  it("prices the time to read a question and to get back to work at the owner's rate, scaled up by how loaded they are", () => {
    expect(BASE_COST).toBe(6_666_600);
    expect(interruptionCost(0)).toBe(BASE_COST);
    expect(interruptionCost(0.5)).toBe(Math.round(BASE_COST * 1.5));
    expect(interruptionCost(1)).toBe(BASE_COST * 2);
    expect(interruptionCost(-3)).toBe(BASE_COST); // a negative load is not a discount
    expect(interruptionCost(null)).toBeNull();
  });

  it("asks now only when the answer is worth more than the interruption, and queues the tie", () => {
    expect(decide(BASE_COST + 1, 0, "m").action).toBe("ask_now");
    expect(decide(BASE_COST, 0, "m").action).toBe("queue");
    expect(decide(BASE_COST - 1, 0, "m").action).toBe("queue");
    expect(decide(0, 0, "m").action).toBe("queue");
  });

  it("asks for less when the owner is already loaded: the same answer is worth interrupting for at zero load and not at full load", () => {
    const worth = Math.round(BASE_COST * 1.5);
    expect(decide(worth, 0, "m").action).toBe("ask_now");
    expect(decide(worth, 0.5, "m").action).toBe("queue");
    expect(decide(worth, 1, "m").action).toBe("queue");
  });

  it("queues when the load could not be read, or what the answer is worth could not be worked out, and says which", () => {
    const noLoad = decide(1e12, null, "m");
    expect(noLoad).toMatchObject({ action: "queue", costMicros: null, load: null });
    expect(noLoad.reason).toMatch(/attention load could not be read/);
    const noWorth = decide(null, 0, "m");
    expect(noWorth).toMatchObject({ action: "queue", evoiMicros: null });
    expect(noWorth.reason).toMatch(/what the answer is worth could not be worked out/);
  });

  it("says in the reason what the answer is worth and what the interruption costs", () => {
    expect(decide(20_000_000, 0, "m").reason).toBe("the answer is worth $20.00 and interrupting costs $6.67");
    expect(decide(1_000_000, 0, "m").reason).toBe("the answer is worth $1.00, under the $6.67 an interruption costs; queued for the weekly review");
  });
});

describe("the chance an answer is yes", () => {
  const db = (): Ledger => openLedger(":memory:");
  const answer = (l: Ledger, i: number, a: "yes" | "no"): void => void l.prepare("INSERT INTO owner_answer (session_id, repo_root, sha, answer, answered_at) VALUES (?, 'r', ?, ?, '2026-10-01T00:00:00Z')").run(`s${i}`, `c${i}`, a);

  it("is one half until the owner has answered ten, and says so", () => {
    const l = db();
    for (let i = 0; i < 9; i++) answer(l, i, "yes");
    const p = priorYes(l);
    expect(p.p).toBe(0.5);
    expect(p.basis).toMatch(/9 earlier answers/);
    l.close();
  });

  it("is the share of the owner's own answers from ten, by Laplace's rule so that ten yeses is not certainty", () => {
    const l = db();
    for (let i = 0; i < 10; i++) answer(l, i, "yes");
    expect(priorYes(l).p).toBeCloseTo(11 / 12, 10);
    for (let i = 10; i < 30; i++) answer(l, i, "no");
    expect(priorYes(l).p).toBeCloseTo(11 / 32, 10);
    expect(priorYes(l).basis).toBe("10 yes in 30 of your earlier answers");
    l.close();
  });
});

describe("what waiting for the weekly review costs a policy change", () => {
  it("is the saving per day times the days until the review, and nothing for a period with no days", () => {
    expect(policyWaitCost(70_000_000, 7)).toBe(35_000_000);
    expect(policyWaitCost(70_000_000, 7, 1)).toBe(10_000_000);
    expect(policyWaitCost(70_000_000, 0)).toBe(0);
  });
});

function git(root: string, args: string[], date?: string): string {
  return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim();
}

describe("against a real repository", () => {
  let dir: TempDir;
  let db: Ledger;
  let repo: string;
  beforeEach(async () => {
    dir = new TempDir();
    db = openLedger(":memory:");
    repo = join(dir.path, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "app.ts"), "x");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "app"], "2026-10-20T10:20:00Z");
    // Two sessions the data cannot tell apart: a session that cost a lot and one that cost almost nothing, both near a commit now on main and older than a week.
    const mk = (session: string, output: number) => [
      assistantLine({ id: `${session}-1`, session, ts: "2026-10-20T10:01:00Z", output, tools: ["Edit"], toolInputs: [{ file_path: join(repo, "src", "app.ts") }] }),
      ...Array.from({ length: 6 }, (_, i) => assistantLine({ id: `${session}-${i + 2}`, session, ts: `2026-10-20T10:${String(3 + i).padStart(2, "0")}:00Z`, output })),
    ];
    await ingestClaudeCode(db, [dir.file("a.jsonl", mk("big", 400_000)), dir.file("b.jsonl", mk("small", 100))], testSnapshot());
    linkOutcomes(db, [repo], NOW);
  });
  afterEach(() => {
    db.close();
    dir.dispose();
  });

  it("works out a yes would make a kept commit's spend land, so the answer is worth the session's spend", () => {
    const [big, small] = openQuestions(db);
    expect(big!.sessionId).toBe("big");
    expect(stakesOf(db, big!, NOW)).toEqual({ micros: big!.spendMicros, ifYes: "kept" });
    expect(stakesOf(db, small!, NOW)).toEqual({ micros: small!.spendMicros, ifYes: "kept" });
  });

  it("asks about the session whose answer moves real money and queues the one that moves cents, at the same load", () => {
    const qs = openQuestions(db);
    const g = governQuestions(db, qs, 0, NOW);
    expect(g.prior.p).toBe(0.5);
    expect(qs[0]!.spendMicros * 0.5).toBeGreaterThan(BASE_COST); // the premise: the big session's answer is worth more than an interruption
    expect(g.ask.map((x) => x.question.sessionId)).toEqual(["big"]);
    expect(g.queued.map((x) => x.question.sessionId)).toEqual(["small"]);
    expect(g.ask[0]!.decision.evoiMicros).toBe(Math.round(0.5 * qs[0]!.spendMicros));
    expect(g.queued[0]!.decision.reason).toMatch(/queued for the weekly review/);
    expect(g.queued[0]!.decision.meanwhile).toMatch(/stays unlinked, which is not counted as landed or as waste/);
  });

  it("queues everything when the load cannot be read, and asks again once it can", () => {
    const qs = openQuestions(db);
    expect(governQuestions(db, qs, null, NOW).ask).toEqual([]);
    expect(governQuestions(db, qs, null, NOW).queued).toHaveLength(2);
    expect(governQuestions(db, qs, 0, NOW).ask).toHaveLength(1);
  });

  it("stops asking about the big session when the owner is loaded enough that its answer is no longer worth the interruption", () => {
    const qs = openQuestions(db);
    const ratio = (qs[0]!.spendMicros * 0.5) / BASE_COST;
    expect(governQuestions(db, qs, ratio - 1.01, NOW).ask).toHaveLength(1);
    expect(governQuestions(db, qs, ratio - 0.99, NOW).ask).toHaveLength(0);
  });

  it("asks nothing at all about a commit that is only committed, because no headline figure moves", () => {
    // The session's only candidate is a commit that is on no default branch: a yes would leave it committed, not landed.
    db.prepare("DELETE FROM session_commit WHERE session_id = 'big'").run();
    db.prepare("INSERT INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted) SELECT repo_id, 'side0000', '2026-10-29T10:00:00Z', 'a@b.c', 0, '[]', 0, 0 FROM repo LIMIT 1").run();
    db.prepare("INSERT INTO session_commit (repo_id, session_id, sha, method, confidence) SELECT repo_id, 'big', 'side0000', 'time_window', 'low' FROM repo LIMIT 1").run();
    const q = openQuestions(db, 100).find((x) => x.sha === "side0000")!;
    expect(q.spendMicros).toBeGreaterThan(BASE_COST * 2);
    expect(stakesOf(db, q, NOW)).toEqual({ micros: 0, ifYes: "committed" });
    expect(governQuestions(db, [q], 0, NOW).queued).toHaveLength(1);
  });

  it("asks the terminal only the question worth asking, says what waits and why, and --all style (no governor) asks every one", async () => {
    const run = async (governed: { load: number | null; note: string } | undefined, lines: string): Promise<{ r: Awaited<ReturnType<typeof askLoop>>; text: string }> => {
      const input = new PassThrough();
      const out = new PassThrough();
      let text = "";
      out.on("data", (c: Buffer) => (text += c.toString()));
      const done = askLoop(db, input, out, () => new Date(NOW), governed);
      input.write(lines);
      input.end();
      return { r: await done, text };
    };
    const governed = await run({ load: 0, note: "0 agents working and 0 questions in the last hour, against 4 and 10" }, "s\n");
    expect(governed.r).toEqual({ asked: 1, answered: 0, queued: 1 });
    expect(governed.text).toMatch(/Question 1 of 1/);
    expect(governed.text).toMatch(/1 waits for the weekly review, the most valuable worth \$\d+\.\d\d against \$6\.67 to interrupt you \(0 agents working and 0 questions in the last hour, against 4 and 10\)\. `desk questions ask --all` goes through them now\./);
    const all = await run(undefined, "s\ns\n");
    expect(all.r).toEqual({ asked: 2, answered: 0, queued: 0 });
  });

  it("writes what it decided about each question, with the figures, and the review counts the ones held back that are still open", async () => {
    const out = new PassThrough();
    out.resume();
    const input = new PassThrough();
    input.end();
    const when = new Date("2026-10-27T09:00:00Z");
    await askLoop(db, input, out, () => when, { load: 0, note: "n" });
    const rows = db.prepare("SELECT d.action AS action, d.evoi_micros AS evoi, d.cost_micros AS cost, d.load AS load, d.p_yes AS p, d.reason AS reason, d.decided_at AS at FROM question_decision d ORDER BY evoi DESC").all() as { action: string; evoi: number; cost: number; load: number; p: number; reason: string; at: string }[];
    expect(rows.map((r) => r.action)).toEqual(["ask_now", "queue"]);
    expect(rows[0]).toMatchObject({ cost: BASE_COST, load: 0, p: 0.5, at: "2026-10-27T09:00:00.000Z" });
    expect(rows[1]!.reason).toMatch(/queued for the weekly review/);
    // Both appear in the week of the 26th; only the one held back is counted, and it stops being counted once it is answered.
    expect(heldBack(db, "2026-10-26T00:00:00Z", "2026-11-02T00:00:00Z")).toEqual({ questions: 1, topEvoiMicros: rows[1]!.evoi });
    expect(heldBack(db, "2026-11-02T00:00:00Z", "2026-11-09T00:00:00Z")).toEqual({ questions: 0, topEvoiMicros: 0 });
    const review = buildReview({ db, snapshot: testSnapshot(), range: WEEK });
    expect(review.questions).toMatchObject({ open: 2, moving: 2, held: 1 });
    expect(review.questions.topEvoiMicros).toBe(rows[0]!.evoi);
    const text = renderReview(review);
    expect(text).toContain("2 of them would move a headline figure if answered yes");
    expect(text).toContain("1 of them was held back from interrupting you this week because the answer was worth less than the interruption.");
    answerQuestion(db, openQuestions(db).find((q) => q.sessionId === "small")!.id, "no");
    expect(heldBack(db, "2026-10-26T00:00:00Z", "2026-11-02T00:00:00Z")).toEqual({ questions: 0, topEvoiMicros: 0 }); // answered, so no longer held back; the log still has the decision
    expect(db.prepare("SELECT COUNT(*) AS n FROM question_decision").get()).toEqual({ n: 2 });
    expect(buildReview({ db, snapshot: testSnapshot(), range: WEEK }).questions.held).toBe(0);
  });

  it("is idempotent for one moment and rolls back if a write fails", () => {
    const qs = openQuestions(db);
    const g = governQuestions(db, qs, 0, NOW);
    const at = new Date("2026-10-27T09:00:00Z");
    recordDecisions(db, g, at);
    recordDecisions(db, g, at);
    expect(db.prepare("SELECT COUNT(*) AS n FROM question_decision").get()).toEqual({ n: 2 });
    db.exec("DROP TABLE question_decision");
    expect(() => recordDecisions(db, g, at)).toThrow();
  });

  it("says plainly that nothing is worth interrupting for when everything waits, and does not wait for input", async () => {
    const out = new PassThrough();
    let text = "";
    out.on("data", (c: Buffer) => (text += c.toString()));
    const r = await askLoop(db, new PassThrough(), out, () => new Date(NOW), { load: null, note: "the gate's record could not be read" });
    expect(r).toEqual({ asked: 0, answered: 0, queued: 2 });
    expect(text).toMatch(/2 open questions, and none is worth interrupting you for: 2 wait for the weekly review/);
    expect(text).toMatch(/the gate's record could not be read/);
  });

  it("does not change what an answer does: a yes still only links the commit, and git still says what it became", () => {
    const q = openQuestions(db)[0]!;
    expect(answerQuestion(db, q.id, "yes").kind).toBe("recorded");
    linkOutcomes(db, [repo], NOW);
    expect((db.prepare("SELECT state FROM session_outcome WHERE session_id = 'big'").get() as { state: string }).state).toBe("kept");
  });
});

describe("the attention load the governor reads", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-voi-load-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is zero, and says why, when there is no gate here", () => {
    expect(readAttentionLoad(null, NOW)).toMatchObject({ load: 0 });
    expect(readAttentionLoad(join(dir, "none.db"), NOW)).toMatchObject({ load: 0 });
  });

  it("is null, not zero, when the gate's record is there and cannot be read", () => {
    writeFileSync(join(dir, "gate.db"), "this is not a database, just text that SQLite will refuse to read as one");
    const r = readAttentionLoad(join(dir, "gate.db"), NOW);
    expect(r.load).toBeNull();
    expect(r.note).toMatch(/could not be/);
  });

  it("is the larger of agents working and questions asked against their limits, over everyone the gate has seen", () => {
    const raw = new DatabaseSync(join(dir, "gate.db"));
    const clock = { ms: NOW };
    const gate = new Gate({ db: raw, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)), now: () => clock.ms, shadowMs: 0 });
    for (const [i, person] of ["p-1", "p-1", "p-2"].entries()) gate.authorize(call({ session_id: `s-${i}`, person, max_tokens: 1000 }));
    raw.close();
    const r = readAttentionLoad(join(dir, "gate.db"), NOW + 60_000);
    expect(r.load).toBeCloseTo(3 / 4, 10);
    expect(r.note).toBe("3 agents working and 0 questions in the last hour, against 4 and 10");
  });
});
