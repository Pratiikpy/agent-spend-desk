import { appendFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

let dir: TempDir;
beforeEach(() => {
  dir = new TempDir();
});
afterEach(() => dir.dispose());

describe("reading logs again", () => {
  it("does nothing for a file that has not grown: no line read, its record untouched", async () => {
    const db = openLedger(":memory:");
    const file = dir.file("a.jsonl", [assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 10 })]);
    await ingestClaudeCode(db, [file], testSnapshot(), () => new Date("2026-10-24T10:00:00Z"));
    const before = db.prepare("SELECT size_bytes, offset_bytes, last_ingested_at FROM ingest_source").get();
    const again = await ingestClaudeCode(db, [file], testSnapshot(), () => new Date("2026-10-24T11:00:00Z"));
    expect(again).toMatchObject({ files: 1, linesRead: 0, callsNew: 0, callsMerged: 0 });
    expect(db.prepare("SELECT size_bytes, offset_bytes, last_ingested_at FROM ingest_source").get()).toEqual(before);
    db.close();
  });

  it("still reads what was appended to a file it had read", async () => {
    const db = openLedger(":memory:");
    const file = dir.file("a.jsonl", [assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 10 })]);
    await ingestClaudeCode(db, [file], testSnapshot());
    appendFileSync(file, `${assistantLine({ id: "m2", session: "s1", ts: "2026-10-20T10:05:00Z", output: 20 })}\n`);
    const again = await ingestClaudeCode(db, [file], testSnapshot());
    expect(again).toMatchObject({ files: 1, callsNew: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(2);
    db.close();
  });

  it("looks up a file's newest call through an index, so a large ledger does not make every file a full scan", () => {
    const db = openLedger(":memory:");
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT MAX(m.ts) AS t FROM model_call m JOIN ingest_source s ON s.id = m.source_id WHERE s.path = ?").all("x") as unknown as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" | ")).toMatch(/USING (COVERING )?INDEX model_call_source_ts/);
    db.close();
  });
});
