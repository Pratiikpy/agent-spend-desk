import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { ingestCodex } from "../../src/desk/ledger/ingest-codex.ts";
import { hashModels, parseSnapshot, type PriceRow } from "../../src/desk/pricing/pricebook.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { codexLines } from "./codex-fixtures.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const { meta, turn, count } = codexLines;

const GPT: PriceRow = { inputPerMTokMicros: 1_000_000, outputPerMTokMicros: 10_000_000, cacheReadPerMTokMicros: 100_000, cacheWrite5mPerMTokMicros: 0, cacheWrite1hPerMTokMicros: 0 };
function snapshotWith(models: Record<string, PriceRow>) {
  const base = testSnapshot();
  const all = { ...base.models, ...models };
  return parseSnapshot({ ...base, models: all, contentHash: hashModels(all) });
}

let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  db.close();
  dir.dispose();
});

const rl = (p: number) => ({ primary: { used: p, minutes: 300, resetsAt: 1_790_000_000 }, secondary: { used: 20, minutes: 10_080, resetsAt: 1_790_400_000 }, plan: "plus" });
const session = (id = "s1"): string[] => [
  meta({ id, ts: "2026-10-01T10:00:00.000Z", cwd: "/work/app", branch: "main" }),
  turn("2026-10-01T10:00:01.000Z", "gpt-5.5"),
  count("2026-10-01T10:00:05.000Z", { input: 1000, cached: 600, output: 50, reasoning: 20 }, undefined, rl(1)),
  count("2026-10-01T10:00:30.000Z", { input: 2500, cached: 1800, output: 120, reasoning: 40 }, undefined, rl(2)),
];

describe("reading Codex logs into the ledger", () => {
  it("stores the session and its calls with fresh input apart from cached input, and counts them as the Codex tool", async () => {
    const file = dir.file("a.jsonl", session());
    const r = await ingestCodex(db, [file], testSnapshot());
    expect(r).toMatchObject({ files: 1, callsNew: 2, replayedCalls: 0, limitSamples: 3 });
    expect(db.prepare("SELECT tool, project_path, git_branch, tool_version, started_at, ended_at FROM session").get()).toMatchObject({ tool: "codex", project_path: "/work/app", git_branch: "main", tool_version: "0.130.0", started_at: "2026-10-01T10:00:05.000Z", ended_at: "2026-10-01T10:00:30.000Z" });
    const rows = db.prepare("SELECT call_id, model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, is_sidechain FROM model_call ORDER BY ts").all();
    expect(rows).toEqual([
      { call_id: "codex:s1:1", model: "gpt-5.5", input_tokens: 400, output_tokens: 50, reasoning_tokens: 20, cache_read_tokens: 600, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, is_sidechain: 0 },
      { call_id: "codex:s1:2", model: "gpt-5.5", input_tokens: 300, output_tokens: 70, reasoning_tokens: 20, cache_read_tokens: 1200, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, is_sidechain: 0 },
    ]);
    expect(db.prepare("SELECT kind FROM ingest_source").get()).toEqual({ kind: "codex" });
  });

  it("leaves a model it has no price for unpriced, with the reason, and prices one it has", async () => {
    await ingestCodex(db, [dir.file("a.jsonl", session())], testSnapshot());
    expect(db.prepare("SELECT class, unpriced_reason FROM cost_event").all()).toEqual([{ class: "unpriced", unpriced_reason: "unknown-model" }, { class: "unpriced", unpriced_reason: "unknown-model" }]);
    const priced = openLedger(":memory:");
    try {
      await ingestCodex(priced, [dir.file("b.jsonl", session())], snapshotWith({ "gpt-5.5": GPT }));
      // call 1: 400 fresh input at $1, 600 cached at $0.10, 50 output at $10, per million
      expect(priced.prepare("SELECT total_micros FROM cost_event ORDER BY call_id").all()).toEqual([{ total_micros: Math.round((400 * 1_000_000 + 600 * 100_000 + 50 * 10_000_000) / 1_000_000) }, { total_micros: Math.round((300 * 1_000_000 + 1200 * 100_000 + 70 * 10_000_000) / 1_000_000) }]);
    } finally {
      priced.close();
    }
  });

  it("does not store anything twice when the same file is read again, and reads only what is new when it grows", async () => {
    const file = dir.file("a.jsonl", session());
    await ingestCodex(db, [file], testSnapshot());
    const again = await ingestCodex(db, [file], testSnapshot());
    expect(again.callsNew).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(2);
    appendFileSync(file, `${count("2026-10-01T10:01:00.000Z", { input: 4000, cached: 3000, output: 200, reasoning: 60 }, undefined, rl(3))}\n`);
    const grown = await ingestCodex(db, [file], testSnapshot());
    expect(grown.callsNew).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(3);
    expect(db.prepare("SELECT call_id FROM model_call ORDER BY ts DESC LIMIT 1").get()).toEqual({ call_id: "codex:s1:3" });
    expect((db.prepare("SELECT COUNT(*) n FROM limit_sample WHERE kind = 'primary'").get() as { n: number }).n).toBe(3);
  });

  it("ignores an unfinished last line and takes it when it is complete", async () => {
    const lines = session();
    const file = join(dir.path, "t.jsonl");
    const last = count("2026-10-01T10:01:00.000Z", { input: 4000, cached: 3000, output: 200, reasoning: 60 });
    writeFileSync(file, `${lines.join("\n")}\n${last.slice(0, 60)}`);
    expect((await ingestCodex(db, [file], testSnapshot())).callsNew).toBe(2);
    writeFileSync(file, `${lines.join("\n")}\n${last}\n`);
    expect((await ingestCodex(db, [file], testSnapshot())).callsNew).toBe(1);
  });

  it("leaves out the history a forked session replays, and marks the fork's own calls as a sub-agent's", async () => {
    const lines = [
      meta({ id: "child", ts: "2026-10-01T10:00:00.000Z", forkedFrom: "parent", subagent: true }),
      meta({ id: "parent", ts: "2026-09-30T09:00:00.000Z", at: "2026-10-01T10:00:00.005Z" }),
      turn("2026-10-01T10:00:00.010Z", "gpt-5.5"),
      count("2026-10-01T10:00:00.020Z", { input: 50_000, cached: 40_000, output: 500, reasoning: 0 }, undefined, rl(40)),
      turn("2026-10-01T10:00:05.000Z", "gpt-5.5"),
      count("2026-10-01T10:00:09.000Z", { input: 60_000, cached: 40_000, output: 900, reasoning: 0 }, undefined, rl(41)),
    ];
    const r = await ingestCodex(db, [dir.file("fork.jsonl", lines)], testSnapshot());
    expect(r).toMatchObject({ callsNew: 1, replayedCalls: 1, replayedTokens: 50_500 });
    expect(db.prepare("SELECT session_id, is_sidechain, input_tokens, output_tokens FROM model_call").all()).toEqual([{ session_id: "child", is_sidechain: 1, input_tokens: 10_000, output_tokens: 400 }]);
    expect(db.prepare("SELECT used_percent FROM limit_sample WHERE kind = 'primary'").all()).toEqual([{ used_percent: 41 }]);
  });

  it("masks a credential in the working directory and the branch, as for Claude logs", async () => {
    const secret = ["sk", "proj", "AbCdEf0123456789xyzXYZ0123456789"].join("-");
    const lines = [meta({ id: "s2", cwd: `/work/${secret}`, branch: `fix-${secret}` }), turn("2026-10-01T10:00:01.000Z", "gpt-5.5"), count("2026-10-01T10:00:05.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 })];
    await ingestCodex(db, [dir.file("a.jsonl", lines)], testSnapshot());
    const all = JSON.stringify(db.prepare("SELECT * FROM session").all());
    expect(all).not.toContain(secret);
    expect(all).toContain("(redacted)");
  });

  it("sits beside Claude Code logs in one ledger, and forgetting a project removes its limit readings too", async () => {
    await ingestClaudeCode(db, [dir.file("c.jsonl", [assistantLine({ id: "m1", session: "claude-1", ts: "2026-10-01T09:00:00Z", output: 10 })])], testSnapshot());
    await ingestCodex(db, [dir.file("x.jsonl", session("codex-1"))], testSnapshot());
    expect(db.prepare("SELECT tool, COUNT(*) n FROM session GROUP BY tool ORDER BY tool").all()).toEqual([{ tool: "claude_code", n: 1 }, { tool: "codex", n: 1 }]);
    forgetLedger(db, { project: "/work/app" });
    expect((db.prepare("SELECT COUNT(*) n FROM limit_sample").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM session WHERE tool = 'codex'").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM session WHERE tool = 'claude_code'").get() as { n: number }).n).toBe(1);
  });

  it("reports a log with no session in it instead of failing, and skips it", async () => {
    const r = await ingestCodex(db, [dir.file("junk.jsonl", ["{}", "not json"])], testSnapshot());
    expect(r).toMatchObject({ files: 1, callsNew: 0, skippedFiles: 1 });
  });
});
