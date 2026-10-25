import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Budget, DRAFT_LIVE } from "../agents/budget.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { approve, issueApproval, type DossierPaths } from "../dossier/command.ts";
import { loadSigner } from "../dossier/keys.ts";
import { buildPolicyChangePack } from "../dossier/policy-change.ts";
import type { Ledger } from "../ledger/db.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { propose } from "../propose/run.ts";
import { attachDecision, type DecisionRecord } from "../replay/decision.ts";
import { decisionPathFor, replayDecision, signDecision } from "../replay/decision-replay.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { FILE_MANIFEST } from "../verify/format.ts";
import { readBundleDir } from "../verify/read-dir.ts";

/**
 * A decision on the sample, approved and replayed (DF-110). The proposal is made on the sample's sessions, approved by echoing its digest, and its decision is replayed from
 * the dossier alone: every stage must be reproduced. Then the record is changed in three ways that must each be refused: a byte of the signed file, a stage altered and signed
 * again with the same key, and a record signed for another dossier. A replay that accepted a changed record would show nothing by accepting the true one.
 */
export async function decisionProve(db: Ledger, prices: string, policyFile: string): Promise<{ ok: boolean; detail: string }> {
  const sessions = replaySessionsFromLedger(db, loadSnapshot(prices), "0000", "9999", { personFromBranch: true });
  const current = parsePolicyYaml(readFileSync(policyFile, "utf8"));
  const splitMs = Date.UTC(2026, 9, 1);
  const targetMinMicros = 2_000_000;
  const training = sessions.filter((s) => s.startMs < splitMs);
  const heldOut = sessions.filter((s) => s.startMs >= splitMs);
  const result = await propose({ current, sessions, splitMs, targetMinMicros, port: null, trace: new MemoryTrace(), budget: new Budget(DRAFT_LIVE) });
  const built = buildPolicyChangePack({ current, proposed: result.final, trainingSessions: training, heldOutSessions: heldOut, tenant: "prove", period: { from: "2026-09-01", to: "2026-10-31" }, createdAt: "2026-10-26T00:00:00Z", unresolvedEvasions: result.hardened.unresolved });
  const pack = await attachDecision(built, { current, splitMs, targetMinMicros, brain: "rules", calls: [], result });
  if (!pack.decision) return { ok: false, detail: `the sample's decision was not recorded: ${pack.decisionNote ?? "no reason given"}` };

  const root = mkdtempSync(join(tmpdir(), "desk-prove-decision-"));
  try {
    const paths: DossierPaths = { dbPath: join(root, "d.db"), pendingDir: join(root, "pending"), outDir: join(root, "out"), keyPath: join(root, "keys", "signer.pem") };
    const issued = issueApproval(pack, paths);
    const done = approve(issued.requestId, issued.actionDigest, paths);
    if (!done.ok || !done.dir) return { ok: false, detail: "the sample's proposal could not be approved into a dossier" };
    const faithful = await replayDecision({ bundleDir: done.dir });
    if (faithful.verdict !== "identical") return { ok: false, detail: `the approved decision did not replay: ${faithful.verdict}${faithful.divergedStage ? ` at stage ${faithful.divergedStage}` : ""}` };

    const decision = decisionPathFor(done.dir);
    const original = readFileSync(decision, "utf8");
    const signer = loadSigner(paths.keyPath);
    const manifest = readBundleDir(done.dir).get(FILE_MANIFEST) as Uint8Array;

    const at = original.indexOf('"payload": "') + 20;
    writeFileSync(decision, `${original.slice(0, at)}${original[at] === "A" ? "B" : "A"}${original.slice(at + 1)}`);
    const flipped = await replayDecision({ bundleDir: done.dir });

    const altered = JSON.parse(JSON.stringify(pack.decision)) as DecisionRecord;
    altered.stages.find((s) => s.id === "findings")!.value = [];
    writeFileSync(decision, JSON.stringify(signDecision(altered, manifest, issued.actionDigest, signer)));
    const edited = await replayDecision({ bundleDir: done.dir });

    writeFileSync(decision, JSON.stringify(signDecision(pack.decision, new TextEncoder().encode("another dossier's manifest"), issued.actionDigest, signer)));
    const other = await replayDecision({ bundleDir: done.dir });

    const refused = flipped.verdict === "unverifiable" && edited.verdict === "diverged" && edited.divergedStage === "findings" && other.verdict === "unverifiable";
    if (!refused) return { ok: false, detail: `a changed record was not refused: changed byte ${flipped.verdict}, altered stage ${edited.verdict}, other dossier ${other.verdict}` };
    return {
      ok: true,
      detail: `${faithful.stages.length} stages of an approved proposal on the sample replay byte for byte from the dossier alone; a changed byte of the signed record, a stage altered and signed again, and a record signed for another dossier are each refused`,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
