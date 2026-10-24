/**
 * Days in a person's own time zone. The ledger keeps UTC; "yesterday" for a person is the calendar day that just ended where they
 * are. A day's window is half open, [start, end), so no call is counted twice across midnight.
 */

/** The machine's own zone, or UTC when the runtime cannot say. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const parts = (ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o["year"] as number, mo: o["month"] as number, d: o["day"] as number, h: o["hour"] as number, mi: o["minute"] as number, s: o["second"] as number };
};

/** How far the zone is ahead of UTC at an instant, in milliseconds. */
function offsetAt(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The calendar date, as YYYY-MM-DD, that an instant falls on in the zone. */
export function localDate(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${String(p.y).padStart(4, "0")}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The calendar date before or after another, as a pure date: no zone, no daylight saving. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The instants at which a local calendar day starts and the next one starts, handling a day that is 23 or 25 hours long. */
export function localDayRange(date: string, tz: string): { startMs: number; endMs: number } {
  const startOf = (day: string): number => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    const guess = Date.UTC(y, m - 1, d);
    const first = guess - offsetAt(guess, tz);
    const second = guess - offsetAt(first, tz);
    return second;
  };
  return { startMs: startOf(date), endMs: startOf(addDays(date, 1)) };
}

export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
