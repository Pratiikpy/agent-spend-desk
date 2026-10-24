import { describe, expect, it } from "vitest";

import { checkClaims, figuresIn, uncoveredFigures, type Claim } from "../../src/desk/status/claims.ts";

const files: Record<string, string> = {
  "README.md": "The canary calls the planted switch: **-40.0 points**, 99% interval -56.2 to -23.8. `desk prove` runs 26 checks. It cost $6,123.23 and took 3 days on 2026-10-24.",
  "result.json": '{"delta": -0.4, "label": "-40.0 points", "checks": 26}',
};
const io = { read: (p: string): string | null => files[p] ?? null };

const claim = (over: Partial<Claim> = {}): Claim => ({ id: "C1", file: "README.md", quote: "-40.0 points", level: "observed", supports: [{ file: "result.json", pattern: "-40\\.0 points" }], ...over });

describe("claim registry check", () => {
  it("passes a claim whose quote is in its file and whose support holds the pattern", () => {
    expect(checkClaims([claim()], io)).toEqual([]);
  });

  it("ignores Markdown emphasis and backticks when looking for a quote", () => {
    expect(checkClaims([claim({ quote: "-40.0 points, 99% interval" })], io)).toEqual([]);
    expect(checkClaims([claim({ id: "C2", quote: "desk prove runs 26 checks", supports: [{ file: "result.json", pattern: '"checks": 26' }] })], io)).toEqual([]);
  });

  it("reports a quote that is no longer in the file", () => {
    const p = checkClaims([claim({ quote: "-41.0 points" })], io);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: "C1" });
    expect(p[0]!.problem).toMatch(/quote is not in README\.md/);
  });

  it("reports a support file that is missing, and a pattern the support file does not hold", () => {
    expect(checkClaims([claim({ supports: [{ file: "gone.json", pattern: "x" }] })], io)[0]!.problem).toMatch(/gone\.json does not exist/);
    expect(checkClaims([claim({ supports: [{ file: "result.json", pattern: "-39\\.0" }] })], io)[0]!.problem).toMatch(/does not hold/);
  });

  it("requires support for everything except a design statement", () => {
    expect(checkClaims([claim({ supports: [] })], io)[0]!.problem).toMatch(/no support/);
    expect(checkClaims([claim({ supports: [], level: "design" })], io)).toEqual([]);
  });

  it("refuses duplicate ids and an unknown evidence level", () => {
    expect(checkClaims([claim(), claim()], io).some((p) => /used twice/.test(p.problem))).toBe(true);
    expect(checkClaims([claim({ level: "certain" as never })], io).some((p) => /evidence level/.test(p.problem))).toBe(true);
  });
});

describe("figures in a text", () => {
  it("finds dollar amounts, percentages and counts with a unit, and leaves dates, versions and years alone", () => {
    const f = figuresIn(files["README.md"]!);
    expect(f).toEqual(expect.arrayContaining(["-40.0 points", "99%", "26 checks", "$6,123.23", "3 days"]));
    expect(f.join("|")).not.toMatch(/2026|10-24/);
    expect(figuresIn("Needs Node 22.19 or later, version 4.0.490.")).toEqual([]);
  });

  it("lists the figures no claim covers", () => {
    const covered = [claim({ quote: "-40.0 points, 99% interval -56.2 to -23.8" }), claim({ id: "C2", quote: "desk prove runs 26 checks" }), claim({ id: "C3", quote: "It cost $6,123.23" })];
    expect(uncoveredFigures("README.md", files["README.md"]!, covered)).toEqual(["3 days"]);
    expect(uncoveredFigures("README.md", files["README.md"]!, [...covered, claim({ id: "C4", quote: "took 3 days" })])).toEqual([]);
  });

  it("does not let a claim about another file cover a figure", () => {
    const other = [claim({ file: "docs/other.md", quote: "-40.0 points" })];
    expect(uncoveredFigures("README.md", "The change was -40.0 points.", other)).toEqual(["-40.0 points"]);
  });
});
