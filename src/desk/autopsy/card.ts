import { formatUsd } from "../money.ts";
import { CAUSES, type Autopsy, type Cause } from "./engine.ts";

export const CAUSE_LABEL: Record<Cause, string> = {
  idle: "Idle and background work",
  loops: "Loops (same tool call repeated)",
  subagents: "Sub-agents",
  tool_output: "Tool output sent back to the model",
  cache_misses: "Cache misses (context rewritten)",
  reasoning: "Reasoning (thinking tokens)",
  history_rereads: "Re-reading the conversation so far",
  new_work: "New work (your prompts and the agent's answers)",
};

function pct(part: number, whole: number): string {
  if (whole === 0) return "  0%";
  const p = (part / whole) * 100;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`.padStart(5);
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Plain-text card. Every figure is a list-price estimate from logged tokens; nothing here is a bill. */
export function renderAutopsyText(a: Autopsy): string {
  const lines: string[] = [];
  lines.push(`Where did the window go?  ${stamp(a.startMs)} to ${stamp(a.endMs)}`);
  lines.push(`${a.pricedCalls} priced calls, estimated list-price total ${formatUsd(a.totalMicros)} (an estimate, not a bill)`);
  lines.push("");
  const ranked = [...CAUSES].sort((x, y) => a.causes[y].micros - a.causes[x].micros);
  for (const c of ranked) {
    const t = a.causes[c];
    const bar = "#".repeat(Math.round((t.micros / Math.max(1, a.totalMicros)) * 30));
    lines.push(`${pct(t.micros, a.totalMicros)}  ${formatUsd(t.micros).padStart(10)}  ${CAUSE_LABEL[c].padEnd(50)} ${bar}`);
  }
  if (a.missEvents.length > 0) {
    const saving = a.missEvents.reduce((s, e) => s + e.savingMicros, 0);
    const byReason = new Map<string, number>();
    for (const e of a.missEvents) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    const detail = [...byReason].map(([r, n]) => `${n} ${r.replace("_", " ")}`).join(", ");
    lines.push("");
    lines.push(`Cache misses: ${a.missEvents.length} (${detail}); a cache hit would have saved about ${formatUsd(saving)}`);
  }
  if (a.loopCalls > 0) lines.push(`Loops: ${a.loopCalls} calls repeated a tool call you had already made twice`);
  lines.push("");
  lines.push("What I could not know:");
  lines.push("- Tool-output tokens are estimated from the length of tool results (about 4 characters per token).");
  lines.push("- How your plan limit maps to tokens is not published; these are shares of estimated cost, not of your limit.");
  if (a.unpricedCalls > 0) lines.push(`- ${a.unpricedCalls} calls (${a.unpricedTokens} tokens) are on models with no price and are not in the total.`);
  return lines.join("\n");
}
