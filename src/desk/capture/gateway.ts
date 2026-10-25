import { createHash } from "node:crypto";

import type { CaptureDb } from "./store.ts";
import { persistTrajectory } from "../trajectory/account.ts";
import { replayability } from "../trajectory/replayability.ts";
import { trajectoryFromRecords, type Trajectory } from "../trajectory/read.ts";

/**
 * Trajectories captured at the gateway (DF-040). A request to a chat endpoint carries the whole conversation so far, tool calls and their results included, so the last request
 * of a session holds everything the session did up to it. Each captured request is put into the shape of Claude Code's own log and read by the same code that reads that log, so
 * a call has the same key whichever way it was recorded and a replay can use either. A capture holds the redacted text only if asked, like the log reader, and the result of
 * the last call in a session is not there until the next request arrives, so the last call stays without a result and says so.
 */
export type Family = "openai" | "anthropic" | "responses";

export interface GatewayCapture {
  ts: string;
  family: Family;
  /** The caller's session, from the gateway's identity for the run. */
  session: string;
  model: string;
  request: unknown;
  /** The reply, when it came back whole. A stream is not reassembled; the next request holds the same turn. */
  response: unknown | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const parseArgs = (v: unknown): unknown => {
  if (typeof v !== "string") return v ?? {};
  try {
    return JSON.parse(v);
  } catch {
    return { arguments: v };
  }
};

const contentText = (c: unknown): string => {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (isObject(b) ? str(b["text"]) || str(b["content"]) : "")).join("");
  return "";
};

interface Rec {
  type: "user" | "assistant";
  sessionId: string;
  timestamp: string;
  message: { content: unknown };
}

/** The conversation in a request, and the reply to it, as records in Claude Code's log shape. */
export function recordsOf(c: GatewayCapture): Rec[] {
  const out: Rec[] = [];
  const base = { sessionId: c.session, timestamp: c.ts };
  const push = (type: Rec["type"], content: unknown): void => {
    out.push({ type, ...base, message: { content } });
  };
  const req = isObject(c.request) ? c.request : {};
  const res = isObject(c.response) ? c.response : null;

  if (c.family === "anthropic") {
    for (const m of Array.isArray(req["messages"]) ? req["messages"] : []) if (isObject(m)) push(m["role"] === "assistant" ? "assistant" : "user", m["content"]);
    if (res && Array.isArray(res["content"])) push("assistant", res["content"]);
    return out;
  }

  if (c.family === "openai") {
    for (const m of Array.isArray(req["messages"]) ? req["messages"] : []) {
      if (!isObject(m)) continue;
      if (m["role"] === "tool") push("user", [{ type: "tool_result", tool_use_id: str(m["tool_call_id"]), content: contentText(m["content"]) }]);
      else if (m["role"] === "assistant") assistantOpenAi(m, push);
      else if (m["role"] === "user") push("user", contentText(m["content"]));
    }
    const choice = res && Array.isArray(res["choices"]) && isObject(res["choices"][0]) ? (res["choices"][0] as Record<string, unknown>) : null;
    if (choice && isObject(choice["message"])) assistantOpenAi(choice["message"], push);
    return out;
  }

  // The Responses API: the input is a string or a list of items; the reply lists output items of the same kinds.
  const items = typeof req["input"] === "string" ? [{ type: "message", role: "user", content: req["input"] }] : Array.isArray(req["input"]) ? req["input"] : [];
  const addItem = (it: unknown): void => {
    if (!isObject(it)) return;
    if (it["type"] === "function_call") push("assistant", [{ type: "tool_use", id: str(it["call_id"]) || str(it["id"]), name: str(it["name"]), input: parseArgs(it["arguments"]) }]);
    else if (it["type"] === "function_call_output") push("user", [{ type: "tool_result", tool_use_id: str(it["call_id"]), content: contentText(it["output"]) }]);
    else if (it["type"] === "message" || it["role"] !== undefined) push(it["role"] === "assistant" ? "assistant" : "user", contentText(it["content"]));
  };
  for (const it of items) addItem(it);
  if (res && Array.isArray(res["output"])) for (const it of res["output"]) addItem(it);
  return out;
}

function assistantOpenAi(m: Record<string, unknown>, push: (type: Rec["type"], content: unknown) => void): void {
  const blocks: unknown[] = [];
  const text = contentText(m["content"]);
  if (text !== "") blocks.push({ type: "text", text });
  for (const call of Array.isArray(m["tool_calls"]) ? m["tool_calls"] : []) {
    if (!isObject(call)) continue;
    const fn = isObject(call["function"]) ? call["function"] : {};
    blocks.push({ type: "tool_use", id: str(call["id"]), name: str(fn["name"]), input: parseArgs(fn["arguments"]) });
  }
  push("assistant", blocks);
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The trajectory a capture makes. The capture's own text is hashed as the log is, so a changed conversation has a different hash. */
export function trajectoryOf(c: GatewayCapture, o: { keepText?: boolean } = {}): Trajectory {
  const records = recordsOf(c);
  const t = trajectoryFromRecords(records, sha(JSON.stringify(records)), 0, o);
  t.sessionId = c.session;
  return t;
}

/**
 * Keep what a capture shows. The trajectory of a session is replaced by the latest capture of it, which holds the earlier ones. Returns the trajectory id, or null when the
 * conversation holds no tool call (there is nothing to keep).
 */
export function saveCapture(store: CaptureDb, c: GatewayCapture, o: { keep: boolean; now?: () => Date }): string | null {
  const t = trajectoryOf(c, { keepText: o.keep });
  if (t.steps.length === 0) return null;
  const r = replayability(t);
  return persistTrajectory(store, t, r, o.keep && r.eligible, (o.now ?? (() => new Date()))().toISOString(), "gateway");
}
