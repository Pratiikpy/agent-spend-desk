import type { Trajectory } from "./read.ts";
import type { Effect } from "./tools.ts";

/**
 * How far a recorded session can be replayed (DF-040). A replay runs the task again on another route, and the new model will make calls the old one did not. A call that only
 * reads the workspace can be run again against a copy; a file edit can be applied to the copy; but a shell command that changed something, a call to the network, a delegated
 * agent and a tool the Desk does not know cannot be run again, so the only thing that can stand in for them is the result that was recorded. A session where one of those has no
 * recorded result, or only part of one, has nothing to stand in, and is not replayed.
 *
 * - `full`: nothing is missing. The transcript is whole (no stretch summarised away), every call has its whole result, so the replay can follow the original wherever it went.
 * - `tools_only`: every call that cannot be run again has its whole result, so a task can be re-run from its prompt, but the transcript has gaps: a compaction replaced earlier
 *   turns, a result of a read was cut short, or lines of the log could not be read. It is replayable only by re-running from the task prompt, never by following the original.
 * - `insufficient`: a call that cannot be run again has no whole result. Not replayed.
 *
 * A session with no tool call, or no prompt, has nothing to replay and is not counted among the ones that could have been.
 */
export type ReplayClass = "full" | "tools_only" | "insufficient";

/** The reasons a session is not `full`, by a code that does not carry a count, so that sessions can be tallied under one wording. */
export const REASON_LABEL = {
  served_missing: "a call that cannot be run again has no recorded result",
  served_cut: "a call that cannot be run again has only part of its result",
  compaction: "part of the conversation was summarised away",
  reads_missing: "a read of the workspace has no recorded result",
  reads_cut: "a read of the workspace was cut short",
  malformed: "lines of the log could not be read",
  sidechain: "a delegated agent's own turns are not followed",
  no_calls: "it made no tool call",
  no_prompt: "the log holds no prompt from a person, so there is no task to give a model",
} as const;
export type ReasonCode = keyof typeof REASON_LABEL;

export interface Replayability {
  eligible: boolean;
  class: ReplayClass | null;
  /** Why it is not `full` when it is not, and why it is not eligible when it is not; one line each, with the numbers. */
  reasons: string[];
  /** The same reasons by code, without the numbers. */
  codes: ReasonCode[];
  counts: { toolCalls: number; readOnly: number; mutating: number; byEffect: Record<Effect, number>; resultsPresent: number; resultsMissing: number; resultsCutShort: number; resultsRecovered: number };
}

const SERVED: ReadonlySet<Effect> = new Set<Effect>(["shell", "network_read", "agent", "unknown"]);
const EFFECTS: Effect[] = ["workspace_read", "network_read", "file_edit", "shell", "agent", "unknown"];
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function replayability(t: Trajectory): Replayability {
  const byEffect = Object.fromEntries(EFFECTS.map((e) => [e, 0])) as Record<Effect, number>;
  let readOnly = 0;
  let mutating = 0;
  let present = 0;
  let missing = 0;
  let cut = 0;
  let recovered = 0;
  let servedMissing = 0;
  let servedCut = 0;
  let readsMissing = 0;
  let readsCut = 0;
  for (const s of t.steps) {
    byEffect[s.kind.effect] += 1;
    if (s.kind.class === "read_only") readOnly += 1;
    else mutating += 1;
    if (s.result.present) present += 1;
    else missing += 1;
    if (s.result.present && s.result.truncated) cut += 1;
    if (s.result.recovered) recovered += 1;
    if (SERVED.has(s.kind.effect)) {
      if (!s.result.present) servedMissing += 1;
      else if (s.result.truncated) servedCut += 1;
    } else if (!s.result.present) readsMissing += 1;
    else if (s.result.truncated) readsCut += 1;
  }
  const counts = { toolCalls: t.steps.length, readOnly, mutating, byEffect, resultsPresent: present, resultsMissing: missing, resultsCutShort: cut, resultsRecovered: recovered };
  if (t.steps.length === 0) return { eligible: false, class: null, reasons: [REASON_LABEL.no_calls], codes: ["no_calls"], counts };
  if (t.prompts === 0) return { eligible: false, class: null, reasons: [REASON_LABEL.no_prompt], codes: ["no_prompt"], counts };
  const reasons: string[] = [];
  const codes: ReasonCode[] = [];
  const add = (code: ReasonCode, text: string): void => {
    codes.push(code);
    reasons.push(text);
  };
  if (servedMissing > 0) add("served_missing", `${servedMissing} ${plural(servedMissing, "call", "calls")} that cannot be run again (a shell command that changes something, the network, another agent, a tool not known) ${plural(servedMissing, "has", "have")} no recorded result`);
  if (servedCut > 0) add("served_cut", `${servedCut} such ${plural(servedCut, "call", "calls")} ${plural(servedCut, "has", "have")} only part of the result, which the tool cut short and did not keep`);
  if (codes.length > 0) return { eligible: true, class: "insufficient", reasons, codes, counts };
  if (t.compactions > 0) add("compaction", `${t.compactions} ${plural(t.compactions, "stretch", "stretches")} of the conversation ${plural(t.compactions, "was", "were")} summarised away, so the transcript has a gap`);
  if (readsMissing > 0) add("reads_missing", `${readsMissing} ${plural(readsMissing, "read", "reads")} of the workspace ${plural(readsMissing, "has", "have")} no recorded result`);
  if (readsCut > 0) add("reads_cut", `${readsCut} ${plural(readsCut, "read", "reads")} of the workspace ${plural(readsCut, "was", "were")} cut short`);
  if (t.malformedLines > 0) add("malformed", `${t.malformedLines} ${plural(t.malformedLines, "line", "lines")} of the log could not be read`);
  if (t.sidechainLines > 0) add("sidechain", `${t.sidechainLines} ${plural(t.sidechainLines, "line", "lines")} belong to a delegated agent and are not followed`);
  return { eligible: true, class: reasons.length === 0 ? "full" : "tools_only", reasons, codes, counts };
}
