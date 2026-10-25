import { adoptionFailures } from "../decision/adoption.ts";
import type { Flip, FlipCertificate } from "../flip.ts";
import type { ReplayResult } from "../replay/policy-replay.ts";

/**
 * What would flip a policy proposal's recommendation, in the held-out period it was checked on. The recommendation rests on three facts: the proposal narrows the
 * policy, it paused no session whose work landed, and it paused enough sessions to be told from chance. Each held-out session it paused is one candidate twice over:
 * its landing state moved one step (landed or not), and its pause taken away. Landing is detected from linked commits and can be wrong in either direction, so a
 * "no landed work blocked" that one unlinked session would overturn is worth knowing. The rule is `adoptionFailures`, the one the decision record uses.
 */
export function proposalFlips(heldOut: ReplayResult, narrows: boolean): FlipCertificate {
  const facts = { narrows, landedBlocked: heldOut.landedBlocked.length, landedTotal: heldOut.landedTotal, paused: heldOut.paused.length };
  const adoptNow = adoptionFailures(facts).length === 0;
  const word = (adopt: boolean): string => (adopt ? "adopt the proposal" : "keep the policy in force");
  const verdict = word(adoptNow);
  const flips: Flip[] = [];
  const sorted = [...heldOut.paused].sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  const consider = (kind: Flip["kind"], subject: string, change: string, next: Parameters<typeof adoptionFailures>[0]): void => {
    const failures = adoptionFailures(next);
    if ((failures.length === 0) !== adoptNow) flips.push({ kind, subject, change, from: word(adoptNow), to: word(failures.length === 0), because: failures.length === 0 ? "every check then passes" : failures.join("; ") });
  };
  for (const s of sorted) {
    // The session's landing state moves one step: a session that did not land landed, or one that landed did not.
    consider(
      "move_landing",
      s.sessionId,
      s.landed ? `Session ${s.sessionId} had not landed` : `Session ${s.sessionId} had landed`,
      s.landed ? { ...facts, landedBlocked: facts.landedBlocked - 1, landedTotal: facts.landedTotal - 1 } : { ...facts, landedBlocked: facts.landedBlocked + 1, landedTotal: facts.landedTotal + 1 },
    );
  }
  for (const s of sorted) consider("remove_pause", s.sessionId, `Session ${s.sessionId} had not been paused`, { ...facts, paused: facts.paused - 1, ...(s.landed ? { landedBlocked: facts.landedBlocked - 1 } : {}) });
  const candidates = sorted.length * 2;
  if (candidates === 0) return { subject: "the proposal's recommendation", verdict, noun: "recommendation", flips: [], smallest: null, tried: 0, candidates: 0, completeness: "complete", noneBecause: "the proposal paused no held-out session" };
  return { subject: "the proposal's recommendation", verdict, noun: "recommendation", flips, smallest: flips[0] ?? null, tried: candidates, candidates, completeness: "complete" };
}
