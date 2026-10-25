import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { CREDENTIAL_SHAPES } from "../card/redact.ts";
import { git, gitBuffer } from "./git.ts";

/**
 * A workspace snapshot that does not touch the workspace (DF-097). The owner's working directory holds three things that a commit of HEAD would lose: edits that are staged,
 * edits that are not, and files git has not been told about (a scratch script, a fixture the agent wrote, a notes file the tests read). A snapshot keeps all three as one commit in
 * the repository's own object store, under `refs/desk/snapshots/<name>`, the way `git stash` does, and for the same reason: it is the only copy of that state there is.
 *
 *   snapshot commit  tree = every tracked file as it is in the working directory (staged or not)
 *     parent 1       HEAD
 *     parent 2       a commit whose tree is the index: what is staged
 *     parent 3       a commit whose tree is every untracked file that is not ignored, with the files it will not keep left out and said so
 *
 * Nothing is written to the working directory, the index, the stash, a branch, or the config: objects and one ref are all that are added, and the real index is read and never
 * written. File contents are stored as they are on disk, byte for byte, with no line-ending conversion or filter, so a restored file hashes the same as the original.
 *
 * What it will not keep: anything that looks like a credential, by its name (`.env`, a key file, an ssh or cloud folder) or by what is in it (the shapes the Desk masks elsewhere),
 * and anything that would take the untracked files past the cap (25 MiB by default). Each is listed with its reason and the snapshot is marked partial, because a replay in a
 * sandbox missing a file the original had would answer a different question; the replay then reports a divergence and does not pretend.
 *
 * A ref under `refs/desk/` is pushed by `git push --mirror` and by nothing else git does by default. The snapshot may hold untracked files the owner never meant to share.
 */
export const SNAPSHOT_REF_PREFIX = "refs/desk/snapshots/";
export const DEFAULT_UNTRACKED_CAP = 25 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TEXT_SCAN_LIMIT = 1024 * 1024;

export class SnapshotError extends Error {}

export interface ExcludedFile {
  path: string;
  reason: string;
}

export interface SnapshotRecord {
  name: string;
  ref: string;
  commit: string;
  head: string;
  indexCommit: string;
  untrackedCommit: string;
  createdAt: string;
  /** Tracked files whose working-directory content differs from the index, counting deletions. */
  trackedChanged: number;
  /** Paths that differ between HEAD and the index. */
  stagedChanged: number;
  untracked: number;
  untrackedBytes: number;
  cap: number;
  excluded: ExcludedFile[];
  /** True when the snapshot does not hold everything the workspace held: the sandbox built from it must not be taken for the original. */
  partial: boolean;
  warnings: string[];
}

const EXAMPLE_ENV = /^\.env\.(example|sample|template|dist|defaults?)$/i;

/** Why a file is not kept, judged by its path alone, or null. */
export function credentialPathReason(path: string): string | null {
  const parts = path.split("/");
  const base = (parts[parts.length - 1] ?? "").toLowerCase();
  const dirs = parts.slice(0, -1).map((p) => p.toLowerCase());
  for (const d of dirs) {
    if ([".ssh", ".aws", ".gnupg", ".kube", ".secrets", ".azure"].includes(d)) return `a file in ${d}, where credentials are kept`;
  }
  if (dirs.includes(".docker") && base === "config.json") return "a docker config, which can hold registry logins";
  if (dirs.join("/").endsWith(".config/gcloud")) return "a gcloud config, which holds credentials";
  if (base === ".env" || (/^\.env\./.test(base) && !EXAMPLE_ENV.test(base))) return "an environment file, which holds keys";
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/.test(base)) return "a key or certificate file";
  if (/^id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$)/.test(base)) return "an ssh private key";
  if ([".npmrc", ".pypirc", ".netrc", ".pgpass", ".git-credentials", ".dockercfg", ".htpasswd"].includes(base)) return "a file that holds a login";
  if (/^(credentials|secrets?)(\.(json|ya?ml|toml|txt|ini))?$/.test(base) || /^service-account.*\.json$/.test(base) || /\.secrets?$/.test(base)) return "a file named for credentials";
  return null;
}

/**
 * The shapes a credential has by itself: a provider's key prefix, a token with three dotted parts, a private key header. The looser rule the Desk uses when it masks text for
 * display (any word followed by `token =` or `secret:`) is left out here: in scratch code it matches `token = process.env.TOKEN`, and a snapshot that dropped every such file would
 * be missing the files a replay needs.
 */
const STRICT_SHAPES = CREDENTIAL_SHAPES.filter((r) => !r.source.includes("api[_-]?key"));

/** Why a file's contents are not kept: a text file with a credential in it. */
export function credentialContentReason(bytes: Buffer): string | null {
  if (bytes.length > TEXT_SCAN_LIMIT) return null;
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return null;
  const text = bytes.toString("utf8");
  for (const shape of STRICT_SHAPES) {
    shape.lastIndex = 0;
    if (shape.test(text)) {
      shape.lastIndex = 0;
      return "its text holds something shaped like a credential";
    }
  }
  return null;
}

const AUTHOR = { GIT_AUTHOR_NAME: "desk", GIT_AUTHOR_EMAIL: "desk@localhost", GIT_COMMITTER_NAME: "desk", GIT_COMMITTER_EMAIL: "desk@localhost" };

export function createSnapshot(o: { repo: string; name: string; cap?: number; now?: () => Date; replace?: boolean }): SnapshotRecord {
  if (!NAME.test(o.name)) throw new SnapshotError(`a snapshot name is 1 to 64 lowercase letters, digits, dots, dashes or underscores, and starts with a letter or digit; ${JSON.stringify(o.name.slice(0, 70))} is not one`);
  const cap = o.cap ?? DEFAULT_UNTRACKED_CAP;
  const when = (o.now ?? (() => new Date()))();
  const stamp = `${Math.floor(when.getTime() / 1000)} +0000`;
  const env = { ...AUTHOR, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
  let top: string;
  let gitDir: string;
  try {
    top = git(["rev-parse", "--show-toplevel"], { cwd: o.repo }).trim();
    gitDir = resolve(top, git(["rev-parse", "--git-dir"], { cwd: top }).trim());
  } catch (e) {
    throw new SnapshotError(`${o.repo} is not a git repository: ${(e as Error).message}`);
  }
  const ref = `${SNAPSHOT_REF_PREFIX}${o.name}`;
  if (!o.replace) {
    const existing = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: top, windowsHide: true });
    if (existing.status === 0) throw new SnapshotError(`${ref} already exists; give another name, or replace it on purpose`);
  }
  let head: string;
  try {
    head = git(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: top }).trim();
  } catch {
    throw new SnapshotError("this repository has no commit yet, so there is nothing for a snapshot to stand on");
  }

  const warnings: string[] = [];
  const excluded: ExcludedFile[] = [];
  let partial = false;
  if (existsSync(join(gitDir, "index.lock"))) {
    partial = true;
    warnings.push("another git command holds the index lock, so the index may be mid-change; the snapshot took it as it stood");
  }

  const scratch = mkdtempSync(join(tmpdir(), "desk-snap-"));
  try {
    // The staged state, rebuilt in an index of its own from what the real index lists. `git write-tree` on the real index would store a cache-tree extension in it, which changes
    // the file's bytes; reading it with `ls-files` and writing nothing leaves the real index exactly as it was.
    const sIndex = join(scratch, "index-staged");
    const entries = git(["ls-files", "-s", "-z"], { cwd: top }).split("\0").filter(Boolean);
    const stage0: string[] = [];
    const modeOf = new Map<string, string>();
    for (const e of entries) {
      const m = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]*)$/.exec(e);
      if (!m) continue;
      if (m[3] !== "0") {
        partial = true;
        warnings.push(`${m[4]} has an unresolved merge conflict; its index version stands in for the working copy`);
        continue;
      }
      stage0.push(`${m[1]} ${m[2]}\t${m[4]}\0`);
      modeOf.set(m[4] as string, m[1] as string);
    }
    if (stage0.length > 0) git(["update-index", "-z", "--index-info"], { cwd: top, env: { GIT_INDEX_FILE: sIndex }, input: stage0.join("") });
    else git(["read-tree", "--empty"], { cwd: top, env: { GIT_INDEX_FILE: sIndex } });
    const indexTree = git(["write-tree"], { cwd: top, env: { GIT_INDEX_FILE: sIndex } }).trim();

    // The working tree of tracked files, built in a copy of that index.
    const wIndex = join(scratch, "index-work");
    copyFileSync(sIndex, wIndex);
    const wEnv = { GIT_INDEX_FILE: wIndex };

    const changed = git(["diff-files", "--name-status", "--no-renames", "-z"], { cwd: top }).split("\0").filter(Boolean);
    let trackedChanged = 0;
    const toHash: string[] = [];
    const removals: string[] = [];
    for (let i = 0; i + 1 < changed.length; i += 2) {
      const status = changed[i] as string;
      const path = changed[i + 1] as string;
      if (status === "D") {
        removals.push(`0 ${"0".repeat(40)}\t${path}\0`);
        trackedChanged += 1;
      } else if (status === "M" || status === "T") {
        const st = lstatSync(join(top, path), { throwIfNoEntry: false });
        if (!st) {
          removals.push(`0 ${"0".repeat(40)}\t${path}\0`);
          trackedChanged += 1;
        } else if (st.isSymbolicLink() || !st.isFile()) {
          partial = true;
          warnings.push(`${path} is a link or not a regular file; its index version stands in for the working copy`);
        } else if (path.includes("\n")) {
          partial = true;
          warnings.push(`${JSON.stringify(path)} has a newline in its name; its index version stands in for the working copy`);
        } else {
          toHash.push(path);
        }
      } else if (status === "U") {
        // An unmerged path was already reported above.
      }
    }
    if (removals.length > 0) git(["update-index", "-z", "--index-info"], { cwd: top, env: wEnv, input: removals.join("") });
    if (toHash.length > 0) {
      const shas = git(["hash-object", "-w", "--no-filters", "--stdin-paths"], { cwd: top, input: `${toHash.join("\n")}\n` }).split("\n").filter(Boolean);
      if (shas.length !== toHash.length) throw new SnapshotError("git hashed a different number of files than it was given");
      const lines = toHash.map((p, i) => {
        const prior = modeOf.get(p) ?? "100644";
        const exec = process.platform === "win32" ? prior : (lstatSync(join(top, p)).mode & 0o111) !== 0 ? "100755" : "100644";
        return `${prior === "120000" ? "100644" : exec} ${shas[i]}\t${p}\0`;
      });
      git(["update-index", "-z", "--index-info"], { cwd: top, env: wEnv, input: lines.join("") });
      trackedChanged += toHash.length;
    }
    const workTree = git(["write-tree"], { cwd: top, env: wEnv }).trim();

    // The untracked files, in an index of their own.
    const listed = git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: top }).split("\0").filter(Boolean).sort();
    const keep: { path: string; bytes: number; mode: string }[] = [];
    let used = 0;
    for (const p of listed) {
      if (p.includes("\n")) {
        excluded.push({ path: p, reason: "a newline in its name" });
        partial = true;
        continue;
      }
      const reasonByName = credentialPathReason(p);
      if (reasonByName) {
        excluded.push({ path: p, reason: `${reasonByName}; left out` });
        partial = true;
        continue;
      }
      const full = join(top, p);
      const st = lstatSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (!st.isFile()) {
        excluded.push({ path: p, reason: "not a regular file" });
        partial = true;
        continue;
      }
      if (used + st.size > cap) {
        excluded.push({ path: p, reason: `would take the untracked files past the ${(cap / 1048576).toFixed(0)} MiB cap` });
        partial = true;
        continue;
      }
      const bytes = st.size <= TEXT_SCAN_LIMIT ? readFileSync(full) : null;
      const reasonByContent = bytes ? credentialContentReason(bytes) : null;
      if (reasonByContent) {
        excluded.push({ path: p, reason: `${reasonByContent}; left out` });
        partial = true;
        continue;
      }
      used += st.size;
      keep.push({ path: p, bytes: st.size, mode: process.platform !== "win32" && (st.mode & 0o111) !== 0 ? "100755" : "100644" });
    }
    const uIndex = join(scratch, "index-untracked");
    const uEnv = { GIT_INDEX_FILE: uIndex };
    if (keep.length > 0) {
      const shas = git(["hash-object", "-w", "--no-filters", "--stdin-paths"], { cwd: top, input: `${keep.map((k) => k.path).join("\n")}\n` }).split("\n").filter(Boolean);
      if (shas.length !== keep.length) throw new SnapshotError("git hashed a different number of files than it was given");
      git(["update-index", "--add", "-z", "--index-info"], { cwd: top, env: uEnv, input: keep.map((k, i) => `${k.mode} ${shas[i]}\t${k.path}\0`).join("") });
    } else {
      git(["read-tree", "--empty"], { cwd: top, env: uEnv });
    }
    const untrackedTree = git(["write-tree"], { cwd: top, env: uEnv }).trim();

    const stagedChanged = git(["diff-tree", "-r", "--name-only", "--no-renames", "-z", "HEAD", indexTree], { cwd: top }).split("\0").filter(Boolean).length;
    const indexCommit = git(["commit-tree", indexTree, "-p", head, "-m", `desk snapshot ${o.name}: staged`], { cwd: top, env }).trim();
    const untrackedCommit = git(["commit-tree", untrackedTree, "-m", `desk snapshot ${o.name}: untracked files`], { cwd: top, env }).trim();
    const body = [`desk snapshot ${o.name}`, "", `parents: HEAD, staged, untracked (${keep.length} files, ${used} bytes)`, ...(partial ? ["partial: some files were left out"] : [])].join("\n");
    const commit = git(["commit-tree", workTree, "-p", head, "-p", indexCommit, "-p", untrackedCommit, "-m", body], { cwd: top, env }).trim();
    git(["update-ref", ref, commit], { cwd: top });
    return { name: o.name, ref, commit, head, indexCommit, untrackedCommit, createdAt: when.toISOString(), trackedChanged, stagedChanged, untracked: keep.length, untrackedBytes: used, cap, excluded, partial, warnings };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export interface ManifestEntry {
  path: string;
  /** The sha-256 of the bytes restored. */
  sha256: string;
  size: number;
  mode: string;
  /** `tracked` for a file in the working tree's tracked files, `untracked` for one from the untracked parent. */
  from: "tracked" | "untracked";
}

export interface Restored {
  into: string;
  files: ManifestEntry[];
  warnings: string[];
}

interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  size: number;
  path: string;
}

function lsTree(top: string, treeish: string): TreeEntry[] {
  const out = git(["ls-tree", "-r", "-l", "-z", "--full-tree", treeish], { cwd: top });
  const entries: TreeEntry[] = [];
  for (const rec of out.split("\0").filter(Boolean)) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\s+(-|\d+)\t([\s\S]*)$/.exec(rec);
    if (m) entries.push({ mode: m[1] as string, type: m[2] as string, sha: m[3] as string, size: m[4] === "-" ? 0 : Number(m[4]), path: m[5] as string });
  }
  return entries;
}

/** Read blobs in batches, bytes untouched. */
function readBlobs(top: string, entries: readonly TreeEntry[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const unique = [...new Set(entries.map((e) => e.sha))];
  const sizeOf = new Map(entries.map((e) => [e.sha, e.size]));
  let batch: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (batch.length === 0) return;
    const raw = gitBuffer(["cat-file", "--batch"], { cwd: top, input: `${batch.join("\n")}\n`, maxBuffer: bytes + batch.length * 128 + 1024 * 1024 });
    let at = 0;
    for (const sha of batch) {
      const nl = raw.indexOf(10, at);
      const header = raw.subarray(at, nl).toString("utf8").split(" ");
      if (header[1] !== "blob") throw new SnapshotError(`${sha} is not a blob`);
      const size = Number(header[2]);
      out.set(sha, Buffer.from(raw.subarray(nl + 1, nl + 1 + size)));
      at = nl + 1 + size + 1;
    }
    batch = [];
    bytes = 0;
  };
  for (const sha of unique) {
    const size = sizeOf.get(sha) ?? 0;
    if (bytes + size > 64 * 1024 * 1024 && batch.length > 0) flush();
    batch.push(sha);
    bytes += size;
  }
  flush();
  return out;
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Write a snapshot out as a directory: the tracked files as they were in the working directory, and the untracked files over them. The directory must be new or empty and
 * must not be inside the repository it came from; nothing in the repository is touched. A file is written as the bytes it held, which `ManifestEntry.sha256` lets a caller check.
 */
export function restoreSnapshot(o: { repo: string; ref: string; into: string }): Restored {
  let top: string;
  try {
    top = git(["rev-parse", "--show-toplevel"], { cwd: o.repo }).trim();
  } catch (e) {
    throw new SnapshotError(`${o.repo} is not a git repository: ${(e as Error).message}`);
  }
  const into = resolve(o.into);
  if (into === resolve(top) || within(resolve(top), into)) throw new SnapshotError("a snapshot is restored outside the repository it came from, so that a replay cannot change the original");
  if (existsSync(into) && readdirSync(into).length > 0) throw new SnapshotError(`${o.into} is not empty`);
  const full = o.ref.startsWith("refs/") ? o.ref : `${SNAPSHOT_REF_PREFIX}${o.ref}`;
  let parents: string[];
  try {
    parents = git(["rev-list", "--parents", "-n", "1", full], { cwd: top }).trim().split(" ").slice(1);
  } catch {
    throw new SnapshotError(`${full} is not a snapshot in this repository`);
  }
  if (parents.length !== 3) throw new SnapshotError(`${full} does not have the three parents of a snapshot`);
  const tracked = lsTree(top, `${full}^{tree}`);
  const untracked = lsTree(top, `${parents[2]}^{tree}`);
  const blobs = readBlobs(top, [...tracked, ...untracked].filter((e) => e.type === "blob" && e.mode !== "120000"));
  const warnings: string[] = [];
  const files: ManifestEntry[] = [];
  mkdirSync(into, { recursive: true });
  const put = (e: TreeEntry, from: ManifestEntry["from"]): void => {
    if (e.type !== "blob") {
      warnings.push(`${e.path} is a ${e.type === "commit" ? "submodule" : e.type}, which is not restored`);
      return;
    }
    const target = resolve(into, e.path);
    if (!within(into, target)) throw new SnapshotError(`${JSON.stringify(e.path)} would be written outside the restored directory`);
    mkdirSync(dirname(target), { recursive: true });
    if (e.mode === "120000") {
      const link = gitBuffer(["cat-file", "blob", e.sha], { cwd: top }).toString("utf8");
      try {
        symlinkSync(link, target);
      } catch {
        writeFileSync(target, link);
        warnings.push(`${e.path} is a symbolic link and could not be made one here; its target is written as a file`);
      }
      return;
    }
    const bytes = blobs.get(e.sha) as Buffer;
    writeFileSync(target, bytes);
    if (e.mode === "100755" && process.platform !== "win32") chmodSync(target, 0o755);
    files.push({ path: e.path, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mode: e.mode, from });
  };
  for (const e of tracked) put(e, "tracked");
  for (const e of untracked) put(e, "untracked");
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { into, files, warnings };
}

/** A restored directory against its manifest: the paths that are missing, changed, or not in the manifest. */
export function verifyRestored(dir: string, files: readonly ManifestEntry[]): { ok: boolean; missing: string[]; changed: string[]; extra: string[] } {
  const missing: string[] = [];
  const changed: string[] = [];
  const known = new Set(files.map((f) => f.path));
  for (const f of files) {
    const p = join(dir, ...f.path.split("/"));
    if (!existsSync(p)) {
      missing.push(f.path);
      continue;
    }
    if (createHash("sha256").update(readFileSync(p)).digest("hex") !== f.sha256) changed.push(f.path);
  }
  const extra: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = relative(dir, p).split(sep).join("/");
        if (!known.has(rel)) extra.push(rel);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { ok: missing.length === 0 && changed.length === 0 && extra.length === 0, missing, changed, extra };
}

export function listSnapshots(repo: string): { name: string; commit: string }[] {
  const out = git(["for-each-ref", "--format=%(refname) %(objectname)", SNAPSHOT_REF_PREFIX], { cwd: repo });
  return out.split("\n").filter(Boolean).map((l) => {
    const [ref, commit] = l.split(" ") as [string, string];
    return { name: ref.slice(SNAPSHOT_REF_PREFIX.length), commit };
  });
}

export function dropSnapshot(repo: string, name: string): void {
  if (!NAME.test(name)) throw new SnapshotError("not a snapshot name");
  git(["update-ref", "-d", `${SNAPSHOT_REF_PREFIX}${name}`], { cwd: repo });
}

/**
 * Hold a commit that is already in history under a snapshot name, so that a task made from it can be put back later and so that rewriting the branch it came from does not lose it.
 * It has the same three parents as a snapshot of a working directory, with nothing staged beyond the commit and no untracked files, so `restoreSnapshot` reads both alike.
 */
export function pinCommit(o: { repo: string; name: string; commit: string; replace?: boolean; now?: () => Date }): { ref: string; commit: string; tree: string } {
  if (!NAME.test(o.name)) throw new SnapshotError(`a snapshot name is 1 to 64 lowercase letters, digits, dots, dashes or underscores, and starts with a letter or digit; ${JSON.stringify(o.name.slice(0, 70))} is not one`);
  const when = (o.now ?? (() => new Date()))();
  const stamp = `${Math.floor(when.getTime() / 1000)} +0000`;
  const env = { ...AUTHOR, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
  let top: string;
  try {
    top = git(["rev-parse", "--show-toplevel"], { cwd: o.repo }).trim();
  } catch (e) {
    throw new SnapshotError(`${o.repo} is not a git repository: ${(e as Error).message}`);
  }
  const ref = `${SNAPSHOT_REF_PREFIX}${o.name}`;
  if (!o.replace && spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: top, windowsHide: true }).status === 0) throw new SnapshotError(`${ref} already exists`);
  let commit: string;
  try {
    commit = git(["rev-parse", "--verify", `${o.commit}^{commit}`], { cwd: top }).trim();
  } catch {
    throw new SnapshotError(`${o.commit} is not a commit in this repository`);
  }
  const tree = git(["rev-parse", `${commit}^{tree}`], { cwd: top }).trim();
  const emptyTree = git(["mktree"], { cwd: top, input: "" }).trim();
  const indexCommit = git(["commit-tree", tree, "-p", commit, "-m", `desk snapshot ${o.name}: staged`], { cwd: top, env }).trim();
  const untrackedCommit = git(["commit-tree", emptyTree, "-m", `desk snapshot ${o.name}: untracked files`], { cwd: top, env }).trim();
  const pinned = git(["commit-tree", tree, "-p", commit, "-p", indexCommit, "-p", untrackedCommit, "-m", `desk snapshot ${o.name}\n\npinned commit ${commit}`], { cwd: top, env }).trim();
  git(["update-ref", ref, pinned], { cwd: top });
  return { ref, commit: pinned, tree };
}
