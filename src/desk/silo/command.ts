import { configFromEnv, type ServeOptions } from "../../sponsors/zetaris/silo-port.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { openLedger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { ciSummary, fetchSiloFacts, reconcile, type SiloFacts } from "./facts.ts";
import { deriveSeed, writeSeed } from "./seed.ts";

export interface SilosOptions {
  dbPath: string;
  cassetteDir: string;
  sampleMode: boolean;
  record: boolean;
  /** Show the answer without Zetaris. */
  disabled: boolean;
  env: Record<string, string | undefined>;
}

const usd = (n: number | null): string => (n === null ? "n/a" : `$${n.toFixed(2)}`);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** `desk silos seed`: derive the three seed files from the ledger. */
export function silosSeed(dbPath: string, outDir: string): string {
  const db = openLedger(dbPath);
  try {
    const seed = deriveSeed(db);
    if (seed.invoiceLines.length === 0) return "The ledger has no priced calls that map to a team, so there is nothing to seed. Run `desk card --sample` first.";
    const files = writeSeed(seed, outDir);
    return [
      `seeded ${seed.invoiceLines.length} invoice lines, ${seed.pullRequests.length} pull requests, ${seed.roster.length} teams (all synthetic)`,
      `files: ${files.invoices}, ${files.ci}, ${files.roster}`,
      `load them into the silos (inside WSL): bash infra/silos/load-sample-silos.sh ${outDir}`,
    ].join("\n");
  } finally {
    db.close();
  }
}

export function renderSilos(f: SiloFacts, rec: ReturnType<typeof reconcile>, ci: ReturnType<typeof ciSummary>): string {
  const out: string[] = [];
  const modes = Object.entries(f.served).map(([k, v]) => `${k}: ${v}`).join("  ");
  out.push(`Zetaris silos  ${modes}`);
  for (const r of f.reasons) out.push(`  fell back: ${r}`);
  out.push("");
  if (f.headline.length > 0) {
    out.push("Spend per landed pull request, by team (one statement over three silos)");
    for (const h of f.headline) out.push(`  ${h.team.padEnd(10)} ${String(h.seats).padStart(3)} seats ${h.seatPlan.padEnd(14)} ${String(h.landedPrs).padStart(4)} landed PRs  billed ${usd(h.billedUsd).padStart(10)}  per landed PR ${usd(h.usdPerLandedPr).padStart(8)}`);
  } else {
    out.push("Spend per landed pull request: not available (the silos did not answer).");
  }
  out.push("");
  const total = rec.ledgerEstimatedMicros;
  out.push(`Bill classes: billed ${formatUsd(rec.billedMicros)} (invoice amounts, covering ${pct(rec.billedShare)} of the ledger), estimated only ${formatUsd(rec.estimatedOnlyMicros)}; ledger list-price estimate ${formatUsd(total)}`);
  if (rec.estimatedOfBilledMicros > 0) {
    const d = (rec.billedMicros - rec.estimatedOfBilledMicros) / rec.estimatedOfBilledMicros;
    out.push(`On the part with invoices, the invoice is ${d >= 0 ? "above" : "below"} the list-price estimate by ${pct(Math.abs(d))}.`);
  } else {
    out.push("No invoice covers any spend, so every figure is an estimate and nothing is billed.");
  }
  out.push("");
  if (f.prs.length > 0) {
    out.push(`CI facts: of ${ci.landedWithCi + ci.landedNoPr} landed sessions, ${ci.landedWithCi} have a pull request row; ${ci.landedGreen} merged on green checks, ${ci.landedRed} merged although checks were red, ${ci.landedReverted} were later reverted.`);
  } else {
    out.push("CI facts: not available, so landing stops at what git shows (committed, merged, kept) and cannot say whether checks passed.");
  }
  const skipped = Object.values(f.skipped).reduce((a, b) => a + b, 0);
  if (skipped > 0) out.push(`${skipped} rows did not parse and were skipped.`);
  out.push("All silo data is synthetic, derived from the constructed sample.");
  return out.join("\n");
}

export async function silosCommand(o: SilosOptions): Promise<string> {
  const db = openLedger(o.dbPath);
  try {
    const trace = new MemoryTrace();
    const opts: ServeOptions = { sample: o.sampleMode, cassetteDir: o.cassetteDir, record: o.record, config: configFromEnv(o.env), disabled: o.disabled, trace };
    const facts = await fetchSiloFacts(opts);
    const text = renderSilos(facts, reconcile(db, facts.invoices), ciSummary(db, facts.prs));
    const lines = trace.events.filter((e) => e.event === "desk.ingest").map((e) => `  ${JSON.stringify(e.detail)}`);
    return `${text}\n\ntrace\n${lines.join("\n")}`;
  } finally {
    db.close();
  }
}
