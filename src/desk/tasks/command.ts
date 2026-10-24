import type { Ledger } from "../ledger/db.ts";
import { formatUsd as usd } from "../money.ts";
import { assignTasks, methodShares, tasksWithSpend } from "./assign.ts";
import { TASK_METHODS, explicitLabel, type TaskMarker } from "./identity.ts";
import { appendMarker, markFromEnv, readMarkers } from "./markers.ts";

export interface TaskCommandEnv {
  markerPath: string;
  /** The folder the person is in; a label applies to this folder and every folder below it. */
  cwd: string;
  nowIso: string;
  env: Record<string, string | undefined>;
  /** The ledger, when there is one to read tasks from. */
  db: Ledger | null;
  /** The command the SessionStart hook runs (for example `node /path/to/src/desk/tasks/mark.ts`). */
  markCommand: string;
}

const RESERVED = new Set(["end", "list", "mark", "hook", "run", "set"]);

const METHOD_NOTE: Record<(typeof TASK_METHODS)[number], string> = {
  explicit: "a label you set",
  ticket: "a ticket key in the branch name",
  pull_request: "a pull request number in the branch name",
  branch: "a feature branch (main, master and develop are not tasks)",
  session: "no label, ticket, pull request or feature branch: the session is its own task",
};

/** The text of `desk task ...`. Writes a label to the label file for set, end and mark; reads for the rest. */
export function taskCommand(args: readonly string[], e: TaskCommandEnv): string {
  const [first, ...rest] = args;
  const markers = (): TaskMarker[] => readMarkers(e.markerPath);

  if (first === undefined) return status(e, markers());

  if (first === "end") {
    appendMarker(e.markerPath, { ts: e.nowIso, label: null, project: e.cwd });
    return `The task for ${e.cwd} and the folders below it has ended. Sessions started from now on are grouped by ticket, pull request or branch.`;
  }

  if (first === "set" || !RESERVED.has(first)) {
    const label = (first === "set" ? rest.join(" ") : [first, ...rest].join(" ")).trim();
    if (label === "") throw new Error('Use: desk task <label>   (for a label that is also a command word, desk task set <label>)');
    appendMarker(e.markerPath, { ts: e.nowIso, label, project: e.cwd });
    return `Task "${label}" is set for ${e.cwd} and the folders below it. Sessions started from now on belong to it until \`desk task end\`.`;
  }

  if (first === "mark") {
    // The hook's logic: a wrapper put the label in DESK_TASK, so record it for this folder, once. It prints nothing, as the hook must.
    markFromEnv(e.markerPath, e.cwd, e.nowIso, e.env);
    return "";
  }

  if (first === "hook") {
    return [
      "Add this to your Claude Code settings so that a label in DESK_TASK is recorded when a session starts. This only prints it; it changes nothing.",
      "",
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: e.markCommand }] }] } }, null, 2),
      "",
      "Then start a session with the label in the environment, or let `desk task run <label> -- <command>` do both:",
      "  DESK_TASK=checkout-rewrite claude",
    ].join("\n");
  }

  if (first === "list") return list(e);

  // "run" is handled by the caller: it needs to start a program.
  throw new Error("Use: desk task [<label> | end | list | mark | hook | run <label> -- <command>]");
}

function status(e: TaskCommandEnv, markers: readonly TaskMarker[]): string {
  const current = explicitLabel({ sessionId: "", projectPath: e.cwd, gitBranch: null, startedAt: e.nowIso }, markers);
  const lines = [current === null ? `No task label is set for ${e.cwd}. A session is grouped by ticket, pull request or branch, else it is its own task.` : `Task "${current}" is set for ${e.cwd}.`];
  lines.push("Set one with `desk task <label>`, end it with `desk task end`, see the tasks with `desk task list`.");
  return lines.join("\n");
}

function list(e: TaskCommandEnv): string {
  if (e.db === null) return "No ledger to read tasks from. Run `desk ingest` first.";
  const a = assignTasks(e.db, readMarkers(e.markerPath));
  if (a.sessions === 0) return "No sessions in the ledger yet. Run `desk ingest` first.";
  const shares = methodShares(e.db);
  const out = [`${a.tasks} tasks over ${a.sessions} sessions. How each task was identified:`];
  for (const s of shares) out.push(`  ${s.method.replace("_", " ").padEnd(13)} ${String(s.tasks).padStart(5)} tasks  ${String(s.sessions).padStart(5)} sessions  ${usd(s.spendMicros).padStart(10)}   ${METHOD_NOTE[s.method]}`);
  out.push("", "Latest tasks:");
  for (const t of tasksWithSpend(e.db, 15)) out.push(`  ${(t.lastTs ?? "").slice(0, 10)}  ${t.method.replace("_", " ").padEnd(13)} ${t.label.slice(0, 40).padEnd(40)} ${String(t.sessions).padStart(3)} sessions  ${usd(t.spendMicros).padStart(10)}`);
  out.push("", "Spend is the list-price estimate. A session on no feature branch is its own task; no prompt text is kept, so sessions are never grouped by what they were about.");
  return out.join("\n");
}
