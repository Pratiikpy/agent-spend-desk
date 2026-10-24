import { describe, expect, it } from "vitest";

import { estimateFromLedger } from "../../../src/desk/estimate/from-ledger.ts";
import { createMcpSession, type McpContext } from "../../../src/desk/gate/mcp.ts";
import { openLedger } from "../../../src/desk/ledger/db.ts";
import { rig } from "./harness.ts";

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } };

function session(ctx?: McpContext) {
  const r = rig();
  const s = createMcpSession(r.gate, ctx);
  const send = (o: unknown): Record<string, any> => JSON.parse(String(s.handle(JSON.stringify(o)))) as Record<string, any>;
  send(INIT);
  return { send };
}

const callTool = (args: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "estimate_cost", arguments: args } });

describe("the estimate_cost tool", () => {
  it("is listed, read-only, and not an approval", () => {
    const { send } = session();
    const tools = send({ jsonrpc: "2.0", id: 2, method: "tools/list" }).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    const t = tools.find((x) => x.name === "estimate_cost");
    expect(t?.annotations.readOnlyHint).toBe(true);
  });

  it("says so as a tool error, not as a gate failure, when the server has no ledger", () => {
    const r = session().send(callTool({ type: "fix" })).result;
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe("E_NO_LEDGER");
    expect(r.structuredContent.error.message).toMatch(/--ledger FILE/);
  });

  it("answers no estimate, with the reason, from a ledger with too few tasks", () => {
    const db = openLedger(":memory:");
    const r = session({ estimate: estimateFromLedger(db, undefined, "no-such-label-file.jsonl") }).send(callTool({ type: "fix", cap_usd: 5 })).result;
    expect(r.isError).toBe(false);
    expect(r.structuredContent.estimate).toBeNull();
    expect(r.structuredContent.reason).toMatch(/no estimate: fewer than 10 similar tasks/);
    db.close();
  });

  it("answers a range with the number of tasks behind it, from a ledger with enough of them", () => {
    const db = openLedger(":memory:");
    db.prepare("INSERT INTO price_snapshot (snapshot_id, source, source_url, fetched_at, license, upstream_sha256, content_hash, note) VALUES ('p', 's', 'u', 't', 'l', 'h', 'h', 'n')").run();
    for (let i = 1; i <= 12; i += 1) {
      db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at) VALUES (?, 'claude_code', 'C:/w/shop', ?, '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z')").run(`s${i}`, `fix/bug-${i}`);
      db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, '2026-10-20T10:30:00.000Z', 'm', 0, 1, 1, 0, 0, 0, 0, 'reported', 0, 0)").run(`c${i}`, `s${i}`);
      db.prepare("INSERT INTO cost_event (call_id, class, snapshot_id, total_micros, input_micros, output_micros, cache_read_micros, cache_write_5m_micros, cache_write_1h_micros) VALUES (?, 'estimated', 'p', ?, ?, 0, 0, 0, 0)").run(`c${i}`, i * 1_000_000, i * 1_000_000);
    }
    const r = session({ estimate: estimateFromLedger(db, () => Date.parse("2026-10-24T12:00:00.000Z"), "no-such-label-file.jsonl") }).send(callTool({ type: "fix", cap_usd: 10 })).result;
    expect(r.isError).toBe(false);
    expect(r.structuredContent.estimate).toEqual({ p10Micros: 2_000_000, p50Micros: 6_000_000, p90Micros: 11_000_000 });
    expect(r.structuredContent.basedOn.tasks).toBe(12);
    expect(r.structuredContent.chanceOverCap).toBeCloseTo(2 / 12, 9);
    expect(JSON.stringify(r.structuredContent)).not.toMatch(/p50Micros":\s*\d+\s*,\s*"point/);
    db.close();
  });
});
