import type { DatabaseSync } from "node:sqlite";

import type { ApprovalCard } from "../dossier/approval.ts";

/**
 * How approvals are made (DF-049). The Desk measures how fast an owner decides and how often the evidence behind a card was
 * opened first, so that a rubber stamp shows up as a number. It does not claim that a card improves anyone's accuracy.
 *
 * A request counts in the period in which it was decided. A request still open is `waiting`; one that ran out its time
 * without an answer is `unanswered` and is not a decision. A response that was refused (a wrong digest, an unknown request)
 * is not a decision either; it is counted apart, because a changed digest is exactly what the echo exists to catch.
 */
export interface ApprovalHabit {
  decisions: number;
  approved: number;
  denied: number;
  /** Denials by why: the approver said no, the request expired, the policy changed, or the log moved on. */
  deniedBecause: Record<string, number>;
  /** Median seconds from the card being shown to the decision, over decisions of cards that were shown. */
  medianSecondsToDecide: number | null;
  /** The share approved within ten seconds of being shown, which is faster than the evidence can be read. */
  quickShare: number | null;
  /** The share approved with no record of the evidence being opened before the decision. */
  withoutEvidenceShare: number | null;
  /** Requests whose time ran out with no answer. */
  unanswered: number;
  /** Requests still inside their time. */
  waiting: number;
  /** Responses refused: a digest that did not match, an unknown or already decided request, an approver not permitted. */
  refusedResponses: Record<string, number>;
}

/** Ten seconds is the line under which a card cannot have been read: a card is several sentences and four numbers. */
export const QUICK_SECONDS = 10;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};

const has = (db: DatabaseSync, table: string): boolean => ((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { n: number }).n ?? 0) > 0;

/** The habit over decisions made in [sinceIso, untilIso). Null when the database holds no approvals table, which is not the same as no approvals. */
export function approvalHabit(db: DatabaseSync, sinceIso: string, untilIso: string, nowIso: string): ApprovalHabit | null {
  if (!has(db, "approval_request") || !has(db, "approval_decision")) return null;
  const decided = db
    .prepare(
      `SELECT d.decision, d.reason, d.decided_at, r.presented_at, r.evidence_opened_at
       FROM approval_decision d JOIN approval_request r USING (approval_request_id) WHERE d.decided_at >= ? AND d.decided_at < ?`,
    )
    .all(sinceIso, untilIso) as unknown as { decision: string; reason: string; decided_at: string; presented_at: string | null; evidence_opened_at: string | null }[];
  const approved = decided.filter((r) => r.decision === "approve");
  const denied = decided.filter((r) => r.decision === "deny");
  const deniedBecause: Record<string, number> = {};
  for (const r of denied) deniedBecause[r.reason] = (deniedBecause[r.reason] ?? 0) + 1;

  const shown = approved.filter((r) => r.presented_at !== null);
  const seconds = shown.map((r) => (Date.parse(r.decided_at) - Date.parse(r.presented_at as string)) / 1000);
  // Evidence opened after the decision does not count: it was not read before.
  const withoutEvidence = approved.filter((r) => r.evidence_opened_at === null || r.evidence_opened_at > r.decided_at).length;

  const open = db
    .prepare("SELECT r.expires_at FROM approval_request r WHERE r.issued_at >= ? AND r.issued_at < ? AND NOT EXISTS (SELECT 1 FROM approval_decision d WHERE d.approval_request_id = r.approval_request_id)")
    .all(sinceIso, untilIso) as unknown as { expires_at: string }[];
  const refused: Record<string, number> = {};
  if (has(db, "approval_rejected_response")) {
    for (const r of db.prepare("SELECT reason, COUNT(*) n FROM approval_rejected_response WHERE at >= ? AND at < ? GROUP BY reason").all(sinceIso, untilIso) as unknown as { reason: string; n: number }[]) refused[r.reason] = r.n;
  }
  return {
    decisions: decided.length,
    approved: approved.length,
    denied: denied.length,
    deniedBecause,
    medianSecondsToDecide: median(seconds),
    quickShare: shown.length === 0 ? null : shown.filter((_, i) => (seconds[i] as number) < QUICK_SECONDS).length / shown.length,
    withoutEvidenceShare: approved.length === 0 ? null : withoutEvidence / approved.length,
    unanswered: open.filter((r) => r.expires_at <= nowIso).length,
    waiting: open.filter((r) => r.expires_at > nowIso).length,
    refusedResponses: refused,
  };
}

export interface PendingApproval {
  requestId: string;
  actionKind: string;
  actionDigest: string;
  issuedAt: string;
  expiresAt: string;
  shown: boolean;
  evidenceOpened: boolean;
  card: ApprovalCard;
}

/** Requests with no decision, soonest to expire first; an expired one is listed too, marked by its time, so it cannot vanish unseen. */
export function openRequests(db: DatabaseSync): PendingApproval[] {
  if (!has(db, "approval_request") || !has(db, "approval_decision")) return [];
  const rows = db
    .prepare(
      `SELECT r.approval_request_id id, r.action_kind kind, r.action_digest digest, r.issued_at issued, r.expires_at expires, r.presented_at presented, r.evidence_opened_at opened, r.card card
       FROM approval_request r WHERE NOT EXISTS (SELECT 1 FROM approval_decision d WHERE d.approval_request_id = r.approval_request_id) ORDER BY r.expires_at`,
    )
    .all() as unknown as { id: string; kind: string; digest: string; issued: string; expires: string; presented: string | null; opened: string | null; card: string }[];
  return rows.map((r) => ({
    requestId: r.id,
    actionKind: r.kind,
    actionDigest: r.digest,
    issuedAt: r.issued,
    expiresAt: r.expires,
    shown: r.presented !== null,
    evidenceOpened: r.opened !== null,
    card: JSON.parse(r.card) as PendingApproval["card"],
  }));
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** The habit as one short paragraph, or why there is nothing to say. */
export function renderHabit(h: ApprovalHabit | null, period: string): string[] {
  if (h === null) return ["No approval record exists yet."];
  const lines: string[] = [];
  if (h.decisions === 0) lines.push(`No approval was decided ${period}.`);
  else {
    const why = Object.entries(h.deniedBecause).map(([k, n]) => `${n} ${k.replaceAll("_", " ")}`);
    lines.push(`${h.decisions} decision${h.decisions === 1 ? "" : "s"} ${period}: ${h.approved} approved, ${h.denied} denied${why.length > 0 ? ` (${why.join(", ")})` : ""}.`);
    if (h.medianSecondsToDecide !== null) lines.push(`Median time from the card being shown to the decision: ${h.medianSecondsToDecide < 90 ? `${Math.round(h.medianSecondsToDecide)} seconds` : `${(h.medianSecondsToDecide / 60).toFixed(1)} minutes`}.`);
    if (h.quickShare !== null && h.quickShare > 0) lines.push(`${pct(h.quickShare)} of approvals came within ${QUICK_SECONDS} seconds of the card being shown: faster than it can be read.`);
    if (h.withoutEvidenceShare !== null) lines.push(`${pct(h.withoutEvidenceShare)} of approvals were given without the evidence being opened first (desk approvals show <id> opens it).`);
  }
  if (h.unanswered > 0) lines.push(`${h.unanswered} request${h.unanswered === 1 ? "" : "s"} ran out of time with no answer.`);
  if (h.waiting > 0) lines.push(`${h.waiting} request${h.waiting === 1 ? " is" : "s are"} still waiting.`);
  const refused = Object.entries(h.refusedResponses);
  if (refused.length > 0) lines.push(`Responses refused: ${refused.map(([k, n]) => `${n} ${k.replaceAll("_", " ")}`).join(", ")}.`);
  return lines;
}
