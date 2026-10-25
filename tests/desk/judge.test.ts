import { describe, expect, it } from "vitest";

import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../src/desk/agents/model.ts";
import { ADMISSION, admit, type LabelledPair } from "../../src/desk/judge/admission.ts";
import { krippendorffAlpha } from "../../src/desk/judge/krippendorff.ts";
import { judgePair, lengthNormalised, panelId, PanelConfigError, validatePanel, type Judge, type PairResult, type Verdict } from "../../src/desk/judge/panel.ts";

/**
 * The judge panel (DF-038, DF-098): the agreement measure, the rules a panel must meet to start, how a pair is judged in both orders, how a tie, a split and a failure are
 * scored, how length is not rewarded, and when a panel may be believed.
 */
describe("Krippendorff's alpha", () => {
  it("gives 0.743 for the worked nominal example of the method's author", () => {
    // Four coders, twelve units, with gaps; the figure is the published one for this table.
    const a = [1, 2, 3, 3, 2, 1, 4, 1, 2, null, null, null];
    const b = [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, null, 3];
    const c = [null, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, null];
    const d = [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, null];
    const units = a.map((_, i) => [a[i], b[i], c[i], d[i]].map((x) => (x === null ? null : String(x))));
    const r = krippendorffAlpha(units);
    expect(r.alpha).toBeCloseTo(0.743, 3);
    expect(r.units).toBe(11);
  });

  it("is 1 for complete agreement with variation, undefined when every rating is the same, and about 0 when raters guess", () => {
    expect(krippendorffAlpha([["A", "A", "A"], ["B", "B", "B"], ["tie", "tie", "tie"]]).alpha).toBe(1);
    expect(krippendorffAlpha([["A", "A"], ["A", "A"]]).alpha).toBeNull();
    let s = 7;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const guess = Array.from({ length: 400 }, () => Array.from({ length: 3 }, () => ["A", "B", "tie"][Math.floor(rnd() * 3)] as string));
    expect(Math.abs(krippendorffAlpha(guess).alpha as number)).toBeLessThan(0.1);
    expect(krippendorffAlpha([["A", "B"], ["A", "B"], ["A", "B"]]).alpha as number).toBeLessThan(0);
  });

  it("leaves out a unit with fewer than two ratings and a rating that is missing", () => {
    expect(krippendorffAlpha([["A", null, null], [null, null, null], ["A", "B", null], ["B", "B", "A"]]).units).toBe(2);
    expect(krippendorffAlpha([]).alpha).toBeNull();
    expect(krippendorffAlpha([["A"]]).alpha).toBeNull();
  });
});

const judge = (id: string, family: string, model: string, reply: (req: ModelRequest) => string | Error): Judge => ({
  id, family, model,
  port: { async complete(req: ModelRequest): Promise<ModelResponse> {
    const r = reply(req);
    if (r instanceof Error) throw r;
    return { content: r, toolCalls: [], servedBy: "other", servedModel: model, source: "live", usage: null };
  } } satisfies ModelPort,
});
const says = (w: string): ((req: ModelRequest) => string) => () => JSON.stringify({ winner: w, reason: "x" });
/** A judge that prefers the change containing a marker, wherever it is shown. */
const prefers = (marker: string): ((req: ModelRequest) => string) => (req) => {
  const text = req.messages[1]!.content;
  const first = text.slice(text.indexOf("First change:"), text.indexOf("Second change:"));
  return JSON.stringify({ winner: first.includes(marker) ? "first" : "second", reason: "x" });
};

describe("a panel's rules", () => {
  const ok = [{ id: "j1", family: "nvidia", model: "m1" }, { id: "j2", family: "google", model: "m2" }, { id: "j3", family: "google", model: "m3" }];

  it("starts with three judges of two families that are not the model under test, and says which rule stopped one that does not", () => {
    expect(() => validatePanel(ok, ["m-test"])).not.toThrow();
    expect(() => validatePanel(ok.slice(0, 2), [])).toThrow(/at least 3 judges/);
    expect(() => validatePanel(ok.map((j) => ({ ...j, family: "nvidia" })), [])).toThrow(/at least 2 model families/);
    expect(() => validatePanel(ok, ["m2"])).toThrow(/the model under test, and a model does not grade itself/);
    expect(() => validatePanel([...ok.slice(0, 2), { id: "j3", family: "google", model: "m2" }], [])).toThrow(/two judges, which would count one opinion twice/);
    expect(() => validatePanel([...ok.slice(0, 2), { id: "j1", family: "google", model: "m9" }], [])).toThrow(/listed twice/);
    expect(() => validatePanel(ok, ["m1"])).toThrow(PanelConfigError);
  });

  it("names a panel by who is on it, the same whichever order they are listed in", () => {
    expect(panelId(ok)).toBe(panelId([...ok].reverse()));
    expect(panelId(ok)).not.toBe(panelId([...ok.slice(0, 2), { id: "j3", family: "google", model: "other" }]));
  });
});

describe("judging a pair", () => {
  const input = { task: "make inc add one", a: "A-CHANGE: x + 1", b: "B-CHANGE: x + 2" };

  it("decides for the change a majority prefer in both orders, and shows each judge the changes unnamed and in both orders", async () => {
    const seen: string[] = [];
    const watch = (inner: (r: ModelRequest) => string) => (r: ModelRequest): string => {
      seen.push(r.messages[1]!.content);
      return inner(r);
    };
    const r = await judgePair([judge("j1", "f1", "m1", watch(prefers("A-CHANGE"))), judge("j2", "f2", "m2", prefers("A-CHANGE")), judge("j3", "f2", "m3", prefers("B-CHANGE"))], input);
    expect(r).toMatchObject({ decision: "A", raw: 1 });
    expect(r.judges.map((j) => j.verdict)).toEqual(["A", "A", "B"]);
    expect(r.why).toBe("2 of 3 valid votes for A");
    expect(seen).toHaveLength(2);
    expect(seen[0]!.indexOf("A-CHANGE")).toBeLessThan(seen[0]!.indexOf("B-CHANGE"));
    expect(seen[1]!.indexOf("B-CHANGE")).toBeLessThan(seen[1]!.indexOf("A-CHANGE"));
    for (const s of seen) expect(s).not.toMatch(/strong|light|route|baseline|candidate|nemotron/i);
  });

  it("calls a judge that prefers whichever it saw first a tie, and marks it inconsistent", async () => {
    const r = await judgePair([judge("j1", "f1", "m1", says("first")), judge("j2", "f2", "m2", says("first")), judge("j3", "f2", "m3", prefers("A-CHANGE"))], input);
    expect(r.judges.map((j) => [j.verdict, j.inconsistent])).toEqual([["tie", true], ["tie", true], ["A", false]]);
    expect(r).toMatchObject({ decision: "tie", raw: 0.5 });
  });

  it("gives no decision, and no score, when the votes have no majority", async () => {
    const r = await judgePair([judge("j1", "f1", "m1", prefers("A-CHANGE")), judge("j2", "f2", "m2", prefers("B-CHANGE")), judge("j3", "f2", "m3", says("tie"))], input);
    expect(r).toMatchObject({ decision: null, raw: null });
    expect(r.why).toMatch(/no verdict has a majority of the 3 valid votes/);
  });

  it("counts a judge whose call failed or whose reply is not a verdict as failed, not as a vote and not as a pass", async () => {
    const r = await judgePair([judge("j1", "f1", "m1", () => new ModelError("transient", "503", 503)), judge("j2", "f2", "m2", prefers("A-CHANGE")), judge("j3", "f2", "m3", () => "I think the first one.")], input);
    expect(r.judges.map((j) => j.verdict)).toEqual(["grader_failed", "A", "grader_failed"]);
    expect(r).toMatchObject({ decision: null, raw: null });
    expect(r.why).toMatch(/2 of 3 judges failed/);
    const two = await judgePair([judge("j1", "f1", "m1", () => new ModelError("transient", "503", 503)), judge("j2", "f2", "m2", prefers("A-CHANGE")), judge("j3", "f2", "m3", prefers("A-CHANGE"))], input);
    expect(two).toMatchObject({ decision: "A" });
  });
});

describe("length is not rewarded", () => {
  it("makes a win by a change more than 1.3 times as long, with no better test result, a tie", () => {
    expect(lengthNormalised("A", { length: 1400, tests: 3 }, { length: 1000, tests: 3 })).toEqual({ score: 0.5, penalised: true });
    expect(lengthNormalised("B", { length: 1000, tests: 3 }, { length: 1400, tests: 2 })).toEqual({ score: 0.5, penalised: true });
    expect(lengthNormalised("B", { length: 1400, tests: 3 }, { length: 1000, tests: 3 })).toEqual({ score: 0, penalised: false });
    expect(lengthNormalised("A", { length: 1400, tests: 4 }, { length: 1000, tests: 3 })).toEqual({ score: 1, penalised: false });
    expect(lengthNormalised("A", { length: 1300, tests: 3 }, { length: 1000, tests: 3 })).toEqual({ score: 1, penalised: false });
    expect(lengthNormalised("A", { length: 500, tests: 3 }, { length: 1000, tests: 3 })).toEqual({ score: 1, penalised: false });
    expect(lengthNormalised("tie", { length: 5, tests: 0 }, { length: 500, tests: 0 })).toEqual({ score: 0.5, penalised: false });
    expect(lengthNormalised(null, { length: 5, tests: 0 }, { length: 500, tests: 0 })).toEqual({ score: null, penalised: false });
    expect(lengthNormalised("A", { length: 10, tests: 0 }, { length: 0, tests: 0 })).toEqual({ score: 0.5, penalised: true });
  });
});

describe("when a panel may be believed", () => {
  const pair = (id: string, owner: Verdict, votes: (Verdict | "grader_failed")[], decision: Verdict | null): LabelledPair => ({
    id, owner,
    panel: { judges: votes.map((verdict, i) => ({ judge: `j${i}`, verdict, asShown: [null, null] as PairResult["judges"][number]["asShown"], inconsistent: false })), decision, why: "", raw: null } as PairResult,
  });
  const verdicts: Verdict[] = ["A", "B", "tie"];
  const make = (n: number, ownerAgrees: number): LabelledPair[] => Array.from({ length: n }, (_, i) => {
    const v = verdicts[i % 3] as Verdict;
    const owner: Verdict = i < ownerAgrees ? v : verdicts[(i + 1) % 3] as Verdict;
    return pair(`p${i}`, owner, [v, v, v], v);
  });

  it("admits a panel whose judges agree and whose decisions match the owner's on at least 85% of at least 20 pairs", () => {
    expect(admit(make(20, 18))).toMatchObject({ status: "admitted", agreement: 0.9, labels: 20 });
  });

  it("flags agreement above 92% rather than reassuring, and excludes a panel under 85%", () => {
    const flagged = admit(make(20, 20));
    expect(flagged.status).toBe("flagged");
    expect(flagged.reasons[0]).toMatch(/above 92%/);
    const low = admit(make(20, 15));
    expect(low.status).toBe("excluded");
    expect(low.reasons.join(" ")).toMatch(/75% of the pairs, under 85%/);
  });

  it("excludes a panel with too few labelled pairs, judges that do not agree, or no variation to measure agreement by", () => {
    expect(admit(make(19, 19))).toMatchObject({ status: "excluded" });
    expect(admit(make(19, 19)).reasons[0]).toMatch(/19 labelled pairs; admission needs at least 20/);
    const split = Array.from({ length: 20 }, (_, i) => pair(`s${i}`, "A", i % 2 === 0 ? ["A", "B", "tie"] : ["B", "tie", "A"], "A"));
    expect(admit(split).reasons.join(" ")).toMatch(/agree with each other at alpha .*under 0.67/);
    const same = Array.from({ length: 20 }, (_, i) => pair(`t${i}`, "A", ["A", "A", "A"], "A"));
    expect(admit(same)).toMatchObject({ status: "excluded" });
    expect(admit(same).reasons.join(" ")).toMatch(/could not be measured/);
  });

  it("counts a pair the panel did not decide as a disagreement with the owner", () => {
    const pairs = make(20, 20).map((p, i) => (i < 4 ? { ...p, panel: { ...p.panel, decision: null } } : p));
    const a = admit(pairs);
    expect(a.undecided).toBe(4);
    expect(a.agreement).toBeCloseTo(0.8, 9);
    expect(a.status).toBe("excluded");
    expect(ADMISSION.minLabels).toBe(20);
  });
});
