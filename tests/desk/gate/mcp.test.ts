import { describe, expect, it } from "vitest";

import { createMcpSession } from "../../../src/desk/gate/mcp.ts";
import { call, rig } from "./harness.ts";

function session() {
  const r = rig();
  const s = createMcpSession(r.gate);
  const send = (o: unknown): Record<string, any> => JSON.parse(String(s.handle(JSON.stringify(o)))) as Record<string, any>;
  return { r, s, send };
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } };

describe("the Desk MCP server", () => {
  it("refuses a request before any handshake or version metadata", () => {
    const { send } = session();
    expect(send({ jsonrpc: "2.0", id: 1, method: "tools/list" }).error.code).toBe(-32602);
  });

  it("completes the legacy handshake and lists its tools, with no tool to approve", () => {
    const { s, send } = session();
    const init = send(INIT);
    expect(init.result.serverInfo.name).toBe("desk-gate");
    expect(s.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeNull();
    const names = (send({ jsonrpc: "2.0", id: 2, method: "tools/list" }).result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["budget_left", "authorize", "settle", "void"]));
    expect(names.some((n) => /approve|bypass|pause/.test(n))).toBe(false);
  });

  it("authorizes and settles through tools/call, and reports a refused request as a tool error", () => {
    const { send } = session();
    send(INIT);
    const ok = send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "authorize", arguments: call({ idempotency_key: "m1" }) } });
    expect(ok.result.isError).toBe(false);
    expect(ok.result.structuredContent.verdict).toBe("allow");
    const settled = send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "settle", arguments: { reservation_id: ok.result.structuredContent.reservationId, actual_micros: 1000 } } });
    expect(settled.result.structuredContent.state).toBe("settled");
    const bad = send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "authorize", arguments: { junk: 1 } } });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.structuredContent.verdict).toBe("deny");
  });

  it("answers an unknown tool, an unknown method, junk and a batch as protocol errors", () => {
    const { s, send } = session();
    send(INIT);
    expect(send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope", arguments: {} } }).error.code).toBe(-32602);
    expect(send({ jsonrpc: "2.0", id: 7, method: "nope/nothing" }).error.code).toBe(-32601);
    expect(JSON.parse(String(s.handle("{bad"))).error.code).toBe(-32700);
    expect(JSON.parse(String(s.handle("[]"))).error.code).toBe(-32600);
    expect(s.handle("")).toBeNull();
  });

  it("rejects an unsupported modern protocol version with the supported list", () => {
    const { send } = session();
    const r = send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1999-01-01", "io.modelcontextprotocol/clientCapabilities": {} } } });
    expect(r.error.code).toBe(-32022);
    expect(r.error.data.supported).toContain("2026-07-28");
  });

  it("serves a modern request that carries its own version and capabilities", () => {
    const { send } = session();
    const r = send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } });
    expect(r.result.tools.length).toBeGreaterThan(3);
  });
});
