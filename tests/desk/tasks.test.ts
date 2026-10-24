import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openLedger } from "../../src/desk/ledger/db.ts";
import { assignTasks, methodShares } from "../../src/desk/tasks/assign.ts";
import { explicitLabel, identify, type TaskMarker, type TaskSessionFacts } from "../../src/desk/tasks/identity.ts";
import { appendMarker, labelFromEnv, readMarkers } from "../../src/desk/tasks/markers.ts";

const session = (over: Partial<TaskSessionFacts> = {}): TaskSessionFacts => ({
  sessionId: "11111111-aaaa",
  projectPath: "C:\\work\\shop",
  gitBranch: null,
  startedAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-tasks-"));
  dirs.push(d);
  return d;
};

describe("task identity, in the order explicit label, ticket, pull request, branch, session", () => {
  it("takes an explicit label over everything else", () => {
    const m: TaskMarker[] = [{ ts: "2026-10-20T09:00:00.000Z", label: "checkout-rewrite", project: "C:\\work\\shop" }];
    const id = identify(session({ gitBranch: "feat/SHOP-142-cart" }), m);
    expect(id).toMatchObject({ method: "explicit", label: "checkout-rewrite", taskId: "explicit:checkout-rewrite" });
  });

  it("takes a ticket key from the branch before a pull request number or the branch itself", () => {
    expect(identify(session({ gitBranch: "feat/SHOP-142-cart" }))).toMatchObject({ method: "ticket", label: "SHOP-142" });
    expect(identify(session({ gitBranch: "SHOP-142/pr-9" }))).toMatchObject({ method: "ticket", label: "SHOP-142" });
  });

  it("takes a pull request number from the branch when there is no ticket", () => {
    expect(identify(session({ gitBranch: "pr/418" }))).toMatchObject({ method: "pull_request", label: "#418" });
    expect(identify(session({ gitBranch: "pull/418/head" }))).toMatchObject({ method: "pull_request", label: "#418" });
    expect(identify(session({ gitBranch: "pr-7" }))).toMatchObject({ method: "pull_request", label: "#7" });
  });

  it("takes a feature branch as the task, and groups sessions on it", () => {
    const a = identify(session({ sessionId: "a", gitBranch: "feat/new-cart" }));
    const b = identify(session({ sessionId: "b", gitBranch: "feat/new-cart" }));
    expect(a.method).toBe("branch");
    expect(a.taskId).toBe(b.taskId);
  });

  it("does not treat a default branch as a task, so each such session is its own task", () => {
    for (const branch of ["main", "master", "develop", "HEAD", "trunk", null, ""]) {
      expect(identify(session({ gitBranch: branch }))).toMatchObject({ method: "session", taskId: "session:11111111-aaaa" });
    }
  });

  it("does not read a version number, a hash or a lowercase word as a ticket", () => {
    for (const branch of ["release-1-2", "v2-3", "abc-123", "fix/ab12cd-34", "feat/a-1"]) {
      expect(identify(session({ gitBranch: branch })).method).not.toBe("ticket");
    }
  });

  it("does not read pr inside another word as a pull request", () => {
    expect(identify(session({ gitBranch: "feat/improve-prompt-12" })).method).toBe("branch");
    expect(identify(session({ gitBranch: "feat/sprint-3" })).method).toBe("branch");
  });
});

describe("the explicit label in force", () => {
  const folder = "C:\\work\\shop";
  it("is the latest label set at or before the session started", () => {
    const m: TaskMarker[] = [
      { ts: "2026-10-20T08:00:00.000Z", label: "first", project: folder },
      { ts: "2026-10-20T09:30:00.000Z", label: "second", project: folder },
      { ts: "2026-10-20T11:00:00.000Z", label: "third", project: folder },
    ];
    expect(explicitLabel(session({ projectPath: folder }), m)).toBe("second");
    expect(explicitLabel(session({ projectPath: folder, startedAt: "2026-10-20T07:00:00.000Z" }), m)).toBeNull();
  });

  it("ends when a null label is set", () => {
    const m: TaskMarker[] = [
      { ts: "2026-10-20T08:00:00.000Z", label: "first", project: folder },
      { ts: "2026-10-20T09:00:00.000Z", label: null, project: folder },
    ];
    expect(explicitLabel(session({ projectPath: folder }), m)).toBeNull();
  });

  it("applies to folders below the one it was set for, and to no other folder", () => {
    const m: TaskMarker[] = [{ ts: "2026-10-20T08:00:00.000Z", label: "shop", project: "C:/work/shop/" }];
    expect(explicitLabel(session({ projectPath: "c:\\work\\shop\\api" }), m)).toBe("shop");
    expect(explicitLabel(session({ projectPath: "C:\\work\\shop-admin" }), m)).toBeNull();
    expect(explicitLabel(session({ projectPath: "C:\\work\\other" }), m)).toBeNull();
    expect(explicitLabel(session({ projectPath: null }), m)).toBeNull();
  });

  it("applies to every folder when none was named", () => {
    const m: TaskMarker[] = [{ ts: "2026-10-20T08:00:00.000Z", label: "anywhere", project: null }];
    expect(explicitLabel(session({ projectPath: "D:\\x" }), m)).toBe("anywhere");
  });

  it("is nothing for a session with no start time or a bad one", () => {
    const m: TaskMarker[] = [{ ts: "2026-10-20T08:00:00.000Z", label: "x", project: null }];
    expect(explicitLabel(session({ startedAt: null }), m)).toBeNull();
    expect(explicitLabel(session({ startedAt: "not a time" }), m)).toBeNull();
  });

  it("treats a blank label as no label", () => {
    const m: TaskMarker[] = [{ ts: "2026-10-20T08:00:00.000Z", label: "   ", project: null }];
    expect(identify(session({ gitBranch: "feat/x" }), m).method).toBe("branch");
  });
});

describe("the label file", () => {
  it("round-trips, skips junk lines, and is empty when missing", () => {
    const file = join(tmp(), "nested", "tasks.jsonl");
    expect(readMarkers(file)).toEqual([]);
    appendMarker(file, { ts: "2026-10-20T08:00:00.000Z", label: "a", project: "C:/x" });
    appendMarker(file, { ts: "2026-10-20T09:00:00.000Z", label: null, project: null });
    writeFileSync(file, `${["{not json", '{"ts":"bad","label":"z"}', '{"ts":"2026-10-20T10:00:00.000Z","label":5}'].join("\n")}\n`, { flag: "a" });
    expect(readMarkers(file)).toEqual([
      { ts: "2026-10-20T08:00:00.000Z", label: "a", project: "C:/x" },
      { ts: "2026-10-20T09:00:00.000Z", label: null, project: null },
    ]);
  });

  it("reads the label a wrapper set in DESK_TASK", () => {
    expect(labelFromEnv({ DESK_TASK: " ship-it " })).toBe("ship-it");
    expect(labelFromEnv({ DESK_TASK: "  " })).toBeNull();
    expect(labelFromEnv({})).toBeNull();
  });
});

describe("assigning tasks in the ledger", () => {
  function ledgerWith(sessions: { id: string; project: string; branch: string | null; start: string; end: string }[]) {
    const db = openLedger(":memory:");
    for (const s of sessions) db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at) VALUES (?, 'claude_code', ?, ?, ?, ?)").run(s.id, s.project, s.branch, s.start, s.end);
    return db;
  }

  it("groups sessions of one branch into one task with the span of all of them, and counts tasks per method", () => {
    const db = ledgerWith([
      { id: "s1", project: "C:/w/shop", branch: "feat/SHOP-1-a", start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T10:00:00.000Z" },
      { id: "s2", project: "C:/w/shop", branch: "feat/SHOP-1-a", start: "2026-10-21T09:00:00.000Z", end: "2026-10-21T11:00:00.000Z" },
      { id: "s3", project: "C:/w/shop", branch: "feat/other", start: "2026-10-21T12:00:00.000Z", end: "2026-10-21T12:30:00.000Z" },
      { id: "s4", project: "C:/w/shop", branch: "main", start: "2026-10-22T12:00:00.000Z", end: "2026-10-22T12:30:00.000Z" },
    ]);
    const r = assignTasks(db, []);
    expect(r).toEqual({ sessions: 4, tasks: 3, byMethod: { explicit: 0, ticket: 1, pull_request: 0, branch: 1, session: 1 } });
    const t = db.prepare("SELECT task_id, first_ts, last_ts FROM task WHERE method = 'ticket'").get() as { task_id: string; first_ts: string; last_ts: string };
    expect(t).toEqual({ task_id: "ticket:SHOP-1", first_ts: "2026-10-20T09:00:00.000Z", last_ts: "2026-10-21T11:00:00.000Z" });
    expect((db.prepare("SELECT COUNT(*) n FROM task_session WHERE task_id = 'ticket:SHOP-1'").get() as { n: number }).n).toBe(2);
    db.close();
  });

  it("is rerunnable: a removed label stops applying and an added one starts", () => {
    const db = ledgerWith([{ id: "s1", project: "C:/w/shop", branch: "feat/x", start: "2026-10-20T10:00:00.000Z", end: "2026-10-20T11:00:00.000Z" }]);
    expect(assignTasks(db, [{ ts: "2026-10-20T09:00:00.000Z", label: "named", project: "C:/w/shop" }]).byMethod.explicit).toBe(1);
    expect(assignTasks(db, []).byMethod).toMatchObject({ explicit: 0, branch: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM task").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("handles an empty ledger", () => {
    const db = openLedger(":memory:");
    expect(assignTasks(db, [])).toEqual({ sessions: 0, tasks: 0, byMethod: { explicit: 0, ticket: 0, pull_request: 0, branch: 0, session: 0 } });
    expect(methodShares(db).every((m) => m.tasks === 0 && m.spendMicros === 0)).toBe(true);
    db.close();
  });

  it("reports spend per method, counting only estimated cost", () => {
    const db = ledgerWith([
      { id: "s1", project: "C:/w/shop", branch: "feat/SHOP-1-a", start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T10:00:00.000Z" },
      { id: "s2", project: "C:/w/shop", branch: "main", start: "2026-10-21T09:00:00.000Z", end: "2026-10-21T10:00:00.000Z" },
    ]);
    db.prepare("INSERT INTO price_snapshot (snapshot_id, source, source_url, fetched_at, license, upstream_sha256, content_hash, note) VALUES ('p', 's', 'u', 't', 'l', 'h', 'h', 'n')").run();
    for (const [cid, sid, micros] of [["c1", "s1", 4_000_000], ["c2", "s2", 1_000_000]] as const) {
      db.prepare(
        "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, '2026-10-21T09:30:00.000Z', 'm', 0, 1, 1, 0, 0, 0, 0, 'reported', 0, 0)",
      ).run(cid, sid);
      db.prepare("INSERT INTO cost_event (call_id, class, snapshot_id, total_micros, input_micros, output_micros, cache_read_micros, cache_write_5m_micros, cache_write_1h_micros) VALUES (?, 'estimated', 'p', ?, ?, 0, 0, 0, 0)").run(cid, micros, micros);
    }
    assignTasks(db, []);
    const shares = methodShares(db);
    expect(shares.find((m) => m.method === "ticket")).toEqual({ method: "ticket", tasks: 1, sessions: 1, spendMicros: 4_000_000 });
    expect(shares.find((m) => m.method === "session")).toEqual({ method: "session", tasks: 1, sessions: 1, spendMicros: 1_000_000 });
    expect(shares.map((m) => m.method)).toEqual(["explicit", "ticket", "pull_request", "branch", "session"]);
    db.close();
  });
});

describe("desk task", () => {
  const e = (over: Partial<import("../../src/desk/tasks/command.ts").TaskCommandEnv> = {}) => ({
    markerPath: join(tmp(), "tasks.jsonl"),
    cwd: "C:\work\shop",
    nowIso: "2026-10-20T10:00:00.000Z",
    env: {} as Record<string, string | undefined>,
    db: null,
    markCommand: 'node "/x/mark.ts"',
    ...over,
  });

  it("says no label is set, sets one for the folder, and ends it", async () => {
    const { taskCommand } = await import("../../src/desk/tasks/command.ts");
    const env = e();
    expect(taskCommand([], env)).toMatch(/No task label is set/);
    expect(taskCommand(["checkout-rewrite"], env)).toMatch(/Task "checkout-rewrite" is set/);
    expect(readMarkers(env.markerPath)).toEqual([{ ts: env.nowIso, label: "checkout-rewrite", project: env.cwd }]);
    expect(taskCommand([], { ...env, nowIso: "2026-10-20T11:00:00.000Z" })).toMatch(/Task "checkout-rewrite" is set/);
    expect(taskCommand(["end"], { ...env, nowIso: "2026-10-20T12:00:00.000Z" })).toMatch(/has ended/);
    expect(taskCommand([], { ...env, nowIso: "2026-10-20T13:00:00.000Z" })).toMatch(/No task label is set/);
  });

  it("takes a label of several words, and `set` for a label that is also a command word", async () => {
    const { taskCommand } = await import("../../src/desk/tasks/command.ts");
    const env = e();
    taskCommand(["fix", "the", "cart"], env);
    taskCommand(["set", "end"], { ...env, nowIso: "2026-10-20T10:05:00.000Z" });
    expect(readMarkers(env.markerPath).map((m) => m.label)).toEqual(["fix the cart", "end"]);
    expect(() => taskCommand(["set"], env)).toThrowError(/Use: desk task/);
  });

  it("records DESK_TASK once, and prints nothing, because a hook's output goes into the session", async () => {
    const { taskCommand } = await import("../../src/desk/tasks/command.ts");
    const env = e({ env: { DESK_TASK: "ship-it" } });
    expect(taskCommand(["mark"], env)).toBe("");
    expect(taskCommand(["mark"], { ...env, nowIso: "2026-10-20T10:30:00.000Z" })).toBe("");
    expect(readMarkers(env.markerPath)).toEqual([{ ts: env.nowIso, label: "ship-it", project: env.cwd }]);
    const none = e();
    expect(taskCommand(["mark"], none)).toBe("");
    expect(readMarkers(none.markerPath)).toEqual([]);
  });

  it("prints the hook setting and changes nothing", async () => {
    const { taskCommand } = await import("../../src/desk/tasks/command.ts");
    const env = e();
    const text = taskCommand(["hook"], env);
    expect(text).toContain('"SessionStart"');
    expect(text).toContain('node \\"/x/mark.ts\\"');
    expect(readMarkers(env.markerPath)).toEqual([]);
  });

  it("lists tasks by method from the ledger, and says when there is no ledger or no session", async () => {
    const { taskCommand } = await import("../../src/desk/tasks/command.ts");
    expect(taskCommand(["list"], e())).toMatch(/No ledger/);
    const db = openLedger(":memory:");
    expect(taskCommand(["list"], e({ db }))).toMatch(/No sessions in the ledger/);
    db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at) VALUES ('s1', 'claude_code', 'C:/w/shop', 'feat/SHOP-9-x', '2026-10-20T09:00:00.000Z', '2026-10-20T10:00:00.000Z')").run();
    const text = taskCommand(["list"], e({ db }));
    expect(text).toMatch(/1 tasks over 1 sessions/);
    expect(text).toMatch(/ticket\s+1 tasks/);
    expect(text).toMatch(/SHOP-9/);
    db.close();
  });

  it("refuses an unknown subcommand shape with one usage line", async () => {
    const { taskCommand } = await import("../../src/desk/tasks/command.ts");
    expect(() => taskCommand(["run"], e())).toThrowError(/Use: desk task/);
  });
});

describe("the SessionStart hook entry", () => {
  it("writes the label from DESK_TASK to the file named by DESK_TASKS_FILE, and prints nothing", async () => {
    const { spawnSync } = await import("node:child_process");
    const file = join(tmp(), "tasks.jsonl");
    const r = spawnSync(process.execPath, ["src/desk/tasks/mark.ts"], { encoding: "utf8", env: { ...process.env, DESK_TASK: "from-hook", DESK_TASKS_FILE: file } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.replace(/\(node:\d+\) ExperimentalWarning[^\n]*\n?/g, "").replace(/\(Use `node --trace-warnings[^\n]*\n?/g, "")).toBe("");
    expect(readMarkers(file).map((m) => m.label)).toEqual(["from-hook"]);
  });

  it("stays silent and exits 0 when the label file cannot be written", async () => {
    const { spawnSync } = await import("node:child_process");
    // The folder of the label file is a file, so it cannot be created.
    const blocker = join(tmp(), "a-file");
    writeFileSync(blocker, "x");
    const r = spawnSync(process.execPath, ["src/desk/tasks/mark.ts"], { encoding: "utf8", env: { ...process.env, DESK_TASK: "x", DESK_TASKS_FILE: join(blocker, "tasks.jsonl") } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
