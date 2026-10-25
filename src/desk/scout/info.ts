import { existsSync, readFileSync } from "node:fs";

/**
 * What the trace says about Scout Intent next to the three vendored engines. Meterless gives Scout a specification and an evaluation harness, not a reference implementation or a
 * conformance runner, so the Desk's Scout is its own and its "conformance" is the harness's gate on the corpus the Desk recorded (`desk scout eval --write`).
 */
export const SCOUT_RECORD = "docs/verification/scout/harness-v1.json";
const SPEC = "meterless-0aa7417 (specification)";

export function scoutInfo(file = SCOUT_RECORD): { impl: string; conformance: string } {
  const impl = `desk/scout-intent@${SPEC}`;
  if (!existsSync(file)) return { impl, conformance: "no harness run recorded" };
  try {
    const r = JSON.parse(readFileSync(file, "utf8")) as { standIn: { examples: number; gate: { pass: boolean } } };
    return { impl, conformance: `harness v1 gate ${r.standIn.gate.pass ? "PASS" : "FAIL"} (${r.standIn.examples} examples)` };
  } catch {
    return { impl, conformance: "harness record unreadable" };
  }
}
