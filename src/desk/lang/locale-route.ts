import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { BudgetError } from "../agents/budget.ts";
import { ModelError, type ChatMessage, type ModelPort } from "../agents/model.ts";
import { completeOwn } from "../agents/own-calls.ts";
import { Rng } from "../canary/rng.ts";
import { numbersIn, TASKS, type CanaryTask } from "../canary/tasks.ts";

/**
 * The locale route experiment (DF-043). The surcharge says a prompt in another script costs more tokens than the same prompt in English. One way to avoid it is a route that
 * translates the instruction into English, does the work in English and translates the answer back. Whether that route is worth taking is a question of two things, and each is
 * measured here against the same checkers the canary uses: whether the answers stay right, and whether the tokens go down. The route is judged like any other cheaper route, by a
 * paired difference with an interval that resamples the tasks in clusters, against a margin, and only when the model can do the tasks in English in the first place.
 *
 * Three arms run on one model. `english` is the original task and shows what the model can do; it is the reproduction gate. `direct` sends the task written in another language.
 * `translate` sends that task to a translation call, the English to the work call, and the answer to a translation call back. Nothing here says the route helps: a route that costs
 * more tokens than it saves, or that loses answers, is reported as that.
 */
export type Lang = "ja" | "hi";
export const LANGS: Record<Lang, { name: string; script: string }> = {
  ja: { name: "Japanese", script: "Japanese (kana)" },
  hi: { name: "Hindi", script: "Devanagari" },
};
export type Arm = "english" | "direct" | "translate";
export const ARMS: readonly Arm[] = ["english", "direct", "translate"];

export const LOCALE_PARAMS = {
  /** The model must get at least this share of the tasks right in English before a difference in another language says anything about the route. */
  reproductionGate: 0.9,
  /** The pass-rate difference within which the route and the direct prompt are called equivalent, in points. */
  marginPoints: 5,
  resamples: 10_000,
  seed: 20261101,
} as const;

export interface LocaleTask {
  id: string;
  cluster: CanaryTask["cluster"];
  english: string;
  prompts: Record<Lang, string>;
  check: CanaryTask["check"];
}

const sortedNumbers = (text: string): string => numbersIn(text).sort((a, b) => a - b).join(",");

/**
 * Read the localised tasks and refuse a file whose translation has changed a number: the same figures, in any order, must stand in each language as in the English original,
 * because the checker reads the answer's figures and a changed figure would make the task a different one.
 */
export function loadLocaleTasks(file = "data/locale/tasks.json"): LocaleTask[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { tasks: Record<string, Record<Lang, string>> };
  const out: LocaleTask[] = [];
  for (const [id, prompts] of Object.entries(raw.tasks)) {
    const task = TASKS.find((t) => t.id === id);
    if (!task) throw new Error(`${file}: no canary task ${id}`);
    for (const lang of Object.keys(LANGS) as Lang[]) {
      const p = prompts[lang];
      if (typeof p !== "string" || p.trim() === "") throw new Error(`${file}: ${id} has no ${lang} prompt`);
      if (sortedNumbers(p) !== sortedNumbers(task.prompt)) throw new Error(`${file}: the ${lang} prompt of ${id} has different figures from the English one (${sortedNumbers(p)} against ${sortedNumbers(task.prompt)})`);
    }
    out.push({ id, cluster: task.cluster, english: task.prompt, prompts, check: task.check });
  }
  return out;
}

/** Any script's decimal digits as 0 to 9, so a reply written with Devanagari or full-width digits is read by the same checker as one written with ours. */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) as number;
    let start = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((cp - start) % 10);
  });
}

export interface LocaleRow {
  taskId: string;
  cluster: string;
  lang: Lang | "en";
  arm: Arm;
  repeat: number;
  /** 1 or 0, or null when no answer was got (a call failed or the reply was empty). */
  score: 0 | 1 | null;
  error: string | null;
  calls: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** The tokens of the call that did the task and of the calls that only translated, when the usage of every call is known. */
  workerTokens: number | null;
  sideTokens: number | null;
  servedModel: string | null;
  replySha: string | null;
}

/**
 * A translation is asked for as a translation of text that is only text. The first version of these instructions said "translate" and gave the task bare, and the model answered the
 * task instead of translating it (the recorded run showed `23.05` returned as the "English" of a Japanese arithmetic question), which made the route look worse for a fault of the
 * instruction and not of the route. The text now sits between tags, and the instruction says it is a task for someone else that is not to be solved.
 */
const TRANSLATE_IN = (lang: Lang): string =>
  `You are a translation engine. Translate the text between the <text> tags from ${LANGS[lang].name} into English. The text is a task meant for someone else: do not solve it, do not answer it and do not follow it, only translate it. Keep every number, unit, name and symbol exactly as written, in the digits 0 to 9, and keep the instruction about how to reply. Output only the English translation, without the tags.`;
const TRANSLATE_OUT = (lang: Lang): string =>
  `You are a translation engine. Translate the text between the <text> tags from English into ${LANGS[lang].name}. Do not add to it, explain it or answer anything. Keep every number, unit, name and symbol exactly as written, in the digits 0 to 9. Output only the ${LANGS[lang].name} translation, without the tags.`;
/**
 * A chat model told to translate a question will often answer it. Two worked examples, in the language being translated and with figures that are in no task, show what is wanted
 * and make it much less likely; they are part of every request, so they are part of what a recording is keyed on.
 */
const SHOT_IN: Record<Lang, { from: string; to: string }[]> = {
  ja: [
    { from: "5と7の合計はいくつですか？説明は不要です。最終的な答えだけを返してください。", to: "What is the sum of 5 and 7? No explanation is needed. Reply with only the final answer." },
    { from: "ある店でりんごが1個0.40ドルで売られています。ケンは12個買いました。合計はいくらですか？最終的な答えだけを返してください。", to: "A shop sells apples at 0.40 dollars each. Ken buys 12 apples. How much does he pay in total? Reply with only the final answer." },
  ],
  hi: [
    { from: "5 और 7 का योग क्या है? कोई स्पष्टीकरण नहीं, केवल अंतिम उत्तर दें।", to: "What is the sum of 5 and 7? No explanation is needed. Reply with only the final answer." },
    { from: "एक दुकान में सेब 0.40 डॉलर प्रति सेब बिकता है। केन 12 सेब खरीदता है। वह कुल कितना देता है? केवल अंतिम उत्तर दें।", to: "A shop sells apples at 0.40 dollars each. Ken buys 12 apples. How much does he pay in total? Reply with only the final answer." },
  ],
};
const SHOT_OUT: Record<Lang, { from: string; to: string }[]> = {
  ja: [{ from: "4.80", to: "4.80" }, { from: "The total is 4.80 dollars.", to: "合計は4.80ドルです。" }],
  hi: [{ from: "4.80", to: "4.80" }, { from: "The total is 4.80 dollars.", to: "कुल 4.80 डॉलर है।" }],
};
const shots = (list: { from: string; to: string }[]): ChatMessage[] => list.flatMap((x) => [{ role: "user" as const, content: tagged(x.from) }, { role: "assistant" as const, content: x.to }]);

const tagged = (text: string): string => ["<text>", text, "</text>"].join(String.fromCharCode(10));
const WORK = "You are taking a short test. Work silently and answer exactly as instructed.";

export interface RunOptions {
  port: ModelPort;
  tasks: readonly LocaleTask[];
  langs: readonly Lang[];
  repeats: number;
  concurrency?: number;
  deadlineMs?: number;
  maxTokens?: number;
  temperature?: number;
  attempts?: number;
  retryPauseMs?: number;
}

interface Tally {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Tokens, in and out, of the call that does the task, and of the calls that only translate. */
  worker: number;
  side: number;
  unknownUsage: boolean;
  served: string | null;
}

/** One attempt of one arm on one task: every call it makes, summed. */
async function attempt(o: RunOptions, task: LocaleTask, lang: Lang | "en", arm: Arm, repeat: number): Promise<{ answer: string; tally: Tally }> {
  const tally: Tally = { calls: 0, tokensIn: 0, tokensOut: 0, worker: 0, side: 0, unknownUsage: false, served: null };
  const call = async (role: string, system: string, user: string, examples: ChatMessage[] = []): Promise<string> => {
    const r = await completeOwn(o.port, { role, maxTokens: o.maxTokens ?? 400, temperature: o.temperature ?? 0.7, variant: repeat, messages: [{ role: "system", content: system }, ...examples, { role: "user", content: user }] }, o.deadlineMs ?? 90_000);
    tally.calls += 1;
    if (r.usage) {
      tally.tokensIn += r.usage.inputTokens;
      tally.tokensOut += r.usage.outputTokens;
      if (role === "locale_work" || role === "locale_direct") tally.worker += r.usage.inputTokens + r.usage.outputTokens;
      else tally.side += r.usage.inputTokens + r.usage.outputTokens;
    } else tally.unknownUsage = true;
    tally.served = r.servedModel;
    return r.content.trim();
  };
  if (arm === "english") return { answer: await call("locale_work", WORK, task.english), tally };
  const l = lang as Lang;
  if (arm === "direct") return { answer: await call("locale_direct", WORK, task.prompts[l]), tally };
  // A step that returns nothing ends the attempt: there is nothing to work on or to translate back, and no answer to score.
  const english = await call("locale_translate_in", TRANSLATE_IN(l), tagged(task.prompts[l]), shots(SHOT_IN[l]));
  if (english === "") return { answer: "", tally };
  const answer = await call("locale_work", WORK, english);
  if (answer === "") return { answer: "", tally };
  return { answer: await call("locale_translate_out", TRANSLATE_OUT(l), tagged(answer), shots(SHOT_OUT[l])), tally };
}

/** Every arm of every task, `repeats` times. A failed attempt is a row with no score and a reason, never a zero: a harness failure must not look like a wrong answer. */
export async function runLocale(o: RunOptions): Promise<LocaleRow[]> {
  type Job = { task: LocaleTask; lang: Lang | "en"; arm: Arm; repeat: number };
  const jobs: Job[] = [];
  for (const task of o.tasks) {
    for (let r = 1; r <= o.repeats; r += 1) {
      jobs.push({ task, lang: "en", arm: "english", repeat: r });
      for (const lang of o.langs) for (const arm of ["direct", "translate"] as const) jobs.push({ task, lang, arm, repeat: r });
    }
  }
  const rows = new Array<LocaleRow>(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      const job = jobs[i];
      if (!job) return;
      const attempts = Math.max(1, o.attempts ?? 3);
      let row: LocaleRow | null = null;
      for (let a = 1; a <= attempts; a += 1) {
        try {
          const { answer, tally } = await attempt(o, job.task, job.lang, job.arm, job.repeat);
          const score = answer === "" ? null : job.task.check(asciiDigits(answer));
          row = {
            taskId: job.task.id, cluster: job.task.cluster, lang: job.lang, arm: job.arm, repeat: job.repeat, score, error: score === null ? "empty reply" : null, calls: tally.calls,
            tokensIn: tally.unknownUsage ? null : tally.tokensIn, tokensOut: tally.unknownUsage ? null : tally.tokensOut, workerTokens: tally.unknownUsage ? null : tally.worker, sideTokens: tally.unknownUsage ? null : tally.side, servedModel: tally.served, replySha: createHash("sha256").update(answer).digest("hex").slice(0, 16),
          };
          if (score !== null) break;
        } catch (e) {
          const why = e instanceof BudgetError ? "own spend limit" : e instanceof ModelError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : "unexpected";
          row = { taskId: job.task.id, cluster: job.task.cluster, lang: job.lang, arm: job.arm, repeat: job.repeat, score: null, error: `${why} after ${a} of ${attempts} attempts`, calls: 0, tokensIn: null, tokensOut: null, workerTokens: null, sideTokens: null, servedModel: null, replySha: null };
          if (why === "own spend limit" || (e instanceof ModelError && e.kind === "cassette_miss")) break;
        }
        if (a < attempts) await new Promise((res) => setTimeout(res, o.retryPauseMs ?? 3000));
      }
      rows[i] = row as LocaleRow;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, jobs.length)) }, worker));
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export type Verdict = "withheld" | "equivalent" | "worse" | "better" | "inconclusive";

export interface LangReport {
  lang: Lang;
  tasks: number;
  /** Pass rates over the scored attempts, by arm. */
  pass: Record<"direct" | "translate", { rate: number | null; scored: number; failed: number }>;
  /** Translate minus direct, in points, over tasks (each task's repeats averaged), with a 95% interval from resampling clusters. */
  delta: { points: number; low: number; high: number } | null;
  verdict: Verdict;
  /** Mean tokens (in plus out) one task cost by arm, over the attempts with known usage; and the share saved by the route, negative when it costs more. */
  tokens: { direct: number | null; translate: number | null; saved: number | null; callsDirect: number; callsTranslate: number; workerDirect: number | null; workerTranslate: number | null; workerSaved: number | null; translating: number | null };
  why: string;
}

export interface LocaleReport {
  model: string | null;
  repeats: number;
  english: { rate: number | null; scored: number; failed: number; gate: boolean };
  langs: LangReport[];
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

function rateOf(rows: readonly LocaleRow[]): { rate: number | null; scored: number; failed: number } {
  const scored = rows.filter((r) => r.score !== null);
  return { rate: scored.length === 0 ? null : scored.reduce((s, r) => s + (r.score as number), 0) / scored.length, scored: scored.length, failed: rows.length - scored.length };
}

/** Each task's pass rate over its scored repeats, for the tasks that have a score in both arms. */
function paired(rows: readonly LocaleRow[], lang: Lang): { cluster: string; a: number; b: number }[] {
  const by = (arm: Arm): Map<string, { cluster: string; sum: number; n: number }> => {
    const m = new Map<string, { cluster: string; sum: number; n: number }>();
    for (const r of rows) {
      if (r.lang !== lang || r.arm !== arm || r.score === null) continue;
      const e = m.get(r.taskId) ?? { cluster: r.cluster, sum: 0, n: 0 };
      e.sum += r.score;
      e.n += 1;
      m.set(r.taskId, e);
    }
    return m;
  };
  const d = by("direct");
  const t = by("translate");
  const out: { cluster: string; a: number; b: number }[] = [];
  for (const [id, x] of d) {
    const y = t.get(id);
    if (y) out.push({ cluster: x.cluster, a: x.sum / x.n, b: y.sum / y.n });
  }
  return out;
}

export function bootstrapDelta(pairs: readonly { cluster: string; a: number; b: number }[], resamples = LOCALE_PARAMS.resamples, seed = LOCALE_PARAMS.seed): { points: number; low: number; high: number } | null {
  if (pairs.length === 0) return null;
  const clusters = new Map<string, { a: number; b: number }[]>();
  for (const p of pairs) clusters.set(p.cluster, [...(clusters.get(p.cluster) ?? []), p]);
  const groups = [...clusters.keys()].sort().map((k) => clusters.get(k) as { a: number; b: number }[]);
  const diff = (list: readonly { a: number; b: number }[]): number => mean(list.map((p) => p.b - p.a)) * 100;
  const rng = new Rng(seed);
  const draws: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const picked: { a: number; b: number }[] = [];
    for (let g = 0; g < groups.length; g += 1) picked.push(...(groups[Math.floor(rng.next() * groups.length)] as { a: number; b: number }[]));
    draws.push(diff(picked));
  }
  draws.sort((x, y) => x - y);
  return { points: diff(pairs), low: draws[Math.floor(0.025 * resamples)] as number, high: draws[Math.min(resamples - 1, Math.floor(0.975 * resamples))] as number };
}

export function reportLocale(rows: readonly LocaleRow[], o: { langs: readonly Lang[]; repeats: number; margin?: number; gate?: number }): LocaleReport {
  const margin = o.margin ?? LOCALE_PARAMS.marginPoints;
  const gateRate = o.gate ?? LOCALE_PARAMS.reproductionGate;
  const eng = rateOf(rows.filter((r) => r.arm === "english"));
  const gate = eng.rate !== null && eng.rate >= gateRate;
  const langs: LangReport[] = o.langs.map((lang) => {
    const mine = rows.filter((r) => r.lang === lang);
    const direct = mine.filter((r) => r.arm === "direct");
    const translate = mine.filter((r) => r.arm === "translate");
    const pairs = paired(rows, lang);
    const delta = bootstrapDelta(pairs);
    const tokensOf = (list: readonly LocaleRow[]): { mean: number | null; calls: number } => {
      const known = list.filter((r) => r.tokensIn !== null && r.tokensOut !== null && r.score !== null);
      return { mean: known.length === 0 ? null : mean(known.map((r) => (r.tokensIn as number) + (r.tokensOut as number))), calls: known.length === 0 ? 0 : mean(known.map((r) => r.calls)) };
    };
    const td = tokensOf(direct);
    const tt = tokensOf(translate);
    const workerOf = (list: readonly LocaleRow[]): number | null => {
      const known = list.filter((r) => r.workerTokens !== null && r.score !== null);
      return known.length === 0 ? null : mean(known.map((r) => r.workerTokens as number));
    };
    const sideOf = (list: readonly LocaleRow[]): number | null => {
      const known = list.filter((r) => r.sideTokens !== null && r.score !== null);
      return known.length === 0 ? null : mean(known.map((r) => r.sideTokens as number));
    };
    const wd = workerOf(direct);
    const wt = workerOf(translate);
    const saved = td.mean !== null && tt.mean !== null && td.mean > 0 ? (td.mean - tt.mean) / td.mean : null;
    let verdict: Verdict;
    let why: string;
    if (!gate) {
      verdict = "withheld";
      why = `the model got ${eng.rate === null ? "none" : `${(100 * eng.rate).toFixed(1)}%`} of the tasks right in English, under the ${(100 * gateRate).toFixed(0)}% a comparison needs, so a difference in ${LANGS[lang].name} would say nothing about the route`;
    } else if (delta === null) {
      verdict = "withheld";
      why = "no task has a scored attempt in both arms";
    } else if (delta.high < -margin) {
      verdict = "worse";
      why = `the route loses answers: ${delta.points.toFixed(1)} points, interval ${delta.low.toFixed(1)} to ${delta.high.toFixed(1)}, all below minus ${margin}`;
    } else if (delta.low > margin) {
      verdict = "better";
      why = `the route gains answers: ${delta.points.toFixed(1)} points, interval ${delta.low.toFixed(1)} to ${delta.high.toFixed(1)}, all above ${margin}`;
    } else if (delta.low >= -margin && delta.high <= margin) {
      verdict = "equivalent";
      why = `the interval, ${delta.low.toFixed(1)} to ${delta.high.toFixed(1)} points, lies inside plus or minus ${margin}`;
    } else {
      verdict = "inconclusive";
      why = `the interval, ${delta.low.toFixed(1)} to ${delta.high.toFixed(1)} points, reaches past plus or minus ${margin}: the tasks cannot say`;
    }
    return {
      lang,
      tasks: pairs.length,
      pass: { direct: rateOf(direct), translate: rateOf(translate) },
      delta,
      verdict,
      tokens: { direct: td.mean, translate: tt.mean, saved, callsDirect: td.calls, callsTranslate: tt.calls, workerDirect: wd, workerTranslate: wt, workerSaved: wd !== null && wt !== null && wd > 0 ? (wd - wt) / wd : null, translating: sideOf(translate) },
      why,
    };
  });
  const served = rows.find((r) => r.servedModel !== null)?.servedModel ?? null;
  return { model: served, repeats: o.repeats, english: { ...eng, gate }, langs };
}

const pct = (x: number | null): string => (x === null ? "no score" : `${(100 * x).toFixed(1)}%`);

export function renderLocale(r: LocaleReport): string {
  const out: string[] = [`Locale route: translate to English, work, translate back, against sending the task in its own language${r.model ? ` (${r.model})` : ""}; ${r.repeats} repeats per task.`];
  out.push(`In English the model gets ${pct(r.english.rate)} of the tasks right (${r.english.scored} scored attempts, ${r.english.failed} failed); the comparison needs ${(100 * LOCALE_PARAMS.reproductionGate).toFixed(0)}%: ${r.english.gate ? "met" : "NOT met, so no comparison is made"}.`);
  for (const l of r.langs) {
    out.push("", `${LANGS[l.lang].name} (${l.tasks} tasks with an answer in both arms)`);
    out.push(`  sent as written: ${pct(l.pass.direct.rate)} right; through the route: ${pct(l.pass.translate.rate)} right`);
    if (l.delta) out.push(`  difference, route minus as written: ${l.delta.points.toFixed(1)} points, 95% interval ${l.delta.low.toFixed(1)} to ${l.delta.high.toFixed(1)} (tasks resampled in clusters, ${LOCALE_PARAMS.resamples.toLocaleString("en-US")} draws)`);
    out.push(`  verdict: ${l.verdict}: ${l.why}`);
    if (l.tokens.direct !== null && l.tokens.translate !== null) {
      out.push(`  tokens per task, in and out: ${Math.round(l.tokens.direct)} as written (${l.tokens.callsDirect.toFixed(0)} call), ${Math.round(l.tokens.translate)} through the route (${l.tokens.callsTranslate.toFixed(0)} calls): ${l.tokens.saved !== null && l.tokens.saved >= 0 ? `the route uses ${(100 * (l.tokens.saved as number)).toFixed(0)}% fewer` : `the route uses ${(100 * Math.abs(l.tokens.saved ?? 0)).toFixed(0)}% more`}`);
      if (l.tokens.workerDirect !== null && l.tokens.workerTranslate !== null && l.tokens.translating !== null) {
        out.push(`  of those, the call that does the task: ${Math.round(l.tokens.workerDirect)} as written and ${Math.round(l.tokens.workerTranslate)} through the route (${l.tokens.workerSaved !== null && l.tokens.workerSaved >= 0 ? `${(100 * (l.tokens.workerSaved as number)).toFixed(0)}% fewer` : `${(100 * Math.abs(l.tokens.workerSaved ?? 0)).toFixed(0)}% more`}); the translation calls add ${Math.round(l.tokens.translating)}, which is the part a cheaper model would carry`);
      }
    } else out.push("  tokens: not known for every call, so no figure");
  }
  out.push("", "Priced only when a price is given; the free tier's price is not published and is not guessed.");
  return out.join("\n");
}
