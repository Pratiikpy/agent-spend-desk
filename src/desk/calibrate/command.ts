import { existsSync, readFileSync } from "node:fs";

import { openLedger } from "../ledger/db.ts";
import { attributionReliability, renderAttribution, type FateTruth } from "./attribution.ts";
import { renderCoverage, type TunnelCoverage } from "./windtunnel.ts";

export const COVERAGE_FILE = "docs/verification/calibration/windtunnel.json";

/** `desk calibrate`: does stated confidence mean what it says? Needs the sample's planted truth. */
export function calibrateCommand(o: { dbPath: string; truthPath: string }): string {
  if (!existsSync(o.truthPath)) return `Calibration compares the Desk with planted truth, which only the constructed sample has (${o.truthPath} is missing). Run: desk --sample`;
  const truth = (JSON.parse(readFileSync(o.truthPath, "utf8")) as { sessions: FateTruth[] }).sessions;
  const db = openLedger(o.dbPath);
  try {
    const out = [renderAttribution(attributionReliability(db, truth))];
    if (existsSync(COVERAGE_FILE)) out.push("", renderCoverage(JSON.parse(readFileSync(COVERAGE_FILE, "utf8")) as TunnelCoverage));
    else out.push("", `The wind-tunnel coverage study has not been recorded (${COVERAGE_FILE}); run scripts/calibrate-windtunnel.ts.`);
    return out.join("\n");
  } finally {
    db.close();
  }
}
