import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createSnapshot, restoreSnapshot, verifyRestored } from "../snapshot/shadow.ts";

/**
 * The workspace snapshot (DF-097) in a repository made for the purpose: one with a staged edit, an unstaged edit with Windows line endings, a deletion, scratch files that
 * git does not track and a file that looks like a credential. The snapshot must have three parents, must leave the real index and the working files exactly as they were, must
 * restore every file byte for byte outside the repository, and must not have stored the credential.
 */
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export function snapshotProve(): { ok: boolean; detail: string } {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-snap-"));
  const repo = join(root, "repo");
  const out = join(root, "restored");
  const g = (...args: string[]): string => execFileSync("git", ["-c", "user.name=prove", "-c", "user.email=prove@localhost", ...args], { cwd: repo, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (path: string, content: Buffer | string): void => {
    const p = join(repo, ...path.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const fails: string[] = [];
  try {
    mkdirSync(repo);
    g("init", "-q", "-b", "main");
    g("config", "core.autocrlf", "true");
    put("a.txt", "alpha\n");
    put("b.txt", "bravo\n");
    put("gone.txt", "gone\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
    put("a.txt", Buffer.from("alpha edited\r\nsecond\r\n"));
    put("staged.txt", "staged\n");
    g("add", "staged.txt");
    rmSync(join(repo, "gone.txt"));
    put("scratch/notes.md", "notes\n");
    put("scratch/data.bin", Buffer.from([0, 255, 1, 254, 0]));
    put(".env", "X=1\n");

    const indexBefore = sha(readFileSync(join(repo, ".git", "index")));
    const s = createSnapshot({ repo, name: "prove" });
    if (sha(readFileSync(join(repo, ".git", "index"))) !== indexBefore) fails.push("the real index changed");
    const parents = g("rev-list", "--parents", "-n", "1", s.commit).split(" ").slice(1);
    if (parents.length !== 3) fails.push(`the snapshot has ${parents.length} parents`);
    if (!s.excluded.some((e) => e.path === ".env") || !s.partial) fails.push("the environment file was not left out and flagged");
    if (g("rev-list", "--objects", s.commit).includes(".env")) fails.push("the environment file is in the object store");

    const r = restoreSnapshot({ repo, ref: s.name, into: out });
    const v = verifyRestored(out, r.files);
    if (!v.ok) fails.push(`the restored files do not match: ${JSON.stringify(v)}`);
    const same = (path: string): boolean => sha(readFileSync(join(out, ...path.split("/")))) === sha(readFileSync(join(repo, ...path.split("/"))));
    for (const p of ["a.txt", "b.txt", "staged.txt", "scratch/notes.md", "scratch/data.bin"]) if (!same(p)) fails.push(`${p} differs from the workspace`);
    if (r.files.some((f) => f.path === "gone.txt" || f.path === ".env")) fails.push("a deleted or credential file was restored");
  } catch (e) {
    fails.push(`it threw: ${(e as Error).message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  if (fails.length > 0) return { ok: false, detail: fails.join("; ") };
  return { ok: true, detail: "a snapshot of a workspace with a staged edit, an unstaged edit with Windows line endings, a deletion, untracked scratch and a credential file has three parents, left the real index byte for byte as it was, restored every kept file with the bytes it held, and did not store the credential file" };
}
