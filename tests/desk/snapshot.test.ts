import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { credentialContentReason, credentialPathReason, createSnapshot, dropSnapshot, listSnapshots, restoreSnapshot, SnapshotError, verifyRestored } from "../../src/desk/snapshot/shadow.ts";

/** The workspace snapshot (DF-097): three parents, nothing touched, bytes kept, credentials and over-cap files left out and said so. */
const root = mkdtempSync(join(tmpdir(), "desk-snapshot-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const g = (repo: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
const put = (repo: string, path: string, content: Buffer | string): void => {
  const p = join(repo, ...path.split("/"));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};
const credential = (): string => ["sk", "a1B2c3D4e5F6g7H8i9J0kLmN"].join("-");
const privateKeyHeader = (): string => ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");

let n = 0;
function repo(): string {
  n += 1;
  const dir = join(root, `repo-${n}`);
  mkdirSync(dir);
  g(dir, "init", "-q", "-b", "main");
  // Line endings are converted on a normal Windows checkout; a snapshot has to keep the bytes on disk whatever git is set to do.
  g(dir, "config", "core.autocrlf", "true");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n*.log\n");
  put(dir, "src/a.txt", "alpha\n");
  put(dir, "src/b.txt", "bravo\n");
  put(dir, "src/gone.txt", "to be deleted\n");
  put(dir, "keep.bin", Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "one");
  return dir;
}

/** A workspace with every kind of state: an unstaged edit with CRLF bytes, a staged new file, a staged file edited again, a deletion, and untracked scratch. */
function dirty(): string {
  const dir = repo();
  put(dir, "src/a.txt", Buffer.from("alpha edited\r\nsecond line\r\n"));
  put(dir, "staged-new.txt", "staged only\n");
  g(dir, "add", "staged-new.txt");
  put(dir, "src/b.txt", "bravo staged\n");
  g(dir, "add", "src/b.txt");
  put(dir, "src/b.txt", "bravo staged then edited\n");
  rmSync(join(dir, "src", "gone.txt"));
  put(dir, "scratch/notes.md", "# notes\nuntracked\n");
  put(dir, "scratch/deep/er/data.bin", Buffer.from([0, 255, 1, 254, 0, 0, 7]));
  put(dir, "scratch/empty.txt", "");
  put(dir, "scratch/crlf.txt", Buffer.from("one\r\ntwo\r\n"));
  put(dir, "scratch/ünï-cödé.txt", "unicode name\n");
  put(dir, "ignored/skip.txt", "ignored\n");
  put(dir, "build.log", "ignored by pattern\n");
  return dir;
}

function treeHash(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === ".git") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(dir.length + 1).split("\\").join("/")] = sha(readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

describe("making a snapshot", () => {
  it("is one commit with three parents: HEAD, the index, and the untracked files", () => {
    const dir = dirty();
    const s = createSnapshot({ repo: dir, name: "t1" });
    const parents = g(dir, "rev-list", "--parents", "-n", "1", s.commit).split(" ").slice(1);
    expect(parents).toEqual([s.head, s.indexCommit, s.untrackedCommit]);
    expect(s.head).toBe(g(dir, "rev-parse", "HEAD"));
    expect(g(dir, "rev-parse", "--verify", s.ref)).toBe(s.commit);
    expect(g(dir, "rev-list", "--parents", "-n", "1", s.indexCommit).split(" ").slice(1)).toEqual([s.head]);
    expect(g(dir, "rev-list", "--parents", "-n", "1", s.untrackedCommit).split(" ").slice(1)).toEqual([]);
    expect(s.partial).toBe(false);
    expect(s.excluded).toEqual([]);
  });

  it("holds the staged state in the index commit and the working state in its own tree", () => {
    const dir = dirty();
    const s = createSnapshot({ repo: dir, name: "t2" });
    expect(g(dir, "show", `${s.indexCommit}:src/b.txt`)).toBe("bravo staged");
    expect(g(dir, "show", `${s.indexCommit}:staged-new.txt`)).toBe("staged only");
    expect(g(dir, "show", `${s.commit}:src/b.txt`)).toBe("bravo staged then edited");
    expect(() => g(dir, "show", `${s.commit}:src/gone.txt`)).toThrow();
    expect(g(dir, "show", `${s.untrackedCommit}:scratch/notes.md`)).toContain("untracked");
    expect(() => g(dir, "show", `${s.untrackedCommit}:ignored/skip.txt`)).toThrow();
    expect(s).toMatchObject({ trackedChanged: 3, stagedChanged: 2, untracked: 5 });
  });

  it("changes nothing in the workspace: the index file, the files, the status, the stash and the branches are as they were", () => {
    const dir = dirty();
    const index = (): string => sha(readFileSync(join(dir, ".git", "index")));
    const before = { index: index(), files: treeHash(dir), head: g(dir, "rev-parse", "HEAD"), stash: g(dir, "stash", "list"), branches: g(dir, "branch", "-a"), config: readFileSync(join(dir, ".git", "config"), "utf8") };
    createSnapshot({ repo: dir, name: "t3" });
    expect({ index: index(), files: treeHash(dir), head: g(dir, "rev-parse", "HEAD"), stash: g(dir, "stash", "list"), branches: g(dir, "branch", "-a"), config: readFileSync(join(dir, ".git", "config"), "utf8") }).toEqual(before);
    const status = g(dir, "status", "--porcelain");
    expect(status).toContain("?? scratch/");
    expect(status).toContain(" D src/gone.txt");
    expect(status).not.toContain("ignored");
  });

  it("works on a clean workspace, with an empty untracked parent", () => {
    const dir = repo();
    const s = createSnapshot({ repo: dir, name: "clean" });
    expect(s.untracked).toBe(0);
    expect(s.trackedChanged).toBe(0);
    expect(g(dir, "rev-parse", `${s.commit}^{tree}`)).toBe(g(dir, "rev-parse", "HEAD^{tree}"));
    expect(g(dir, "ls-tree", "-r", s.untrackedCommit)).toBe("");
  });

  it("refuses a bad name, a name already taken, a repository with no commit, and a folder that is not a repository", () => {
    const dir = repo();
    expect(() => createSnapshot({ repo: dir, name: "Bad Name" })).toThrow(SnapshotError);
    createSnapshot({ repo: dir, name: "taken" });
    expect(() => createSnapshot({ repo: dir, name: "taken" })).toThrow(/already exists/);
    expect(createSnapshot({ repo: dir, name: "taken", replace: true }).name).toBe("taken");
    const empty = join(root, "empty-repo");
    mkdirSync(empty);
    g(empty, "init", "-q");
    expect(() => createSnapshot({ repo: empty, name: "x" })).toThrow(/no commit yet/);
    const plain = join(root, "plain-folder");
    mkdirSync(plain);
    expect(() => createSnapshot({ repo: plain, name: "x" })).toThrow(/not a git repository/);
  });

  it("flags a held index lock and a merge conflict as partial, with what it did about each", () => {
    const dir = repo();
    writeFileSync(join(dir, ".git", "index.lock"), "");
    const locked = createSnapshot({ repo: dir, name: "locked" });
    rmSync(join(dir, ".git", "index.lock"));
    expect(locked.partial).toBe(true);
    expect(locked.warnings.join(" ")).toMatch(/index lock/);

    const c = repo();
    g(c, "checkout", "-q", "-b", "other");
    put(c, "src/a.txt", "from other\n");
    g(c, "commit", "-qam", "other");
    g(c, "checkout", "-q", "main");
    put(c, "src/a.txt", "from main\n");
    g(c, "commit", "-qam", "main");
    expect(() => g(c, "merge", "other")).toThrow();
    const merging = createSnapshot({ repo: c, name: "conflict" });
    expect(merging.partial).toBe(true);
    expect(merging.warnings.join(" ")).toMatch(/unresolved merge conflict/);
  });
});

describe("what a snapshot will not keep", () => {
  it("leaves out files that are credentials by name or by content, says why, and does not put them in the object store", () => {
    const dir = repo();
    put(dir, ".env", "KEY=value\n");
    put(dir, ".env.local", "KEY=value\n");
    put(dir, ".env.example", "KEY=\n");
    put(dir, "deploy.pem", "pem\n");
    put(dir, "id_ed25519", "private\n");
    put(dir, "id_ed25519.pub", "public\n");
    put(dir, ".ssh/config", "Host x\n");
    put(dir, ".secrets/cleanverse.env", "A=b\n");
    put(dir, "notes.txt", `the key is ${credential()} for now\n`);
    put(dir, "code.ts", "const token = process.env.TOKEN;\nconst secret = readSecret();\n");
    put(dir, "fine.txt", "nothing\n");
    const s = createSnapshot({ repo: dir, name: "creds" });
    const left = Object.fromEntries(s.excluded.map((e) => [e.path, e.reason]));
    for (const p of [".env", ".env.local", "deploy.pem", "id_ed25519", ".ssh/config", ".secrets/cleanverse.env", "notes.txt"]) expect(left[p], p).toBeDefined();
    expect(left["notes.txt"]).toMatch(/shaped like a credential/);
    expect(left[".env"]).toMatch(/environment file/);
    for (const p of [".env.example", "id_ed25519.pub", "code.ts", "fine.txt"]) expect(left[p], p).toBeUndefined();
    expect(s.partial).toBe(true);
    const stored = g(dir, "rev-list", "--objects", s.commit).split("\n").map((l) => l.slice(l.indexOf(" ") + 1));
    for (const p of [".env", ".env.local", "deploy.pem", "id_ed25519", "notes.txt", ".ssh/config"]) expect(stored, p).not.toContain(p);
    expect(stored).toContain(".env.example");
    expect(g(dir, "ls-tree", "-r", "--name-only", s.untrackedCommit).split("\n").sort()).toEqual([".env.example", "code.ts", "fine.txt", "id_ed25519.pub"]);
  });

  it("stops at the cap, files in path order, and lists each file that did not fit", () => {
    const dir = repo();
    put(dir, "s/a.txt", "x".repeat(600));
    put(dir, "s/b.txt", "y".repeat(600));
    put(dir, "s/c.txt", "z".repeat(300));
    const s = createSnapshot({ repo: dir, name: "capped", cap: 1000 });
    expect(s.untracked).toBe(2);
    expect(s.untrackedBytes).toBe(900);
    expect(s.excluded).toHaveLength(1);
    expect(s.excluded[0]).toMatchObject({ path: "s/b.txt" });
    expect(s.excluded[0]!.reason).toMatch(/past the .* cap/);
    expect(s.partial).toBe(true);
    const big = createSnapshot({ repo: dir, name: "default-cap" });
    expect(big.partial).toBe(false);
  });

  it("names a credential by its path and by its text, and not an ordinary file", () => {
    expect(credentialPathReason("a/b/.env")).toMatch(/environment/);
    expect(credentialPathReason("keys/server.PEM")).toMatch(/key/);
    expect(credentialPathReason("home/.aws/credentials")).toMatch(/\.aws/);
    expect(credentialPathReason("src/index.ts")).toBeNull();
    expect(credentialPathReason(".env.sample")).toBeNull();
    expect(credentialPathReason("docs/secrets-management.md")).toBeNull();
    expect(credentialContentReason(Buffer.from(`x ${credential()} y`))).toMatch(/credential/);
    expect(credentialContentReason(Buffer.from(`${privateKeyHeader()}\nabc`))).toMatch(/credential/);
    expect(credentialContentReason(Buffer.from("const token = process.env.TOKEN"))).toBeNull();
    expect(credentialContentReason(Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(credential())]))).toBeNull();
  });
});

describe("restoring a snapshot", () => {
  it("writes every file as the bytes it held, tracked state first and untracked over it, and nothing else", () => {
    const dir = dirty();
    const original = treeHash(dir);
    const s = createSnapshot({ repo: dir, name: "r1" });
    const out = join(root, "restored-1");
    const r = restoreSnapshot({ repo: dir, ref: s.name, into: out });
    const got = treeHash(out);
    // The working directory's files, less what is ignored: the same bytes at the same paths.
    const expected = Object.fromEntries(Object.entries(original).filter(([p]) => !p.startsWith("ignored/") && !p.endsWith(".log")));
    expect(got).toEqual(expected);
    expect(sha(readFileSync(join(out, "src", "a.txt")))).toBe(sha(Buffer.from("alpha edited\r\nsecond line\r\n")));
    expect(sha(readFileSync(join(out, "scratch", "crlf.txt")))).toBe(sha(Buffer.from("one\r\ntwo\r\n")));
    expect(readFileSync(join(out, "scratch", "deep", "er", "data.bin"))).toEqual(Buffer.from([0, 255, 1, 254, 0, 0, 7]));
    expect(readFileSync(join(out, "keep.bin"))).toEqual(Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
    expect(existsSync(join(out, "src", "gone.txt"))).toBe(false);
    expect(existsSync(join(out, ".git"))).toBe(false);
    expect(readFileSync(join(out, "scratch", "empty.txt"))).toHaveLength(0);
    expect(r.files.filter((f) => f.from === "untracked").map((f) => f.path).sort()).toEqual(["scratch/crlf.txt", "scratch/deep/er/data.bin", "scratch/empty.txt", "scratch/notes.md", "scratch/ünï-cödé.txt"].sort());
    expect(verifyRestored(out, r.files)).toEqual({ ok: true, missing: [], changed: [], extra: [] });
  });

  it("is found out when a file is changed, removed or added afterwards", () => {
    const dir = dirty();
    createSnapshot({ repo: dir, name: "r2" });
    const out = join(root, "restored-2");
    const r = restoreSnapshot({ repo: dir, ref: "r2", into: out });
    writeFileSync(join(out, "src", "a.txt"), "changed");
    rmSync(join(out, "keep.bin"));
    writeFileSync(join(out, "new.txt"), "extra");
    expect(verifyRestored(out, r.files)).toEqual({ ok: false, missing: ["keep.bin"], changed: ["src/a.txt"], extra: ["new.txt"] });
  });

  it("restores the same files after the repository's own garbage collection, because the ref keeps the objects", () => {
    const dir = dirty();
    const s = createSnapshot({ repo: dir, name: "r3" });
    g(dir, "reflog", "expire", "--expire=now", "--all");
    g(dir, "gc", "--prune=now", "-q");
    const out = join(root, "restored-3");
    const r = restoreSnapshot({ repo: dir, ref: s.ref, into: out });
    expect(verifyRestored(out, r.files).ok).toBe(true);
    expect(r.files.length).toBeGreaterThan(8);
  });

  it("will not restore into the repository, into a folder with something in it, or from a ref that is not a snapshot", () => {
    const dir = dirty();
    createSnapshot({ repo: dir, name: "r4" });
    expect(() => restoreSnapshot({ repo: dir, ref: "r4", into: join(dir, "inside") })).toThrow(/outside the repository/);
    expect(() => restoreSnapshot({ repo: dir, ref: "r4", into: dir })).toThrow(/outside the repository/);
    const full = join(root, "not-empty");
    mkdirSync(full);
    writeFileSync(join(full, "x"), "x");
    expect(() => restoreSnapshot({ repo: dir, ref: "r4", into: full })).toThrow(/not empty/);
    expect(() => restoreSnapshot({ repo: dir, ref: "nope", into: join(root, "no") })).toThrow(/not a snapshot/);
    g(dir, "update-ref", "refs/desk/snapshots/plain", "HEAD");
    expect(() => restoreSnapshot({ repo: dir, ref: "plain", into: join(root, "no2") })).toThrow(/three parents/);
  });

  it("keeps the execute bit where the system has one", () => {
    if (process.platform === "win32") return;
    const dir = repo();
    put(dir, "run.sh", "#!/bin/sh\necho hi\n");
    chmodSync(join(dir, "run.sh"), 0o755);
    createSnapshot({ repo: dir, name: "x" });
    const out = join(root, "restored-x");
    restoreSnapshot({ repo: dir, ref: "x", into: out });
    expect(statSync(join(out, "run.sh")).mode & 0o111).not.toBe(0);
  });

  it("lists snapshots and drops one, leaving the others", () => {
    const dir = repo();
    createSnapshot({ repo: dir, name: "one" });
    createSnapshot({ repo: dir, name: "two" });
    expect(listSnapshots(dir).map((s) => s.name)).toEqual(["one", "two"]);
    dropSnapshot(dir, "one");
    expect(listSnapshots(dir).map((s) => s.name)).toEqual(["two"]);
    expect(() => dropSnapshot(dir, "Bad Name")).toThrow();
  });
});

describe("from the command line", () => {
  it("makes, lists, restores and drops a snapshot, and records it in the capture store", () => {
    const dir = dirty();
    const store = join(root, "cli-capture.db");
    const out = join(root, "cli-restored");
    const run = (...args: string[]): string => execFileSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "snapshot", ...args, "--capture-db", store], { encoding: "utf8", windowsHide: true });
    expect(run("create", "cli1", "--repo", dir)).toMatch(/refs\/desk\/snapshots\/cli1 at [0-9a-f]{10}: 3 tracked files changed from the index, 2 staged, 5 untracked kept/);
    expect(run("list")).toMatch(/cli1 {2}repo-\d+ .* 5 untracked\n?$/);
    expect(run("restore", "cli1", "--into", out)).toMatch(/restored 10 files into .*cli-restored \(5 from the untracked files\); every file matches the bytes it held/);
    expect(run("show", "cli1")).toMatch(/is in .*repo-\d+/);
    expect(run("restore", "cli1", "--into", join(dir, "inside"))).toMatch(/Could not restore: .*outside the repository/);
    expect(run("create")).toMatch(/Name the snapshot/);
    expect(run("drop", "cli1")).toMatch(/Dropped cli1/);
    expect(run("list")).toMatch(/No snapshot has been made/);
    expect(g(dir, "for-each-ref", "refs/desk/snapshots/")).toBe("");
  }, 120_000);
});
