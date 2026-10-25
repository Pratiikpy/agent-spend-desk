import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openCapture } from "../../../src/desk/capture/store.ts";
import { tasksPanel } from "../../../src/desk/ui/tasks-panel.ts";

/** The owner's own tasks on the Canary screen (DF-036): read-only, honest about an empty or older store, and never the owner's prompt. */
const root = mkdtempSync(join(tmpdir(), "desk-tasks-panel-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function seed(path: string): void {
  const db = openCapture(path);
  const add = (id: string, status: string, kind: string, area: string, oracle: string | null, held: number | null): void => {
    db.prepare("INSERT INTO canary_task (task_id, status, repo_path, repo_label, session_id, base_sha, result_sha, commits_json, prompt, prompt_sha, prompt_count, injection_json, kind, area, files_json, test_files_json, runnable_json, diff_lines, reasons_json, oracle, held_out, captured_at) VALUES (?, ?, 'r', 'payments-api', 's', 'a', 'b', '[]', 'Fix the rounding bug in invoices, my secret plan', 'x', 1, '[]', ?, ?, '[]', '[]', '[]', 42, '[]', ?, ?, 'now')").run(id, status, kind, area, oracle, held);
  };
  add("t1", "accepted", "bugfix", "src/billing", "strong", 0);
  add("t2", "accepted", "bugfix", "src/billing", "weak", 1);
  add("t3", "accepted", "feature", "src/ui", "strong", 0);
  add("t4", "computed", "docs", "docs", "strong", null);
  add("t5", "ineligible", "other", "misc", null, null);
  add("t6", "rejected", "refactor", "src/core", "strong", null);
  db.prepare("INSERT INTO canary_suite (suite_id, created_at, task_ids_json, held_out_json, hash, families_json, params_json) VALUES ('s1', '2026-10-24T10:00:00Z', '[\"t1\",\"t2\",\"t3\"]', '[\"t2\"]', ?, '[1,2]', '{}')").run("a".repeat(64));
  db.prepare("INSERT INTO replay_run (run_id, suite_id, created_at, baseline, candidate, params_json, status, report_json) VALUES ('run-1', 's1', '2026-10-24T11:00:00Z', 'strong', 'light', '{}', 'complete', ?)").run(JSON.stringify({ verdict: "worse", why: "the cheaper route passed 40 points fewer" }));
  db.close();
}

describe("the tasks panel", () => {
  it("says there is nothing yet, and what to run, without creating the store", () => {
    const path = join(root, "none.db");
    const p = tasksPanel(path);
    expect(p.state).toBe("none");
    expect(p.hint).toMatch(/desk capture candidates/);
    expect(existsSync(path)).toBe(false);
  });

  it("counts by state, lists the accepted tasks by kind with how well tests decide each, and shows frozen suites and compared models", () => {
    const path = join(root, "seeded.db");
    seed(path);
    const p = tasksPanel(path);
    expect(p.state).toBe("ok");
    expect(p.counts).toEqual({ accepted: 3, computed: 1, ineligible: 1, rejected: 1 });
    expect(p.accepted.map((t) => [t.kind, t.area, t.oracle, t.heldOut])).toEqual([["bugfix", "src/billing", "strong", false], ["bugfix", "src/billing", "weak", true], ["feature", "src/ui", "strong", false]]);
    expect(p.families).toEqual([{ kind: "bugfix", area: "src/billing", tasks: 2 }, { kind: "feature", area: "src/ui", tasks: 1 }]);
    expect(p.suites).toEqual([{ hash: "a".repeat(64), createdAt: "2026-10-24T10:00:00Z", tasks: 3, heldOut: 1, families: 2 }]);
    expect(p.swaps[0]).toMatchObject({ runId: "run-1", baseline: "strong", candidate: "light", status: "complete", verdict: "worse", why: "the cheaper route passed 40 points fewer" });
  });

  it("never carries the owner's prompt, the path to the repository or a commit", () => {
    const path = join(root, "seeded2.db");
    seed(path);
    const text = JSON.stringify(tasksPanel(path));
    expect(text).not.toContain("secret plan");
    expect(text).not.toContain("rounding bug");
    expect(text).not.toMatch(/"repo_path"|base_sha|result_sha/);
  });

  it("leaves the store as it found it, and reads a store from an older build as older, without upgrading it", () => {
    const path = join(root, "older.db");
    const db = openCapture(path);
    db.exec("PRAGMA user_version = 3");
    db.close();
    const p = tasksPanel(path);
    expect(p.state).toBe("older");
    expect(p.hint).toMatch(/older build/);
    const after = openCapture(":memory:");
    after.close();
    const again = tasksPanel(path);
    expect(again.state).toBe("older");
  });
});
