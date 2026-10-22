import { splitProportional } from "../money.ts";

/**
 * The limit autopsy (spec 24, DF-111): where did a window of agent use go? Every priced call's
 * list-price cost is assigned to causes so that the causes sum to the window total exactly.
 * Pure functions over plain records; the database loader lives in load.ts.
 *
 * Whole-call causes, in this order: idle (a call nobody asked for), loops (the third identical tool
 * call in a short run), sub-agents (a call inside a delegated agent). Every other call is split by
 * token class: re-sent history (cache reads and uncached input), cache misses (cache writes that a
 * kept prefix would have read), tool output (cache writes that carry tool results, estimated from
 * result length), reasoning, and new work (your prompts and the agent's answers).
 *
 * Thresholds are design parameters, listed in CONFIG, and are not claimed as tuned.
 */
export const CAUSES = ["idle", "loops", "subagents", "tool_output", "cache_misses", "reasoning", "history_rereads", "new_work"] as const;
export type Cause = (typeof CAUSES)[number];

export const CONFIG = {
  /** A call with no prompt, no tool result and more than this long since the last human prompt is background work. */
  idleAfterPromptMs: 30 * 60 * 1000,
  /** The same tool with identical input this many times within `loopWindowCalls` calls is a loop from that call on. */
  loopRepeats: 3,
  loopWindowCalls: 12,
  /** A call whose cache read falls below this share of the previous context lost the cache. */
  missBelowShare: 0.5,
  /** A context that shrinks below this share of the previous one was compacted or restarted, not missed. */
  shrinkBelowShare: 0.5,
  /** Rough size of text in tokens: characters divided by this. Labelled an estimate wherever it is used. */
  charsPerToken: 4,
  fiveMinutesMs: 5 * 60 * 1000,
  oneHourMs: 60 * 60 * 1000,
} as const;

export interface AutopsyToolUse {
  name: string;
  inputHash: string;
}

export interface AutopsyCall {
  callId: string;
  /** Calls in one log file form one thread; a delegated agent has its own file and its own thread. */
  threadKey: string;
  sessionId: string;
  tsMs: number;
  model: string;
  isSidechain: boolean;
  tokens: { input: number; output: number; reasoning: number; read: number; write5m: number; write1h: number };
  /** Price of one cache-read token in micro-dollars, from the price book; used to price what a cache hit would have cost. */
  readMicrosPerToken?: number;
  /** Null when the model has no price: the tokens are counted but no cost is invented. */
  micros: { input: number; output: number; read: number; write5m: number; write1h: number } | null;
  tools: AutopsyToolUse[];
  /** Characters of tool results that the previous call's tools returned to this call. */
  toolResultChars: number;
  /** A person sent a prompt between the previous call of this thread and this call. */
  humanPromptBefore: boolean;
  /** Milliseconds since the last human prompt of the session, or null when none is known. */
  msSinceHumanPrompt: number | null;
}

export type MissReason = "ttl_expired" | "model_switch" | "prefix_changed";

export interface MissEvent {
  callId: string;
  sessionId: string;
  tsMs: number;
  reason: MissReason;
  tokens: number;
  /** Cost of the rewritten context minus what a cache hit would have cost. */
  savingMicros: number;
}

export interface CauseTotals {
  micros: number;
  tokens: number;
  calls: number;
}

export interface Autopsy {
  startMs: number;
  endMs: number;
  calls: number;
  pricedCalls: number;
  unpricedCalls: number;
  unpricedTokens: number;
  totalMicros: number;
  causes: Record<Cause, CauseTotals>;
  missEvents: MissEvent[];
  loopCalls: number;
  /** Tool-output token counts are estimated from result length, not measured. */
  toolOutputIsEstimate: true;
}

interface PerCall {
  cause: Partial<Record<Cause, { micros: number; tokens: number }>>;
  miss?: MissEvent;
  wholeCall?: Cause;
}

function emptyCauses(): Record<Cause, CauseTotals> {
  const out = {} as Record<Cause, CauseTotals>;
  for (const c of CAUSES) out[c] = { micros: 0, tokens: 0, calls: 0 };
  return out;
}

function contextOf(c: AutopsyCall): number {
  return c.tokens.input + c.tokens.read + c.tokens.write5m + c.tokens.write1h;
}

function writeTokens(c: AutopsyCall): number {
  return c.tokens.write5m + c.tokens.write1h;
}

export function analyseThread(calls: readonly AutopsyCall[]): Map<string, PerCall> {
  const sorted = [...calls].sort((a, b) => a.tsMs - b.tsMs || a.callId.localeCompare(b.callId));
  const out = new Map<string, PerCall>();
  const recentSignatures: string[][] = [];
  let prev: AutopsyCall | undefined;

  for (const call of sorted) {
    const result: PerCall = { cause: {} };

    // loops: count identical tool signatures over the last few calls, reset by a human prompt
    if (call.humanPromptBefore) recentSignatures.length = 0;
    const signatures = call.tools.map((t) => `${t.name}#${t.inputHash}`);
    let loop = false;
    for (const s of signatures) {
      let seen = 0;
      for (const past of recentSignatures.slice(-(CONFIG.loopWindowCalls - 1))) if (past.includes(s)) seen += 1;
      if (seen + 1 >= CONFIG.loopRepeats) loop = true;
    }
    recentSignatures.push(signatures);

    const background = !call.humanPromptBefore && call.toolResultChars === 0 && call.msSinceHumanPrompt !== null && call.msSinceHumanPrompt > CONFIG.idleAfterPromptMs && prev !== undefined;
    if (background) result.wholeCall = "idle";
    else if (loop) result.wholeCall = "loops";
    else if (call.isSidechain) result.wholeCall = "subagents";

    // cache miss: the context is about as large as before but almost none of it was read from cache
    if (prev) {
      const before = contextOf(prev);
      const now = contextOf(call);
      if (before > 0 && call.tokens.read < CONFIG.missBelowShare * before && now >= CONFIG.shrinkBelowShare * before) {
        const lost = Math.max(0, Math.min(writeTokens(call), before - call.tokens.read));
        if (lost > 0) {
          const gap = call.tsMs - prev.tsMs;
          const ttl = prev.tokens.write1h >= prev.tokens.write5m && prev.tokens.write1h > 0 ? CONFIG.oneHourMs : CONFIG.fiveMinutesMs;
          const reason: MissReason = prev.model !== call.model ? "model_switch" : gap > ttl ? "ttl_expired" : "prefix_changed";
          result.miss = { callId: call.callId, sessionId: call.sessionId, tsMs: call.tsMs, reason, tokens: lost, savingMicros: 0 };
        }
      }
    }
    out.set(call.callId, result);
    prev = call;
  }
  return out;
}

export function buildAutopsy(calls: readonly AutopsyCall[], startMs: number, endMs: number): Autopsy {
  const byThread = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = byThread.get(c.threadKey) ?? [];
    list.push(c);
    byThread.set(c.threadKey, list);
  }
  const analysis = new Map<string, PerCall>();
  for (const list of byThread.values()) for (const [id, r] of analyseThread(list)) analysis.set(id, r);

  const causes = emptyCauses();
  const missEvents: MissEvent[] = [];
  let priced = 0;
  let unpriced = 0;
  let unpricedTokens = 0;
  let total = 0;
  let loopCalls = 0;

  const add = (cause: Cause, micros: number, tokens: number): void => {
    causes[cause].micros += micros;
    causes[cause].tokens += tokens;
  };

  for (const call of calls) {
    if (call.tsMs < startMs || call.tsMs > endMs) continue;
    const a = analysis.get(call.callId) ?? { cause: {} };
    const t = call.tokens;
    const allTokens = t.input + t.output + t.read + t.write5m + t.write1h;
    if (allTokens === 0) continue; // a synthetic placeholder call with no usage is neither priced nor unpriced
    if (call.micros === null) {
      unpriced += 1;
      unpricedTokens += allTokens;
      continue;
    }
    priced += 1;
    const m = call.micros;
    const callMicros = m.input + m.output + m.read + m.write5m + m.write1h;
    total += callMicros;

    if (a.wholeCall) {
      add(a.wholeCall, callMicros, allTokens);
      causes[a.wholeCall].calls += 1;
      if (a.wholeCall === "loops") loopCalls += 1;
      continue;
    }

    // token-class split
    add("history_rereads", m.input + m.read, t.input + t.read);

    const writeMicros = m.write5m + m.write1h;
    const wTokens = writeTokens(call);
    const missTokens = a.miss ? Math.min(a.miss.tokens, wTokens) : 0;
    const toolTokens = Math.min(wTokens - missTokens, Math.round(call.toolResultChars / CONFIG.charsPerToken));
    const rest = wTokens - missTokens - toolTokens;
    const [missM, toolM, newM] = splitProportional(writeMicros, [missTokens, toolTokens, rest]);
    add("cache_misses", missM ?? 0, missTokens);
    add("tool_output", toolM ?? 0, toolTokens);
    add("new_work", newM ?? 0, rest);

    const reasoning = Math.min(t.reasoning, t.output);
    const [reasonM, answerM] = splitProportional(m.output, [reasoning, t.output - reasoning]);
    add("reasoning", reasonM ?? 0, reasoning);
    add("new_work", answerM ?? 0, t.output - reasoning);

    if (a.miss) {
      const readRate = call.readMicrosPerToken ?? (t.read > 0 ? m.read / t.read : 0);
      missEvents.push({ ...a.miss, tokens: missTokens, savingMicros: Math.max(0, Math.round((missM ?? 0) - missTokens * readRate)) });
    }
  }

  const sum = CAUSES.reduce((s, c) => s + causes[c].micros, 0);
  if (sum !== total) throw new Error(`autopsy invariant broken: causes sum to ${sum}, window total is ${total}`);
  return { startMs, endMs, calls: priced + unpriced, pricedCalls: priced, unpricedCalls: unpriced, unpricedTokens, totalMicros: total, causes, missEvents, loopCalls, toolOutputIsEstimate: true };
}

/** The window of `hours` hours with the largest priced cost, found by a two-pointer sweep over sorted calls. */
export function heaviestWindow(calls: readonly AutopsyCall[], hours: number): { startMs: number; endMs: number; micros: number } | null {
  const priced = calls.filter((c) => c.micros !== null).sort((a, b) => a.tsMs - b.tsMs);
  if (priced.length === 0) return null;
  const span = hours * 60 * 60 * 1000;
  const cost = (c: AutopsyCall): number => (c.micros ? c.micros.input + c.micros.output + c.micros.read + c.micros.write5m + c.micros.write1h : 0);
  let best = { startMs: priced[0]!.tsMs, endMs: priced[0]!.tsMs + span, micros: 0 };
  let sum = 0;
  let left = 0;
  for (let right = 0; right < priced.length; right += 1) {
    sum += cost(priced[right]!);
    while (priced[right]!.tsMs - priced[left]!.tsMs > span) {
      sum -= cost(priced[left]!);
      left += 1;
    }
    if (sum > best.micros) best = { startMs: priced[left]!.tsMs, endMs: priced[left]!.tsMs + span, micros: sum };
  }
  return best;
}
