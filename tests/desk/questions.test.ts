import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import type { Link } from "../../src/desk/outcomes/attribute.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { answerQuestion, applyAnswers, askLoop, openQuestions, questionId, renderQuestion, type OwnerAnswer } from "../../src/desk/outcomes/questions.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const NOW = Date.parse("2026-10-30T00:00:00Z");
const link = (sessionId: string, sha: string, confidence: Link["confidence"] = "low"): Link => ({ sessionId, sha, method: "time_window", confidence });
const ans = (sessionId: string, sha: string, answer: "yes" | "no"): OwnerAnswer => ({ sessionId, repoRoot: "r", sha, answer });

describe("applying the owner's answers to links", () => {
  const commits = new Set(["a1", "b2"]);
  const sessions = new Set(["s1", "s2"]);

  it("drops a link the owner said no to, makes a yes explicit and high, and leaves the rest alone", () => {
    const out = applyAnswers([link("s1", "a1"), link("s2", "a1"), link("s1", "b2", "medium")], [ans("s1", "a1", "yes"), ans("s2", "a1", "no")], commits, sessions);
    expect(out).toEqual([{ sessionId: "s1", sha: "a1", method: "explicit", confidence: "high" }, link("s1", "b2", "medium")]);
  });

  it("adds a link the owner said yes to even where the guess had missed it, when the session and the commit are known", () => {
    expect(applyAnswers([], [ans("s2", "b2", "yes")], commits, sessions)).toEqual([{ sessionId: "s2", sha: "b2", method: "explicit", confidence: "high" }]);
  });

  it("ignores a yes about a commit or a session that is no longer there, instead of inventing a link", () => {
    expect(applyAnswers([], [ans("gone", "b2", "yes"), ans("s1", "missing", "yes")], commits, sessions)).toEqual([]);
  });

  it("does not turn a no into anything for a link that was never there", () => {
    expect(applyAnswers([link("s1", "a1")], [ans("s2", "zz", "no")], commits, sessions)).toEqual([link("s1", "a1")]);
  });
});

const HOUR = 3_600_000;
void HOUR;

function git(root: string, args: string[], date?: string): string {
  return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim();
}

describe("the question queue against a real repository", () => {
  let dir: TempDir;
  let db: Ledger;
  let repo: string;
  let sha: string;
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
    sha = git(repo, ["rev-parse", "HEAD"]);
    // Two sessions that both ran around the commit and wrote the same file: the data cannot tell them apart.
    const mk = (session: string, minute: number) => [
      assistantLine({ id: `${session}-1`, session, ts: `2026-10-20T10:${String(minute).padStart(2, "0")}:00Z`, output: 10_000, tools: ["Edit"], toolInputs: [{ file_path: join(repo, "src", "app.ts") }] }),
      ...Array.from({ length: 6 }, (_, i) => assistantLine({ id: `${session}-${i + 2}`, session, ts: `2026-10-20T10:${String(minute + 2 + i).padStart(2, "0")}:00Z`, output: 10_000 })),
    ];
    await ingestClaudeCode(db, [dir.file("a.jsonl", mk("big", 1)), dir.file("b.jsonl", mk("small", 1).map((l) => l.replace('"output_tokens":10000', '"output_tokens":100')))], testSnapshot());
    linkOutcomes(db, [repo], NOW);
  });
  afterEach(() => {
    db.close();
    dir.dispose();
  });

  it("asks about links it is not sure of, the costliest session first, and about nothing else", () => {
    const qs = openQuestions(db);
    expect(qs.map((q) => q.sessionId)).toEqual(["big", "small"]);
    expect(qs[0]!.spendMicros).toBeGreaterThan(qs[1]!.spendMicros);
    expect(qs[0]).toMatchObject({ sha, method: "file_overlap", id: questionId("big", repo, sha) });
    expect(renderQuestion(qs[0]!, 1, 2)).toMatch(new RegExp(`Question 1 of 2 {3}\\[${qs[0]!.id}\\]\\n {2}Is commit ${sha.slice(0, 7)} \\(2026-10-20 10:20 UTC\\) from the session that ran 2026-10-20 10:01 to 2026-10-20 10:\\d\\d`));
  });

  it("applies a yes as an explicit link and a no as no link, the next time landing is computed, and never above what git says", () => {
    expect(answerQuestion(db, questionId("big", repo, sha), "yes").kind).toBe("recorded");
    expect(answerQuestion(db, questionId("small", repo, sha), "no").kind).toBe("recorded");
    expect(openQuestions(db)).toEqual([]); // an answered question is closed at once
    expect((db.prepare("SELECT COUNT(*) n FROM session_commit").get() as { n: number }).n).toBe(2); // the links change when landing is recomputed
    linkOutcomes(db, [repo], NOW);
    expect(openQuestions(db)).toEqual([]);
    expect(db.prepare("SELECT session_id, method, confidence FROM session_commit ORDER BY session_id").all()).toEqual([{ session_id: "big", method: "explicit", confidence: "high" }]);
    // The commit is on the default branch and older than a week, so git says kept; an unmerged commit would have said committed.
    expect((db.prepare("SELECT state FROM session_outcome WHERE session_id = 'big'").get() as { state: string }).state).toBe("kept");
    expect((db.prepare("SELECT state FROM session_outcome WHERE session_id = 'small'").get() as { state: string }).state).toBe("unlinked");
    // The answers survive every later recomputation.
    linkOutcomes(db, [repo], NOW);
    expect(db.prepare("SELECT COUNT(*) n FROM session_commit").get()).toEqual({ n: 1 });
  });

  it("lets a person change their mind, and finds a question by a prefix of its id", () => {
    const id = questionId("big", repo, sha);
    answerQuestion(db, id, "no");
    expect(answerQuestion(db, id.slice(0, 5), "yes")).toMatchObject({ kind: "recorded", answer: "yes" });
    expect(db.prepare("SELECT answer FROM owner_answer WHERE session_id = 'big'").get()).toEqual({ answer: "yes" });
    expect(answerQuestion(db, "q-ffffffff", "yes")).toEqual({ kind: "unknown" });
    expect(answerQuestion(db, "q-", "yes")).toEqual({ kind: "unknown" }); // two questions match a bare prefix
  });

  it("asks the questions on a terminal, records y and n, leaves a skipped one open and stops at quit", async () => {
    const input = new PassThrough();
    const out = new PassThrough();
    let text = "";
    out.on("data", (c: Buffer) => (text += c.toString()));
    const done = askLoop(db, input, out);
    input.write("y\n");
    input.write("s\n");
    input.end();
    const r = await done;
    expect(r).toEqual({ asked: 2, answered: 1, queued: 0 });
    expect(text).toMatch(/1 answered, 1 left open/);
    expect(db.prepare("SELECT session_id, answer FROM owner_answer").all()).toEqual([{ session_id: "big", answer: "yes" }]);
    expect(openQuestions(db).map((q) => q.sessionId)).toEqual(["small"]);
  });

  it("says plainly when nothing is in doubt", async () => {
    const empty = openLedger(":memory:");
    const out = new PassThrough();
    let text = "";
    out.on("data", (c: Buffer) => (text += c.toString()));
    expect(await askLoop(empty, new PassThrough(), out)).toEqual({ asked: 0, answered: 0, queued: 0 });
    expect(text).toMatch(/No open question\. Nothing the Desk linked is in doubt\./);
    empty.close();
  });
});
