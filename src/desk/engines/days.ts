/** Calendar-day arithmetic on `YYYY-MM-DD` strings in UTC. No time zones, no clocks. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(text: string): boolean {
  const m = ISO.exec(text);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === text;
}

export function toMs(day: string): number {
  if (!isIsoDate(day)) throw new RangeError(`not a calendar date: ${day}`);
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  return new Date(toMs(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

/** Start and end instants for a day range, `to` inclusive, in the ledger's timestamp format. */
export function rangeBounds(from: string, to: string): { since: string; until: string } {
  return { since: `${from}T00:00:00.000Z`, until: `${addDays(to, 1)}T00:00:00.000Z` };
}
