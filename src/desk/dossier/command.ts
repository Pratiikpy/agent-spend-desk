import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ApprovalService, digestOfAction, type Action } from "./approval.ts";
import { buildDossier } from "./build.ts";
import { writeBundleDir } from "./bundle-io.ts";
import { loadOrCreateSigner, pinsFor, type Signer } from "./keys.ts";
import type { PolicyChangePack } from "./policy-change.ts";
import { formatReport } from "../verify/report.ts";
import { verifyBundle } from "../verify/verify.ts";

export interface IssueResult {
  requestId: string;
  actionDigest: string;
  packDir: string;
  text: string;
}

export interface DossierPaths {
  dbPath: string;
  pendingDir: string;
  outDir: string;
  keyPath?: string;
}

function signer(paths: DossierPaths): { signer: Signer; note: string | null } {
  const s = loadOrCreateSigner(paths.keyPath);
  return { signer: s.signer, note: s.created ? `created a signing key (Ed25519, key id ${s.signer.keyid.slice(0, 16)}); it stays outside the repository${s.permissionsRestricted ? "" : "; its file permissions could not be narrowed on this system"}` : null };
}

/** Ask the owner to approve a policy change: store what the dossier will need and print the card with the digest to echo back. */
export function issueApproval(pack: PolicyChangePack, paths: DossierPaths, now: () => Date = () => new Date()): IssueResult {
  const { signer: sg, note } = signer(paths);
  mkdirSync(paths.pendingDir, { recursive: true });
  const db = new DatabaseSync(paths.dbPath);
  try {
    const svc = new ApprovalService(db, sg, now);
    const action: Action = { kind: "policy_change", payload: { from: pack.currentId, to: pack.proposedId } };
    const chain = pack.log.length > 0 ? pack.log[pack.log.length - 1]!.row_hash : "empty";
    const req = svc.issue(action, { policyVersion: pack.currentId, chainVersion: chain, approvers: ["owner"], card: pack.card, ttlMs: 24 * 60 * 60 * 1000 });
    svc.present(req.approvalRequestId);
    const packDir = join(paths.pendingDir, req.approvalRequestId);
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "pack.json"), JSON.stringify(pack));
    const lines = [
      "Approval needed: a policy change.",
      ...pack.card.claims.map((c) => `  ${c}`),
      `  rules added: ${pack.ruleIdsAdded.join(", ") || "none"}`,
      `  restrict check: ${pack.card.restrict?.narrows ? `narrows only, over all ${pack.card.restrict.grid_size} cells` : "WIDENS: do not approve"}`,
      "",
      `request ${req.approvalRequestId}`,
      `action digest ${req.actionDigest}`,
      `approve by echoing the digest:  desk approve ${req.approvalRequestId} ${req.actionDigest}`,
      `the request expires ${req.expiresAt}`,
    ];
    if (note) lines.push("", note);
    return { requestId: req.approvalRequestId, actionDigest: req.actionDigest, packDir, text: lines.join("\n") };
  } finally {
    db.close();
  }
}

/** Approve by echoing the digest. On approval, build the signed dossier, write it, and verify it with the verifier. */
export function approve(requestId: string, digest: string, paths: DossierPaths, now: () => Date = () => new Date()): { ok: boolean; text: string; dir?: string } {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) return { ok: false, text: "That is not a request id." };
  let pack: PolicyChangePack;
  try {
    pack = JSON.parse(readFileSync(join(paths.pendingDir, requestId, "pack.json"), "utf8")) as PolicyChangePack;
  } catch {
    return { ok: false, text: `No pending request ${requestId}. Run \`desk propose --dossier\` first.` };
  }
  const { signer: sg } = signer(paths);
  const db = new DatabaseSync(paths.dbPath);
  try {
    const svc = new ApprovalService(db, sg, now);
    const chain = pack.log.length > 0 ? pack.log[pack.log.length - 1]!.row_hash : "empty";
    const outcome = svc.respond({ approvalRequestId: requestId, actionDigest: digest, decision: "approve" }, { approver: "owner", verified: true }, { policyVersion: pack.currentId, chainVersion: chain });
    if (outcome.status === "refused") return { ok: false, text: `Not approved: ${outcome.reason.replaceAll("_", " ")}. Nothing was changed.` };
    if (outcome.status === "denied") return { ok: false, text: `Not approved: ${outcome.reason.replaceAll("_", " ")}. Nothing was changed.` };
    const built = buildDossier({
      ...pack.meta,
      log: pack.log,
      claims: pack.claims,
      sentences: pack.sentences,
      policies: pack.policies,
      approvals: [{ requestId, envelope: outcome.receipt }],
      actionDigest: digest,
      signer: sg,
    });
    const dir = join(paths.outDir, requestId.slice(0, 8));
    writeBundleDir(built.files, dir);
    // The pins file sits beside the bundle, never inside it: the verifier refuses a file the manifest does not list.
    const pinsFile = join(paths.outDir, `${requestId.slice(0, 8)}.pins.json`);
    writeFileSync(pinsFile, JSON.stringify(pinsFor(sg), null, 2) + "\n");
    const report = verifyBundle(built.files, { pins: pinsFor(sg) });
    return { ok: report.overall === "PASS", dir, text: `Approved. Dossier written to ${dir}\n\n${formatReport(report, dir)}\n\nCheck it again, offline, with: node src/desk/verify/main.ts ${dir} --pins ${pinsFile}` };
  } finally {
    db.close();
  }
}

export { digestOfAction };
