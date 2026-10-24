import type { AutopsyCall, PerCall } from "../autopsy/engine.ts";
import { callCostMicros } from "../replay/from-ledger.ts";

/**
 * Waste classes beyond the loops and idle time the autopsy finds (DF-033, DF-092, DF-100), each a rule over what the ledger holds, with its
 * parameters stated and a stop point: the dollars from the call at which the rule would have acted to the end of the run it flags. No
 * rule uses wall time alone, and none can prove that a stopped run would have been useless, so the saving is an upper bound. The thresholds
 * are those of the architecture spec (section 7.4); where the rule here goes further or reads less, it says so.
 *
 *  C-LOOP-2   error echo: the same tool returning the same error a third time with no success of that tool between
 *  C-TRUNC    a tool said it cut its output short and the same tool use was then repeated within three calls
 *  C-CHURN    the fourth edit of one file with no call that could run a check between the edits (a heuristic)
 *  C-UNREF    the third call in a row that used no tool, when the first two did not hand control back
 *  C-ORPHAN   a delegated agent still calling the model more than 30 minutes after its parent last did, with no prompt in between
 */
export type WasteClass = "C-LOOP-2" | "C-TRUNC" | "C-CHURN" | "C-UNREF" | "C-ORPHAN";

export const WASTE_PARAMS = {
  echoRepeats: 3,
  truncRepeatWithinCalls: 3,
  churnEdits: 4,
  unrefConsecutive: 3,
  orphanAfterMs: 30 * 60 * 1000,
} as const;

/** Tools that read, search or edit and so cannot run a check by themselves; every other tool (a shell, a delegated agent, an MCP tool) can. */
const CANNOT_CHECK = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "Edit", "Write", "MultiEdit", "NotebookEdit", "TodoWrite", "ToolSearch"]);

/** A stop reason that hands control back to the person or the harness: a call that ends with one cannot be the start of a self-driven run. */
const CONTINUING = new Set(["stop_sequence", "max_tokens", "pause_turn"]);

/** What the Desk adds to a call that the autopsy's own record does not carry. */
export interface CallFacts {
  /** The tool results of this call's tool uses: the name and input of the use, a hash of what it said (folded), and whether the tool said it cut its output short. */
  results: { name: string; inputHash: string; resultHash: string | null; truncated: boolean; isError: boolean }[];
  /** The files this call's tool uses edited. */
  editedPaths: string[];
}

export interface WasteEvent {
  rule: WasteClass;
  sessionId: string;
  threadKey: string;
  /** The calls the rule flags, from the stop point on. */
  calls: AutopsyCall[];
  /** The dollars of those calls. A call with no price counts as nothing and is counted apart. */
  micros: number;
  unpricedCalls: number;
  /** What the rule saw, in the rule's own terms, for the explanation. */
  observed: Record<string, string | number>;
  /** Low when the rule is a heuristic that can flag needed work (a file edited again and again may be a file being written well). */
  confidence: "high" | "low";
}

function make(rule: WasteClass, calls: AutopsyCall[], observed: WasteEvent["observed"], confidence: WasteEvent["confidence"]): WasteEvent {
  const first = calls[0] as AutopsyCall;
  return { rule, sessionId: first.sessionId, threadKey: first.threadKey, calls, micros: calls.reduce((s, c) => s + callCostMicros(c), 0), unpricedCalls: calls.filter((c) => c.micros === null).length, observed, confidence };
}

/** Group a sorted thread's flagged call indexes into runs of neighbours. */
function runs(thread: readonly AutopsyCall[], flagged: ReadonlySet<number>): AutopsyCall[][] {
  const out: AutopsyCall[][] = [];
  let run: AutopsyCall[] = [];
  for (let i = 0; i < thread.length; i += 1) {
    if (flagged.has(i)) run.push(thread[i] as AutopsyCall);
    else if (run.length > 0) {
      out.push(run);
      run = [];
    }
  }
  if (run.length > 0) out.push(run);
  return out;
}

const threadsOf = (calls: readonly AutopsyCall[]): AutopsyCall[][] => {
  const by = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = by.get(c.threadKey);
    if (list) list.push(c);
    else by.set(c.threadKey, [c]);
  }
  return [...by.values()].map((l) => l.sort((a, b) => a.tsMs - b.tsMs || a.callId.localeCompare(b.callId)));
};

/**
 * Every event the rules find, calls claimed once: a call the autopsy already counts as a loop or as idle time is not counted again, and a
 * call flagged by one rule is not flagged by a later one in the list above, so the classes can be added up.
 */
export function detectWaste(calls: readonly AutopsyCall[], analysis: ReadonlyMap<string, PerCall>, facts: ReadonlyMap<string, CallFacts>): WasteEvent[] {
  const events: WasteEvent[] = [];
  const claimed = new Set<string>();
  for (const [id, a] of analysis) if (a.wholeCall === "loops" || a.wholeCall === "idle") claimed.add(id);
  const claim = (list: AutopsyCall[]): AutopsyCall[] => {
    const own = list.filter((c) => !claimed.has(c.callId));
    for (const c of own) claimed.add(c.callId);
    return own;
  };
  const threads = threadsOf(calls);

  // C-LOOP-2: the same tool failing the same way. A run ends when that tool succeeds, or when you prompt.
  for (const thread of threads) {
    const count = new Map<string, number>();
    const flagged = new Set<number>();
    const tool = new Map<number, string>();
    thread.forEach((c, i) => {
      if (c.humanPromptBefore) count.clear();
      for (const r of facts.get(c.callId)?.results ?? []) {
        if (!r.isError) {
          for (const k of [...count.keys()]) if (k.startsWith(`${r.name}\u0000`)) count.delete(k);
        } else if (r.resultHash !== null) {
          const key = `${r.name}\u0000${r.resultHash}`;
          const n = (count.get(key) ?? 0) + 1;
          count.set(key, n);
          if (n >= WASTE_PARAMS.echoRepeats) {
            flagged.add(i);
            tool.set(i, r.name);
          }
        }
      }
    });
    for (const run of runs(thread, flagged)) {
      const own = claim(run);
      if (own.length > 0) events.push(make("C-LOOP-2", own, { failing_tool: tool.get(thread.indexOf(own[0] as AutopsyCall)) ?? "a tool", repeats_required: WASTE_PARAMS.echoRepeats }, "high"));
    }
  }

  // C-TRUNC: a result that says it was cut short, and the same tool use asked for again soon after.
  for (const thread of threads) {
    for (let i = 0; i < thread.length; i += 1) {
      const cut = (facts.get((thread[i] as AutopsyCall).callId)?.results ?? []).filter((x) => x.truncated);
      let done = false;
      for (const r of cut) {
        for (let j = i + 1; j <= Math.min(thread.length - 1, i + WASTE_PARAMS.truncRepeatWithinCalls) && !done; j += 1) {
          if ((thread[j] as AutopsyCall).tools.some((t) => t.name === r.name && t.inputHash === r.inputHash)) {
            const own = claim(thread.slice(i + 1, j + 1));
            if (own.length > 0) events.push(make("C-TRUNC", own, { truncated_tool: r.name, truncated_call: (thread[i] as AutopsyCall).callId, repeated_after_calls: j - i, repeat_within_calls: WASTE_PARAMS.truncRepeatWithinCalls }, "high"));
            done = true;
          }
        }
        if (done) break;
      }
    }
  }

  // C-CHURN: one file edited again and again with nothing run between the edits.
  for (const thread of threads) {
    const edits = new Map<string, number>();
    const flagged = new Set<number>();
    thread.forEach((c, i) => {
      if (c.humanPromptBefore || c.tools.some((t) => !CANNOT_CHECK.has(t.name))) edits.clear();
      for (const p of new Set(facts.get(c.callId)?.editedPaths ?? [])) {
        const n = (edits.get(p) ?? 0) + 1;
        edits.set(p, n);
        if (n >= WASTE_PARAMS.churnEdits) flagged.add(i);
      }
    });
    for (const run of runs(thread, flagged)) {
      const own = claim(run);
      if (own.length > 0) events.push(make("C-CHURN", own, { edits_required: WASTE_PARAMS.churnEdits }, "low"));
    }
  }

  // C-UNREF: calls that used no tool, where the calls before them did not hand control back.
  for (const thread of threads) {
    const flagged = new Set<number>();
    let chain = 0;
    let continues = false;
    thread.forEach((c, i) => {
      const bare = c.tools.length === 0;
      // A bare call answers something unless the call before it was bare and handed no control back: then it is the model carrying on alone.
      if (!bare) chain = 0;
      else if (continues && !c.humanPromptBefore) chain += 1;
      else chain = 1;
      if (chain >= WASTE_PARAMS.unrefConsecutive) flagged.add(i);
      continues = bare && c.stopReason !== undefined && c.stopReason !== null && CONTINUING.has(c.stopReason);
    });
    for (const run of runs(thread, flagged)) {
      const own = claim(run);
      if (own.length > 0) events.push(make("C-UNREF", own, { consecutive_required: WASTE_PARAMS.unrefConsecutive, calls_with_no_tool: own.length + WASTE_PARAMS.unrefConsecutive - 1 }, "high"));
    }
  }

  // C-ORPHAN: a delegated agent working on after the agent that started it has stopped.
  const bySession = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = bySession.get(c.sessionId);
    if (list) list.push(c);
    else bySession.set(c.sessionId, [c]);
  }
  for (const [sessionId, list] of bySession) {
    const main = list.filter((c) => !c.isSidechain);
    if (main.length === 0) continue;
    let lastMain = 0;
    for (const c of main) if (c.tsMs > lastMain) lastMain = c.tsMs;
    const prompts = list.filter((c) => c.humanPromptBefore).map((c) => c.tsMs);
    for (const thread of threads) {
      const head = thread[0];
      if (!head || head.sessionId !== sessionId || !head.isSidechain) continue;
      const late = thread.filter((c) => c.tsMs - lastMain > WASTE_PARAMS.orphanAfterMs && !prompts.some((p) => p > lastMain && p <= c.tsMs));
      const own = claim(late);
      if (own.length > 0) events.push(make("C-ORPHAN", own, { minutes_after_parent: Math.round(((own[0] as AutopsyCall).tsMs - lastMain) / 60_000), orphan_after_minutes: WASTE_PARAMS.orphanAfterMs / 60_000 }, "high"));
    }
  }
  return events.sort((a, b) => b.micros - a.micros || (a.calls[0] as AutopsyCall).tsMs - (b.calls[0] as AutopsyCall).tsMs);
}

/** A tool result marked as cut short, with nothing yet that confirms the cut cost anything: listed, never billed. */
export function potentialTruncations(calls: readonly AutopsyCall[], facts: ReadonlyMap<string, CallFacts>, confirmed: readonly WasteEvent[]): { callId: string; sessionId: string; tool: string }[] {
  const confirmedCalls = new Set(confirmed.filter((e) => e.rule === "C-TRUNC").map((e) => String(e.observed["truncated_call"])));
  const out: { callId: string; sessionId: string; tool: string }[] = [];
  for (const c of calls) {
    const cut = (facts.get(c.callId)?.results ?? []).find((r) => r.truncated);
    if (cut && !confirmedCalls.has(c.callId)) out.push({ callId: c.callId, sessionId: c.sessionId, tool: cut.name });
  }
  return out;
}
