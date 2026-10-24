// A child process for the bypass tests: opens the gate's database, waits for a shared start time, sends authorize requests
// as fast as it can, and prints what the gate answered. Run with tsx; it is not a test file.
import { DatabaseSync } from "node:sqlite";

import { Gate } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../../src/desk/gate/policy-source.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { testSnapshot } from "../helpers.ts";
import { POLICY_YAML } from "./harness.ts";

const [dbPath, workerId, count, startAt, sharedKey] = process.argv.slice(2);
if (!dbPath || !workerId || !count || !startAt) {
  console.error("usage: worker.ts <db> <id> <count> <start epoch ms> [shared key]");
  process.exit(2);
}
const gate = new Gate({
  db: new DatabaseSync(dbPath),
  prices: testSnapshot(),
  policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)),
  person: "p-1",
  busyTimeoutMs: 15_000,
});
while (Date.now() < Number(startAt)) {
  /* spin until the shared start, so the processes collide */
}
const results: { key: string; outcome: string; reservationId: number | null }[] = [];
for (let i = 0; i < Number(count); i += 1) {
  const key = sharedKey ? `${sharedKey}-${i}` : `w${workerId}-${i}`;
  try {
    const d = gate.authorize({ session_id: `s-${workerId}`, person: "p-1", project: "repo:acme/api", model: "claude-opus-5", input_tokens: 0, max_tokens: 100_000, idempotency_key: key });
    results.push({ key, outcome: d.verdict, reservationId: d.reservationId ?? null });
  } catch (error) {
    results.push({ key, outcome: `error:${(error as { code?: string }).code ?? "unknown"}`, reservationId: null });
  }
}
process.stdout.write(`${JSON.stringify({ worker: workerId, results })}\n`);
