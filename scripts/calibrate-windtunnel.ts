// The wind-tunnel coverage study: build the tunnel from the first 30 days of many constructed samples and check
// whether the second 30 days land inside its range. Writes docs/verification/calibration/windtunnel.json.
//   npx tsx scripts/calibrate-windtunnel.ts [--seeds 16] [--policy policies/stop-loops.yaml]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { renderCoverage, summarise, windTunnelTrial, type TunnelTrial } from "../src/desk/calibrate/windtunnel.ts";

const { values } = parseArgs({ options: { seeds: { type: "string", default: "16" }, policy: { type: "string", default: "policies/stop-loops.yaml" }, out: { type: "string", default: "docs/verification/calibration/windtunnel.json" } } });
const n = Number(values.seeds);
const trials: TunnelTrial[] = [];
for (let i = 0; i < n; i += 1) {
  const seed = 20261100 + i;
  const t = await windTunnelTrial({ seed, policyFile: values.policy!, pricesPath: "data/prices/anthropic-litellm-2026-10-22.json" });
  trials.push(t);
  console.error(`seed ${seed}: predicted ${(t.predictedLowMicros / 1e6).toFixed(0)} to ${(t.predictedHighMicros / 1e6).toFixed(0)}, realized ${(t.realizedMicros / 1e6).toFixed(0)}, ${t.inside ? "inside" : "OUTSIDE"}${t.driftFlagged ? ", drift flagged" : ""}`);
}
const c = summarise(values.policy!, trials);
mkdirSync("docs/verification/calibration", { recursive: true });
writeFileSync(values.out!, JSON.stringify(c, null, 1) + "\n");
console.log(renderCoverage(c));
