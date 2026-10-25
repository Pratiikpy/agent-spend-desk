import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../../src/desk/agents/model.ts";
import { ask } from "../../../src/desk/ask/ask.ts";
import { verifyAnswerCommand } from "../../../src/desk/ask/command.ts";
import { perturbAnswer, perturbProgram, type StepRunner } from "../../../src/desk/ask/perturb.ts";
import { parseProgram, type AnswerProgram } from "../../../src/desk/ask/program.ts";
import { findJsonlLogs } from "../../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir } from "../../../src/desk/sample/gen.ts";

/**
 * Does an answer come from the ledger? A call costing a million dollars is added on the quietest day inside the dates an answer covers and the answer's steps run again: the figures
 * must move. A call is added outside every date and nothing may move. Both are rolled back. A hard-coded answer, or one that reads more than it says, is what this catches.
 */
type Reply = (r: ModelRequest) => Partial<ModelResponse> | Error;
class Scripted implements ModelPort {
  constructor(private readonly byRole: Record<string, Reply>) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
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
let models: string[];
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-perturb-"));
  const out = join(dir, "sample");
  buildSample({ outDir: out, seed: 5, months: 0.6, engineers: 8, start: "2026-10-01" } as never);
  db = openLedger(":memory:");
  await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"));
  const r = db.prepare("SELECT MIN(substr(ts,1,10)) a, MAX(substr(ts,1,10)) b FROM model_call").get() as { a: string; b: string };
  first = r.a;
  last = r.b;
  models = (db.prepare("SELECT model FROM model_call WHERE model NOT LIKE '<%' GROUP BY model ORDER BY COUNT(*) DESC").all() as { model: string }[]).map((m) => m.model);
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const program = (steps: unknown[]): AnswerProgram => {
  const p = parseProgram({ steps });
  if (!p.ok) throw new Error(p.issues.map((i) => `${i.path} ${i.message}`).join("; "));
  return p.value;
};
const spend = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ id, op: "spend", from, to, group: "none", ...extra });
const days = (from: string, n: number): string => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const counts = (): { calls: number; micros: number; sessions: number } => ({
  calls: (db.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n,
  micros: (db.prepare("SELECT COALESCE(SUM(total_micros), 0) s FROM cost_event").get() as { s: number }).s,
  sessions: (db.prepare("SELECT COUNT(*) n FROM session WHERE session_id = 'desk-perturbation'").get() as { n: number }).n,
});

describe("an answer built from the ledger", () => {
  it("moves when a call is added inside its dates, holds when one is added outside them, and leaves the ledger as it was", async () => {
    const before = counts();
    const r = await perturbProgram(db, program([spend("a", first, last)]));
    expect(r.verdict).toBe("pass");
    expect(r.inside?.moved).toEqual(["a"]);
    expect(r.outside?.moved).toEqual([]);
    expect(r.inside?.model).toBe(models[0]);
    expect(r.note).toMatch(/^A call costing a million dollars, added on the quietest day inside the answer's dates, moved a and nothing else/);
    expect(counts()).toEqual(before);
  });

  it("moves only the steps whose dates and model cover the call", async () => {
    const mid = days(first, 10);
    const r = await perturbProgram(db, program([spend("a", first, mid, { model: models[0] }), spend("b", days(mid, 1), last, { model: models[0] }), spend("c", first, last, { model: models[1] })]));
    expect(r.verdict).toBe("pass");
    // The row goes into the first spend step's own dates and on its model: step a moves, and b (other dates) and c (another model) hold.
    expect(r.inside?.moved).toEqual(["a"]);
    expect(r.inside?.held).toEqual(["b", "c"]);
    expect(r.expectedToMove).toEqual([]);
    expect(r.shouldHaveHeld).toEqual([]);
  });

  it("moves a figure worked out from a spend, because the spend it rests on moves", async () => {
    const r = await perturbProgram(db, program([spend("a", first, last), { id: "b", op: "per_day", of: "a" }]));
    expect(r.verdict).toBe("pass");
    expect(r.inside?.moved).toEqual(["a", "b"]);
  });

  it("is rolled back even when the steps fail, and leaves the next call free to use the same savepoint", async () => {
    const before = counts();
    const boom: StepRunner = async () => {
      throw new Error("a step blew up");
    };
    await expect(perturbProgram(db, program([spend("a", first, last)]), "x", boom)).rejects.toThrow(/blew up/);
    expect(counts()).toEqual(before);
    const again = await perturbProgram(db, program([spend("a", first, last)]));
    expect(again.verdict).toBe("pass");
    expect(counts()).toEqual(before);
  });
});

describe("an answer built from a ranking, a median or a count", () => {
  // A call of a dollar does not move the busiest session, the median day or a count of days over a figure; the first version of the check added a dollar and failed four of
  // fifty real answers of exactly these shapes. A call of a million dollars on the quietest day does.
  it("moves the most expensive single session, because the added call is the most expensive", async () => {
    const r = await perturbProgram(db, program([{ id: "a", op: "top_sessions", from: first, to: last, limit: 1 }]));
    expect(r.verdict).toBe("pass");
    expect(r.inside?.moved).toEqual(["a"]);
    expect(r.outside?.moved).toEqual([]);
  });

  it("moves the median daily spend, because the added call lifts the quietest day over it", async () => {
    const r = await perturbProgram(db, program([{ id: "a", op: "median_day", from: first, to: last, days: "active" }]));
    expect(r.verdict).toBe("pass");
    expect(r.inside?.moved).toEqual(["a"]);
  });

  it("moves a count of days over a figure, and a count of sessions started", async () => {
    const days = await perturbProgram(db, program([{ id: "a", op: "days_above", from: first, to: last, usd: 150 }]));
    expect(days.verdict).toBe("pass");
    const sessions = await perturbProgram(db, program([{ id: "a", op: "count_sessions", from: first, to: last }]));
    expect(sessions.verdict).toBe("pass");
    expect(sessions.inside?.moved).toEqual(["a"]);
  });

  it("moves how the spend landed, because the added session is spend with no commit", async () => {
    const r = await perturbProgram(db, program([{ id: "a", op: "landing", from: first, to: last }]));
    expect(r.verdict).toBe("pass");
  });
});

describe("an answer that is not built from the ledger", () => {
  /** The unperturbed steps' hashes, from the real run; a runner that ignores the ledger always returns the same ones. */
  const constant: StepRunner = async (_db, p) => new Map(p.steps.map((s) => [s.id, { resultHash: `fixed-${s.id}` }]));

  it("fails when the figures do not move for a call inside its dates: a hard-coded answer looks like this", async () => {
    const r = await perturbProgram(db, program([spend("a", first, last)]), "(hard-coded)", constant);
    expect(r.verdict).toBe("fail");
    expect(r.inside?.moved).toEqual([]);
    expect(r.note).toMatch(/moved no step: the answer is not reading the rows it says it reads/);
  });

  it("fails when a step moves for a call outside every date it covers: it reads more than it says", async () => {
    const leaky: StepRunner = async (d, p) => {
      const total = (d.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n;
      return new Map(p.steps.map((s) => [s.id, { resultHash: `all-calls-${total}` }]));
    };
    const r = await perturbProgram(db, program([spend("a", first, last)]), "(leaky)", leaky);
    expect(r.verdict).toBe("fail");
    expect(r.outside?.moved).toEqual(["a"]);
    expect(r.note).toMatch(/moved a: those steps read more than their dates/);
  });

  it("fails a spend step that covers the call and did not move, and one that moved for a call it does not cover", async () => {
    const only = (moves: string[]): StepRunner => async (d, p) => {
      const n = (d.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n;
      const inside = (d.prepare("SELECT COUNT(*) n FROM model_call WHERE substr(ts, 1, 4) = '2026' AND session_id = 'desk-perturbation' AND ts >= ?").get(`${first}T00:00:00Z`) as { n: number }).n > 0;
      return new Map(p.steps.map((s) => [s.id, { resultHash: moves.includes(s.id) && inside ? `moved-${n}` : "same" }]));
    };
    const mid = days(first, 10);
    const steps = [spend("a", first, mid), spend("b", days(mid, 1), last)];
    const missed = await perturbProgram(db, program(steps), "(missed)", only(["b"]));
    expect(missed.verdict).toBe("fail");
    expect(missed.expectedToMove).toEqual(["a"]);
    expect(missed.shouldHaveHeld).toEqual(["b"]);
  });

  it("does not run when there is nothing to read: a step with no dates, a ledger with no call in them", async () => {
    const recall = await perturbProgram(db, program([{ id: "r", op: "recall", query: "anything" }]));
    expect(recall.verdict).toBe("not_run");
    expect(recall.note).toMatch(/carry no dates/);
    const empty = await perturbProgram(db, program([spend("a", "2020-01-01", "2020-01-10")]));
    expect(empty.verdict).toBe("not_run");
    expect(empty.note).toMatch(/no model call inside the dates/);
  });
});

describe("a recorded answer", () => {
  it("is perturbed from its recorded program, and the command reports it beside the check that the steps still give the same results", async () => {
    const plan: Reply = () => ({ toolCalls: [{ id: "t1", name: "plan_answer", arguments: { steps: [spend("a", first, last)] } }] });
    const port = new Scripted({ ask_planner: plan, explainer: () => ({ content: JSON.stringify({ sentences: [{ text: "That is the spend.", cites: ["a.1"] }] }) }) });
    const r = await ask({ db, question: "How much did we spend?", port, record: true });
    const p = await perturbAnswer(db, r.answerId);
    expect(p).toMatchObject({ found: true, verdict: "pass", answerId: r.answerId });
    expect((await perturbAnswer(db, "ans-none")).found).toBe(false);
    // The command prints the unperturbed check and then the perturbation.
    const file = join(dir, "ledger.db");
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    const text = await verifyAnswerCommand(file, r.answerId, join(dir, "memory"), { perturb: true });
    expect(text).toMatch(/steps unchanged: a; changed: none/);
    expect(text).toMatch(/perturbation: pass\. A call costing a million dollars, added on the quietest day inside the answer's dates, moved a and nothing else/);
    expect(text).toMatch(/inside \(\d{4}-\d{2}-\d{2}, .+\): moved a; held none/);
    expect(text).toMatch(/outside \(\d{4}-\d{2}-\d{2}\): moved none; held a/);
    expect(await verifyAnswerCommand(file, r.answerId, join(dir, "memory"))).not.toMatch(/perturbation/);
  });
});
