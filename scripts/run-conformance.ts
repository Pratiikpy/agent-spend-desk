/**
 * Run the Meterless conformance suites against the engines in src/engines/.
 *   npx tsx scripts/run-conformance.ts
 * Each runner exits 0 when every check passes, 1 when a check fails, 2 when the implementation
 * cannot be loaded. This script exits non-zero if any runner does and prints one line per engine.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const engines = [
  { name: "H-MEM", dir: "hmem", env: "HMEM_IMPL", expected: 13 },
  { name: "World Model", dir: "world-model", env: "WORLD_MODEL_IMPL", expected: 8 },
  { name: "Markovian", dir: "markovian", env: "MARKOVIAN_IMPL", expected: 8 },
] as const;

let failed = false;
for (const e of engines) {
  const impl = resolve("src", "engines", e.dir, "index.ts");
  const runner = resolve("vendor", "meterless", e.dir, "conformance", "runner.ts");
  const r = spawnSync(process.execPath, ["--import", "tsx", runner], {
    env: { ...process.env, [e.env]: impl },
    encoding: "utf8",
  });
  const passed = /(\d+)\/(\d+) checks passed/.exec(r.stdout ?? "");
  const ok = r.status === 0 && passed !== null && Number(passed[1]) === e.expected && Number(passed[2]) === e.expected;
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${e.name}: ${passed ? `${passed[1]}/${passed[2]}` : "no result"} checks (expected ${e.expected}), exit ${String(r.status)}`);
  if (!ok) console.log((r.stdout ?? "").split("\n").slice(-12).join("\n") + (r.stderr ?? ""));
}
process.exitCode = failed ? 1 : 0;
