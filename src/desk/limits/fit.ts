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
  /** The tool's own label for the window (primary or secondary). It does not say how long the window is: a free Codex plan's primary window is a week or a month, a paid plan's is five hours. */
  kind?: "primary" | "secondary";
  /** Only readings of a window this long. A plan's limit is learned per window length. */
  windowMinutes?: number;
  /** Only readings made on this plan. `null` selects readings that carry no plan; leave it out to take every plan. Plans differ in what a percent is worth. */
  planType?: string | null;
  /** Which models draw on the plan. The default is the tool's own provider's models; calls through other providers do not count against it. */
  modelFilter?: (model: string) => boolean;
}

const OPENAI_MODEL = /^(gpt|o\d|codex)/i;
const CLAUDE_MODEL = /^claude/i;

/** Which models draw on a tool's plan: its own provider's. Calls routed to other providers do not. */
export function modelsOfTool(tool: string): (model: string) => boolean {
  return (m) => (tool === "codex" ? OPENAI_MODEL.test(m) : tool === "claude_code" ? CLAUDE_MODEL.test(m) : true);
}

export interface LimitGroup {
  windowMinutes: number;
  planType: string | null;
  samples: number;
  firstTs: string;
  lastTs: string;
}

/** The kinds of limit a tool's readings describe: each plan and window length is its own limit, newest first. */
export function limitGroups(db: Ledger, tool: string, until?: Date): LimitGroup[] {
  return db
    .prepare("SELECT window_minutes AS windowMinutes, plan_type AS planType, COUNT(*) AS samples, MIN(ts) AS firstTs, MAX(ts) AS lastTs FROM limit_sample WHERE tool = ? AND ts <= ? GROUP BY window_minutes, plan_type ORDER BY lastTs DESC, windowMinutes")
    .all(tool, until === undefined ? "9999-12-31T23:59:59.999Z" : until.toISOString()) as unknown as LimitGroup[];
}

export function windowLabel(minutes: number): string {
  if (minutes === 300) return "5-hour";
  if (minutes === 10_080) return "weekly";
  if (minutes === 43_200) return "30-day";
  if (minutes === 1_440) return "daily";
  return minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
}

export function groupLabel(g: Pick<LimitGroup, "windowMinutes" | "planType">): string {
  return `${g.planType === null ? "unknown plan" : `${g.planType} plan`}, ${windowLabel(g.windowMinutes)} window`;
}

export function observeWindows(db: Ledger, opts: ObserveOptions): WindowObservation[] {
  const filter = opts.modelFilter ?? modelsOfTool(opts.tool);
  if (opts.kind === undefined && opts.windowMinutes === undefined) throw new RangeError("observeWindows needs a kind or a window length");
  const where = ["tool = ?"];
  const args: (string | number)[] = [opts.tool];
  if (opts.kind !== undefined) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  if (opts.windowMinutes !== undefined) {
    where.push("window_minutes = ?");
    args.push(opts.windowMinutes);
  }
  if (opts.planType === null) where.push("plan_type IS NULL");
  else if (opts.planType !== undefined) {
    where.push("plan_type = ?");
    args.push(opts.planType);
  }
  const samples = db
    .prepare(`SELECT ts, used_percent AS pct, resets_at AS resetsAt, window_minutes AS windowMinutes, kind FROM limit_sample WHERE ${where.join(" AND ")} ORDER BY ts, session_id`)
    .all(...args) as unknown as { ts: string; pct: number; resetsAt: number; windowMinutes: number; kind: "primary" | "secondary" }[];
  // A window is one reset time of one kind: two plans or two labels that happen to reset together are separate windows.
  const byWindow = new Map<string, typeof samples>();
  for (const s of samples) {
    const key = `${s.kind}|${s.resetsAt}`;
    byWindow.set(key, [...(byWindow.get(key) ?? []), s]);
  }

  const calls = db
    .prepare("SELECT m.ts AS ts, m.model AS model, m.input_tokens AS i, m.cache_read_tokens AS c, m.output_tokens AS o FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE s.tool = ? ORDER BY m.ts")
    .all(opts.tool) as unknown as { ts: string; model: string; i: number; c: number; o: number }[];
  const times = calls.map((c) => Date.parse(c.ts));

  const out: WindowObservation[] = [];
  for (const list of byWindow.values()) {
    if (list.length < 2) continue;
    const first = list[0] as (typeof samples)[number];
    const resetsAt = first.resetsAt;
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
    out.push({ kind: first.kind, resetsAt, windowMinutes: first.windowMinutes, firstTs: first.ts, lastTs: last.ts, firstPct: first.pct, lastPct: last.pct, dPct: last.pct - first.pct, tokens, calls: n });
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

export interface LeaveOneOut {
  /** Windows the fit itself would use (the percent moved enough and tokens were seen). */
  windows: number;
  /** The median distance, in points of the limit, between what a window moved and what the rate fitted on all the others predicts. Null with fewer than three windows. */
  medianAbsPoints: number | null;
  /** The same as a share of what the window moved. */
  medianRelative: number | null;
  worstAbsPoints: number | null;
  /** Windows predicted within 25% and within 50% of what they moved. */
  withinQuarter: number;
  withinHalf: number;
}

/**
 * How well "tokens in a window, over the rate learned from the other windows" predicts the points a window moved. It is
 * the honest answer to whether the estimate can be used for one window, as opposed to saying what a percent costs on average.
 */
export function leaveOneOut(obs: readonly WindowObservation[], opts: Pick<FitOptions, "minPercent"> = {}): LeaveOneOut {
  const minPercent = opts.minPercent ?? 10;
  const good = obs.filter((w) => w.dPct >= minPercent && w.tokens > 0);
  if (good.length < 3) return { windows: good.length, medianAbsPoints: null, medianRelative: null, worstAbsPoints: null, withinQuarter: 0, withinHalf: 0 };
  const sumP = good.reduce((s, w) => s + w.dPct, 0);
  const sumT = good.reduce((s, w) => s + w.tokens, 0);
  const abs: number[] = [];
  const rel: number[] = [];
  for (const w of good) {
    const rate = (sumT - w.tokens) / (sumP - w.dPct);
    const predicted = w.tokens / rate;
    abs.push(Math.abs(predicted - w.dPct));
    rel.push(Math.abs(predicted - w.dPct) / w.dPct);
  }
  const sortedAbs = [...abs].sort((a, b) => a - b);
  const sortedRel = [...rel].sort((a, b) => a - b);
  return {
    windows: good.length,
    medianAbsPoints: quantile(sortedAbs, 0.5),
    medianRelative: quantile(sortedRel, 0.5),
    worstAbsPoints: sortedAbs[sortedAbs.length - 1] as number,
    withinQuarter: rel.filter((r) => r <= 0.25 + 1e-9).length,
    withinHalf: rel.filter((r) => r <= 0.5 + 1e-9).length,
  };
}

export function renderLeaveOneOut(r: LeaveOneOut): string {
  if (r.medianAbsPoints === null || r.medianRelative === null) return "Too few windows to test the prediction on a window left out.";
  return `Predicting a window from the others: the median error is ${r.medianAbsPoints.toFixed(1)} points (${Math.round(r.medianRelative * 100)}% of what the window moved); ${r.withinQuarter} of ${r.windows} windows are within 25% and ${r.withinHalf} within 50%.`;
}
