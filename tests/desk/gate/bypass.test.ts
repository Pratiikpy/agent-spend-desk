import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { Gate } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../../src/desk/gate/policy-source.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { testSnapshot } from "../helpers.ts";
import { call, POLICY_YAML, rig, USD } from "./harness.ts";

const run = promisify(execFile);
const DAY = 86_400_000;

/** The day cap in the test policy is $10, asking starts at 80%, and one opus request reserves $2.50: three are allowed and the fourth is asked about. */
const SLOTS = 3;

describe("the clock", () => {
  it("does not reopen a day that is spent when the clock is set back", () => {
    const r = rig();
    for (let i = 0; i < SLOTS; i += 1) expect(r.gate.authorize(call({ idempotency_key: `a${i}` })).verdict).toBe("allow");
    expect(r.gate.authorize(call({ idempotency_key: "over" })).verdict).not.toBe("allow");
    r.clock.advance(-2 * DAY);
    expect(r.gate.authorize(call({ idempotency_key: "back" })).verdict).not.toBe("allow");
    expect(r.gate.integrity()).toEqual([]);
  });

  it("keeps the record in time order when the clock steps back by a few seconds", () => {
    const r = rig();
    r.gate.authorize(call({ idempotency_key: "t1" }));
    r.clock.advance(-5000);
    r.gate.authorize(call({ idempotency_key: "t2" }));
    r.clock.advance(1000);
    r.gate.authorize(call({ idempotency_key: "t3" }));
    const stamps = (r.db.prepare("SELECT ts FROM gate_event ORDER BY id").all() as { ts: string }[]).map((x) => x.ts);
    expect([...stamps].sort()).toEqual(stamps);
    expect(r.gate.integrity()).toEqual([]);
  });

  it("says how far behind the last record the clock is, and nothing when it is not", () => {
    const r = rig();
    expect(r.gate.clockBehindMs()).toBe(0);
    r.gate.authorize(call({ idempotency_key: "c1" }));
    expect(r.gate.clockBehindMs()).toBe(0);
    r.clock.advance(-90_000);
    expect(r.gate.clockBehindMs()).toBe(90_000);
    r.clock.advance(90_000 + 5);
    expect(r.gate.clockBehindMs()).toBe(0);
  });

  it("catches up on its own once the real clock passes the last record", () => {
    const r = rig();
    r.gate.authorize(call({ idempotency_key: "u1" }));
    r.clock.advance(-DAY);
    const held = r.gate.authorize(call({ idempotency_key: "u2" }));
    expect(held.verdict).toBe("allow");
    r.clock.advance(DAY + 60_000);
    expect(r.gate.clockBehindMs()).toBe(0);
    expect(r.gate.authorize(call({ idempotency_key: "u3" })).verdict).toBe("allow");
    expect(r.gate.integrity()).toEqual([]);
  });

  it("opens the next day's budget when the clock is set forward: this is outside what the gate can know", () => {
    const r = rig();
    for (let i = 0; i < SLOTS; i += 1) r.gate.authorize(call({ idempotency_key: `f${i}` }));
    expect(r.gate.authorize(call({ idempotency_key: "f-over" })).verdict).not.toBe("allow");
    r.clock.advance(DAY);
    // A forward step cannot be told from a machine that slept for a day. The gate follows the clock and the record stays consistent.
    expect(r.gate.authorize(call({ idempotency_key: "f-next" })).verdict).toBe("allow");
    expect(r.gate.integrity()).toEqual([]);
  });

  it("lets reservations expire in order after a forward jump, and keeps the invariants", () => {
    const r = rig();
    const d = r.gate.authorize(call({ idempotency_key: "e1" }));
    expect(d.verdict).toBe("allow");
    r.clock.advance(3 * DAY);
    r.gate.authorize(call({ idempotency_key: "e2" }));
    expect(r.gate.integrity()).toEqual([]);
  });
});

describe("approvals", () => {
  it("cannot be used for a different action than the one that was approved", () => {
    const r = rig();
    const ask = r.gate.authorize(call({ action: "cap.raise", idempotency_key: "p1" }));
    const ok = r.gate.approve({ approval_request_id: ask.approvalRequest!.approval_request_id, action_digest: ask.approvalRequest!.action_digest }, "owner");
    const other = r.gate.authorize(call({ action: "cap.raise", max_tokens: 50_000, approval_id: ok.approvalId, idempotency_key: "p2" }));
    expect(other.verdict).not.toBe("allow");
  });

  it("cannot be used by another person", () => {
    const r = rig();
    const ask = r.gate.authorize(call({ action: "cap.raise", idempotency_key: "q1" }));
    const ok = r.gate.approve({ approval_request_id: ask.approvalRequest!.approval_request_id, action_digest: ask.approvalRequest!.action_digest }, "owner");
    const other = r.gate.authorize(call({ action: "cap.raise", person: "p-2", approval_id: ok.approvalId, idempotency_key: "q2" }));
    expect(other.verdict).not.toBe("allow");
  });

  it("is still spent after the gate is restarted on the same database", () => {
    const r = rig();
    const ask = r.gate.authorize(call({ action: "cap.raise", idempotency_key: "s1" }));
    const ok = r.gate.approve({ approval_request_id: ask.approvalRequest!.approval_request_id, action_digest: ask.approvalRequest!.action_digest }, "owner");
    expect(r.gate.authorize(call({ action: "cap.raise", approval_id: ok.approvalId, idempotency_key: "s2" })).verdict).toBe("allow");
    const restarted = new Gate({ db: r.db, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)), now: r.clock.now, person: "p-1" });
    expect(restarted.authorize(call({ action: "cap.raise", approval_id: ok.approvalId, idempotency_key: "s3" })).verdict).not.toBe("allow");
  });
});

describe("several processes on one database", () => {
  async function race(workers: number, perWorker: number, sharedKey?: string) {
    const dir = mkdtempSync(join(tmpdir(), "desk-gate-race-"));
    const dbPath = join(dir, "gate.db");
    // Create the schema once, so the workers race on requests and not on setup.
    const setup = new DatabaseSync(dbPath);
    new Gate({ db: setup, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)), person: "p-1" }).integrity();
    setup.close();
    const startAt = Date.now() + 6000;
    const tsx = join("node_modules", "tsx", "dist", "cli.mjs");
    const jobs = Array.from({ length: workers }, (_, i) => run(process.execPath, [tsx, join("tests", "desk", "gate", "worker.ts"), dbPath, String(i), String(perWorker), String(startAt), ...(sharedKey ? [sharedKey] : [])], { timeout: 120_000, maxBuffer: 1 << 20 }));
    const outputs = await Promise.all(jobs);
    const results = outputs.flatMap((o) => (JSON.parse(o.stdout.trim().split("\n").pop() as string) as { results: { key: string; outcome: string; reservationId: number | null }[] }).results);
    const checkDb = new DatabaseSync(dbPath);
    const check = new Gate({ db: checkDb, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)), person: "p-1" });
    return {
      results,
      check,
      cleanup: () => {
        checkDb.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it("never reserves more than the cap when four processes ask at once", async () => {
    const { results, check, cleanup } = await race(4, 6);
    try {
      expect(results).toHaveLength(24);
      const allowed = results.filter((r) => r.outcome === "allow");
      expect(allowed.length).toBeGreaterThanOrEqual(1);
      expect(allowed.length).toBeLessThanOrEqual(SLOTS);
      // Every answer is an allow, a deny or a refusal with a code: never anything that could be read as permission.
      for (const r of results.filter((x) => x.outcome !== "allow")) expect(r.outcome).toMatch(/^(deny|ask|error:\w+)$/);
      const day = check.budgetLeft({ person: "p-1" }).standing.find((s) => s.window === "day");
      expect(day!.reservedMicros + day!.spentMicros).toBeLessThanOrEqual(USD(10));
      expect(day!.reservedMicros).toBe(allowed.length * USD(2.5));
      expect(check.integrity()).toEqual([]);
    } finally {
      cleanup();
    }
  }, 180_000);

  it("reserves once when two processes send the same request key", async () => {
    const { results, check, cleanup } = await race(2, 3, "same-key");
    try {
      const reservations = new Set(results.filter((r) => r.outcome === "allow").map((r) => r.reservationId));
      expect(reservations.size).toBeLessThanOrEqual(3);
      const day = check.budgetLeft({ person: "p-1" }).standing.find((s) => s.window === "day");
      expect(day!.reservedMicros).toBe(reservations.size * USD(2.5));
      expect(check.integrity()).toEqual([]);
    } finally {
      cleanup();
    }
  }, 180_000);
});
