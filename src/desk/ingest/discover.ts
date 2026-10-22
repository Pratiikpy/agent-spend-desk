import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAX_DEPTH = 12;

/**
 * Find every `.jsonl` log under a directory. Claude Code nests subagent and workflow logs several
 * levels below the project folder (checked on a real tree: logs sit at depth 2, 4 and 6), so the
 * walk is not limited to a fixed depth. Symbolic links are never followed, which keeps a loop or
 * a link out of the tree from pulling in unrelated files; the depth cap is a last-resort guard.
 */
export function findJsonlLogs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // an unreadable folder is skipped, not fatal
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p, depth + 1);
      else if (st.isFile() && name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(root, 0);
  return out.sort();
}
