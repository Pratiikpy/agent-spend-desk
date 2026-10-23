import { readFileSync } from "node:fs";

import { Budget, DRAFT_LIVE } from "../agents/budget.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { openLedger } from "../ledger/db.ts";
import { parsePolicyYaml, usdToMicros } from "../policy/parse.ts";
import type { Policy } from "../policy/types.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { choosePort, type ProposeCommandOptions } from "../propose/command.ts";
import { propose, type ProposeResult } from "../propose/run.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import type { ReplaySession } from "../replay/policy-replay.ts";
import { markDecision, openRegret, recordDecision, renderRegret, scoreDecisions, type OptionInput } from "./regret.ts";

/** The options a proposal put in front of the owner: the one on offer, the policy in force, and the draft before hardening. */
export function optionsOf(current: Policy, result: ProposeResult): OptionInput[] {
  const options: OptionInput[] = [
    { option: "chosen", label: "the proposed policy", policy: result.final },
    { option: "rejected", label: "the policy already in force", policy: current },
  ];
  if (result.hardened.closed.length > 0 || result.hardened.unresolved.length > 0) options.push({ option: "rejected", label: "the draft before hardening", policy: result.draft.policy });
  return options;
}

function decisionId(result: ProposeResult, decidedAtMs: number): string {
  return `${result.policyHash.slice(7, 19)}-${new Date(decidedAtMs).toISOString().slice(0, 10)}`;
}

/** Called when a proposal is put to the owner: write down what is expected of each option, on everything known now. */
export function recordProposal(regretPath: string, o: { requestId: string; current: Policy; result: ProposeResult; sessions: readonly ReplaySession[] }): void {
  const db = openRegret(regretPath);
  try {
    const decidedAtMs = o.sessions.reduce((m, s) => Math.max(m, s.startMs), 0);
    recordDecision(db, { decisionId: decisionId(o.result, decidedAtMs), requestId: o.requestId, decidedAtMs, decision: "proposed", history: o.sessions, options: optionsOf(o.current, o.result) });
  } finally {
    db.close();
  }
}

export function recordApproval(regretPath: string, requestId: string): void {
  const db = openRegret(regretPath);
  try {
    markDecision(db, requestId, "approved");
  } finally {
    db.close();
  }
}

export interface RegretCommandOptions extends Pick<ProposeCommandOptions, "dbPath" | "pricesPath" | "policyPath" | "cassetteDir" | "sampleMode" | "record" | "env" | "personFromBranch"> {
  regretPath: string;
  /** Record the decision the Desk would have made at this date, from the sessions before it, and score it on what followed. */
  backtest?: string;
  minUsd: string;
}

/** `desk regret`: score the recorded decisions on the month that followed, and say how the expectations held. */
export async function regretCommand(o: RegretCommandOptions): Promise<string> {
  const ledger = openLedger(o.dbPath);
  const regret = openRegret(o.regretPath);
  try {
    const sessions = replaySessionsFromLedger(ledger, loadSnapshot(o.pricesPath), "0000", "9999", { personFromBranch: o.sampleMode || o.personFromBranch });
    if (sessions.length === 0) return "No sessions in the ledger yet. Run `desk card` (or `desk ingest`) first.";
    let note = "";
    if (o.backtest) {
      const splitMs = Date.parse(o.backtest);
      if (Number.isNaN(splitMs)) return `--backtest must be a date such as 2026-10-01, not ${o.backtest}.`;
      const history = sessions.filter((s) => s.startMs < splitMs);
      if (history.length === 0 || !sessions.some((s) => s.startMs >= splitMs)) return "The date leaves no sessions on one side: choose a date inside the ledger, with sessions before it to decide from and after it to be judged on.";
      const current = parsePolicyYaml(readFileSync(o.policyPath, "utf8"));
      const { port, label } = choosePort(o);
      const result = await propose({ current, sessions: history, splitMs, targetMinMicros: usdToMicros(o.minUsd, "--min-usd"), port, trace: new MemoryTrace(), budget: new Budget(DRAFT_LIVE) });
      const { recorded } = recordDecision(regret, { decisionId: decisionId(result, splitMs), requestId: null, decidedAtMs: splitMs, decision: "proposed", history, options: optionsOf(current, result) });
      note = `${recorded ? "Recorded" : "Already recorded"} a backtest: the decision the Desk would have put to the owner on ${o.backtest.slice(0, 10)}, drafted from ${history.length} earlier sessions (${label}). It was made after the fact on a ledger that already holds the month that followed, so it shows how the method behaves, not what an owner decided.\n\n`;
    }
    return note + renderRegret(scoreDecisions(regret, sessions));
  } finally {
    regret.close();
    ledger.close();
  }
}
