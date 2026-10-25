import { describe, expect, it } from "vitest";

import { ablation, formatAblation, stress } from "../../../src/desk/bench/ablation.ts";
import { ABLATIONS, corruptFirstFigure, runArm, STRESS } from "../../../src/desk/bench/arms.ts";
import type { BenchRow } from "../../../src/desk/bench/run.ts";

const row = (qid: string, arm: BenchRow["arm"], exact: boolean, over: Partial<BenchRow> = {}): BenchRow => ({
  qid, trial: 0, arm, category: "lookup", split: "dev", answer: "", error: null, exact, close: exact, abstained: false, resisted: null, rejectedPremise: null, extraFigures: 0, modelCalls: 2, tokensIn: 300, tokensOut: 100, servedModel: null, ms: 1000, detail: "", ...over,
});
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `q${i + 1}`);

/** The reference gets everything right; an arm gets the first `wrong` questions wrong. */
const withArm = (arm: BenchRow["arm"], n: number, wrong: number, over: (i: number) => Partial<BenchRow> = () => ({})): BenchRow[] => [
  ...ids(n).map((q) => row(q, "A2", true)),
  ...ids(n).map((q, i) => row(q, arm, i >= wrong, over(i))),
];

describe("what each ablation arm takes out", () => {
  it("names five arms, each taking out one role, and none of them is the full Desk", () => {
    expect(Object.keys(ABLATIONS)).toEqual(["A3", "A4", "A5", "A6", "A7"]);
    expect(new Set(Object.values(ABLATIONS).map((a) => a.role)).size).toBe(5);
    for (const a of Object.values(ABLATIONS)) expect(Object.keys(a.roles)).toHaveLength(1);
  });

  it("refuses to run an arm that does not exist instead of running the full Desk under another name", async () => {
    await expect(runArm("A9" as never, { db: null as never, port: null as never, question: "x" })).rejects.toThrow();
  });
});

describe("the rule that decides a role", () => {
  it("calls a role necessary when taking it out loses answers and the exact test says it is not chance", () => {
    const [r] = ablation(withArm("A7", 60, 20));
    expect(r?.finding).toBe("necessary on this set");
    expect(r?.exact).toMatchObject({ onlyReference: 20, onlyArm: 0 });
    expect(r?.exact.p).toBeLessThan(0.001);
  });

  it("does not call a role necessary on a handful of questions a chance split could explain", () => {
    const [r] = ablation(withArm("A3", 60, 3));
    expect(r?.exact.p).toBeCloseTo(0.25, 10);
    expect(r?.finding).toBe("not shown necessary");
    expect(r?.because).toMatch(/3 questions only the full Desk got right, 0 only this arm, p = 0\.250/);
  });

  it("calls a role necessary when it is the only thing between a hidden instruction and the answer, even if exactness is the same", () => {
    const adversarial = (i: number): Partial<BenchRow> => ({ category: "adversarial", resisted: i >= 8 ? true : false });
    const rows = [...ids(10).map((q) => row(q, "A2", true, { category: "adversarial", resisted: true })), ...ids(10).map((q, i) => row(q, "A4", true, adversarial(i)))];
    const [r] = ablation(rows);
    expect(r?.arm).toBe("A4");
    expect(r?.exact.p).toBe(1);
    expect(r?.injection).toMatchObject({ onlyReference: 8, onlyArm: 0 });
    expect(r?.finding).toBe("necessary on this set");
    expect(r?.because).toMatch(/a hidden instruction got through in 8 questions where the full Desk resisted it/);
  });

  it("calls a role harmful when the arm without it is clearly better", () => {
    const rows = [...ids(40).map((q) => row(q, "A6", true)), ...ids(40).map((q, i) => row(q, "A2", i >= 12))];
    const [r] = ablation(rows);
    expect(r?.finding).toBe("harmful here");
  });

  it("leaves out an arm nobody ran, and a question either side could not answer", () => {
    expect(ablation(withArm("A5", 10, 0)).map((r) => r.arm)).toEqual(["A5"]);
    const rows = [...withArm("A5", 10, 0)].map((r) => (r.arm === "A5" && r.qid === "q1" ? { ...r, error: "model unavailable", exact: false } : r));
    expect(ablation(rows)[0]?.exact).toMatchObject({ pairs: 9, excluded: 1 });
  });
});

describe("the table", () => {
  it("states the full Desk's figures, each arm's, the finding, and that 60 questions cannot show equivalence", () => {
    const text = formatAblation(withArm("A7", 60, 20, () => ({ tokensIn: 100, tokensOut: 50, ms: 4000 })));
    expect(text).toMatch(/A2, the full Desk: 60 of 60 exact/);
    expect(text).toMatch(/A7 {2}without the Planner \(the rule planner plans\): 40 of 60 exact; 20 only the full Desk got, 0 only this arm, p = 0\.000/);
    expect(text).toMatch(/finding: necessary on this set/);
    expect(text).toMatch(/absence of evidence on this set, not equivalence/);
    expect(formatAblation(withArm("A7", 60, 20).filter((r) => r.arm === "A2"))).toBe("");
  });
});

describe("the fault the stress arms inject", () => {
  const reply = (...texts: string[]): string => JSON.stringify({ sentences: texts.map((text, i) => ({ text, cites: [`s1.${i + 1}`] })) });
  const texts = (content: string): string[] => (JSON.parse(content) as { sentences: { text: string }[] }).sentences.map((s) => s.text);

  it("changes the first figure only, keeps its shape, and leaves every citation and later sentence alone", () => {
    const out = corruptFirstFigure(reply("The spend was $1,234.56 in total.", "That is 7 days."));
    const [first, second] = texts(out);
    expect(first).toMatch(/^The spend was \$[\d,]+\.\d{2} in total\.$/);
    expect(first).not.toContain("1,234.56");
    expect(second).toBe("That is 7 days.");
    expect((JSON.parse(out) as { sentences: { cites: string[] }[] }).sentences.map((s) => s.cites)).toEqual([["s1.1"], ["s1.2"]]);
  });

  it("does not touch a date, a plain count becomes another count, and a figure is always different from what it was", () => {
    expect(texts(corruptFirstFigure(reply("From 2026-10-01 to 2026-10-31 the total was $9.00.")))[0]).toMatch(/^From 2026-10-01 to 2026-10-31 the total was \$\d+\.\d{2}\.$/);
    expect(texts(corruptFirstFigure(reply("From 2026-10-01 to 2026-10-31 the total was $9.00.")))[0]).not.toContain("$9.00");
    expect(texts(corruptFirstFigure(reply("There were 7 sessions.")))[0]).toMatch(/^There were \d+ sessions\.$/);
    expect(texts(corruptFirstFigure(reply("There were 7 sessions.")))[0]).not.toContain(" 7 ");
    expect(texts(corruptFirstFigure(reply("There were 0 sessions.")))[0]).not.toContain(" 0 ");
  });

  it("returns a reply with no figure, or that is not the expected JSON, as it came", () => {
    const plain = reply("Nothing was spent that day.");
    expect(corruptFirstFigure(plain)).toBe(plain);
    expect(corruptFirstFigure("not json")).toBe("not json");
    expect(corruptFirstFigure('{"other":1}')).toBe('{"other":1}');
  });

  it("names two stress arms, the Desk and the Desk without its Auditor", () => {
    expect(Object.keys(STRESS)).toEqual(["A2F", "A4F"]);
    expect(STRESS.A2F.roles).toEqual({});
    expect(STRESS.A4F.roles).toEqual({ auditor: false });
  });
});

describe("the Auditor under stress", () => {
  const stressRows = (n: number, leak: number): BenchRow[] => [
    ...ids(n).map((q) => row(q, "A2F", false, { extraFigures: 0 })),
    ...ids(n).map((q, i) => row(q, "A4F", false, { extraFigures: i < leak ? 1 : 0 })),
  ];

  it("is necessary under the fault when the Auditor keeps wrong figures from the reader and chance cannot explain it", () => {
    const s = stress(stressRows(30, 25))!;
    expect(s.withAuditor).toEqual({ exact: 0, n: 30, figures: 0 });
    expect(s.without).toEqual({ exact: 0, n: 30, figures: 25 });
    expect(s.clean).toMatchObject({ onlyReference: 25, onlyArm: 0 });
    expect(s.finding).toBe("necessary under this fault");
  });

  it("is not shown necessary when the arms look alike, and is absent when either stress arm was not run", () => {
    expect(stress(stressRows(30, 2))!.finding).toBe("not shown necessary under this fault");
    expect(stress(stressRows(30, 25).filter((r) => r.arm === "A2F"))).toBeNull();
    expect(stress([])).toBeNull();
  });

  it("is in the table with the synthetic fault named as one", () => {
    const text = formatAblation(stressRows(30, 25));
    expect(text).toMatch(/the Auditor under stress: every Explainer reply has its first figure changed by code/);
    expect(text).toMatch(/a synthetic fault, not how often the model errs/);
    expect(text).toMatch(/A2F with the Auditor: 0 of 30 answers state a figure nothing asked for/);
    expect(text).toMatch(/A4F without it: {7}25 of 30 answers state a figure nothing asked for/);
    expect(text).toMatch(/25 only with the Auditor, 0 only without, p = 0\.000; finding: necessary under this fault/);
  });
});
