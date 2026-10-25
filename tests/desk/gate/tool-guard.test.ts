import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOOL_KEY_TTL_MS, type Gate, type ToolBeginResult } from "../../../src/desk/gate/gate.ts";
import { GateError } from "../../../src/desk/gate/types.ts";
import { startGateServer } from "../../../src/desk/gate/http.ts";
import { rig } from "./harness.ts";

/**
 * The tool-call exactly-once guard (DF-090). A tool that mutates (a payment, a ticket, an email) must not run twice because a network call timed out, an agent retried, or
 * a session resumed from a checkpoint. The guard hashes the session, the tool and its arguments into a key, holds that key for five minutes, and answers a repeat from the
 * first run's response instead of letting it run.
 */
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "desk-toolguard-"));
});
afterEach(() => {
  for (const d of opened.splice(0)) d.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a file still held open by the platform is removed with the temp folder later */
  }
});
const opened: DatabaseSync[] = [];
function open(file: string): DatabaseSync {
  const d = new DatabaseSync(file);
  opened.push(d);
  return d;
}

interface Counter {
  ran: number;
}

/** What an agent does around a tool: ask the guard, run only when told to proceed, report the response. */
async function around(gate: Gate, tool: string, args: Record<string, unknown>, counter: Counter, extra: Record<string, unknown> = {}, session = "s1"): Promise<{ ran: boolean; status: ToolBeginResult["status"]; response: unknown }> {
  const b = gate.toolBegin({ session_id: session, tool_name: tool, arguments: args, ...extra });
  if (b.status !== "proceed") return { ran: false, status: b.status, response: b.cachedResponse };
  counter.ran += 1;
  await new Promise((r) => setTimeout(r, 5));
  const response = { id: `tx_${counter.ran}`, charged_cents: 1200 };
  gate.toolComplete({ idempotency_key: b.idempotencyKey, response });
  return { ran: true, status: b.status, response };
}

describe("a tool that mutates runs once, however many times it is asked for", () => {
  it("20 retries sent at once run it exactly once, and every one that did not run is told why", async () => {
    const r = rig();
    const c: Counter = { ran: 0 };
    const results = await Promise.all(Array.from({ length: 20 }, () => around(r.gate, "stripe_charge", { amount: 1200, to: "acct_1" }, c)));
    expect(c.ran).toBe(1);
    expect(results.filter((x) => x.ran)).toHaveLength(1);
    expect(results.filter((x) => !x.ran).every((x) => x.status === "in_flight" || x.status === "replayed")).toBe(true);
    // Once it has finished, a retry is answered from the first run's response.
    const again = await around(r.gate, "stripe_charge", { amount: 1200, to: "acct_1" }, c);
    expect(again).toMatchObject({ ran: false, status: "replayed", response: { id: "tx_1", charged_cents: 1200 } });
    expect(c.ran).toBe(1);
  });

  it("holds across two gates on one database file, as two processes would: 20 retries split between them still run it once", async () => {
    const file = join(dir, "gate.db");
    const a = rig({ db: open(file) });
    const b = rig({ db: open(file) });
    const c: Counter = { ran: 0 };
    await Promise.all(Array.from({ length: 20 }, (_, i) => around(i % 2 === 0 ? a.gate : b.gate, "send_email", { to: "owner@example.com", subject: "the report" }, c)));
    expect(c.ran).toBe(1);
  });

  it("debits the spend once: 20 retries that each ask to reserve make one reservation", async () => {
    const r = rig();
    const c: Counter = { ran: 0 };
    const reserve = { model: "claude-opus-5", max_tokens: 1000, input_tokens: 0, person: "p-1", project: "repo:acme/api" };
    await Promise.all(Array.from({ length: 20 }, () => around(r.gate, "create_ticket", { title: "disk full" }, c, { reserve })));
    expect(c.ran).toBe(1);
    expect((r.db.prepare("SELECT COUNT(*) n FROM gate_event WHERE kind = 'authorized'").get() as { n: number }).n).toBe(1);
  });

  it("records each duplicate it suppressed as an event with a zero debit", async () => {
    const r = rig();
    const c: Counter = { ran: 0 };
    await around(r.gate, "stripe_charge", { amount: 5 }, c);
    await around(r.gate, "stripe_charge", { amount: 5 }, c);
    const e = r.db.prepare("SELECT kind, reason_code, amount_micros FROM gate_event WHERE kind = 'idempotent_replayed'").all() as { reason_code: string; amount_micros: number | null }[];
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ reason_code: "idempotent_replayed" });
    expect(e[0]!.amount_micros ?? 0).toBe(0);
  });
});

describe("real processes racing on one database file", () => {
  it("four processes asking five times each for the same mutating call are told to proceed exactly once", async () => {
    const file = join(dir, "race.db");
    // Create the schema once, so the processes race on requests and not on setup.
    const setup = open(file);
    rig({ db: setup });
    setup.close();
    opened.splice(opened.indexOf(setup), 1);
    const startAt = Date.now() + 6000;
    const tsx = join("node_modules", "tsx", "dist", "cli.mjs");
    const run = promisify(execFile);
    const outputs = await Promise.all(Array.from({ length: 4 }, () => run(process.execPath, [tsx, join("tests", "desk", "gate", "tool-worker.ts"), file, "5", String(startAt)], { encoding: "utf8", timeout: 60_000 })));
    const outcomes = outputs.flatMap((o) => (JSON.parse(o.stdout.trim().split("\n").pop() as string) as { outcomes: string[] }).outcomes);
    expect(outcomes).toHaveLength(20);
    expect(outcomes.filter((x) => x === "proceed")).toHaveLength(1);
    expect(outcomes.filter((x) => x.startsWith("error"))).toEqual([]);
    expect(outcomes.filter((x) => x === "in_flight")).toHaveLength(19);
  }, 120_000);
});

describe("what lets it run again, and what does not", () => {
  it("a run that failed may be retried, because nothing was done", async () => {
    const r = rig();
    const b = r.gate.toolBegin({ session_id: "s1", tool_name: "send_email", arguments: { to: "x" } });
    r.gate.toolComplete({ idempotency_key: b.idempotencyKey, failed: true });
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "send_email", arguments: { to: "x" } }).status).toBe("proceed");
  });

  it("is held for five minutes and no longer", () => {
    const r = rig();
    const b = r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } });
    r.gate.toolComplete({ idempotency_key: b.idempotencyKey, response: { id: "tx" } });
    r.clock.advance(TOOL_KEY_TTL_MS - 1_000);
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } }).status).toBe("replayed");
    r.clock.advance(2_000);
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } }).status).toBe("proceed");
  });

  it("is a different call for different arguments, a different tool or a different session", () => {
    const r = rig();
    const keys = new Set([
      r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } }).idempotencyKey,
      r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 2 } }).idempotencyKey,
      r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_refund", arguments: { amount: 1 } }).idempotencyKey,
      r.gate.toolBegin({ session_id: "s2", tool_name: "stripe_charge", arguments: { amount: 1 } }).idempotencyKey,
    ]);
    expect(keys.size).toBe(4);
    // The same arguments in a different order are the same call.
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "t", arguments: { a: 1, b: 2 } }).idempotencyKey).toBe(r.gate.toolBegin({ session_id: "s1", tool_name: "t", arguments: { b: 2, a: 1 } }).idempotencyKey);
  });
});

describe("a tool that only reads passes through", () => {
  it("is not held to one run: Read five times proceeds five times, and no key is recorded", () => {
    const r = rig();
    for (let i = 0; i < 5; i += 1) expect(r.gate.toolBegin({ session_id: "s1", tool_name: "Read", arguments: { file_path: "/work/a.ts" } })).toMatchObject({ status: "proceed", passthrough: true });
    expect((r.db.prepare("SELECT COUNT(*) n FROM gate_tool_key").get() as { n: number }).n).toBe(0);
  });

  it("is held when the caller flags it, and when an owner lists a tool as read-only it passes", () => {
    const r = rig({ readOnlyTools: ["lookup_invoice"] });
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "Read", arguments: { f: 1 }, dedupe: true } as never).status).toBe("proceed");
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "Read", arguments: { f: 1 }, dedupe: true } as never).status).toBe("in_flight");
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "lookup_invoice", arguments: { id: 7 } })).toMatchObject({ passthrough: true });
  });

  it("treats a tool it does not know as one that mutates", () => {
    const r = rig();
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "mystery_tool", arguments: {} }).status).toBe("proceed");
    expect(r.gate.toolBegin({ session_id: "s1", tool_name: "mystery_tool", arguments: {} }).status).toBe("in_flight");
  });
});

describe("when the guard cannot be sure, the tool does not run", () => {
  it("refuses, rather than proceeds, when the ledger cannot be written", () => {
    const r = rig();
    r.db.exec("PRAGMA query_only = ON");
    expect(() => r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } })).toThrow();
  });

  it("refuses, naming the collision, when the key is held by a different call", () => {
    const r = rig();
    const first = r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } });
    r.db.prepare("UPDATE gate_tool_key SET tool_name = 'stripe_refund' WHERE idempotency_key = ?").run(first.idempotencyKey);
    const err = (() => {
      try {
        r.gate.toolBegin({ session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1 } });
        return null;
      } catch (e) {
        return e as GateError;
      }
    })();
    expect(err).toBeInstanceOf(GateError);
    expect(err!.message).toContain("held by a different call");
    expect((err as GateError & { code?: string }).code).toBe("E_KEY_COLLISION");
  });

  it("refuses arguments that are not plain JSON", () => {
    const r = rig();
    expect(() => r.gate.toolBegin({ session_id: "s1", tool_name: "t", arguments: { f: () => 1 } })).toThrow(GateError);
  });
});

describe("what is kept of a response", () => {
  it("masks a credential-shaped string before it is stored, and a retry gets back what was stored", () => {
    const r = rig();
    const secret = ["ghp", "A".repeat(36)].join("_");
    const b = r.gate.toolBegin({ session_id: "s1", tool_name: "create_repo", arguments: { name: "x" } });
    r.gate.toolComplete({ idempotency_key: b.idempotencyKey, response: { id: "repo_9", token: secret, note: "ok" } });
    const stored = (r.db.prepare("SELECT response_json FROM gate_tool_key").get() as { response_json: string }).response_json;
    expect(stored).not.toContain(secret);
    const again = r.gate.toolBegin({ session_id: "s1", tool_name: "create_repo", arguments: { name: "x" } });
    expect(again.status).toBe("replayed");
    expect(JSON.stringify(again.cachedResponse)).not.toContain(secret);
    expect(again.cachedResponse).toMatchObject({ id: "repo_9", note: "ok" });
  });
});

describe("the HTTP door", () => {
  it("answers 409 to a duplicate that is still running and 200 with the cached response once it is done", async () => {
    const r = rig();
    const token = ["stand", "in", "token", "0123456789abcdef"].join("-");
    const s = await startGateServer({ gate: r.gate, token });
    try {
      const post = (path: string, body: unknown) => fetch(`${s.url}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const call = { session_id: "s1", tool_name: "stripe_charge", arguments: { amount: 1200 } };
      const first = await post("/v1/tool/begin", call);
      expect(first.status).toBe(200);
      const key = ((await first.json()) as { idempotencyKey: string }).idempotencyKey;
      expect((await post("/v1/tool/begin", call)).status).toBe(409);
      expect((await post("/v1/tool/complete", { idempotency_key: key, response: { id: "tx_1" } })).status).toBe(200);
      const replay = await post("/v1/tool/begin", call);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ status: "replayed", cachedResponse: { id: "tx_1" } });
    } finally {
      await s.close();
    }
  });
});
