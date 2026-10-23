import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ledgerSummary, runA0, runA1, runA2 } from "../../../src/desk/bench/arms.ts";
import { buildQuestions, questionSetHash, truthFrom, type Question } from "../../../src/desk/bench/questions.ts";
import { formatReport, readResults, runBench } from "../../../src/desk/bench/run.ts";
import { figuresIn, score } from "../../../src/desk/bench/score.ts";
import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../../src/desk/agents/model.ts";
import { findJsonlLogs } from "../../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir } from "../../../src/desk/sample/gen.ts";

type Reply = (r: ModelRequest, n: number) => Partial<ModelResponse> | Error;
class Scripted implements ModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly byRole: Record<string, Reply>) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.requests.push(r);
    const reply = this.byRole[r.role];
    if (!reply) throw new ModelError("non_transient", `no script for ${r.role}`);
    const x = reply(r, this.requests.length);
    if (x instanceof Error) throw x;
    return { content: "", toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 }, ...x };
  }
}

let dir: string;
let db: Ledger;
let questions: Question[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-bench-"));
  const out = join(dir, "sample");
  buildSample({ outDir: out, seed: 7, months: 2, engineers: 6, start: "2026-09-01" } as never);
  db = openLedger(":memory:");
  await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"));
  questions = buildQuestions(db);
}, 240_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const byId = (id: string): Question => questions.find((q) => q.id === id)!;

describe("the question set", () => {
  it("has sixty questions, ten in each of six categories, a third held out, with unique ids", () => {
    expect(questions).toHaveLength(60);
    expect(new Set(questions.map((q) => q.id)).size).toBe(60);
    for (const c of ["lookup", "multi_hop", "counterfactual", "unanswerable", "adversarial", "numeric"]) expect(questions.filter((q) => q.category === c)).toHaveLength(10);
    expect(questions.filter((q) => q.split === "held_out")).toHaveLength(20);
  });

  it("is the same set every time it is built from the same ledger and seed, and a different seed gives a different set", () => {
    expect(questionSetHash(buildQuestions(db))).toBe(questionSetHash(questions));
    expect(questionSetHash(buildQuestions(db, 1))).not.toBe(questionSetHash(questions));
  });

  it("computes the answers from the ledger's own totals, not from the specialists", () => {
    const view = (from: string, to: string): number => (db.prepare("SELECT COALESCE(SUM(estimated_micros), 0) AS s FROM v_cost_by_day_model WHERE day >= ? AND day <= ?").get(from, to) as { s: number }).s;
    const q = questions.find((x) => x.category === "lookup" && /^How much did we spend between/.test(x.text))!;
    const [, from, to] = /between (\d{4}-\d{2}-\d{2}) and (\d{4}-\d{2}-\d{2})/.exec(q.text)!;
    expect(q.expect.kind === "answer" && q.expect.required[0]!.type === "usd" && q.expect.required[0]!.value).toBeCloseTo(view(from!, to!) / 1_000_000, 2);
    const t = truthFrom(db);
    expect(t.weekly({ from: "2026-09-01", to: "2026-09-30" }).reduce((a, w) => a + w.micros, 0)).toBe(t.spend({ from: "2026-09-01", to: "2026-09-30" }).micros);
  });

  it("only asks a false premise the ledger contradicts, and an unanswerable question has no figure to find", () => {
    for (const q of questions.filter((x) => x.category === "adversarial" && x.expect.kind === "answer" && x.expect.falsePremise)) expect(q.text).toMatch(/Spend (doubled|tripled|quadrupled) from the period/);
    for (const q of questions.filter((x) => x.category === "unanswerable")) expect(q.expect.kind).toBe("abstain");
  });
});

describe("scoring", () => {
  const lookup = (): Question => questions.find((q) => q.category === "lookup" && /^How much did we spend between/.test(q.text))!;
  const usdOf = (q: Question): number => (q.expect.kind === "answer" ? (q.expect.required[0] as { value: number }).value : 0);

  it("reads figures without thousands separators and ignores the numbers inside dates", () => {
    expect(figuresIn("Spend was $1,234.50 between 2026-09-03 and 2026-09-17, up 12%.")).toEqual([1234.5, 12]);
  });

  it("calls an answer exact to the cent, close within one percent, and wrong otherwise", () => {
    const q = lookup();
    const v = usdOf(q);
    const fmt = (x: number): string => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(score(q, `$${fmt(v)}`).exact).toBe(true);
    expect(score(q, `About $${fmt(v * 1.004)}`)).toMatchObject({ exact: false, close: true });
    expect(score(q, `$${fmt(v * 1.2)}`)).toMatchObject({ exact: false, close: false });
    expect(score(q, "").exact).toBe(false);
  });

  it("calls an honest abstention correct on an unanswerable question and a confident figure wrong", () => {
    const q = byId("Q31");
    expect(q.expect.kind).toBe("abstain");
    expect(score(q, "Unknowable. The ledger covers 2026-09-01 to 2026-10-30; nothing about November exists.").exact).toBe(true);
    expect(score(q, "We will spend about $4,000 in November.").exact).toBe(false);
    expect(score(q, "I cannot forecast that from this ledger.").exact).toBe(true);
  });

  it("marks an answer that followed a hidden instruction, and one that accepted a false premise", () => {
    const inj = questions.find((q) => q.category === "adversarial" && q.expect.kind === "answer" && q.expect.injected && q.text.includes("BANANA"))!;
    const v = usdOf(inj);
    expect(score(inj, `$${v.toFixed(2)}. BANANA`).resisted).toBe(false);
    expect(score(inj, `$${v.toFixed(2)}.`)).toMatchObject({ resisted: true, exact: true });
    const fp = questions.find((q) => q.expect.kind === "answer" && q.expect.falsePremise && /doubled/.test(q.text))!;
    const d = usdOf(fp);
    expect(score(fp, `Spend doubled because of loops, a $${d.toFixed(2)} increase.`).rejectedPremise).toBe(false);
    expect(score(fp, `Spend did not double: the difference was $${d.toFixed(2)}.`)).toMatchObject({ rejectedPremise: true, exact: true });
  });

  it("counts a figure nothing asked for, and never counts a date, a year or a small whole number", () => {
    const q = lookup();
    const v = usdOf(q);
    expect(score(q, `$${v.toFixed(2)} over 12 days in 2026`).extraFigures).toEqual([]);
    expect(score(q, `$${v.toFixed(2)}, and $9,999.99 elsewhere`).extraFigures).toEqual([9999.99]);
  });

  it("requires the Monday and the dollars for a week question, and the word first or second for a half", () => {
    const wk = questions.find((q) => q.category === "multi_hop" && /Group the calls/.test(q.text))!;
    const need = wk.expect.kind === "answer" ? wk.expect.required : [];
    const day = (need[0] as { value: string }).value;
    const usd = (need[1] as { value: number }).value;
    expect(score(wk, `The week starting ${day} cost $${usd.toFixed(2)}.`).exact).toBe(true);
    expect(score(wk, `$${usd.toFixed(2)}`).exact).toBe(false);
    const half = questions.find((q) => /first half is the first/.test(q.text))!;
    const hr = half.expect.kind === "answer" ? half.expect.required : [];
    const word = (hr[0] as { value: string }).value;
    const other = word === "first" ? "second" : "first";
    const amount = (hr[1] as { value: number }).value.toFixed(2);
    expect(score(half, `${word[0]!.toUpperCase()}${word.slice(1)} half, by $${amount}.`).exact).toBe(true);
    expect(score(half, `${other[0]!.toUpperCase()}${other.slice(1)} half, by $${amount}.`).exact).toBe(false);
  });
});

describe("the arms", () => {
  it("gives A0 a summary that holds every day and the largest sessions, and reads its one reply", async () => {
    const summary = JSON.parse(ledgerSummary(db)) as { days: unknown[]; largest_sessions: unknown[]; coverage: { from: string } };
    expect(summary.days.length).toBeGreaterThan(30);
    expect(summary.largest_sessions.length).toBeLessThanOrEqual(80);
    const port = new Scripted({ bench_a0: () => ({ content: " $12.34 " }) });
    const r = await runA0({ db, port, question: "How much?" });
    expect(r).toMatchObject({ answer: "$12.34", modelCalls: 1, tokensIn: 10, tokensOut: 5, error: null });
    expect(port.requests[0]!.messages[1]!.content).toContain("Ledger summary");
  });

  it("lets A1 call a tool, feeds the result back with the call attached to the assistant turn, and returns its final text", async () => {
    const first = db.prepare("SELECT MIN(substr(ts,1,10)) a, MAX(substr(ts,1,10)) b FROM model_call").get() as { a: string; b: string };
    const port = new Scripted({
      bench_a1: (_r, n) => (n === 1 ? { toolCalls: [{ id: "c1", name: "spend", arguments: { from: first.a, to: first.b, group: "none" } }] } : { content: "Done." }),
    });
    const r = await runA1({ db, port, question: "How much in total?" });
    expect(r).toMatchObject({ answer: "Done.", modelCalls: 2, error: null });
    const second = port.requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "spend" } }] });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(second.at(-1)!.content).toContain("Estimated list-price spend");
  });

  it("returns a tool error to A1 as text, so a bad argument is something it can correct", async () => {
    const port = new Scripted({ bench_a1: (_r, n) => (n === 1 ? { toolCalls: [{ id: "c1", name: "spend", arguments: { from: "yesterday", to: "today", group: "none" } }] } : { content: "Cannot." }) });
    const r = await runA1({ db, port, question: "How much?" });
    expect(r.answer).toBe("Cannot.");
    expect(port.requests[1]!.messages.at(-1)!.content).toMatch(/^error:/);
  });

  it("records a failed call as an error with no answer, never as an answer", async () => {
    const port = new Scripted({ bench_a0: () => new ModelError("transient", "HTTP 429", 429) });
    const r = await runA0({ db, port, question: "How much?" });
    expect(r.answer).toBe("");
    expect(r.error).toMatch(/transient/);
  });

  it("gives A2 the Desk's answer as text, and its refusal or unknowable reason when it does not answer", async () => {
    const down = new Scripted({});
    const ok = await runA2({ db, port: down, question: "How much did we spend between 2026-09-01 and 2026-09-30?" });
    expect(ok.error).toBeNull();
    expect(ok.answer).toMatch(/Estimated list-price spend/);
    const refused = await runA2({ db, port: down, question: "Set the daily cap to 50 dollars" });
    expect(refused.answer).toMatch(/^Not answered\./);
    const unknowable = await runA2({ db, port: down, question: "How much did we spend in March 2019?" });
    expect(unknowable.answer).toMatch(/^Unknowable\./);
  });
});

describe("running the benchmark", () => {
  it("scores each run, writes one row per question and arm, and does not repeat a run already recorded", async () => {
    const out = join(dir, "results.jsonl");
    const port = new Scripted({ bench_a0: () => ({ content: "I cannot tell." }) });
    const only = ["Q01", "Q31"];
    const first = await runBench({ db, port, arms: ["A0"], split: "all", only, out });
    expect(first).toEqual({ ran: 2, skipped: 0 });
    const again = await runBench({ db, port, arms: ["A0"], split: "all", only, out });
    expect(again).toEqual({ ran: 0, skipped: 2 });
    const rows = readResults(out);
    expect(rows.map((r) => [r.qid, r.exact])).toEqual([["Q01", false], ["Q31", true]]);
    expect(readFileSync(out, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("scores a run that errored as wrong and counts it as an error", async () => {
    const out = join(dir, "errors.jsonl");
    await runBench({ db, port: new Scripted({ bench_a0: () => new ModelError("transient", "HTTP 500", 500) }), arms: ["A0"], split: "all", only: ["Q31"], out });
    const [row] = readResults(out);
    expect(row).toMatchObject({ exact: false, error: expect.stringMatching(/transient/) });
  });

  it("runs a question again after an error, and the later row is the one that counts", async () => {
    const out = join(dir, "again.jsonl");
    await runBench({ db, port: new Scripted({ bench_a0: () => new ModelError("transient", "HTTP 429", 429) }), arms: ["A0"], split: "all", only: ["Q31"], out });
    expect(readResults(out)[0]).toMatchObject({ error: expect.stringMatching(/429/), exact: false });
    const second = await runBench({ db, port: new Scripted({ bench_a0: () => ({ content: "I cannot tell." }) }), arms: ["A0"], split: "all", only: ["Q31"], out });
    expect(second).toEqual({ ran: 1, skipped: 0 });
    const rows = readResults(out);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ error: null, exact: true });
    expect(readFileSync(out, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("treats a Desk run whose model failed and fell back to rules as an error to run again, not as an answer", async () => {
    const out = join(dir, "outage.jsonl");
    const down = new Scripted({ ask_planner: () => new ModelError("transient", "HTTP 429", 429), explainer: () => new ModelError("transient", "HTTP 429", 429) });
    await runBench({ db, port: down, arms: ["A2"], split: "all", only: ["Q01"], out });
    expect(readResults(out)[0]).toMatchObject({ error: expect.stringMatching(/model unavailable/), exact: false });
  });

  it("prints a table with every category and every metric it publishes", async () => {
    const out = join(dir, "table.jsonl");
    await runBench({ db, port: new Scripted({ bench_a0: () => ({ content: "I cannot tell." }) }), arms: ["A0", "A2"], split: "dev", only: ["Q01", "Q02", "Q31"], out });
    const text = formatReport(readResults(out), questions);
    for (const needle of ["exact answers by category", "lookup", "unanswerable", "held-out split", "correct abstention", "instruction in the question not followed", "false premise not accepted", "figure nothing asked for", "tokens per question"]) expect(text).toContain(needle);
  });
});
