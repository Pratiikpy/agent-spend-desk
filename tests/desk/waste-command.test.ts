import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { wasteCommand } from "../../src/desk/waste/command.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
let work: string;
let db: Ledger;

const result = (id: string, ts: string, text: string, isError: boolean): string =>
  JSON.stringify({ type: "user", isSidechain: false, uuid: `res-${id}`, timestamp: ts, sessionId: "sess-w", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] } });
const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-waste-cmd-"));
  const lines = [humanPromptLine({ uuid: "p0", session: "sess-w", ts: at(0) })];
  // A big file read cut short and read again at once; the same refusal four times.
  lines.push(assistantLine({ id: "m1", session: "sess-w", ts: at(1), output: 10_000, tools: ["Read"], toolInputs: [{ file_path: "src/big.ts" }] }));
  lines.push(result("tu_m1_0", at(1), "<persisted-output>\nOutput too large (39KB). Full output saved to: out.txt", false));
  lines.push(assistantLine({ id: "m2", session: "sess-w", ts: at(2), output: 10_000, tools: ["Read"], toolInputs: [{ file_path: "src/big.ts" }] }));
  lines.push(result("tu_m2_0", at(2), "<persisted-output>\nOutput too large (39KB). Full output saved to: out.txt", false));
  for (const m of [3, 4, 5, 6]) {
    lines.push(assistantLine({ id: `m${m}`, session: "sess-w", ts: at(m), output: 10_000, tools: ["Bash"], toolInputs: [{ command: `deploy --target t${m}` }] }));
    lines.push(result(`tu_m${m}_0`, at(m), `Error: this command requires approval (request ${m}00)`, true));
  }
  const path = join(work, "w.jsonl");
  writeFileSync(path, lines.join("\n") + "\n");
  db = openLedger(":memory:");
  await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
});

afterAll(() => {
  db?.close();
  rmSync(work, { recursive: true, force: true });
});

describe("desk waste", () => {
  it("reports each class with its rule, runs, calls and dollars, and what it did not bill", () => {
    const r = wasteCommand(db, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z");
    expect(r.events.map((e) => e.rule).sort()).toEqual(["C-LOOP-2", "C-TRUNC"]);
    expect(r.text).toMatch(/^Waste found by the extra rules, 2026-10-01 to 2026-10-31: 6 calls read\./);
    expect(r.text).toMatch(/C-LOOP-2 {2}the same error again and again: 1 run in 1 session, 2 calls, \$/);
    expect(r.text).toMatch(/C-TRUNC {2}a cut-short result asked for again: 1 run in 1 session, 1 call, \$/);
    expect(r.text).toContain("C-CHURN  one file edited again and again: none.");
    expect(r.text).toContain("C-ORPHAN  a delegated agent after its parent stopped: none.");
    expect(r.text).toContain("rule: the 3rd time a tool returned the same error");
    expect(r.text).toContain("1 tool result said the output was cut short and was not asked for again");
    expect(r.text).toContain("upper bound");
  });

  it("says so when the period holds no call", () => {
    const r = wasteCommand(db, loadSnapshot(PRICES), "2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z");
    expect(r.events).toEqual([]);
    expect(r.text).toBe("The ledger holds no call between 2026-01-01 and 2026-01-31.");
  });

  it("says none of the rules fired, rather than printing zeros as if they were findings", () => {
    const r = wasteCommand(db, loadSnapshot(PRICES), "2026-10-20T10:00:00Z", "2026-10-20T10:01:30Z");
    expect(r.events).toEqual([]);
    expect(r.text).toContain("None of the rules fired.");
  });
});

describe("desk waste, context bloat across compactions", () => {
  const boundary = (ts: string, pre: number, post: number): string =>
    JSON.stringify({ type: "system", subtype: "compact_boundary", isSidechain: false, sessionId: "sess-b", timestamp: ts, compactMetadata: { trigger: "auto", preTokens: pre, postTokens: post, durationMs: 5000 } });
  const line = (id: string, ts: string, tool?: string, input?: unknown): string => assistantLine({ id, session: "sess-b", ts, output: 1_000, write5m: 100_000, ...(tool ? { tools: [tool], toolInputs: [input] } : {}) });

  async function build(scanRepo: boolean): Promise<Ledger> {
    const path = join(work, scanRepo ? "scanned.jsonl" : "unscanned.jsonl");
    writeFileSync(path, [line("b1", at(1), "Read", { file_path: "src/a.ts" }), line("b2", at(5)), boundary(at(10), 500_000, 40_000), line("b3", at(11), "Read", { file_path: "src/a.ts" })].join("\n") + "\n");
    const l = openLedger(":memory:");
    await ingestClaudeCode(l, [path], loadSnapshot(PRICES));
    if (scanRepo) l.prepare("INSERT INTO repo (repo_id, root, default_ref, scanned_at) VALUES (1, '/work/project', 'main', '2026-10-21T00:00:00.000Z')").run();
    return l;
  }

  it("bills a phase that threw away more than the threshold in a repository with no commit then, and says what it cost at least", async () => {
    const l = await build(true);
    const r = wasteCommand(l, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z");
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0]).toMatchObject({ churnTokens: 460_000, landing: "none", flagged: true });
    expect(r.phases[0]!.rereads).toHaveLength(1);
    expect(r.text).toContain("C-BLOAT  context bloat across compactions: 1 compaction, 1 of them threw away more than 50,000 tokens.");
    expect(r.text).toMatch(/1 phase in 1 session in a repository with no commit in that time: 460,000 tokens thrown away, at least \$\d+\.\d\d at the price of writing a token to the cache once\./);
    expect(r.text).toContain("1 file read again within 3 calls of a compaction");
    expect(r.text).toContain("not added to them");
    l.close();
  });

  it("counts the same phase and bills nothing when the session ran outside a repository the ledger scanned", async () => {
    const l = await build(false);
    const r = wasteCommand(l, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z");
    expect(r.phases[0]).toMatchObject({ churnTokens: 460_000, landing: "unknown", flagged: false, wasteMicros: null });
    expect(r.text).toContain("none of those is billed: nothing is known to have landed nothing.");
    expect(r.text).toContain("not billed: 1 ran outside a repository the ledger scanned.");
    l.close();
  });

  it("says no compaction was recorded when the calls hold none", () => {
    const r = wasteCommand(db, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z");
    expect(r.text).toContain("C-BLOAT  context bloat across compactions: no compaction recorded in these calls.");
  });
});
