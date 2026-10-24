import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ask, type AskResult } from "../../src/desk/ask/ask.ts";
import { parseProgram } from "../../src/desk/ask/program.ts";
import { critiquePlan } from "../../src/desk/ask/plan-critic.ts";
import { rulePlan } from "../../src/desk/ask/plan-rules.ts";
import type { ModelPort, ModelRequest, ModelResponse } from "../../src/desk/agents/model.ts";
import { findJsonlLogs } from "../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir, sampleReposDir } from "../../src/desk/sample/gen.ts";
import { TEAM_OF_REPO } from "../../src/desk/silo/seed.ts";

class Scripted implements ModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly program: unknown) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.requests.push(r);
    const toolCalls = r.role === "ask_planner" ? [{ id: "t1", name: "plan_answer", arguments: this.program as Record<string, unknown> }] : [];
    return { content: "", toolCalls, servedBy: "other", servedModel: "scripted", source: "live", usage: null };
  }
}

let dir: string;
let db: Ledger;
let first: string;
let last: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-ops-"));
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

const run = (question: string, port: ModelPort | null = null): Promise<AskResult> => ask({ db, question, port, record: false });
const text = (r: AskResult): string => r.sentences.map((s) => s.text).join(" ");
const addDay = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dollars = (micros: number): string => (Math.round(micros / 10_000) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The day totals the ground truth also uses: priced calls only, grouped by calendar day. */
function dailyMicros(from: string, to: string): number[] {
  const rows = db.prepare("SELECT substr(m.ts, 1, 10) AS d, SUM(c.total_micros) AS s FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'estimated' AND m.ts >= ? AND m.ts < ? GROUP BY d ORDER BY d").all(from, `${addDay(to, 1)}`) as unknown as { d: string; s: number }[];
  return rows.map((r) => r.s);
}
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

describe("median_day: the median daily spend, worked out by code", () => {
  it("is refused by the schema unless the days it counts are named", () => {
    expect(parseProgram({ steps: [{ id: "a", op: "median_day", from: "2026-10-01", to: "2026-10-09", days: "active" }] }).ok).toBe(true);
    expect(parseProgram({ steps: [{ id: "a", op: "median_day", from: "2026-10-01", to: "2026-10-09" }] }).ok).toBe(false);
    expect(parseProgram({ steps: [{ id: "a", op: "median_day", from: "2026-10-09", to: "2026-10-01", days: "all" }] }).ok).toBe(false);
    expect(parseProgram({ steps: [{ id: "a", op: "median_day", from: "2026-10-01", to: "2026-10-09", days: "some" }] }).ok).toBe(false);
  });

  it("gives the middle day for an odd number of days and the mean of the two middle days for an even number", async () => {
    // Find one range with an odd count of days that have spend and one with an even count.
    const cases: { to: string; days: number[] }[] = [];
    for (let k = 6; k < 16 && cases.length < 2; k += 1) {
      const to = addDay(first, k);
      const days = dailyMicros(first, to);
      if (cases.length === 0 || days.length % 2 !== cases[0]!.days.length % 2) cases.push({ to, days });
    }
    expect(cases).toHaveLength(2);
    for (const { to, days } of cases) {
      const r = await run("median", new Scripted({ steps: [{ id: "m", op: "median_day", from: first, to, days: "active" }] }));
      expect(r.status).toBe("answered");
      expect(r.steps[0]?.claims[0]?.text).toContain(`$${dollars(median(days))}`);
      expect(r.steps[0]?.claims.map((c) => c.text).join(" ")).toContain(`${days.length} days`);
    }
  });

  it("counts days with no spend only when asked to, and only days the ledger covers", async () => {
    const withSpend = dailyMicros(first, last);
    const covered = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000 + 1;
    const zeros = covered - withSpend.length;
    const r = await run("median", new Scripted({ steps: [{ id: "m", op: "median_day", from: first, to: last, days: "active" }, { id: "n", op: "median_day", from: addDay(first, -4), to: addDay(last, 5), days: "all" }] }));
    expect(r.steps[0]?.claims[0]?.text).toContain(`$${dollars(median(withSpend))}`);
    // Days before the ledger starts and after it ends were not recorded; they are not zero-spend days and must not move the median.
    const all = [...withSpend, ...Array<number>(zeros).fill(0)];
    expect(r.steps[1]?.claims.map((c) => c.text).join(" ")).toContain(`$${dollars(median(all))}`);
    expect(r.steps[1]?.data).toMatchObject({ daysCounted: covered });
    expect(zeros).toBeGreaterThan(0);
  });

  it("says plainly when the range holds no priced calls, and states no figure", async () => {
    const r = await run("median", new Scripted({ steps: [{ id: "m", op: "median_day", from: "2019-03-01", to: "2019-03-09", days: "active" }] }));
    expect(r.status).toBe("unknowable");
    expect(r.steps[0]?.claims.some((c) => /\$\d/.test(c.text))).toBe(false);
  });
});

describe("count_sessions: how many sessions started", () => {
  const started = (from: string, to: string): number => (db.prepare("SELECT COUNT(*) AS n FROM (SELECT session_id, MIN(substr(ts, 1, 10)) AS d FROM model_call GROUP BY session_id) WHERE d >= ? AND d <= ?").get(from, to) as { n: number }).n;

  it("counts a session on the day of its first logged model call", async () => {
    const to = addDay(first, 6);
    const want = started(first, to);
    expect(want).toBeGreaterThan(0);
    const r = await run("sessions", new Scripted({ steps: [{ id: "c", op: "count_sessions", from: first, to }] }));
    expect(r.status).toBe("answered");
    expect(r.steps[0]?.claims[0]?.text).toContain(`${want} session`);
    expect(r.steps[0]?.claims.map((c) => c.text).join(" ")).toMatch(/first logged model call/);
  });

  it("answers zero inside the ledger's coverage, and says nothing was recorded outside it", async () => {
    const inside = await run("sessions", new Scripted({ steps: [{ id: "c", op: "count_sessions", from: first, to: first }, { id: "d", op: "spend", from: first, to: last, group: "none" }] }));
    expect(inside.steps[0]?.claims[0]?.text).toContain(`${started(first, first)} session`);
    const outside = await run("sessions", new Scripted({ steps: [{ id: "c", op: "count_sessions", from: "2019-01-01", to: "2019-01-31" }] }));
    expect(outside.status).toBe("unknowable");
  });
});

describe("a spend step for one model counts as one total, however the Planner grouped it", () => {
  const model = (): string => (db.prepare("SELECT m.model AS k FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.model NOT LIKE '<%' GROUP BY m.model ORDER BY SUM(c.total_micros) DESC").get() as { k: string }).k;

  it("accepts group model with a model named, and still refuses group model without one", () => {
    const m = model();
    const prog = (g: string, named: boolean) => ({ steps: [{ id: "a", op: "spend", from: "2026-10-01", to: "2026-10-09", group: g, ...(named ? { model: m } : {}) }, { id: "b", op: "spend", from: "2026-10-01", to: "2026-10-09", group: "none" }, { id: "c", op: "share", part: "a", whole: "b" }] });
    expect(parseProgram(prog("model", true)).ok).toBe(true);
    expect(parseProgram(prog("none", true)).ok).toBe(true);
    expect(parseProgram(prog("model", false)).ok).toBe(false);
    expect(parseProgram(prog("day", true)).ok).toBe(false);
  });

  it("works out the same share either way", async () => {
    const m = model();
    const mk = (g: string) => ({ steps: [{ id: "a", op: "spend", from: first, to: last, group: g, model: m }, { id: "b", op: "spend", from: first, to: last, group: "none" }, { id: "c", op: "share", part: "a", whole: "b" }] });
    const x = await run("share", new Scripted(mk("model")));
    const y = await run("share", new Scripted(mk("none")));
    expect(x.steps[2]?.claims[0]?.text).toBe(y.steps[2]?.claims[0]?.text);
    expect(x.steps[2]?.claims[0]?.text).toMatch(/^The part was \d+\.\d% of the whole\.$/);
  });
});

describe("a comparison names the higher period first", () => {
  const cmp = (a: [string, string], b: [string, string]) => ({ steps: [{ id: "a", op: "spend", from: a[0], to: a[1], group: "none" }, { id: "b", op: "spend", from: b[0], to: b[1], group: "none" }, { id: "c", op: "compare", a: "a", b: "b" }] });

  it("says the first period cost more when it did, and the second when it did", async () => {
    const mid = addDay(first, 9);
    const aLen = [first, mid] as [string, string];
    const bLen = [addDay(mid, 1), addDay(mid, 10)] as [string, string];
    const micros = (r: [string, string]) => dailyMicros(r[0], r[1]).reduce((x, y) => x + y, 0);
    const forward = await run("compare", new Scripted(cmp(aLen, bLen)));
    const backward = await run("compare", new Scripted(cmp(bLen, aLen)));
    const higherFirst = micros(aLen) > micros(bLen);
    const f = forward.steps[2]!.claims[0]!.text;
    const b = backward.steps[2]!.claims[0]!.text;
    expect(f).toBe(`The ${higherFirst ? "first" : "second"} period cost $${dollars(Math.abs(micros(aLen) - micros(bLen)))} more than the ${higherFirst ? "second" : "first"}.`);
    expect(b).toBe(`The ${higherFirst ? "second" : "first"} period cost $${dollars(Math.abs(micros(aLen) - micros(bLen)))} more than the ${higherFirst ? "first" : "second"}.`);
    expect(f).not.toMatch(/ less than /);
  });

  it("reports equal periods as equal", async () => {
    const r = await run("compare", new Scripted(cmp([first, first], [first, first])));
    expect(r.steps[2]?.claims[0]?.text).toMatch(/^Both periods cost \$/);
  });
});

describe("the figure that was asked for comes first", () => {
  it("puts a derived step's sentence before the totals it rests on, and leaves a plain lookup alone", async () => {
    const m = (db.prepare("SELECT m.model AS k FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.model NOT LIKE '<%' GROUP BY m.model ORDER BY SUM(c.total_micros) DESC").get() as { k: string }).k;
    const steps = [{ id: "a", op: "spend", from: first, to: last, group: "none", model: m }, { id: "b", op: "spend", from: first, to: last, group: "none" }, { id: "c", op: "share", part: "a", whole: "b" }];
    const r = await run("share", new Scripted({ steps }));
    expect(r.sentences[0]?.text).toMatch(/^The part was \d+\.\d% of the whole\.$/);
    expect(r.sentences.length).toBeGreaterThan(1);
    const plain = await run("spend", new Scripted({ steps: [steps[1]] }));
    expect(plain.sentences[0]?.text).toMatch(/^Estimated list-price spend between/);
  });
});

describe("the plan critic and the rule planner know the new steps", () => {
  const program = (...ops: string[]) => ({ steps: ops.map((op, i) => ({ id: `s${i}`, op, from: "2026-10-01", to: "2026-10-09", group: "none", days: "active" })) }) as never;

  it("asks for a median_day step when the question asks for a median, and for count_sessions when it asks how many sessions", () => {
    expect(critiquePlan("What was the median daily spend between 2026-10-01 and 2026-10-09?", program("spend"))[0]).toMatch(/median_day/);
    expect(critiquePlan("What was the median daily spend between 2026-10-01 and 2026-10-09?", program("median_day"))).toEqual([]);
    expect(critiquePlan("How many sessions started between 2026-10-01 and 2026-10-09?", program("spend"))[0]).toMatch(/count_sessions/);
    expect(critiquePlan("How many sessions started between 2026-10-01 and 2026-10-09?", program("count_sessions"))).toEqual([]);
    expect(critiquePlan("How many sessions are expensive?", program("count_sessions"))).toEqual([]);
  });

  it("plans a share, a median and a session count without a model", () => {
    const cov = { start: first, end: last };
    const share = rulePlan(`What share of spend between ${first} and ${last} was on claude-opus-5? Answer as a percentage to one decimal.`, cov, ["claude-opus-5"]);
    expect(share.program?.steps.map((s) => s.op)).toEqual(["spend", "spend", "share"]);
    const med = rulePlan(`What was the median daily spend between ${first} and ${addDay(first, 8)}, counting only days with any spend?`, cov, []);
    expect(med.program?.steps[0]).toMatchObject({ op: "median_day", days: "active" });
    const all = rulePlan(`What was the median daily spend between ${first} and ${addDay(first, 8)}, counting every day?`, cov, []);
    expect(all.program?.steps[0]).toMatchObject({ op: "median_day", days: "all" });
    const sessions = rulePlan(`How many sessions started between ${first} and ${addDay(first, 8)}?`, cov, []);
    expect(sessions.program?.steps[0]).toMatchObject({ op: "count_sessions", from: first });
  });

  it("answers those three from the ledger with the rule planner alone", async () => {
    const m = (db.prepare("SELECT m.model AS k FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.model NOT LIKE '<%' GROUP BY m.model ORDER BY SUM(c.total_micros) DESC").get() as { k: string }).k;
    const share = await run(`What share of spend between ${first} and ${last} was on ${m}? Answer as a percentage to one decimal.`);
    expect(text(share)).toMatch(/\d+\.\d% of the whole/);
    const med = await run(`What was the median daily spend between ${first} and ${addDay(first, 8)}, counting only days with any spend?`);
    expect(text(med)).toContain(`$${dollars(median(dailyMicros(first, addDay(first, 8))))}`);
    const sessions = await run(`How many sessions started between ${first} and ${addDay(first, 6)}?`);
    expect(sessions.status).toBe("answered");
  });

  it("tells the Planner about the new steps", async () => {
    const port = new Scripted({ steps: [{ id: "a", op: "spend", from: first, to: last, group: "none" }] });
    await run("How much did we spend?", port);
    const system = port.requests.find((r) => r.role === "ask_planner")?.messages[0]?.content ?? "";
    expect(system).toMatch(/median_day/);
    expect(system).toMatch(/count_sessions/);
  });
});
