import { createHash } from "node:crypto";

import type { Ledger } from "../ledger/db.ts";
import type { TaskMarker } from "../tasks/identity.ts";
import { AUTONOMY, decide, evidenceFor, taskFacts, type Decision, type Tier, type WorkflowEvidence } from "./matrix.ts";

/**
 * What the Desk has decided about each kind of work, kept in the ledger with every change as an event: who or what changed it, from what to what, why, and the evidence (counts, bound,
 * revert) it rested on, with a digest of that evidence. The gate holds its own copy of the tiers, which it reads at every decision; this is the record of how they came to be.
 */
export interface StoredTier {
  workflow: string;
  tier: Tier;
  since: string;
  reason: string;
}

export function storedTiers(db: Ledger): Map<string, StoredTier> {
  const rows = db.prepare("SELECT workflow, tier, since, reason FROM workflow_autonomy").all() as unknown as StoredTier[];
  return new Map(rows.map((r) => [r.workflow, r]));
}

/**
 * The present, for judging how old work is: the clock, or the newest call in the ledger when that is later. A ledger of recorded sessions from a time ahead of this machine's
 * clock (the constructed sample) is judged as of its own last day, not as if its work were from the future.
 */
export function asOfMs(db: Ledger, nowMs: number): number {
  const newest = (db.prepare("SELECT MAX(ts) AS t FROM model_call").get() as { t: string | null }).t;
  return newest === null ? nowMs : Math.max(nowMs, Date.parse(newest));
}

export function evaluateAll(db: Ledger, clockMs: number, markers: readonly TaskMarker[] = []): Decision[] {
  const nowMs = asOfMs(db, clockMs);
  const { facts, unlinked, revertedSha } = taskFacts(db, markers);
  const evidence = evidenceFor(facts, unlinked, revertedSha, nowMs);
  const tiers = new Map([...storedTiers(db)].map(([w, t]) => [w, t.tier]));
  // A kind the owner blocked before it had any finished run still needs a line.
  for (const w of tiers.keys()) if (!evidence.some((e) => e.workflow === w)) evidence.push(emptyEvidence(w));
  return decide(evidence, tiers, nowMs);
}

function emptyEvidence(workflow: string): WorkflowEvidence {
  return { workflow, success: 0, failure: 0, pending: 0, unlinked: 0, n: 0, rate: null, lower: null, upper: null, lastRevertMs: null, recentRevert: false, revertedSha7: null };
}

function event(db: Ledger, e: { workflow: string; at: string; kind: string; from: Tier | null; to: Tier | null; reason: string; evidence: WorkflowEvidence; digest: string }): void {
  db.prepare("INSERT INTO autonomy_event (workflow, at, kind, from_tier, to_tier, reason, evidence, evidence_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(e.workflow, e.at, e.kind, e.from, e.to, e.reason, JSON.stringify(e.evidence), e.digest);
}

function setTier(db: Ledger, workflow: string, tier: Tier, at: string, reason: string, evidence: WorkflowEvidence, digest: string): void {
  db.prepare(
    `INSERT INTO workflow_autonomy (workflow, tier, since, reason, evidence, evidence_digest) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workflow) DO UPDATE SET tier = excluded.tier, since = excluded.since, reason = excluded.reason, evidence = excluded.evidence, evidence_digest = excluded.evidence_digest`,
  ).run(workflow, tier, at, reason, JSON.stringify(evidence), digest);
}

export interface Applied {
  demoted: Decision[];
  proposed: Decision[];
}

/** Carry out what the evidence says needs no one's permission: demote, now. Record a promotion as a proposal, once for each piece of evidence. */
export function applyDecisions(db: Ledger, decisions: readonly Decision[], nowMs: number): Applied {
  const at = new Date(nowMs).toISOString();
  const out: Applied = { demoted: [], proposed: [] };
  db.exec("BEGIN");
  try {
    for (const d of decisions) {
      if (d.action === "demote") {
        setTier(db, d.workflow, d.next, at, d.reason, d.evidence, d.digest);
        event(db, { workflow: d.workflow, at, kind: "demoted", from: d.tier, to: d.next, reason: d.reason, evidence: d.evidence, digest: d.digest });
        out.demoted.push(d);
      } else if (d.action === "propose_promotion") {
        const last = db.prepare("SELECT kind, evidence_digest AS digest FROM autonomy_event WHERE workflow = ? ORDER BY event_id DESC LIMIT 1").get(d.workflow) as { kind: string; digest: string } | undefined;
        if (last?.kind === "proposed" && last.digest === d.digest) continue;
        event(db, { workflow: d.workflow, at, kind: "proposed", from: d.tier, to: d.next, reason: d.reason, evidence: d.evidence, digest: d.digest });
        out.proposed.push(d);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return out;
}

export const echoOf = (digest: string): string => digest.slice(0, 8);

export type Approval = { ok: true; decision: Decision } | { ok: false; reason: string };

/**
 * Promote a kind of work to `guarded_auto`, on the owner's say-so. The owner must give the first eight characters of the digest of the evidence as it stands now, which they can
 * only have from reading it: if the evidence has changed since (a task finished, a revert), the echo no longer matches and nothing is promoted.
 */
export function approvePromotion(db: Ledger, workflow: string, echo: string, nowMs: number, markers: readonly TaskMarker[] = []): Approval {
  const d = evaluateAll(db, nowMs, markers).find((x) => x.workflow === workflow);
  if (d === undefined) return { ok: false, reason: `no finished or unfinished run of kind "${workflow}" is in the ledger` };
  if (d.action !== "propose_promotion") return { ok: false, reason: `"${workflow}" is not proposed for promotion now: ${d.reason}` };
  if (!/^[0-9a-f]{8}$/i.test(echo) || echo.toLowerCase() !== echoOf(d.digest)) return { ok: false, reason: `the evidence for "${workflow}" is ${echoOf(d.digest)} now; ${echo === "" ? "give it" : `${echo} is not it`}. Read what it says (desk autonomy status), then approve with that code.` };
  const at = new Date(nowMs).toISOString();
  db.exec("BEGIN");
  try {
    setTier(db, workflow, "guarded_auto", at, d.reason, d.evidence, d.digest);
    event(db, { workflow, at, kind: "promoted", from: d.tier, to: "guarded_auto", reason: `${d.reason}; approved by the owner`, evidence: d.evidence, digest: d.digest });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, decision: d };
}

/** The owner blocks a kind of work, or lifts the block. Lifting returns it to supervised, never to an earned tier. */
export function setBlocked(db: Ledger, workflow: string, blocked: boolean, nowMs: number, reason: string): { ok: boolean; message: string } {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(workflow)) return { ok: false, message: `"${workflow}" is not a kind of work (1 to 40 lowercase letters, digits, hyphens and underscores)` };
  const current = storedTiers(db).get(workflow)?.tier ?? "supervised";
  const at = new Date(nowMs).toISOString();
  const evidence = emptyEvidence(workflow);
  const digest = createHash("sha256").update(`${workflow}|${blocked}|${at}`).digest("hex");
  if (blocked && current === "blocked") return { ok: false, message: `"${workflow}" is blocked already` };
  if (!blocked && current !== "blocked") return { ok: false, message: `"${workflow}" is not blocked` };
  const to: Tier = blocked ? "blocked" : "supervised";
  db.exec("BEGIN");
  try {
    setTier(db, workflow, to, at, reason, evidence, digest);
    event(db, { workflow, at, kind: blocked ? "blocked" : "unblocked", from: current, to, reason, evidence, digest });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, message: blocked ? `Blocked "${workflow}": the gate refuses its requests until you lift this.` : `Lifted the block on "${workflow}": it is supervised again, not promoted.` };
}

/** The last events of a kind of work, newest first. */
export function history(db: Ledger, workflow: string, limit = 10): { at: string; kind: string; from: string | null; to: string | null; reason: string }[] {
  return db.prepare("SELECT at, kind, from_tier AS [from], to_tier AS [to], reason FROM autonomy_event WHERE workflow = ? ORDER BY event_id DESC LIMIT ?").all(workflow, limit) as unknown as { at: string; kind: string; from: string | null; to: string | null; reason: string }[];
}

export { AUTONOMY };
