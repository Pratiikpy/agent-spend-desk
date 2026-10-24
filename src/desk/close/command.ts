import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canaryCommand } from "../canary/command.ts";
import { readRows } from "../canary/store.ts";
import { buildDossier } from "../dossier/build.ts";
import { writeBundleDir } from "../dossier/bundle-io.ts";
import { loadOrCreateSigner, pinsFor } from "../dossier/keys.ts";
import { openLedger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { proposeCommand, type ProposeCommandOptions } from "../propose/command.ts";
import { formatReport } from "../verify/report.ts";
import { verifyBundle } from "../verify/verify.ts";
import { isMonthLabel, lastCompleteMonth, monthBillInput, monthSpan, readMonthRows, snapshotsFromDir, summarise } from "./month-bill.ts";

export interface CloseOptions {
  dbPath: string;
  /** The live price file and the folder that holds every snapshot a ledger may cite. */
  pricesPath: string;
  pricesDir: string;
  month?: string;
  now: Date;
  /** The policy in force. Without it the replay and the drafted change are skipped, and the close says so. */
  policyPath?: string;
  /** Build, sign and verify the month dossier. */
  sign: boolean;
  /** Issue an approval request for the drafted change (needs a policy). */
  askApproval: boolean;
  canaryRunsPath: string;
  sample: boolean;
  keyPath?: string;
  /** Where dossiers are written; the month goes in `month-YYYY-MM` under it. */
  dossierDir: string;
  /** What the propose step needs besides the window. */
  propose: Omit<ProposeCommandOptions, "dbPath" | "pricesPath" | "policyPath" | "window" | "dossier" | "regretPath">;
  proposeDossier?: ProposeCommandOptions["dossier"];
  regretPath?: string;
}

export interface CloseResult {
  text: string;
  /** False when a step could not run for a reason the owner must fix. */
  ok: boolean;
}

const usd = formatUsd;
const n = (x: number): string => x.toLocaleString("en-US");
const share = (a: number, b: number): string => (b === 0 ? "0%" : `${((a / b) * 100).toFixed(1)}%`);

/** The month close, step by step. Reads the ledger; writes only when asked to sign or to request an approval. */
export async function closeCommand(o: CloseOptions): Promise<CloseResult> {
  const label = o.month ?? lastCompleteMonth(o.now);
  if (!isMonthLabel(label)) return { ok: false, text: `--month must look like 2026-09, got "${label}".` };
  const span = monthSpan(label);
  const lines: string[] = [];
  let ok = true;
  const db = openLedger(o.dbPath);
  try {
    const snapshots = snapshotsFromDir(o.pricesDir);
    const live = loadSnapshot(o.pricesPath);
    if (!snapshots.has(live.snapshotId)) snapshots.set(live.snapshotId, live);
    const rows = readMonthRows(db, label, snapshots, live);
    const s = summarise(rows);
    const open = Date.parse(span.until) > o.now.getTime();
    lines.push(`Month close for ${label} (UTC)${open ? ", a month still running: nothing here is final" : ""}`);
    lines.push("");

    lines.push("1. Spend");
    if (rows.cost.length === 0) {
      lines.push(`   The ledger holds no call in ${label}. Run desk ingest first, or name another month.`);
      return { ok: false, text: lines.join("\n") };
    }
    lines.push(`   ${usd(s.pricedMicros)} estimated at list price over ${n(s.calls)} calls (${n(s.unpricedCalls)} on a model with no price: counted, not priced).`);
    lines.push(`   Landed (merged or kept) ${usd(s.landedMicros)}, ${share(s.landedMicros, s.pricedMicros)}; committed ${usd(s.committedMicros)}; not tied to a commit ${usd(s.unlinkedMicros)}, ${share(s.unlinkedMicros, s.pricedMicros)} (unknown, not waste); reverted ${usd(s.revertedMicros)}.`);
    lines.push(
      s.billedMicros === null
        ? "   Billed: no invoice is imported for this month, so there is no billed figure. desk invoices import <file> adds one."
        : `   Billed: ${usd(s.billedMicros)} on the imported invoices, against ${usd(s.pricedMicros)} estimated.`,
    );
    for (const p of rows.problems) lines.push(`   Problem: ${p}.`);
    if (rows.problems.length > 0) ok = false;
    lines.push("");

    lines.push("2. Invoices");
    if (rows.reconciliation.length === 0) lines.push("   No vendor has usage or an invoice recorded for this month in the reconciliation.");
    for (const r of rows.reconciliation) {
      const fig = r.has_invoice ? `billed ${usd(r.billed_micros)}, estimated ${usd(r.estimated_micros)}` : `estimated ${usd(r.estimated_micros)}, nothing billed on record`;
      lines.push(`   ${r.vendor}: ${r.status === "reconciled" ? "reconciled" : r.status === "partial" ? "partly reconciled" : "unreconciled"} (${fig})`);
    }
    if (s.unreconciledVendorMonths > 0) lines.push(`   ${s.unreconciledVendorMonths} of ${s.vendorMonths} vendor month${s.vendorMonths === 1 ? " is" : "s are"} not reconciled; ${s.unreconciledVendorMonths === 1 ? "it stays" : "they stay"} listed as unreconciled in the dossier.`);
    lines.push("");

    lines.push("3. Canary");
    lines.push(...canaryLines(o.canaryRunsPath, o.sample, span.firstDay, span.lastDay));
    lines.push("");

    lines.push("4. Replay and the drafted change");
    if (!o.policyPath) {
      lines.push("   Skipped: name the policy in force with --policy FILE to replay it over this month and draft a change.");
    } else if (!existsSync(o.policyPath)) {
      lines.push(`   Skipped: the policy file ${o.policyPath} does not exist.`);
      ok = false;
    } else {
      const text = await proposeCommand({
        ...o.propose,
        dbPath: o.dbPath,
        pricesPath: o.pricesPath,
        policyPath: o.policyPath,
        window: { sinceIso: span.since, untilIso: `${span.lastDay}T23:59:59.999Z` },
        ...(o.askApproval && o.proposeDossier ? { dossier: o.proposeDossier } : {}),
        ...(o.askApproval && o.regretPath ? { regretPath: o.regretPath } : {}),
      });
      lines.push(...text.split("\n").map((l) => (l === "" ? "" : `   ${l}`)));
      if (!o.askApproval) lines.push("   No approval was requested. Add --ask-approval to request one for this change; the close can finish without it.");
    }
    lines.push("");

    lines.push("5. The month dossier");
    if (!o.sign) {
      lines.push(`   Not built. desk close --month ${label} --sign builds it, signs it, and checks it with the offline verifier.`);
    } else if (rows.problems.length > 0) {
      lines.push("   Not built: fix the problem under step 1 first.");
    } else {
      const dir = join(o.dossierDir, `month-${label}`);
      const signer = loadOrCreateSigner(o.keyPath);
      let built;
      try {
        built = buildDossier(monthBillInput(rows, { snapshots, signer: signer.signer, tenant: "local", now: o.now }).input);
      } catch (e) {
        lines.push(`   Not built: ${(e as Error).message}`);
        return { ok: false, text: lines.join("\n") };
      }
      try {
        writeBundleDir(built.files, dir);
      } catch (e) {
        lines.push(`   Not written: ${(e as Error).message}`);
        return { ok: false, text: lines.join("\n") };
      }
      // The pins file sits beside the bundle, never inside it: the verifier refuses a file the manifest does not list.
      const pinsFile = `${dir}.pins.json`;
      writeFileSync(pinsFile, JSON.stringify(pinsFor(signer.signer), null, 2) + "\n");
      const report = verifyBundle(built.files, { pins: pinsFor(signer.signer) });
      lines.push(`   Signed and written to ${dir}`);
      lines.push(`   Verified here: ${report.overall}. ${formatReport(report, dir).split("\n").slice(0, 1).join(" ")}`);
      lines.push(`   Check it again, offline, with: node src/desk/verify/main.ts ${dir} --pins ${pinsFile}`);
      if (s.longPromptCalls > 0) lines.push(`   ${n(s.longPromptCalls)} calls are priced at the long-prompt rates; the verifier can show the rows add up but not that each call was over the line.`);
      if (signer.created) lines.push(`   A signing key was created (Ed25519, key id ${signer.signer.keyid.slice(0, 16)}); it stays outside the repository.`);
    }
    lines.push("");
    if (o.askApproval && !o.policyPath) ok = false;
    lines.push(
      o.askApproval
        ? o.policyPath
          ? "No policy changes until an approval request above is approved with desk approve."
          : "--ask-approval needs the policy in force: add --policy FILE."
        : "No policy was changed and nothing is waiting for approval.",
    );
    return { ok, text: lines.join("\n") };
  } finally {
    db.close();
  }
}

/** The verdict as of the last run dated inside the month, or what is missing. */
function canaryLines(runsPath: string, sample: boolean, firstDay: string, lastDay: string): string[] {
  if (!existsSync(runsPath)) return [`   No canary runs are stored at ${runsPath}, so there is no verdict for this month.`];
  const { rows } = readRows(runsPath);
  const inside = rows.filter((r) => r.date >= firstDay && r.date <= lastDay);
  if (inside.length === 0) return [`   No canary run is dated inside this month (${rows.length} stored in total), so there is no verdict for it.`];
  const day = Math.max(...inside.map((r) => r.day));
  const report = canaryCommand({ runsPath, sample, day });
  const [verdict = "", reason = ""] = report.text.split("\n").map((l) => l.trim());
  return [`   ${verdict}${reason ? `. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : ""}${reason.endsWith(".") ? "" : "."}`];
}
