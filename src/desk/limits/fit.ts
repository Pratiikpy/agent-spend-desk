import type { Ledger } from "../ledger/db.ts";
import { seededRandom } from "../stats/random.ts";

/**
 * What a plan's rate limit costs in tokens, learned from the tool's own readings. A tool such as Codex writes, beside
 * its token counts, the percent of each rate-limit window that is used and when the window resets. A window's
 * readings and the calls made between its first and last reading give one observation: so many tokens moved the
 * percent by so many points. The estimate pools them (all tokens over all points, so a window with few points does not
 * count as much as one with many), puts an interval on it by resampling windows, shows how far individual windows
 * stray from it, and says nothing at all when there is too little to learn from.
 *
 * It is not a forecast. Other devices and other uses of the same plan move the percent without leaving a trace in
 * these logs, which is the main reason windows differ, and the percent is reported in whole points.
 */
export interface WindowObservation {
  kind: "primary" | "secondary";
  resetsAt: number;
  windowMinutes: number;
  firstTs: string;
  lastTs: string;
  firstPct: number;
  lastPct: number;
  dPct: number;
  /** Tokens (input and output as the tool counts them) of covered calls made after the first reading, up to the last. */
  tokens: number;
  calls: number;
}

export interface ObserveOptions {
  tool: string;
  kind: "primary" | "secondary";
  /** Which models draw on the plan. The default is OpenAI's own models; calls through other providers do not count against it. */
  modelFilter?: (model: string) => boolean;
}

const OPENAI_MODEL = /^(gpt|o\d|codex)/i;

export function observeWindows(db: Ledger, opts: ObserveOptions): WindowObservation[] {
  const filter = opts.modelFilter ?? ((m: string) => OPENAI_MODEL.test(m));
  const samples = db
    .prepare("SELECT ts, used_percent AS pct, resets_at AS resetsAt, window_minutes AS windowMinutes FROM limit_sample WHERE tool = ? AND kind = ? ORDER BY ts, session_id")
    .all(opts.tool, opts.kind) as unknown as { ts: string; pct: number; resetsAt: number; windowMinutes: number }[];
  const byWindow = new Map<number, typeof samples>();
  for (const s of samples) byWindow.set(s.resetsAt, [...(byWindow.get(s.resetsAt) ?? []), s]);

  const calls = db
    .prepare("SELECT m.ts AS ts, m.model AS model, m.input_tokens AS i, m.cache_read_tokens AS c, m.output_tokens AS o FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE s.tool = ? ORDER BY m.ts")
    .all(opts.tool) as unknown as { ts: string; model: string; i: number; c: number; o: number }[];
  const times = calls.map((c) => Date.parse(c.ts));

  const out: WindowObservation[] = [];
  for (const [resetsAt, list] of byWindow) {
    if (list.length < 2) continue;
    const first = list[0] as (typeof samples)[number];
    const last = list[list.length - 1] as (typeof samples)[number];
    const from = Date.parse(first.ts);
    const to = Date.parse(last.ts);
    let tokens = 0;
    let n = 0;
    for (let k = 0; k < calls.length; k += 1) {
      const t = times[k] as number;
      if (t <= from || t > to) continue;
      const c = calls[k] as (typeof calls)[number];
      if (!filter(c.model)) continue;
      tokens += c.i + c.c + c.o;
      n += 1;
    }
    out.push({ kind: opts.kind, resetsAt, windowMinutes: first.windowMinutes, firstTs: first.ts, lastTs: last.ts, firstPct: first.pct, lastPct: last.pct, dPct: last.pct - first.pct, tokens, calls: n });
  }
  return out.sort((a, b) => a.firstTs.localeCompare(b.firstTs));
}

export interface FitOptions {
  /** A window teaches something only if the percent moved at least this many points in it: one point is a rounding step. */
  minPercent?: number;
  /** Fewer qualifying windows than this and the fit abstains. */
  minWindows?: number;
  seed?: number;
  resamples?: number;
}

export interface LimitFit {
  windows: number;
  qualifying: number;
  abstained: boolean;
  reason: string | null;
  sumPercent: number;
  sumTokens: number;
  tokensPerPercent: number | null;
  /** 95% interval for the pooled rate, by resampling windows. */
  low: number | null;
  high: number | null;
  /** Tokens for a whole window: one hundred percent. */
  capacityTokens: number | null;
  /** How far individual windows stray: their own tokens per percent at the 10th, 50th and 90th percentile. */
  spread: { p10: number; median: number; p90: number } | null;
}

const quantile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
};

export function fitLimit(obs: readonly WindowObservation[], opts: FitOptions = {}): LimitFit {
  const minPercent = opts.minPercent ?? 10;
  const minWindows = opts.minWindows ?? 8;
  const good = obs.filter((w) => w.dPct >= minPercent && w.tokens > 0);
  const none = { windows: obs.length, qualifying: good.length, sumPercent: 0, sumTokens: 0, tokensPerPercent: null, low: null, high: null, capacityTokens: null, spread: null };
  if (good.length < minWindows) {
    return { ...none, abstained: true, reason: `only ${good.length} window${good.length === 1 ? "" : "s"} moved the percent by ${minPercent} points or more; at least ${minWindows} are needed` };
  }
  const sumP = good.reduce((s, w) => s + w.dPct, 0);
  const sumT = good.reduce((s, w) => s + w.tokens, 0);
  const rate = sumT / sumP;
  const rand = seededRandom(opts.seed ?? 1);
  const n = good.length;
  const reps: number[] = [];
  for (let b = 0; b < (opts.resamples ?? 2000); b += 1) {
    let t = 0;
    let p = 0;
    for (let i = 0; i < n; i += 1) {
      const w = good[Math.floor(rand() * n)] as WindowObservation;
      t += w.tokens;
      p += w.dPct;
    }
    reps.push(t / p);
  }
  reps.sort((a, b) => a - b);
  const own = good.map((w) => w.tokens / w.dPct).sort((a, b) => a - b);
  return {
    windows: obs.length,
    qualifying: good.length,
    abstained: false,
    reason: null,
    sumPercent: sumP,
    sumTokens: sumT,
    tokensPerPercent: rate,
    low: quantile(reps, 0.025),
    high: quantile(reps, 0.975),
    capacityTokens: rate * 100,
    spread: { p10: quantile(own, 0.1), median: quantile(own, 0.5), p90: quantile(own, 0.9) },
  };
}

const k = (x: number): string => (x >= 1_000_000 ? `${(x / 1_000_000).toFixed(1)}M` : `${Math.round(x / 1000)}K`);

export function renderLimitFit(fit: LimitFit, label: string): string {
  if (fit.abstained || fit.tokensPerPercent === null || fit.low === null || fit.high === null || fit.spread === null || fit.capacityTokens === null) {
    return `The ${label} limit: no estimate. ${fit.reason ?? ""} (${fit.windows} window${fit.windows === 1 ? "" : "s"} seen).`.trim();
  }
  return [
    `The ${label} limit costs about ${k(fit.tokensPerPercent)} tokens per percent (95% interval ${k(fit.low)} to ${k(fit.high)}), so about ${k(fit.capacityTokens)} tokens for a full window, from ${fit.qualifying} windows that moved the percent by ${Math.round(fit.sumPercent)} points in all.`,
    `Windows differ: the middle ones lie between ${k(fit.spread.p10)} and ${k(fit.spread.p90)} per percent, with a median of ${k(fit.spread.median)}. The percent is in whole points and other devices use the same plan, so this is not a forecast for one window.`,
  ].join("\n");
}
