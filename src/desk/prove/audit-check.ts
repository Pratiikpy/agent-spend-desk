import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { auditInvoices } from "../billing/audit.ts";
import { disputePackInput } from "../billing/audit-pack.ts";
import { readCsvInvoice } from "../billing/import.ts";
import { storeInvoice } from "../billing/store.ts";
import { buildDossier } from "../dossier/build.ts";
import { createSignerFile, pinsFor } from "../dossier/keys.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { verifyBundle } from "../verify/verify.ts";

/**
 * The bill auditor against an independent oracle (DF-062), on the sample ledger. The sample's sessions and their outcomes are real rows of a constructed ledger. An
 * invoice is built from them that charges two more outcomes than the sessions meeting the default definition could back on each of five days. The audit's count of
 * backed outcomes is then compared with a maximum matching worked out by a different method (augmenting paths, where the audit gives sessions out earliest-end-first),
 * the pack is built and checked by the offline verifier, no session id or project path of the ledger may appear in it, and a changed row must be refused.
 */
export function auditProve(db: Ledger, snapshot: PriceSnapshot): { ok: boolean; detail: string } {
  const sessions = db
    .prepare("SELECT m.session_id AS id, MIN(m.ts) AS first, MAX(m.ts) AS last, COUNT(*) AS calls, o.state AS state FROM model_call m JOIN session_outcome o ON o.session_id = m.session_id GROUP BY m.session_id")
    .all() as unknown as { id: string; first: string; last: string; calls: number; state: string }[];
  const backers = sessions.filter((s) => (s.state === "merged" || s.state === "kept") && s.calls >= 3).map((s) => ({ id: s.id, from: s.first.slice(0, 10), to: s.last.slice(0, 10) }));
  if (backers.length < 5) return { ok: false, detail: `the sample holds only ${backers.length} sessions that meet the default definition, too few to test with` };
  const covering = (d: string): number => backers.filter((b) => b.from <= d && b.to >= d).length;
  const tally = new Map<string, number>();
  for (const b of backers) tally.set(b.from.slice(0, 7), (tally.get(b.from.slice(0, 7)) ?? 0) + 1);
  const month = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  const days = [...new Set(backers.flatMap((b) => [b.from, b.to]))]
    .filter((d) => d.startsWith(month))
    .sort((a, b) => covering(b) - covering(a) || a.localeCompare(b))
    .slice(0, 5)
    .sort();
  if (days.length < 3) return { ok: false, detail: `the sample's qualifying sessions fall on only ${days.length} days of ${month}` };
  const billed = days.map((d) => ({ day: d, units: covering(d) + 2 }));
  const csv = ["Invoice,Date,Description,Quantity,Amount (USD)", ...billed.map((b) => `PROVE-1,${b.day},Resolution,${b.units},${b.units}.00`)].join("\n");
  storeInvoice(db, readCsvInvoice(csv, { vendor: "provebot", sourceName: "prove.csv" }));
  const r = auditInvoices(db, snapshot, { vendor: "provebot", month });
  if (r.kind !== "audit") return { ok: false, detail: `the audit did not run on a constructed invoice: ${r.reason}` };
  const a = r.audit;

  // The oracle: one slot for each billed outcome, on its day, matched to sessions whose span covers the day, by augmenting paths.
  const slots = billed.flatMap((b) => Array.from({ length: b.units }, () => b.day));
  const matchOf = new Map<string, number>();
  const tryFor = (slot: number, seen: Set<string>): boolean => {
    for (const b of backers) {
      if (b.from > (slots[slot] as string) || b.to < (slots[slot] as string) || seen.has(b.id)) continue;
      seen.add(b.id);
      const held = matchOf.get(b.id);
      if (held === undefined || tryFor(held, seen)) {
        matchOf.set(b.id, slot);
        return true;
      }
    }
    return false;
  };
  let expected = 0;
  for (let i = 0; i < slots.length; i += 1) if (tryFor(i, new Set())) expected += 1;
  if (a.totals.supportedUnits !== expected) return { ok: false, detail: `the audit backs ${a.totals.supportedUnits} outcomes and an independent maximum matching backs ${expected}` };
  if (a.totals.billedUnits !== slots.length || a.totals.unsupportedUnits !== slots.length - expected) return { ok: false, detail: `the audit's counts (${a.totals.billedUnits} charged, ${a.totals.unsupportedUnits} unsupported) do not add up to the invoice's ${slots.length}` };
  if (a.totals.unsupportedUnits < 2) return { ok: false, detail: "an invoice charging two outcomes more than could be backed found fewer than two unsupported" };

  const dir = mkdtempSync(join(tmpdir(), "desk-prove-audit-"));
  try {
    const signer = createSignerFile(join(dir, "key.pem")).signer;
    const built = buildDossier(disputePackInput(a, { signer, tenant: "local", now: new Date("2026-11-03T00:00:00Z") }).input);
    const report = verifyBundle(built.files, { pins: pinsFor(signer) });
    if (report.overall !== "PASS") return { ok: false, detail: `the dispute pack did not pass the offline verifier: ${report.overall}` };
    const text = [...built.files.values()].map((b) => Buffer.from(b).toString("utf8")).join("\n");
    const leaked = sessions.find((s) => text.includes(s.id));
    if (leaked) return { ok: false, detail: `the pack carries a session id of the ledger (${leaked.id.slice(0, 8)}...)` };
    const projects = (db.prepare("SELECT DISTINCT project_path AS p FROM session WHERE project_path IS NOT NULL").all() as unknown as { p: string }[]).map((x) => x.p).filter((p) => p.length > 3);
    if (projects.some((p) => text.includes(p))) return { ok: false, detail: "the pack carries a project path of the ledger" };
    const files = new Map(built.files);
    const key = [...files.keys()].find((k) => k.startsWith("rows/audit_line"))!;
    const before = Buffer.from(files.get(key)!).toString("utf8");
    const changed = before.replace(/"unsupported_units":(\d+)/, (_m, d: string) => `"unsupported_units":${Number(d) + 7}`);
    if (changed === before) return { ok: false, detail: "no row could be changed to test the verifier" };
    files.set(key, new TextEncoder().encode(changed));
    if (verifyBundle(files, { pins: pinsFor(signer) }).overall !== "FAIL") return { ok: false, detail: "the verifier accepted a pack with a changed row" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    ok: true,
    detail: `${days.length} days of ${month} charged ${slots.length} outcomes against ${backers.length} qualifying sessions: the audit backs ${expected} and so does an independent maximum matching; the pack passes the offline verifier, carries no session id or project path, and is refused when a row is changed`,
  };
}
