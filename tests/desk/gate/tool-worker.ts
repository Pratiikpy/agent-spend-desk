// A child process for the tool-guard race test: opens the gate's database, waits for a shared start time, asks the exactly-once guard to begin the same mutating tool call
// several times, and prints how many times it was told to proceed. Run with tsx; it is not a test file.
import { DatabaseSync } from "node:sqlite";

import { Gate } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../../src/desk/gate/policy-source.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { testSnapshot } from "../helpers.ts";
import { POLICY_YAML } from "./harness.ts";

const [dbPath, count, startAt] = process.argv.slice(2);
if (!dbPath || !count || !startAt) {
  console.error("usage: tool-worker.ts <db> <count> <start epoch ms>");
  process.exit(2);
}
const gate = new Gate({ db: new DatabaseSync(dbPath), prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)), person: "p-1", busyTimeoutMs: 15_000 });
while (Date.now() < Number(startAt)) {
  /* spin until the shared start, so the processes collide */
}
const outcomes: string[] = [];
for (let i = 0; i < Number(count); i += 1) {
  try {
    outcomes.push(gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1200, to: "acct_1" } }).status);
  } catch (error) {
    outcomes.push(`error:${(error as { code?: string }).code ?? "unknown"}`);
  }
}
process.stdout.write(`${JSON.stringify({ outcomes })}\n`);
