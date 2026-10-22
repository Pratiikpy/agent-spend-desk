import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../runtime/canonical.ts";
import { GENESIS_HASH, STREAM_PATTERN, computeRowHash, type Row } from "../verify/format.ts";
import { ensureDossierSchema } from "./schema.ts";

/** An in-memory log with the same chain rules as the stored one; used by tests and by builders that assemble rows themselves. */
export class MemoryLog {
  readonly rows: Row[] = [];
  private readonly heads = new Map<string, Row>();

  append(stream: string, kind: string, data: unknown): Row {
    if (!STREAM_PATTERN.test(stream)) throw new RangeError(`stream name ${JSON.stringify(stream)} is not a lowercase identifier`);
    canonicalJson(data);
    const prev = this.heads.get(stream);
    const base = { stream, seq: prev ? prev.seq + 1 : 0, kind, data, prev_hash: prev ? prev.row_hash : GENESIS_HASH };
    const row: Row = { ...base, row_hash: computeRowHash(base) };
    this.rows.push(row);
    this.heads.set(stream, row);
    return row;
  }
}

/** Append one row to the stored log inside a transaction, so two writers cannot take the same sequence number. */
export function appendRow(db: DatabaseSync, stream: string, kind: string, data: unknown): Row {
  ensureDossierSchema(db);
  if (!STREAM_PATTERN.test(stream)) throw new RangeError(`stream name ${JSON.stringify(stream)} is not a lowercase identifier`);
  const json = canonicalJson(data);
  db.exec("BEGIN IMMEDIATE");
  try {
    const last = db.prepare("SELECT seq, row_hash FROM dossier_log WHERE stream = ? ORDER BY seq DESC LIMIT 1").get(stream) as { seq: number; row_hash: string } | undefined;
    const base = { stream, seq: last ? last.seq + 1 : 0, kind, data, prev_hash: last ? last.row_hash : GENESIS_HASH };
    const row: Row = { ...base, row_hash: computeRowHash(base) };
    db.prepare("INSERT INTO dossier_log (stream, seq, kind, data, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?)").run(stream, row.seq, kind, json, row.prev_hash, row.row_hash);
    db.exec("COMMIT");
    return row;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Every row in the order it was appended: that order is the leaf order of the checkpoint. */
export function readLog(db: DatabaseSync): Row[] {
  ensureDossierSchema(db);
  const rows = db.prepare("SELECT stream, seq, kind, data, prev_hash, row_hash FROM dossier_log ORDER BY global_index").all() as unknown as {
    stream: string;
    seq: number;
    kind: string;
    data: string;
    prev_hash: string;
    row_hash: string;
  }[];
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data) as unknown }));
}
