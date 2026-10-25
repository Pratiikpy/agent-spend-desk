/**
 * The wording lint (DF-080): text that would overclaim is never shown. It reads what the Desk writes (answers, cards, bills, screens, the README, the deck)
 * and fails on a word that claims more than the evidence does. The rules come from the project's own honesty rule and the specification:
 *
 *   proved          reserved for the restrict-only check, which is a proof that an edited policy only narrows the one in force, and for the offline verifier
 *   as good as      only after an equivalence has been shown
 *   regressed       only with a verdict, an interval or a control arm in sight
 *   billed          only for the billed class, never for an estimate
 *   caused by       never, for attribution: a cause is a part of the cost, not a verdict
 *   best, optimal, production-ready, guaranteed, certified, perfect, state of the art    never, unless the sentence says it is not claimed
 *   will save, saves you                                                                 a saving is a replay of recorded sessions, not a promise
 *   accurate        only beside the measurement
 *
 * A line is exempt from a rule only when it carries the context the rule names, and every exemption is a pattern in this file with its reason, so a reviewer can
 * read what is allowed and why. A word that is being denied right beside it ("not proof of", "cannot prove", "no guarantee") is not making the claim.
 */
export interface WordingRule {
  id: string;
  pattern: RegExp;
  /** A line, or the lines either side of it, that matches this is allowed to use the word: the context that makes the use honest. */
  unless?: RegExp;
  why: string;
  /** Applies to what the Desk generates (an answer, a bill, a screen), not only to prose that a person wrote and reviewed. */
  generated: boolean;
  /** A denial of the claim right beside the word ("not proof", "cannot prove", "never claimed") is not the claim, and passes. */
  denial?: boolean;
}

/** Phrases that say the claim is not being made, whatever word it is about. */
const NOT_CLAIMED = /NOT VERIFIED|is not claimed|are not claimed|never claim|claims? nothing|not claimed|no claim|unproven|unverified|not a promise|no promise|not promised/i;

export const RULES: readonly WordingRule[] = [
  {
    id: "proved",
    pattern: /\b(proved|proves|proven|prove[sd]? that|proof)\b/i,
    unless: new RegExp(String.raw`restrict|narrow|solver|by proof|tamper|signature proves|signed|verifier|verif|dossier|byte|row_hash|desk prove|npm run desk -- prove|\bprove\b.*\bcheck|check.*\bprove|\bprove\b.*(PASS|FAIL)|prove (every|all|runs)|\bprove:`, "i"),
    why: "\"proved\" is reserved for the restrict-only check and the offline verifier, which are proofs; elsewhere say what was measured",
    generated: true,
    denial: true,
  },
  { id: "as-good-as", pattern: /\bas good as\b/i, unless: /equivalen|is the agent still as good|still as good|only as good as/i, why: "\"as good as\" claims an equivalence that has not been shown", generated: true },
  {
    id: "regressed",
    pattern: /\bregressed\b|\bregress(?:es|ion)\b(?!\s+(?:test|tests|index|suite|study|rule|statistic|check|gate|case|cases|loop))/i,
    unless: new RegExp(String.raw`\b(not|no|never|cannot|nor)\b|verdict|interval|control|canary|planted|statistic|window|rule|called|day \d|points|model switch|first run|simulat|false.alarm|power|study|the Desk calls|caught|detect|signal|lesson|accepted`, "i"),
    why: "\"regressed\" is a verdict the canary reaches with an interval and a control arm, not a description",
    generated: true,
  },
  {
    id: "billed",
    pattern: /\bbilled\b/i,
    unless: /^\s*billed\s*:?\s*$|invoice|billed class|billed (amount|figure|total|dollars|against|and|or|by|to)|against (the )?billed|reported|vendor|charged|Zetaris|silo|import|reconcil|actual|line|statement|month|class|the bill|desk invoices|not billed|nothing here is billed|no invoice|whether it was billed|what was billed/i,
    why: "\"billed\" is the class of an amount an invoice states; an estimate is not billed",
    generated: true,
  },
  { id: "caused-by", pattern: /\bcaused by\b/i, unless: /\b(not|never|no|cannot|isn't|nor)\b[^.]{0,40}caused by/i, why: "\"caused by\" asserts attribution; a cause in the autopsy is a part of the cost, not a verdict", generated: true },
  {
    id: "overclaim",
    pattern: /\b(best|optimal|production[- ]ready|state[- ]of[- ]the[- ]art|guarantee[ds]?|certified|flawless|perfect(ly)?|seamless(ly)?|bulletproof|foolproof|never wrong|100% (accurate|correct|safe|secure))\b/i,
    why: "an overclaim: say what was measured, or say that it is not claimed",
    generated: true,
    denial: true,
  },
  { id: "promise-of-saving", pattern: /\b(will save|saves you|you will save|guaranteed saving|you['’]ll save)\b/i, why: "a saving is a replay of recorded sessions, not a promise", generated: true, denial: true },
  {
    id: "accurate",
    pattern: /\b(accurate(ly)?|accuracy)\b/i,
    unless: new RegExp(String.raw`measured|within|%|interval|percent|agree|tolerance|to the (token|cent|micro)|exact`, "i"),
    why: "\"accurate\" needs the measurement beside it",
    generated: false,
    denial: true,
  },
];

export interface WordingFinding {
  rule: string;
  line: number;
  text: string;
  why: string;
}

/** Whether position `index` of `line` lies inside a pair of double quotes or backticks (curly quotes included). */
export function isQuoted(line: string, index: number): boolean {
  let dq = false;
  let tick = false;
  for (let i = 0; i < index; i += 1) {
    const c = line[i];
    if (c === '"' || c === "“" || c === "”") dq = !dq;
    else if (c === "`") tick = !tick;
  }
  return dq || tick;
}

/** Lint `text`, line by line, reading each line with the ones either side. `generated` limits the rules to text the Desk writes; prose also gets the rest. */
export function lintWording(text: string, opts: { generated?: boolean; skip?: readonly string[] } = {}): WordingFinding[] {
  const out: WordingFinding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    const context = `${lines[i - 1] ?? ""} ${raw} ${lines[i + 1] ?? ""}`;
    for (const r of RULES) {
      if (opts.generated === true && !r.generated) continue;
      if (opts.skip?.includes(r.id)) continue;
      const m = r.pattern.exec(line);
      if (m === null) continue;
      // A word that is quoted or set in code is being mentioned, as this file and the notes about it do, not used.
      if (isQuoted(line, m.index)) continue;
      if (r.unless !== undefined && (r.unless.test(line) || r.unless.test(context))) continue;
      if (r.denial === true) {
        // "not proof of", "cannot prove", "no guarantee": the word is being denied, right beside it.
        const near = new RegExp(String.raw`\b(?:not|never|no|nor|isn't|aren't|cannot|can't|without|nothing|neither)\b\s+(?:[\w'-]+\s+){0,3}(?:${r.pattern.source})`, "i");
        if (near.test(line) || NOT_CLAIMED.test(line)) continue;
      }
      out.push({ rule: r.id, line: i + 1, text: line.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40), why: r.why });
    }
  });
  return out;
}
