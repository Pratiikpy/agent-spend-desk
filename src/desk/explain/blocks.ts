import { LANG_PARAMS } from "../lang/surcharge.ts";
import { WASTE_PARAMS } from "../waste/detect.ts";
import { CONFIG, type AutopsyCall, type MissEvent, type PerCall } from "../autopsy/engine.ts";
import { callCostMicros, WASTE_RULE } from "../replay/from-ledger.ts";
import type { WasteClass, WasteEvent } from "../waste/detect.ts";

/**
 * Waste blocks and their explanation (DF-005). A block is a run of calls that one rule flags together: calls an agent made on its
 * own long after the last prompt (idle), a failing command repeated (loops), a delegated agent's whole run (fan-out), or the single
 * call that rewrote a context the cache had held (cache miss). Everything here is computed from the calls and the rule's own
 * parameters; nothing is guessed, and what the logs cannot show is marked, not filled in.
 */
export type BlockKind = "loops" | "idle" | "subagents" | "cache_miss" | "echo" | "truncation" | "churn" | "reflection" | "orphan" | "abandon" | "revert" | "pr" | "lang";

export const BLOCK_RULE: Record<BlockKind, string> = {
  loops: WASTE_RULE.loops ?? "C-LOOP-1",
  idle: WASTE_RULE.idle ?? "C-IDLE-1",
  subagents: WASTE_RULE.subagents ?? "C-FANOUT-1",
  cache_miss: "C-CACHE-1",
  echo: "C-LOOP-2",
  truncation: "C-TRUNC",
  churn: "C-CHURN",
  reflection: "C-UNREF",
  orphan: "C-ORPHAN",
  abandon: "C-ABANDON",
  revert: "C-REVERT",
  pr: "C-PR",
  lang: "C-LANG",
};

const KIND_OF_RULE: Record<WasteClass, BlockKind> = { "C-LOOP-2": "echo", "C-TRUNC": "truncation", "C-CHURN": "churn", "C-UNREF": "reflection", "C-ORPHAN": "orphan", "C-ABANDON": "abandon", "C-REVERT": "revert", "C-PR": "pr", "C-LANG": "lang" };

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
  /** What the rule saw, for the rules that report it, and how far to trust a rule that is a heuristic. */
  observed?: Record<string, string | number>;
  confidence?: "high" | "low";
}

const cost = (c: AutopsyCall): number => callCostMicros(c);

/** The blocks of one session, most expensive first. A session's threads (its own file, each delegated agent's file) are read separately. */
export function findBlocks(calls: readonly AutopsyCall[], analysis: ReadonlyMap<string, PerCall>, misses: readonly MissEvent[], events: readonly WasteEvent[] = []): Block[] {
  // A call the waste rules claim is theirs: it does not also count in a delegated agent's run.
  const claimed = new Set(events.flatMap((e) => e.calls.map((c) => c.callId)));
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
      const k: BlockKind | null = claimed.has(c.callId) ? null : whole === "loops" || whole === "idle" || whole === "subagents" ? whole : null;
      if (k !== kind) flush();
      if (k !== null) {
        kind = k;
        run.push(c);
      }
    }
    flush();
  }
  for (const e of events) {
    const first = e.calls[0] as AutopsyCall;
    blocks.push({
      id: `${KIND_OF_RULE[e.rule]}-${first.callId.slice(-10)}`,
      kind: KIND_OF_RULE[e.rule],
      rule: e.rule,
      sessionId: e.sessionId,
      threadKey: e.threadKey,
      calls: e.calls,
      startMs: first.tsMs,
      endMs: (e.calls[e.calls.length - 1] as AutopsyCall).tsMs,
      totalMicros: e.micros,
      unpricedCalls: e.unpricedCalls,
      observed: e.observed,
      confidence: e.confidence,
    });
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
  } else if (block.kind === "echo") {
    const o = block.observed ?? {};
    const tool = String(o["failing_tool"] ?? "a tool");
    cascade = { firstBreak: null, steps: [], confidence: "high", why: "The same tool returned the same error each time and never succeeded in between: the agent kept trying a call that does not work." };
    rule = { id: block.rule, params: { repeats: Number(o["repeats_required"] ?? 3) }, observed: { failing_tool: tool, calls_flagged: n } };
    why = `the ${ordinal(Number(o["repeats_required"] ?? 3))} time ${tool} returned the same error, with no success of ${tool} and no prompt from you in between`;
    sentences.push({ text: `${tool} returned the same error again and again, and the agent kept calling it for ${n} call${n === 1 ? "" : "s"} from the third time on.`, basis: "tool_result hashes (numbers and identifiers folded away) of this thread; the text of the error is not kept" });
  } else if (block.kind === "truncation") {
    const o = block.observed ?? {};
    const tool = String(o["truncated_tool"] ?? "a tool");
    const cut = thread.find((c) => c.callId === String(o["truncated_call"]));
    const steps: CascadeStep[] = [...(cut ? [cut] : []), ...block.calls].map((c) => ({ callId: c.callId, atMs: c.tsMs, tools: c.tools.map((t) => t.name), repeatsFirstBreak: c.callId !== cut?.callId && c.tools.some((t) => t.name === tool), failed: false, opaque: false, opaqueWhy: null }));
    cascade = { firstBreak: cut ? { callId: cut.callId, atMs: cut.tsMs, tool, callsBeforeStop: 0 } : null, steps, confidence: "high", why: `${tool} said its output was cut short, and the same use was asked for again ${Number(o["repeated_after_calls"] ?? 1)} call${Number(o["repeated_after_calls"] ?? 1) === 1 ? "" : "s"} later.` };
    rule = { id: block.rule, params: { repeat_within_calls: Number(o["repeat_within_calls"] ?? 3) }, observed: { truncated_tool: tool, repeated_after_calls: Number(o["repeated_after_calls"] ?? 1) } };
    why = `the call after a ${tool} result that said it was cut short: the cut was not dealt with and the same ${tool} use came back`;
    sentences.push({ text: `A ${tool} result said it did not return everything, and the same ${tool} use was repeated ${Number(o["repeated_after_calls"] ?? 1)} call${Number(o["repeated_after_calls"] ?? 1) === 1 ? "" : "s"} later; the ${n} call${n === 1 ? "" : "s"} after the cut produced nothing that changed what the repeat asked for.`, basis: "tool_result rows marked truncated and the tool name and input hash of the later calls" });
  } else if (block.kind === "churn") {
    const o = block.observed ?? {};
    cascade = { firstBreak: null, steps: [], confidence: "low", why: "A file edited again and again may be a file being written well. This rule cannot tell, so it is a heuristic and says so." };
    rule = { id: block.rule, params: { edits: Number(o["edits_required"] ?? 4) }, observed: { calls_flagged: n } };
    why = `the ${ordinal(Number(o["edits_required"] ?? 4))} edit of one file with no call that could run a check, and no prompt from you, in between`;
    sentences.push({ text: `One file was edited for the ${ordinal(Number(o["edits_required"] ?? 4))} time without anything being run between the edits, and the edits went on for ${n} call${n === 1 ? "" : "s"} from there. This may be one change made in parts, which is work that was needed.`, basis: "session_edit rows of this thread" });
  } else if (block.kind === "reflection") {
    const o = block.observed ?? {};
    cascade = { firstBreak: null, steps: [], confidence: "high", why: "None of these calls used a tool, and the calls before them did not hand control back, so the model was carrying on alone." };
    rule = { id: block.rule, params: { consecutive_calls: Number(o["consecutive_required"] ?? 3) }, observed: { calls_with_no_tool: Number(o["calls_with_no_tool"] ?? n) } };
    why = `the ${ordinal(Number(o["consecutive_required"] ?? 3))} call in a row that used no tool, when the calls before it had not handed control back`;
    sentences.push({ text: `${Number(o["calls_with_no_tool"] ?? n)} calls in a row used no tool, and none of the earlier ones ended its turn.`, basis: "model_call tool names and stop reasons of this thread" });
  } else if (block.kind === "orphan") {
    const o = block.observed ?? {};
    cascade = { firstBreak: null, steps: [], confidence: "high", why: "The agent that started this one had made its last call before these, and you did not prompt in between." };
    rule = { id: block.rule, params: { orphan_after_minutes: Number(o["orphan_after_minutes"] ?? 10) }, observed: { minutes_after_parent: Number(o["minutes_after_parent"] ?? 0), calls: n } };
    why = `a delegated agent's call ${Number(o["minutes_after_parent"] ?? 0)} minutes after the agent that started it made its last (the rule acts after ${Number(o["orphan_after_minutes"] ?? 30)})`;
    sentences.push({ text: `A delegated agent went on calling the model for ${n} call${n === 1 ? "" : "s"}, starting ${Number(o["minutes_after_parent"] ?? 0)} minutes after the agent that started it had stopped.`, basis: "model_call timestamps of the session's main thread and the delegated thread" });
  } else if (block.kind === "abandon") {
    const o = block.observed ?? {};
    cascade = { firstBreak: { callId: first.callId, atMs: first.tsMs, tool: first.tools[0]?.name ?? "a tool", callsBeforeStop: 0 }, steps: block.calls.map((c) => ({ callId: c.callId, atMs: c.tsMs, tools: c.tools.map((t) => t.name), repeatsFirstBreak: false, failed: true, opaque: false, opaqueWhy: null })), confidence: "high", why: "The session ended in a run of calls whose tool results all failed; nothing landed in a repository that had no commit at all, and nobody came back to it." };
    rule = { id: block.rule, params: { failing_calls: WASTE_PARAMS.abandonFailures, quiet_hours: Number(o["quiet_hours"] ?? 24), calls_in_session_over: WASTE_PARAMS.abandonCalls }, observed: { failing_calls_at_the_end: Number(o["failing_calls_at_the_end"] ?? n), calls_in_session: Number(o["calls_in_session"] ?? n) } };
    why = `the first of the last ${Number(o["failing_calls_at_the_end"] ?? n)} calls of a ${Number(o["calls_in_session"] ?? n)}-call session whose tool results all failed, with no commit in its repository in the day after and no later session in the same folder`;
    sentences.push({ text: `The session ended with ${Number(o["failing_calls_at_the_end"] ?? n)} calls whose tools all failed, ${n} call${n === 1 ? "" : "s"} of spend from there. No commit landed in its repository in the day after it, and no later session took the folder up.`, basis: "tool_result errors of this session, the repository's commits, and the sessions in the same folder" });
  } else if (block.kind === "revert") {
    const o = block.observed ?? {};
    cascade = { firstBreak: null, steps: [], confidence: String(o["link_confidence"]) === "high" ? "high" : "low", why: "This session's commits were reverted afterwards, so the work it paid for did not stay." };
    rule = { id: block.rule, params: { link_confidence_at_least: "medium" }, observed: { calls: n, link_confidence: String(o["link_confidence"] ?? "unknown") } };
    why = "a session whose commit was reverted (undone work did not land)";
    sentences.push({ text: `This session's commits were reverted, so the ${n} call${n === 1 ? "" : "s"} of spend in this period went to work that did not stay. That is known after the fact and cannot be recovered.`, basis: "session_outcome and git_commit rows (a revert commit that names the original)" });
  } else if (block.kind === "pr") {
    const o = block.observed ?? {};
    cascade = { firstBreak: null, steps: [], confidence: String(o["link_confidence"]) === "high" ? "high" : "low", why: "Every commit of this session is in a pull request that was closed without being merged." };
    rule = { id: block.rule, params: { pull_request_state: "closed_unmerged" }, observed: { pull_requests: String(o["pull_requests"] ?? ""), calls: n } };
    why = `a session whose commits are all in pull request${String(o["pull_requests"] ?? "").includes(",") ? "s" : ""} ${String(o["pull_requests"] ?? "")}, closed without a merge`;
    sentences.push({ text: `The work of this session was offered as ${String(o["pull_requests"] ?? "a pull request")} and the pull request was closed without being merged, so the ${n} call${n === 1 ? "" : "s"} of spend in this period went to work that was turned down.`, basis: "pr_fact rows fetched by desk landing --prs, and the session's links to commits" });
  } else if (block.kind === "lang") {
    const o = block.observed ?? {};
    const times = Number(o["times_english"] ?? 0);
    cascade = { firstBreak: null, steps: [], confidence: "low", why: "The prompts were in another script, which the model's tokenizer splits into more tokens than the same length of English. That may be the language the work needs, so this is a cost to know about, not a mistake." };
    rule = { id: block.rule, params: { at_least_times_english: LANG_PARAMS.wasteRatio, tasks_to_compare: LANG_PARAMS.minTasks }, observed: { times_english: times, extra_tokens: Number(o["extra_tokens"] ?? 0), prompts: Number(o["prompts"] ?? n) } };
    why = `a prompt in ${String(o["language"] ?? "another script")} on ${String(o["model"] ?? "this model")}, a language that costs ${times.toFixed(2)} times English on that model`;
    sentences.push({ text: `${Number(o["prompts"] ?? n)} prompt${Number(o["prompts"] ?? n) === 1 ? " was" : "s were"} written in ${String(o["language"] ?? "another script")}, which costs about ${times.toFixed(2)} times what the same length of English costs on ${String(o["model"] ?? "this model")}; the extra, about ${Number(o["extra_tokens"] ?? 0).toLocaleString("en-US")} tokens, is what is counted here.`, basis: "the script and length recorded for each prompt, and the tokens of the first call after it, against the English fit on the same model (an estimate)" });
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
    const pre = m?.compaction;
    const sizes = pre ? `${pre.preTokens.toLocaleString("en-US")} tokens before${pre.postTokens === null ? "" : ` and ${pre.postTokens.toLocaleString("en-US")} after`}` : "";
    why =
      reason === "compaction"
        ? `the agent compacted its conversation just before this call (${pre?.trigger === "manual" ? "you asked for it" : pre?.trigger === "auto" ? "it started on its own" : "the log records it"}), which rewrites the start of the prompt, so the cache began again`
        : reason === "ttl_expired"
          ? `the call came ${minutes(gap)} after the one before, past the ${ttl / 60_000}-minute life of the cache`
          : reason === "model_switch"
            ? "the model changed from the call before, and a cache belongs to one model"
            : reason === "client_update"
              ? `the client changed from ${m?.versions?.from ?? "one version"} to ${m?.versions?.to ?? "another"} between the two calls, with no pause, compaction or change of model to explain the lost cache`
              : "the context was about as large as before but almost none of it was read from the cache";
    const opaque = reason === "prefix_changed" || reason === "client_update";
    cascade = {
      firstBreak: null,
      steps: [],
      confidence: opaque ? "low" : "high",
      why:
        reason === "client_update"
          ? "The client's version changed and nothing else the log records explains the lost cache. A new client can change the opening of every prompt, so this is the likely cause, not a proven one."
          : opaque
            ? "Something earlier in the prompt changed, which made the cache start over. The logs do not say what, so this cause is a guess from the shape of the tokens."
            : reason === "compaction"
              ? `The log records the compaction itself${sizes === "" ? "" : `: the context held ${sizes}`}. The cause is read from that record, not guessed.`
              : "The cause is read from the timestamps and the model names, not guessed.",
    };
    sentences.push({ text: `${(m?.tokens ?? 0).toLocaleString("en-US")} tokens were written to the cache again that an unchanged prefix would have read, ${reason === "ttl_expired" ? `${minutes(gap)} after the call before` : reason === "model_switch" ? "after a change of model" : reason === "compaction" ? `right after a compaction${sizes === "" ? "" : ` (${sizes})`}` : reason === "client_update" ? `after the client changed from ${m?.versions?.from ?? "one version"} to ${m?.versions?.to ?? "another"}` : "with no change of model or long pause to explain it"}.`, basis: "model_call token counts and timestamps of this call and the one before it" });
  }

  sentences.push({ text: `The rule ${block.rule} would have acted at this call: ${why}. Stopping there would have saved ${usd(saving)}${block.unpricedCalls > 0 ? ` (and ${block.unpricedCalls} call${block.unpricedCalls === 1 ? "" : "s"} on a model with no price, counted and not priced)` : ""}, assuming nothing the agent did later was needed.`, basis: "the cost of this call and every later call of the block, at the price snapshot of each" });
  return { block, stop: { callId: first.callId, atMs: first.tsMs, offsetSec, why, savingMicros: saving, callsAfter: n - 1 }, rule, cascade, sentences };
}
