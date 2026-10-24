import { readFileSync } from "node:fs";

import { Budget, DRAFT_LIVE } from "../agents/budget.ts";
import { CassettePort, portFromEnv, RecordingPort, type ModelPort } from "../agents/model.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { openLedger } from "../ledger/db.ts";
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
  outDir: string;
  /** Issue an approval request and prepare the signed dossier. */
  dossier?: DossierPaths;
  /** Where the decision regret ledger keeps what was expected of each option. Written only when an approval request is issued. */
  regretPath?: string;
  env: Record<string, string | undefined>;
}

/** Choose the model route: cassettes in SAMPLE_MODE, the live model otherwise, no model (the rule brain) when none is configured. */
export function choosePort(o: Pick<ProposeCommandOptions, "sampleMode" | "record" | "cassetteDir" | "env"> & { backoffMs?: readonly number[] }): { port: ModelPort | null; label: string } {
  if (o.sampleMode) return { port: new CassettePort(o.cassetteDir), label: "recorded replies (SAMPLE_MODE)" };
  try {
    const live = portFromEnv({ ...o.env, SAMPLE_MODE: "false" }, o.cassetteDir, o.backoffMs ? { backoffMs: o.backoffMs } : {});
    return o.record ? { port: new RecordingPort(live, o.cassetteDir), label: "live model, recording cassettes" } : { port: live, label: "live model" };
  } catch (e) {
    return { port: null, label: `no model (${(e as Error).message.split(":")[0]}): the rule brain drafts` };
  }
}

export async function proposeCommand(o: ProposeCommandOptions): Promise<string> {
  const db = openLedger(o.dbPath);
  try {
    const sessions = replaySessionsFromLedger(db, loadSnapshot(o.pricesPath), "0000", "9999", { personFromBranch: o.sampleMode || o.personFromBranch });
    if (sessions.length === 0) return "No sessions in the ledger yet. Run `desk card` (or `desk ingest`) first.";
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
        });
        const issued = issueApproval(pack, o.dossier);
        if (o.regretPath) recordProposal(o.regretPath, { requestId: issued.requestId, current, result, sessions });
        tail = "\n" + "\n" + issued.text;
      }
    }
    return `${renderProposal(result, { sessions, splitMs })}\nmodel route: ${label}\nwritten: ${files.policyPath}, ${files.tracePath}\n${recordLine}${tail}`;
  } finally {
    db.close();
  }
}
