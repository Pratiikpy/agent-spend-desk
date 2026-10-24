import { describe, expect, it } from "vitest";

import { decisionRecordHash, parseDecisionRecord, type DecisionRecord } from "../../src/desk/decision/record.ts";

const valid = (): DecisionRecord => ({
  schema: "desk.decision_record.v1",
  id: "dr-2026-10-24-001",
  createdAt: "2026-10-24T09:00:00Z",
  decision: "Cap sub-agent fan-out at 6 concurrent calls for the payments team",
  context: { question: "How should next month's caps change?", window: { from: "2026-09-01", to: "2026-09-30" }, population: "payments team, 4 engineers" },
  evidenceIds: ["sha256:aaaaaaaaaaaa", "claim:s1.1"],
  memoryVersions: ["hmem:rec-12@2026-10-02"],
  alternatives: [
    { id: "a1", summary: "Cap sub-agent fan-out at 6", outcome: "chosen", reason: "Blocked 0 of 311 landed sessions on the training window" },
    { id: "a2", summary: "Cap daily spend at $40", outcome: "rejected", reason: "Would have paused 81 of 311 sessions whose work landed" },
    { id: "a3", summary: "Do nothing", outcome: "rejected", reason: "Loops cost about 21% of the month" },
  ],
  chosen: "a1",
  predictions: [{ metric: "landed sessions blocked", unit: "sessions", expected: 0, low: 0, high: 3, level: 0.9 }],
  tests: [
    { id: "t1", kind: "restrict_check", passed: true, detail: "narrows over 36 cells" },
    { id: "t2", kind: "held_out_replay", passed: true, detail: "5 of 333 landed sessions blocked on October" },
  ],
  approver: "owner",
  enforcement: { action: "pause_with_checkpoint", surface: "claude_code_hook", coverage: null },
  observed: null,
  evidenceLevel: "estimated",
  limits: ["unlinked spend is unknowable", "the hook does not cover tools without one"],
});

const bad = (change: (r: DecisionRecord) => void) => {
  const r = valid();
  change(r);
  return parseDecisionRecord(r);
};

describe("the decision record", () => {
  it("accepts a complete record and hashes it the same way every time", () => {
    const parsed = parseDecisionRecord(valid());
    expect(parsed.ok).toBe(true);
    expect(decisionRecordHash(valid())).toBe(decisionRecordHash(valid()));
    expect(decisionRecordHash(valid())).toMatch(/^sha256:[0-9a-f]{64}$/);
    const changed = valid();
    changed.decision = "Something else";
    expect(decisionRecordHash(changed)).not.toBe(decisionRecordHash(valid()));
  });

  it("refuses a record with no evidence, or with fewer than two alternatives", () => {
    expect(bad((r) => (r.evidenceIds = [])).ok).toBe(false);
    expect(bad((r) => (r.alternatives = [r.alternatives[0]!])).ok).toBe(false);
  });

  it("requires doing nothing to be one of the alternatives that was weighed", () => {
    const r = bad((x) => (x.alternatives = x.alternatives.filter((a) => !/do nothing/i.test(a.summary))));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.map((i) => i.message).join(" ")).toMatch(/doing nothing/i);
  });

  it("requires exactly one chosen alternative and that `chosen` names it", () => {
    expect(bad((r) => (r.chosen = "a2")).ok).toBe(false);
    expect(bad((r) => (r.chosen = "zz")).ok).toBe(false);
    expect(bad((r) => (r.alternatives[1]!.outcome = "chosen")).ok).toBe(false);
  });

  it("requires every alternative to say why it was chosen or rejected", () => {
    expect(bad((r) => (r.alternatives[2]!.reason = "")).ok).toBe(false);
  });

  it("refuses an interval that does not contain its expected value, or a level outside 0 to 1", () => {
    expect(bad((r) => (r.predictions[0] = { ...r.predictions[0]!, expected: 9 })).ok).toBe(false);
    expect(bad((r) => (r.predictions[0] = { ...r.predictions[0]!, level: 1.5 })).ok).toBe(false);
  });

  it("will not call a decision experimentally supported without a passed Lab experiment", () => {
    expect(bad((r) => (r.evidenceLevel = "experimentally_supported")).ok).toBe(false);
    const ok = bad((r) => {
      r.evidenceLevel = "experimentally_supported";
      r.tests.push({ id: "t3", kind: "lab_experiment", passed: true, detail: "pre-registered, 60 tasks, 4 repeats" });
    });
    expect(ok.ok).toBe(true);
    const failed = bad((r) => {
      r.evidenceLevel = "experimentally_supported";
      r.tests.push({ id: "t3", kind: "lab_experiment", passed: false, detail: "interval included zero" });
    });
    expect(failed.ok).toBe(false);
  });

  it("will not accept an observed result that predates the decision", () => {
    expect(bad((r) => (r.observed = { measuredAt: "2026-10-01T00:00:00Z", results: [{ metric: "landed sessions blocked", value: 1 }] })).ok).toBe(false);
    expect(bad((r) => (r.observed = { measuredAt: "2026-11-30T00:00:00Z", results: [{ metric: "landed sessions blocked", value: 1 }] })).ok).toBe(true);
  });

  it("requires a statement of what the record could not know", () => {
    expect(bad((r) => (r.limits = [])).ok).toBe(false);
  });

  it("refuses unknown fields, so a smuggled field is an error and not ignored", () => {
    const r = { ...valid(), secretNote: "x" } as unknown;
    expect(parseDecisionRecord(r).ok).toBe(false);
  });
});
