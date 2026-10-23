import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../src/desk/agents/model.ts";
import { ask, type Precedent } from "../../src/desk/ask/ask.ts";
import type { AnswerProgram } from "../../src/desk/ask/program.ts";
import type { Question } from "../../src/desk/bench/questions.ts";
import type { BenchRow } from "../../src/desk/bench/run.ts";
import { findJsonlLogs } from "../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { mistakesOf, pairedChange, runLearning } from "../../src/desk/lessons/learn.ts";
import { nearest, shapeOf, similarity } from "../../src/desk/lessons/precedent.ts";
import { addLesson, allLessons, allRounds, openLessons, precedentsInForce } from "../../src/desk/lessons/store.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir, sampleReposDir } from "../../src/desk/sample/gen.ts";
import { TEAM_OF_REPO } from "../../src/desk/silo/seed.ts";

const program = (from: string, to: string): AnswerProgram => ({ steps: [{ id: "s1", op: "spend", from, to, group: "none" }] }) as unknown as AnswerProgram;

describe("the shape of a question", () => {
  it("replaces dates, months, model names and numbers, so questions that differ only in them are the same shape", () => {
    const a = "How much did we spend between 2026-09-02 and 2026-09-30? Give the dollar amount.";
    const b = "How much did we spend between 2026-10-05 and 2026-10-20? Give the dollar amount.";
    expect(shapeOf(a)).toBe(shapeOf(b));
    expect(shapeOf("What share of spend in September 2026 was on claude-opus-5?")).toBe(shapeOf("What share of spend in October 2026 was on claude-haiku-4-5?"));
    expect(similarity(a, b)).toBe(1);
  });

  it("finds the nearest earlier questions above the floor, never the question itself, nearest first", () => {
    const pool: Precedent[] = [
      { id: "L1", question: "How much did we spend between 2026-09-02 and 2026-09-30? Give the dollar amount.", program: program("2026-09-02", "2026-09-30") },
      { id: "L2", question: "What did the most expensive single session between 2026-09-03 and 2026-09-20 cost? Give the dollar amount.", program: program("2026-09-03", "2026-09-20") },
      { id: "L3", question: "Which model cost the most?", program: program("2026-09-01", "2026-09-30") },
    ];
    const q = "How much did we spend between 2026-10-01 and 2026-10-10? Give the dollar amount.";
    expect(nearest(q, pool, 2).map((p) => p.id)).toEqual(["L1"]);
    expect(nearest(pool[0]!.question, pool, 2).map((p) => p.id)).not.toContain("L1");
    expect(nearest("Completely unrelated words about weather", pool, 2)).toEqual([]);
  });
});

describe("lessons", () => {
  it("stores a lesson with its plan, keeps one row per question, and puts only accepted plans in force", () => {
    const db = openLessons(":memory:");
    const a = addLesson(db, { kind: "wrong_plan", question: "How much?", expected: { required: [] }, changeKind: "precedent", program: program("2026-09-01", "2026-09-30"), attempts: 2, createdAt: "t" });
    const again = addLesson(db, { kind: "wrong_plan", question: "How much?", expected: { required: [] }, changeKind: "precedent", program: program("2026-09-01", "2026-09-30"), attempts: 3, createdAt: "t" });
    expect(again.id).toBe(a.id);
    expect(allLessons(db)).toHaveLength(1);
    expect(allLessons(db)[0]!.status).toBe("pending");
    expect(precedentsInForce(db)).toHaveLength(0);
    db.prepare("UPDATE lesson SET status = 'accepted' WHERE lesson_id = ?").run(a.id);
    expect(precedentsInForce(db).map((p) => p.id)).toEqual([a.id]);
    const none = addLesson(db, { kind: "wrong_plan", question: "Unfixable?", expected: {}, changeKind: "none", program: null, attempts: 4, createdAt: "t" });
    expect(allLessons(db).find((l) => l.id === none.id)!.status).toBe("unresolved");
    expect(allRounds(db)).toEqual([]);
  });

  it("measures the change in held-out error with a paired interval that excludes zero only when it should", () => {
    const base = Array.from({ length: 60 }, (_, i) => i < 30);
    const better = Array.from({ length: 60 }, (_, i) => i < 50);
    const same = base.slice();
    expect(pairedChange(base, better, 1).change).toBeCloseTo(-1 / 3, 10);
    expect(pairedChange(base, better, 1).high).toBeLessThan(0);
    const flat = pairedChange(base, same, 1);
    expect(flat.change).toBe(0);
    expect(flat.low).toBe(0);
    expect(flat.high).toBe(0);
    const noisy = Array.from({ length: 60 }, (_, i) => (i < 30 ? i !== 3 : i === 30));
    const n = pairedChange(base, noisy, 1);
    expect(n.low).toBeLessThanOrEqual(0);
    expect(n.high).toBeGreaterThanOrEqual(0);
  });

  it("names as mistakes the Desk's greedy runs that were wrong without a model failure", () => {
    const q = (id: string): Question => ({ id, category: "lookup", split: "dev", text: id, expect: { kind: "abstain" } });
    const row = (qid: string, over: Partial<BenchRow>): BenchRow => ({ qid, arm: "A2", category: "lookup", split: "dev", answer: "", error: null, exact: false, close: false, abstained: false, resisted: null, rejectedPremise: null, extraFigures: 0, modelCalls: 2, tokensIn: 0, tokensOut: 0, servedModel: null, ms: 0, detail: "", trial: 0, ...over }) as BenchRow;
    const rows = [row("Q1", { exact: true }), row("Q2", {}), row("Q3", { error: "model unavailable" }), row("Q4", { arm: "A1" }), row("Q5", { trial: 1 })];
    expect(mistakesOf(["Q1", "Q2", "Q3", "Q4", "Q5"].map(q), rows).map((x) => x.id)).toEqual(["Q2"]);
  });
});

type Reply = (r: ModelRequest) => Partial<ModelResponse> | Error;
class Scripted implements ModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly byRole: Record<string, Reply>) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.requests.push(r);
    const reply = this.byRole[r.role];
    if (!reply) throw new ModelError("non_transient", `no script for ${r.role}`);
    const x = reply(r);
    if (x instanceof Error) throw x;
    return { content: "", toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: null, ...x };
  }
}

let dir: string;
let db: Ledger;
let first: string;
let last: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-lessons-"));
  const out = join(dir, "sample");
  buildSample({ outDir: out, seed: 5, months: 0.6, engineers: 8, start: "2026-10-01" } as never);
  db = openLedger(":memory:");
  await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"));
  linkOutcomes(db, Object.keys(TEAM_OF_REPO).map((n) => join(sampleReposDir(out), n)), Date.parse("2026-12-01T00:00:00Z"));
  const r = db.prepare("SELECT MIN(substr(ts,1,10)) a, MAX(substr(ts,1,10)) b FROM model_call").get() as { a: string; b: string };
  first = r.a;
  last = r.b;
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a precedent in the planning request", () => {
  it("leaves the request exactly as it was when there are none, and shows each precedent's question and plan when there are", async () => {
    const seen: string[] = [];
    const port = new Scripted({
      ask_planner: (r) => {
        seen.push(String(r.messages[r.messages.length - 1]!.content));
        return { toolCalls: [{ id: "t", name: "plan_answer", arguments: { steps: [{ id: "s1", op: "spend", from: first, to: last, group: "none" }] } }] };
      },
      explainer: () => ({ content: "" }),
    });
    await ask({ db, question: "How much did we spend?", port, record: false });
    await ask({ db, question: "How much did we spend?", port, record: false, precedents: [{ id: "L-1", question: "How much did we spend between a and b?", program: program(first, last) }] });
    expect(seen[0]).not.toContain("verified answer");
    expect(seen[1]).toContain("Earlier questions of the same shape");
    expect(seen[1]).toContain("How much did we spend between a and b?");
    expect(seen[1]).toContain('"op":"spend"');
  });
});

describe("learning from mistakes, end to end on a constructed case", () => {
  it("finds a verified plan for a wrong answer, adds it in a round, keeps the round when held-out answers improve, and checks the lesson as a test", async () => {
    // The right figure for "total spend" is what the right plan gives; a plan on a single day gives something else.
    const right: AnswerProgram = program(first, last);
    const wrongPlan: AnswerProgram = program(first, first);
    const probe = await ask({
      db,
      question: "How much did we spend in total?",
      record: false,
      port: new Scripted({ ask_planner: () => ({ toolCalls: [{ id: "t", name: "plan_answer", arguments: right as unknown as Record<string, unknown> }] }), explainer: () => ({ content: "" }) }),
    });
    const figure = /\$([\d,]+\.\d\d)/.exec(probe.sentences.map((s) => s.text).join(" "));
    expect(figure, "the right plan states a dollar figure").not.toBeNull();
    const value = Number(figure![1]!.replace(/,/g, ""));
    const q = (id: string, text: string): Question => ({ id, category: "lookup", split: "dev", text, expect: { kind: "answer", required: [{ type: "usd", value, label: "total spend" }], allowed: [] } });
    const train = [q("T1", "How much did we spend in total? Give the dollar amount.")];
    const held = [q("H1", "How much did we spend overall in 2026? Give the dollar amount."), q("H2", "How much did we spend altogether in 2026? Give the dollar amount.")];

    // The planner is wrong unless it has been shown a precedent, or it is the third sampled attempt.
    const port = new Scripted({
      ask_planner: (r) => {
        const last = String(r.messages[r.messages.length - 1]!.content);
        const shown = last.includes("verified answer");
        const lucky = r.variant === 3;
        return { toolCalls: [{ id: "t", name: "plan_answer", arguments: (shown || lucky ? right : wrongPlan) as unknown as Record<string, unknown> }] };
      },
      explainer: () => ({ content: "" }),
    });
    const lessons = openLessons(":memory:");
    const baselineRows = held.map((x) => ({ qid: x.id, arm: "A2", trial: 0, exact: false, error: null }) as unknown as BenchRow);
    const trainingRows = [{ qid: "T1", arm: "A2", trial: 0, exact: false, error: null }] as unknown as BenchRow[];
    const report = await runLearning({ db, lessons, port, training: { questions: train, rows: trainingRows }, heldout: held, baseline: baselineRows, config: { roundSize: 1, maxRounds: 2, attempts: 4, concurrency: 1 }, now: () => "2026-10-23T00:00:00Z" });

    expect(report.mistakes).toBe(1);
    expect(report.resolved).toBe(1);
    expect(report.unresolved).toBe(0);
    const stored = allLessons(lessons);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ changeKind: "precedent", status: "accepted", attempts: 3, round: 1 });
    expect(report.rounds.map((r) => r.exact)).toEqual([0, 2]);
    expect(report.rounds[1]!.reverted).toBe(false);
    expect(report.rounds[1]!.change.change).toBeCloseTo(-1, 10);
    expect(allRounds(lessons)).toHaveLength(2);
  }, 120_000);

  it("keeps the round-0 result of a held-out question that is shown no precedent, and asks nothing again for it", async () => {
    const right: AnswerProgram = program(first, last);
    const probe = await ask({ db, question: "Total?", record: false, port: new Scripted({ ask_planner: () => ({ toolCalls: [{ id: "t", name: "plan_answer", arguments: right as unknown as Record<string, unknown> }] }), explainer: () => ({ content: "" }) }) });
    const value = Number(/\$([\d,]+\.\d\d)/.exec(probe.sentences.map((s) => s.text).join(" "))![1]!.replace(/,/g, ""));
    const q = (id: string, text: string): Question => ({ id, category: "lookup", split: "dev", text, expect: { kind: "answer", required: [{ type: "usd", value, label: "total spend" }], allowed: [] } });
    const train = [q("T1", "How much did we spend in total? Give the dollar amount.")];
    const unrelated = q("H9", "Which model cost the most last week?");
    let asked = 0;
    const port = new Scripted({ ask_planner: () => { asked += 1; return { toolCalls: [{ id: "t", name: "plan_answer", arguments: right as unknown as Record<string, unknown> }] }; }, explainer: () => ({ content: "" }) });
    const lessons = openLessons(":memory:");
    // The unrelated question is wrong in round 0. If it were asked again it would be right; the rule says it is not asked.
    const report = await runLearning({ db, lessons, port, training: { questions: train, rows: [{ qid: "T1", arm: "A2", trial: 0, exact: false, error: null }] as unknown as BenchRow[] }, heldout: [unrelated], baseline: [{ qid: "H9", arm: "A2", trial: 0, exact: false, error: null }] as unknown as BenchRow[], config: { roundSize: 1, maxRounds: 1, attempts: 1, concurrency: 1 }, now: () => "t" });
    expect(report.rounds[1]!.rows[0]).toMatchObject({ qid: "H9", exact: false, precedents: [] });
    expect(report.rounds[1]!.exact).toBe(0);
    // One planner call to find the lesson's plan; none for the held-out question.
    expect(asked).toBeLessThanOrEqual(2);
  }, 120_000);

  it("reverts a round that makes the held-out answers worse", async () => {
    const right: AnswerProgram = program(first, last);
    const wrongPlan: AnswerProgram = program(first, first);
    const probe = await ask({ db, question: "Total?", record: false, port: new Scripted({ ask_planner: () => ({ toolCalls: [{ id: "t", name: "plan_answer", arguments: right as unknown as Record<string, unknown> }] }), explainer: () => ({ content: "" }) }) });
    const value = Number(/\$([\d,]+\.\d\d)/.exec(probe.sentences.map((s) => s.text).join(" "))![1]!.replace(/,/g, ""));
    const q = (id: string, text: string): Question => ({ id, category: "lookup", split: "dev", text, expect: { kind: "answer", required: [{ type: "usd", value, label: "total spend" }], allowed: [] } });
    const train = [q("T1", "How much did we spend in total? Give the dollar amount.")];
    const held = [q("H1", "How much did we spend overall in 2026? Give the dollar amount.")];
    // Right with no precedent, wrong once the precedent is shown: the precedent misleads.
    const port = new Scripted({
      ask_planner: (r) => {
        const shown = String(r.messages[r.messages.length - 1]!.content).includes("verified answer");
        const luckyAttempt = r.variant === 1;
        return { toolCalls: [{ id: "t", name: "plan_answer", arguments: ((shown ? wrongPlan : luckyAttempt ? right : right) as AnswerProgram) as unknown as Record<string, unknown> }] };
      },
      explainer: () => ({ content: "" }),
    });
    const lessons = openLessons(":memory:");
    const baseline = [{ qid: "H1", arm: "A2", trial: 0, exact: true, error: null }] as unknown as BenchRow[];
    const report = await runLearning({ db, lessons, port, training: { questions: train, rows: [{ qid: "T1", arm: "A2", trial: 0, exact: false, error: null }] as unknown as BenchRow[] }, heldout: held, baseline, config: { roundSize: 1, maxRounds: 1, attempts: 2, concurrency: 1 }, now: () => "t" });
    expect(report.rounds[1]!.exact).toBe(0);
    expect(report.rounds[1]!.reverted).toBe(true);
    expect(allLessons(lessons)[0]!.status).toBe("reverted");
    expect(precedentsInForce(lessons)).toEqual([]);
  }, 120_000);
});
