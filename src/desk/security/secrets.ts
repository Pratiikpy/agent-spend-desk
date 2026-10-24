import { createHash } from "node:crypto";

import { CREDENTIAL_SHAPES, ENTROPY_THRESHOLD, entropy } from "../card/redact.ts";

/**
 * Masking for text that is about to be stored or sent. Two rules for text that is sent (the credential shapes we know, and
 * exact values we are told are secret, such as the port's own key) and a third for text that is stored (a long
 * random-looking word, below). The card's path rule is not used here: it would mangle the paths the ledger needs to find
 * a repository, and a general entropy rule over a message would mangle hashes and ids.
 */
export const MASK = "(redacted)";
const MIN_KNOWN = 8;

export function maskSecrets(input: string, known: readonly string[] = []): { text: string; count: number } {
  let text = input;
  let count = 0;
  for (const value of known) {
    if (value.length < MIN_KNOWN) continue;
    while (text.includes(value)) {
      text = text.replace(value, MASK);
      count += 1;
    }
  }
  for (const shape of CREDENTIAL_SHAPES) {
    shape.lastIndex = 0;
    text = text.replace(shape, () => {
      count += 1;
      return MASK;
    });
  }
  return { text, count };
}

/**
 * A long random-looking token in text that is kept (a folder, a branch, a version, an edited path) is masked even when it
 * has no provider prefix. It is tested one word at a time, where a word ends at a slash, dot, colon or space, so that a path
 * keeps its shape and the ledger can still find the repository. A word is masked only when it is at least 24 characters, at
 * least 4.5 bits per character, and mixes letters with digits; a hash (hex only), an id with dashes in the shape of a UUID
 * and an ordinary long identifier are not.
 */
const WORD = /[A-Za-z0-9+_=-]{24,}/g;
const HEX_OR_UUID = /^[0-9a-f-]+$/i;

export function maskEntropy(input: string): { text: string; count: number } {
  let count = 0;
  const text = input.replace(WORD, (word) => {
    if (word === MASK || HEX_OR_UUID.test(word) || !/[A-Za-z]/.test(word) || !/[0-9]/.test(word) || entropy(word) < ENTROPY_THRESHOLD) return word;
    count += 1;
    return MASK;
  });
  return { text, count };
}

/** Text from a log that is kept: its credential-shaped and random-looking parts are masked, and null stays null. */
export function maskStored(value: string | null): string | null {
  return value === null ? null : maskEntropy(maskSecrets(value).text).text;
}

/** A short stable stand-in for a value that identifies a person, such as an e-mail address. It cannot be read back. */
export function pseudonym(value: string): string {
  return `h:${createHash("sha256").update(`desk.pseudonym.v1\u0000${value.trim().toLowerCase()}`).digest("hex").slice(0, 12)}`;
}
