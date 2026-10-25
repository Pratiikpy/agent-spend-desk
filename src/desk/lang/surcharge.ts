import type { Ledger } from "../ledger/db.ts";
import { LABEL_NAME, type Label } from "./script.ts";

/**
 * The language surcharge (DF-043, spec 6.4): how many more tokens a prompt in another script costs than the same amount of English, on the same model.
 *
 * A task here is a person's prompt and the first call the model made after it. Everything before that prompt is already in the cache, so what the call newly reads (its uncached input
 * and the tokens it writes to the cache) is, apart from a few hundred tokens of harness text that is the same whatever the language, the prompt. The rate is those tokens per character
 * of the prompt. It is compared only within one model, because the tokenizer is the model's: a rate on Opus is never set against a rate on Haiku, and no tokenizer is guessed.
 *
 * The harness text is in every task's tokens and in none of its characters, and it is English whatever the prompt is. So the English tasks on a model are fitted as tokens = a + b x
 * characters (the median of the slopes between every pair of tasks, which a few odd tasks do not move): `a` is the harness text and `b` is English's tokens per character. A task in
 * another script is then read as (tokens - a) per character, and the surcharge is that over `b`. The figure is an estimate and is called one. A cell is shown only with at least 20
 * tasks in it and 20 English tasks on the same model, and when the English tasks differ enough in length to fit; below that the answer is that there is not enough data, with the counts.
 */
export const LANG_PARAMS = {
  minTasks: 20,
  /** A prompt shorter than this, in characters, is too short for its tokens per character to be told from the harness text around it. */
  minChars: 100,
  minLetters: 60,
  /** The English tasks must reach at least this many characters between the shortest and the longest quarter, or a line cannot be fitted through them. */
  minSpreadChars: 150,
  /** At most this many English tasks are used in the fit, evenly spread over their lengths, so that the fit takes the same time on a year of prompts. */
  maxFit: 400,
  /** Prose is mostly letters; a pasted log, a path or a block of code is not, and its tokens say nothing about a language. */
  minLetterShare: 0.5,
  /** The first call after a prompt that is further away than this was not the reading of that prompt. */
  firstCallWithinMs: 120_000,
  /** A call that read more than this many tokens per character was reading something else too (a restored context, a pasted file). */
  maxTokensPerChar: 12,
  /** From this much more than English, a cell is a waste class (C-LANG): the extra tokens, at what the call paid for them. */
  wasteRatio: 1.15,
} as const;

export interface LangTask {
  promptId: string;
  sessionId: string;
  callId: string;
  script: Label;
  model: string;
  chars: number;
  tokens: number;
  /** What the call paid for the tokens it newly read, in millionths of a dollar, or null when the call has no price. */
  newMicros: number | null;
}

export interface LangCell {
  script: Label;
  model: string;
  tasks: number;
  /** Median tokens per character of the tasks in the cell. */
  tokensPerChar: number;
  /** This cell's rate over the same model's English rate, or null when either cell has too few tasks. */
  ratio: number | null;
  /** The tokens above what the same characters would have cost in English, and their price, or null when the cell is not shown. */
  extraTokens: number | null;
  extraMicros: number | null;
  status: "shown" | "not enough data";
  why?: string;
}

export interface LangCall {
  callId: string;
  sessionId: string;
  script: Label;
  model: string;
  tokens: number;
  expectedTokens: number;
  micros: number;
  /** The cell's ratio to English, for the explanation. */
  ratio: number;
}

export interface LangReport {
  from: string;
  to: string;
  minTasks: number;
  /** English on each model: the fitted harness text (tokens in every task whatever it says) and English's tokens per character. */
  baselines: { model: string; tasks: number; overheadTokens: number; tokensPerChar: number; fitted: boolean }[];
  cells: LangCell[];
  /** The prompts that were set aside and why, as counts. */
  setAside: Record<string, number>;
  totalExtraMicros: number;
  /** Calls in shown cells with a ratio at or above the waste ratio, for C-LANG. */
  calls: LangCall[];
  /** Prompts in the period whose script was not recorded (a ledger read before schema 30 and not backfilled). */
  unread: number;
}

/** The line through the points that the median of the pairwise slopes gives, with the median intercept: a few odd points do not move it. */
export function theilSen(points: readonly { x: number; y: number }[]): { a: number; b: number } | null {
  if (points.length < 3) return null;
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const step = Math.max(1, Math.ceil(sorted.length / LANG_PARAMS.maxFit));
  const use = sorted.filter((_, i) => i % step === 0);
  const slopes: number[] = [];
  for (let i = 0; i < use.length; i += 1) {
    for (let j = i + 1; j < use.length; j += 1) {
      const dx = (use[j] as { x: number }).x - (use[i] as { x: number }).x;
      if (dx > 0) slopes.push(((use[j] as { y: number }).y - (use[i] as { y: number }).y) / dx);
    }
  }
  if (slopes.length === 0) return null;
  const b = median(slopes);
  return { a: median(use.map((p) => p.y - b * p.x)), b };
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

interface Row {
  prompt_id: string;
  session_id: string;
  chars: number;
  letters: number;
  script: string;
  call_id: string;
  model: string;
  input_tokens: number;
  w5: number;
  w1: number;
  new_micros: number | null;
}

/** Every prompt in the period with the first main-thread call after it, when there is a call before the prompt (the first prompt of a session carries the whole system prompt). */
export function loadTasks(db: Ledger, fromIso: string, toIso: string): { tasks: LangTask[]; setAside: Record<string, number>; unread: number } {
  const rows = db
    .prepare(
      `SELECT p.prompt_id, p.session_id, p.chars, p.letters, p.script, c.call_id, c.model, c.input_tokens, c.cache_write_5m_tokens AS w5, c.cache_write_1h_tokens AS w1,
              CASE WHEN e.class = 'estimated' THEN e.input_micros + e.cache_write_5m_micros + e.cache_write_1h_micros END AS new_micros
       FROM human_prompt p
       JOIN model_call c ON c.call_id = (
         SELECT m.call_id FROM model_call m
         WHERE m.session_id = p.session_id AND m.is_sidechain = 0 AND m.ts >= p.ts AND (julianday(m.ts) - julianday(p.ts)) * 86400000 <= ?
         ORDER BY m.ts, m.call_id LIMIT 1)
       LEFT JOIN cost_event e ON e.call_id = c.call_id
       WHERE p.script IS NOT NULL AND p.ts >= ? AND p.ts <= ?
         AND EXISTS (SELECT 1 FROM model_call x WHERE x.session_id = p.session_id AND x.is_sidechain = 0 AND x.ts < p.ts)
       ORDER BY p.ts, p.prompt_id`,
    )
    .all(LANG_PARAMS.firstCallWithinMs, fromIso, toIso) as unknown as Row[];
  const unread = (db.prepare("SELECT COUNT(*) AS n FROM human_prompt WHERE script IS NULL AND ts >= ? AND ts <= ?").get(fromIso, toIso) as { n: number }).n;
  const setAside: Record<string, number> = {};
  const aside = (why: string): void => void (setAside[why] = (setAside[why] ?? 0) + 1);
  const tasks: LangTask[] = [];
  for (const r of rows) {
    const tokens = r.input_tokens + r.w5 + r.w1;
    if (r.chars < LANG_PARAMS.minChars) aside(`shorter than ${LANG_PARAMS.minChars} characters`);
    else if (r.letters < LANG_PARAMS.minLetters || r.letters / r.chars < LANG_PARAMS.minLetterShare) aside("mostly not letters (code, a log, a path)");
    else if (r.script === "none" || r.script === "mixed" || r.script === "latin") aside(r.script === "latin" ? "Latin script not shown to be English" : r.script === "mixed" ? "mixed scripts" : "no letters");
    else if (tokens <= 0 || tokens / r.chars > LANG_PARAMS.maxTokensPerChar) aside("the call read far more than the prompt (a restored context or a pasted file)");
    else tasks.push({ promptId: r.prompt_id, sessionId: r.session_id, callId: r.call_id, script: r.script as Label, model: r.model, chars: r.chars, tokens, newMicros: r.new_micros });
  }
  return { tasks, setAside, unread };
}

export function languageSurcharge(db: Ledger, fromIso: string, toIso: string): LangReport {
  const { tasks, setAside, unread } = loadTasks(db, fromIso, toIso);
  const by = new Map<string, LangTask[]>();
  for (const t of tasks) {
    const k = `${t.script}\u0000${t.model}`;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const baselines: LangReport["baselines"] = [];
  const fit = new Map<string, { a: number; b: number }>();
  for (const [k, list] of [...by].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (!k.startsWith("en\u0000")) continue;
    const model = k.split("\u0000")[1] as string;
    const sorted = list.map((t) => t.chars).sort((x, y) => x - y);
    const spread = (sorted[Math.floor(sorted.length * 0.75)] as number) - (sorted[Math.floor(sorted.length * 0.25)] as number);
    const line = list.length >= LANG_PARAMS.minTasks && spread >= LANG_PARAMS.minSpreadChars ? theilSen(list.map((t) => ({ x: t.chars, y: t.tokens }))) : null;
    const ok = line !== null && line.b > 0.01 && line.a >= 0;
    if (ok) fit.set(model, line);
    baselines.push({ model, tasks: list.length, overheadTokens: ok ? Math.round(line.a) : 0, tokensPerChar: ok ? line.b : median(list.map((t) => t.tokens / t.chars)), fitted: ok });
  }
  const baseOf = new Map(baselines.map((b) => [b.model, b]));
  const cells: LangCell[] = [];
  const calls: LangCall[] = [];
  let totalExtraMicros = 0;
  for (const [k, list] of [...by].sort((x, y) => x[0].localeCompare(y[0]))) {
    const [script, model] = k.split("\u0000") as [Label, string];
    if (script === "en") continue;
    const base = baseOf.get(model);
    const line = fit.get(model);
    const own = (t: LangTask): number => (t.tokens - (line?.a ?? 0)) / t.chars;
    const tokensPerChar = median(list.map(own));
    const notShown = (why: string): void => void cells.push({ script, model, tasks: list.length, tokensPerChar, ratio: null, extraTokens: null, extraMicros: null, status: "not enough data", why });
    if (list.length < LANG_PARAMS.minTasks) {
      notShown(`${list.length} tasks in this language on this model; at least ${LANG_PARAMS.minTasks} are needed`);
      continue;
    }
    if (!base || base.tasks < LANG_PARAMS.minTasks) {
      notShown(`${base?.tasks ?? 0} English tasks on this model to compare with; at least ${LANG_PARAMS.minTasks} are needed`);
      continue;
    }
    if (!line) {
      notShown(`the ${base.tasks} English tasks on this model are too alike in length to tell the harness text from the prompt`);
      continue;
    }
    const ratio = tokensPerChar / line.b;
    let extraTokens = 0;
    let extraMicros = 0;
    for (const t of list) {
      const expected = Math.min(t.tokens, line.a + line.b * t.chars);
      const extra = t.tokens - expected;
      extraTokens += extra;
      const micros = t.newMicros === null ? 0 : Math.round((t.newMicros * extra) / t.tokens);
      extraMicros += micros;
      if (ratio >= LANG_PARAMS.wasteRatio && micros > 0) calls.push({ callId: t.callId, sessionId: t.sessionId, script, model, tokens: t.tokens, expectedTokens: Math.round(expected), micros, ratio });
    }
    totalExtraMicros += extraMicros;
    cells.push({ script, model, tasks: list.length, tokensPerChar, ratio, extraTokens: Math.round(extraTokens), extraMicros, status: "shown" });
  }
  return { from: fromIso, to: toIso, minTasks: LANG_PARAMS.minTasks, baselines, cells, setAside, totalExtraMicros, calls, unread };
}

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

export function renderLanguage(r: LangReport): string {
  const out: string[] = [`Language surcharge, ${r.from.slice(0, 10)} to ${r.to.slice(0, 10)}: how many more tokens a prompt in another script costs than the same length of English, on the same model. An estimate from logged tokens.`];
  if (r.unread > 0) out.push(`${r.unread} prompts were read before the script was recorded; run: desk ingest --backfill`);
  if (r.baselines.length === 0) out.push(`No English prompt of ${LANG_PARAMS.minChars} characters or more was found in the period, so there is nothing to compare another language with.`);
  for (const b of r.baselines) out.push(`English on ${b.model}: ${b.tasks} tasks, ${b.tokensPerChar.toFixed(3)} tokens per character${b.fitted ? `, after about ${b.overheadTokens} tokens of harness text in every task` : b.tasks < r.minTasks ? ` (fewer than ${r.minTasks}: not enough to compare with)` : " (the tasks are too alike in length to fit)"}`);
  if (r.cells.length === 0 && r.baselines.length > 0) out.push("No prompt in another script was found in the period.");
  for (const c of r.cells) {
    const name = LABEL_NAME[c.script];
    if (c.status === "shown") out.push(`${name} on ${c.model}: ${c.tasks} tasks, ${c.tokensPerChar.toFixed(3)} tokens per character, ${(c.ratio as number).toFixed(2)} times English; about ${(c.extraTokens as number).toLocaleString("en-US")} tokens more than the same characters in English, ${usd(c.extraMicros as number)} at list price`);
    else out.push(`${name} on ${c.model}: not enough data (${c.why})`);
  }
  if (r.cells.some((c) => c.status === "shown")) out.push(`Total above the English rate: ${usd(r.totalExtraMicros)}. Calls in a language that costs ${LANG_PARAMS.wasteRatio} times English or more are the waste class C-LANG (desk waste).`);
  const aside = Object.entries(r.setAside).sort((a, b) => b[1] - a[1]);
  if (aside.length > 0) out.push(`Set aside: ${aside.map(([why, n]) => `${n} ${why}`).join("; ")}.`);
  out.push("Each rate is the median, over the tasks, of the tokens newly read by the first call after a prompt, less the English fit's harness text, per character of the prompt. The harness text is assumed to be the same in every language.");
  return out.join("\n");
}
