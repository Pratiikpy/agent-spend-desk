import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stringify } from "yaml";

import { hashJson } from "../../runtime/canonical.ts";
import type { Ledger } from "../ledger/db.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { policyToDoc } from "../policy/doc.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { baselineReproduction, withheldNotice } from "../replay/reproduction.ts";
import { calibrateRules, renderCalibration, type RuleCalibration } from "./rules.ts";

/** The sessions whose landing the ledger actually holds: git was scanned for them and they are tied to a commit. A session that is `unlinked` is not known to have landed nothing, so it is not here. */
export function landingKnown(db: Ledger): Set<string> {
  const has = ((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'session_outcome'").get() as { n: number }).n ?? 0) > 0;
  return has ? new Set((db.prepare("SELECT session_id FROM session_outcome WHERE state != 'unlinked'").all() as unknown as { session_id: string }[]).map((r) => r.session_id)) : new Set<string>();
}

export interface RuleCalibrationOptions {
  db: Ledger;
  snapshot: PriceSnapshot;
  policyPath: string;
  sinceIso?: string;
  untilIso?: string;
  /** Write the offered policies here, one file for each rule that misfires and has a higher threshold to offer. */
  outDir?: string;
}

/**
 * `desk calibrate rules`: for each rule of the policy in force, the sessions it stopped or asked about and how many of them landed work afterwards, and an offer for
 * a rule that misfires. The replay is withheld, with the reason, when the policy replayed over the recorded sessions does not reproduce the recorded spend.
 */
export function ruleCalibrationCommand(o: RuleCalibrationOptions): { text: string; rows: RuleCalibration[]; files: string[] } {
  const since = o.sinceIso ?? "0000";
  const until = o.untilIso ?? "9999";
  const sessions = replaySessionsFromLedger(o.db, o.snapshot, since, until, {});
  if (sessions.length === 0) return { text: "No sessions in the ledger for this period. Run `desk card` (or `desk ingest`) first.", rows: [], files: [] };
  const reproduction = baselineReproduction(o.db, sessions, since, until);
  if (!reproduction.reproduces) return { text: withheldNotice(reproduction), rows: [], files: [] };
  const policy = parsePolicyYaml(readFileSync(o.policyPath, "utf8"));
  const known = landingKnown(o.db);
  const rows = calibrateRules(policy, sessions, known);
  const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const period = `${day(sessions[0]!.startMs)} to ${day(sessions[sessions.length - 1]!.startMs)}, ${sessions.length.toLocaleString("en-US")} sessions, ${known.size.toLocaleString("en-US")} with a known landing`;
  const lines = [renderCalibration(rows, period)];
  const files: string[] = [];
  if (o.outDir) {
    mkdirSync(o.outDir, { recursive: true });
    for (const r of rows) {
      if (!r.proposal || "none" in r.proposal) continue;
      const id = hashJson(policyToDoc(r.proposal.policy) as never).replace("sha256:", "").slice(0, 12);
      const file = join(o.outDir, `calibration-${r.ruleId.replace(/[^A-Za-z0-9_-]/g, "_")}-${id}.yaml`);
      writeFileSync(file, stringify(policyToDoc(r.proposal.policy)));
      files.push(file);
    }
    if (files.length > 0) lines.push("", `written: ${files.join(", ")}`);
  }
  return { text: lines.join("\n"), rows, files };
}

/**
 * One line for the weekly review: how many of the policy's rules misfire on the owner's history, hold up, or have too little to say, and the command that shows which.
 * Looks back ninety days, because twenty flags with a known landing take longer than a week to find. Null when there is nothing to read.
 */
export function ruleCalibrationLine(o: Omit<RuleCalibrationOptions, "outDir"> & { untilMs: number }): string | null {
  const r = ruleCalibrationCommand({ ...o, sinceIso: new Date(o.untilMs - 90 * 86_400_000).toISOString(), untilIso: new Date(o.untilMs).toISOString() });
  if (r.rows.length === 0) return null;
  const fired = r.rows.filter((x) => x.status !== "never_fired");
  if (fired.length === 0) return "No rule of the policy stopped or asked about a session in the last 90 days, so there is nothing yet to check against what landed.";
  const mis = fired.filter((x) => x.status === "misfires").map((x) => x.ruleId);
  const ok = fired.filter((x) => x.status === "ok").length;
  const few = fired.filter((x) => x.status === "not_enough_data").length;
  const parts = [`${mis.length} misfire${mis.length === 1 ? "s" : ""} on your data${mis.length > 0 ? ` (${mis.join(", ")})` : ""}`, `${ok} hold${ok === 1 ? "s" : ""} up`, `${few} ${few === 1 ? "has" : "have"} too little to say`];
  return `Of the ${fired.length} rule${fired.length === 1 ? "" : "s"} that fired in the last 90 days, ${parts.join(", ")}. \`desk calibrate rules\` shows each rule's stops, how many landed, and what a higher threshold would do.`;
}
