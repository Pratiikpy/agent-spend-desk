import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseClaudeCodeLine, workflowRunOfPath } from "../../src/desk/ingest/claude-code.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { buildTree, delegationTrees, type EdgeRow, type SourceRow, type WorkflowRow } from "../../src/desk/delegation/tree.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;

/** The result that launched a workflow run, written to the log of whichever agent started it. */
const runLaunch = (run: string, name: string, ts: string, session = "sess-d", agent?: string): string =>
  JSON.stringify({
    type: "user",
    isSidechain: agent !== undefined,
    ...(agent ? { agentId: agent } : {}),
    uuid: `run-${run}`,
    timestamp: ts,
    sessionId: session,
    toolUseResult: { status: "async_launched", taskId: "t1", taskType: "local_workflow", workflowName: name, runId: run, summary: "A summary that must never be kept", transcriptDir: "D:/work/x" },
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${run}`, content: "Workflow launched in background." }] },
  });

describe("a workflow run in a Claude Code log", () => {
  it("is read from the result that launched it, with the owner's label for the script and nothing else", () => {
    const o = parseClaudeCodeLine(runLaunch("wf_01a7ef7d-2e9", "s2-field-teardown", at(1)));
    expect(o).toMatchObject({ kind: "tool_results", workflows: [{ sessionId: "sess-d", runId: "wf_01a7ef7d-2e9", name: "s2-field-teardown", ts: at(1) }] });
    expect(JSON.stringify(o)).not.toContain("summary that must never");
    expect(JSON.stringify(o)).not.toContain("D:/work/x");
  });

  it("cuts a long label short and ignores a run id that is not one, or a launch that is not a workflow", () => {
    expect(parseClaudeCodeLine(runLaunch("wf_abc123", "n".repeat(200), at(1)))).toMatchObject({ workflows: [{ name: "n".repeat(60) }] });
    expect(parseClaudeCodeLine(runLaunch("not-a-run", "x", at(1)))).not.toHaveProperty("workflows");
    expect(parseClaudeCodeLine(runLaunch("wf_abc123", "x", at(1)).replace("local_workflow", "local_bash"))).not.toHaveProperty("workflows");
  });

  it("is named from where an agent's log sits, on either kind of slash", () => {
    expect(workflowRunOfPath("/srv/logs/p/sess/subagents/workflows/wf_01a7ef7d-2e9/agent-a1.jsonl")).toBe("wf_01a7ef7d-2e9");
    expect(workflowRunOfPath("D:\\logs\\p\\sess\\subagents\\workflows\\wf_x1y2z3\\agent-a1.jsonl")).toBe("wf_x1y2z3");
    expect(workflowRunOfPath("/srv/logs/p/sess/subagents/agent-a1.jsonl")).toBeNull();
    expect(workflowRunOfPath("/srv/workflows/notarun/agent-a1.jsonl")).toBeNull();
  });
});

const src = (id: number | null, agent: string | null, micros: number): SourceRow => ({ session_id: "s", source_id: id, agent_id: agent, calls: 1, unpriced: 0, micros, sidechain: agent ? 1 : 0 });
const edge = (child: string, parentSource: number | null): EdgeRow => ({ session_id: "s", child_agent_id: child, parent_source_id: parentSource });
const run = (id: string, parent: number | null, name: string | null = null): WorkflowRow => ({ session_id: "s", run_id: id, parent_source_id: parent, name });
const inRun = (id: number, agent: string, micros: number, wf: string): SourceRow => ({ ...src(id, agent, micros), workflow_run: wf });

describe("the roll-up with workflow runs", () => {
  it("makes the run a node with no calls of its own, started by the agent whose log launched it, with its agents below it", () => {
    const t = buildTree("s", [src(1, null, 100), inRun(2, "aaa", 30, "wf_r1"), inRun(3, "bbb", 20, "wf_r1")], [], [run("wf_r1", 1, "s2-teardown")]);
    const by = Object.fromEntries(t.nodes.map((n) => [n.key, n]));
    expect(by["wf:wf_r1"]).toMatchObject({ name: "s2-teardown", parentKey: "main", depth: 1, calls: 0, directMicros: 0, cumulativeMicros: 50, children: 2 });
    expect(by["aaa"]).toMatchObject({ parentKey: "wf:wf_r1", depth: 2 });
    expect(by["main"]!.cumulativeMicros).toBe(150);
    expect(t.agents).toBe(2); // the run is not an agent
    expect(t.totalMicros).toBe(150);
  });

  it("lets an agent's own edge win over the run its log sits in: an agent a workflow's agent started hangs under that agent", () => {
    const t = buildTree("s", [src(1, null, 10), inRun(2, "aaa", 5, "wf_r1"), inRun(3, "bbb", 3, "wf_r1")], [edge("bbb", 2)], [run("wf_r1", 1)]);
    expect(Object.fromEntries(t.nodes.map((n) => [n.key, n.parentKey]))).toMatchObject({ aaa: "wf:wf_r1", bbb: "aaa" });
  });

  it("hangs a run no log names the starter of under the unlinked node, keeping its agents together", () => {
    const t = buildTree("s", [src(1, null, 10), inRun(2, "aaa", 5, "wf_lost"), inRun(3, "bbb", 3, "wf_lost")], [], []);
    const by = Object.fromEntries(t.nodes.map((n) => [n.key, n]));
    expect(by["wf:wf_lost"]).toMatchObject({ parentKey: "unlinked", name: null, cumulativeMicros: 8 });
    expect(by["unlinked"]!.flags).toEqual(["unlinked_delegation"]);
    expect(t.totalMicros).toBe(18);
  });

  it("starts a run from a workflow agent's log, one level deeper", () => {
    const t = buildTree("s", [src(1, null, 1), inRun(2, "aaa", 1, "wf_a"), inRun(3, "bbb", 1, "wf_b")], [], [run("wf_a", 1), run("wf_b", 2)]);
    expect(Object.fromEntries(t.nodes.map((n) => [n.key, n.depth]))).toEqual({ main: 0, "wf:wf_a": 1, aaa: 2, "wf:wf_b": 3, bbb: 4 });
  });
});

describe("workflow runs read from a ledger", () => {
  it("places a workflow's agents under the run that the launching result names, from the folder their logs sit in", async () => {
    const t = new TempDir();
    try {
      const folder = join(t.path, "sess-d", "subagents", "workflows", "wf_run0001");
      mkdirSync(folder, { recursive: true });
      const main = t.file("sess-d.jsonl", [assistantLine({ id: "m1", session: "sess-d", ts: at(0), output: 10_000 }), runLaunch("wf_run0001", "teardown", at(1))]);
      const w1 = join(folder, "agent-aa11aa11.jsonl");
      const w2 = join(folder, "agent-bb22bb22.jsonl");
      writeFileSync(w1, `${assistantLine({ id: "w1", session: "sess-d", ts: at(2), output: 30_000, sidechain: true, agent: "aa11aa11" })}\n`);
      writeFileSync(w2, `${assistantLine({ id: "w2", session: "sess-d", ts: at(3), output: 20_000, sidechain: true, agent: "bb22bb22" })}\n`);
      const db = openLedger(":memory:");
      const r = await ingestClaudeCode(db, [main, w1, w2], loadSnapshot(PRICES));
      expect(r.workflows).toBe(1);
      const [tree] = delegationTrees(db, { sessionIds: ["sess-d"] });
      const by = Object.fromEntries(tree!.nodes.map((n) => [n.key, n]));
      expect(by["wf:wf_run0001"]).toMatchObject({ name: "teardown", parentKey: "main", depth: 1 });
      expect(by["aa11aa11"]).toMatchObject({ parentKey: "wf:wf_run0001", depth: 2 });
      expect(tree!.nodes.some((n) => n.key === "unlinked")).toBe(false);
      expect(JSON.stringify(db.prepare("SELECT * FROM workflow_run").all())).not.toContain("summary that must never");
      expect((await ingestClaudeCode(db, [main, w1, w2], loadSnapshot(PRICES))).workflows).toBe(0);
      // A ledger read before version 17: place the logs and the run again from the files.
      db.exec("DELETE FROM workflow_run; UPDATE ingest_source SET workflow_run = NULL");
      expect(await backfillClaudeCodeFields(db, [main, w1, w2])).toMatchObject({ workflowsFilled: 1, logsPlaced: 2 });
      expect(delegationTrees(db, { sessionIds: ["sess-d"] })[0]!.nodes.some((n) => n.key === "unlinked")).toBe(false);
      db.close();
    } finally {
      t.dispose();
    }
  });
});
