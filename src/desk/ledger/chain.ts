import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { canonicalJson } from "../../runtime/canonical.ts";
import { priceCall } from "../cost/price-call.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { GENESIS_HASH, computeRowHash } from "../verify/format.ts";
import type { Ledger } from "./db.ts";

/**
 * The usage ledger's chain (DF-071). The ledger is a SQLite projection of logs, and it is rewritten by design: a content block merges into a call, a price list is
 * applied again, a forgotten session is deleted. A chain over its rows would fight that. So the chain is over what happens to the ledger. Every ingest, repricing,
 * backfill and forget appends an event: its number (gapless), what it was, a digest of the usage facts of every source file, the hash of the event before it, and its own
 * hash. A source's digest covers the usage facts of its calls (id, session, time, model, token counts). Taken together:
 *
 *   - editing, deleting or reordering an event breaks a hash or leaves a gap;
 *   - editing a call's tokens outside the Desk makes its source's digest differ from the one the last event sealed;
 *   - changing a digest to match breaks the event that holds the root of all digests;
 *   - cutting events off the end is seen against the head file the Desk keeps beside the ledger, which repeats each event's number and hash and is chained itself;
 *   - with `deep`, every stored cost is worked out again from the facts and the price list it names, and a difference is reported.
 *
 * What it cannot see: a change made, and then sealed by a forged event, by someone who also rewrites the head file; a change to anything but the usage facts and the
 * costs (a landing outcome, a task label); and anything before the first event, which says in its own record that the ledger was adopted as it stood.
 * The hash is the same one the dossier log uses, so one verifier rule serves both.
 */
export const STREAM = "ledger";

export type ChainCode = "E_LEDGER_CHAIN" | "E_LEDGER_ROWS" | "E_LEDGER_COST";

export interface ChainProblem {
  code: ChainCode;
  /** The event number, the source file, or the call, as the case may be. */
  where: string;
  message: string;
}

export interface ChainReport {
  ok: boolean;
  /** False for a ledger that has never been sealed: there is nothing to check against yet. */
  sealed: boolean;
  events: number;
  headSeq: number | null;
  headHash: string | null;
  sources: number;
  calls: number;
  adopted: boolean;
  problems: ChainProblem[];
  /** With `deep`: how many stored costs were worked out again from their tokens, and how many named a price list that was not supplied. */
  costsChecked?: number;
  costsSkipped?: number;
}

interface EventRow {
  seq: number;
  ts: string;
  kind: string;
  data: string;
  sources_root: string;
  prev_hash: string;
  row_hash: string;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function hasChain(db: Ledger): boolean {
  return (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'ledger_event'").get() as { x: number } | undefined) !== undefined;
}

/** The digest of one source's usage facts: stable under the order rows were inserted in, and under everything a later step fills in. */
export function sourceDigest(db: Ledger, sourceId: number): string {
  const h = createHash("sha256");
  const rows = db.prepare(
    `SELECT call_id, session_id, ts, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens
     FROM model_call WHERE source_id = ? ORDER BY call_id`,
  );
  for (const r of rows.iterate(sourceId) as Iterable<Record<string, unknown>>) {
    h.update(`${r["call_id"]}|${r["session_id"]}|${r["ts"]}|${r["model"]}|${r["input_tokens"]}|${r["output_tokens"]}|${r["reasoning_tokens"]}|${r["cache_read_tokens"]}|${r["cache_write_5m_tokens"]}|${r["cache_write_1h_tokens"]}\n`);
  }
  return h.digest("hex");
}

function sourcesRoot(db: Ledger): string {
  // Only sources that have been sealed are in the root. A source read by a run that was cut short (a full disk, a closed terminal) has no digest yet and is sealed by the next
  // event; a digest removed to hide a change leaves the root different from the one the last event holds.
  const rows = db.prepare("SELECT id, content_digest FROM ingest_source WHERE content_digest IS NOT NULL ORDER BY id").all() as { id: number; content_digest: string }[];
  return sha(rows.map((r) => `${r.id}:${r.content_digest}`).join("\n"));
}

function headFileOf(db: Ledger): string | null {
  const row = (db.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find((d) => d.name === "main");
  return row && row.file !== "" ? `${row.file}.head.jsonl` : null;
}

interface HeadLine {
  seq: number;
  row_hash: string;
  ts: string;
  prev: string;
  line_hash: string;
}

function readHeadFile(path: string): { lines: HeadLine[]; broken: string | null } {
  if (!existsSync(path)) return { lines: [], broken: null };
  const lines: HeadLine[] = [];
  let prev = GENESIS_HASH;
  for (const [i, raw] of readFileSync(path, "utf8").split("\n").entries()) {
    if (raw.trim() === "") continue;
    let l: HeadLine;
    try {
      l = JSON.parse(raw) as HeadLine;
    } catch {
      return { lines, broken: `line ${i + 1} of the head file is not JSON` };
    }
    if (l.prev !== prev || sha(`${l.seq}|${l.row_hash}|${l.ts}|${l.prev}`) !== l.line_hash) return { lines, broken: `line ${i + 1} of the head file does not follow the one before it` };
    prev = l.line_hash;
    lines.push(l);
  }
  return { lines, broken: null };
}

function mirrorHead(path: string | null, seq: number, rowHash: string, ts: string): void {
  if (path === null) return;
  mkdirSync(dirname(path), { recursive: true });
  const { lines } = readHeadFile(path);
  const prev = lines.at(-1)?.line_hash ?? GENESIS_HASH;
  const line: HeadLine = { seq, row_hash: rowHash, ts, prev, line_hash: sha(`${seq}|${rowHash}|${ts}|${prev}`) };
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

/**
 * Seal what just happened: recompute the digest of each source that changed (all of them when `sources` is "all"), then append one event that carries the root of
 * every digest and the hash of the event before it, and mirror its number and hash beside the ledger. A ledger that has events but no digests yet is adopted as it stands.
 */
export function sealLedger(db: Ledger, kind: string, detail: Record<string, unknown>, opts: { sources?: readonly number[] | "all"; touchedSince?: string; now?: () => Date } = {}): { seq: number; rowHash: string } {
  const now = opts.now ?? (() => new Date());
  const hadEvents = hasChain(db) && (db.prepare("SELECT COUNT(*) AS n FROM ledger_event").get() as { n: number }).n > 0;
  const ids: number[] =
    opts.sources === "all" || !hadEvents
      ? (db.prepare("SELECT id FROM ingest_source").all() as { id: number }[]).map((r) => r.id)
      : [
          ...new Set([
            ...(opts.sources ?? []),
            ...(db.prepare("SELECT id FROM ingest_source WHERE content_digest IS NULL").all() as { id: number }[]).map((r) => r.id),
            ...(opts.touchedSince === undefined ? [] : (db.prepare("SELECT id FROM ingest_source WHERE last_ingested_at >= ?").all(opts.touchedSince) as { id: number }[]).map((r) => r.id)),
          ]),
        ];
  const setDigest = db.prepare("UPDATE ingest_source SET content_digest = ? WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    const unsealedBefore = opts.touchedSince === undefined ? null : Number((db.prepare("SELECT COUNT(*) AS n FROM ingest_source WHERE content_digest IS NULL AND last_ingested_at < ?").get(opts.touchedSince) as { n: number }).n);
    for (const id of ids) setDigest.run(sourceDigest(db, id), id);
    const last = db.prepare("SELECT seq, row_hash FROM ledger_event ORDER BY seq DESC LIMIT 1").get() as { seq: number; row_hash: string } | undefined;
    const ts = now().toISOString();
    const root = sourcesRoot(db);
    const calls = (db.prepare("SELECT COUNT(*) AS n FROM model_call").get() as { n: number }).n;
    // The first event adopts a ledger that already held calls only when some of them were read before this event could seal them.
    const unsealedOlder = unsealedBefore === null ? calls > 0 : unsealedBefore > 0;
    const data = { ...detail, ts, sources_root: root, ...(last === undefined ? { adopted: unsealedOlder } : {}) };
    const seq = (last?.seq ?? 0) + 1;
    const prev = last?.row_hash ?? GENESIS_HASH;
    const rowHash = computeRowHash({ stream: STREAM, seq, kind, data, prev_hash: prev });
    db.prepare("INSERT INTO ledger_event (seq, ts, kind, data, sources_root, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(seq, ts, kind, canonicalJson(data), root, prev, rowHash);
    db.exec("COMMIT");
    mirrorHead(headFileOf(db), seq, rowHash, ts);
    return { seq, rowHash };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Check the chain of events and the head file. Cheap: it reads the events and the digests, not the calls. */
export function verifyChain(db: Ledger, opts: { headFile?: string | null } = {}): ChainReport {
  const base: ChainReport = { ok: true, sealed: false, events: 0, headSeq: null, headHash: null, sources: 0, calls: 0, adopted: false, problems: [] };
  if (!hasChain(db)) return base;
  const events = db.prepare("SELECT seq, ts, kind, data, sources_root, prev_hash, row_hash FROM ledger_event ORDER BY seq").all() as unknown as EventRow[];
  base.sources = (db.prepare("SELECT COUNT(*) AS n FROM ingest_source").get() as { n: number }).n;
  base.calls = (db.prepare("SELECT COUNT(*) AS n FROM model_call").get() as { n: number }).n;
  if (events.length === 0) return base;
  base.sealed = true;
  base.events = events.length;
  const bad = (code: ChainCode, where: string, message: string): void => {
    base.ok = false;
    base.problems.push({ code, where, message });
  };
  let prev = GENESIS_HASH;
  let expected = 1;
  for (const e of events) {
    if (e.seq !== expected) {
      bad("E_LEDGER_CHAIN", `event ${expected}`, `event ${expected} is missing: the events go from ${expected - 1} to ${e.seq}`);
      expected = e.seq;
    }
    if (e.prev_hash !== prev) bad("E_LEDGER_CHAIN", `event ${e.seq}`, `event ${e.seq} does not follow the event before it: its link does not match that event's hash`);
    let data: unknown;
    try {
      data = JSON.parse(e.data);
    } catch {
      bad("E_LEDGER_CHAIN", `event ${e.seq}`, `event ${e.seq} holds data that is not JSON`);
      prev = e.row_hash;
      expected += 1;
      continue;
    }
    if (computeRowHash({ stream: STREAM, seq: e.seq, kind: e.kind, data, prev_hash: e.prev_hash }) !== e.row_hash) bad("E_LEDGER_CHAIN", `event ${e.seq}`, `event ${e.seq} (${e.kind}, ${e.ts}) has been changed: its hash does not match what it holds`);
    prev = e.row_hash;
    expected += 1;
  }
  const head = events[events.length - 1] as EventRow;
  base.headSeq = head.seq;
  base.headHash = head.row_hash;
  base.adopted = (JSON.parse(events[0]!.data) as { adopted?: boolean }).adopted === true;
  if (head.sources_root !== sourcesRoot(db)) bad("E_LEDGER_CHAIN", `event ${head.seq}`, `the digests of the source files do not match the ones event ${head.seq} sealed: a source's record was changed after it was sealed`);
  const headFile = opts.headFile === undefined ? headFileOf(db) : opts.headFile;
  if (headFile !== null) {
    const mirror = readHeadFile(headFile);
    if (mirror.broken !== null) bad("E_LEDGER_CHAIN", "head file", `the head file kept beside the ledger is damaged: ${mirror.broken}`);
    // Every line the head file holds is checked against the event it names: a ledger rebuilt with the same numbers but other content disagrees with a line it cannot rewrite.
    const reported = new Set<number>();
    for (const l of mirror.lines) {
      const same = events.find((e) => e.seq === l.seq);
      if (same === undefined) {
        if (!reported.has(l.seq)) bad("E_LEDGER_CHAIN", `event ${l.seq}`, `the ledger ends at event ${head.seq}, but the head file records event ${l.seq}: events were cut off the end`);
      } else if (same.row_hash !== l.row_hash && !reported.has(l.seq)) {
        bad("E_LEDGER_CHAIN", `event ${l.seq}`, `event ${l.seq} is not the event the head file recorded: it was replaced`);
      }
      reported.add(l.seq);
    }
  }
  return base;
}

/** Everything `verifyChain` does, and each source's digest against its calls, and with `deep` each stored cost worked out again. Reads every call. */
export function verifyLedger(db: Ledger, opts: { deep?: boolean; headFile?: string | null; snapshots?: ReadonlyMap<string, PriceSnapshot> } = {}): ChainReport {
  const report = verifyChain(db, opts.headFile === undefined ? {} : { headFile: opts.headFile });
  if (!report.sealed) return report;
  const bad = (code: ChainCode, where: string, message: string): void => {
    report.ok = false;
    report.problems.push({ code, where, message });
  };
  const sources = db.prepare("SELECT id, path, content_digest FROM ingest_source ORDER BY id").all() as { id: number; path: string; content_digest: string | null }[];
  for (const s of sources) {
    if (s.content_digest === null) continue;
    if (sourceDigest(db, s.id) !== s.content_digest) bad("E_LEDGER_ROWS", s.path, `the calls read from ${s.path} no longer match what was sealed: a row was edited, added or removed outside the Desk`);
  }
  if (opts.deep === true) {
    const snaps = opts.snapshots ?? new Map<string, PriceSnapshot>();
    const rows = db.prepare(
      `SELECT m.call_id, m.model, m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_write_5m_tokens, m.cache_write_1h_tokens, m.speed, m.inference_geo, c.total_micros, c.snapshot_id
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'estimated'`,
    );
    let checked = 0;
    let skipped = 0;
    let wrong = 0;
    for (const r of rows.iterate() as Iterable<Record<string, unknown>>) {
      const snap = snaps.get(String(r["snapshot_id"]));
      // A cost priced from a list this run was not given cannot be worked out again, and is counted as skipped, not guessed.
      if (snap === undefined) {
        skipped += 1;
        continue;
      }
      const p = priceCall(snap, {
        model: String(r["model"]),
        tokens: { inputTokens: Number(r["input_tokens"]), outputTokens: Number(r["output_tokens"]), cacheReadTokens: Number(r["cache_read_tokens"]), cacheWrite5mTokens: Number(r["cache_write_5m_tokens"]), cacheWrite1hTokens: Number(r["cache_write_1h_tokens"]) },
        speed: r["speed"] === null ? null : String(r["speed"]),
        inferenceGeo: r["inference_geo"] === null ? null : String(r["inference_geo"]),
      });
      checked += 1;
      if (p.kind !== "priced" || p.totalMicros !== Number(r["total_micros"])) {
        wrong += 1;
        if (wrong <= 20) bad("E_LEDGER_COST", String(r["call_id"]), `the stored cost of call ${String(r["call_id"])} (${r["total_micros"]} micro-dollars) is not what its tokens cost at ${String(r["snapshot_id"])}${p.kind === "priced" ? ` (${p.totalMicros})` : ""}`);
      }
    }
    report.costsChecked = checked;
    report.costsSkipped = skipped;
    if (wrong > 20) report.problems.push({ code: "E_LEDGER_COST", where: "more", message: `${wrong - 20} more stored costs differ from their tokens` });
  }
  return report;
}

/** For a command to call before it writes: a broken chain stops it, with the row and the way back. */
export class LedgerChainError extends Error {
  readonly code = "E_LEDGER_CHAIN";
  constructor(readonly problem: ChainProblem) {
    super(`E_LEDGER_CHAIN: ${problem.message}. ${RESTORE}`);
    this.name = "LedgerChainError";
  }
}

export const RESTORE = "Rebuild the ledger from your logs with `desk forget --all --yes` and then `desk ingest` (`desk retention` says which logs Claude Code may already have deleted), or put back a copy of the ledger file from before the change";

export function assertChain(db: Ledger): void {
  const r = verifyChain(db);
  if (!r.ok) throw new LedgerChainError(r.problems[0] as ChainProblem);
}

export function renderChainReport(r: ChainReport): string {
  if (!r.sealed) return "This ledger has not been sealed yet. The next `desk ingest` seals it: it records an event and a digest of every source file, from which any later change is seen.";
  const head = `Ledger chain: ${r.events.toLocaleString("en-US")} event${r.events === 1 ? "" : "s"}, head ${r.headSeq} (${(r.headHash ?? "").slice(0, 12)}), ${r.sources.toLocaleString("en-US")} source files, ${r.calls.toLocaleString("en-US")} calls`;
  if (r.ok) {
    return [
      `${head}: intact.`,
      r.adopted ? "The first event adopted a ledger that already held calls, so what was read before it is vouched for only from that point." : "",
      "This shows that no event was changed, removed or reordered, that no source's calls differ from what was sealed, and that the head matches the file kept beside the ledger. It does not show that the logs were truthful.",
    ].filter((x) => x !== "").join("\n");
  }
  return [`${head}: BROKEN.`, ...r.problems.map((p) => `${p.code} at ${p.where}: ${p.message}`), RESTORE + "."].join("\n");
}

/** Seal an ingest, unless it changed nothing and the ledger was already sealed: a run that reads no new line is not an event. */
export function sealIngest(db: Ledger, agent: string, started: string, counts: { files: number; callsNew: number; callsMerged: number }): void {
  const sealed = hasChain(db) && (db.prepare("SELECT COUNT(*) AS n FROM ledger_event").get() as { n: number }).n > 0;
  if (sealed && counts.callsNew === 0 && counts.callsMerged === 0) return;
  sealLedger(db, "ingest", { agent, files: counts.files, calls_new: counts.callsNew, calls_merged: counts.callsMerged }, { touchedSince: started });
}
