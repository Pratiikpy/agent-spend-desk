import { analyseCalls } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { BLOAT_PARAMS, compactionPhases, type CompactionPhase } from "./bloat.ts";
import { potentialTruncations, WASTE_PARAMS, type WasteClass, type WasteEvent } from "./detect.ts";
import { commitLanding, loadCallFacts, loadCompactions, wasteEventsOf } from "./load.ts";

const NAME: Record<WasteClass, string> = {
  "C-LOOP-2": "the same error again and again",
  "C-TRUNC": "a cut-short result asked for again",
  "C-CHURN": "one file edited again and again",
  "C-UNREF": "the model carrying on alone with no tool",
  "C-ORPHAN": "a delegated agent after its parent stopped",
};

const RULE_TEXT: Record<WasteClass, string> = {
  "C-LOOP-2": `the ${WASTE_PARAMS.echoRepeats}rd time a tool returned the same error (numbers and identifiers folded away) with no success of that tool between`,
  "C-TRUNC": `the same tool use asked again within ${WASTE_PARAMS.truncRepeatWithinCalls} calls of a result that said it was cut short`,
  "C-CHURN": `the ${WASTE_PARAMS.churnEdits}th edit of one file with no call that could run a check between the edits (a heuristic: this may be a file being written well)`,
  "C-UNREF": `the ${WASTE_PARAMS.unrefConsecutive}rd call in a row that used no tool, when the first two did not hand control back`,
  "C-ORPHAN": `a delegated agent's call more than ${WASTE_PARAMS.orphanAfterMs / 60_000} minutes after the agent that started it made its last, with no prompt between`,
};

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

export interface WasteResult {
  events: WasteEvent[];
  phases: CompactionPhase[];
  text: string;
}

/**
 * `desk waste`: the waste the extra rules find in a period, by class, with each rule's trigger stated and the dollars from the stop point on.
 * The saving is an upper bound; the loops and idle time the autopsy already finds are shown by `desk autopsy`.
 */
export function wasteCommand(db: Ledger, snapshot: PriceSnapshot, sinceIso: string, untilIso: string): WasteResult {
  const calls = loadAutopsyCalls(db, snapshot, sinceIso, untilIso);
  if (calls.length === 0) return { events: [], phases: [], text: `The ledger holds no call between ${sinceIso.slice(0, 10)} and ${untilIso.slice(0, 10)}.` };
  const analysis = analyseCalls(calls);
  const facts = loadCallFacts(db, calls);
  const events = wasteEventsOf(db, calls, analysis, facts);
  const out: string[] = [`Waste found by the extra rules, ${sinceIso.slice(0, 10)} to ${untilIso.slice(0, 10)}: ${calls.length.toLocaleString("en-US")} calls read.`];
  const sure = events.filter((e) => e.confidence === "high");
  const guess = events.filter((e) => e.confidence === "low");
  const sum = (list: WasteEvent[]): number => list.reduce((s, e) => s + e.micros, 0);
  out.push(`${usd(sum(sure))} in rules that read the log directly; ${usd(sum(guess))} more in heuristics that can flag work that was needed.`);
  if (events.length === 0) out.push("None of the rules fired.");
  for (const rule of Object.keys(RULE_TEXT) as WasteClass[]) {
    const mine = events.filter((e) => e.rule === rule);
    if (mine.length === 0) {
      out.push(`${rule}  ${NAME[rule]}: none.`);
      continue;
    }
    const n = mine.reduce((s, e) => s + e.calls.length, 0);
    const sessions = new Set(mine.map((e) => e.sessionId)).size;
    const unpriced = mine.reduce((s, e) => s + e.unpricedCalls, 0);
    out.push(`${rule}  ${NAME[rule]}: ${mine.length} run${mine.length === 1 ? "" : "s"} in ${sessions} session${sessions === 1 ? "" : "s"}, ${n} call${n === 1 ? "" : "s"}, ${usd(mine.reduce((s, e) => s + e.micros, 0))}${unpriced > 0 ? ` (${unpriced} call${unpriced === 1 ? "" : "s"} with no price, not counted)` : ""}${mine[0]!.confidence === "low" ? "  [heuristic]" : ""}`);
    out.push(`        rule: ${RULE_TEXT[rule]}.`);
  }
  if (events.length > 0) {
    out.push("", `Largest runs (of ${events.length}), the directly read rules first:`);
    for (const e of [...sure.slice(0, 5), ...guess.slice(0, Math.max(0, 5 - sure.length))]) {
      const when = new Date(e.calls[0]!.tsMs).toISOString().slice(0, 16).replace("T", " ");
      out.push(`  ${e.rule}  ${usd(e.micros)}  ${e.calls.length} call${e.calls.length === 1 ? "" : "s"}  ${when}  session ${e.sessionId.slice(0, 8)}`);
    }
  }
  const phases = compactionPhases(calls, loadCompactions(db, sinceIso, untilIso), facts, commitLanding(db));
  out.push("", ...bloatLines(phases));
  const cuts = potentialTruncations(calls, facts, events);
  out.push("", `${cuts.length} tool result${cuts.length === 1 ? "" : "s"} said the output was cut short and ${cuts.length === 1 ? "was" : "were"} not asked for again; listed, not billed.`);
  out.push("These dollars are an upper bound: a rule cannot prove that stopping would have lost nothing. The classes do not overlap with each other or with the loops and idle time in desk autopsy.");
  return { events, phases, text: out.join("\n") };
}

const tokens = (n: number): string => n.toLocaleString("en-US");

/** C-BLOAT in words: how many compactions, how many threw away a lot, and of those how much is known to have landed nothing. */
function bloatLines(phases: readonly CompactionPhase[]): string[] {
  if (phases.length === 0) return ["C-BLOAT  context bloat across compactions: no compaction recorded in these calls."];
  const big = phases.filter((p) => p.churnTokens > BLOAT_PARAMS.churnTokens);
  const billed = phases.filter((p) => p.flagged);
  const by = (l: CompactionPhase["landing"]): number => big.filter((p) => p.landing === l).length;
  const priced = billed.filter((p) => p.wasteMicros !== null);
  const sessions = new Set(billed.map((p) => p.sessionId)).size;
  const dropped = billed.reduce((s, p) => s + p.churnTokens, 0);
  const rereads = billed.reduce((s, p) => s + p.rereads.length, 0);
  const lines = [`C-BLOAT  context bloat across compactions: ${phases.length} compaction${phases.length === 1 ? "" : "s"}, ${big.length} of them threw away more than ${tokens(BLOAT_PARAMS.churnTokens)} tokens.`];
  if (billed.length === 0) lines.push("        none of those is billed: nothing is known to have landed nothing.");
  else
    lines.push(
      `        ${billed.length} phase${billed.length === 1 ? "" : "s"} in ${sessions} session${sessions === 1 ? "" : "s"} in a repository with no commit in that time: ${tokens(dropped)} tokens thrown away, at least ${usd(priced.reduce((s, p) => s + (p.wasteMicros as number), 0))} at the price of writing a token to the cache once${priced.length < billed.length ? ` (${billed.length - priced.length} with no priced cache write, not counted)` : ""}.`,
    );
  const rest = [`${by("landed")} landed a commit`, `${by("possible")} sit in a repository that had a commit in that time`, `${by("unknown")} ran outside a repository the ledger scanned`].filter((t) => !t.startsWith("0 "));
  if (rest.length > 0) lines.push(`        not billed: ${rest.join("; ")}.`);
  if (billed.length > 0 && rereads > 0) lines.push(`        ${rereads} file${rereads === 1 ? "" : "s"} read again within ${BLOAT_PARAMS.rereadWithinCalls} calls of a compaction, after the phase had read ${rereads === 1 ? "it" : "them"}.`);
  lines.push(`        rule: a phase between compactions that the next compaction cut by more than ${tokens(BLOAT_PARAMS.churnTokens)} tokens, in a repository that had no commit inside the phase. These dollars overlap the calls above and are not added to them; where the outcome is unknown the phase is counted and not billed.`);
  return lines;
}
