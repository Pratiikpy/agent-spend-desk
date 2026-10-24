import { createReadStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

import { createRedactor } from "../card/redact.ts";

/**
 * The log lines behind a block, as short redacted excerpts (DF-005). The ledger keeps no message text, so the lines are read again
 * from the agent's own log file when someone asks to see them, on this machine, and each excerpt is masked for credentials, paths
 * and high-entropy strings and cut short. A line that cannot be found is said to be missing, never filled in.
 */
export interface Excerpt {
  /** The model call this line belongs to (for a tool result, the call that asked for it). */
  callId: string;
  role: "assistant_text" | "tool_use" | "tool_result";
  tool: string | null;
  isError: boolean | null;
  text: string;
}

export interface Excerpts {
  excerpts: Excerpt[];
  /** Calls with no assistant line found in the file, and tool uses with no result line found. */
  missingCalls: string[];
  missingResults: string[];
  /** Why nothing could be read, when nothing could. */
  unreadable: string | null;
}

const MAX_BYTES = 1_000_000_000;
const MAX_TEXT = 240;

const cut = (s: string): string => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 3)}...` : s);

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function summariseInput(name: string, input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const o = input as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
  const text = (name === "Bash" ? pick("command") : null) ?? pick("file_path") ?? pick("pattern") ?? pick("path") ?? pick("url") ?? pick("description") ?? pick("prompt") ?? JSON.stringify(o);
  return oneLine(text);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === "object" && b !== null && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join(" ");
  return "";
}

/** Read the excerpts for the given calls (by the message id each call is logged under) and the results of the given tool uses. */
export async function readExcerpts(path: string | null, callIds: readonly string[], toolUses: ReadonlyMap<string, string>): Promise<Excerpts> {
  const none = (why: string): Excerpts => ({ excerpts: [], missingCalls: [...callIds], missingResults: [...toolUses.keys()], unreadable: why });
  if (path === null || !path.endsWith(".jsonl")) return none("The ledger does not say which log file these calls came from.");
  if (!existsSync(path)) return none("The log file is no longer where it was read from (moved or deleted), so its lines cannot be shown.");
  if (statSync(path).size > MAX_BYTES) return none("The log file is too large to scan.");
  const redact = createRedactor().clean;
  const wantCalls = new Set(callIds);
  const wantResults = new Map(toolUses); // tool_use_id -> call id
  const foundCalls = new Set<string>();
  const foundResults = new Set<string>();
  const out: Excerpt[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  const targets = [...wantCalls, ...wantResults.keys()];
  for await (const line of rl) {
    if (line.length === 0 || !targets.some((t) => line.includes(t))) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = (o as { message?: { id?: unknown; content?: unknown } }).message;
    if (typeof msg !== "object" || msg === null) continue;
    const content = Array.isArray(msg.content) ? (msg.content as unknown[]) : [];
    const id = typeof msg.id === "string" ? msg.id : null;
    // One message is logged as several lines, one per content block, all under the same id: every one of them is read.
    if (id !== null && wantCalls.has(id)) {
      foundCalls.add(id);
      for (const b of content) {
        if (typeof b !== "object" || b === null) continue;
        const block = b as { type?: string; text?: string; name?: string; input?: unknown };
        if (block.type === "tool_use" && typeof block.name === "string") out.push({ callId: id, role: "tool_use", tool: block.name, isError: null, text: cut(redact(summariseInput(block.name, block.input))) });
        else if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") out.push({ callId: id, role: "assistant_text", tool: null, isError: null, text: cut(redact(oneLine(block.text))) });
      }
    }
    for (const b of content) {
      if (typeof b !== "object" || b === null) continue;
      const block = b as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
      if (block.type === "tool_result" && typeof block.tool_use_id === "string" && wantResults.has(block.tool_use_id) && !foundResults.has(block.tool_use_id)) {
        foundResults.add(block.tool_use_id);
        out.push({ callId: wantResults.get(block.tool_use_id) as string, role: "tool_result", tool: null, isError: block.is_error === true, text: cut(redact(oneLine(resultText(block.content)))) });
      }
    }
  }
  rl.close();
  const order = new Map(callIds.map((c, i) => [c, i]));
  out.sort((a, b) => (order.get(a.callId) ?? 0) - (order.get(b.callId) ?? 0) || (a.role === b.role ? 0 : a.role === "tool_result" ? 1 : b.role === "tool_result" ? -1 : 0));
  return { excerpts: out, missingCalls: callIds.filter((c) => !foundCalls.has(c)), missingResults: [...wantResults.keys()].filter((t) => !foundResults.has(t)), unreadable: null };
}
