import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LIMITS } from "./format.ts";

export class BundleReadError extends Error {}

/**
 * Read a bundle folder into memory with limits applied before any large read. A symbolic link or other
 * special file is refused: a verifier that follows links can be pointed at files outside the bundle.
 */
export function readBundleDir(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix === "" ? entry : `${prefix}/${entry}`;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new BundleReadError(`${rel} is a symbolic link; refusing to follow it`);
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile()) {
        if (files.size >= LIMITS.maxFiles) throw new BundleReadError(`more than ${LIMITS.maxFiles} files`);
        if (st.size > LIMITS.maxFileBytes) throw new BundleReadError(`${rel} is larger than ${LIMITS.maxFileBytes} bytes`);
        total += st.size;
        if (total > LIMITS.maxTotalBytes) throw new BundleReadError(`the bundle is larger than ${LIMITS.maxTotalBytes} bytes`);
        files.set(rel, readFileSync(full));
      } else throw new BundleReadError(`${rel} is not a regular file`);
    }
  };
  const st = lstatSync(root);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new BundleReadError(`${root} is not a folder`);
  walk(root, "");
  return files;
}
