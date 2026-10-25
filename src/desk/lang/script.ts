/**
 * What script a prompt is written in, by a rule that can be read and run again (DF-043). The text is classified by the Unicode script of each letter, and nothing else is guessed: no
 * model, no word list for any language but English, and no name for a language that a script does not settle (Han characters are Chinese or Japanese; Latin letters are English,
 * French, Vietnamese). The result is recorded as extracted, with the counts it came from, so a reader can check it against the text.
 */
export const SCRIPTS = ["latin", "cyrillic", "greek", "arabic", "hebrew", "devanagari", "bengali", "gurmukhi", "gujarati", "tamil", "telugu", "kannada", "malayalam", "thai", "hangul", "kana", "han"] as const;
export type Script = (typeof SCRIPTS)[number];

/**
 * What a prompt is labelled. `en` is Latin script with English function words in it, the only language the rule names, because the surcharge is measured against English.
 * `latin` is Latin script that is not shown to be English (code, a short fragment, another Latin-script language). `japanese` is kana with or without Han characters; `han` is Han
 * characters alone. `mixed` is two or more non-Latin scripts none of which carries the text; `none` is text with no letters.
 */
export type Label = "en" | "latin" | "cyrillic" | "greek" | "arabic" | "hebrew" | "devanagari" | "bengali" | "gurmukhi" | "gujarati" | "tamil" | "telugu" | "kannada" | "malayalam" | "thai" | "korean" | "japanese" | "han" | "mixed" | "none";

export const LABEL_NAME: Record<Label, string> = {
  en: "English",
  latin: "Latin script, not shown to be English",
  cyrillic: "Cyrillic",
  greek: "Greek",
  arabic: "Arabic script",
  hebrew: "Hebrew",
  devanagari: "Devanagari",
  bengali: "Bengali",
  gurmukhi: "Gurmukhi",
  gujarati: "Gujarati",
  tamil: "Tamil",
  telugu: "Telugu",
  kannada: "Kannada",
  malayalam: "Malayalam",
  thai: "Thai",
  korean: "Korean (Hangul)",
  japanese: "Japanese (kana)",
  han: "Han characters",
  mixed: "mixed scripts",
  none: "no letters",
};

const SCRIPT_TESTS: [Script, RegExp][] = [
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["bengali", /\p{Script=Bengali}/u],
  ["gurmukhi", /\p{Script=Gurmukhi}/u],
  ["gujarati", /\p{Script=Gujarati}/u],
  ["tamil", /\p{Script=Tamil}/u],
  ["telugu", /\p{Script=Telugu}/u],
  ["kannada", /\p{Script=Kannada}/u],
  ["malayalam", /\p{Script=Malayalam}/u],
  ["thai", /\p{Script=Thai}/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["han", /\p{Script=Han}/u],
];

/** The share of letters that must be in scripts other than Latin before a prompt is labelled by one of them. Code and identifiers are Latin letters in a Japanese or Hindi prompt. */
export const NON_LATIN_SHARE = 0.3;
/** At least this many words, and at least this share of them English function words, before Latin text is called English. */
export const ENGLISH_MIN_WORDS = 6;
export const ENGLISH_SHARE = 0.18;

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "these", "those", "i", "you", "he", "she", "we", "they", "me", "my", "your", "our", "not", "no", "can", "could", "will", "would", "should", "do", "does", "did", "have", "has",
  "had", "what", "how", "why", "when", "where", "which", "who", "please", "so", "then", "there", "here", "also", "just", "into", "about", "after", "before", "than", "all",
]);

/** The parts of a user message that are the harness's, not the person's: reminders and notes about the editor that Claude Code writes into the message. */
const WRAPPER = /<(system-reminder|ide_[a-z_]+|command-[a-z]+|local-command-[a-z]+|user-prompt-submit-hook)>[\s\S]*?<\/\1>/gi;

export interface ScriptFacts {
  label: Label;
  /** Code points of the text the person wrote, with the harness's wrappers taken out. */
  chars: number;
  /** Letters among them. */
  letters: number;
  /** The share of the letters in the script that decided the label, 0 to 1. */
  share: number;
}

export function stripWrappers(text: string): string {
  return text.replace(WRAPPER, " ");
}

function scriptOf(ch: string): Script | null {
  for (const [name, re] of SCRIPT_TESTS) if (re.test(ch)) return name;
  return null;
}

export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < ENGLISH_MIN_WORDS) return false;
  const hits = words.filter((w) => FUNCTION_WORDS.has(w)).length;
  return hits / words.length >= ENGLISH_SHARE;
}

export function classify(raw: string): ScriptFacts {
  const text = stripWrappers(raw).replace(/\s+/g, " ").trim();
  const counts = new Map<Script, number>();
  let letters = 0;
  let chars = 0;
  for (const ch of text) {
    chars += 1;
    // A vowel sign or a combining accent is a mark, not a letter, but it is part of the word it is written on: counting only letters would make Hindi look like punctuation.
    if (!/[\p{L}\p{M}]/u.test(ch)) continue;
    letters += 1;
    const s = scriptOf(ch);
    if (s !== null) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (letters === 0) return { label: "none", chars, letters, share: 0 };
  const n = (s: Script): number => counts.get(s) ?? 0;
  const nonLatin = [...counts].filter(([s]) => s !== "latin");
  const nonLatinLetters = nonLatin.reduce((a, [, c]) => a + c, 0);
  if (nonLatinLetters / letters < NON_LATIN_SHARE) {
    const latin = n("latin");
    return { label: looksEnglish(text) ? "en" : "latin", chars, letters, share: latin / letters };
  }
  // Japanese is written with Han characters and kana together; kana alone settles it.
  const cjk = n("kana") + n("han");
  if (n("kana") > 0 && cjk / nonLatinLetters >= 0.5) return { label: "japanese", chars, letters, share: cjk / letters };
  const [top, topCount] = nonLatin.slice().sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] as [Script, number];
  if (topCount / nonLatinLetters < 0.7) return { label: "mixed", chars, letters, share: topCount / letters };
  const label: Label = top === "hangul" ? "korean" : top === "kana" ? "japanese" : (top as Label);
  return { label, chars, letters, share: topCount / letters };
}
