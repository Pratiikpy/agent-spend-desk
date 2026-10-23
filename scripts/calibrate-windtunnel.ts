// The wind-tunnel coverage study: build the tunnel from the first 30 days of many constructed samples and check
// whether the second 30 days land inside its range. Writes docs/verification/calibration/windtunnel.json.
//   npx tsx scripts/calibrate-windtunnel.ts [--seeds 16] [--policy policies/stop-loops.yaml] [--control]
// --control builds the same samples with no change of tool version or model mix, so the second month holds nothing the history could not show.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { renderCoverage, summarise, windTunnelTrial, type TunnelTrial } from "../src/desk/calibrate/windtunnel.ts";

const { values } = parseArgs({ options: { seeds: { type: "string", default: "16" }, policy: { type: "string", default: "policies/stop-loops.yaml" }, control: { type: "boolean", default: false }, out: { type: "string" } } });
const outFile = values.out ?? (values.control ? "docs/verification/calibration/windtunnel-control.json" : "docs/verification/calibration/windtunnel.json");
const n = Number(values.seeds);
// Each finished trial is appended here so a run that is interrupted resumes where it stopped.
const partial = values.control ? "data/desk/windtunnel-control-partial.jsonl" : "data/desk/windtunnel-partial.jsonl";
mkdirSync("data/desk", { recursive: true });
const trials: TunnelTrial[] = existsSync(partial) ? readFileSync(partial, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TunnelTrial) : [];
for (let i = 0; i < n; i += 1) {
  const seed = 20261100 + i;
  if (trials.some((x) => x.seed === seed)) continue;
  const t = await windTunnelTrial({ seed, policyFile: values.policy!, pricesPath: "data/prices/anthropic-litellm-2026-10-22.json", noChange: values.control });
  trials.push(t);
  appendFileSync(partial, JSON.stringify(t) + "\n");
  console.error(`seed ${seed}: predicted ${(t.predictedLowMicros / 1e6).toFixed(0)} to ${(t.predictedHighMicros / 1e6).toFixed(0)}, realized ${(t.realizedMicros / 1e6).toFixed(0)}, ${t.inside ? "inside" : "OUTSIDE"}${t.driftFlagged ? ", drift flagged" : ""}`);
}
const c = { ...summarise(values.policy!, trials.sort((a, b) => a.seed - b.seed)), control: values.control };
mkdirSync("docs/verification/calibration", { recursive: true });
writeFileSync(outFile, JSON.stringify(c, null, 1) + "\n");
console.log(renderCoverage(c));
