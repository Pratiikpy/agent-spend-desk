import { leafHash, nodeHash } from "../verify/merkle.ts";
import { createHash } from "node:crypto";

/**
 * RFC 9162 section 2.1.1 and 2.1.3.1, written as the recursion the RFC states. The verifier uses the
 * iterative algorithms of 2.1.2 and 2.1.3.2, so the two halves cross-check each other in the tests.
 */
function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export function merkleTreeHash(entries: readonly Uint8Array[]): Buffer {
  if (entries.length === 0) return createHash("sha256").digest();
  if (entries.length === 1) return leafHash(entries[0] as Uint8Array);
  const k = largestPowerOfTwoBelow(entries.length);
  return nodeHash(merkleTreeHash(entries.slice(0, k)), merkleTreeHash(entries.slice(k)));
}

/** PATH(m, D_n): the audit path of entry m. */
export function inclusionPath(m: number, entries: readonly Uint8Array[]): Buffer[] {
  if (m < 0 || m >= entries.length) throw new RangeError("leaf index out of range");
  if (entries.length === 1) return [];
  const k = largestPowerOfTwoBelow(entries.length);
  if (m < k) return [...inclusionPath(m, entries.slice(0, k)), merkleTreeHash(entries.slice(k))];
  return [...inclusionPath(m - k, entries.slice(k)), merkleTreeHash(entries.slice(0, k))];
}
