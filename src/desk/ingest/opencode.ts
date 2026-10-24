import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * OpenCode (https://github.com/anomalyco/opencode, MIT) keeps its sessions in one SQLite database, by default under
 * `~/.local/share/opencode/opencode.db`. A finished assistant message holds the provider, the model, the time and
 * the token counts of one model call, so one such message is one call here. The shape below was read from a real
 * 1.15.6 database on 2026-10-24 (74 assistant messages, 63 step-finish parts); NOT VERIFIED against other versions.
 *
 * The reader opens the file read-only and names its tables: `session`, `message` and `part`. The database also holds
 * account and credential tables, which this module never reads. Message text and tool inputs and outputs are parsed
 * in memory only to find tool names and token totals, and are not kept.
 */
export type ReasoningCheck = "confirmed" | "contradicted" | "unchecked";

export interface OpenCodeCall {
  callId: string;
  sessionId: string;
  ts: string;
  model: string;
  inputTokens: number;
  /** Output tokens as the ledger counts them: reasoning included, as in Claude Code's logs. */
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  isSidechain: boolean;
  isApiError: boolean;
  stopReason: string | null;
  toolNames: string[];
  /** What OpenCode itself recorded as the call's cost, in dollars. Kept for comparison; not used as our estimate. */
  reportedCost: number;
  /** Whether the message's own step totals show reasoning tokens as separate from output tokens. */
  reasoningInOutput: ReasoningCheck;
}

export interface OpenCodeSession {
  sessionId: string;
  directory: string | null;
  version: string | null;
}

export interface OpenCodeRead {
  /** Messages looked at, of every kind. */
  messages: number;
  sessions: OpenCodeSession[];
  calls: OpenCodeCall[];
  skipped: Record<string, number>;
}

/** Providers whose model names are Anthropic's own, so a first-party list price applies to them. Any other provider's calls are unpriced. */
const FIRST_PARTY = new Set(["anthropic"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

export type ParsedMessage = { call: OpenCodeCall } | { skip: string };

/**
 * One row of the `message` table. `stepTotal` is the sum of the `total` of the message's step-finish parts when every
 * one has it, and null otherwise; it is used only to check whether reasoning tokens are counted apart from output.
 */
export function parseOpenCodeMessage(messageId: string, sessionId: string, isSidechain: boolean, raw: string, toolNames: readonly string[], stepTotal: number | null): ParsedMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { skip: "malformed" };
  }
  if (!isObject(data)) return { skip: "malformed" };
  if (data["role"] !== "assistant") return { skip: "not-assistant" };
  const time = isObject(data["time"]) ? data["time"] : {};
  if (time["completed"] === undefined || time["completed"] === null) return { skip: "unfinished" };
  const created = time["created"];
  if (typeof created !== "number" || !Number.isFinite(created) || Number.isNaN(new Date(created).getTime())) return { skip: "bad-time" };
  const tokens = data["tokens"];
  if (!isObject(tokens)) return { skip: "no-tokens" };
  const cache = isObject(tokens["cache"]) ? tokens["cache"] : {};
  const input = count(tokens["input"]);
  const output = count(tokens["output"]);
  const reasoning = count(tokens["reasoning"] ?? 0);
  const read = count(cache["read"] ?? 0);
  const write = count(cache["write"] ?? 0);
  if (input === null || output === null || reasoning === null || read === null || write === null) return { skip: "bad-tokens" };
  const model = typeof data["modelID"] === "string" ? data["modelID"] : "";
  const provider = typeof data["providerID"] === "string" ? data["providerID"] : "";
  if (model === "") return { skip: "no-model" };

  let check: ReasoningCheck = "unchecked";
  if (stepTotal !== null && reasoning > 0) {
    if (stepTotal === input + output + reasoning + read + write) check = "confirmed";
    else if (stepTotal === input + output + read + write) check = "contradicted";
  }
  const cost = typeof data["cost"] === "number" && Number.isFinite(data["cost"]) && data["cost"] >= 0 ? data["cost"] : 0;
  return {
    call: {
      callId: `opencode:${messageId}`,
      sessionId: `opencode:${sessionId}`,
      ts: new Date(created).toISOString(),
      model: FIRST_PARTY.has(provider) || provider === "" ? model : `${provider}/${model}`,
      inputTokens: input,
      outputTokens: check === "contradicted" ? output : output + reasoning,
      reasoningTokens: reasoning,
      cacheReadTokens: read,
      cacheWriteTokens: write,
      isSidechain,
      isApiError: data["error"] !== undefined && data["error"] !== null,
      stopReason: typeof data["finish"] === "string" ? data["finish"] : null,
      toolNames: [...toolNames],
      reportedCost: cost,
      reasoningInOutput: check,
    },
  };
}

function open(path: string): DatabaseSync {
  if (!existsSync(path)) throw new Error(`OpenCode database not found: ${path}`);
  return new DatabaseSync(path, { readOnly: true });
}

/**
 * Read the finished calls from an OpenCode database. `known` holds the call ids already in the ledger: their parts are
 * not read again. A call that was still running when the database was last read is picked up by a later read.
 */
export function readOpenCode(path: string, known: ReadonlySet<string>): OpenCodeRead {
  const db = open(path);
  try {
    let sessionRows: { id: string; parent_id: string | null; directory: string | null; version: string | null }[];
    try {
      sessionRows = db.prepare("SELECT id, parent_id, directory, version FROM session").all() as typeof sessionRows;
      db.prepare("SELECT 1 FROM message LIMIT 1").get();
      db.prepare("SELECT 1 FROM part LIMIT 1").get();
    } catch (error) {
      throw new Error(`${path} is not an OpenCode database: ${(error as Error).message}`);
    }
    const parents = new Map<string, string | null>(sessionRows.map((s) => [s.id, s.parent_id]));
    const sessions = new Map<string, OpenCodeSession>(sessionRows.map((s) => [s.id, { sessionId: `opencode:${s.id}`, directory: s.directory, version: s.version }]));
    const parts = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id");
    const out: OpenCodeRead = { messages: 0, sessions: [], calls: [], skipped: {} };
    const used = new Set<string>();
    for (const row of db.prepare("SELECT id, session_id, data FROM message ORDER BY time_created, id").iterate() as Iterable<{ id: string; session_id: string; data: string }>) {
      out.messages += 1;
      if (known.has(`opencode:${row.id}`)) continue;
      // Only a finished assistant message needs its parts looked at; the cheap checks come first.
      const quick = parseOpenCodeMessage(row.id, row.session_id, false, row.data, [], null);
      if ("skip" in quick) {
        out.skipped[quick.skip] = (out.skipped[quick.skip] ?? 0) + 1;
        continue;
      }
      const toolNames: string[] = [];
      let total = 0;
      let allTotals = true;
      let steps = 0;
      for (const p of parts.iterate(row.id) as Iterable<{ data: string }>) {
        let part: unknown;
        try {
          part = JSON.parse(p.data);
        } catch {
          continue;
        }
        if (!isObject(part)) continue;
        if (part["type"] === "tool" && typeof part["tool"] === "string") toolNames.push(part["tool"]);
        if (part["type"] === "step-finish") {
          steps += 1;
          const t = isObject(part["tokens"]) ? part["tokens"]["total"] : undefined;
          if (typeof t === "number" && Number.isFinite(t)) total += t;
          else allTotals = false;
        }
      }
      const isSidechain = (parents.get(row.session_id) ?? null) !== null;
      const parsed = parseOpenCodeMessage(row.id, row.session_id, isSidechain, row.data, toolNames, steps > 0 && allTotals ? total : null);
      if ("skip" in parsed) {
        out.skipped[parsed.skip] = (out.skipped[parsed.skip] ?? 0) + 1;
        continue;
      }
      out.calls.push(parsed.call);
      used.add(row.session_id);
    }
    out.sessions = [...used].map((id) => sessions.get(id)).filter((s): s is OpenCodeSession => s !== undefined);
    return out;
  } finally {
    db.close();
  }
}
