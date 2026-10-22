import { homedir } from "node:os";

/**
 * Redaction at the edge of the card (spec DF-112): every string that reaches a card passes through here, so a
 * secret that leaked into a log field cannot reach a screenshot. Only the count of each kind is recorded,
 * never the value. Three rules: known credential shapes, long high-entropy tokens, and absolute paths, which
 * are shortened to a home-relative form because a path outside the repository says who and where you are.
 */
export type RedactionKind = "credential" | "high_entropy" | "path";

export interface Redactor {
  clean(text: string): string;
  /** How many values of each kind were replaced so far. */
  counts(): Record<RedactionKind, number>;
}

const CREDENTIAL_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bnvapi-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*["']?[^\s"',;]{8,}/gi,
];

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export const ENTROPY_THRESHOLD = 4.5;
const MIN_TOKEN_LENGTH = 20;
const MASK = "(redacted)";

const WINDOWS_PATH = /\b[A-Za-z]:[\\/][^\s"'<>|]*/g;
const POSIX_PATH = /(?<![\w.])\/(?:Users|home|root|var|tmp|opt|mnt|private)\/[^\s"'<>|]*/g;

function shortenPath(path: string, home: string): string {
  const norm = path.replace(/\\/g, "/");
  const h = home.replace(/\\/g, "/").replace(/\/+$/, "");
  if (h.length > 1 && norm.toLowerCase().startsWith(h.toLowerCase() + "/")) return "~" + norm.slice(h.length);
  const parts = norm.split("/").filter(Boolean);
  return ".../" + (parts.at(-1) ?? "");
}

export function createRedactor(home: string = homedir()): Redactor {
  const counts: Record<RedactionKind, number> = { credential: 0, high_entropy: 0, path: 0 };
  const clean = (input: string): string => {
    let text = input;
    for (const shape of CREDENTIAL_SHAPES) {
      text = text.replace(shape, () => {
        counts.credential += 1;
        return MASK;
      });
    }
    text = text.replace(WINDOWS_PATH, (p) => {
      counts.path += 1;
      return shortenPath(p, home);
    });
    text = text.replace(POSIX_PATH, (p) => {
      counts.path += 1;
      return shortenPath(p, home);
    });
    text = text.replace(/[A-Za-z0-9+/_=-]{20,}/g, (token) => {
      if (token === MASK || token.length < MIN_TOKEN_LENGTH) return token;
      if (entropy(token) >= ENTROPY_THRESHOLD) {
        counts.high_entropy += 1;
        return MASK;
      }
      return token;
    });
    return text;
  };
  return { clean, counts: () => ({ ...counts }) };
}
