import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

import { CREDENTIAL_SHAPES, createRedactor } from "../card/redact.ts";
import { TRUNCATION, textOf } from "../ingest/claude-code.ts";
import { canonicalJson } from "../../runtime/canonical.ts";
import { classifyTool, type ToolKind } from "./tools.ts";

/**
 * What an agent did in one session, rebuilt from the tool's own log (DF-040): the prompts, the tool calls in order with what each was given, and what came back. The log is the
 * only record there is for most of the owner's work, and it has gaps: a result the tool cut short, a stretch the tool summarised away, a subagent's own turns kept in another
 * file. A trajectory says what it has and what it lacks, and a replay is allowed only as far as it goes.
 *
 * Inputs are redacted before they are hashed, and paths under the session's own folder become `<cwd>`, so the same call made from a sandbox in another folder has the same key
 * and a recorded result can be found for it.
 */
export interface StepResult {
  present: boolean;
  /** The result as recorded, redacted and cut to a length a replay can serve; null when text was not asked for. */
  text: string | null;
  chars: number;
  /** The tool cut it short (its own marker), or the copy kept here was. A result that was cut short cannot stand in for the whole. */
  truncated: boolean;
  isError: boolean;
  /** The tool kept a large output in a file and put only a preview in the log; the whole of it was read back from that file. */
  recovered: boolean;
}

export interface Step {
  seq: number;
  ts: string;
  id: string;
  tool: string;
  kind: ToolKind;
  keySha: string;
  /** The input as given, redacted and normalised, as JSON text; null when text was not asked for. */
  input: string | null;
  result: StepResult;
}

export interface Trajectory {
  sessionId: string;
  logSha: string;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  prompts: number;
  assistantMessages: number;
  compactions: number;
  /** Lines the log marks as a subagent's own, which are not followed. */
  sidechainLines: number;
  malformedLines: number;
  steps: Step[];
}

/** The longest result kept whole. A result past it is kept cut and marked cut, because a replay that served the cut text would be serving a different result. */
/**
 * What a key is made from: the call with the credential shapes masked, and nothing else. The full redaction a stored text gets also masks long random-looking words, which
 * includes a long path, so two different `rm -rf` lines naming two different long paths would both read `rm -rf (redacted)` and share a key, and a call that was never recorded
 * would be answered with the result of one that was. A key must tell calls apart; a credential must not be in it; the second is what this keeps, and the first is why it keeps no more.
 */
const KEY_SHAPES = CREDENTIAL_SHAPES.filter((r) => !r.source.includes("api[_-]?key"));
export function maskForKey(s: string): string {
  let out = s;
  for (const shape of KEY_SHAPES) {
    shape.lastIndex = 0;
    out = out.replace(shape, "(redacted)");
  }
  return out;
}

export const RESULT_CAP = 400_000;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A path under the session's folder, in either separator, becomes `<cwd>/...`. */
function folderPattern(cwd: string | null): RegExp | null {
  if (!cwd) return null;
  const forward = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (forward.length < 2) return null;
  const body = forward.split("/").map(escapeRe).join("[\\\\/]");
  return new RegExp(`${body}(?=[\\\\/]|$|["'\\s])`, "gi");
}

export function normalizeInput(value: unknown, cwd: string | null, clean: (s: string) => string): unknown {
  const re = folderPattern(cwd);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let s = v;
      if (re) {
        re.lastIndex = 0;
        if (re.test(s)) {
          re.lastIndex = 0;
          s = s.replace(re, "<cwd>").replace(/<cwd>([^\s"']*)/g, (_m, rest: string) => `<cwd>${rest.replace(/\\/g, "/")}`);
        }
      }
      return clean(s);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

export interface ReadOptions {
  keepText?: boolean;
  resultCap?: number;
  overrides?: ReadonlyMap<string, ToolKind>;
}

export function readTrajectory(path: string, o: ReadOptions = {}): Trajectory {
  const text = readFileSync(path, "utf8");
  const records: unknown[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return trajectoryFromRecords(records, sha(text), malformed, o);
}

/**
 * A trajectory from records in Claude Code's log shape: assistant messages whose content holds `tool_use` blocks, and user messages whose content holds the `tool_result`
 * blocks that answer them. The tool's own log is read this way, and so is a capture made at the gateway, after it has been put into this shape, so that the same call has the
 * same key whichever way it was recorded.
 */
export function trajectoryFromRecords(records: readonly unknown[], logSha: string, malformedLines: number, o: ReadOptions = {}): Trajectory {
  const cap = o.resultCap ?? RESULT_CAP;
  const clean = createRedactor().clean;
  const t: Trajectory = { sessionId: "", logSha, cwd: null, startedAt: null, endedAt: null, prompts: 0, assistantMessages: 0, compactions: 0, sidechainLines: 0, malformedLines, steps: [] };
  const byId = new Map<string, Step>();
  const results = new Map<string, { content: unknown; isError: boolean }>();
  for (const d of records) {
    if (!isObject(d)) continue;
    if (typeof d["sessionId"] === "string" && t.sessionId === "") t.sessionId = d["sessionId"];
    if (typeof d["cwd"] === "string" && t.cwd === null) t.cwd = d["cwd"];
    const ts = typeof d["timestamp"] === "string" ? d["timestamp"] : null;
    if (ts) {
      if (t.startedAt === null || ts < t.startedAt) t.startedAt = ts;
      if (t.endedAt === null || ts > t.endedAt) t.endedAt = ts;
    }
    if (d["type"] === "system" && d["subtype"] === "compact_boundary") {
      t.compactions += 1;
      continue;
    }
    if (d["isSidechain"] === true) {
      t.sidechainLines += 1;
      continue;
    }
    const message = d["message"];
    if (!isObject(message)) continue;
    const content = message["content"];
    if (d["type"] === "assistant" && Array.isArray(content)) {
      t.assistantMessages += 1;
      for (const b of content) {
        if (!isObject(b) || b["type"] !== "tool_use" || typeof b["id"] !== "string" || typeof b["name"] !== "string") continue;
        if (byId.has(b["id"])) continue;
        const kind = classifyTool(b["name"], b["input"], o.overrides);
        const keyed = normalizeInput(b["input"] ?? {}, t.cwd, maskForKey);
        const shown = o.keepText ? normalizeInput(b["input"] ?? {}, t.cwd, clean) : null;
        const step: Step = {
          seq: t.steps.length,
          ts: ts ?? "",
          id: b["id"],
          tool: b["name"],
          kind,
          keySha: sha(`${b["name"]}\0${canonicalJson(keyed)}`).slice(0, 16),
          input: shown === null ? null : JSON.stringify(shown).slice(0, 8000),
          result: { present: false, text: null, chars: 0, truncated: false, isError: false, recovered: false },
        };
        byId.set(step.id, step);
        t.steps.push(step);
      }
    } else if (d["type"] === "user") {
      if (Array.isArray(content) && content.some((b) => isObject(b) && b["type"] === "tool_result")) {
        for (const b of content) {
          if (isObject(b) && b["type"] === "tool_result" && typeof b["tool_use_id"] === "string") results.set(b["tool_use_id"], { content: b["content"], isError: b["is_error"] === true });
        }
      } else if (d["isMeta"] !== true) {
        const words = typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (isObject(b) && b["type"] === "text" && typeof b["text"] === "string" ? b["text"] : "")).join("") : "";
        if (words.trim() !== "") t.prompts += 1;
      }
    }
  }
  for (const step of t.steps) {
    const r = results.get(step.id);
    if (!r) continue;
    let full = textOf(r.content);
    let recovered = false;
    // A large output is kept by the tool in a file of its own, and the log holds a preview and where the file is. When the file is still there the whole result is known.
    if (full.includes("<persisted-output>")) {
      const where = /Full output saved to:\s*([^\r\n]+)/i.exec(full);
      const file = where ? (where[1] as string).trim() : "";
      try {
        if (file !== "" && existsSync(file) && statSync(file).size <= cap * 2) {
          full = readFileSync(file, "utf8");
          recovered = true;
        }
      } catch {
        /* the file could not be read: the preview is all there is */
      }
    }
    const ends = full.length <= 4_000 ? full : `${full.slice(0, 2_000)}\n${full.slice(-2_000)}`;
    const cut = full.length > cap;
    step.result = {
      present: true,
      text: o.keepText ? clean(cut ? full.slice(0, cap) : full) : null,
      chars: full.length,
      // What was read back from the file is the whole output; the words in it that look like a cut-short marker are the output's own.
      truncated: (!recovered && TRUNCATION.test(ends)) || cut,
      isError: r.isError,
      recovered,
    };
  }
  return t;
}
