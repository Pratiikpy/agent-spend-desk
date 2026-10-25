import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { policyToDoc } from "../policy/doc.ts";
import type { Gate } from "./gate.ts";
import { GateError } from "./types.ts";
import { asObject, optStr } from "./validate.ts";

/**
 * The Desk MCP server over stdio. Protocol facts are from the specification pages read on 2026-10-22:
 * newline-delimited JSON-RPC with no embedded newlines and nothing but messages on stdout; the 2026-07-28
 * revision has no handshake (each request carries `_meta` with the protocol version and client capabilities,
 * `server/discover` lists versions, error -32022 reports an unsupported version, -32602 a malformed request);
 * the 2025-11-25 revision and earlier open with `initialize` and `notifications/initialized`. This server
 * answers both eras. Tool failures are results with `isError: true`; an unknown tool is a protocol error.
 *
 * The tools are advisory by nature (spec 10.5, surface 3): an agent that does not call them is not stopped.
 * There is no approve tool: an agent cannot approve its own request.
 */
export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "desk-gate", version: "0.1.0" };
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const INSTRUCTIONS =
  "Spend gate for AI agents. Call authorize before a paid call and settle after it (void if the call did not happen). budget_left and spend_so_far are read-only. These tools are advisory: they cannot stop an agent that does not call them.";

/** What a tool may need besides the gate. The estimate reads the usage ledger, which the gate does not hold. */
export interface McpContext {
  estimate?: (args: Record<string, unknown>) => unknown;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  run(gate: Gate, args: Record<string, unknown>, ctx: McpContext): unknown;
}

const STR = { type: "string", minLength: 1, maxLength: 256 };
const INT = { type: "integer", minimum: 0 };

const REQUEST_PROPS = {
  session_id: STR,
  person: { ...STR, description: "Whose budget this counts against." },
  project: STR,
  agent: STR,
  model: { ...STR, description: "The model that will be called, as the price book names it." },
  task_type: STR,
  action: STR,
  tool: STR,
  input_tokens: { ...INT, description: "Counted input tokens of the request." },
  max_tokens: { ...INT, description: "The output limit of the request; 16384 is assumed when absent." },
  n: { type: "integer", minimum: 1, maximum: 64 },
  estimate_micros: { ...INT, description: "An explicit worst case in micro-dollars. It can raise the reservation, never lower it." },
  idempotency_key: { ...STR, description: "Send the same key when retrying the same call; a retry returns the first decision." },
  call_ref: STR,
  ttl_ms: INT,
  approval_id: INT,
};

export const TOOLS: readonly ToolDef[] = [
  {
    name: "budget_left",
    description: "What is left of a person's day and month budgets under the caps that apply to them. Read-only.",
    inputSchema: { type: "object", properties: { person: STR, project: STR, agent: STR, model: STR }, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: (g, a) => g.budgetLeft(a),
  },
  {
    name: "spend_so_far",
    description: "Spent and reserved micro-dollars for a person in the current day or month. Read-only.",
    inputSchema: { type: "object", properties: { person: STR, period: { enum: ["day", "month"] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: (g, a) => {
      const period = a["period"] === "month" ? "month" : "day";
      const standing = g.budgetLeft({ person: optStr(a, "person") ?? g.person }).standing.find((s) => s.window === period);
      return { period, spentMicros: standing?.spentMicros ?? 0, reservedMicros: standing?.reservedMicros ?? 0, limitMicros: standing?.limitMicros ?? null };
    },
  },
  {
    name: "policy_get",
    description: "The spend policy now in force, as the document the owner wrote, with its version. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: (g) => {
      const v = g.currentPolicy();
      return { version: v.version, digest: v.digest, policy: policyToDoc(v.policy) };
    },
  },
  {
    name: "authorize",
    description:
      "Reserve the worst-case cost of one paid call before making it. Returns allow, ask or deny with reasons. On allow, keep the reservation_id and call settle afterwards. Advisory: it cannot stop a call you do not ask about.",
    inputSchema: { type: "object", properties: REQUEST_PROPS, required: ["session_id", "person", "model"], additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (g, a) => g.authorize(a),
  },
  {
    name: "settle",
    description: "Record what a reserved call actually cost. The settled amount is capped at the reservation; any excess is recorded as an overage and pauses the person.",
    inputSchema: { type: "object", properties: { reservation_id: INT, idempotency_key: STR, actual_micros: INT, call_ref: STR }, required: ["actual_micros"], additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (g, a) => g.settle(a),
  },
  {
    name: "void",
    description: "Release a reservation because the call did not happen.",
    inputSchema: { type: "object", properties: { reservation_id: INT, idempotency_key: STR }, additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (g, a) => g.voidReservation(a),
  },
  {
    name: "tool_begin",
    description:
      "Before a tool call that must not run twice: returns proceed, in_flight (the same call is already running) or replayed (it completed recently; the cached response is returned). A read-only tool such as Read passes through unless dedupe is true; every other tool is held to one run for five minutes.",
    inputSchema: {
      type: "object",
      properties: { session_id: STR, tool_name: STR, arguments: { type: "object" }, dedupe: { type: "boolean" }, reserve: { type: "object", properties: REQUEST_PROPS } },
      required: ["session_id", "tool_name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (g, a) => g.toolBegin(a),
  },
  {
    name: "tool_complete",
    description: "After the tool call: record its response so a retry is answered from the cache instead of running again.",
    inputSchema: { type: "object", properties: { idempotency_key: STR, response: {}, failed: { type: "boolean" } }, required: ["idempotency_key"], additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (g, a) => g.toolComplete(a),
  },
  {
    name: "estimate_cost",
    description: "Before a large task: the cost range (10th to 90th percentile, with the number of tasks behind it) of similar past tasks, or no estimate when fewer than ten are similar. Never a point figure. Read-only.",
    inputSchema: { type: "object", properties: { type: { ...STR, description: "The kind of task: a branch prefix such as fix or feat, a ticket project key, or the text before a colon in a task label." }, repo: { ...STR, description: "A path inside the repository." }, cap_usd: { type: "number", minimum: 0, description: "A cap to measure the chance of crossing." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: (_g, a, ctx) => {
      if (ctx.estimate === undefined) throw new GateError("E_NO_LEDGER", "this server was started without a usage ledger; start it with --ledger FILE to enable estimates");
      return ctx.estimate(a);
    },
  },
];

type Id = string | number | null;

function ok(id: Id, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function err(id: Id, code: number, message: string, data?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

export interface McpSession {
  /** Handle one line from the client; returns the line to write back, or null when no reply is due. */
  handle(line: string): string | null;
}

export function createMcpSession(gate: Gate, ctx: McpContext = {}): McpSession {
  let initialized = false;

  const modernMeta = (params: Record<string, unknown> | undefined): { era: "modern" | "legacy" | "bad"; error?: string; code?: number; data?: unknown } => {
    const meta = params?.["_meta"];
    const hasVersion = typeof meta === "object" && meta !== null && META_VERSION in (meta as Record<string, unknown>);
    if (!hasVersion) return initialized ? { era: "legacy" } : { era: "bad", code: -32602, error: `no ${META_VERSION} in _meta and no initialize was received` };
    const m = meta as Record<string, unknown>;
    const version = m[META_VERSION];
    if (typeof version !== "string") return { era: "bad", code: -32602, error: `${META_VERSION} must be a string` };
    if (!(MODERN_VERSIONS as readonly string[]).includes(version)) return { era: "bad", code: -32022, error: `unsupported protocol version ${version}`, data: { supported: [...MODERN_VERSIONS] } };
    if (typeof m[META_CAPS] !== "object" || m[META_CAPS] === null) return { era: "bad", code: -32602, error: `${META_CAPS} is required on every request` };
    return { era: "modern" };
  };

  const toolResult = (value: unknown, isError: boolean): unknown => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError,
  });

  return {
    handle(line: string): string | null {
      if (line.trim().length === 0) return null;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        return err(null, -32700, "parse error: the line is not valid JSON");
      }
      if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return err(null, -32600, "invalid request: one JSON-RPC object per line (batches are not supported)");
      const m = msg as Record<string, unknown>;
      const hasId = "id" in m;
      const id = hasId ? (m["id"] as Id) : null;
      if (hasId && !(typeof id === "string" || typeof id === "number" || id === null)) return err(null, -32600, "invalid request: id must be a string or number");
      if (m["jsonrpc"] !== "2.0" || typeof m["method"] !== "string") {
        // A response from the client (the server sends no requests) or garbage: nothing to answer.
        return hasId && "method" in m ? err(id, -32600, "invalid request") : hasId && !("result" in m || "error" in m) ? err(id, -32600, "invalid request") : null;
      }
      const method = m["method"];
      const params = typeof m["params"] === "object" && m["params"] !== null && !Array.isArray(m["params"]) ? (m["params"] as Record<string, unknown>) : undefined;
      if (!hasId) {
        if (method === "notifications/initialized") initialized = true;
        return null; // notifications never get a reply
      }

      switch (method) {
        case "initialize": {
          const asked = typeof params?.["protocolVersion"] === "string" ? (params["protocolVersion"] as string) : "";
          const version = (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
          initialized = true;
          return ok(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
        }
        case "server/discover":
          return ok(id, { supportedVersions: [...MODERN_VERSIONS], capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS, _meta: { [META_SERVER_INFO]: SERVER_INFO } });
        case "ping":
          return ok(id, {});
        case "tools/list": {
          const era = modernMeta(params);
          if (era.era === "bad") return err(id, era.code ?? -32602, era.error ?? "bad request", era.data);
          return ok(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })), ...(era.era === "modern" ? { _meta: { [META_SERVER_INFO]: SERVER_INFO } } : {}) });
        }
        case "tools/call": {
          const era = modernMeta(params);
          if (era.era === "bad") return err(id, era.code ?? -32602, era.error ?? "bad request", era.data);
          const name = params?.["name"];
          const tool = TOOLS.find((t) => t.name === name);
          if (tool === undefined) return err(id, -32602, `unknown tool ${JSON.stringify(name)}`);
          let args: Record<string, unknown>;
          try {
            args = params?.["arguments"] === undefined ? {} : asObject(params["arguments"], "arguments");
          } catch (error) {
            return ok(id, toolResult({ error: { code: "E_INVALID", message: error instanceof Error ? error.message : String(error) } }, true));
          }
          try {
            return ok(id, toolResult(tool.run(gate, args, ctx), false));
          } catch (error) {
            if (error instanceof GateError) return ok(id, toolResult({ error: { code: error.code, message: error.message }, ...(tool.name === "authorize" ? { verdict: "deny", failed: true } : {}) }, true));
            const message = error instanceof Error ? error.message : String(error);
            return ok(id, toolResult({ error: { code: "E_GATE_UNAVAILABLE", message: `the gate cannot decide and is refusing as a precaution: ${message}` }, ...(tool.name === "authorize" ? { verdict: "deny", failed: true } : {}) }, true));
          }
        }
        default:
          return err(id, -32601, `method not found: ${method}`);
      }
    },
  };
}

/** Serve MCP over a pair of streams until the input ends. Only protocol messages are written to `output`. */
export function serveMcp(gate: Gate, input: Readable, output: Writable, ctx: McpContext = {}): Promise<void> {
  const session = createMcpSession(gate, ctx);
  const rl = createInterface({ input, crlfDelay: Infinity });
  return new Promise((resolve) => {
    rl.on("line", (line) => {
      const reply = session.handle(line);
      if (reply !== null) output.write(reply + "\n");
    });
    rl.on("close", () => resolve());
  });
}
