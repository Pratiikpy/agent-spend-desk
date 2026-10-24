import { createHash } from "node:crypto";

import { CREDENTIAL_SHAPES } from "../card/redact.ts";

/**
 * Masking for text that is about to be stored or sent. Only two rules, on purpose: the credential shapes we know, and
 * exact values we are told are secret (the port's own key). Entropy and path rules, which the card applies to what it
 * shows, are not used here: they would mangle hashes, ids and the paths the ledger needs to find a repository.
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

/** Text from a log that is kept: its credential-shaped parts are masked, and null stays null. */
export function maskStored(value: string | null): string | null {
  return value === null ? null : maskSecrets(value).text;
}

/** A short stable stand-in for a value that identifies a person, such as an e-mail address. It cannot be read back. */
export function pseudonym(value: string): string {
  return `h:${createHash("sha256").update(`desk.pseudonym.v1\u0000${value.trim().toLowerCase()}`).digest("hex").slice(0, 12)}`;
}
