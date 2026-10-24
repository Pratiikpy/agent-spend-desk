/**
 * Which task a session belongs to (DF-030). The order is the owner's explicit label, a ticket key, a pull request,
 * a feature branch, and last the session itself. A session with none of the first four is its own task, said so.
 *
 * What this cannot do: group sessions by what they were about. No prompt text is kept, so there is no "prompt thread"
 * method, and a task that was worked on under several branches is several tasks.
 */
export type TaskMethod = "explicit" | "ticket" | "pull_request" | "branch" | "session";

export const TASK_METHODS: readonly TaskMethod[] = ["explicit", "ticket", "pull_request", "branch", "session"];

export interface TaskSessionFacts {
  sessionId: string;
  /** The working folder, as the tool recorded it. */
  projectPath: string | null;
  gitBranch: string | null;
  /** When the session started (ISO), used to find the explicit label that was in force. */
  startedAt: string | null;
}

export interface TaskMarker {
  /** ISO time the label took effect. */
  ts: string;
  /** The label, or null for "no task from here on". */
  label: string | null;
  /** The folder the label applies to; a session below it is covered. null means every folder. */
  project: string | null;
}

export interface TaskIdentity {
  taskId: string;
  method: TaskMethod;
  label: string;
}

/** A Jira-style key: capital letters, a dash, digits. Kept short on both sides so a hash or a version number is not one. */
const TICKET = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9])/;
/** `pr/42`, `pr-42`, `pull/42/head`, `pulls/42`. */
const PULL_REQUEST = /(?:^|\/)(?:pr|pull|pulls)[-_/]?(\d{1,7})(?![A-Za-z0-9])/i;
const DEFAULT_BRANCHES = new Set(["main", "master", "develop", "development", "trunk", "head", "(no branch)"]);

function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function covers(markerProject: string | null, sessionProject: string | null): boolean {
  if (markerProject === null) return true;
  if (sessionProject === null) return false;
  const a = norm(markerProject);
  const b = norm(sessionProject);
  return b === a || b.startsWith(`${a}/`);
}

/** The label in force for a session: the latest marker at or before its start that covers its folder; a null label ends the task. */
export function explicitLabel(session: TaskSessionFacts, markers: readonly TaskMarker[]): string | null {
  if (session.startedAt === null) return null;
  const start = Date.parse(session.startedAt);
  if (Number.isNaN(start)) return null;
  let best: TaskMarker | null = null;
  for (const m of markers) {
    const t = Date.parse(m.ts);
    if (Number.isNaN(t) || t > start || !covers(m.project, session.projectPath)) continue;
    // A marker for a narrower folder beats a broader one set earlier only if it is later: the newest marker in force wins.
    if (best === null || t >= Date.parse(best.ts)) best = m;
  }
  return best?.label ?? null;
}

export function identify(session: TaskSessionFacts, markers: readonly TaskMarker[] = []): TaskIdentity {
  const label = explicitLabel(session, markers);
  if (label !== null && label.trim() !== "") return { taskId: `explicit:${label.trim()}`, method: "explicit", label: label.trim() };

  const branch = session.gitBranch?.trim() ?? "";
  if (branch !== "" && !DEFAULT_BRANCHES.has(branch.toLowerCase())) {
    const ticket = TICKET.exec(branch);
    if (ticket) return { taskId: `ticket:${ticket[1]}`, method: "ticket", label: ticket[1]! };
    const pr = PULL_REQUEST.exec(branch);
    if (pr) return { taskId: `pull_request:${session.projectPath ?? ""}#${pr[1]}`, method: "pull_request", label: `#${pr[1]}` };
    return { taskId: `branch:${session.projectPath ?? ""}:${branch}`, method: "branch", label: branch };
  }
  return { taskId: `session:${session.sessionId}`, method: "session", label: session.sessionId.slice(0, 8) };
}
