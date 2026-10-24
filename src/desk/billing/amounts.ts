/**
 * Money read from text, without floating point. An amount becomes a whole number of micro-units (1 unit = 1,000,000 micros) by
 * working on the digits, so "0.1" and "0.2" add to exactly "0.3". It accepts a leading currency sign or code, thousands
 * separators (commas), a minus sign or accounting parentheses for a negative, and up to six decimal places. Anything else is
 * refused, never guessed: a figure in another style (a decimal comma, a space as thousands separator) is an error the
 * person can see and fix, not a number read wrongly.
 */
export interface ParsedAmount {
  micros: number;
  /** An ISO 4217 code or a symbol found beside the number, or null. */
  currency: string | null;
}

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };

export function parseAmount(raw: string): ParsedAmount | null {
  let t = raw.trim();
  if (t === "") return null;
  let negative = false;
  if (t.startsWith("(") && t.endsWith(")")) {
    negative = true;
    t = t.slice(1, -1).trim();
  }
  let currency: string | null = null;
  const lead = /^([A-Za-z]{3})\s*(?=[-+0-9.($€£¥₹])/.exec(t);
  if (lead) {
    currency = lead[1]!.toUpperCase();
    t = t.slice(lead[0].length);
  }
  const tail = /\s*([A-Za-z]{3})$/.exec(t);
  if (tail && currency === null) {
    currency = tail[1]!.toUpperCase();
    t = t.slice(0, t.length - tail[0].length);
  }
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1).trim();
  } else if (t.startsWith("+")) t = t.slice(1).trim();
  const symbol = SYMBOLS[t[0] ?? ""];
  if (symbol !== undefined) {
    currency ??= symbol;
    t = t.slice(1).trim();
    // A sign may follow the currency sign ("$-3.00") but never a second sign ("--5").
    if (t.startsWith("-")) {
      negative = !negative;
      t = t.slice(1).trim();
    }
  }
  // Digits with optional comma thousands groups, then an optional fraction of at most six digits.
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,6}))?$/.exec(t) ?? /^\.(\d{1,6})$/.exec(t);
  if (!m) return null;
  const whole = m.length === 2 ? "0" : m[1]!.replace(/,/g, "");
  const frac = (m.length === 2 ? m[1]! : (m[2] ?? "")).padEnd(6, "0");
  const micros = Number(whole) * 1_000_000 + Number(frac);
  if (!Number.isSafeInteger(micros)) return null;
  return { micros: negative ? -micros : micros, currency };
}
