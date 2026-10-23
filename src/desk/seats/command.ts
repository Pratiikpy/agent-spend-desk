import { configFromEnv, type ServeOptions } from "../../sponsors/zetaris/silo-port.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { openLedger } from "../ledger/db.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { fetchSiloFacts } from "../silo/facts.ts";
import { renderSeats, seatReturn } from "./seats.ts";

export interface SeatsOptions {
  dbPath: string;
  pricesPath: string;
  cassetteDir: string;
  sampleMode: boolean;
  record: boolean;
  env: Record<string, string | undefined>;
  windowDays: number;
  /** An ISO date; the window ends at the end of this day. Default: the last day in the ledger. */
  asOf?: string;
}

/** `desk seats`: seats a team holds beyond the people who landed work, from the roster in Zetaris and the ledger. */
export async function seatsCommand(o: SeatsOptions): Promise<string> {
  if (!Number.isInteger(o.windowDays) || o.windowDays < 1 || o.windowDays > 365) return "--window is a whole number of days from 1 to 365.";
  const db = openLedger(o.dbPath);
  try {
    const sessions = replaySessionsFromLedger(db, loadSnapshot(o.pricesPath), "0000", "9999", { personFromBranch: o.sampleMode });
    if (sessions.length === 0) return "No sessions in the ledger yet. Run `desk card` (or `desk ingest`) first.";
    const asOfMs = o.asOf ? Date.parse(`${o.asOf}T23:59:59Z`) : Math.max(...sessions.map((s) => s.startMs));
    if (Number.isNaN(asOfMs)) return `--as-of must be a date such as 2026-10-30, not ${o.asOf}.`;
    const trace = new MemoryTrace();
    const opts: ServeOptions = { sample: o.sampleMode, cassetteDir: o.cassetteDir, record: o.record, config: configFromEnv(o.env), disabled: false, trace };
    const facts = await fetchSiloFacts(opts);
    if (facts.roster.length === 0) return `The roster is not available (${facts.reasons.find((r) => r.startsWith("roster")) ?? "no rows"}), so seats cannot be compared with who landed work.`;
    return renderSeats(seatReturn(sessions, facts.roster, { asOfMs, windowDays: o.windowDays }), { asOfMs, windowDays: o.windowDays });
  } finally {
    db.close();
  }
}
