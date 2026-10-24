import { describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { commitLanding, loadCompactions } from "../../src/desk/waste/load.ts";

const at = (min: number): number => Date.parse("2026-10-20T10:00:00.000Z") + min * 60_000;
const iso = (min: number): string => new Date(at(min)).toISOString();

function ledger(): Ledger {
  const db = openLedger(":memory:");
  const session = db.prepare("INSERT INTO session (session_id, tool, project_path) VALUES (?, 'claude_code', ?)");
  session.run("in-repo", "D:\\work\\Shop\\packages\\web");
  session.run("tied", "D:\\work\\Shop");
  session.run("outside", "D:\\work\\scratch");
  session.run("nofolder", null);
  session.run("old-scan", "D:\\work\\Other\\app");
  const repo = db.prepare("INSERT INTO repo (repo_id, root, default_ref, scanned_at) VALUES (?, ?, 'main', ?)");
  repo.run(1, "d:/work/shop/", iso(500)); // the root as another tool wrote it: other case, forward slashes, a trailing slash
  repo.run(2, "D:\\work\\Other", iso(5));
  repo.run(3, ".", iso(500));
  const commit = db.prepare("INSERT INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted) VALUES (?, ?, ?, 'a@b.c', 0, '[]', 0, 0)");
  commit.run(1, "c1", new Date(at(30)).toISOString().replace("Z", "+00:00"));
  commit.run(1, "c2", iso(200));
  db.prepare("INSERT INTO session_commit (session_id, repo_id, sha, method, confidence) VALUES ('tied', 1, 'c2', 'file_overlap', 'medium')").run();
  return db;
}

describe("what is known of the work a phase landed", () => {
  const phase = [at(0), at(60)] as const;

  it("says landed when a commit tied to the session was authored inside the phase", () => {
    expect(commitLanding(ledger())("tied", at(150), at(250))).toBe("landed");
  });

  it("says possible when the session's repository has a commit inside the phase that is not tied to the session", () => {
    // The session ran in a folder below the repository's root, the root is written another way, and the commit's time carries an offset.
    expect(commitLanding(ledger())("in-repo", ...phase)).toBe("possible");
  });

  it("says none when the repository was scanned after the phase and has no commit inside it", () => {
    expect(commitLanding(ledger())("in-repo", at(60), at(120))).toBe("none");
  });

  it("says unknown for a folder that is not inside a scanned repository, a session with no folder, and a scan that ran before the phase ended", () => {
    const l = commitLanding(ledger());
    expect(l("outside", ...phase)).toBe("unknown");
    expect(l("nofolder", ...phase)).toBe("unknown");
    expect(l("old-scan", at(0), at(60))).toBe("unknown"); // the repository was scanned at minute 5: it cannot say what came after
    expect(l("never-heard-of", ...phase)).toBe("unknown");
  });

  it("does not take the relative repository root '.' for a place every folder is inside", () => {
    expect(commitLanding(ledger())("outside", at(60), at(120))).toBe("unknown");
  });
});

describe("compactions in a period", () => {
  it("are read with the log file they came from, inside the period only", () => {
    const db = ledger();
    db.prepare("INSERT INTO ingest_source (id, kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES (7, 'claude_code', 'a.jsonl', 1, 1, 't')").run();
    const add = db.prepare("INSERT INTO session_compaction (session_id, ts, trigger, pre_tokens, post_tokens, duration_ms, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
    add.run("in-repo", iso(10), "auto", 500_000, 30_000, 4_000, 7);
    add.run("tied", iso(900), "manual", 200_000, null, null, null);
    expect(loadCompactions(db, iso(0), iso(100))).toEqual([{ sessionId: "in-repo", threadKey: "7", tsMs: at(10), trigger: "auto", preTokens: 500_000, postTokens: 30_000 }]);
    expect(loadCompactions(db, iso(0), iso(1000)).map((c) => c.threadKey)).toEqual(["7", "tied"]); // no log file recorded: the session stands in
  });
});
