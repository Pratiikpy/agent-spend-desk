import { addDays, daysBetween, isIsoDate } from "../engines/days.ts";
import type { Coverage } from "./specialists.ts";

/**
 * Reading a period out of a plain-language question. "Today" is the last day the ledger covers, never the
 * clock, so the same question gives the same program on any day.
 */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface Period {
  from: string;
  to: string;
  source: "iso" | "month" | "relative" | "default";
}

const pad = (n: number): string => String(n).padStart(2, "0");

function monthIndex(name: string): number {
  const key = name.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(key));
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** The year a month name most likely means: the latest one that has begun by the end of the ledger. */
function yearFor(month0: number, cov: Coverage, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const endYear = Number(cov.end.slice(0, 4));
  const first = `${endYear}-${pad(month0 + 1)}-01`;
  return first <= cov.end ? endYear : endYear - 1;
}

/** Every calendar day the question names: ISO dates, "14 October", "October 14", with or without a year. */
export function namedDays(question: string, cov: Coverage): string[] {
  const days: string[] = [];
  for (const m of question.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) if (isIsoDate(m[1] as string)) days.push(m[1] as string);
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`, "gi");
  const mdy = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?`, "gi");
  for (const m of question.matchAll(dmy)) push(days, Number(m[1]), m[2] as string, m[3], cov);
  for (const m of question.matchAll(mdy)) push(days, Number(m[2]), m[1] as string, m[3], cov);
  return [...new Set(days)];
}

function push(days: string[], day: number, month: string, year: string | undefined, cov: Coverage): void {
  const m0 = monthIndex(month);
  if (m0 < 0 || day < 1 || day > 31) return;
  const y = yearFor(m0, cov, year ? Number(year) : undefined);
  const iso = `${y}-${pad(m0 + 1)}-${pad(day)}`;
  if (isIsoDate(iso)) days.push(iso);
}

export function resolvePeriod(question: string, cov: Coverage): Period {
  const q = question.toLowerCase();
  const days = namedDays(question, cov).sort();
  if (days.length >= 2) return { from: days[0] as string, to: days[days.length - 1] as string, source: "iso" };
  if (days.length === 1) return { from: days[0] as string, to: days[0] as string, source: "iso" };

  for (const month of question.matchAll(new RegExp(`\\b${MONTH_RE}(?:\\s+(\\d{4}))?\\b`, "gi"))) {
    const name = (month[1] as string).toLowerCase();
    // "may" and "march" are also ordinary words: they name a month only after a preposition or with a year.
    const ambiguous = name === "may" || name === "mar" || name === "march";
    const before = question.slice(0, month.index).toLowerCase();
    if (ambiguous && !month[2] && !/\b(?:in|during|of|for|since|from|until|through|to)\s+$/.test(before)) continue;
    const m0 = monthIndex(name);
    const y = yearFor(m0, cov, month[2] ? Number(month[2]) : undefined);
    return { from: `${y}-${pad(m0 + 1)}-01`, to: `${y}-${pad(m0 + 1)}-${pad(lastDayOfMonth(y, m0))}`, source: "month" };
  }

  const rel = /\b(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month)s?\b/.exec(q);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] === "day" ? 1 : rel[2] === "week" ? 7 : 30;
    return { from: addDays(cov.end, -(n * unit) + 1), to: cov.end, source: "relative" };
  }
  if (/\b(?:last|past)\s+week\b|\bthis week\b/.test(q)) return { from: addDays(cov.end, -6), to: cov.end, source: "relative" };
  if (/\b(?:last|past)\s+month\b/.test(q)) return { from: addDays(cov.end, -29), to: cov.end, source: "relative" };
  if (/\bthis month\b/.test(q)) return { from: `${cov.end.slice(0, 8)}01`, to: cov.end, source: "relative" };
  if (/\b(?:yesterday|today|last day)\b/.test(q)) return { from: cov.end, to: cov.end, source: "relative" };
  return { from: cov.start, to: cov.end, source: "default" };
}

export function spanDays(p: { from: string; to: string }): number {
  return daysBetween(p.from, p.to) + 1;
}
