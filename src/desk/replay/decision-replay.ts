import { existsSync, readFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";

import { canonicalJson, sha256Hex } from "../../runtime/canonical.ts";
import type { Signer } from "../dossier/keys.ts";
import { signEnvelope } from "../dossier/sign.ts";
import type { Ledger } from "../ledger/db.ts";
import { parsePolicy } from "../policy/parse.ts";
import { checkEnvelope, loadPins, type Envelope } from "../verify/dsse.ts";
import { FILE_MANIFEST, FILE_STATEMENT, HEX64, policyPath, rowsPath, STATEMENT_TYPE, type Row } from "../verify/format.ts";
import { readBundleDir } from "../verify/read-dir.ts";
import { verifyBundle } from "../verify/verify.ts";
import {
  compareStages, DECISION_PAYLOAD_TYPE, DECISION_PREDICATE, replayPort, ReplayDivergence, runPipeline, sessionsDigest, sessionsFromRows, STAGE_ORDER, stagesOf,
  type DecisionRecord, type StageId,
} from "./decision.ts";

export interface DecisionStatement {
  _type: typeof STATEMENT_TYPE;
  subject: { name: "dossier"; digest: { sha256: string } }[];
  predicateType: typeof DECISION_PREDICATE;
  predicate: { action_digest: string; decision: DecisionRecord };
}

/** Sign a decision record and bind it to one dossier: the subject is the digest of that dossier's manifest, and the predicate carries its action digest. */
export function signDecision(record: DecisionRecord, manifest: Uint8Array, actionDigest: string, signer: Signer): Envelope {
  const statement: DecisionStatement = {
    _type: STATEMENT_TYPE,
    subject: [{ name: "dossier", digest: { sha256: sha256Hex(manifest) } }],
    predicateType: DECISION_PREDICATE,
    predicate: { action_digest: actionDigest, decision: record },
  };
  return signEnvelope(DECISION_PAYLOAD_TYPE, new TextEncoder().encode(canonicalJson(statement)), signer);
}

export const decisionPathFor = (bundleDir: string): string => `${bundleDir.replace(/[\\/]+$/, "")}.decision.dsse.json`;
export const pinsPathFor = (bundleDir: string): string => `${bundleDir.replace(/[\\/]+$/, "")}.pins.json`;

export type ReplayVerdictKind = "identical" | "diverged" | "unverifiable" | "recomputed_only";

export interface StageLine {
  id: StageId;
  status: "identical" | "diverged" | "not_compared";
  digest: string | null;
}

export interface ReplayVerdict {
  verdict: ReplayVerdictKind;
  kind: string | null;
  manifestDigest: string | null;
  stages: StageLine[];
  divergedStage: StageId | null;
  lines: string[];
  exit: 0 | 1;
}

export interface ReplayOptions {
  bundleDir: string;
  pinsPath?: string;
  decisionPath?: string;
}

const rowsOf = (files: ReadonlyMap<string, Uint8Array>, stream: string): Row[] => {
  const raw = files.get(rowsPath(stream));
  if (!raw) return [];
  return new TextDecoder().decode(raw).split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Row);
};

/** The dossier's own statement: its kind and the action digest the approval covers. Read only after the bundle has verified. */
function statementOf(files: ReadonlyMap<string, Uint8Array>): { kind: string | null; actionDigest: string | null } {
  try {
    const env = JSON.parse(new TextDecoder().decode(files.get(FILE_STATEMENT))) as { payload: string };
    const st = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")) as { predicate?: { kind?: string; action_digest?: string } };
    return { kind: st.predicate?.kind ?? null, actionDigest: st.predicate?.action_digest ?? null };
  } catch {
    return { kind: null, actionDigest: null };
  }
}

function stop(verdict: ReplayVerdictKind, kind: string | null, manifestDigest: string | null, lines: string[], head: string): ReplayVerdict {
  return { verdict, kind, manifestDigest, stages: [], divergedStage: null, lines: [...lines, head], exit: verdict === "recomputed_only" ? 0 : 1 };
}

const short = (d: string | null): string => (d === null ? "none" : `${d.slice(0, 19)}`);

/**
 * Replay a dossier's decision. The dossier is verified first (every level from the signature to the recomputation of each cited figure); then, for a policy change, the
 * signed decision record is checked against the dossier and the pipeline is run again from the dossier's own sessions and policy, offline, with each model request served
 * from the recording. The result is `identical` only if every attested stage is reproduced byte for byte and the policy it ends in is the one the approval covers.
 */
export async function replayDecision(o: ReplayOptions): Promise<ReplayVerdict> {
  const lines: string[] = [`Replaying the decision in ${o.bundleDir}`];
  let files: Map<string, Uint8Array>;
  try {
    files = readBundleDir(o.bundleDir);
  } catch (e) {
    return stop("unverifiable", null, null, lines, `V9-D: not run. The dossier could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  const pinsPath = o.pinsPath ?? pinsPathFor(o.bundleDir);
  if (!existsSync(pinsPath)) return stop("unverifiable", null, null, lines, `V9-D: not run. The signer's pins are missing (${pinsPath}); pass them with --pins.`);
  const pinsRaw = JSON.parse(readFileSync(pinsPath, "utf8")) as unknown;
  const pins = loadPins(pinsRaw);
  if (!pins.ok) return stop("unverifiable", null, null, lines, `V9-D: not run. The pins are not readable: ${pins.reason}`);

  const report = verifyBundle(files, { pins: pinsRaw });
  const manifest = files.get(FILE_MANIFEST);
  const manifestDigest = manifest ? `sha256:${sha256Hex(manifest)}` : null;
  const { kind, actionDigest } = statementOf(files);
  if (report.overall !== "PASS") {
    const why = report.levels.flatMap((l) => l.findings.map((f) => `${l.id} ${f.code}`)).slice(0, 3).join(", ");
    return stop("unverifiable", kind, manifestDigest, [...lines, `  dossier: does not verify (${report.overall}${why ? `: ${why}` : ""})`], "V9-D: not run. A dossier that does not verify is not replayed.");
  }
  lines.push(`  dossier: verified at every level (${report.levels.length} levels), kind ${kind ?? "unknown"}, manifest ${short(manifestDigest)}`);

  const decisionPath = o.decisionPath ?? decisionPathFor(o.bundleDir);
  if (kind !== "policy_change" || !existsSync(decisionPath)) {
    const why =
      kind !== "policy_change"
        ? `A ${kind ?? "this kind of"} dossier has no agent stage to replay: its sentences are written by code from the figures, and every figure was recomputed from the log rows when it verified.`
        : `This policy-change dossier has no decision record beside it (${decisionPath}), so the Drafter's and the Attacker's stages cannot be replayed. Dossiers issued before decisions were recorded have none.`;
    return { verdict: "recomputed_only", kind, manifestDigest, stages: [], divergedStage: null, lines: [...lines, `  ${why}`, "V9-D: not applicable. Recomputed from the rows (V6-D to V8-D) only."], exit: 0 };
  }

  // The record: signed by a pinned key, bound to this dossier and to the action the approval covers.
  const envelope = JSON.parse(readFileSync(decisionPath, "utf8")) as unknown;
  const checked = checkEnvelope(envelope, DECISION_PAYLOAD_TYPE, pins.keys as ReadonlyMap<string, KeyObject>);
  if (!checked.ok) return stop("unverifiable", kind, manifestDigest, lines, `V9-D: not run. The decision record's signature does not verify: ${checked.code}: ${checked.detail}`);
  const statement = JSON.parse(Buffer.from(checked.payload).toString("utf8")) as DecisionStatement;
  if (statement.predicateType !== DECISION_PREDICATE || statement.predicate?.decision?.version !== 1) return stop("unverifiable", kind, manifestDigest, lines, "V9-D: not run. The decision record is not a decision record this version reads.");
  if (statement.subject?.[0]?.digest?.sha256 !== sha256Hex(manifest ?? new Uint8Array())) return stop("unverifiable", kind, manifestDigest, lines, "V9-D: not run. The decision record was signed for a different dossier.");
  if (statement.predicate.action_digest !== actionDigest) return stop("unverifiable", kind, manifestDigest, lines, "V9-D: not run. The decision record names a different action than the one the dossier covers.");
  lines.push(`  decision record: signed by pinned key ${checked.keyid.slice(0, 16)}, bound to this dossier and its action ${short(actionDigest)}`);
  const rec = statement.predicate.decision;

  // The inputs: the sessions and policy exactly as the dossier carries them.
  const training = rowsOf(files, "replay_training");
  const heldOut = rowsOf(files, "replay_heldout");
  if (sessionsDigest(training, heldOut) !== rec.inputs.sessionsDigest) return stop("unverifiable", kind, manifestDigest, lines, "V9-D: not run. The sessions in the dossier are not the sessions the decision record names.");
  const currentHex = rec.inputs.currentPolicyId.replace(/^sha256:/, "");
  const proposedHex = rec.inputs.proposedPolicyId.replace(/^sha256:/, "");
  if (!HEX64.test(currentHex) || !HEX64.test(proposedHex)) return stop("unverifiable", kind, manifestDigest, lines, "V9-D: not run. The decision record names a policy by something other than its digest.");
  const currentDoc = files.get(policyPath(currentHex));
  if (!currentDoc || !files.get(policyPath(proposedHex))) return stop("unverifiable", kind, manifestDigest, lines, "V9-D: not run. A policy the decision names is not in the dossier.");
  const current = parsePolicy(JSON.parse(new TextDecoder().decode(currentDoc)));
  lines.push(`  inputs: ${rec.inputs.trainingSessions} sessions to draft from, ${rec.inputs.heldOutSessions} held out, target ${rec.inputs.targetMinMicros} micro-dollars, ${rec.calls.length} recorded model request${rec.calls.length === 1 ? "" : "s"} (${rec.brain} brain)`);

  let stages;
  try {
    const result = await runPipeline({
      current, sessions: sessionsFromRows(training, heldOut), splitMs: rec.inputs.splitMs, targetMinMicros: rec.inputs.targetMinMicros, port: rec.brain === "model" ? replayPort(rec.calls) : null, budget: rec.budget,
    });
    stages = stagesOf(result);
  } catch (e) {
    const why = e instanceof ReplayDivergence ? e.message : `the pipeline stopped: ${e instanceof Error ? e.message : String(e)}`;
    const lineups: StageLine[] = STAGE_ORDER.map((id) => ({ id, status: "not_compared", digest: null }));
    return { verdict: "diverged", kind, manifestDigest, stages: lineups, divergedStage: null, lines: [...lines, `  ${why}`, "V9-D: FAIL. The replay diverged before it reached a stage to compare."], exit: 1 };
  }

  const out: StageLine[] = [];
  let diverged: StageId | null = null;
  for (const want of rec.stages) {
    if (diverged !== null) {
      out.push({ id: want.id, status: "not_compared", digest: null });
      continue;
    }
    const one = compareStages([want], stages);
    if (one.same) {
      out.push({ id: want.id, status: "identical", digest: want.digest });
      lines.push(`  stage ${want.id.padEnd(9)} identical  ${short(want.digest)}`);
    } else {
      diverged = want.id;
      out.push({ id: want.id, status: "diverged", digest: want.digest });
      lines.push(`  stage ${want.id.padEnd(9)} DIVERGED`);
      for (const d of one.differences) lines.push(`    ${d.path}: recorded ${JSON.stringify(d.recorded)}, recomputed ${JSON.stringify(d.recomputed)}`);
    }
  }
  if (diverged !== null) {
    return { verdict: "diverged", kind, manifestDigest, stages: out, divergedStage: diverged, lines: [...lines, `V9-D: FAIL. The replay diverged at stage ${diverged}; the later stages were not compared.`], exit: 1 };
  }
  const final = stages.find((s) => s.id === "final")?.value as { policyHash?: string } | undefined;
  if (final?.policyHash !== rec.inputs.proposedPolicyId) {
    return { verdict: "diverged", kind, manifestDigest, stages: out, divergedStage: "final", lines: [...lines, "V9-D: FAIL. The policy the replay ends in is not the policy the approval covers."], exit: 1 };
  }
  return {
    verdict: "identical", kind, manifestDigest, stages: out, divergedStage: null,
    lines: [...lines, `V9-D: byte-identical reproduction of ${out.length} stages offline. The policy the replay ends in, ${short(final.policyHash ?? null)}, is the one the approval covers.`], exit: 0,
  };
}

/** Keep a replay's result in the ledger, so that a reviewer can see what was replayed, when, and with what outcome. */
export function recordReplay(db: Ledger, v: ReplayVerdict, at: string = new Date().toISOString()): void {
  db.prepare("INSERT INTO dossier_replay (dossier_digest, kind, verdict, diverged_stage, stages_checked, replayed_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    v.manifestDigest ?? "unknown", v.kind, v.verdict, v.divergedStage, v.stages.filter((s) => s.status !== "not_compared").length, at,
  );
}
