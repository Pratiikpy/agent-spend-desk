import type { Report } from "./verify.ts";

/** Plain text for a terminal. Every run prints what PASS means and what it does not. */
export function formatReport(report: Report, bundle: string): string {
  const out: string[] = [`desk-verify ${bundle}`, ""];
  for (const l of report.levels) {
    out.push(`${l.id.padEnd(5)} ${l.status.padEnd(14)} ${l.name}`);
    for (const f of l.findings) out.push(`        ${f.code}: ${f.detail}`);
    for (const n of l.notes) out.push(`        note: ${n}`);
  }
  out.push("");
  const reason =
    report.overall === "INDETERMINATE" && !report.pinned ? " (no --pins were given, so the signer is not established)" : "";
  out.push(`RESULT: ${report.overall}${reason}`);
  out.push("");
  out.push(`PASS means: ${report.means}`);
  out.push(`${report.doesNotMean}`);
  return out.join("\n");
}

export function exitCode(report: Report): number {
  return report.overall === "PASS" ? 0 : report.overall === "FAIL" ? 1 : 3;
}
