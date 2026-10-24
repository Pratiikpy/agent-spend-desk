import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { approvalsCommand } from "../../src/desk/approvals/command.ts";
import { approvalHabit, openRequests, renderHabit } from "../../src/desk/approvals/habit.ts";
import { ApprovalService, digestOfAction, type Action, type ApprovalCard } from "../../src/desk/dossier/approval.ts";
import { ephemeralSigner } from "../../src/desk/dossier/keys.ts";

const tmp = mkdtempSync(join(tmpdir(), "desk-approvals-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const CARD: ApprovalCard = {
  diff: { added: ["stop-loops"] },
  replay: { paused: 4, landed_blocked: 0, saved_micros: 611_000_000 },
  restrict: { narrows: true, grid_size: 12 },
  dollars_affected_micros: 611_000_000,
  tasks_affected: 4,
  claims: ["4 sessions would have been paused and $611.00 not spent, an upper bound that assumes a paused session does nothing more."],
};

/** A fake clock the test moves by hand, so that "seconds to decide" is exact. */
function world() {
  let now = T0;
  const db = new DatabaseSync(":memory:");
  const svc = new ApprovalService(db, ephemeralSigner(), () => new Date(now));
  const tick = (ms: number) => (now += ms);
  let n = 0;
  const ask = (ttlMs = 15 * 60_000) => {
    n += 1;
    const action: Action = { kind: "policy_change", payload: { from: `p${n}`, to: `p${n + 1}` } };
    const req = svc.issue(action, { policyVersion: `p${n}`, chainVersion: "head", approvers: ["owner"], card: CARD, ttlMs });
    return { req, action, version: `p${n}` };
  };
  const decide = (r: ReturnType<typeof ask>, decision: "approve" | "deny", digest = r.req.actionDigest) =>
    svc.respond({ approvalRequestId: r.req.approvalRequestId, actionDigest: digest, decision }, { approver: "owner", verified: true }, { policyVersion: r.version, chainVersion: "head" });
  return { db, svc, tick, ask, decide, now: () => new Date(now) };
}

describe("approval habit", () => {
  it("measures how fast and how carefully approvals were made", () => {
    const w = world();
    // 1. shown, approved 3 seconds later, evidence never opened: a rubber stamp
    const a = w.ask();
    w.svc.present(a.req.approvalRequestId);
    w.tick(3_000);
    expect(w.decide(a, "approve").status).toBe("approved");
    // 2. shown, evidence opened after 20 s, approved after 90 s
    const b = w.ask();
    w.svc.present(b.req.approvalRequestId);
    w.tick(20_000);
    w.svc.openEvidence(b.req.approvalRequestId);
    w.tick(70_000);
    expect(w.decide(b, "approve").status).toBe("approved");
    // 3. denied by the approver
    const c = w.ask();
    w.svc.present(c.req.approvalRequestId);
    w.tick(5_000);
    expect(w.decide(c, "deny").status).toBe("denied");
    // 4. expired: the response arrives after the time ran out, and is recorded as a denial for that reason
    const d = w.ask(60_000);
    w.tick(120_000);
    expect(w.decide(d, "approve")).toEqual({ status: "denied", reason: "expired" });
    // 5. a response with the wrong digest is refused and counted apart
    const e = w.ask();
    expect(w.decide(e, "approve", "0".repeat(64)).status).toBe("refused");
    // 6. asked and never answered, long ago
    const f = w.ask(60_000);
    w.tick(10 * 60_000);
    // 7. asked just now, still inside its time
    w.ask();

    const h = approvalHabit(w.db, new Date(T0 - 1000).toISOString(), new Date(w.now().getTime() + 1000).toISOString(), w.now().toISOString())!;
    expect(h.decisions).toBe(4);
    expect(h.approved).toBe(2);
    expect(h.denied).toBe(2);
    expect(h.deniedBecause).toEqual({ denied_by_approver: 1, expired: 1 });
    expect(h.medianSecondsToDecide).toBe(46.5); // 3 s and 90 s
    expect(h.quickShare).toBe(0.5); // one of the two shown cards was approved in under 10 s
    expect(h.withoutEvidenceShare).toBe(0.5); // the stamp; the second had its evidence opened first
    expect(h.refusedResponses).toEqual({ digest_mismatch: 1 });
    expect(h.waiting).toBe(2); // e (refused, still open) and the last one
    expect(h.unanswered).toBe(1); // f
    void f;
  });

  it("does not count evidence opened after the decision as read before it", () => {
    const w = world();
    const a = w.ask();
    w.svc.present(a.req.approvalRequestId);
    w.tick(2_000);
    w.decide(a, "approve");
    w.tick(1_000);
    w.svc.openEvidence(a.req.approvalRequestId);
    const h = approvalHabit(w.db, "0000", "9999", w.now().toISOString())!;
    expect(h.withoutEvidenceShare).toBe(1);
  });

  it("returns nothing, not zeros, when there is no approval record, and counts only decisions inside the period", () => {
    expect(approvalHabit(new DatabaseSync(":memory:"), "0000", "9999", "2026-10-20T00:00:00.000Z")).toBeNull();
    const w = world();
    const a = w.ask();
    w.svc.present(a.req.approvalRequestId);
    w.tick(30_000);
    w.decide(a, "approve");
    const before = approvalHabit(w.db, "2026-10-01T00:00:00.000Z", "2026-10-19T00:00:00.000Z", w.now().toISOString())!;
    expect(before.decisions).toBe(0);
    expect(before.medianSecondsToDecide).toBeNull();
    expect(before.quickShare).toBeNull();
    expect(before.withoutEvidenceShare).toBeNull();
    expect(renderHabit(before, "in the week")[0]).toBe("No approval was decided in the week.");
    expect(renderHabit(null, "in the week")).toEqual(["No approval record exists yet."]);
  });

  it("says the habit in plain words, with the rubber-stamp lines only when they apply", () => {
    const w = world();
    const a = w.ask();
    w.svc.present(a.req.approvalRequestId);
    w.tick(3_000);
    w.decide(a, "approve");
    const lines = renderHabit(approvalHabit(w.db, "0000", "9999", w.now().toISOString()), "in the last 30 days");
    expect(lines).toEqual([
      "1 decision in the last 30 days: 1 approved, 0 denied.",
      "Median time from the card being shown to the decision: 3 seconds.",
      "100% of approvals came within 10 seconds of the card being shown: faster than it can be read.",
      "100% of approvals were given without the evidence being opened first (desk approvals show <id> opens it).",
    ]);
  });
});

describe("desk approvals", () => {
  it("lists what is waiting, opens the evidence on show, and records that it was opened", () => {
    const dbPath = join(tmp, "a.db");
    const db = new DatabaseSync(dbPath);
    const svc = new ApprovalService(db, ephemeralSigner(), () => new Date(T0));
    const req = svc.issue({ kind: "policy_change", payload: { from: "x", to: "y" } }, { policyVersion: "x", chainVersion: "head", approvers: ["owner"], card: CARD, ttlMs: 3_600_000 });
    db.close();
    const now = new Date(T0 + 5 * 60_000);
    const list = approvalsCommand(undefined, undefined, { dbPath }, { now });
    expect(list.text).toContain(`${req.approvalRequestId}  policy change, expires in 55 minutes, evidence not opened yet: desk approvals show ${req.approvalRequestId.slice(0, 8)}`);
    expect(list.text).toContain("No approval was decided in the last 30 days.");

    const shown = approvalsCommand("show", req.approvalRequestId.slice(0, 8), { dbPath }, { now });
    expect(shown.ok).toBe(true);
    expect(shown.text).toContain("rules added: stop-loops");
    expect(shown.text).toContain("replay on the held-out period: 4 sessions paused, 0 of them with work that landed, $611.00 not spent (an upper bound)");
    expect(shown.text).toContain("restrict check: narrows only, over all 12 cells");
    expect(shown.text).toContain(`action digest ${req.actionDigest}`);
    expect(shown.text).toContain(`approve: desk approve ${req.approvalRequestId} ${req.actionDigest}`);

    const after = approvalsCommand(undefined, undefined, { dbPath }, { now });
    expect(after.text).toContain("evidence opened");
    const check = new DatabaseSync(dbPath);
    expect(openRequests(check)[0]).toMatchObject({ shown: true, evidenceOpened: true });
    check.close();
  });

  it("denies without an echo, honours the denial, and refuses to act on what is not there", () => {
    const dbPath = join(tmp, "b.db");
    const db = new DatabaseSync(dbPath);
    const svc = new ApprovalService(db, ephemeralSigner(), () => new Date(T0));
    const req = svc.issue({ kind: "policy_change", payload: { from: "x", to: "y" } }, { policyVersion: "x", chainVersion: "head", approvers: ["owner"], card: CARD, ttlMs: 3_600_000 });
    db.close();
    const now = new Date(T0 + 60_000);
    expect(approvalsCommand("deny", "nope123", { dbPath }, { now })).toMatchObject({ ok: false });
    expect(approvalsCommand("deny", "", { dbPath }, { now }).text).toMatch(/Name the request/);
    const denied = approvalsCommand("deny", req.approvalRequestId.slice(0, 8), { dbPath }, { now });
    expect(denied).toEqual({ ok: true, text: `Denied request ${req.approvalRequestId}. Nothing was changed.` });
    // A decided request is no longer open: it cannot be shown, denied again or approved.
    expect(approvalsCommand("show", req.approvalRequestId, { dbPath }, { now }).ok).toBe(false);
    expect(approvalsCommand(undefined, undefined, { dbPath }, { now }).text).toContain("1 decision in the last 30 days: 0 approved, 1 denied (1 denied by approver).");
    // The same request cannot be approved afterwards with the right digest either.
    const again = new DatabaseSync(dbPath);
    const out = new ApprovalService(again, ephemeralSigner(), () => now).respond({ approvalRequestId: req.approvalRequestId, actionDigest: digestOfAction({ kind: "policy_change", payload: { from: "x", to: "y" } }), decision: "approve" }, { approver: "owner", verified: true }, { policyVersion: "x", chainVersion: "head" });
    again.close();
    expect(out).toEqual({ status: "refused", reason: "already_decided" });
  });

  it("lists the evasions the attacker found, as typed fields, or says it found none, or says nothing on a card that predates them", () => {
    const dbPath = join(tmp, "e.db");
    const db = new DatabaseSync(dbPath);
    const svc = new ApprovalService(db, ephemeralSigner(), () => new Date(T0));
    const issue = (n: number, card: ApprovalCard) => svc.issue({ kind: "policy_change", payload: { from: `e${n}`, to: `f${n}` } }, { policyVersion: "x", chainVersion: "head", approvers: ["owner"], card, ttlMs: 3_600_000 });
    const withEvasion = issue(1, { ...CARD, unresolved_evasions: [{ source: "probe", dimension: "recoverable_micros", waste_rule: "C-LOOP-1", recoverable_micros: 1_990_000, action: "call", verdict: "allow" }, { source: "model", dimension: null, waste_rule: "C-IDLE-1", recoverable_micros: 5_000_000, action: "tool_call", verdict: "ask" }] });
    const none = issue(2, { ...CARD, unresolved_evasions: [] });
    const old = issue(3, CARD);
    expect(() => issue(4, { ...CARD, unresolved_evasions: [{ source: "probe", dimension: null, waste_rule: "x", recoverable_micros: 0, action: "call", verdict: "deny" as never }] })).toThrowError(/verdict must be allow or ask/);
    expect(() => issue(5, { ...CARD, unresolved_evasions: [{ source: "probe", dimension: null, waste_rule: "x", recoverable_micros: -1, action: "call", verdict: "allow" }] })).toThrowError(/non-negative safe integer/);
    db.close();
    const now = new Date(T0 + 60_000);
    const shown = approvalsCommand("show", withEvasion.approvalRequestId, { dbPath }, { now }).text;
    expect(shown).toContain("UNRESOLVED: the attacker found 2 requests this policy still allows:");
    expect(shown).toContain("call for C-LOOP-1 with $1.99 recoverable, stepping around recoverable micros: allow");
    expect(shown).toContain("tool_call for C-IDLE-1 with $5.00 recoverable: ask");
    expect(approvalsCommand("show", none.approvalRequestId, { dbPath }, { now }).text).toContain("The attacker found no request the policy still allows.");
    const legacy = approvalsCommand("show", old.approvalRequestId, { dbPath }, { now }).text;
    expect(legacy).not.toContain("UNRESOLVED");
    expect(legacy).not.toContain("The attacker found");
  });

  it("will not show or deny a request whose time has run out, and says how long ago", () => {
    const dbPath = join(tmp, "c.db");
    const db = new DatabaseSync(dbPath);
    const svc = new ApprovalService(db, ephemeralSigner(), () => new Date(T0));
    const req = svc.issue({ kind: "policy_change", payload: { from: "x", to: "y" } }, { policyVersion: "x", chainVersion: "head", approvers: ["owner"], card: CARD, ttlMs: 60_000 });
    db.close();
    const now = new Date(T0 + 2 * 3_600_000);
    const r = approvalsCommand("show", req.approvalRequestId, { dbPath }, { now });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/ran out 2 hours ago\. It can no longer be approved; ask for a new one\./);
    expect(approvalsCommand(undefined, undefined, { dbPath }, { now }).text).toMatch(/Nothing is waiting for your approval\.\n1 older request ran out of time with no answer\./);
  });

  it("says plainly when no approval has ever been requested, and refuses an unknown subcommand", () => {
    expect(approvalsCommand(undefined, undefined, { dbPath: join(tmp, "none.db") }).text).toMatch(/No approval has ever been requested/);
    const dbPath = join(tmp, "d.db");
    const empty = new DatabaseSync(dbPath);
    new ApprovalService(empty, ephemeralSigner());
    empty.close();
    expect(approvalsCommand("frobnicate", undefined, { dbPath })).toEqual({ ok: false, text: 'desk approvals: unknown subcommand "frobnicate". Use: list, show <id>, deny <id>, habit.' });
  });
});
