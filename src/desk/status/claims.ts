/**
 * The claim registry check. A claim is a sentence in a document that states a figure or a capability, registered with
 * the file it appears in, the words it appears as, its evidence level, and one or more supports: a file and a pattern
 * that file must hold. The check fails when a quote is no longer in its document, when a support file is missing, or
 * when the support no longer holds the pattern, so a changed result or an edited sentence cannot drift apart silently.
 * A second function lists the figures in a document that no registered claim covers, which is how a figure added
 * without evidence is found.
 */
export const CLAIM_LEVELS = ["observed", "estimated", "experimentally_supported", "history", "design"] as const;
export type ClaimLevel = (typeof CLAIM_LEVELS)[number];

export interface ClaimSupport {
  file: string;
  /** A regular expression source the support file must match. */
  pattern: string;
}

export interface Claim {
  id: string;
  file: string;
  quote: string;
  level: ClaimLevel;
  supports: ClaimSupport[];
  note?: string;
}

export interface ClaimProblem {
  id: string;
  problem: string;
}

export interface ClaimIo {
  /** The text of a repository file, or null when it does not exist. */
  read(path: string): string | null;
}

/** Markdown emphasis, backticks and runs of whitespace do not make a different sentence. */
export function plain(text: string): string {
  return text.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim();
}

export function checkClaims(claims: readonly Claim[], io: ClaimIo): ClaimProblem[] {
  const out: ClaimProblem[] = [];
  const seen = new Set<string>();
  for (const c of claims) {
    const problem = (p: string): void => void out.push({ id: c.id, problem: p });
    if (seen.has(c.id)) problem(`id ${c.id} is used twice`);
    seen.add(c.id);
    if (!(CLAIM_LEVELS as readonly string[]).includes(c.level)) problem(`unknown evidence level "${c.level}"`);
    const host = io.read(c.file);
    if (host === null) problem(`${c.file} does not exist`);
    else if (!plain(host).includes(plain(c.quote))) problem(`the quote is not in ${c.file}: "${c.quote.slice(0, 60)}"`);
    if (c.level !== "design" && c.supports.length === 0) problem("a claim above design level has no support");
    for (const s of c.supports) {
      const text = io.read(s.file);
      if (text === null) {
        problem(`support ${s.file} does not exist`);
        continue;
      }
      let re: RegExp;
      try {
        re = new RegExp(s.pattern);
      } catch {
        problem(`support pattern for ${s.file} is not a valid expression`);
        continue;
      }
      if (!re.test(text)) problem(`support ${s.file} does not hold /${s.pattern}/`);
    }
  }
  return out;
}

const NOUNS = "tests?|checks?|files?|commands?|screens?|lines|questions?|runs?|sessions?|slides?|features?|points?|days?|calls?|tasks?|engineers?|agents?|roles?|pages?|rows?|silos?|sources?|months?|trials?|words?|minutes?|seconds?|hours?|samples?|models?|rounds?|mistakes?|lessons?";
const FIGURE = new RegExp(String.raw`(?:-?\$\s?\d[\d,]*(?:\.\d+)?)|(?:-?\d[\d,]*(?:\.\d+)?\s?%)|(?:-?\d[\d,]*(?:\.\d+)?\s(?:${NOUNS})\b)`, "gi");

/** Dollar amounts, percentages and counts with a unit. Dates, years, version numbers and bare numbers are not figures here. */
export function figuresIn(text: string): string[] {
  const found = plain(text).match(FIGURE) ?? [];
  return found.map((f) => f.trim()).filter((f) => !/^(19|20)\d\d$/.test(f));
}

/** Figures in `text` (a document called `file`) that no claim registered for that file contains. */
export function uncoveredFigures(file: string, text: string, claims: readonly Claim[]): string[] {
  const quotes = claims.filter((c) => c.file === file).map((c) => plain(c.quote));
  const out: string[] = [];
  for (const f of figuresIn(text)) if (!quotes.some((q) => q.includes(f)) && !out.includes(f)) out.push(f);
  return out;
}
