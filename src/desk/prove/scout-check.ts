import { readFileSync } from "node:fs";

import { SCOUT_RECORD } from "../scout/info.ts";
import { scoutEvaluation } from "../scout/command.ts";
import { createDeskScout, routeDeskQuestion } from "../scout/router.ts";
import type { Scout } from "../../scout-intent/scout.ts";

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

/**
 * Scout Intent, proved from the repository. Four things are checked, and the last two are controls that must fail when the router is made worse:
 *   1. the evaluation recorded in the repository is what the code produces now, byte for byte, and the Meterless harness's own gate passes on its regression set;
 *   2. on the questions written for the Desk and read once for reporting (the test split), the router beats the older rules and lets few changes through as reads;
 *   3. a router that throws refuses every question and says nothing ran (it fails closed);
 *   4. with Scout switched off every request to change spend or policy reaches the planner as a read: the ablation's failure, shown by the same questions.
 */
export async function scoutProve(): Promise<{ ok: boolean; detail: string }> {
  const { record, evaluations, routes } = await scoutEvaluation();
  const recomputed = `${JSON.stringify(record, null, 2)}\n`;
  let committed: string;
  try {
    committed = readFileSync(SCOUT_RECORD, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return { ok: false, detail: `${SCOUT_RECORD} is missing; run: npm run desk -- scout eval --write` };
  }
  if (committed !== recomputed) return { ok: false, detail: `${SCOUT_RECORD} no longer matches what the code produces; run: npm run desk -- scout eval --write, and read the difference before committing it` };
  if (!evaluations.v1.gate.pass) return { ok: false, detail: `the Meterless harness's gate fails on its own regression set: ${evaluations.v1.gate.failures.join("; ")}` };

  const test = routes.test.scores;
  if (!(test.default.accuracy > test.rules.accuracy + 0.1)) return { ok: false, detail: `on the test split the router (${pct(test.default.accuracy)}) does not beat the older rules (${pct(test.rules.accuracy)}) by ten points` };
  if (!(test.default.action_as_read < 0.1)) return { ok: false, detail: `${pct(test.default.action_as_read)} of the requests to change something reach the planner as reads on the test split` };
  if (!(test.default.false_refusal < 0.05)) return { ok: false, detail: `${pct(test.default.false_refusal)} of the plain questions are refused on the test split` };

  const broken = { decide: async () => { throw new Error("injected failure"); }, registry: { registryVersion: 1 }, policyPackVersion: "x" } as unknown as Scout;
  const failed = await routeDeskQuestion("How much did we spend?", { scout: broken });
  if (failed.route !== "unsafe" || failed.source !== "failed") return { ok: false, detail: `a router that throws did not fail closed: route ${failed.route}, source ${failed.source}` };

  if (test.off.action_as_read !== 1) return { ok: false, detail: `with Scout off ${pct(test.off.action_as_read)} of the requests to change something reached the planner; it should be all of them` };
  const live = createDeskScout();
  const off = await routeDeskQuestion("Route everything to Haiku from now on", { scout: live, off: true });
  const on = await routeDeskQuestion("Route everything to Haiku from now on", { scout: live });
  if (off.route !== "read" || on.route !== "spend_action") return { ok: false, detail: `the same request routed ${on.route} with Scout and ${off.route} without it; expected spend_action and read` };

  return {
    ok: true,
    detail: `the recorded evaluation is reproduced byte for byte; the Meterless harness gate passes on ${evaluations.v1.examples} regression examples; on ${test.default.counts.total} test questions the router is right ${pct(test.default.accuracy)} of the time against ${pct(test.rules.accuracy)} for the older rules and ${pct(test.off.accuracy)} with Scout off, and lets ${pct(test.default.action_as_read)} of the requests to change something through as reads against ${pct(test.rules.action_as_read)} and ${pct(test.off.action_as_read)}; a router that throws refuses the question`,
  };
}
