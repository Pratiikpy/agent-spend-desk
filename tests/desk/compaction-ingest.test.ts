import { describe, expect, it } from "vitest";

import { parseClaudeCodeLine } from "../../src/desk/ingest/claude-code.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

const boundary = (over: Record<string, unknown> = {}, meta: Record<string, unknown> | null = {}): string =>
  JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    isSidechain: false,
    sessionId: "sess-1",
    timestamp: "2026-10-20T10:30:00.000Z",
    compactMetadata: meta === null ? undefined : { trigger: "auto", preTokens: 970_495, postTokens: 24_418, cumulativeDroppedTokens: 946_077, durationMs: 39_416, preCompactDiscoveredTools: ["WebSearch"], ...meta },
    ...over,
  });

describe("a compaction boundary in a Claude Code log", () => {
  it("is read for when it happened, what started it, and the tokens before and after, and nothing else", () => {
    const o = parseClaudeCodeLine(boundary());
    expect(o).toEqual({ kind: "compaction", compaction: { sessionId: "sess-1", ts: "2026-10-20T10:30:00.000Z", trigger: "auto", preTokens: 970_495, postTokens: 24_418, durationMs: 39_416 } });
    expect(JSON.stringify(o)).not.toContain("WebSearch"); // the list of tools it found is not kept
  });

  it("keeps a boundary from an older client that does not say the size after, or how long it took", () => {
    const o = parseClaudeCodeLine(boundary({}, { postTokens: undefined, durationMs: undefined, trigger: "manual" }));
    expect(o).toMatchObject({ kind: "compaction", compaction: { trigger: "manual", preTokens: 970_495, postTokens: null, durationMs: null } });
  });

  it.each([
    ["no session", boundary({ sessionId: undefined }), "compaction-without-session"],
    ["no timestamp", boundary({ timestamp: undefined }), "compaction-without-timestamp"],
    ["a timestamp that is not a time", boundary({ timestamp: "later" }), "compaction-without-timestamp"],
    ["no metadata", boundary({}, null), "compaction-without-metadata"],
    ["no size before", boundary({}, { preTokens: undefined }), "compaction-without-token-count"],
    ["a size that is not a whole number", boundary({}, { preTokens: 1.5 }), "compaction-without-token-count"],
    ["a negative size", boundary({}, { preTokens: -4 }), "compaction-without-token-count"],
  ])("reports %s as malformed, not as a compaction of zero", (_name, line, reason) => {
    expect(parseClaudeCodeLine(line)).toEqual({ kind: "malformed", reason });
  });

  it("treats a bad size after as unknown rather than refusing the boundary", () => {
    expect(parseClaudeCodeLine(boundary({}, { postTokens: "many" }))).toMatchObject({ kind: "compaction", compaction: { postTokens: null } });
  });

  it("does not take another kind of system line for a compaction", () => {
    expect(parseClaudeCodeLine(JSON.stringify({ type: "system", subtype: "local_command", sessionId: "s", timestamp: "2026-10-20T10:00:00.000Z" }))).toEqual({ kind: "ignored" });
  });
});

describe("the ledger keeps compactions and the client version of each call", () => {
  it("stores a compaction once, counts it, and reads nothing twice", async () => {
    const t = new TempDir();
    try {
      const path = t.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00.000Z", output: 10, version: "2.1.100" }), boundary(), assistantLine({ id: "m2", ts: "2026-10-20T10:31:00.000Z", output: 10, version: "2.1.101" })]);
      const db = openLedger(":memory:");
      const r = await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
      expect(r.compactions).toBe(1);
      expect(db.prepare("SELECT session_id, ts, trigger, pre_tokens, post_tokens, duration_ms FROM session_compaction").all()).toEqual([
        { session_id: "sess-1", ts: "2026-10-20T10:30:00.000Z", trigger: "auto", pre_tokens: 970_495, post_tokens: 24_418, duration_ms: 39_416 },
      ]);
      expect(db.prepare("SELECT call_id, tool_version FROM model_call ORDER BY ts").all()).toEqual([{ call_id: "m1", tool_version: "2.1.100" }, { call_id: "m2", tool_version: "2.1.101" }]);
      // The same log read again adds nothing.
      const again = await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
      expect(again.compactions).toBe(0);
      expect((db.prepare("SELECT COUNT(*) n FROM session_compaction").get() as { n: number }).n).toBe(1);
      // A session copied into a second file (a resumed session) does not count a compaction twice.
      const copy = t.file("b.jsonl", [boundary()]);
      expect((await ingestClaudeCode(db, [copy], loadSnapshot(PRICES))).compactions).toBe(0);
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("counts a malformed boundary in the report and does not store it", async () => {
    const t = new TempDir();
    try {
      const path = t.file("a.jsonl", [assistantLine({ id: "m1", output: 10 }), boundary({}, { preTokens: "big" })]);
      const db = openLedger(":memory:");
      const r = await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
      expect(r.malformedReasons["compaction-without-token-count"]).toBe(1);
      expect((db.prepare("SELECT COUNT(*) n FROM session_compaction").get() as { n: number }).n).toBe(0);
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("fills them into a ledger read before version 15, and replaces nothing that is there", async () => {
    const t = new TempDir();
    try {
      const path = t.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00.000Z", output: 10, version: "2.1.100" }), assistantLine({ id: "m2", ts: "2026-10-20T10:01:00.000Z", output: 10, version: "2.1.101" }), boundary()]);
      const db = openLedger(":memory:");
      await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
      db.exec("DELETE FROM session_compaction; UPDATE model_call SET tool_version = NULL WHERE call_id = 'm1'; UPDATE model_call SET tool_version = 'kept' WHERE call_id = 'm2'");
      const r = await backfillClaudeCodeFields(db, [path]);
      expect(r).toMatchObject({ toolVersionFilled: 1, compactionsFilled: 1 });
      expect(db.prepare("SELECT call_id, tool_version FROM model_call ORDER BY ts").all()).toEqual([{ call_id: "m1", tool_version: "2.1.100" }, { call_id: "m2", tool_version: "kept" }]);
      expect((await backfillClaudeCodeFields(db, [path])).compactionsFilled).toBe(0); // running it twice changes nothing
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("forgets a session's compactions with the session", async () => {
    const t = new TempDir();
    try {
      const path = t.file("a.jsonl", [assistantLine({ id: "m1", output: 10 }), boundary()]);
      const db = openLedger(":memory:");
      await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
      forgetLedger(db, { all: true });
      expect((db.prepare("SELECT COUNT(*) n FROM session_compaction").get() as { n: number }).n).toBe(0);
      db.close();
    } finally {
      t.dispose();
    }
  });
});
