import { CONFIG, type AutopsyCall, type MissEvent, type PerCall } from "../autopsy/engine.ts";
import { callCostMicros, WASTE_RULE } from "../replay/from-ledger.ts";

/**
 * Waste blocks and their explanation (DF-005). A block is a run of calls that one rule flags together: calls an agent made on its
 * own long after the last prompt (idle), a failing command repeated (loops), a delegated agent's whole run (fan-out), or the single
 * call that rewrote a context the cache had held (cache miss). Everything here is computed from the calls and the rule's own
 * parameters; nothing is guessed, and what the logs cannot show is marked, not filled in.
 */
export type BlockKind = "loops" | "idle" | "subagents" | "cache_miss";

export const BLOCK_RULE: Record<BlockKind, string> = { loops: WASTE_RULE.loops ?? "C-LOOP-1", idle: WASTE_RULE.idle ?? "C-IDLE-1", subagents: WASTE_RULE.subagents ?? "C-FANOUT-1", cache_miss: "C-CACHE-1" };

/** What the ledger knows about the tool uses of one call that the autopsy call does not carry. */
export interface ToolUseFacts {
  /** Tool uses of this call with no result recorded: the log ended, or the result line was lost. */
  withoutResult: number;
}

export interface Block {
  id: string;
  kind: BlockKind;
  rule: string;
  sessionId: string;
  threadKey: string;
  calls: AutopsyCall[];
  startMs: number;
  endMs: number;
  totalMicros: number;
  unpricedCalls: number;
}

const cost = (c: AutopsyCall): number => callCostMicros(c);

/** The blocks of one session, most expensive first. A session's threads (its own file, each delegated agent's file) are read separately. */
export function findBlocks(calls: readonly AutopsyCall[], analysis: ReadonlyMap<string, PerCall>, misses: readonly MissEvent[]): Block[] {
  const byThread = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = byThread.get(c.threadKey) ?? [];
    list.push(c);
    byThread.set(c.threadKey, list);
  }
  const blocks: Block[] = [];
  const make = (kind: BlockKind, run: AutopsyCall[]): void => {
    const first = run[0] as AutopsyCall;
    blocks.push({
      id: `${kind}-${first.callId.slice(-10)}`,
      kind,
      rule: BLOCK_RULE[kind],
      sessionId: first.sessionId,
      threadKey: first.threadKey,
      calls: run,
      startMs: first.tsMs,
      endMs: (run[run.length - 1] as AutopsyCall).tsMs,
      totalMicros: run.reduce((s, c) => s + cost(c), 0),
      unpricedCalls: run.filter((c) => c.micros === null).length,
    });
  };
  for (const list of byThread.values()) {
    const sorted = [...list].sort((a, b) => a.tsMs - b.tsMs || a.callId.localeCompare(b.callId));
    let run: AutopsyCall[] = [];
    let kind: BlockKind | null = null;
    const flush = (): void => {
      if (kind !== null && run.length > 0) make(kind, run);
      run = [];
      kind = null;
    };
    for (const c of sorted) {
      const whole = analysis.get(c.callId)?.wholeCall;
      const k: BlockKind | null = whole === "loops" || whole === "idle" || whole === "subagents" ? whole : null;
      if (k !== kind) flush();
      if (k !== null) {
        kind = k;
        run.push(c);
      }
    }
    flush();
  }
  const byId = new Map(calls.map((c) => [c.callId, c]));
  for (const m of misses) {
    const c = byId.get(m.callId);
    if (c) make("cache_miss", [c]);
  }
  return blocks.sort((a, b) => b.totalMicros - a.totalMicros || a.startMs - b.startMs);
}

export interface CascadeStep {
  callId: string;
  atMs: number;
  tools: string[];
  /** The call has a failing tool use that is the same tool and input as the one that broke first. */
  repeatsFirstBreak: boolean;
  failed: boolean;
  /** The call is inside a delegated agent, or one of its tool uses has no result in the log. */
  opaque: boolean;
  opaqueWhy: string | null;
}

export interface Cascade {
  /** The call at which the chain first broke, which is before the rule could act. */
  firstBreak: { callId: string; atMs: number; tool: string; callsBeforeStop: number } | null;
  steps: CascadeStep[];
  /** How many times the failing tool use had happened by the stop point, counting it. */
  repeatsSeen?: number;
  /** Low when an opaque step lies between the first break and the stop point: the chain may not be the whole story. */
  confidence: "high" | "low";
  why: string;
}

export interface Explanation {
  block: Block;
  stop: { callId: string; atMs: number; offsetSec: number; why: string; savingMicros: number; callsAfter: number };
  rule: { id: string; params: Record<string, string | number>; observed: Record<string, string | number> };
  cascade: Cascade;
  /** One line per sentence, each with what it rests on. */
  sentences: { text: string; basis: string }[];
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0]}`;
const usd = (m: number): string => `$${(m / 1e6).toFixed(2)}`;
const minutes = (ms: number): string => (ms < 90_000 ? `${Math.round(ms / 1000)} seconds` : `${(ms / 60_000).toFixed(1)} minutes`);

function opaqueReason(c: AutopsyCall, facts: ReadonlyMap<string, ToolUseFacts>): string | null {
  if (c.isSidechain) return "a delegated agent's call: what it did there is not in this thread";
  const gap = facts.get(c.callId)?.withoutResult ?? 0;
  if (gap > 0) return `${gap} tool use${gap === 1 ? "" : "s"} in this call ha${gap === 1 ? "s" : "ve"} no result in the log`;
  return null;
}

/** The chain that led into a loop: the first call whose failing tool use is the one the loop repeats, then every call to the end of the block. */
function loopCascade(block: Block, thread: readonly AutopsyCall[], facts: ReadonlyMap<string, ToolUseFacts>): Cascade {
  const first = block.calls[0] as AutopsyCall;
  const at = thread.findIndex((c) => c.callId === first.callId);
  const failing = (c: AutopsyCall): string[] => c.tools.filter((t) => t.resultIsError === true).map((t) => `${t.name}#${t.inputHash}`);
  // The signature the loop rests on: the one that, with this call, reached the repeat count inside the window. A human prompt resets the count.
  let start = Math.max(0, at - (CONFIG.loopWindowCalls - 1));
  for (let i = at; i > start; i -= 1) if ((thread[i] as AutopsyCall).humanPromptBefore) { start = i; break; }
  const window = thread.slice(start, at);
  const sig = failing(first).find((s) => window.filter((c) => failing(c).includes(s)).length + 1 >= CONFIG.loopRepeats);
  if (sig === undefined) return { firstBreak: null, steps: [], confidence: "low", why: "The failing command that the rule counted could not be found again in the calls before this one." };
  const earlier = window.filter((c) => failing(c).includes(sig));
  const brk = earlier[0] as AutopsyCall;
  const lastIdx = thread.findIndex((c) => c.callId === (block.calls[block.calls.length - 1] as AutopsyCall).callId);
  const from = thread.findIndex((c) => c.callId === brk.callId);
  const steps: CascadeStep[] = thread.slice(from, lastIdx + 1).map((c) => {
    const why = opaqueReason(c, facts);
    return { callId: c.callId, atMs: c.tsMs, tools: c.tools.map((t) => t.name), repeatsFirstBreak: failing(c).includes(sig), failed: failing(c).length > 0, opaque: why !== null, opaqueWhy: why };
  });
  const between = steps.filter((s) => s.callId !== first.callId && s.atMs <= first.tsMs && s.opaque);
  const tool = sig.slice(0, sig.indexOf("#"));
  return {
    firstBreak: { callId: brk.callId, atMs: brk.tsMs, tool, callsBeforeStop: at - from },
    repeatsSeen: earlier.length + 1,
    steps,
    confidence: between.length > 0 ? "low" : "high",
    why: between.length > 0 ? `An opaque step lies between the first break and the stop point (${between[0]?.opaqueWhy}), so the chain may not be the whole story.` : "Every call between the first break and the stop point has its tool results in the log, and none is a delegated agent's.",
  };
}

/** What stopping at the first call of a block would have saved, how the rule matched, and how the failure unfolded. */
export function explainBlock(block: Block, thread: readonly AutopsyCall[], missByCall: ReadonlyMap<string, MissEvent>, facts: ReadonlyMap<string, ToolUseFacts>, sessionStartMs: number): Explanation {
  const first = block.calls[0] as AutopsyCall;
  const offsetSec = Math.round((first.tsMs - sessionStartMs) / 1000);
  const saving = block.totalMicros;
  const sentences: { text: string; basis: string }[] = [];
  let rule: Explanation["rule"];
  let why: string;
  let cascade: Cascade;
  const n = block.calls.length;

  if (block.kind === "loops") {
    cascade = loopCascade(block, thread, facts);
    const tool = cascade.firstBreak?.tool ?? first.tools.find((t) => t.resultIsError)?.name ?? "a tool";
    rule = { id: block.rule, params: { repeats: CONFIG.loopRepeats, window_calls: CONFIG.loopWindowCalls }, observed: { failing_tool: tool, repeats_seen: cascade.repeatsSeen ?? 1 } };
    why = `the ${ordinal(CONFIG.loopRepeats)} identical failing ${tool} call inside ${CONFIG.loopWindowCalls} calls, with no prompt from you in between`;
    sentences.push({ text: `${tool} failed with the same input ${rule.observed["repeats_seen"]} times${cascade.firstBreak ? `, first at ${new Date(cascade.firstBreak.atMs).toISOString().slice(11, 19)} UTC` : ""}${n > 1 ? `, and the agent kept calling it for ${n - 1} more call${n === 2 ? "" : "s"}` : ""}.`, basis: "tool_call and tool_result rows of this thread: tool name, input hash, is_error" });
  } else if (block.kind === "idle") {
    const since = first.msSinceHumanPrompt ?? 0;
    cascade = { firstBreak: null, steps: [], confidence: "high", why: "An idle block has no failing step: the calls were made without a prompt or a tool result to answer." };
    rule = { id: block.rule, params: { idle_after_minutes: CONFIG.idleAfterPromptMs / 60_000 }, observed: { minutes_since_your_last_prompt: Math.round(since / 60_000) } };
    why = `a call with no prompt and no tool result to answer, ${minutes(since)} after your last prompt (the rule acts after ${CONFIG.idleAfterPromptMs / 60_000} minutes)`;
    sentences.push({ text: `${n} call${n === 1 ? " was" : "s were"} made by the agent on its own, starting ${minutes(since)} after your last prompt.`, basis: "model_call timestamps and human_prompt rows of this session" });
  } else if (block.kind === "subagents") {
    cascade = { firstBreak: null, steps: [], confidence: "high", why: "A delegated agent's run has no failing step to follow; its work is in its own thread." };
    rule = { id: block.rule, params: {}, observed: { calls: n, models: [...new Set(block.calls.map((c) => c.model))].join(", ") } };
    why = "the first call of a delegated agent's run";
    sentences.push({ text: `A delegated agent made ${n} call${n === 1 ? "" : "s"}. This is not necessarily waste: it is the cost a cap on delegated agents would govern.`, basis: "model_call rows with is_sidechain set" });
  } else {
    const m = missByCall.get(first.callId);
    const idx = thread.findIndex((c) => c.callId === first.callId);
    const prev = idx > 0 ? (thread[idx - 1] as AutopsyCall) : undefined;
    const gap = prev ? first.tsMs - prev.tsMs : 0;
    const ttl = prev && prev.tokens.write1h >= prev.tokens.write5m && prev.tokens.write1h > 0 ? CONFIG.oneHourMs : CONFIG.fiveMinutesMs;
    const reason = m?.reason ?? "prefix_changed";
    rule = {
      id: block.rule,
      params: { read_below_share_of_previous_context: CONFIG.missBelowShare, not_shrunk_below_share: CONFIG.shrinkBelowShare },
      observed: { reason, lost_tokens: m?.tokens ?? 0, minutes_since_previous_call: Math.round(gap / 60_000), cache_lifetime_minutes: ttl / 60_000 },
    };
    why = reason === "ttl_expired" ? `the call came ${minutes(gap)} after the one before, past the ${ttl / 60_000}-minute life of the cache` : reason === "model_switch" ? "the model changed from the call before, and a cache belongs to one model" : "the context was about as large as before but almost none of it was read from the cache";
    const opaque = reason === "prefix_changed";
    cascade = {
      firstBreak: null,
      steps: [],
      confidence: opaque ? "low" : "high",
      why: opaque ? "Something earlier in the prompt changed, which made the cache start over. The logs do not say what, so this cause is a guess from the shape of the tokens." : "The cause is read from the timestamps and the model names, not guessed.",
    };
    sentences.push({ text: `${(m?.tokens ?? 0).toLocaleString("en-US")} tokens were written to the cache again that an unchanged prefix would have read, ${reason === "ttl_expired" ? `${minutes(gap)} after the call before` : reason === "model_switch" ? "after a change of model" : "with no change of model or long pause to explain it"}.`, basis: "model_call token counts and timestamps of this call and the one before it" });
  }

  sentences.push({ text: `The rule ${block.rule} would have acted at this call: ${why}. Stopping there would have saved ${usd(saving)}${block.unpricedCalls > 0 ? ` (and ${block.unpricedCalls} call${block.unpricedCalls === 1 ? "" : "s"} on a model with no price, counted and not priced)` : ""}, assuming nothing the agent did later was needed.`, basis: "the cost of this call and every later call of the block, at the price snapshot of each" });
  return { block, stop: { callId: first.callId, atMs: first.tsMs, offsetSec, why, savingMicros: saving, callsAfter: n - 1 }, rule, cascade, sentences };
}
