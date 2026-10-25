import { describe, expect, it } from "vitest";

import { dailySeries, forecastAhead, forecastMonth, FORECAST, quantile, scorecard, type Daily } from "../../src/desk/forecast/month.ts";
import { seeded } from "../../src/desk/replay/wind-tunnel.ts";

const DAY = 86_400_000;
const usd = (n: number): number => Math.round(n * 1_000_000);

/** A series starting on a Monday, `days` long, whose value on day i is `f(i)` dollars. 2026-08-03 is a Monday. */
function series(days: number, f: (i: number) => number, first = "2026-08-03"): Daily {
  return { first, values: Array.from({ length: days }, (_, i) => usd(f(i))) };
}
const WEEK = [10, 12, 14, 13, 11, 2, 1]; // Monday to Sunday
const weekly = (i: number): number => WEEK[i % 7] as number;
const isoOf = (first: string, i: number): string => new Date(Date.parse(`${first}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);

describe("the daily series", () => {
  it("fills the days with no spend with zero, between the first and the last", () => {
    const d = dailySeries(new Map([["2026-10-01", 5], ["2026-10-04", 7]]))!;
    expect(d).toEqual({ first: "2026-10-01", values: [5, 0, 0, 7] });
    expect(dailySeries(new Map())).toBeNull();
  });
});

describe("the forecast of the days ahead", () => {
  it("is the average of the same weekday over the last four weeks, for each day ahead", () => {
    const v = series(35, weekly).values;
    // From day 34 (a Sunday): the next day is a Monday, and so on; one week ahead is one week of the pattern.
    expect(forecastAhead(v, 34, 7)).toBe(usd(WEEK.reduce((a, b) => a + b, 0)));
    expect(forecastAhead(v, 34, 1)).toBe(usd(10));
  });

  it("uses the four most recent such days known on the origin however far ahead it looks, and none from after it", () => {
    // Mondays are 10 for the first three weeks and 100 for the last; a forecast made before the last Monday must not see it.
    const v = series(35, (i) => (i % 7 === 0 && i >= 28 ? 100 : weekly(i))).values;
    expect(forecastAhead(v, 27, 1)).toBe(usd(10));
    expect(forecastAhead(v, 28, 7)).toBeGreaterThan(forecastAhead(v, 27, 7)!);
    // Eight weeks ahead of day 27 is still a Monday, averaged from the same four known Mondays.
    expect(forecastAhead(v, 27, 56)).toBeCloseTo(usd(8 * WEEK.reduce((a, b) => a + b, 0)), -3);
  });

  it("says it cannot when there are fewer than two such days to average", () => {
    expect(forecastAhead(series(8, weekly).values, 7, 3)).toBeNull();
  });

  it("has a quantile that interpolates between the values on either side", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.1)).toBe(1);
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe("where the month is likely to end", () => {
  it("is what was spent plus the expected remaining days, with a range of no width on a series it can forecast exactly", () => {
    // 2026-08-03 is day 0; day 99 is 2026-11-10. November has 30 days: 20 days to go.
    const d = series(100, weekly);
    const f = forecastMonth(d);
    expect(f).toMatchObject({ method: "seasonal", month: "2026-11", asOf: "2026-11-10", daysLeft: 20 });
    const spent = d.values.slice(90).reduce((a, b) => a + b, 0); // 1 to 10 November: days 90 to 99
    expect(f.spentMicros).toBe(spent);
    expect(isoOf(d.first, 90)).toBe("2026-11-01");
    const ahead = forecastAhead(d.values, 99, 20)!;
    expect(f.pointMicros).toBe(Math.round(spent + ahead));
    // Every past forecast was exact, so the range has no width.
    expect(f.lowMicros).toBe(f.pointMicros);
    expect(f.highMicros).toBe(f.pointMicros);
    expect(f.errorsUsed).toBeGreaterThanOrEqual(FORECAST.minErrors);
  });

  it("is a straight line, said to be one, with no range, when there are fewer than four weeks of days", () => {
    const f = forecastMonth(series(20, () => 10, "2026-09-01"));
    expect(f).toMatchObject({ method: "linear", month: "2026-09", asOf: "2026-09-20", spentMicros: usd(200), daysLeft: 10, pointMicros: usd(300), lowMicros: null, highMicros: null });
    expect(f.note).toMatch(/^Linear, no history/);
  });

  it("is just the month's total when the month is over", () => {
    const f = forecastMonth(series(60, () => 5, "2026-08-02"));
    expect(f.asOf).toBe("2026-09-30");
    expect(f).toMatchObject({ daysLeft: 0, pointMicros: f.spentMicros, lowMicros: f.spentMicros, highMicros: f.spentMicros });
    expect(f.note).toMatch(/month is over/);
  });

  it("gives no range, and says so, when too few past forecasts of that length exist to make one", () => {
    // 35 days: a forecast needs 28 days of history, so only a handful of origins exist for a long horizon.
    const f = forecastMonth(series(35, weekly, "2026-08-03"));
    expect(f.method).toBe("seasonal");
    expect(f.lowMicros).toBeNull();
    expect(f.note).toMatch(/fewer than 8 past forecasts/);
  });

  it("spans more than the point on a noisy series, with the point inside its range", () => {
    const rng = seeded(7);
    const d = series(140, (i) => Math.max(0, weekly(i) * (0.6 + rng() * 0.8)));
    const f = forecastMonth(d);
    expect(f.method).toBe("seasonal");
    expect(f.lowMicros).not.toBeNull();
    expect(f.lowMicros!).toBeLessThan(f.highMicros!);
    expect(f.lowMicros!).toBeLessThanOrEqual(f.pointMicros + usd(1));
    expect(f.highMicros!).toBeGreaterThanOrEqual(f.pointMicros - usd(1));
    expect(f.lowMicros!).toBeGreaterThanOrEqual(f.spentMicros);
  });
});

describe("a forecast that has run high or low on this series", () => {
  it("never puts either end of the range under what has been spent, and keeps the best guess inside the range", () => {
    // Spending that falls away steadily: every past forecast was too high, so every past error is negative.
    const falling = series(160, (i) => Math.max(0.5, weekly(i) * (1 - i / 200)));
    const f = forecastMonth(falling);
    expect(f.lowMicros).not.toBeNull();
    expect(f.lowMicros!).toBeGreaterThanOrEqual(f.spentMicros);
    expect(f.highMicros!).toBeGreaterThanOrEqual(f.lowMicros!);
    expect(f.pointMicros).toBeGreaterThanOrEqual(f.lowMicros!);
    expect(f.pointMicros).toBeLessThanOrEqual(f.highMicros!);
    // And the other way: spending that climbs, every past forecast too low.
    const rising = series(160, (i) => weekly(i) * (1 + i / 80));
    const g = forecastMonth(rising);
    expect(g.pointMicros).toBeGreaterThanOrEqual(g.lowMicros!);
    expect(g.pointMicros).toBeLessThanOrEqual(g.highMicros!);
    expect(g.highMicros!).toBeGreaterThan(g.pointMicros);
  });

  it("moves the best guess by the middle of its own past errors, so a forecast that ran high is not offered as the likeliest figure beside a range below it", () => {
    const falling = series(160, (i) => Math.max(0.5, weekly(i) * (1 - i / 200)));
    const f = forecastMonth(falling);
    const naive = Math.round(f.spentMicros + forecastAhead(falling.values, falling.values.length - 1, f.daysLeft)!);
    expect(f.pointMicros).toBeLessThan(naive);
  });
});

describe("the scorecard: how the ranges would have done", () => {
  it("covers about as often as it claims on a series whose noise does not change", () => {
    const rng = seeded(11);
    const d = series(300, (i) => Math.max(0, weekly(i) * (0.6 + rng() * 0.8)));
    const c = scorecard(d.values);
    expect(c.cohorts.map((x) => x.label)).toEqual(["1 to 7 days ahead", "8 to 14 days ahead", "15 to 31 days ahead"]);
    for (const x of c.cohorts) {
      expect(x.n).toBeGreaterThan(50);
      expect(x.coverage).toBeGreaterThan(0.6);
      expect(x.coverage).toBeLessThan(0.97);
    }
    expect(c.recent.n).toBe(FORECAST.recent);
  });

  it("scores a forecast with only what was known when it was made", () => {
    // Two series that agree for 200 days and then differ wildly; scores of origins that finish before the change are the same.
    const a = series(230, weekly).values;
    const b = series(230, (i) => (i < 200 ? weekly(i) : weekly(i) * 10)).values;
    const pick = (v: number[]) => scorecard(v.slice(0, 200));
    expect(pick(a)).toEqual(pick(b));
    // And the exact series is always inside its own range.
    expect(scorecard(a).recent.coverage).toBe(1);
  });

  it("counts a range that never gets a chance to be checked as no forecast, and says n", () => {
    const c = scorecard(series(60, weekly).values);
    expect(c.cohorts.every((x) => x.n === 0 && x.coverage === null)).toBe(true);
    expect(c.recent).toEqual({ n: 0, covered: 0, coverage: null });
  });
});

describe("widening a range that has been too narrow", () => {
  /** A calm year and then spending that jumps and does not come back: the old pattern no longer describes it. */
  const broken = (): Daily => {
    const rng = seeded(5);
    return series(200, (i) => Math.max(0, weekly(i) * (0.85 + rng() * 0.3) * (i >= 150 ? 1 + (i - 150) * 0.05 : 1)));
  };

  it("widens when the last twenty ranges held under 70% of the time, by how much more they missed than they should have, and says so", () => {
    const d = broken();
    const card = scorecard(d.values);
    expect(card.recent.n).toBe(FORECAST.recent);
    expect(card.recent.coverage!).toBeLessThan(FORECAST.floor);
    const f = forecastMonth(d, card);
    expect(f.widenedBy).toBeGreaterThan(1);
    expect(f.widenedBy).toBeLessThanOrEqual(FORECAST.maxWiden);
    expect(f.note).toMatch(new RegExp(`^Widened ${f.widenedBy.toFixed(1)} times: the last 20 ranges of this kind held \\d+% of the time`));
    // The widened range contains the unwidened one.
    const calm = forecastMonth(d, { ...card, recent: { n: 20, covered: 20, coverage: 1 } });
    expect(calm.widenedBy).toBe(1);
    expect(f.highMicros! - f.lowMicros!).toBeGreaterThan(calm.highMicros! - calm.lowMicros!);
    expect(f.highMicros!).toBeGreaterThanOrEqual(calm.highMicros!);
    expect(f.lowMicros!).toBeLessThanOrEqual(calm.lowMicros!);
  });

  it("does not widen on fewer than twenty forecasts, or on a record at the floor, and never past the cap", () => {
    const d = broken();
    const card = scorecard(d.values);
    expect(forecastMonth(d, { ...card, recent: { n: 19, covered: 3, coverage: 3 / 19 } }).widenedBy).toBe(1);
    expect(forecastMonth(d, { ...card, recent: { n: 20, covered: 14, coverage: 0.7 } }).widenedBy).toBe(1);
    expect(forecastMonth(d, { ...card, recent: { n: 20, covered: 0, coverage: 0 } }).widenedBy).toBe(FORECAST.maxWiden);
    expect(forecastMonth(d, { ...card, recent: { n: 20, covered: 13, coverage: 0.65 } }).widenedBy).toBeCloseTo(0.35 / 0.2, 10);
  });
});

describe("the dates", () => {
  it("counts the remaining days of each month, a leap February included", () => {
    const f = (first: string, days: number) => forecastMonth(series(days, () => 1, first));
    expect(f("2028-01-04", 28 + 20).daysLeft).toBe(isoOf("2028-01-04", 47) === "2028-02-20" ? 9 : -1); // 29 days in February 2028
    expect(f("2026-12-01", 40).month).toBe("2027-01");
  });
});
