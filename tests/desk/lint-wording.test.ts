import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { auditSentences } from "../../src/desk/agents/audit.ts";
import { ClaimLedger, type Claim } from "../../src/desk/agents/claims.ts";
import { helpText } from "../../src/desk/help.ts";
import { lintWording, RULES } from "../../src/desk/lint/wording.ts";

const rule = (text: string): string[] => lintWording(text).map((f) => f.rule);

describe("each rule flags what it is for and lets honest use through (the corpus)", () => {
  const CASES: { id: string; flags: string[]; allows: string[] }[] = [
    {
      id: "proved",
      flags: ["The policy change is proven safe.", "We proved the saving on your own sessions.", "This is proof that the agent got worse."],
      allows: ["The restrict-only check proves that an edited policy only narrows the one in force.", "One changed byte fails the verifier, and a signature proves the record was not altered.", "It is not proof of the switch.", "The first run cannot prove that no cache exists.", "`desk prove` runs every check."],
    },
    {
      id: "as-good-as",
      flags: ["The cheaper route is as good as the dearer one.", "Haiku is as good as Sonnet here."],
      allows: ["Is the agent still as good as it was?", "A figure is only as good as the note beside it.", "As good as, said only after an equivalence was shown."],
    },
    {
      id: "regressed",
      flags: ["The agent regressed last week.", "There was a regression in quality on Tuesday."],
      allows: ["The canary calls a regression: -40.0 points, 99% interval -56.2 to -23.8, control arm flat.", "Verdict: regressed, with an interval and a control arm.", "A regression test for the gate.", "A public regression index.", "It is not a regression of the model."],
    },
    {
      id: "billed",
      flags: ["You were billed $90.62 yesterday.", "The estimate of what you were billed is $12."],
      allows: ["The invoice says you were billed $90.00.", "Billed against estimated, month by month.", "Whether it was billed is unknown.", "No invoice is imported, so nothing here is billed."],
    },
    {
      id: "caused-by",
      flags: ["The extra spend was caused by Sonnet.", "This waste is caused by loops."],
      allows: ["A change of model is not shown to be caused by a plan.", "The cause is a part of the cost, not a verdict."],
    },
    {
      id: "overclaim",
      flags: ["This is the best way to cut spend.", "A production-ready gate.", "It guarantees the cap holds.", "A perfect score.", "Seamless setup.", "Certified by the Desk.", "The optimal policy is a $20 cap."],
      allows: ["No claim of best is made.", "It is not production-ready.", "Nothing here is guaranteed.", "We never claim optimal.", "NOT VERIFIED: whether it is the best policy."],
    },
    {
      id: "promise-of-saving",
      flags: ["This policy will save you $400 a month.", "It saves you money.", "You will save a third."],
      allows: ["The replay would have saved $400 on recorded sessions; it is not a promise that this policy will save you anything."],
    },
    {
      id: "accurate",
      flags: ["The estimate is accurate.", "An accurate forecast."],
      allows: ["Accurate to within 2% on 420 processes.", "The estimate is not accurate to the cent.", "Accuracy was measured on 48 samples."],
    },
  ];

  it("covers every rule", () => {
    expect(CASES.map((c) => c.id).sort()).toEqual(RULES.map((r) => r.id).sort());
  });

  for (const c of CASES) {
    it(`${c.id}: flags ${c.flags.length} overclaims and passes ${c.allows.length} honest uses`, () => {
      for (const text of c.flags) expect(rule(text), text).toContain(c.id);
      for (const text of c.allows) expect(rule(text), text).not.toContain(c.id);
    });
  }

  it("reads a line with the lines either side, so a thought begun above is read with its end", () => {
    expect(rule("The verdict is stated with an interval and a control arm:\nthe agent regressed on 15 October.")).not.toContain("regressed");
    expect(rule("The agent regressed.")).toContain("regressed");
  });

  it("can skip a rule a caller checks another way, and can limit itself to the rules for generated text", () => {
    expect(lintWording("It was billed.", { skip: ["billed"] })).toEqual([]);
    expect(lintWording("An accurate estimate.", { generated: true })).toEqual([]);
    expect(lintWording("An accurate estimate.").map((f) => f.rule)).toEqual(["accurate"]);
  });
});

describe("the Auditor refuses a sentence that overclaims, whatever its figures", () => {
  const claims: Claim[] = [{ id: "c1", kind: "number", text: "October's estimated list-price spend was $4,812.00.", value: 4812, unit: "usd", class: "estimated", source: "ledger.month" }];
  const audit = (text: string) => auditSentences([{ text, cites: ["c1"] }], new ClaimLedger(claims));

  it("accepts a plain sentence with a supported figure", () => {
    expect(audit("Spend was $4,812 this month.").accepted).toHaveLength(1);
  });

  it("rejects the same figure inside an overclaim, with the rule named", () => {
    for (const [text, rule] of [
      ["Spend was $4,812 this month, caused by the new model.", "caused-by"],
      ["Spend was $4,812 and a cap will save you money.", "promise-of-saving"],
      ["The best cap holds spend to $4,812.", "overclaim"],
      ["It is proven that spend was $4,812.", "proved"],
    ] as const) {
      const r = audit(text);
      expect(r.accepted, text).toHaveLength(0);
      expect(r.rejected[0]).toMatchObject({ reason: "wording" });
      expect(r.rejected[0]!.detail.startsWith(`${rule}:`), text).toBe(true);
    }
  });
});

describe("what is written by hand and shipped is clean", () => {
  function walk(root: string, ext: RegExp): string[] {
    const out: string[] = [];
    for (const name of readdirSync(root)) {
      const p = join(root, name).replace(/\\/g, "/");
      if (statSync(p).isDirectory()) out.push(...walk(p, ext));
      else if (ext.test(name)) out.push(p);
    }
    return out;
  }
  // A scaffold from the organisers' template is theirs, not a claim of ours.
  const files = ["README.md", "docs/evidence.md", "docs/product-description.md", "docs/the-agents.md", "docs/reference.md", "docs/evaluation/reasoning-scorecard.md", "docs/open-ledger-format.md", "docs/adapter-sdk.md", ...walk("docs/submission", /\.(md|html)$/).filter((f) => !f.endsWith(".template.md")), ...walk("docs/verification", /\.md$/)];

  it("has no overclaiming word in the README, the evidence, the deck, the video script, the product description or a verification note", () => {
    const found: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8").replace(/<[^>]+>/g, " ");
      for (const x of lintWording(text)) found.push(`${f}:${x.line} [${x.rule}] ${x.text.replace(/\s+/g, " ")}`);
    }
    expect(files.length).toBeGreaterThan(40);
    expect(found, found.join("\n")).toEqual([]);
  });

  it("has none in the command list the tool prints", () => {
    expect(lintWording(helpText(), { generated: true })).toEqual([]);
  });
});
