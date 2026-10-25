import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { importLabTasks, labExpected } from "../capture/import-lab.ts";
import { computeOracle } from "../capture/oracle.ts";
import { openCapture } from "../capture/store.ts";
import { computeTask, listTasks, reviewTask } from "../capture/tasks.ts";
import { loadTasks } from "../lab/task.ts";
import { pinCommit } from "../snapshot/shadow.ts";

/**
 * Task capture (DF-036), run on repositories made for the purpose and on the Lab's own ten tasks. In a repository with a planted change the oracle must find exactly the planted
 * tests that fail before and pass after, exactly the one that passes in both, and set the planted flaky test aside; it must call a change with no such test a weak oracle and a
 * run that gave no results unrunnable, and must refuse to accept a weak or unmeasured task. On each of the Lab's ten tasks, the tests the Desk finds to be the deciding ones must
 * be the ones the Lab's own audit listed, which was made by a different program.
 */
export function captureProve(): { ok: boolean; detail: string } {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-capture-"));
  const fails: string[] = [];
  let labCount = 0;
  let labTests = 0;
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    const g = (args: string[], at?: string): string =>
      execFileSync("git", ["-c", "user.name=prove", "-c", "user.email=prove@localhost", "-c", "core.autocrlf=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) } }).trim();
    const put = (path: string, content: string): void => {
      const p = join(repo, ...path.split("/"));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    };
    const head = 'const t = require("node:test"); const a = require("node:assert"); const m = require("../src/clamp.js");\n';
    const before = `${head}t("keeps a value in range", () => a.strictEqual(m.clamp(3, 0, 5), 3));\n`;
    const counter = join(root, "flaky.count");
    const flaky = `t("flaky", () => { const fs = require("node:fs"); const p = ${JSON.stringify(counter)}; const c = fs.existsSync(p) ? Number(fs.readFileSync(p, "utf8")) : 0; fs.writeFileSync(p, String(c + 1)); a.ok(c === 1); });\n`;
    const after = `${before}t("clamps above", () => a.strictEqual(m.clamp(9, 0, 5), 5));\nt.describe("below", () => { t("clamps below", () => a.strictEqual(m.clamp(-4, 0, 5), 0)); });\n${flaky}`;
    g(["init", "-q", "-b", "main"]);
    put("src/clamp.js", "exports.clamp = (x, lo, hi) => x;\n");
    put("test/clamp.test.js", before);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "base"], "2026-10-01T09:00:00Z");
    const base = g(["rev-parse", "HEAD"]);
    put("src/clamp.js", "exports.clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));\n");
    put("test/clamp.test.js", after);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", "fix"], "2026-10-01T10:00:00Z");
    const result = g(["rev-parse", "HEAD"]);
    pinCommit({ repo, name: "p-base", commit: base });
    pinCommit({ repo, name: "p-result", commit: result });
    const strong = computeOracle({ repo, baseRef: "p-base", resultRef: "p-result", overlay: ["test/clamp.test.js"], runnable: ["test/clamp.test.js"], plan: { preset: "node" } });
    const want = { f2p: ["test/clamp.test.js::below > clamps below", "test/clamp.test.js::clamps above"], p2p: ["test/clamp.test.js::keeps a value in range"], flaky: ["test/clamp.test.js::flaky"] };
    if (strong.oracle !== "strong" || JSON.stringify(strong.failToPass) !== JSON.stringify(want.f2p)) fails.push(`the deciding tests were ${JSON.stringify(strong.failToPass)}`);
    if (JSON.stringify(strong.passToPass) !== JSON.stringify(want.p2p)) fails.push(`the keep-passing tests were ${JSON.stringify(strong.passToPass)}`);
    if (JSON.stringify(strong.flaky) !== JSON.stringify(want.flaky)) fails.push(`the flaky tests were ${JSON.stringify(strong.flaky)}`);
    const weak = computeOracle({ repo, baseRef: "p-base", resultRef: "p-base", overlay: [], runnable: ["test/clamp.test.js"], plan: { preset: "node" } });
    if (weak.oracle !== "weak" || weak.failToPass.length > 0) fails.push("a change with no test that decides it was not a weak oracle");
    const none = computeOracle({ repo, baseRef: "p-base", resultRef: "p-result", overlay: ["test/clamp.test.js"], runnable: ["test/clamp.test.js"], plan: { preset: "custom", command: `"${process.execPath}" -e "process.exit(0)"`, format: "junit" } });
    if (none.status !== "unrunnable" || none.oracle !== "none") fails.push("a run with no results was not unrunnable");

    const store = openCapture(":memory:");
    const labRoot = "lab/tasks/spike";
    const labs = loadTasks(labRoot);
    labCount = labs.length;
    const imported = importLabTasks(store, labRoot, join(root, "lab-repos"), "2026-10-25T00:00:00.000Z");
    if (imported.skipped.length > 0) fails.push(`${imported.skipped.length} Lab tasks were not imported`);
    for (const t of labs) {
      const row = listTasks(store).find((x) => x.repo_label === `lab-${t.id}`);
      if (!row) {
        fails.push(`${t.id} was not imported`);
        continue;
      }
      const { oracle } = computeTask(store, row.task_id, { plan: { preset: "node" } });
      const exp = labExpected(t);
      const found = oracle.failToPass.map((id) => id.slice(id.indexOf("::") + 2)).sort();
      if (oracle.oracle !== "strong" || !exp || JSON.stringify(found) !== JSON.stringify([...exp.failToPass].sort())) fails.push(`${t.id}: the Desk found ${found.length} deciding tests and the Lab's audit lists ${exp?.failToPass.length ?? "none"}`);
      labTests += found.length;
    }
    const some = listTasks(store)[0];
    if (some) {
      let refused = 0;
      try {
        reviewTask(store, "nope", "accept");
      } catch {
        refused += 1;
      }
      store.prepare("UPDATE canary_task SET oracle = 'weak' WHERE task_id = ?").run(some.task_id);
      try {
        reviewTask(store, some.task_id, "accept");
      } catch {
        refused += 1;
      }
      if (refused !== 2) fails.push("a weak or unknown task was accepted");
    }
  } catch (e) {
    fails.push(`it threw: ${(e as Error).message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  if (fails.length > 0) return { ok: false, detail: fails.join("; ") };
  return { ok: true, detail: `in a planted repository the oracle found the 2 tests that fail before and pass after, the 1 that passes in both, and set the flaky one aside; a change with no deciding test was weak and a run with no results unrunnable; on the Lab's ${labCount} tasks the ${labTests} deciding tests the Desk found are the ones the Lab's audit lists` };
}
