import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attack } from "../attack/command.ts";
import type { restrictCheck } from "../policy/restrict.ts";
import { fuzzRestrictCheck } from "./fuzz.ts";

/**
 * The break-it command (DF-126) against a planted loophole and a sound policy, and the fuzzer against the real restrict check and against one made to say "narrows only" about
 * everything. A fuzzer that cannot see a broken check proves nothing when it finds none.
 */
const HEAD = "version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n  - id: stop-loops\n    kind: forbid\n    when:\n      waste_rule: { in: [\"C-LOOP-1\"] }\n";
const TAIL = "      recoverable_usd: { gt: \"2.00\" }\n    action: pause_with_checkpoint\n";

export function attackProve(): { ok: boolean; detail: string } {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-attack-"));
  const fails: string[] = [];
  try {
    const sound = join(root, "sound.yaml");
    const hole = join(root, "hole.yaml");
    writeFileSync(sound, HEAD + TAIL);
    writeFileSync(hole, `${HEAD}      model: { in: ["m-big"] }\n${TAIL}`);
    const a = attack({ file: hole, pairs: 100 });
    if (a.code !== 1 || !/EVASION: changing model/.test(a.text)) fails.push("the planted loophole was not found");
    const b = attack({ file: sound, pairs: 300 });
    if (b.code !== 0) fails.push("a sound policy was accused");
    const real = fuzzRestrictCheck({ pairs: 1500, seed: 20261025 });
    if (real.escapes.length > 0 || real.misses.length > 0) fails.push(`the restrict check let ${real.escapes.length} widening through and missed ${real.misses.length}`);
    const yes = (() => ({ narrows: true, outsideFragment: false, widening: null, routeChanges: [], gridSize: 0, mergedDims: [] })) as unknown as typeof restrictCheck;
    const broken = fuzzRestrictCheck({ pairs: 600, seed: 20261025 }, yes);
    if (broken.escapes.length === 0) fails.push("the fuzzer did not see a check that approves everything");
    return fails.length === 0 ? { ok: true, detail: `the planted loophole was found with the evaluator's verdict and the sound policy was not accused; the real check let no widening through in ${real.pairs} generated pairs, and the fuzzer found ${broken.escapes.length} escapes in a check made to approve everything` } : { ok: false, detail: fails.join("; ") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
