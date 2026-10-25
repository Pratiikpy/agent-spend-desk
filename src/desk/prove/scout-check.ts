import { readFileSync } from "node:fs";

import { SCOUT_RECORD } from "../scout/info.ts";
import { scoutEvaluation } from "../scout/command.ts";
import { createDeskScout, routeDeskQuestion } from "../scout/router.ts";
import type { Scout, TextEmbedder } from "../../scout-intent/scout.ts";

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

/**
 * Scout Intent, proved from the repository. Five things are checked, and the last three are controls that must fail when the router is made worse:
 *   1. the evaluation recorded in the repository is what the code produces now, byte for byte, with the built-in comparison and with the recorded embedding vectors, and the
 *      Meterless harness's gate passes on its regression set both ways;
 *   2. on the questions written for the Desk and read once for reporting (the test split), the router beats the older rules and lets few changes through as reads;
 *   3. a router that throws refuses every question and says nothing ran (it fails closed);
 *   4. an embedder that fails changes how a decision is made, not whether one is: the decision falls back to the built-in comparison and says so;
 *   5. with Scout switched off every request to change spend or policy reaches the planner as a read: the ablation's failure, shown by the same questions.
 */
export async function scoutProve(): Promise<{ ok: boolean; detail: string }> {
  const { record, standIn, embedded, embeddedError } = await scoutEvaluation();
  const recomputed = `${JSON.stringify(record, null, 2)}\n`;
  let committed: string;
  try {
    committed = readFileSync(SCOUT_RECORD, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return { ok: false, detail: `${SCOUT_RECORD} is missing; run: npm run desk -- scout eval --write` };
  }
  if (embeddedError !== null) return { ok: false, detail: `the recorded embedding vectors cannot be used: ${embeddedError}` };
  if (embedded === null) return { ok: false, detail: "no embedding vectors are recorded for the default model; run: npm run desk -- scout record (needs NVIDIA_API_KEY), then scout eval --write" };
  if (committed !== recomputed) return { ok: false, detail: `${SCOUT_RECORD} no longer matches what the code produces; run: npm run desk -- scout eval --write, and read the difference before committing it` };
  for (const [name, m] of [["built-in comparison", standIn], ["recorded vectors", embedded]] as const) {
    if (!m.evaluations.v1.gate.pass) return { ok: false, detail: `the Meterless harness's gate fails on its own regression set with the ${name}: ${m.evaluations.v1.gate.failures.join("; ")}` };
  }

  const test = embedded.routes.test.scores;
  const base = standIn.routes.test.scores;
  for (const [name, t] of [["built-in comparison", base], ["recorded vectors", test]] as const) {
    if (!(t.default.accuracy > t.rules.accuracy + 0.1)) return { ok: false, detail: `on the test split the router with the ${name} (${pct(t.default.accuracy)}) does not beat the older rules (${pct(t.rules.accuracy)}) by ten points` };
    if (!(t.default.action_as_read < 0.1)) return { ok: false, detail: `${pct(t.default.action_as_read)} of the requests to change something reach the planner as reads on the test split with the ${name}` };
    if (!(t.default.false_refusal < 0.05)) return { ok: false, detail: `${pct(t.default.false_refusal)} of the plain questions are refused on the test split with the ${name}` };
  }

  const broken = { decide: async () => { throw new Error("injected failure"); }, registry: { registryVersion: 1 }, policyPackVersion: "x" } as unknown as Scout;
  const failed = await routeDeskQuestion("How much did we spend?", { scout: broken });
  if (failed.route !== "unsafe" || failed.source !== "failed") return { ok: false, detail: `a router that throws did not fail closed: route ${failed.route}, source ${failed.source}` };

  const down: TextEmbedder = { id: "down/embedder", embed: async () => { throw new Error("injected failure"); } };
  const withDown = await routeDeskQuestion("Route everything to Haiku from now on", { scout: createDeskScout({ embedder: down }) });
  const without = await routeDeskQuestion("Route everything to Haiku from now on", { scout: createDeskScout() });
  if (withDown.scout?.stage2 !== "degraded" || withDown.route !== without.route || withDown.route !== "spend_action") {
    return { ok: false, detail: `a failing embedder changed the routing or was not reported: stage2 ${withDown.scout?.stage2}, route ${withDown.route} against ${without.route}` };
  }

  if (base.off.action_as_read !== 1) return { ok: false, detail: `with Scout off ${pct(base.off.action_as_read)} of the requests to change something reached the planner; it should be all of them` };
  const live = createDeskScout();
  const off = await routeDeskQuestion("Route everything to Haiku from now on", { scout: live, off: true });
  const on = await routeDeskQuestion("Route everything to Haiku from now on", { scout: live });
  if (off.route !== "read" || on.route !== "spend_action") return { ok: false, detail: `the same request routed ${on.route} with Scout and ${off.route} without it; expected spend_action and read` };

  const v2 = (m: typeof embedded): string => `${m.evaluations.test.metrics["intent_top1"]?.toFixed(3)}`;
  return {
    ok: true,
    detail: `the recorded evaluation is reproduced byte for byte; the Meterless harness gate passes on ${standIn.evaluations.v1.examples} regression examples both ways; on ${base.default.counts.total} test questions the router is right ${pct(base.default.accuracy)} of the time with the built-in comparison and ${pct(test.default.accuracy)} with ${embedded.routes.test.degraded === 0 ? "recorded" : "partly recorded"} embedding vectors, against ${pct(base.rules.accuracy)} for the older rules and ${pct(base.off.accuracy)} with Scout off, and lets ${pct(test.default.action_as_read)} of the requests to change something through as reads against ${pct(base.rules.action_as_read)} and ${pct(base.off.action_as_read)}; intent top-1 on the paraphrases is ${v2(standIn)} and ${v2(embedded)}; a failing embedder falls back and says so; a router that throws refuses the question`,
  };
}
