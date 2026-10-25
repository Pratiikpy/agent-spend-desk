import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { createRedactor } from "../card/redact.ts";
import { stripWrappers } from "../lang/script.ts";
import type { Ledger } from "../ledger/db.ts";
import { scanInjection, type InjectionKind } from "../security/injection.ts";

/**
 * The words a person gave an agent, read again from the log that holds them (DF-036). The ledger keeps only that a prompt was sent and how long it was; the text is in the
 * tool's own log on the owner's machine, and a captured task needs it. It is read once, redacted, and what is kept is the redacted text and a hash of what was read.
 */
export interface SessionPrompt {
  uuid: string;
  ts: string;
  text: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The human prompts of a Claude Code log, in order: a user message in the main conversation that is not a tool result and not synthetic. */
export function readHumanPrompts(logPath: string): SessionPrompt[] {
  const out: SessionPrompt[] = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (!line.trim() || !line.includes('"user"')) continue;
    let d: unknown;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(d) || d["type"] !== "user" || d["isSidechain"] === true || d["isMeta"] === true) continue;
    const message = d["message"];
    if (!isObject(message)) continue;
    const content = message["content"];
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      if (content.some((b) => isObject(b) && b["type"] === "tool_result")) continue;
      text = content.flatMap((b) => (isObject(b) && b["type"] === "text" && typeof b["text"] === "string" ? [b["text"] as string] : [])).join("\n");
    }
    const uuid = typeof d["uuid"] === "string" ? d["uuid"] : null;
    const ts = typeof d["timestamp"] === "string" ? d["timestamp"] : null;
    if (!uuid || !ts || text.trim() === "") continue;
    out.push({ uuid, ts, text });
  }
  return out;
}

/** The log of a session, found by the name Claude Code gives it: `<session id>.jsonl`, in the places the ledger read logs from. */
export function findSessionLog(db: Ledger, sessionId: string): string | null {
  if (!/^[\w-]{8,64}$/.test(sessionId)) return null;
  const rows = db.prepare("SELECT path FROM ingest_source WHERE kind = 'claude_code'").all() as { path: string }[];
  const want = `${sessionId}.jsonl`;
  for (const r of rows) {
    const p = r.path.replace(/\\/g, "/");
    if (p.endsWith(`/${want}`) && !p.includes("/subagents/") && existsSync(r.path)) return r.path;
  }
  // A folder the ledger read, in case the log was moved into it after.
  for (const r of rows) {
    const dir = r.path.replace(/[\\/][^\\/]*$/, "");
    try {
      if (readdirSync(dir).includes(want) && statSync(join(dir, want)).isFile()) return join(dir, want);
    } catch {
      /* the folder is gone */
    }
  }
  return null;
}

export const MAX_PROMPT_CHARS = 4000;

export interface RedactedPrompt {
  text: string;
  /** The hash of the prompt as it was read, before redaction, so that two readings of the same words are the same task. */
  sha: string;
  injection: InjectionKind[];
  truncated: boolean;
}

/**
 * Redact a prompt for storage: wrapper blocks the tool adds are removed, credentials, high-entropy tokens and home paths are masked, and the text is cut to a length a task can
 * carry. Instruction-like text is found in the redacted prompt and named, never removed, so that the person reviewing the task sees what the prompt said.
 */
export function redactPrompt(raw: string, sha256: (s: string) => string, home?: string): RedactedPrompt {
  const stripped = stripWrappers(raw).trim();
  const cleaned = (home === undefined ? createRedactor() : createRedactor(home)).clean(stripped);
  const truncated = cleaned.length > MAX_PROMPT_CHARS;
  const text = truncated ? cleaned.slice(0, MAX_PROMPT_CHARS) : cleaned;
  return { text, sha: sha256(stripped), injection: scanInjection(text).map((f) => f.kind), truncated };
}
