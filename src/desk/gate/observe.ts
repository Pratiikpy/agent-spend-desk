import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import { priceCall } from "../cost/price-call.ts";
import { parseClaudeCodeLine } from "../ingest/claude-code.ts";
import type { Micros } from "../money.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { GateError } from "./types.ts";

export interface ObservedCall {
  callId: string;
  ts: string;
  model: string;
  /** Null when the model has no price: the tokens were seen and the money is not invented. */
  micros: Micros | null;
}

export interface TranscriptDelta {
  calls: ObservedCall[];
  newOffset: number;
  lastModel: string | null;
  malformedLines: number;
}

const MAX_READ_BYTES = 8 * 1024 * 1024;

const norm = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * A transcript path from a hook is input from outside the gate. The gate reads only a `.jsonl` file whose
 * real path lies inside one of the configured roots, so a request cannot make it read any other file.
 */
export function resolveTranscript(path: string, roots: readonly string[]): string {
  if (!path.toLowerCase().endsWith(".jsonl")) throw new GateError("E_TRANSCRIPT_PATH", "transcript path must end in .jsonl", 400);
  let real: string;
  try {
    real = realpathSync(resolve(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new GateError("E_TRANSCRIPT_MISSING", "transcript file does not exist yet", 404);
    throw new GateError("E_TRANSCRIPT_PATH", "transcript path cannot be resolved", 400);
  }
  const ok = roots.some((root) => {
    let r: string;
    try {
      r = realpathSync(resolve(root));
    } catch {
      return false;
    }
    return norm(real) === norm(r) || norm(real).startsWith(norm(r.endsWith(sep) ? r : r + sep));
  });
  if (!ok) throw new GateError("E_TRANSCRIPT_PATH", "transcript path is outside the configured transcript roots", 403);
  return real;
}

/**
 * Read the bytes appended to a Claude Code session log since `offset` and price the model calls in them.
 * One API call is written as several lines with the same message id and identical usage; the call is keyed
 * by that id and counted once (the same rule as the ledger ingest, spec 5.2). Only whole lines are consumed,
 * so a line still being written is read next time. Message text is parsed for counts and discarded.
 */
export function readTranscriptDelta(realPath: string, offset: number, snapshot: PriceSnapshot): TranscriptDelta {
  const fd = openSync(realPath, "r");
  try {
    const size = fstatSync(fd).size;
    const start = offset > size ? 0 : offset;
    const want = Math.min(size - start, MAX_READ_BYTES);
    const buf = Buffer.alloc(want);
    let read = 0;
    while (read < want) {
      const n = readSync(fd, buf, read, want - read, start + read);
      if (n === 0) break;
      read += n;
    }
    const lastNl = buf.subarray(0, read).lastIndexOf(0x0a);
    if (lastNl === -1) return { calls: [], newOffset: start, lastModel: null, malformedLines: 0 };
    const text = buf.subarray(0, lastNl).toString("utf8");
    const seen = new Map<string, ObservedCall>();
    let lastModel: string | null = null;
    let malformed = 0;
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      const out = parseClaudeCodeLine(line);
      if (out.kind === "malformed") malformed += 1;
      if (out.kind !== "call") continue;
      const c = out.call;
      if (c.isApiError || seen.has(c.callId)) continue;
      const price = priceCall(snapshot, {
        model: c.model,
        tokens: { inputTokens: c.inputTokens, outputTokens: c.outputTokens, cacheReadTokens: c.cacheReadTokens, cacheWrite5mTokens: c.cacheWrite5mTokens, cacheWrite1hTokens: c.cacheWrite1hTokens },
        speed: c.speed,
        inferenceGeo: c.inferenceGeo,
      });
      const micros = price.kind === "priced" ? price.totalMicros : null;
      seen.set(c.callId, { callId: c.callId, ts: c.ts, model: c.model, micros });
      lastModel = c.model;
    }
    return { calls: [...seen.values()], newOffset: start + lastNl + 1, lastModel, malformedLines: malformed };
  } finally {
    closeSync(fd);
  }
}
