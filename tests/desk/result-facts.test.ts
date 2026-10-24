import { describe, expect, it } from "vitest";

import { foldResult, parseClaudeCodeLine, resultFacts } from "../../src/desk/ingest/claude-code.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

describe("a result is folded so that the same failure compares equal", () => {
  it("ignores digits, identifiers and spacing, and nothing else", () => {
    const a = foldResult("Error: ENOENT at src/app.ts:41:9 (pid 8812) request 3f2a9c1b-0000-4d2e-8a1f-9b7c6d5e4f30 failed");
    const b = foldResult("Error:  ENOENT at src/app.ts:57:2 (pid 120)\nrequest 9a8b7c6d-1111-4e3f-9b2a-0c1d2e3f4a5b failed");
    expect(a).toBe(b);
    expect(foldResult("Error: ENOENT at src/app.ts")).not.toBe(foldResult("Error: EACCES at src/app.ts"));
    expect(foldResult("DeadBeefCafe0123 and 0123456789abcdef")).toBe("# and #");
    expect(foldResult("Error: NOT FOUND")).toBe(foldResult("error: not found")); // case folds too
    expect(foldResult("x".repeat(50_000)).length).toBe(200); // the head of a result says what failed
    expect(foldResult(`${"q".repeat(200)} tail one`)).toBe(foldResult(`${"q".repeat(200)} a different tail`));
  });

  it("hashes a result without keeping it, and hashes none for an empty one", () => {
    const f = resultFacts("Error: build failed on line 12");
    expect(f.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(f.hash).toBe(resultFacts("Error: build failed on line 99").hash);
    expect(JSON.stringify(f)).not.toContain("build failed");
    expect(resultFacts("")).toEqual({ hash: null, truncated: false });
    // A bare exit status or a few characters cannot tell one failure from another: a search with no match and a build that broke both say "exit code 1".
    expect(resultFacts("Exit code 1").hash).toBeNull();
    expect(resultFacts("Exit code 127.").hash).toBeNull();
    expect(resultFacts("1").hash).toBeNull();
    expect(resultFacts("Exit code 1\nbash: foo: command not found").hash).not.toBeNull();
    expect(resultFacts("Exit code 1").truncated).toBe(false);
    expect(resultFacts([{ type: "text", text: "Error: build failed on line 3" }]).hash).toBe(f.hash);
    expect(resultFacts(42)).toEqual({ hash: null, truncated: false });
  });
});

describe("a tool that cuts its own output short says so, and is heard", () => {
  const truncated = [
    "<persisted-output>\nOutput too large (39.1KB). Full output saved to: /tmp/out.txt\nPreview (first 2KB):",
    "File content (31000 tokens) exceeds maximum allowed tokens (25000). Use offset and limit.",
    "line 1\n... [120 more lines]",
    "first 100 lines shown, [2,300 lines omitted]",
    "Output was too large and was truncated.",
    "... 4,096 more characters",
    "FAILED tests/test_x.py ...Full output truncated (2 lines hidden), use '-vv' to show",
    "page text :: [TRUNCATED]  Tab Context: 12",
  ];
  it.each(truncated)("marks: %s", (t) => expect(resultFacts(t).truncated).toBe(true));

  const whole = [
    "All 12 tests passed.",
    "Error: file not found",
    "export function truncate(s) { return s; }",
    '{"first_break_at": null, "truncated": false, "anchor": "agrees"}',
    'Case("truncated object", "parse", b"")',
    "utf-16-le codec can't decode byte: truncated data",
    "uses truncated prompt if no value provided",
    "a".repeat(200_000),
  ];
  it.each(whole)("does not mark an ordinary result: %s", (t) => expect(resultFacts(t).truncated).toBe(false));

  it("reads only the start and the end of a long result, so a phrase in the middle does not mark it", () => {
    const long = `${"ordinary line ".repeat(1_000)}the output was truncated here${" ordinary line".repeat(1_000)}`;
    expect(resultFacts(long).truncated).toBe(false);
    expect(resultFacts(`${long} [99 lines omitted]`).truncated).toBe(true);
  });
});

describe("the ledger keeps the facts of a result and never its text", () => {
  const line = (id: string, text: string, isError: boolean): string =>
    JSON.stringify({ type: "user", isSidechain: false, uuid: `r-${id}`, timestamp: "2026-10-20T10:00:01.000Z", sessionId: "sess-1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${id}_0`, content: text, is_error: isError }] } });

  it("parses the hash and the mark out of a log line", () => {
    const o = parseClaudeCodeLine(line("a", "Output was too large and was truncated", true));
    expect(o.kind).toBe("tool_results");
    if (o.kind === "tool_results") expect(o.results[0]).toMatchObject({ isError: true, truncated: true, resultChars: 38 });
  });

  it("stores them on ingest, and a backfill fills only what is empty", async () => {
    const t = new TempDir();
    try {
      const path = t.file("a.jsonl", [
        assistantLine({ id: "m1", ts: "2026-10-20T10:00:00.000Z", output: 10, tools: ["Bash"], toolInputs: [{ command: "npm test" }] }),
        line("m1", "Error: failed at line 41", true),
        assistantLine({ id: "m2", ts: "2026-10-20T10:01:00.000Z", output: 10, tools: ["Bash"], toolInputs: [{ command: "npm test" }] }),
        line("m2", "Error: failed at line 97", true),
      ]);
      const db = openLedger(":memory:");
      await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
      const rows = db.prepare("SELECT tool_use_id, result_hash h, truncated t FROM tool_result ORDER BY tool_use_id").all() as { tool_use_id: string; h: string | null; t: number }[];
      expect(rows).toHaveLength(2);
      expect(rows[0]!.h).toBe(rows[1]!.h); // the same error on a new line is the same error
      expect(rows[0]!.h).not.toBeNull();
      // A ledger from before version 14 has no hash: blank them, then backfill.
      db.prepare("UPDATE tool_result SET result_hash = NULL").run();
      db.prepare("UPDATE tool_result SET result_hash = 'keep-me' WHERE tool_use_id = 'tu_m2_0'").run();
      const r = await backfillClaudeCodeFields(db, [path]);
      expect(r.resultFactsFilled).toBe(1);
      const after = db.prepare("SELECT tool_use_id, result_hash h FROM tool_result ORDER BY tool_use_id").all() as { tool_use_id: string; h: string }[];
      expect(after[0]!.h).toBe(rows[0]!.h);
      expect(after[1]!.h).toBe("keep-me"); // a value that is there is never replaced
      expect(JSON.stringify(db.prepare("SELECT * FROM tool_result").all())).not.toContain("failed at line");
      db.close();
    } finally {
      t.dispose();
    }
  });
});
