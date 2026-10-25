/**
 * Where the month is likely to end, with a range and a record of how such ranges have done (DF-035). The forecast is the plainest one that can be defended: what has been
 * spent so far, plus for each remaining day the average of the same weekday over the last four weeks. The range is not a formula: it is what the forecast's own errors were
 * on the owner's history. The same forecast is made as if it were each past day, using only what was known then, and the gap between what it said and what happened over the
 * next stretch of the same length gives the 10th and 90th percentiles of the error. Those are added to today's forecast.
 *
 * It is scored the same way. Walking forward through the history, the forecast is made on each day with the range the 8 weeks before it would have given, and the actual is
 * looked at afterwards: the share of actuals that fell inside is the coverage, by how far ahead the forecast looked. A range that was meant to hold 80% of the time and held
 * under 70% of the last 20 is widened by how much more it missed than it should have, and the answer says so. With less history than four weeks there is no seasonal pattern
 * to use and the answer is a straight line from the month so far, labelled as one, with no range.
 *
 * Every day is a UTC day, and every figure is a list-price estimate from logged tokens, never an invoice.
 */
export const FORECAST = { weeks: 4, errorWeeks: 8, level: 0.8, minErrors: 8, recent: 20, floor: 0.7, maxWiden: 3 } as const;

const DAY = 86_400_000;

export interface Forecast {
  /** The kind of forecast it is: from a weekly pattern with a range, or a straight line with none. */
  method: "seasonal" | "linear";
  month: string;
  /** Through this day (the last day with data) is spent; the rest is forecast. */
  asOf: string;
  spentMicros: number;
  daysLeft: number;
  /** The expected end of the month. */
  pointMicros: number;
  /** The 80% range of the end of the month; null for a straight line, which has no range to give. */
  lowMicros: number | null;
  highMicros: number | null;
  /** The number of past forecasts of this length the range was made from. */
  errorsUsed: number;
  /** How far the range was widened, 1 when it was not, and why. */
  widenedBy: number;
  note: string;
}

export interface Cohort {
  label: string;
  /** Forecasts of this length that were scored: the range was made with only what was known, and the actual is in. */
  n: number;
  covered: number;
  coverage: number | null;
}

export interface Scorecard {
  cohorts: Cohort[];
  /** The last twenty forecasts of all lengths together, newest origins: the set the widening rule reads. */
  recent: { n: number; covered: number; coverage: number | null };
}

/** A daily series with its first day; every day from `first` on has a value, zero for a day with no spend. */
export interface Daily {
  first: string;
  values: number[];
}

const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Build a daily series from day-keyed totals, filling the days between the first and the last with zero. */
export function dailySeries(byDay: ReadonlyMap<string, number>): Daily | null {
  const days = [...byDay.keys()].sort();
  if (days.length === 0) return null;
  const first = days[0] as string;
  const n = Math.round((dayMs(days[days.length - 1] as string) - dayMs(first)) / DAY) + 1;
  const values = Array.from({ length: n }, (_, i) => byDay.get(isoOf(dayMs(first) + i * DAY)) ?? 0);
  return { first, values };
}

/**
 * The spend expected on day index `t` (counted from the series start): the average of the same weekday over the four most recent such days known on the origin day,
 * however far ahead `t` is. Null with fewer than two such days.
 */
function expectedOn(v: readonly number[], origin: number, t: number): number | null {
  // The latest day on or before the origin that falls on the same weekday as t, then back a week at a time.
  const newest = t - 7 * Math.ceil((t - origin) / 7);
  const days: number[] = [];
  for (let k = 0; k < FORECAST.weeks; k += 1) {
    const i = newest - 7 * k;
    if (i >= 0) days.push(i);
  }
  if (days.length < 2) return null;
  return days.reduce((s, i) => s + (v[i] as number), 0) / days.length;
}

/** The forecast of the spend on the `h` days after `origin`, or null when the weekly pattern cannot be read. */
export function forecastAhead(v: readonly number[], origin: number, h: number): number | null {
  let total = 0;
  for (let j = 1; j <= h; j += 1) {
    const e = expectedOn(v, origin, origin + j);
    if (e === null) return null;
    total += e;
  }
  return total;
}

const sum = (v: readonly number[], from: number, to: number): number => {
  let s = 0;
  for (let i = from; i <= to; i += 1) s += v[i] ?? 0;
  return s;
};

/** The q-th quantile of a list by linear interpolation between order statistics. */
export function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0] as number;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (pos - lo);
}

/** The errors of an `h`-day forecast made on each of the `errorWeeks` weeks of origins ending at `last` (an origin must have its `h` days in the history). */
function errorsFor(v: readonly number[], last: number, h: number): number[] {
  const out: number[] = [];
  const firstOrigin = Math.max(FORECAST.weeks * 7 - 1, last - h - FORECAST.errorWeeks * 7 + 1);
  for (let origin = firstOrigin; origin + h <= last; origin += 1) {
    const f = forecastAhead(v, origin, h);
    if (f !== null) out.push(sum(v, origin + 1, origin + h) - f);
  }
  return out;
}

const daysInMonth = (iso: string): number => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();

/** The range for an `h`-day forecast from errors known up to `last`: its percentiles, widened when the recent record says it has been too narrow. */
function rangeFor(v: readonly number[], last: number, h: number, widen: number): { low: number; mid: number; high: number; n: number } | null {
  const errors = errorsFor(v, last, h);
  if (errors.length < FORECAST.minErrors) return null;
  const lo = quantile(errors, (1 - FORECAST.level) / 2);
  const hi = quantile(errors, 1 - (1 - FORECAST.level) / 2);
  // Widening scales both ends away from zero, so a range that did not cover moves outward and never inward.
  return { low: lo * (lo < 0 ? widen : 1 / widen), mid: quantile(errors, 0.5), high: hi * (hi > 0 ? widen : 1 / widen), n: errors.length };
}

const COHORTS: { label: string; from: number; to: number }[] = [
  { label: "1 to 7 days ahead", from: 1, to: 7 },
  { label: "8 to 14 days ahead", from: 8, to: 14 },
  { label: "15 to 31 days ahead", from: 15, to: 31 },
];

/**
 * The record of how the ranges would have done: walking forward through the history, each forecast is made with only what was known on its origin day and its range from
 * the 8 weeks before, and the actual is looked at after. Forecasts of 3, 7, 14, 21 and 28 days are scored on every origin that has the days to check against.
 */
export function scorecard(v: readonly number[]): Scorecard {
  const last = v.length - 1;
  const rows: { origin: number; h: number; covered: boolean }[] = [];
  for (const h of [3, 7, 14, 21, 28]) {
    // An origin needs four weeks of history, a range made from eight weeks of errors that all lie before it, and its own h days to check.
    for (let origin = FORECAST.weeks * 7 - 1 + FORECAST.errorWeeks * 7; origin + h <= last; origin += 1) {
      const f = forecastAhead(v, origin, h);
      const r = rangeFor(v, origin, h, 1);
      if (f === null || r === null) continue;
      const actual = sum(v, origin + 1, origin + h);
      rows.push({ origin, h, covered: actual >= f + r.low && actual <= f + r.high });
    }
  }
  const cohorts: Cohort[] = COHORTS.map((c) => {
    const mine = rows.filter((r) => r.h >= c.from && r.h <= c.to);
    const covered = mine.filter((r) => r.covered).length;
    return { label: c.label, n: mine.length, covered, coverage: mine.length === 0 ? null : covered / mine.length };
  });
  const recent = [...rows].sort((a, b) => b.origin - a.origin || a.h - b.h).slice(0, FORECAST.recent);
  const recentCovered = recent.filter((r) => r.covered).length;
  return { cohorts, recent: { n: recent.length, covered: recentCovered, coverage: recent.length === 0 ? null : recentCovered / recent.length } };
}

/**
 * The forecast for the month the series ends in. `lastDay` is the last day with data, counted as spent; the rest of the month is forecast from the next day on.
 */
export function forecastMonth(daily: Daily, card: Scorecard = scorecard(daily.values)): Forecast {
  const v = daily.values;
  const last = v.length - 1;
  const asOf = isoOf(dayMs(daily.first) + last * DAY);
  const month = asOf.slice(0, 7);
  const total = daysInMonth(asOf);
  const dom = Number(asOf.slice(8, 10));
  const daysLeft = total - dom;
  const monthStart = last - (dom - 1);
  const spent = sum(v, Math.max(0, monthStart), last);
  const base = { month, asOf, spentMicros: spent, daysLeft };
  if (daysLeft === 0) return { ...base, method: "seasonal", pointMicros: spent, lowMicros: spent, highMicros: spent, errorsUsed: 0, widenedBy: 1, note: "The month is over: the figure is what was spent." };
  const f = forecastAhead(v, last, daysLeft);
  if (f === null || v.length < FORECAST.weeks * 7) {
    // No weekly pattern to read: a straight line from the days of this month that have gone, said to be one.
    const elapsed = dom - (monthStart < 0 ? -monthStart : 0);
    const perDay = elapsed > 0 ? spent / elapsed : 0;
    return { ...base, method: "linear", pointMicros: Math.round(spent + perDay * daysLeft), lowMicros: null, highMicros: null, errorsUsed: 0, widenedBy: 1, note: "Linear, no history: fewer than four weeks of days, so no weekly pattern to use and no range to give." };
  }
  const recent = card.recent;
  const miss = recent.coverage === null ? null : 1 - recent.coverage;
  const widen = recent.n >= FORECAST.recent && recent.coverage !== null && recent.coverage < FORECAST.floor ? Math.min(FORECAST.maxWiden, (miss as number) / (1 - FORECAST.level)) : 1;
  const r = rangeFor(v, last, daysLeft, widen);
  if (r === null) return { ...base, method: "seasonal", pointMicros: Math.round(spent + f), lowMicros: null, highMicros: null, errorsUsed: errorsFor(v, last, daysLeft).length, widenedBy: 1, note: `The weekly pattern gives ${Math.round(spent + f)} micro-dollars, but fewer than ${FORECAST.minErrors} past forecasts of ${daysLeft} days exist to make a range from.` };
  // A month cannot end below what has been spent, so neither end of the range goes under it. The best guess is the middle of the range, the forecast moved by the middle of its
  // own past errors: a forecast that has run high on this ledger is not offered as the likeliest figure beside a range that sits below it.
  const low = Math.max(spent, Math.round(spent + f + r.low));
  return {
    ...base,
    method: "seasonal",
    pointMicros: Math.max(low, Math.round(spent + f + r.mid)),
    lowMicros: low,
    highMicros: Math.max(low, Math.round(spent + f + r.high)),
    errorsUsed: r.n,
    widenedBy: widen,
    note: widen > 1 ? `Widened ${widen.toFixed(1)} times: the last ${recent.n} ranges of this kind held ${Math.round((recent.coverage as number) * 100)}% of the time, and an ${FORECAST.level * 100}% range should hold about 80%.` : "",
  };
}
