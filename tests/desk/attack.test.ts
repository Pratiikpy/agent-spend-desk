import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { attack, harmFrom, requestFrom } from "../../src/desk/attack/command.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";

/** `desk attack` (DF-126): a planted loophole is found with the evaluator's own verdict, a sound policy is not accused, and a judge's own request is evaluated. */
const root = mkdtempSync(join(tmpdir(), "desk-attack-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const file = (name: string, text: string): string => {
  const p = join(root, name);
  writeFileSync(p, text);
  return p;
};

const SOUND = "version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n  - id: stop-loops\n    kind: forbid\n    when:\n      waste_rule: { in: [\"C-LOOP-1\"] }\n      recoverable_usd: { gt: \"2.00\" }\n    action: pause_with_checkpoint\n";
// The same forbid, but only for one model: a request on any other model steps around it.
const LOOPHOLE = "version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n  - id: stop-loops\n    kind: forbid\n    when:\n      waste_rule: { in: [\"C-LOOP-1\"] }\n      model: { in: [\"m-big\"] }\n      recoverable_usd: { gt: \"2.00\" }\n    action: pause_with_checkpoint\n";

describe("desk attack", () => {
  it("finds the request that steps around a forbid limited to one model, and prints the evaluator's verdict on it", () => {
    const r = attack({ file: file("loophole.yaml", LOOPHOLE), pairs: 50 });
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/EVASION: changing model to "other-model" steps around rule stop-loops/);
    expect(r.text).toMatch(/the policy's own evaluator says: allow/);
    expect(r.text).toMatch(/waste_rule=C-LOOP-1/);
  });

  it("does not accuse a policy whose forbid covers the harm class, and says how many pairs the restrict check was held to", () => {
    const r = attack({ file: file("sound.yaml", SOUND), pairs: 200, seed: 7 });
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/No request in the corpus steps around the policy/);
    expect(r.text).toMatch(/no widening escape found in 200 generated policy pairs \(seed 7; \d+ called narrowing\)\. This is the number tried, not a proof\./);
  });

  it("reads a harm class given by hand and refuses a malformed one", () => {
    const policy = parsePolicyYaml(SOUND);
    expect(harmFrom(policy, ["C-IDLE-1:5"]).harm).toEqual([{ wasteRule: "C-IDLE-1", minRecoverableMicros: 5_000_000 }]);
    expect(harmFrom(policy, undefined).harm).toEqual([{ wasteRule: "C-LOOP-1", minRecoverableMicros: 2_000_001 }]);
    expect(attack({ file: file("s2.yaml", SOUND), harm: ["nonsense"], pairs: 10 })).toMatchObject({ code: 2 });
    const aimed = attack({ file: file("s3.yaml", SOUND), harm: ["C-IDLE-1:1.00"], pairs: 10 });
    expect(aimed.code).toBe(1);
    expect(aimed.text).toMatch(/C-IDLE-1 at the owner's target amount is not stopped by any rule/);
  });

  it("evaluates a request a judge brings, and refuses one it cannot read", () => {
    const f = file("sound2.yaml", SOUND);
    expect(attack({ file: f, pairs: 10, attempt: "waste_rule=C-LOOP-1,recoverable_usd=3.50" }).text).toMatch(/^Your request: deny \(forbid stop-loops\)\./);
    expect(attack({ file: f, pairs: 10, attempt: "waste_rule=C-LOOP-1,recoverable_usd=1" }).text).toMatch(/^Your request: allow\./);
    expect(attack({ file: f, attempt: "colour=red" })).toMatchObject({ code: 2 });
    expect(requestFrom("recoverable_usd=abc")).toMatch(/dollar amount/);
    expect(attack({ file: join(root, "missing.yaml") })).toMatchObject({ code: 2 });
  });

  it("says when there is nothing to aim at instead of reporting a clean result", () => {
    const r = attack({ file: file("open.yaml", "version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n"), pairs: 10 });
    expect(r.text).toMatch(/nothing to aim at/);
  });
});
