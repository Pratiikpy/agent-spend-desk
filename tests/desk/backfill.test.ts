import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger } from "../../src/desk/ledger/db.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { applyModifiers } from "../../src/desk/pricing/pricebook.ts";
import { repriceLedger } from "../../src/desk/pricing/reprice.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

let dir: TempDir;
beforeEach(() => {
  dir = new TempDir();
});
afterEach(() => dir.dispose());

const withGeo = (line: string, geo: string): string => line.replace('"usage":{', `"usage":{"inference_geo":"${geo}",`);

const modifiers = () =>
  applyModifiers(testSnapshot(), { supplementId: "m", source: "test", sourceUrl: "https://example.invalid", fetchedAt: "2026-10-24T00:00:00.000Z", pageSha256: "0".repeat(64), fast: {}, usOnly: ["claude-opus-5"] });

describe("inference geography", () => {
  it("is read from a log line when the line carries it", async () => {
    const db = openLedger(":memory:");
    await ingestClaudeCode(db, [dir.file("a.jsonl", [withGeo(assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 1000 }), "us")])], testSnapshot());
    expect((db.prepare("SELECT inference_geo g FROM model_call").get() as { g: string }).g).toBe("us");
    db.close();
  });

  it("is null for a line that does not carry it, so a missing field is not read as global", async () => {
    const db = openLedger(":memory:");
    await ingestClaudeCode(db, [dir.file("a.jsonl", [assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 1000 })])], testSnapshot());
    expect((db.prepare("SELECT inference_geo g FROM model_call").get() as { g: string | null }).g).toBeNull();
    db.close();
  });
});

describe("backfilling a field into calls read before the field existed", () => {
  const first = () => assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 1_000_000 });

  it("fills only the empty field, and nothing else in the call or its cost", async () => {
    const db = openLedger(":memory:");
    await ingestClaudeCode(db, [dir.file("a.jsonl", [first()])], testSnapshot());
    const before = db.prepare("SELECT call_id, input_tokens, output_tokens, block_lines, usage_conflicts FROM model_call").all();
    const cost = db.prepare("SELECT total_micros t FROM cost_event").get();
    const r = await backfillClaudeCodeFields(db, [dir.file("b.jsonl", [withGeo(first(), "us")])]);
    expect(r).toEqual({ files: 1, callsSeen: 1, inferenceGeoFilled: 1, resultFactsFilled: 0, toolVersionFilled: 0, compactionsFilled: 0, delegationsFilled: 0, agentsNamed: 0, workflowsFilled: 0, promptsFilled: 0, logsPlaced: 0 });
    expect(db.prepare("SELECT call_id, input_tokens, output_tokens, block_lines, usage_conflicts FROM model_call").all()).toEqual(before);
    expect(db.prepare("SELECT total_micros t FROM cost_event").get()).toEqual(cost);
    expect((db.prepare("SELECT inference_geo g FROM model_call").get() as { g: string }).g).toBe("us");
    db.close();
  });

  it("never replaces a value that is already there, and a second run changes nothing", async () => {
    const db = openLedger(":memory:");
    await ingestClaudeCode(db, [dir.file("a.jsonl", [withGeo(first(), "global")])], testSnapshot());
    const f = dir.file("b.jsonl", [withGeo(first(), "us")]);
    expect((await backfillClaudeCodeFields(db, [f])).inferenceGeoFilled).toBe(0);
    expect((db.prepare("SELECT inference_geo g FROM model_call").get() as { g: string }).g).toBe("global");
    db.close();
  });

  it("skips a call the ledger does not have, and a line without the field", async () => {
    const db = openLedger(":memory:");
    await ingestClaudeCode(db, [dir.file("a.jsonl", [first()])], testSnapshot());
    const other = withGeo(assistantLine({ id: "m2", session: "s1", ts: "2026-10-20T11:00:00Z", output: 5 }), "us");
    const r = await backfillClaudeCodeFields(db, [dir.file("b.jsonl", [first(), other])]);
    expect(r.inferenceGeoFilled).toBe(0);
    db.close();
  });

  it("lets the next repricing charge the US-only multiplier, and nothing before it does", async () => {
    const db = openLedger(":memory:");
    await ingestClaudeCode(db, [dir.file("a.jsonl", [first()])], testSnapshot());
    const standard = (db.prepare("SELECT total_micros t FROM cost_event").get() as { t: number }).t;
    await backfillClaudeCodeFields(db, [dir.file("b.jsonl", [withGeo(first(), "us")])]);
    expect((db.prepare("SELECT total_micros t FROM cost_event").get() as { t: number }).t).toBe(standard);
    const r = repriceLedger(db, modifiers(), { reason: "US-only calls pay 1.1x" });
    expect(r.changed).toBe(1);
    const now = db.prepare("SELECT total_micros t, rule_ids r FROM cost_event").get() as { t: number; r: string };
    expect(now.t).toBe(Math.round(standard * 1.1));
    expect(JSON.parse(now.r)).toEqual(["us_only"]);
    db.close();
  });
});
