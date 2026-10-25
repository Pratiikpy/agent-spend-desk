/**
 * Text handling for Scout's Sense stage. Everything here is a pure function of the input: no model, no clock, no randomness, so a decision can be replayed from its prompt.
 */

/** Characters that change how text reads or hide it: bidirectional controls, zero-width characters, byte-order marks and C0/C1 controls other than tab, newline and carriage return. */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** What the scorer reads: compatibility-normalised, invisible and direction-changing characters taken out, whitespace collapsed. */
export function normalize(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

/** Whether a text carries characters of the kind `normalize` removes. A prompt that does is evidence worth flagging on its own. */
export function hasInvisible(text: string): boolean {
  INVISIBLE.lastIndex = 0;
  return INVISIBLE.test(text);
}

/** Words that frame a request and say nothing about which intent it is. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "from", "with", "by", "as", "than", "then", "so", "if", "not", "no",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "have", "has", "had", "having", "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours", "he", "she", "it", "its", "they", "them", "their", "this", "that", "these", "those", "there", "here",
  "what", "which", "who", "whom", "when", "why", "how", "please", "just", "also", "any", "some", "about", "into", "up", "out", "over", "again", "very", "too", "s", "t", "ll", "d", "re", "ve", "m",
  "need", "want", "wanna", "give", "tell", "help", "let", "like", "make", "take", "kindly", "using", "use", "much", "many", "get", "got", "gonna", "really", "thing", "things", "something", "anything",
]);

/** A word reduced so that plain inflections meet: deals and deal, recovering and recover, stuck and stuck. */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ing", "ed", "es", "s", "ly"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.length >= 5 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export interface Token {
  /** As written, lower-cased. */
  raw: string;
  stem: string;
  /** Character offsets in the normalised text. */
  start: number;
  end: number;
  /** A capitalised word that is not the first of its sentence: a name, which is a reference and not a topic. */
  proper: boolean;
  stop: boolean;
}

/** Tokens with their positions. Numbers and money keep their digits so a figure is matched as a figure. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[$]?[\p{L}\p{N}]+(?:[.'][\p{L}\p{N}]+)*/gu;
  let m: RegExpExecArray | null;
  let sentenceStart = true;
  let lastEnd = 0;
  while ((m = re.exec(text)) !== null) {
    const gap = text.slice(lastEnd, m.index);
    if (/[.!?]\s*$/.test(gap) || /\n/.test(gap)) sentenceStart = true;
    const raw = m[0].toLowerCase().replace(/'s$/, "");
    const proper = !sentenceStart && /^\p{Lu}/u.test(m[0]) && m[0].length > 1;
    out.push({ raw, stem: stem(raw.replace(/^\$/, "")), start: m.index, end: m.index + m[0].length, proper, stop: STOPWORDS.has(raw) });
    sentenceStart = false;
    lastEnd = m.index + m[0].length;
  }
  return out;
}

const NUMERIC = /^\$?\d[\d,.]*[kmb]?$/;

/** The content stems of a text, in order, with the position of each: stopwords and names left out. */
export function contentStems(tokens: readonly Token[]): { stem: string; start: number; end: number }[] {
  // A bare number, a date part or an amount says nothing about which intent is meant, and would count as a word the registry does not know.
  return tokens.filter((t) => !t.stop && !t.proper && t.raw.length > 1 && !NUMERIC.test(t.raw)).map((t) => ({ stem: t.stem, start: t.start, end: t.end }));
}

/** Unigrams, bigrams and trigrams of the content stems, each with the span of text it covers. Adjacent means adjacent among content words. */
export function ngrams(content: readonly { stem: string; start: number; end: number }[], maxN = 3): { gram: string; n: number; start: number; end: number }[] {
  const out: { gram: string; n: number; start: number; end: number }[] = [];
  for (let n = 1; n <= maxN; n += 1) {
    for (let i = 0; i + n <= content.length; i += 1) {
      const slice = content.slice(i, i + n);
      out.push({ gram: slice.map((s) => s.stem).join(" "), n, start: (slice[0] as { start: number }).start, end: (slice[n - 1] as { end: number }).end });
    }
  }
  return out;
}

/** FNV-1a over a string. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
