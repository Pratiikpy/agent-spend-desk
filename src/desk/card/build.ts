import { buildAutopsy, CAUSES, heaviestWindow, type AutopsyCall, type Cause } from "../autopsy/engine.ts";
import { CAUSE_LABEL } from "../autopsy/card.ts";
import { hashJson } from "../../runtime/canonical.ts";
import { type Fix, pastWindows, rankFixes } from "./fixes.ts";
import { createRedactor, type RedactionKind } from "./redact.ts";

export type CardMode = "own_logs" | "sample";

export interface CardCause {
  cause: Cause;
  label: string;
  micros: number;
  /** Share of the window total, 0 to 1; the eight shares sum to 1 up to rounding in the last place. */
  share: number;
}

export interface Card {
  schema: "desk.card/1";
  mode: CardMode;
  window: { startIso: string; endIso: string; hours: number; kind: "heaviest_rolling_window" };
  period: { startIso: string; endIso: string; days: number };
  totals: { pricedCalls: number; unpricedCalls: number; estimatedMicros: number };
  /** Window cost per hour of the window, list-price estimate. */
  burnMicrosPerHour: number;
  /** Idle, loops and cache misses: causes a rule can see without judgement. */
  wasteShare: number;
  causes: CardCause[];
  topDrivers: CardCause[];
  fixes: Fix[];
  /** The mandatory disclosure block. */
  couldNotKnow: string[];
  redactions: Record<RedactionKind, number>;
  /** Hash of everything above this line, so a shared card can be checked against its JSON. */
  figuresHash: string;
}

export interface CardInput {
  calls: readonly AutopsyCall[];
  mode: CardMode;
  hours: number;
  /** The period shown is the `days` days up to the last call. */
  days: number;
  /** Facts about the ingest to report in the disclosure block. */
  ingest: { malformedLines: number; truncatedTails: number; usageConflicts: number; logFilesFound: number; searchedPaths: string[] };
  /** True when at least one repository was linked, so landing states exist. */
  landingKnown: boolean;
  home?: string;
}

const NOT_WASTE: ReadonlySet<Cause> = new Set(["new_work", "history_rereads", "reasoning", "tool_output", "subagents"]);

export function buildCard(input: CardInput): Card | { empty: true; couldNotKnow: string[] } {
  const redactor = createRedactor(input.home);
  const priced = input.calls.filter((c) => c.micros !== null);
  if (priced.length === 0) {
    const searched = input.ingest.searchedPaths.map((p) => redactor.clean(p));
    return {
      empty: true,
      couldNotKnow: [
        input.ingest.logFilesFound === 0 ? `No agent logs were found. Searched: ${searched.join(", ") || "(nothing)"}.` : `${input.ingest.logFilesFound} ${input.ingest.logFilesFound === 1 ? "log file was" : "log files were"} read but none contained a priced model call.`,
        "Run `desk card --sample` (or set SAMPLE_MODE=true) to see the same card on a constructed sample, offline.",
      ],
    };
  }
  let lastMs = priced[0]!.tsMs;
  for (const c of priced) if (c.tsMs > lastMs) lastMs = c.tsMs; // a loop, not Math.max(...): a real ledger has far more calls than a spread can take
  const periodStart = lastMs - input.days * 86_400_000;
  const inPeriod = input.calls.filter((c) => c.tsMs >= periodStart && c.tsMs <= lastMs);
  const window = heaviestWindow(inPeriod, input.hours) ?? { startMs: periodStart, endMs: lastMs, micros: 0 };
  const autopsy = buildAutopsy(input.calls, window.startMs, window.endMs);
  const past = pastWindows(inPeriod, input.hours, lastMs);
  const total = Math.max(1, autopsy.totalMicros);

  const causes: CardCause[] = [...CAUSES]
    .map((cause) => ({ cause, label: CAUSE_LABEL[cause], micros: autopsy.causes[cause].micros, share: autopsy.causes[cause].micros / total }))
    .sort((a, b) => b.micros - a.micros);
  const wasteMicros = CAUSES.filter((c) => !NOT_WASTE.has(c)).reduce((s, c) => s + autopsy.causes[c].micros, 0);
  const windowHours = (window.endMs - window.startMs) / 3_600_000;

  const couldNotKnow = [
    "Every dollar figure is a list-price estimate from logged tokens. It is not an invoice, and on a flat plan nothing here is what you paid.",
    "How your plan's limit maps to tokens is not published (NOT VERIFIED), so shares are shares of estimated cost, not of your limit.",
    "Tool-output tokens are estimated from the length of tool results, about 4 characters per token.",
  ];
  if (!input.landingKnown) couldNotKnow.push("No repository was linked, so the card cannot say which spend led to work that landed. Point it at repositories to raise that.");
  if (autopsy.unpricedCalls > 0) couldNotKnow.push(`${autopsy.unpricedCalls} calls (${autopsy.unpricedTokens} tokens) are on models with no price and are not in the total.`);
  if (input.ingest.malformedLines > 0) couldNotKnow.push(`${input.ingest.malformedLines} ${input.ingest.malformedLines === 1 ? "log line" : "log lines"} could not be read and ${input.ingest.malformedLines === 1 ? "was" : "were"} skipped.`);
  if (input.ingest.truncatedTails > 0) couldNotKnow.push(`${input.ingest.truncatedTails} ${input.ingest.truncatedTails === 1 ? "log ends" : "logs end"} in an unfinished line, which was skipped.`);
  if (past.length < 3) couldNotKnow.push(`Only ${past.length} comparable past windows exist, so savings are upper bounds, not intervals.`);
  if (input.mode === "sample") couldNotKnow.push("This is a constructed sample, not anyone's real history.");

  const body: Omit<Card, "figuresHash" | "redactions"> = {
    schema: "desk.card/1",
    mode: input.mode,
    window: { startIso: new Date(window.startMs).toISOString(), endIso: new Date(window.endMs).toISOString(), hours: input.hours, kind: "heaviest_rolling_window" },
    period: { startIso: new Date(periodStart).toISOString(), endIso: new Date(lastMs).toISOString(), days: input.days },
    totals: { pricedCalls: autopsy.pricedCalls, unpricedCalls: autopsy.unpricedCalls, estimatedMicros: autopsy.totalMicros },
    burnMicrosPerHour: windowHours > 0 ? Math.round(autopsy.totalMicros / windowHours) : 0,
    wasteShare: wasteMicros / total,
    causes: causes.map((c) => ({ ...c, label: redactor.clean(c.label) })),
    topDrivers: causes.filter((c) => c.cause !== "new_work").slice(0, 3).map((c) => ({ ...c, label: redactor.clean(c.label) })),
    fixes: rankFixes(autopsy, past).map((f) => ({ ...f, fix: redactor.clean(f.fix), note: redactor.clean(f.note) })),
    couldNotKnow: couldNotKnow.map((s) => redactor.clean(s)),
  };
  const redactions = redactor.counts();
  const figuresHash = hashJson({ ...body, redactions });
  return { ...body, redactions, figuresHash };
}
