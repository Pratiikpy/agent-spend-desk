import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDossier } from "../dossier/build.ts";
import { writeBundleDir } from "../dossier/bundle-io.ts";
import { loadOrCreateSigner, pinsFor } from "../dossier/keys.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { formatReport } from "../verify/report.ts";
import { verifyBundle } from "../verify/verify.ts";
import { isMonthLabel, lastCompleteMonth } from "../close/month-bill.ts";
import { auditInvoices, DEFAULT_DEFINITION, parseDefinition } from "./audit.ts";
import { disputePackInput } from "./audit-pack.ts";
import { renderAudit } from "./audit-report.ts";

export interface AuditCommandOptions {
  snapshot: PriceSnapshot;
  vendor?: string;
  month?: string;
  /** The owner's definition of an outcome, a JSON file; without it the default definition is used and said so. */
  definitionPath?: string;
  /** Build, sign and check a dispute pack under this folder. */
  packDir?: string;
  keyPath?: string;
  now?: Date;
}

/** `desk invoices audit`: hold one vendor's per-outcome lines for a month to the owner's definition of an outcome, and write a dispute pack when asked. */
export function auditCommand(db: Ledger, o: AuditCommandOptions): { ok: boolean; text: string } {
  const now = o.now ?? new Date();
  const month = o.month ?? lastCompleteMonth(now);
  if (!isMonthLabel(month)) return { ok: false, text: `--month must look like 2026-10, got "${month}".` };
  let vendor = o.vendor?.trim().toLowerCase();
  if (!vendor) {
    const vendors = (db.prepare("SELECT DISTINCT vendor FROM invoice WHERE substr(period_end, 1, 7) >= ? AND substr(period_start, 1, 7) <= ? ORDER BY vendor").all(month, month) as unknown as { vendor: string }[]).map((r) => r.vendor);
    if (vendors.length === 0) return { ok: false, text: `No invoice covers ${month}. Import one with desk invoices import, then run this again.` };
    if (vendors.length > 1) return { ok: false, text: `Invoices from ${vendors.join(", ")} cover ${month}. Say which to audit with --vendor.` };
    vendor = vendors[0] as string;
  }
  let definition = DEFAULT_DEFINITION;
  let note = "No --definition was given, so the default definition is used: ";
  if (o.definitionPath !== undefined) {
    if (!existsSync(o.definitionPath)) return { ok: false, text: `The definition file ${o.definitionPath} does not exist.` };
    try {
      definition = parseDefinition(readFileSync(o.definitionPath, "utf8"));
    } catch (e) {
      return { ok: false, text: `The definition file ${o.definitionPath} was not read: ${(e as Error).message}.` };
    }
    note = "";
  }
  const result = auditInvoices(db, o.snapshot, { vendor, month, definition });
  if (result.kind === "cannot_run") return { ok: false, text: `The audit cannot run: ${result.reason}.` };
  const lines = [renderAudit(result.audit)];
  if (note !== "") lines.push("", `${note}a ${definition.unit} is a session whose work was merged or kept. Write your own as a JSON file and pass it with --definition.`);

  if (o.packDir !== undefined) {
    lines.push("");
    const signer = loadOrCreateSigner(o.keyPath);
    try {
      const pack = disputePackInput(result.audit, { signer: signer.signer, tenant: "local", now });
      const built = buildDossier(pack.input);
      const dir = join(o.packDir, `dispute-${vendor}-${month}`);
      writeBundleDir(built.files, dir);
      const pinsFile = `${dir}.pins.json`;
      writeFileSync(pinsFile, JSON.stringify(pinsFor(signer.signer), null, 2) + "\n");
      const report = verifyBundle(built.files, { pins: pinsFor(signer.signer) });
      lines.push(`Dispute pack written to ${dir} (${pack.rows.lines} lines, ${pack.rows.days} days, ${pack.rows.duplicates} possible duplicates). It holds the vendor's own lines, the day counts and the sums: no prompt, code, path, session id or project name.`);
      lines.push(`Verified here: ${report.overall}. ${formatReport(report, dir).split("\n").slice(0, 1).join(" ")}`);
      lines.push(`The verifier recomputes the sums over the rows. It does not recompute how outcomes were given out to lines; the day counts are in the pack so a person can. Check it offline: node src/desk/verify/main.ts ${dir} --pins ${pinsFile}`);
      if (signer.created) lines.push(`A signing key was created (Ed25519, key id ${signer.signer.keyid.slice(0, 16)}); it stays outside the repository.`);
    } catch (e) {
      lines.push(`The dispute pack was not built: ${(e as Error).message}`);
      return { ok: false, text: lines.join("\n") };
    }
  }
  return { ok: true, text: lines.join("\n") };
}
