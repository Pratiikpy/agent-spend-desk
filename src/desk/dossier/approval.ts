import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, hashJson } from "../../runtime/canonical.ts";
import { auditSentences } from "../agents/audit.ts";
import type { ClaimLedger, Sentence } from "../agents/claims.ts";
import type { Envelope } from "../verify/dsse.ts";
import { PAYLOAD_TYPE_APPROVAL } from "../verify/format.ts";
import type { Signer } from "./keys.ts";
import { ensureDossierSchema } from "./schema.ts";
import { signEnvelope } from "./sign.ts";

/**
 * The approval echo (spec 10.3, core M13), after the webhook contract of Microsoft's agent governance toolkit.
 * An approval counts only if its response echoes both the request id and the digest of the exact action, comes
 * from a verified approver the policy permits, arrives before expiry, and the policy and the ledger head are
 * still the ones the card was drawn against. A deny from a verified approver is always honoured. Anything else
 * leaves the action unapproved.
 */
export type ActionKind = "policy_change" | "cap_change" | "shutdown";

export interface Action {
  kind: ActionKind;
  /** A typed description of the exact change: the policy diff, the new cap, or the shutdown target with its process identity. */
  payload: unknown;
}

export function digestOfAction(action: Action): string {
  return hashJson({ kind: action.kind, payload: action.payload });
}

/** Sentences that passed the code Auditor are the only free text a card may show. */
export function auditedSentences(sentences: readonly Sentence[], ledger: ClaimLedger): string[] {
  return auditSentences(sentences, ledger).accepted.map((s) => s.text);
}

export interface ApprovalCard {
  diff: unknown;
  replay: { paused: number; landed_blocked: number; saved_micros: number } | null;
  restrict: { narrows: boolean; grid_size: number } | null;
  dollars_affected_micros: number;
  tasks_affected: number;
  /** Auditor-accepted sentences only; see auditedSentences. */
  claims: string[];
}

export interface ApprovalRequest {
  approvalRequestId: string;
  actionDigest: string;
  policyVersion: string;
  chainVersion: string;
  approvers: string[];
  issuedAt: string;
  expiresAt: string;
  card: ApprovalCard;
}

export interface ApprovalResponse {
  approvalRequestId: string;
  actionDigest: string;
  decision: "approve" | "deny";
}

/** Who is answering. `verified` is set by the local approval session in single-user mode, or by a configured verifier in team mode. */
export interface ApproverSession {
  approver: string;
  verified: boolean;
}

export interface CurrentState {
  policyVersion: string;
  chainVersion: string;
}

export type DeniedReason = "denied_by_approver" | "expired" | "policy_changed" | "chain_moved";
export type RefusedReason = "malformed" | "unknown_request" | "already_decided" | "digest_mismatch" | "approver_unverified" | "approver_not_permitted";

export type Outcome =
  | { status: "approved"; receipt: Envelope; requestId: string }
  | { status: "denied"; reason: DeniedReason }
  | { status: "refused"; reason: RefusedReason };

export interface IssueOptions {
  policyVersion: string;
  chainVersion: string;
  approvers: readonly string[];
  card: ApprovalCard;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function assertCard(card: ApprovalCard): void {
  for (const k of ["dollars_affected_micros", "tasks_affected"] as const) {
    if (!Number.isSafeInteger(card[k]) || card[k] < 0) throw new RangeError(`card.${k} must be a non-negative safe integer`);
  }
  if (!Array.isArray(card.claims) || card.claims.some((c) => typeof c !== "string")) throw new TypeError("card.claims must be Auditor-accepted sentences");
  canonicalJson(card);
}

interface RequestRow {
  approval_request_id: string;
  action_kind: string;
  action_digest: string;
  policy_version: string;
  chain_version: string;
  approvers: string;
  card: string;
  issued_at: string;
  expires_at: string;
  presented_at: string | null;
  evidence_opened_at: string | null;
}

export class ApprovalService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly signer: Signer,
    private readonly now: () => Date = () => new Date(),
  ) {
    ensureDossierSchema(db);
  }

  issue(action: Action, opts: IssueOptions): ApprovalRequest {
    assertCard(opts.card);
    if (opts.approvers.length === 0) throw new RangeError("a request needs at least one permitted approver");
    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) throw new RangeError("ttlMs must be positive and at most 24 hours");
    const issued = this.now();
    const req: ApprovalRequest = {
      approvalRequestId: randomUUID(),
      actionDigest: digestOfAction(action),
      policyVersion: opts.policyVersion,
      chainVersion: opts.chainVersion,
      approvers: [...opts.approvers],
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + ttl).toISOString(),
      card: opts.card,
    };
    this.db
      .prepare("INSERT INTO approval_request (approval_request_id, action_kind, action_digest, policy_version, chain_version, approvers, card, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(req.approvalRequestId, action.kind, req.actionDigest, req.policyVersion, req.chainVersion, canonicalJson(req.approvers), canonicalJson(req.card), req.issuedAt, req.expiresAt);
    return req;
  }

  /** The approver was shown the card. */
  present(requestId: string): void {
    this.db.prepare("UPDATE approval_request SET presented_at = COALESCE(presented_at, ?) WHERE approval_request_id = ?").run(this.now().toISOString(), requestId);
  }

  /** The approver opened the evidence behind the card; used only to measure rubber-stamping. */
  openEvidence(requestId: string): void {
    this.db.prepare("UPDATE approval_request SET evidence_opened_at = COALESCE(evidence_opened_at, ?) WHERE approval_request_id = ?").run(this.now().toISOString(), requestId);
  }

  respond(response: ApprovalResponse, session: ApproverSession, current: CurrentState): Outcome {
    if (
      typeof response !== "object" ||
      response === null ||
      typeof response.approvalRequestId !== "string" ||
      typeof response.actionDigest !== "string" ||
      (response.decision !== "approve" && response.decision !== "deny") ||
      typeof session?.approver !== "string" ||
      session.approver === "" ||
      typeof current?.policyVersion !== "string" ||
      typeof current?.chainVersion !== "string"
    ) {
      return { status: "refused", reason: "malformed" };
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const outcome = this.decide(response, session, current);
      this.db.exec("COMMIT");
      return outcome;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private reject(requestId: string, reason: RefusedReason): Outcome {
    this.db.prepare("INSERT INTO approval_rejected_response (approval_request_id, reason, at) VALUES (?, ?, ?)").run(requestId, reason, this.now().toISOString());
    return { status: "refused", reason };
  }

  private close(requestId: string, decision: "approve" | "deny", reason: string, approver: string | null, receipt: Envelope | null): void {
    this.db
      .prepare("INSERT INTO approval_decision (approval_request_id, decision, reason, approver, decided_at, receipt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(requestId, decision, reason, approver, this.now().toISOString(), receipt ? canonicalJson(receipt) : null);
  }

  private decide(response: ApprovalResponse, session: ApproverSession, current: CurrentState): Outcome {
    const id = response.approvalRequestId;
    const req = this.db.prepare("SELECT * FROM approval_request WHERE approval_request_id = ?").get(id) as RequestRow | undefined;
    if (!req) return { status: "refused", reason: "unknown_request" };
    if (this.db.prepare("SELECT 1 FROM approval_decision WHERE approval_request_id = ?").get(id)) return this.reject(id, "already_decided");
    if (!session.verified) return this.reject(id, "approver_unverified");
    const permitted = JSON.parse(req.approvers) as string[];
    if (!permitted.includes(session.approver)) return this.reject(id, "approver_not_permitted");
    if (response.actionDigest !== req.action_digest) return this.reject(id, "digest_mismatch");
    if (response.decision === "deny") {
      this.close(id, "deny", "denied_by_approver", session.approver, null);
      return { status: "denied", reason: "denied_by_approver" };
    }
    const at = this.now();
    if (at.getTime() >= Date.parse(req.expires_at)) {
      this.close(id, "deny", "expired", null, null);
      return { status: "denied", reason: "expired" };
    }
    if (current.policyVersion !== req.policy_version) {
      this.close(id, "deny", "policy_changed", null, null);
      return { status: "denied", reason: "policy_changed" };
    }
    if (current.chainVersion !== req.chain_version) {
      this.close(id, "deny", "chain_moved", null, null);
      return { status: "denied", reason: "chain_moved" };
    }
    const payload = {
      approval_request_id: id,
      action_digest: req.action_digest,
      policy_version: req.policy_version,
      chain_version: req.chain_version,
      approver: session.approver,
      decision: "approve" as const,
      decided_at: at.toISOString(),
    };
    const receipt = signEnvelope(PAYLOAD_TYPE_APPROVAL, new TextEncoder().encode(canonicalJson(payload)), this.signer);
    this.close(id, "approve", "approved", session.approver, receipt);
    return { status: "approved", receipt, requestId: id };
  }

  /** A stored receipt, for bundling into a dossier. */
  receiptOf(requestId: string): Envelope | undefined {
    const row = this.db.prepare("SELECT receipt FROM approval_decision WHERE approval_request_id = ? AND decision = 'approve'").get(requestId) as { receipt: string } | undefined;
    return row ? (JSON.parse(row.receipt) as Envelope) : undefined;
  }

  /** Core W10-2: how fast approvals are given and how many are given without opening the evidence. */
  stats(sinceIso = "0000"): { decided: number; approved: number; medianSecondsToDecide: number | null; approvedWithoutEvidenceShare: number | null } {
    const rows = this.db
      .prepare(
        `SELECT d.decision, d.decided_at, r.presented_at, r.evidence_opened_at
         FROM approval_decision d JOIN approval_request r USING (approval_request_id) WHERE d.decided_at >= ?`,
      )
      .all(sinceIso) as unknown as { decision: string; decided_at: string; presented_at: string | null; evidence_opened_at: string | null }[];
    const approved = rows.filter((r) => r.decision === "approve");
    const secs = approved.filter((r) => r.presented_at).map((r) => (Date.parse(r.decided_at) - Date.parse(r.presented_at as string)) / 1000).sort((a, b) => a - b);
    const median = secs.length === 0 ? null : secs.length % 2 === 1 ? (secs[(secs.length - 1) / 2] as number) : ((secs[secs.length / 2 - 1] as number) + (secs[secs.length / 2] as number)) / 2;
    const without = approved.filter((r) => !r.evidence_opened_at).length;
    return { decided: rows.length, approved: approved.length, medianSecondsToDecide: median, approvedWithoutEvidenceShare: approved.length === 0 ? null : without / approved.length };
  }
}
