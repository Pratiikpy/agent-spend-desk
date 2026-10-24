import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Pause with checkpoint (DF-051). When a loop stop or a cap on a long window fires, the gate does not just refuse: it opens a checkpoint for the session,
 * writes a handoff file with what the Desk knows (why, the spend, the project, how to resume), tells the agent to finish its step, write its own part
 * of the handoff into that file and stop, and then allows nothing else in that session except writing that one file. The owner resumes the session; if the
 * cap still binds, the resume needs an extension, which is a signed, limited grant of headroom.
 *
 * A cap on the last ten minutes or the last hour is not a checkpoint: it clears by itself, and stopping the session until a person comes back would only
 * be a nuisance.
 */
export interface CheckpointRow {
  id: number;
  session_id: string;
  person: string;
  project: string | null;
  model: string | null;
  created_at: string;
  reason_code: string;
  reason: string;
  matched: string[];
  handoff_path: string;
  /** What the refused request needed, in micro-dollars: the room a resume has to find, so that the request that stopped the session is not refused again. */
  needed_micros: number;
  status: "open" | "resumed";
  resumed_at: string | null;
  resumed_by: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gate_checkpoint (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  person TEXT NOT NULL,
  project TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  matched TEXT NOT NULL DEFAULT '[]',
  handoff_path TEXT NOT NULL,
  needed_micros INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('open', 'resumed')),
  resumed_at TEXT,
  resumed_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_checkpoint_one_open ON gate_checkpoint (session_id) WHERE status = 'open';
`;

/** Whether a refusal is one that stops the session: a loop stop, or a cap on a window that does not clear by itself. */
export function checkpointWorthy(reasonCode: string, action: string | null, reasons: readonly string[]): boolean {
  if (reasonCode === "forbidden") return action === "pause_with_checkpoint";
  if (reasonCode === "capacity") return true;
  if (reasonCode !== "cap_exceeded") return false;
  const denied = reasons.filter((r) => /^cap [^:]+: deny/.test(r));
  // Only caps that slide ("last 10 minutes", "last hour") leave it to time.
  return denied.length === 0 || !denied.every((r) => r.includes("(last "));
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "session";

const TEMPLATE_END = "<!-- the agent writes below this line -->";

export function handoffTemplate(c: { id: number; session: string; person: string; project: string | null; at: string; reason: string }): string {
  return [
    `# Paused: ${c.reason}`,
    "",
    `Checkpoint ${c.id} for session ${c.session}, opened ${c.at}. Person ${c.person}${c.project ? `, project ${c.project}` : ""}.`,
    "",
    "The Desk stopped this session because of the rule above. It allows nothing in this session now except writing this file.",
    "",
    "## Handoff",
    "",
    "Write below what is done, what is open, and the branch, so that someone can pick this up from here.",
    "",
    TEMPLATE_END,
    "",
    "## How this resumes",
    "",
    `The owner runs \`desk gate resume --session ${c.session}\`. If the cap still binds, the resume needs an extension: \`--extend-usd N --reason "..."\`.`,
    "",
  ].join("\n");
}

/** True when a tool call writes the handoff file and nothing else: the one thing an open checkpoint allows. */
export function isHandoffWrite(handoffPath: string, toolName: string, toolInput: unknown): boolean {
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") return false;
  if (typeof toolInput !== "object" || toolInput === null) return false;
  const p = (toolInput as Record<string, unknown>)["file_path"];
  if (typeof p !== "string" || p.length === 0) return false;
  const norm = (x: string): string => (process.platform === "win32" ? resolve(x).toLowerCase() : resolve(x));
  return norm(p) === norm(handoffPath);
}

/** What the agent wrote: the part of the handoff file after the marker, and a hash of it. Null text when the file is missing or still holds only the template. */
export function readHandoff(path: string): { written: boolean; text: string; sha256: string | null } {
  if (!existsSync(path)) return { written: false, text: "", sha256: null };
  const full = readFileSync(path, "utf8");
  const at = full.indexOf(TEMPLATE_END);
  const after = (at === -1 ? full : full.slice(at + TEMPLATE_END.length)).split("## How this resumes")[0] ?? "";
  const text = after.trim();
  return { written: text.length > 0, text, sha256: text.length === 0 ? null : createHash("sha256").update(text).digest("hex") };
}

export class CheckpointStore {
  private readonly db: DatabaseSync;
  readonly dir: string;

  constructor(db: DatabaseSync, dir: string) {
    this.db = db;
    this.dir = dir;
    db.exec(SCHEMA);
  }

  private rowOf(r: Record<string, unknown>): CheckpointRow {
    return {
      id: Number(r["id"]),
      session_id: String(r["session_id"]),
      person: String(r["person"]),
      project: r["project"] === null ? null : String(r["project"]),
      model: r["model"] === null ? null : String(r["model"]),
      created_at: String(r["created_at"]),
      reason_code: String(r["reason_code"]),
      reason: String(r["reason"]),
      matched: JSON.parse(String(r["matched"])) as string[],
      handoff_path: String(r["handoff_path"]),
      needed_micros: Number(r["needed_micros"]),
      status: r["status"] === "resumed" ? "resumed" : "open",
      resumed_at: r["resumed_at"] === null ? null : String(r["resumed_at"]),
      resumed_by: r["resumed_by"] === null ? null : String(r["resumed_by"]),
    };
  }

  open(session: string): CheckpointRow | undefined {
    const r = this.db.prepare("SELECT * FROM gate_checkpoint WHERE session_id = ? AND status = 'open'").get(session) as Record<string, unknown> | undefined;
    return r === undefined ? undefined : this.rowOf(r);
  }

  byId(id: number): CheckpointRow | undefined {
    const r = this.db.prepare("SELECT * FROM gate_checkpoint WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r === undefined ? undefined : this.rowOf(r);
  }

  list(status?: "open" | "resumed"): CheckpointRow[] {
    const rows = (status === undefined ? this.db.prepare("SELECT * FROM gate_checkpoint ORDER BY id DESC").all() : this.db.prepare("SELECT * FROM gate_checkpoint WHERE status = ? ORDER BY id DESC").all(status)) as Record<string, unknown>[];
    return rows.map((r) => this.rowOf(r));
  }

  /** Open a checkpoint for the session, write its handoff file, and return it. A session with a checkpoint already open gets that one back. */
  create(c: { session: string; person: string; project: string | null; model: string | null; at: string; reasonCode: string; reason: string; matched: readonly string[]; neededMicros: number }): CheckpointRow {
    const existing = this.open(c.session);
    if (existing !== undefined) return existing;
    mkdirSync(this.dir, { recursive: true });
    const next = (this.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM gate_checkpoint").get() as { n: number }).n;
    const path = join(resolve(this.dir), `checkpoint-${next}-${safe(c.session)}.md`);
    this.db
      .prepare("INSERT INTO gate_checkpoint (id, session_id, person, project, model, created_at, reason_code, reason, matched, handoff_path, needed_micros, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')")
      .run(next, c.session, c.person, c.project, c.model, c.at, c.reasonCode, c.reason, JSON.stringify(c.matched), path, Math.max(1, Math.round(c.neededMicros)));
    writeFileSync(path, handoffTemplate({ id: next, session: c.session, person: c.person, project: c.project, at: c.at, reason: c.reason }));
    return this.byId(next) as CheckpointRow;
  }

  markResumed(id: number, at: string, by: string): void {
    this.db.prepare("UPDATE gate_checkpoint SET status = 'resumed', resumed_at = ?, resumed_by = ? WHERE id = ? AND status = 'open'").run(at, by, id);
  }
}

/** What the agent is told when the session stops: finish the step, write the handoff there, stop. */
export function checkpointInstruction(c: CheckpointRow): string {
  return `Finish the current step, then write a short handoff (what is done, what is open, the branch) into ${c.handoff_path} and stop. The Desk allows nothing else in this session, other than writing that file, until the owner resumes it.`;
}
