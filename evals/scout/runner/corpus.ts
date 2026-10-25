#!/usr/bin/env node
/**
 * Runs a Scout implementation over a corpus folder and prints the metrics, the slices, the gate and the misses. Added to the Meterless harness (Apache-2.0) so that a corpus other
 * than v1 and the five added measures can be scored; the original runner (index.ts) is unchanged and still scores v1.
 *
 *   SCOUT_IMPL=/abs/path/to/src/scout-intent/index.ts node --import tsx evals/scout/runner/corpus.ts regression-set/v2/test [all|intent|injection|multi-intent] [--json]
 */
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluate, loadThresholds } from "../../../src/scout-intent/eval.ts";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(join(here, ".."), process.argv[2] ?? "regression-set/v2/test");
const filter = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "all";
const json = process.argv.includes("--json");
const impl = process.env["SCOUT_IMPL"] ?? join(here, "../../../src/scout-intent/index.ts");
const mod = (await import(pathToFileURL(impl).href)) as { Scout: new (o: unknown) => { decide(i: unknown): Promise<never> } };
const scout = new mod.Scout({ intentRegistry: join(here, "../fixtures/intents.json"), policyPack: ["default", "adversarial-tight"] });
const result = await evaluate(scout as never, corpus, loadThresholds(join(here, "../config/thresholds.yaml"), join(here, "../config/thresholds-added.yaml")), filter);
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${result.examples} examples from ${corpus} (${filter})`);
  console.table(Object.fromEntries(Object.entries(result.metrics).map(([k, v]) => [k, Number(v.toFixed(3))])));
  console.log(result.gate.pass ? "gate: PASS" : `gate: FAIL\n  ${result.gate.failures.join("\n  ")}`);
  if (result.gate.notMet.length > 0) console.log(`targets not met:\n  ${result.gate.notMet.join("\n  ")}`);
  for (const m of result.misses) console.log(`miss ${m.id}: ${m.why}\n   ${JSON.stringify(m.prompt).slice(0, 140)}`);
  for (const s of result.skipped) console.log(`skipped ${s.id}: ${s.why}`);
}
process.exit(result.gate.pass ? 0 : 1);
