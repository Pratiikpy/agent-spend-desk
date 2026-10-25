import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertChain, LedgerChainError, renderChainReport, sealLedger, verifyChain, verifyLedger } from "../../src/desk/ledger/chain.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { repriceLedger } from "../../src/desk/pricing/reprice.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { startUiServer } from "../../src/desk/ui/server.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const snap = testSnapshot();
let dir: TempDir;
let path: string;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  path = join(dir.path, "ledger.db");
  db = openLedger(path);
});
afterEach(() => {
  db.close();
  dir.dispose();
});

const line = (id: string, session: string, ts: string, output = 1000): string => assistantLine({ id, session, ts, output });
const events = (): { seq: number; kind: string; data: string; prev_hash: string; row_hash: string }[] => db.prepare("SELECT seq, kind, data, prev_hash, row_hash FROM ledger_event ORDER BY seq").all() as never;

async function twoIngests(): Promise<void> {
  await ingestClaudeCode(db, [dir.file("a.jsonl", [line("m1", "s1", "2026-10-20T10:00:00Z"), line("m2", "s1", "2026-10-20T10:01:00Z", 2000)])], snap);
  await ingestClaudeCode(db, [dir.file("b.jsonl", [line("n1", "s2", "2026-10-21T10:00:00Z", 3000)])], snap);
}

describe("an ingest is an event the ledger chains", () => {
  it("starts the chain at the first ingest, links the second to it, and verifies", async () => {
    await twoIngests();
    const ev = events();
    expect(ev.map((e) => [e.seq, e.kind])).toEqual([[1, "ingest"], [2, "ingest"]]);
    expect(ev[0]!.prev_hash).toBe("0".repeat(64));
    expect(ev[1]!.prev_hash).toBe(ev[0]!.row_hash);
    const r = verifyLedger(db);
    expect(r).toMatchObject({ ok: true, sealed: true, events: 2, headSeq: 2, sources: 2, calls: 3, adopted: false, problems: [] });
    expect(renderChainReport(r)).toContain("intact");
    expect(renderChainReport(r)).toContain("does not show that the logs were truthful");
  });

  it("does not add an event for a run that read nothing new, so the chain records changes", async () => {
    await twoIngests();
    await ingestClaudeCode(db, [join(dir.path, "a.jsonl"), join(dir.path, "b.jsonl")], snap);
    expect(events()).toHaveLength(2);
  });

  it("mirrors each event's number and hash into a file kept beside the ledger, chained itself", async () => {
    await twoIngests();
    const file = `${path}.head.jsonl`;
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { seq: number; row_hash: string; prev: string; line_hash: string });
    expect(lines.map((l) => l.seq)).toEqual([1, 2]);
    expect(lines[1]!.row_hash).toBe(events()[1]!.row_hash);
    expect(lines[1]!.prev).toBe(lines[0]!.line_hash);
  });

  it("is a ledger that has never been sealed when nothing has been read, and says so", () => {
    const r = verifyLedger(db);
    expect(r.sealed).toBe(false);
    expect(r.ok).toBe(true);
    expect(renderChainReport(r)).toContain("has not been sealed yet");
  });
});

describe("what it sees", () => {
  it("sees an event that was edited, naming it", async () => {
    await twoIngests();
    db.prepare("UPDATE ledger_event SET data = REPLACE(data, '\"calls_new\":2', '\"calls_new\":9') WHERE seq = 1").run();
    const r = verifyChain(db);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatchObject({ code: "E_LEDGER_CHAIN", where: "event 1" });
    expect(r.problems[0]!.message).toContain("has been changed");
  });

  it("sees an event removed from the middle, as a gap", async () => {
    await twoIngests();
    await ingestClaudeCode(db, [dir.file("c.jsonl", [line("o1", "s3", "2026-10-22T10:00:00Z")])], snap);
    db.prepare("DELETE FROM ledger_event WHERE seq = 2").run();
    const r = verifyChain(db);
    expect(r.problems.map((p) => p.where)).toContain("event 2");
    expect(r.problems[0]!.message).toContain("event 2 is missing");
  });

  it("sees events cut off the end, against the head file", async () => {
    await twoIngests();
    db.prepare("DELETE FROM ledger_event WHERE seq = 2").run();
    const r = verifyChain(db);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.message.includes("events were cut off the end"))).toBe(true);
  });

  it("sees an event replaced by another that links correctly but is not the one that was recorded", async () => {
    await twoIngests();
    const first = events()[0]!;
    // Forge event 2 with a valid hash over different content.
    db.exec("DELETE FROM ledger_event WHERE seq = 2");
    sealLedger(db, "ingest", { agent: "forged", files: 1, calls_new: 0, calls_merged: 0 }, { sources: [] });
    expect(events()[0]!.row_hash).toBe(first.row_hash);
    const r = verifyChain(db);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.message.includes("was replaced"))).toBe(true);
  });

  it("sees a call whose tokens were edited outside the Desk, naming the source file that no longer matches", async () => {
    await twoIngests();
    db.prepare("UPDATE model_call SET output_tokens = output_tokens + 1 WHERE call_id = 'm1'").run();
    const r = verifyLedger(db);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ code: "E_LEDGER_ROWS" });
    expect(r.problems[0]!.where.endsWith("a.jsonl")).toBe(true);
    // The chain itself is intact: the cheap check passes, which is why the full one reads the calls.
    expect(verifyChain(db).ok).toBe(true);
  });

  it("sees a call added by hand and a call deleted by hand", async () => {
    await twoIngests();
    db.prepare("DELETE FROM cost_event WHERE call_id = 'n1'").run();
    db.prepare("DELETE FROM model_call WHERE call_id = 'n1'").run();
    expect(verifyLedger(db).problems.map((p) => p.code)).toEqual(["E_LEDGER_ROWS"]);
  });

  it("sees a source's digest changed to match an edit, because the event holds the root of all digests", async () => {
    await twoIngests();
    db.prepare("UPDATE model_call SET output_tokens = output_tokens + 1 WHERE call_id = 'm1'").run();
    // Someone who also edits the digest to hide the change still breaks the root the last event sealed.
    const src = db.prepare("SELECT id FROM ingest_source WHERE path LIKE '%a.jsonl'").get() as { id: number };
    db.prepare("UPDATE ingest_source SET content_digest = ? WHERE id = ?").run("f".repeat(64), src.id);
    const r = verifyChain(db);
    expect(r.ok).toBe(false);
    expect(r.problems[0]!.message).toContain("the digests of the source files do not match");
  });

  it("works a stored cost out again from its tokens and the price list it names, and sees one that was edited", async () => {
    await twoIngests();
    const snaps = new Map([[snap.snapshotId, snap]]);
    expect(verifyLedger(db, { deep: true, snapshots: snaps })).toMatchObject({ ok: true, costsChecked: 3, costsSkipped: 0 });
    db.prepare("UPDATE cost_event SET total_micros = total_micros + 1, output_micros = output_micros + 1 WHERE call_id = 'm2'").run();
    const r = verifyLedger(db, { deep: true, snapshots: snaps });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ code: "E_LEDGER_COST", where: "m2" });
  });

  it("counts, and does not guess, a cost whose price list was not supplied", async () => {
    await twoIngests();
    expect(verifyLedger(db, { deep: true, snapshots: new Map() })).toMatchObject({ ok: true, costsChecked: 0, costsSkipped: 3 });
  });
});

describe("what the Desk does to its own ledger does not break the chain", () => {
  it("a repricing is an event, and the ledger still verifies, and each cost still works out", async () => {
    await twoIngests();
    const next = { ...snap, snapshotId: "repriced", models: { ...snap.models, "claude-opus-5": { ...snap.models["claude-opus-5"]!, outputPerMTokMicros: snap.models["claude-opus-5"]!.outputPerMTokMicros + 1_000_000 } } };
    repriceLedger(db, next, { reason: "test" });
    expect(events().map((e) => e.kind)).toEqual(["ingest", "ingest", "reprice"]);
    expect(verifyLedger(db, { deep: true, snapshots: new Map([[snap.snapshotId, snap], ["repriced", next]]) })).toMatchObject({ ok: true, costsSkipped: 0 });
  });

  it("a forget is an event, and a forget made by hand is not", async () => {
    await twoIngests();
    forgetLedger(db, { project: "project" });
    expect(events().at(-1)!.kind).toBe("forget");
    expect(verifyLedger(db).ok).toBe(true);
    await ingestClaudeCode(db, [dir.file("c.jsonl", [line("p1", "s9", "2026-10-23T10:00:00Z")])], snap);
    db.prepare("DELETE FROM cost_event WHERE call_id = 'p1'").run();
    db.prepare("DELETE FROM model_call WHERE call_id = 'p1'").run();
    expect(verifyLedger(db).problems.map((p) => p.code)).toContain("E_LEDGER_ROWS");
  });

  it("adopts a ledger read before the chain existed, and says that what came before is vouched for only from there", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [line("m1", "s1", "2026-10-20T10:00:00Z")])], snap);
    // Make it look like a ledger from before the chain: no events, no digests.
    db.exec("DELETE FROM ledger_event; UPDATE ingest_source SET content_digest = NULL");
    writeFileSync(`${path}.head.jsonl`, "");
    await ingestClaudeCode(db, [dir.file("b.jsonl", [line("n1", "s2", "2026-10-21T10:00:00Z")])], snap);
    const r = verifyLedger(db);
    expect(r).toMatchObject({ ok: true, events: 1, adopted: true });
    expect(renderChainReport(r)).toContain("adopted a ledger that already held calls");
  });
});

describe("a broken chain is fatal", () => {
  it("stops an ingest, naming the event and the way back", async () => {
    await twoIngests();
    db.prepare("UPDATE ledger_event SET row_hash = ? WHERE seq = 2").run("a".repeat(64));
    const err = (await ingestClaudeCode(db, [dir.file("c.jsonl", [line("q1", "s4", "2026-10-24T10:00:00Z")])], snap).catch((e: unknown) => e)) as LedgerChainError;
    expect(err).toBeInstanceOf(LedgerChainError);
    expect(err.code).toBe("E_LEDGER_CHAIN");
    expect(err.message).toContain("event 2");
    expect(err.message).toContain("desk forget --all --yes");
    expect(() => assertChain(db)).toThrow(/E_LEDGER_CHAIN/);
    expect((db.prepare("SELECT COUNT(*) n FROM model_call WHERE call_id = 'q1'").get() as { n: number }).n).toBe(0);
  });

  it("is said on every screen, with the event and the way back, while the screens still read", async () => {
    await twoIngests();
    db.prepare("UPDATE ledger_event SET data = REPLACE(data, 'claude_code', 'someone') WHERE seq = 1").run();
    db.close();
    const server = await startUiServer({ pricesPath: "data/prices/anthropic-litellm-2026-10-22.json", policiesDir: "policies", port: 0, token: "t".repeat(32), env: {}, ledgerPath: path, mode: "own_logs", extra: { dossiersDir: join(dir.path, "none"), pendingDir: join(dir.path, "none"), memoryDir: join(dir.path, "m"), tracesDir: join(dir.path, "t") } as never } as never);
    try {
      const meta = (await (await fetch(`${server.origin}/api/meta`, { headers: { "x-desk-token": "t".repeat(32) } })).json()) as { chainProblem: string | null; calls: number };
      expect(meta.chainProblem).toContain("E_LEDGER_CHAIN at event 1");
      expect(meta.chainProblem).toContain("desk forget --all --yes");
      expect(meta.calls).toBe(3); // the screens still read what is there
    } finally {
      await server.close();
      db = openLedger(path);
    }
  });
});
