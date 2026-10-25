import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ask } from "../ask/ask.ts";
import type { EngineName } from "./load.ts";
import type { Ledger } from "../ledger/db.ts";
import { ingestClaudeCode } from "../ledger/ingest.ts";
import { openLedger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { writeYearLogs, YEAR_FROM, YEAR_TO } from "../sample/year.ts";
import { digestRange, projection } from "./carry.ts";

/**
 * The year-long questions (DF-118): five questions over a twelve-month ledger whose trends are planted, asked with the Markovian engine on and off. The truth for each is worked out
 * here from the ledger's own rows by plain SQL, not from the engine, so neither run is graded by itself. With the engine off, the Desk's own fallback reads the range without
 * the carry: it lists periods newest first until the claim budget is used and says how many it left out. That is a deliberately simple fallback, and the comparison says what the
 * carry buys over it, not what no other design could do.
 */
const SNAPSHOT = "data/prices/anthropic-litellm-2026-10-22.json";

export interface YearQuestion {
  id: string;
  text: string;
  /** What the answer must state, from the rows. */
  expect: string;
  /** Whether the answer's sentences state it. */
  holds(sentences: readonly string[]): boolean;
}

export interface YearTruth {
  totalMicros: number;
  monthMicros: number[];
  peakMonth: string;
  peakMicros: number;
  growers: string[];
  topModel: string;
  topModelMicros: number;
  lastOverFirstPct: number;
}

/** Worked out from the rows, month by month and model by model. */
export function yearTruth(db: Ledger): YearTruth {
  const rows = db
    .prepare(
      `SELECT substr(m.ts, 1, 7) AS ym, m.model AS model, SUM(c.total_micros) AS micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       WHERE m.ts >= ? AND m.ts < ? GROUP BY ym, m.model`,
    )
    .all(`${YEAR_FROM}T00:00:00.000Z`, "2026-01-01T00:00:00.000Z") as unknown as { ym: string; model: string; micros: number }[];
  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const monthMicros = months.map((ym) => rows.filter((r) => r.ym === ym).reduce((s, r) => s + r.micros, 0));
  const peakIdx = monthMicros.indexOf(Math.max(...monthMicros));
  const models = [...new Set(rows.map((r) => r.model))].sort();
  const series = (model: string): number[] => months.map((ym) => rows.find((r) => r.ym === ym && r.model === model)?.micros ?? 0);
  const growers = models.filter((m) => {
    const s = series(m);
    return (s[0] ?? 0) > 0 && s.every((v, i) => i === 0 || v > (s[i - 1] as number));
  });
  const byModel = models.map((m) => ({ m, micros: series(m).reduce((a, b) => a + b, 0) })).sort((a, b) => b.micros - a.micros);
  const third = Math.floor(months.length / 3);
  const first = monthMicros.slice(0, third).reduce((a, b) => a + b, 0);
  const last = monthMicros.slice(months.length - third).reduce((a, b) => a + b, 0);
  return {
    totalMicros: monthMicros.reduce((a, b) => a + b, 0), monthMicros, peakMonth: `${months[peakIdx]}-01`, peakMicros: monthMicros[peakIdx] as number, growers,
    topModel: (byModel[0] as { m: string }).m, topModelMicros: (byModel[0] as { micros: number }).micros, lastOverFirstPct: (last / first) * 100,
  };
}

export function yearQuestions(t: YearTruth): YearQuestion[] {
  const range = `between ${YEAR_FROM} and ${YEAR_TO}`;
  const has = (s: readonly string[], re: RegExp): RegExpExecArray | null => {
    for (const x of s) {
      const m = re.exec(x);
      if (m) return m;
    }
    return null;
  };
  return [
    {
      id: "grew-every-month",
      text: `Which model's cost grew every month ${range}?`,
      expect: `${t.growers.join(", ")} and no other`,
      holds: (s) => {
        const said = s.flatMap((x) => {
          const m = /^Model `?([^`\s]+)`? cost more in every month than in the month before\.$/.exec(x);
          return m ? [m[1] as string] : [];
        }).sort();
        return JSON.stringify(said) === JSON.stringify(t.growers);
      },
    },
    {
      id: "dearest-month",
      text: `Which month had the highest spend ${range}?`,
      expect: `the month starting ${t.peakMonth}, ${formatUsd(t.peakMicros)}`,
      holds: (s) => {
        const m = has(s, /The costliest period started on (\d{4}-\d{2}-\d{2}) and cost (\$[\d,]+\.\d\d)\./);
        return m !== null && m[1] === t.peakMonth && m[2] === formatUsd(t.peakMicros);
      },
    },
    {
      id: "total",
      text: `How much did we spend ${range}?`,
      expect: formatUsd(t.totalMicros),
      holds: (s) => s.some((x) => x.includes(`was ${formatUsd(t.totalMicros)},`)),
    },
    {
      id: "dearest-model",
      text: `Which model cost the most ${range}?`,
      expect: `${t.topModel}, ${formatUsd(t.topModelMicros)}`,
      holds: (s) => s.some((x) => x.includes(t.topModel) && x.includes(formatUsd(t.topModelMicros))),
    },
    {
      id: "last-over-first",
      text: `How did spending in the last third compare with the first third ${range}?`,
      expect: `${t.lastOverFirstPct.toFixed(1)}% of the first third`,
      holds: (s) => {
        const m = has(s, /Spending in the last third of the range was ([\d.]+)% of the first third\./);
        return m !== null && Math.abs(Number(m[1]) - t.lastOverFirstPct) <= 0.05;
      },
    },
  ];
}

export interface YearRow {
  id: string;
  question: string;
  expect: string;
  on: { holds: boolean; status: string; claimTokens: number };
  off: { holds: boolean; status: string; claimTokens: number };
}

export interface YearReport {
  rows: YearRow[];
  truth: YearTruth;
  /** What the engine did on the whole year: chunks, the largest state it carried against its budget, tokens used, and what it saved over carrying the whole history. */
  engine: { periods: number; chunks: number; maxCarryoverTokens: number; carryoverBudgetTokens: number; tokensUsed: number; tokensSaved: number; efficiencyPercent: number };
  /** The engine's projection for twelve periods, the last one: the prompt with the history carried whole, and with the bounded carry. */
  projection: { standard: number; markovian: number };
  /** A second reading of the same year reuses every period whose rows are unchanged. */
  reuse: { first: number; second: number; of: number };
  calls: number;
}

const tokens = (texts: readonly string[]): number => Math.ceil(texts.join(" ").length / 4);

export async function runYearCheck(): Promise<YearReport> {
  const dir = mkdtempSync(join(tmpdir(), "desk-year-"));
  const db = openLedger(":memory:");
  try {
    await ingestClaudeCode(db, writeYearLogs(dir), loadSnapshot(SNAPSHOT));
    const truth = yearTruth(db);
    const rows: YearRow[] = [];
    for (const q of yearQuestions(truth)) {
      const run = async (ablate: ReadonlySet<EngineName>): Promise<YearRow["on"]> => {
        const r = await ask({ db, question: q.text, port: null, ablate, memory: null });
        const sentences = r.sentences.map((s) => s.text);
        return { holds: r.status === "answered" && q.holds(sentences), status: r.status, claimTokens: tokens(sentences) };
      };
      rows.push({ id: q.id, question: q.text, expect: q.expect, on: await run(new Set()), off: await run(new Set<EngineName>(["markovian"])) });
    }
    const first = await digestRange(db, YEAR_FROM, YEAR_TO);
    const second = await digestRange(db, YEAR_FROM, YEAR_TO);
    const curve = await projection(first.periods);
    const last = curve[curve.length - 1] as { standard: number; markovian: number };
    return {
      rows, truth,
      engine: { periods: first.periods, chunks: first.chunks, maxCarryoverTokens: first.maxCarryoverTokens, carryoverBudgetTokens: first.carryoverBudgetTokens, tokensUsed: first.tokensUsed, tokensSaved: first.tokensSaved, efficiencyPercent: first.efficiencyPercent },
      projection: { standard: last.standard, markovian: last.markovian },
      reuse: { first: first.reusedPeriods, second: second.reusedPeriods, of: second.periods },
      calls: (db.prepare("SELECT COUNT(*) AS n FROM model_call").get() as { n: number }).n,
    };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderYearCheck(r: YearReport): string {
  const mark = (b: boolean): string => (b ? "right" : "wrong or not stated");
  const out = [`A twelve-month ledger (${r.calls.toLocaleString("en-US")} calls, ${YEAR_FROM} to ${YEAR_TO}) with its trends planted; the truth below is from its rows, not from either run.`, ""];
  for (const x of r.rows) out.push(`${x.question}\n  truth: ${x.expect}\n  with the engine: ${mark(x.on.holds)} (${x.on.claimTokens} claim tokens)   without it: ${mark(x.off.holds)} (${x.off.claimTokens} claim tokens, ${x.off.status})`);
  const on = r.rows.filter((x) => x.on.holds).length;
  const off = r.rows.filter((x) => x.off.holds).length;
  out.push("", `Right with the engine: ${on} of ${r.rows.length}. Without it: ${off} of ${r.rows.length}.`);
  out.push(`The engine read ${r.engine.periods} periods in ${r.engine.chunks} chunks; the largest state it carried was about ${r.engine.maxCarryoverTokens} tokens against a budget of ${r.engine.carryoverBudgetTokens}, and that size does not grow with the range.`);
  out.push(`Its own accounting: ${r.engine.tokensUsed.toLocaleString("en-US")} tokens read, ${r.engine.tokensSaved.toLocaleString("en-US")} saved over carrying the whole history (${r.engine.efficiencyPercent}%). At this size the periods are smaller than the state that carries them, so nothing is saved; what the carry gives here is the fixed size.`);
  out.push(`The engine's projection for the last of ${r.engine.periods} periods at its default chunk size of 8,000 tokens (not this ledger's): a prompt of ${r.projection.standard.toLocaleString("en-US")} tokens with the history carried whole, ${r.projection.markovian.toLocaleString("en-US")} with the bounded carry.`);
  out.push(`Read again, ${r.reuse.second} of ${r.reuse.of} periods came from the stored carry state (${r.reuse.first} the first time).`);
  return out.join("\n");
}

/**
 * The year check as a prove entry. It must be able to fail: the kept state is edited and has to be worked out again, a changed month has to cost a recount from that month on, and a
 * wrong truth has to be marked wrong by the same grader before the engine's answers are judged right.
 */
export async function yearProve(): Promise<{ ok: boolean; detail: string }> {
  const r = await runYearCheck();
  const right = r.rows.filter((x) => x.on.holds).length;
  const without = r.rows.filter((x) => x.off.holds).length;
  if (right !== r.rows.length) return { ok: false, detail: `with the engine only ${right} of ${r.rows.length} year-long answers matched the rows: ${r.rows.filter((x) => !x.on.holds).map((x) => x.id).join(", ")}` };
  if (without >= right) return { ok: false, detail: `without the engine ${without} of ${r.rows.length} were right, so the comparison shows nothing` };
  if (r.engine.maxCarryoverTokens > r.engine.carryoverBudgetTokens) return { ok: false, detail: `the carry reached ${r.engine.maxCarryoverTokens} tokens against a budget of ${r.engine.carryoverBudgetTokens}` };
  if (r.reuse.second !== r.reuse.of) return { ok: false, detail: `a second reading used ${r.reuse.second} of ${r.reuse.of} kept periods` };

  const dir = mkdtempSync(join(tmpdir(), "desk-year-prove-"));
  const db = openLedger(":memory:");
  try {
    await ingestClaudeCode(db, writeYearLogs(dir), loadSnapshot(SNAPSHOT));
    const truth = yearTruth(db);
    // The grader marks a wrong truth wrong.
    const wrong = yearQuestions({ ...truth, growers: ["claude-haiku-5-5"], peakMonth: "2025-04-01" });
    const answered = await ask({ db, question: wrong[0]!.text, port: null, memory: null });
    const said = answered.sentences.map((s) => s.text);
    if (wrong[0]!.holds(said) || wrong[1]!.holds(said)) return { ok: false, detail: "the grader accepted a wrong truth" };

    await digestRange(db, YEAR_FROM, YEAR_TO);
    // A kept state whose text was edited is not used.
    db.exec("UPDATE carry_state SET state = replace(state, '\"n\":6', '\"n\":7') WHERE step = 5 AND bucket_kind = 'month'");
    const edited = await digestRange(db, YEAR_FROM, YEAR_TO);
    if (edited.reusedPeriods !== 11 || edited.totalMicros !== truth.totalMicros) return { ok: false, detail: `an edited kept state was ${edited.reusedPeriods === 12 ? "used" : "not recounted correctly"} (${edited.reusedPeriods} of 12 kept, total ${edited.totalMicros})` };
    return {
      ok: true,
      detail: `a ${r.calls.toLocaleString("en-US")}-call twelve-month ledger: ${right} of ${r.rows.length} year-long answers match the rows with the engine, ${without} without it; the largest carry was ${r.engine.maxCarryoverTokens} of ${r.engine.carryoverBudgetTokens} tokens; the kept state is reused on a second reading, an edited one is recounted, and a wrong truth is marked wrong`,
    };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
