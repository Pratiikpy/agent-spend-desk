import type { Ledger } from "../ledger/db.ts";
import { discoverCandidates, type Candidate } from "./candidates.ts";
import { importLabTasks } from "./import-lab.ts";
import type { CaptureDb } from "./store.ts";
import type { Preset, TestPlan } from "./runner.ts";
import { computeTask, families, freezeSuite, getTask, listTasks, recordCandidate, reviewTask, TaskError, type Status, type TaskRow } from "./tasks.ts";

const PRESETS: readonly Preset[] = ["node", "vitest", "jest", "pytest", "custom"];

export interface CaptureFlags {
  repos?: string[];
  preset?: string;
  cmd?: string;
  format?: string;
  tests?: string;
  repeats?: string;
  weak?: boolean;
  ackInjection?: boolean;
  force?: boolean;
  why?: string;
  status?: string;
  min?: string;
  max?: string;
  all?: boolean;
  limit?: string;
  into?: string;
}

const j = <T>(s: string | null, f: T): T => (s === null ? f : (JSON.parse(s) as T));
const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function row(t: TaskRow): string {
  const f2p = j<string[]>(t.f2p_json, []).length;
  const p2p = j<string[]>(t.p2p_json, []).length;
  const oracle = t.oracle ? `${t.oracle} (${f2p} fail-to-pass, ${p2p} pass-to-pass)` : "not measured";
  return `${t.task_id}  ${t.status.padEnd(10)} ${t.kind.padEnd(8)} ${t.area.padEnd(14)} ${t.repo_label}  ${oracle}${t.held_out === 1 ? "  held out" : ""}`;
}

export function showTask(t: TaskRow): string {
  const lines = [row(t), "", `repository ${t.repo_label}, session ${t.session_id.slice(0, 8)}, ${t.prompt_count} prompt${t.prompt_count === 1 ? "" : "s"} before the last commit`, `from ${t.base_sha.slice(0, 10)} to ${t.result_sha.slice(0, 10)}: ${j<string[]>(t.files_json, []).length} files, ${t.diff_lines} lines changed`];
  const inj = j<string[]>(t.injection_json, []);
  if (inj.length > 0) lines.push(`PROMPT HOLDS INSTRUCTION-LIKE TEXT: ${inj.join(", ")}`);
  lines.push("", "prompt (redacted):", ...t.prompt.split("\n").map((l) => `  ${l}`));
  const reasons = j<string[]>(t.reasons_json, []);
  if (reasons.length > 0) lines.push("", "set aside because:", ...reasons.map((r) => `  - ${r}`));
  if (t.oracle) {
    const f2p = j<string[]>(t.f2p_json, []);
    const p2p = j<string[]>(t.p2p_json, []);
    lines.push("", `tests that decide it (${t.oracle}):`, ...f2p.slice(0, 20).map((x) => `  must pass: ${x}`), ...(f2p.length > 20 ? [`  and ${f2p.length - 20} more`] : []), `  and ${p2p.length} that must keep passing`);
    const flaky = j<string[]>(t.flaky_json, []);
    if (flaky.length > 0) lines.push(`  set aside as flaky: ${flaky.length}`);
    const extra = j<{ reasons?: string[] }>(t.oracle_json, {});
    for (const r of extra.reasons ?? []) lines.push(`  note: ${r}`);
  }
  return lines.join("\n");
}

export function planFrom(f: CaptureFlags, repoPath: string): TestPlan {
  const preset = (f.preset ?? "node") as Preset;
  if (!PRESETS.includes(preset)) throw new TaskError(`the presets are ${PRESETS.join(", ")}`);
  if (preset === "custom" && !f.cmd) throw new TaskError("a custom preset needs --cmd, with {files} where the test files go and {out} where the results are written");
  const format = f.format as TestPlan["format"] | undefined;
  if (format !== undefined && !["junit", "tap", "json", "exit"].includes(format)) throw new TaskError("--format is junit, tap, json or exit");
  return { preset, depsFrom: repoPath, ...(f.cmd ? { command: f.cmd } : {}), ...(format ? { format } : {}) };
}

/** `desk capture <candidates|list|show|compute|accept|reject|families|freeze>`. */
export function captureCommand(o: { sub: string | undefined; args: string[]; flags: CaptureFlags; store: CaptureDb; ledger: () => Ledger; now?: () => Date }): string {
  const sub = o.sub ?? "help";
  const now = o.now ?? (() => new Date());
  try {
    if (sub === "candidates") {
      const r = discoverCandidates(o.ledger(), o.flags.repos ? { repos: o.flags.repos } : {});
      let added = 0;
      let eligible = 0;
      for (const c of r.candidates as Candidate[]) {
        if (recordCandidate(o.store, c, now().toISOString()) === "new") added += 1;
        if (c.eligible) eligible += 1;
      }
      const lines = [`${r.considered} session${r.considered === 1 ? "" : "s"} of work that was merged and kept; ${eligible} can be a task, ${r.considered - eligible} cannot; ${added} new to this store.`];
      const reasons = Object.entries(r.reasonCounts).sort((a, b) => b[1] - a[1]);
      if (reasons.length > 0) {
        lines.push("why the rest cannot:");
        for (const [why, n] of reasons) lines.push(`  ${String(n).padStart(4)}  ${why}`);
      }
      const shown = (r.candidates as Candidate[]).filter((c) => c.eligible).slice(0, 20);
      if (shown.length > 0) {
        lines.push("candidates:");
        for (const c of shown) lines.push(`  ${c.taskId}  ${c.kind.padEnd(8)} ${c.area.padEnd(14)} ${c.repoLabel}  ${c.runnable.length} test file${c.runnable.length === 1 ? "" : "s"}, ${c.diffLines} lines  ${short(c.prompt.replace(/\s+/g, " "), 70)}`);
        lines.push("next: desk capture compute <id> to run the tests before and after, then desk capture show <id> and accept or reject it.");
      }
      return lines.join("\n");
    }
    if (sub === "import") {
      const dir = o.args[0];
      if (!dir) return "Name a folder of tasks in the Lab's layout: desk capture import lab/tasks/spike [--into DIR]";
      const r = importLabTasks(o.store, dir, o.flags.into ?? "data/desk/capture-tasks", now().toISOString());
      return [`${r.imported.length} task${r.imported.length === 1 ? "" : "s"} brought in as small repositories under ${o.flags.into ?? "data/desk/capture-tasks"}; ${r.skipped.length} skipped.`, ...r.skipped.map((s) => `  ${s.id}: ${s.why}`), r.imported.length > 0 ? "next: desk capture compute --all" : ""].filter(Boolean).join("\n");
    }
    if (sub === "list") {
      const status = o.flags.status as Status | undefined;
      const rows = listTasks(o.store, status);
      if (rows.length === 0) return status ? `No task is ${status}.` : "No task has been captured. desk capture candidates looks through your history.";
      return rows.map(row).join("\n");
    }
    const id = o.args[0] ?? "";
    if (sub === "show") {
      const t = getTask(o.store, id);
      return t ? showTask(t) : `No task ${JSON.stringify(id)}. desk capture list shows them.`;
    }
    if (sub === "compute") {
      const targets = o.flags.all ? listTasks(o.store, "candidate").map((t) => t.task_id) : [id];
      if (targets.length === 0 || targets[0] === "") return "Name a task: desk capture compute <id>, or --all for every candidate not yet measured.";
      const out: string[] = [];
      for (const tid of targets) {
        const t = getTask(o.store, tid);
        if (!t) {
          out.push(`No task ${JSON.stringify(tid)}.`);
          continue;
        }
        const plan = planFrom(o.flags, t.repo_path);
        const tests = o.flags.tests ? o.flags.tests.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
        const { task, oracle } = computeTask(o.store, tid, { plan, ...(tests ? { tests } : {}), ...(o.flags.repeats ? { repeatsAfter: Number(o.flags.repeats) } : {}), ...(o.flags.force ? { force: true } : {}), now });
        out.push(`${tid}: ${oracle.status === "unrunnable" ? "UNRUNNABLE" : oracle.oracle.toUpperCase()}; ${oracle.failToPass.length} tests fail before and pass after, ${oracle.passToPass.length} pass in both, ${oracle.flaky.length} flaky, ${oracle.failingAfter.length} still failing after`);
        for (const r of oracle.reasons) out.push(`  ${r}`);
        void task;
      }
      return out.join("\n");
    }
    if (sub === "accept" && o.flags.all) {
      // Every measured task that has a test deciding it and a prompt with nothing instruction-like in it: the review is the owner's, and this is the owner saying yes to those.
      const ready = listTasks(o.store, "computed").filter((t) => t.oracle === "strong" && j<string[]>(t.injection_json, []).length === 0);
      for (const t of ready) reviewTask(o.store, t.task_id, "accept", { ...(o.flags.why ? { note: o.flags.why } : {}), now });
      const left = listTasks(o.store, "computed").length;
      return `${ready.length} task${ready.length === 1 ? "" : "s"} accepted.${left > 0 ? ` ${left} measured task${left === 1 ? "" : "s"} left for you to look at one by one (a weak oracle, or a prompt with instruction-like text).` : ""}`;
    }
    if (sub === "accept" || sub === "reject") {
      const t = reviewTask(o.store, id, sub, { ...(o.flags.weak ? { weak: true } : {}), ...(o.flags.ackInjection ? { ackInjection: true } : {}), ...(o.flags.why ? { note: o.flags.why } : {}), now });
      return `${t.task_id} is ${t.status}.`;
    }
    if (sub === "families") {
      const status = (o.flags.status as Status | undefined) ?? "accepted";
      const fam = families(o.store, status);
      if (fam.length === 0) return `No ${status} task, so no family has any.`;
      const kinds = new Set(fam.map((f) => f.kind));
      return [...fam.map((f) => `${f.kind.padEnd(8)} ${f.area.padEnd(18)} ${f.tasks.length} task${f.tasks.length === 1 ? "" : "s"}`), ...["bugfix", "feature", "refactor"].filter((k) => !kinds.has(k)).map((k) => `${k.padEnd(8)} none: nothing in your history of this kind was accepted`)].join("\n");
    }
    if (sub === "freeze") {
      const s = freezeSuite(o.store, { ...(o.flags.min ? { min: Number(o.flags.min) } : {}), ...(o.flags.max ? { max: Number(o.flags.max) } : {}), now });
      const lines = [`${s.suiteId}: ${s.taskIds.length} tasks, ${s.heldOut.length} held out, hash ${s.hash.slice(0, 16)}`];
      if (s.taskIds.length < 12) lines.push("SMALL: fewer than 12 tasks, so a difference between routes has to be large to show.");
      if (s.emptyKinds.length > 0) lines.push(`no task of this kind: ${s.emptyKinds.join(", ")}`);
      return lines.join("\n");
    }
  } catch (e) {
    return e instanceof TaskError ? e.message : `Could not ${sub}: ${(e as Error).message}`;
  }
  return [
    "desk capture: turn work you merged and kept into tasks a route can be tested on",
    "  candidates [--repo PATH]     find them in your history, with the reason each of the rest cannot be one",
    "  import <folder>              bring in tasks written or mined elsewhere, in the Lab's layout",
    "  compute <id> [--preset node|vitest|jest|pytest|custom] [--cmd ... --format ...] [--tests a,b] [--repeats N]",
    "                               run your tests before and after the work, to find the ones that decide it",
    "  show <id> | list [--status S] | families",
    "  accept <id> [--weak] [--ack-injection] | reject <id> [--why ...]",
    "  freeze [--min 12 --max 40]   fix the accepted tasks as a suite, half held out",
  ].join("\n");
}
