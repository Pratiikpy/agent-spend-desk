import type { AutopsyCall } from "../autopsy/engine.ts";
import { CONFIG } from "../autopsy/engine.ts";
import type { CallFacts } from "./detect.ts";

/**
 * C-BLOAT, context bloat across compactions (DF-096). A compaction is the moment an agent summarised its conversation to make room; the log records
 * it with the tokens the context held before and after. Everything between two compactions is a phase. A phase that built up more than
 * `churnTokens` of context which the next compaction then threw away, and in which nothing landed, was context paid for and discarded. "Nothing
 * landed" has to be known: where the session's folder is not a repository the ledger scanned, the outcome is unknown and the phase is counted, never billed. Within the three
 * calls after a compaction, a file read again that the phase had already read is dropped context fetched back.
 *
 * The dollars are the least these tokens cost: the price of writing them into the cache once, taken from what the phase's own calls were charged.
 * They are not the cost of every call that carried them, and they overlap the cost of the calls in the other classes, so they are never added to them.
 */
export const BLOAT_PARAMS = { churnTokens: 50_000, rereadWithinCalls: 3 } as const;

export interface CompactionRecord {
  sessionId: string;
  /** The log file the compaction was read from, the same key as the calls of that thread. */
  threadKey: string;
  tsMs: number;
  trigger: string;
  preTokens: number;
  postTokens: number | null;
}

/**
 * What is known of the work a phase landed. `landed`: a commit tied to the session was authored inside it. `possible`: the session's repository has a
 * commit inside the phase that is not tied to this session, so the work may have landed. `none`: the session ran in a repository the ledger scanned and
 * that repository has no commit inside the phase. `unknown`: the session's folder is not inside a scanned repository, so nothing can be said.
 */
export type Landing = "landed" | "possible" | "none" | "unknown";

export interface Reread {
  inputHash: string;
  /** Characters of the result, when the ledger holds the result of the re-read. */
  chars: number | null;
}

export interface CompactionPhase {
  sessionId: string;
  threadKey: string;
  /** Position of the compaction that ends this phase among the thread's compactions, from 0. */
  index: number;
  startMs: number;
  endMs: number;
  trigger: string;
  calls: number;
  preTokens: number;
  /** The size after, from the log's record or, when the log does not say, from the first call after it; null when neither is known. */
  postTokens: number | null;
  postSource: "log" | "next_call" | "unknown";
  /** Tokens the compaction threw away: the size before minus the size after. */
  churnTokens: number;
  rereads: Reread[];
  /** Tokens the re-reads fetched back, estimated from characters at the stated rate; 0 when none. */
  rereadTokens: number;
  landing: Landing;
  /** Over the churn threshold and known to have landed nothing: the phase the rule bills. */
  flagged: boolean;
  /** The least the discarded and re-fetched tokens cost, in micro-dollars; null when no call of the phase was priced for cache writes. */
  wasteMicros: number | null;
}

const contextOf = (c: AutopsyCall): number => c.tokens.input + c.tokens.read + c.tokens.write5m + c.tokens.write1h;

/** The price the phase's own calls were charged for writing one token to the cache, in micro-dollars; null when none of them wrote one at a known price. */
function writePrice(calls: readonly AutopsyCall[]): number | null {
  let micros = 0;
  let tokens = 0;
  for (const c of calls) {
    if (c.micros === null) continue;
    const w = c.tokens.write5m + c.tokens.write1h;
    if (w === 0) continue;
    micros += c.micros.write5m + c.micros.write1h;
    tokens += w;
  }
  return tokens === 0 ? null : micros / tokens;
}

/**
 * The phases of every thread that has a recorded compaction, in time order. `landing` says what is known of the work between two times. A thread
 * with no compaction has no phase: a long session that never compacted is not bloat by this rule.
 */
export function compactionPhases(
  calls: readonly AutopsyCall[],
  compactions: readonly CompactionRecord[],
  facts: ReadonlyMap<string, CallFacts>,
  landing: (sessionId: string, fromMs: number, toMs: number) => Landing,
): CompactionPhase[] {
  const threads = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = threads.get(c.threadKey);
    if (list) list.push(c);
    else threads.set(c.threadKey, [c]);
  }
  const byThread = new Map<string, CompactionRecord[]>();
  for (const k of compactions) {
    const list = byThread.get(k.threadKey);
    if (list) list.push(k);
    else byThread.set(k.threadKey, [k]);
  }
  const out: CompactionPhase[] = [];
  for (const [key, records] of byThread) {
    const thread = (threads.get(key) ?? []).sort((a, b) => a.tsMs - b.tsMs || a.callId.localeCompare(b.callId));
    if (thread.length === 0) continue;
    const sorted = [...records].sort((a, b) => a.tsMs - b.tsMs);
    let from = thread[0]!.tsMs;
    sorted.forEach((k, index) => {
      const inPhase = thread.filter((c) => c.tsMs >= from && c.tsMs <= k.tsMs);
      const after = thread.filter((c) => c.tsMs > k.tsMs);
      const firstAfter = after[0];
      let postTokens = k.postTokens;
      let postSource: CompactionPhase["postSource"] = "log";
      if (postTokens === null) {
        postTokens = firstAfter ? contextOf(firstAfter) : null;
        postSource = firstAfter ? "next_call" : "unknown";
      }
      const churn = postTokens === null ? 0 : Math.max(0, k.preTokens - postTokens);
      const readBefore = new Set<string>();
      for (const c of inPhase) for (const t of c.tools) if (t.name === "Read") readBefore.add(t.inputHash);
      const rereads: Reread[] = [];
      for (const c of after.slice(0, BLOAT_PARAMS.rereadWithinCalls)) {
        for (const t of c.tools) {
          if (t.name !== "Read" || !readBefore.has(t.inputHash)) continue;
          const results = (facts.get(c.callId)?.results ?? []).filter((r) => r.name === t.name && r.inputHash === t.inputHash && r.chars !== undefined);
          rereads.push({ inputHash: t.inputHash, chars: results.length === 0 ? null : results.reduce((s, r) => s + (r.chars ?? 0), 0) });
        }
      }
      const rereadTokens = Math.ceil(rereads.reduce((s, r) => s + (r.chars ?? 0), 0) / CONFIG.charsPerToken);
      const known = landing(k.sessionId, from, k.tsMs);
      const flagged = churn > BLOAT_PARAMS.churnTokens && known === "none";
      const price = writePrice(inPhase);
      out.push({
        sessionId: k.sessionId,
        threadKey: key,
        index,
        startMs: from,
        endMs: k.tsMs,
        trigger: k.trigger,
        calls: inPhase.length,
        preTokens: k.preTokens,
        postTokens,
        postSource,
        churnTokens: churn,
        rereads,
        rereadTokens,
        landing: known,
        flagged,
        wasteMicros: flagged && price !== null ? Math.round((churn + rereadTokens) * price) : null,
      });
      from = k.tsMs + 1;
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
