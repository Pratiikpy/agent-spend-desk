import { describe, expect, it } from "vitest";

import { parseClaudeCodeLine } from "../../src/desk/ingest/claude-code.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { buildTree, delegationTrees, MAX_DEPTH, type EdgeRow, type SourceRow } from "../../src/desk/delegation/tree.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;

/** The result of a tool that launched a delegated agent, as a log line in the session of the agent whose log it is written to. */
const launch = (child: string, ts: string, session = "sess-d", agent?: string): string =>
  JSON.stringify({
    type: "user",
    isSidechain: agent !== undefined,
    ...(agent ? { agentId: agent } : {}),
    uuid: `launch-${child}`,
    timestamp: ts,
    sessionId: session,
    toolUseResult: { isAsync: true, status: "async_launched", agentId: child, description: "A task description that must never be kept" },
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${child}`, content: `Async agent launched. agentId: ${child}` }] },
  });

describe("a delegation in a Claude Code log", () => {
  it("is read from the structured result that launched the agent, and names the agent id and nothing else", () => {
    const o = parseClaudeCodeLine(launch("a258b04c0c18a071f", at(1)));
    expect(o).toMatchObject({ kind: "tool_results", delegations: [{ sessionId: "sess-d", childAgentId: "a258b04c0c18a071f", ts: at(1) }] });
    expect(JSON.stringify(o)).not.toContain("task description");
  });

  it("is not read from text that merely mentions an agent, or from an id that is not one", () => {
    const text = JSON.stringify({ type: "user", uuid: "u", timestamp: at(1), sessionId: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "agentId: a258b04c0c18a071f" }] } });
    expect(parseClaudeCodeLine(text)).not.toHaveProperty("delegations");
    expect(parseClaudeCodeLine(launch("not an agent id!", at(1)))).not.toHaveProperty("delegations");
    expect(parseClaudeCodeLine(launch("", at(1)))).not.toHaveProperty("delegations");
  });

  it("tags every line a delegated agent writes with the agent's own id, whatever the line is", () => {
    expect(parseClaudeCodeLine(assistantLine({ id: "m1", agent: "aaaa1111bbbb2222", sidechain: true, output: 5 }))).toMatchObject({ kind: "call", agentId: "aaaa1111bbbb2222" });
    expect(parseClaudeCodeLine(assistantLine({ id: "m2", output: 5 }))).not.toHaveProperty("agentId");
    expect(parseClaudeCodeLine(launch("a258b04c0c18a071f", at(1), "s", "aaaa1111bbbb2222"))).toMatchObject({ kind: "tool_results", agentId: "aaaa1111bbbb2222" });
  });
});

const src = (id: number | null, agent: string | null, micros: number, over: Partial<SourceRow> = {}): SourceRow => ({ session_id: "s", source_id: id, agent_id: agent, calls: 1, unpriced: 0, micros, sidechain: agent ? 1 : 0, ...over });
const edge = (child: string, parentSource: number | null): EdgeRow => ({ session_id: "s", child_agent_id: child, parent_source_id: parentSource });

describe("the roll-up of one session's tree", () => {
  it("adds each agent's cost to what it started, all the way up, and the root is the whole session", () => {
    // main (1) started A (2); A started B (3) and C (4); main also started D (5).
    const t = buildTree("s", [src(1, null, 100), src(2, "aaa", 50), src(3, "bbb", 20), src(4, "ccc", 30), src(5, "ddd", 7)], [edge("aaa", 1), edge("bbb", 2), edge("ccc", 2), edge("ddd", 1)]);
    const by = Object.fromEntries(t.nodes.map((n) => [n.key, n]));
    expect(by["main"]).toMatchObject({ depth: 0, directMicros: 100, cumulativeMicros: 207, children: 2 });
    expect(by["aaa"]).toMatchObject({ depth: 1, directMicros: 50, cumulativeMicros: 100, parentKey: "main", children: 2 });
    expect(by["bbb"]).toMatchObject({ depth: 2, cumulativeMicros: 20, parentKey: "aaa" });
    expect(t.totalMicros).toBe(207);
    expect(t.maxDepth).toBe(2);
    expect(t.agents).toBe(4);
    // Walked as a reader would: each node, then what it started, the costliest first.
    expect(t.nodes.map((n) => n.key)).toEqual(["main", "aaa", "ccc", "bbb", "ddd"]);
    // No node costs less with its agents than alone.
    for (const n of t.nodes) expect(n.cumulativeMicros).toBeGreaterThanOrEqual(n.directMicros);
  });

  it("puts an agent no log names the starter of under a synthetic node, and drops no dollar", () => {
    const t = buildTree("s", [src(1, null, 100), src(2, "aaa", 50), src(3, "orphan", 9)], [edge("aaa", 1)]);
    const by = Object.fromEntries(t.nodes.map((n) => [n.key, n]));
    expect(by["orphan"]).toMatchObject({ parentKey: "unlinked", depth: 2 });
    expect(by["unlinked"]).toMatchObject({ parentKey: "main", depth: 1, directMicros: 0, cumulativeMicros: 9, flags: ["unlinked_delegation"] });
    expect(t.totalMicros).toBe(159);
    expect(t.unlinkedMicros).toBe(9);
  });

  it("treats a delegated log with no agent id as unlinked, and an edge into a log of another session as unlinked", () => {
    const t = buildTree("s", [src(1, null, 100), src(2, null, 11, { sidechain: 3 }), src(3, "xyz", 4)], [edge("xyz", 99)]);
    const by = Object.fromEntries(t.nodes.map((n) => [n.key, n]));
    expect(by["unlinked"]).toMatchObject({ directMicros: 11, cumulativeMicros: 15 });
    expect(by["xyz"]!.parentKey).toBe("unlinked");
    expect(t.totalMicros).toBe(115);
  });

  it("flags a delegation deeper than five levels, and only that deep", () => {
    const chain = (n: number) => {
      const sources: SourceRow[] = [src(1, null, 1)];
      const edges: EdgeRow[] = [];
      for (let i = 1; i <= n; i += 1) {
        sources.push(src(i + 1, `agent${i}`, 1));
        edges.push(edge(`agent${i}`, i));
      }
      return buildTree("s", sources, edges);
    };
    const five = chain(MAX_DEPTH);
    expect(five.maxDepth).toBe(5);
    expect(five.nodes.flatMap((n) => n.flags)).toEqual([]);
    const six = chain(MAX_DEPTH + 1);
    expect(six.nodes.filter((n) => n.flags.includes("deep_delegation_risk")).map((n) => n.key)).toEqual(["agent6"]);
    expect(six.totalMicros).toBe(7);
  });

  it("flags a loop, cuts it, and still counts every agent once", () => {
    // A says B started it and B says A started it: a log that cannot be right.
    const t = buildTree("s", [src(1, null, 10), src(2, "aaa", 5), src(3, "bbb", 3)], [edge("aaa", 3), edge("bbb", 2)]);
    expect(t.nodes.filter((n) => n.flags.includes("delegation_loop")).map((n) => n.key).sort()).toEqual(["aaa", "bbb"]);
    expect(t.totalMicros).toBe(18);
    expect(new Set(t.nodes.map((n) => n.key)).size).toBe(t.nodes.length);
  });

  it("makes one root of a resumed session's chain of logs, and counts unpriced calls apart", () => {
    const t = buildTree("s", [src(1, null, 100, { calls: 4 }), src(2, null, 40, { calls: 3, unpriced: 2 })], []);
    expect(t.nodes).toHaveLength(1);
    expect(t.nodes[0]).toMatchObject({ key: "main", calls: 7, unpricedCalls: 2, directMicros: 140 });
  });

  it("has a root even when every call of the session was a delegated agent's", () => {
    const t = buildTree("s", [src(2, "aaa", 6)], [edge("aaa", 7)]);
    expect(t.nodes[0]).toMatchObject({ key: "main", directMicros: 0, cumulativeMicros: 6 });
  });
});

describe("the tree read from a ledger", () => {
  it("is rebuilt from logs: who started whom comes from the result in the starter's own log", async () => {
    const t = new TempDir();
    try {
      const main = t.file("sess-d.jsonl", [assistantLine({ id: "m1", session: "sess-d", ts: at(0), output: 10_000 }), launch("aaaa1111", at(1)), launch("dddd4444", at(2)), assistantLine({ id: "m2", session: "sess-d", ts: at(30), output: 10_000 })]);
      const a = t.file("agent-aaaa1111.jsonl", [assistantLine({ id: "a1", session: "sess-d", ts: at(3), output: 40_000, sidechain: true, agent: "aaaa1111" }), launch("bbbb2222", at(4), "sess-d", "aaaa1111")]);
      const b = t.file("agent-bbbb2222.jsonl", [assistantLine({ id: "b1", session: "sess-d", ts: at(5), output: 20_000, sidechain: true, agent: "bbbb2222" })]);
      const d = t.file("agent-dddd4444.jsonl", [assistantLine({ id: "d1", session: "sess-d", ts: at(6), output: 5_000, sidechain: true, agent: "dddd4444" })]);
      const lonely = t.file("agent-eeee5555.jsonl", [assistantLine({ id: "e1", session: "sess-d", ts: at(7), output: 1_000, sidechain: true, agent: "eeee5555" })]);
      const db = openLedger(":memory:");
      const r = await ingestClaudeCode(db, [main, a, b, d, lonely], loadSnapshot(PRICES));
      expect(r.delegations).toBe(3);
      const [tree] = delegationTrees(db, { sessionIds: ["sess-d"] });
      const by = Object.fromEntries(tree!.nodes.map((n) => [n.key, n]));
      expect(by["aaaa1111"]).toMatchObject({ parentKey: "main", depth: 1 });
      expect(by["bbbb2222"]).toMatchObject({ parentKey: "aaaa1111", depth: 2 });
      expect(by["dddd4444"]).toMatchObject({ parentKey: "main" });
      expect(by["eeee5555"]).toMatchObject({ parentKey: "unlinked" }); // no log names who started it
      expect(by["aaaa1111"]!.cumulativeMicros).toBe(by["aaaa1111"]!.directMicros + by["bbbb2222"]!.directMicros);
      // Every call of the session is in the tree once.
      const sessionTotal = (db.prepare("SELECT SUM(total_micros) t FROM cost_event c JOIN model_call m ON m.call_id = c.call_id WHERE m.session_id = 'sess-d'").get() as { t: number }).t;
      expect(tree!.totalMicros).toBe(sessionTotal);
      // The task text was never stored.
      expect(JSON.stringify(db.prepare("SELECT * FROM delegation_edge").all())).not.toContain("task description");
      // Read again, nothing is added.
      expect((await ingestClaudeCode(db, [main, a, b, d, lonely], loadSnapshot(PRICES))).delegations).toBe(0);
      expect(delegationTrees(db, { sinceIso: at(0), untilIso: at(59), onlyDelegating: true }).map((x) => x.sessionId)).toEqual(["sess-d"]);
      db.close();
    } finally {
      t.dispose();
    }
  });

  it("is filled into a ledger read before version 16, and forgotten with the session", async () => {
    const t = new TempDir();
    try {
      const main = t.file("sess-d.jsonl", [assistantLine({ id: "m1", session: "sess-d", ts: at(0), output: 10_000 }), launch("aaaa1111", at(1))]);
      const a = t.file("agent-aaaa1111.jsonl", [assistantLine({ id: "a1", session: "sess-d", ts: at(3), output: 40_000, sidechain: true, agent: "aaaa1111" })]);
      const db = openLedger(":memory:");
      await ingestClaudeCode(db, [main, a], loadSnapshot(PRICES));
      db.exec("DELETE FROM delegation_edge; UPDATE ingest_source SET agent_id = NULL");
      const r = await backfillClaudeCodeFields(db, [main, a]);
      expect(r).toMatchObject({ delegationsFilled: 1, agentsNamed: 1 });
      expect((await backfillClaudeCodeFields(db, [main, a])).delegationsFilled).toBe(0);
      expect(delegationTrees(db, { sessionIds: ["sess-d"] })[0]!.agents).toBe(1);
      forgetLedger(db, { all: true });
      expect((db.prepare("SELECT COUNT(*) n FROM delegation_edge").get() as { n: number }).n).toBe(0);
      db.close();
    } finally {
      t.dispose();
    }
  });
});
