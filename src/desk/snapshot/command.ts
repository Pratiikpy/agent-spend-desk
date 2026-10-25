import { basename, resolve } from "node:path";

import type { CaptureDb } from "../capture/store.ts";
import { createSnapshot, dropSnapshot, listSnapshots, restoreSnapshot, verifyRestored, type SnapshotRecord } from "./shadow.ts";

/** Keep what a snapshot is, so that a task made from it can find it again and a replay can say whether it was whole. */
export function recordSnapshot(db: CaptureDb, repoPath: string, s: SnapshotRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO workspace_snapshots (snapshot_id, repo_path, repo_label, ref, commit_sha, head_sha, index_commit, untracked_commit, created_at, tracked_changed, staged_changed, untracked, untracked_bytes, cap_bytes, snapshot_partial, excluded_json, warnings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(s.name, repoPath, basename(repoPath), s.ref, s.commit, s.head, s.indexCommit, s.untrackedCommit, s.createdAt, s.trackedChanged, s.stagedChanged, s.untracked, s.untrackedBytes, s.cap, s.partial ? 1 : 0, JSON.stringify(s.excluded), JSON.stringify(s.warnings));
}

export function snapshotRow(db: CaptureDb, name: string): { repo_path: string; snapshot_partial: number; ref: string } | undefined {
  return db.prepare("SELECT repo_path, snapshot_partial, ref FROM workspace_snapshots WHERE snapshot_id = ?").get(name) as { repo_path: string; snapshot_partial: number; ref: string } | undefined;
}

const MIB = 1024 * 1024;

export function describe(s: SnapshotRecord): string {
  const lines = [
    `${s.ref} at ${s.commit.slice(0, 10)}: ${s.trackedChanged} tracked file${s.trackedChanged === 1 ? "" : "s"} changed from the index, ${s.stagedChanged} staged, ${s.untracked} untracked kept (${(s.untrackedBytes / 1024).toFixed(1)} KiB of ${(s.cap / MIB).toFixed(0)} MiB)`,
  ];
  if (s.partial) lines.push("PARTIAL: this snapshot does not hold everything the workspace held, so a replay from it answers a different question.");
  for (const e of s.excluded) lines.push(`  left out ${e.path}: ${e.reason}`);
  for (const w of s.warnings) lines.push(`  note: ${w}`);
  return lines.join("\n");
}

/** `desk snapshot <create|list|restore|show|drop>`: keep and restore the state of a workspace without changing it. */
export function snapshotCommand(o: { sub: string | undefined; args: string[]; repo?: string; into?: string; replace?: boolean; cap?: string; db: CaptureDb }): string {
  const repo = resolve(o.repo ?? ".");
  const sub = o.sub ?? "help";
  const name = o.args[0] ?? "";
  try {
    if (sub === "create") {
      if (!name) return "Name the snapshot: desk snapshot create <name> [--repo PATH]";
      const cap = o.cap === undefined ? undefined : Math.round(Number(o.cap) * MIB);
      if (cap !== undefined && (!Number.isFinite(cap) || cap < 1)) return "The cap is a number of MiB, at least a fraction of one.";
      const s = createSnapshot({ repo, name, ...(cap === undefined ? {} : { cap }), ...(o.replace ? { replace: true } : {}) });
      recordSnapshot(o.db, repo, s);
      return describe(s);
    }
    if (sub === "list") {
      const rows = o.db.prepare("SELECT snapshot_id id, created_at at, untracked, snapshot_partial partial, repo_label label FROM workspace_snapshots ORDER BY created_at").all() as { id: string; at: string; untracked: number; partial: number; label: string }[];
      if (rows.length === 0) return "No snapshot has been made. desk snapshot create <name> makes one.";
      return rows.map((r) => `${r.id}  ${r.label}  ${r.at.slice(0, 16).replace("T", " ")}  ${r.untracked} untracked${r.partial ? "  PARTIAL" : ""}`).join("\n");
    }
    if (sub === "restore" || sub === "show" || sub === "drop") {
      const row = snapshotRow(o.db, name);
      const from = row ? row.repo_path : repo;
      if (sub === "show") {
        if (!row) return `No snapshot called ${JSON.stringify(name)} is recorded.`;
        return listSnapshots(from).some((s) => s.name === name) ? `${row.ref} is in ${from}${row.snapshot_partial ? " and is partial" : ""}` : `${row.ref} is recorded but no longer in ${from}: the ref was removed there.`;
      }
      if (sub === "drop") {
        dropSnapshot(from, name);
        o.db.prepare("DELETE FROM workspace_snapshots WHERE snapshot_id = ?").run(name);
        return `Dropped ${name}. Its objects stay in the repository until git next collects garbage.`;
      }
      if (!o.into) return "Say where to restore it, outside the repository: desk snapshot restore <name> --into DIR";
      const r = restoreSnapshot({ repo: from, ref: name, into: o.into });
      const v = verifyRestored(r.into, r.files);
      const lines = [`restored ${r.files.length} files into ${r.into} (${r.files.filter((f) => f.from === "untracked").length} from the untracked files); ${v.ok ? "every file matches the bytes it held" : "VERIFICATION FAILED"}`];
      if (row?.snapshot_partial) lines.push("PARTIAL: some files were left out when it was made; see desk snapshot create's output for which.");
      for (const w of r.warnings) lines.push(`  note: ${w}`);
      return lines.join("\n");
    }
  } catch (e) {
    return `Could not ${sub}: ${(e as Error).message}`;
  }
  return ["desk snapshot: keep a workspace's staged, unstaged and untracked state in the repository's own object store, without changing the workspace", "  create <name> [--repo PATH] [--cap MiB] [--replace]", "  list | show <name> | drop <name>", "  restore <name> --into DIR    write it out, outside the repository, and check every file"].join("\n");
}
