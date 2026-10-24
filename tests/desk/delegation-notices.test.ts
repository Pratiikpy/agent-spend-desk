import { describe, expect, it } from "vitest";

import { parseClaudeCodeLine } from "../../src/desk/ingest/claude-code.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { delegationTrees } from "../../src/desk/delegation/tree.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;

/** The notice an older client queues in the log of the agent that started a delegated agent, when that agent finishes. */
const notice = (taskId: string, ts: string, op = "enqueue", session = "sess-n"): string =>
  JSON.stringify({ type: "queue-operation", operation: op, timestamp: ts, sessionId: session, content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>toolu_01abc</tool-use-id>\n<output-file>D:/work/out.txt</output-file>\n<status>completed</status>\n<summary>A summary that must never be kept</summary>\n</task-notification>` });

describe("the notice an older client queues when a delegated agent finishes", () => {
  it("names the agent and the session, and nothing else", () => {
    const o = parseClaudeCodeLine(notice("a00f9912ff8bcc2e0", at(2)));
    expect(o).toEqual({ kind: "delegation_notice", delegations: [{ sessionId: "sess-n", childAgentId: "a00f9912ff8bcc2e0", ts: at(2) }] });
    expect(JSON.stringify(o)).not.toContain("summary that must never");
  });

  it("is not read from the later removal, a background shell task, an id that is not an agent's, or a queued message that is not a notice", () => {
    expect(parseClaudeCodeLine(notice("a00f9912ff8bcc2e0", at(2), "remove"))).toEqual({ kind: "ignored" });
    expect(parseClaudeCodeLine(notice("b0esfkjd7", at(2)))).toEqual({ kind: "ignored" });
    expect(parseClaudeCodeLine(notice("a00f9912ff8bcc2e0zz", at(2)))).toEqual({ kind: "ignored" });
    const plain = JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: at(2), sessionId: "s", content: "please carry on" });
    expect(parseClaudeCodeLine(plain)).toEqual({ kind: "ignored" });
    expect(parseClaudeCodeLine(JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "later", sessionId: "s", content: "<task-notification><task-id>a00f9912ff8bcc2e0</task-id>" }))).toEqual({ kind: "ignored" });
  });

  it("links an agent whose launching result named no id to the log the notice sits in, and keeps the first edge when both exist", async () => {
    const t = new TempDir();
    try {
      const main = t.file("sess-n.jsonl", [assistantLine({ id: "m1", session: "sess-n", ts: at(0), output: 10_000 }), notice("a1111111111111111", at(5))]);
      const a = t.file("agent-a1111111111111111.jsonl", [assistantLine({ id: "a1", session: "sess-n", ts: at(2), output: 40_000, sidechain: true, agent: "a1111111111111111" }), notice("a2222222222222222", at(6))]);
      const b = t.file("agent-a2222222222222222.jsonl", [assistantLine({ id: "b1", session: "sess-n", ts: at(3), output: 20_000, sidechain: true, agent: "a2222222222222222" })]);
      const db = openLedger(":memory:");
      const r = await ingestClaudeCode(db, [main, a, b], loadSnapshot(PRICES));
      expect(r.delegations).toBe(2);
      const [tree] = delegationTrees(db, { sessionIds: ["sess-n"] });
      const by = Object.fromEntries(tree!.nodes.map((n) => [n.key, n]));
      expect(by["a1111111111111111"]).toMatchObject({ parentKey: "main", depth: 1 });
      expect(by["a2222222222222222"]).toMatchObject({ parentKey: "a1111111111111111", depth: 2 });
      expect(tree!.nodes.some((n) => n.key === "unlinked")).toBe(false);
      expect(JSON.stringify(db.prepare("SELECT * FROM delegation_edge").all())).not.toContain("summary that must never");
      db.exec("DELETE FROM delegation_edge");
      expect((await backfillClaudeCodeFields(db, [main, a, b])).delegationsFilled).toBe(2);
      db.close();
    } finally {
      t.dispose();
    }
  });
});
