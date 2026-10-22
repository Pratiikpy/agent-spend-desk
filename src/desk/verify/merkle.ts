import { createHash } from "node:crypto";

/**
 * RFC 9162 section 2.1: the Merkle tree hash over an ordered list of entries, and inclusion-proof verification.
 * Only the verifying half lives here; proof generation is in the builder, so each half is written from the RFC
 * separately and the tests make them agree.
 */
function sha256(...parts: Uint8Array[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

export function leafHash(entry: Uint8Array): Buffer {
  return sha256(LEAF, entry);
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Buffer {
  return sha256(NODE, left, right);
}

/** Section 2.1.2: the tree hash computed with a stack, from a complete list of entries. */
export function treeHashFromEntries(entries: readonly Uint8Array[]): Buffer {
  if (entries.length === 0) return sha256();
  const stack: Buffer[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    stack.push(leafHash(entries[i] as Uint8Array));
    let merge = 0;
    while (Math.floor(i / 2 ** merge) % 2 === 1) merge += 1;
    for (let k = 0; k < merge; k += 1) {
      const right = stack.pop() as Buffer;
      const left = stack.pop() as Buffer;
      stack.push(nodeHash(left, right));
    }
  }
  while (stack.length > 1) {
    const right = stack.pop() as Buffer;
    const left = stack.pop() as Buffer;
    stack.push(nodeHash(left, right));
  }
  return stack[0] as Buffer;
}

/** Section 2.1.3.2. `leaf` is the leaf hash (HASH(0x00 || entry)), not the entry. */
export function verifyInclusion(leaf: Uint8Array, leafIndex: number, treeSize: number, path: readonly Uint8Array[], root: Uint8Array): boolean {
  if (!Number.isSafeInteger(leafIndex) || !Number.isSafeInteger(treeSize) || leafIndex < 0 || treeSize < 1) return false;
  if (leafIndex >= treeSize) return false;
  let fn = leafIndex;
  let sn = treeSize - 1;
  let r: Buffer = Buffer.from(leaf);
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && Buffer.compare(r, Buffer.from(root)) === 0;
}
