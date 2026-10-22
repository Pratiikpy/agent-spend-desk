import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** Write a bundle to an empty or new folder. Paths are checked again here so that a bad name can never escape the folder. */
export function writeBundleDir(files: ReadonlyMap<string, Uint8Array>, dir: string): void {
  const root = resolve(dir);
  if (existsSync(root) && readdirSync(root).length > 0) throw new Error(`${root} is not empty; refusing to mix two dossiers`);
  mkdirSync(root, { recursive: true });
  for (const [path, bytes] of files) {
    const target = resolve(join(root, path));
    if (!target.startsWith(root + sep)) throw new Error(`path ${JSON.stringify(path)} escapes the bundle folder`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
  }
}
