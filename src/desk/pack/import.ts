import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";

import type { Ledger } from "../ledger/db.ts";
import { PolicyError, parsePolicyYaml } from "../policy/parse.ts";
import { policyToDoc, policyWithRules } from "../policy/doc.ts";
import { describeWidening, restrictCheck, type RestrictResult } from "../policy/restrict.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { replayPolicy } from "../replay/policy-replay.ts";
import { baselineReproduction, withheldNotice } from "../replay/reproduction.ts";
import { packDigest, type Pack } from "./pack.ts";

/**
 * Importing a policy pack (DF-065): the pack's rules are added to the policy in force as a draft, and the draft goes through what any edit goes through. The restrict check asks
 * whether the draft permits anything the policy in force denied, over every cell of the grid; a pack that widens, or that changes a route, is rejected here and is not written, so
 * that no pack lowers a guard by being imported. What passes is replayed over the owner's own recent sessions, and written as a draft that starts in shadow: it checks every call
 * and records what it would have denied, and denies nothing, until it has run for a week and the owner has looked.
 */
export const SHADOW_DAYS = 7;

export interface ImportResult {
  status: "drafted" | "rejected";
  reasons: string[];
  draftPath?: string;
  metaPath?: string;
  restrict?: RestrictResult;
  replay?: { sessions: number; paused: number; savedMicros: number; landedBlocked: number; landedTotal: number; asked: number; denied: number } | { withheld: string };
  shadowUntil?: string;
  unsigned: boolean;
}

export interface ImportOptions {
  currentPolicyPath: string;
  draftsDir: string;
  ledger?: Ledger;
  snapshot?: PriceSnapshot;
  window?: { sinceIso: string; untilIso: string };
  now?: () => Date;
  signedBy?: string | null;
}

export function importPolicyPack(pack: Pack, o: ImportOptions): ImportResult {
  const unsigned = !o.signedBy;
  const rejected = (reasons: string[], restrict?: RestrictResult): ImportResult => ({ status: "rejected", reasons, ...(restrict ? { restrict } : {}), unsigned });
  let current;
  try {
    current = parsePolicyYaml(readFileSync(o.currentPolicyPath, "utf8"));
  } catch (e) {
    return rejected([`the policy in force could not be read: ${(e as Error).message}`]);
  }
  const rules = (pack.content as { rules: unknown[] }).rules;
  const taken = new Set(current.rules.map((r) => r.id));
  const clash = rules.map((r) => (r as { id?: unknown }).id).filter((id): id is string => typeof id === "string" && taken.has(id));
  if (clash.length > 0) return rejected([`the pack's rule ${clash.map((c) => JSON.stringify(c)).join(", ")} has the id of a rule already in force; ids are not reused, so the pack cannot say which it means`]);
  let next;
  try {
    next = policyWithRules(current, rules);
  } catch (e) {
    return rejected([e instanceof PolicyError ? `the pack's rules are not valid policy: ${e.message}` : `the pack's rules could not be read: ${(e as Error).message}`]);
  }
  const restrict = restrictCheck(current, next);
  const reasons: string[] = [];
  if (restrict.outsideFragment) reasons.push("the change is too large for the restrict check to settle, so it is not taken in without a stronger check");
  if (!restrict.narrows && restrict.widening) reasons.push(`the pack would permit something the policy in force denies: ${describeWidening(restrict.widening)}. A pack that widens is not imported; the owner makes that change by hand, with an approval.`);
  if (restrict.routeChanges.length > 0) reasons.push(`the pack changes which model a request is sent to (${restrict.routeChanges.length} change${restrict.routeChanges.length === 1 ? "" : "s"}); a route change is never a narrowing and needs an approval with a replay of its own`);
  if (reasons.length > 0) return rejected(reasons, restrict);

  let replay: ImportResult["replay"];
  if (o.ledger && o.snapshot) {
    const since = o.window?.sinceIso ?? new Date(((o.now ?? (() => new Date()))()).getTime() - 30 * 86_400_000).toISOString();
    const until = o.window?.untilIso ?? "9999";
    const sessions = replaySessionsFromLedger(o.ledger, o.snapshot, since, until);
    if (sessions.length === 0) replay = { withheld: "there are no sessions in the ledger over that period to replay it on" };
    else {
      const repro = baselineReproduction(o.ledger, sessions, since, until);
      if (!repro.reproduces) replay = { withheld: withheldNotice(repro).split("\n")[0] as string };
      else {
        const r = replayPolicy(next, sessions);
        replay = { sessions: sessions.length, paused: r.paused.length, savedMicros: r.savedMicros, landedBlocked: r.landedBlocked.length, landedTotal: r.landedTotal, asked: r.askedCalls, denied: r.deniedCalls };
      }
    }
  }
  const now = (o.now ?? (() => new Date()))();
  const shadowUntil = new Date(now.getTime() + SHADOW_DAYS * 86_400_000).toISOString();
  mkdirSync(o.draftsDir, { recursive: true });
  const draftPath = join(o.draftsDir, `${pack.name}-${pack.version}.yaml`);
  const metaPath = join(o.draftsDir, `${pack.name}-${pack.version}.meta.json`);
  writeFileSync(draftPath, stringify(policyToDoc(next)));
  writeFileSync(metaPath, `${JSON.stringify({ pack: pack.name, version: pack.version, kind: pack.kind, digest: packDigest(pack), importedAt: now.toISOString(), shadowUntil, status: "shadow", signedBy: o.signedBy ?? null, basedOn: o.currentPolicyPath }, null, 2)}\n`);
  return { status: "drafted", reasons: [], draftPath, metaPath, restrict, ...(replay ? { replay } : {}), shadowUntil, unsigned };
}
