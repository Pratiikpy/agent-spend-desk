import { baselineReproduction, withheldNotice } from "../replay/reproduction.ts";
import { readFileSync } from "node:fs";

import { Budget, DRAFT_LIVE } from "../agents/budget.ts";
import { CassettePort, portFromEnv, RecordingPort, ReplayOrRecordPort, type ModelPort } from "../agents/model.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { openLedger, type Ledger } from "../ledger/db.ts";
import { OwnerMemory } from "../engines/memory.ts";
import { citePrecedents } from "../precedent/cite.ts";
import type { Policy } from "../policy/types.ts";
import { parsePolicyYaml, usdToMicros } from "../policy/parse.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { describeRecord, proposalDecisionRecord, writeDecisionRecord } from "../decision/from-proposal.ts";
import { propose, renderProposal, writeProposal } from "./run.ts";
import { buildPolicyChangePack } from "../dossier/policy-change.ts";
import { issueApproval, type DossierPaths } from "../dossier/command.ts";
import { recordProposal } from "../regret/command.ts";

export interface ProposeCommandOptions {
  dbPath: string;
  pricesPath: string;
  /** The policy in force today. */
  policyPath: string;
  /** ISO date; sessions before it train the draft and later ones are held out. Default: halfway through the ledger. */
  split?: string;
  minUsd: string;
  cassetteDir: string;
  /** Record live model replies into the cassette folder. */
  record: boolean;
  sampleMode: boolean;
  /** Read the person from the branch prefix; see BridgeOptions. */
  personFromBranch: boolean;
  /** Draft from, and check on, only the sessions in this window (inclusive ISO timestamps). Default: the whole ledger. */
  window?: { sinceIso: string; untilIso: string };
  outDir: string;
  /** Issue an approval request and prepare the signed dossier. */
  dossier?: DossierPaths;
  /** Where the decision regret ledger keeps what was expected of each option. Written only when an approval request is issued. */
  regretPath?: string;
  /** Where the owner's memory is kept. With it, the proposal is shown the closest earlier policy changes and what they did (DF-105). */
  memoryDir?: string;
  /** Read the proposal as if the memory engine were off (`--ablate hmem`): the section says no memory was available, so the ablation shows what the memory changes. */
  memoryOff?: boolean;
  env: Record<string, string | undefined>;
}

/** Choose the model route: cassettes in SAMPLE_MODE, the live model otherwise, no model (the rule brain) when none is configured. */
export function choosePort(o: Pick<ProposeCommandOptions, "sampleMode" | "record" | "cassetteDir" | "env"> & { backoffMs?: readonly number[]; reuse?: boolean }): { port: ModelPort | null; label: string } {
  if (o.sampleMode) return { port: new CassettePort(o.cassetteDir), label: "recorded replies (SAMPLE_MODE)" };
  try {
    const live = portFromEnv({ ...o.env, SAMPLE_MODE: "false" }, o.cassetteDir, o.backoffMs ? { backoffMs: o.backoffMs } : {});
    // `reuse` answers a request already on file from the file and asks the model only for the rest, which is what lets arms that share a request share its reply.
    if (o.record && o.reuse) return { port: new ReplayOrRecordPort(live, o.cassetteDir), label: "live model, recording cassettes and reusing a request already recorded" };
    return o.record ? { port: new RecordingPort(live, o.cassetteDir), label: "live model, recording cassettes" } : { port: live, label: "live model" };
  } catch (e) {
    return { port: null, label: `no model (${(e as Error).message.split(":")[0]}): the rule brain drafts` };
  }
}

/** The precedents a proposal is shown, or the plain statement that there are none. Never stops a draft: a memory that cannot be opened is said so. */
async function precedentSection(db: Ledger, current: Policy, proposed: Policy, memoryDir: string | undefined, off: boolean | undefined): Promise<string> {
  if (memoryDir === undefined) return "";
  let memory: OwnerMemory | null = null;
  try {
    if (off !== true) memory = await OwnerMemory.open({ persistDir: memoryDir });
  } catch {
    memory = null;
  }
  const c = citePrecedents(db, memory, { before: current, after: proposed }, Date.now());
  return `Earlier changes like this one:\n${c.citations.length === 0 ? `  ${c.note}` : c.citations.map((x) => `  ${x.line}`).join("\n")}\n`;
}

export async function proposeCommand(o: ProposeCommandOptions): Promise<string> {
  const db = openLedger(o.dbPath);
  try {
    const sessions = replaySessionsFromLedger(db, loadSnapshot(o.pricesPath), o.window?.sinceIso ?? "0000", o.window?.untilIso ?? "9999", { personFromBranch: o.sampleMode || o.personFromBranch });
    if (sessions.length === 0) return "No sessions in the ledger yet. Run `desk card` (or `desk ingest`) first.";
    const reproduction = baselineReproduction(db, sessions, o.window?.sinceIso ?? "0000", o.window?.untilIso ?? "9999");
    if (!reproduction.reproduces) return withheldNotice(reproduction);
    const first = sessions[0]!.startMs;
    const last = sessions[sessions.length - 1]!.startMs;
    let splitMs = first + Math.floor((last - first) / 2);
    if (o.split) {
      splitMs = Date.parse(o.split);
      if (Number.isNaN(splitMs)) return `--split must be a date such as 2026-10-01, got "${o.split}".`;
    } else {
      splitMs = Math.floor(splitMs / 86_400_000) * 86_400_000;
    }
    if (!sessions.some((s) => s.startMs < splitMs) || !sessions.some((s) => s.startMs >= splitMs)) {
      return "The split leaves no sessions on one side. Choose a date inside the ledger's range, so there is a period to draft from and a later one to check on.";
    }
    const current = parsePolicyYaml(readFileSync(o.policyPath, "utf8"));
    const { port, label } = choosePort(o);
    const trace = new MemoryTrace();
    const result = await propose({ current, sessions, splitMs, targetMinMicros: usdToMicros(o.minUsd, "--min-usd"), port, trace, budget: new Budget(DRAFT_LIVE) });
    const files = writeProposal(result, o.outDir);
    const record = proposalDecisionRecord({ result, sessions, splitMs, now: new Date() });
    const recordLine = describeRecord(record, writeDecisionRecord(record, o.outDir));
    let tail = "";
    if (o.dossier) {
      if (!result.restrict.narrows) {
        tail = "\n" + "\n" + "No approval request was issued: the proposal does not only narrow the current policy.";
      } else {
        const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
        const pack = buildPolicyChangePack({
          current,
          proposed: result.final,
          trainingSessions: sessions.filter((s) => s.startMs < splitMs),
          heldOutSessions: sessions.filter((s) => s.startMs >= splitMs),
          tenant: "local",
          period: { from: day(sessions[0]!.startMs), to: day(sessions[sessions.length - 1]!.startMs) },
          createdAt: new Date().toISOString(),
          unresolvedEvasions: result.hardened.unresolved,
        });
        const issued = issueApproval(pack, o.dossier);
        if (o.regretPath) recordProposal(o.regretPath, { requestId: issued.requestId, current, result, sessions });
        tail = "\n" + "\n" + issued.text;
      }
    }
    const precedents = await precedentSection(db, current, result.final, o.memoryDir, o.memoryOff);
    return `${renderProposal(result, { sessions, splitMs })}\n${precedents}model route: ${label}\nwritten: ${files.policyPath}, ${files.tracePath}\n${recordLine}${tail}`;
  } finally {
    db.close();
  }
}
