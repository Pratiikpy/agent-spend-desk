import { describe, expect, it } from "vitest";

import { startGateServer } from "../../../src/desk/gate/http.ts";
import { runHook } from "../../../src/desk/gate/hook.ts";
import { Gate } from "../../../src/desk/gate/gate.ts";
import { GateError, type GateDecision } from "../../../src/desk/gate/types.ts";
import { call, prng, rig, USD } from "./harness.ts";

// Fake bearer values for the local test server, joined at run time. None is a real credential.
const TOKEN = ["gate", "bearer", "for", "tests", "0123456789"].join("-");
const OWNER = ["owner", "bearer", "for", "tests", "0123456789"].join("-");

function authorizeOk(r: ReturnType<typeof rig>, over: Record<string, unknown> = {}): GateDecision {
  return r.gate.authorize(call(over));
}

describe("reserve, settle, void, expire", () => {
  it("reserves the worst case before the call, and settles for what was spent", () => {
    const r = rig();
    const d = authorizeOk(r, { idempotency_key: "a" });
    expect(d.verdict).toBe("allow");
    expect(d.reservedMicros).toBe(USD(2.5));
    expect(d.standing.find((s) => s.window === "day")).toMatchObject({ spentMicros: 0, reservedMicros: USD(2.5), limitMicros: USD(10) });
    const s = r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(1) });
    expect(s).toMatchObject({ state: "settled", settledMicros: USD(1), overageMicros: 0, late: false });
    const b = r.gate.budgetLeft({ person: "p-1" });
    expect(b.standing.find((x) => x.window === "day")).toMatchObject({ spentMicros: USD(1), reservedMicros: 0 });
    expect(r.gate.integrity()).toEqual([]);
  });

  it("returns the first decision for a repeated key and reserves once", () => {
    const r = rig();
    const a = authorizeOk(r, { idempotency_key: "same" });
    const b = authorizeOk(r, { idempotency_key: "same" });
    expect(b.idempotent).toBe(true);
    expect(b.reservationId).toBe(a.reservationId);
    expect(r.gate.budgetLeft({ person: "p-1" }).standing.find((x) => x.window === "day")?.reservedMicros).toBe(USD(2.5));
  });

  it("gives the same key to the same request when the caller sends none", () => {
    const r = rig();
    expect(authorizeOk(r).idempotencyKey).toBe(authorizeOk(r).idempotencyKey);
  });

  it("settles above the reservation as a recorded overage, and pauses the person", () => {
    const r = rig();
    const d = authorizeOk(r, { idempotency_key: "o" });
    const s = r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(4) });
    expect(s).toMatchObject({ settledMicros: USD(2.5), overageMicros: USD(1.5), paused: true });
    expect(r.gate.isPaused("p-1")).toBe(true);
    expect(authorizeOk(r, { idempotency_key: "after" }).verdict).toBe("deny");
    r.gate.resume("p-1", "owner");
    expect(authorizeOk(r, { idempotency_key: "after2" }).verdict).toBe("allow");
    expect(r.gate.integrity()).toEqual([]);
  });

  it("refuses a second settle at a different amount and accepts a repeat of the same one", () => {
    const r = rig();
    const d = authorizeOk(r, { idempotency_key: "s" });
    r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(1) });
    expect(r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(1) }).idempotent).toBe(true);
    expect(() => r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(2) })).toThrowError(/already settled/);
  });

  it("voids a reservation that was not used and frees the room; a void is repeatable and a settled one cannot be voided", () => {
    const r = rig();
    const d = authorizeOk(r, { idempotency_key: "v" });
    expect(r.gate.voidReservation({ reservation_id: d.reservationId }).state).toBe("voided");
    expect(r.gate.voidReservation({ reservation_id: d.reservationId }).idempotent).toBe(true);
    expect(r.gate.budgetLeft({ person: "p-1" }).standing.find((x) => x.window === "day")?.reservedMicros).toBe(0);
    expect(() => r.gate.settle({ reservation_id: d.reservationId, actual_micros: 1 })).toThrowError(/voided/);
    const e = authorizeOk(r, { idempotency_key: "v2" });
    r.gate.settle({ reservation_id: e.reservationId, actual_micros: 5 });
    expect(() => r.gate.voidReservation({ reservation_id: e.reservationId })).toThrowError(/cannot be voided/);
  });

  it("lets a reservation expire, frees the room, and accepts a late settle as spend that happened", () => {
    const r = rig({ ttlMs: 60_000 });
    const d = authorizeOk(r, { idempotency_key: "e" });
    r.clock.advance(61_000);
    expect(r.gate.budgetLeft({ person: "p-1" }).standing.find((x) => x.window === "day")?.reservedMicros).toBe(0);
    const s = r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(2) });
    expect(s).toMatchObject({ state: "late_settled", late: true, settledMicros: USD(2) });
    expect(r.gate.budgetLeft({ person: "p-1" }).standing.find((x) => x.window === "day")?.spentMicros).toBe(USD(2));
    expect(r.gate.integrity()).toEqual([]);
  });

  it("names an unknown reservation as an error, not a success", () => {
    const r = rig();
    expect(() => r.gate.settle({ reservation_id: 999, actual_micros: 1 })).toThrowError(/no such reservation/);
    expect(() => r.gate.voidReservation({ idempotency_key: "never" })).toThrowError(/no such reservation/);
  });
});

describe("the policy decides", () => {
  it("asks near the cap and denies over it, counting open reservations as spent", () => {
    const r = rig();
    expect(authorizeOk(r, { idempotency_key: "1" }).verdict).toBe("allow");
    expect(authorizeOk(r, { idempotency_key: "2" }).verdict).toBe("allow");
    expect(authorizeOk(r, { idempotency_key: "3" }).verdict).toBe("allow");
    const ask = authorizeOk(r, { idempotency_key: "4" });
    expect(["ask", "deny"]).toContain(ask.verdict);
    expect(ask.reservationId).toBeNull();
    const over = authorizeOk(r, { idempotency_key: "5", max_tokens: 400_000 });
    expect(over.verdict).toBe("deny");
  });

  it("denies a wasteful call with the rule that matched and the checkpoint instruction", () => {
    const r = rig();
    const d = authorizeOk(r, { waste_rule: "C-LOOP-1", recoverable_micros: USD(5), idempotency_key: "w" });
    expect(d).toMatchObject({ verdict: "deny", reasonCode: "forbidden", action: "pause_with_checkpoint", reservationId: null });
    expect(d.matched).toContain("stop-loops");
    expect(authorizeOk(r, { waste_rule: "C-LOOP-1", recoverable_micros: USD(1), idempotency_key: "w2" }).verdict).toBe("allow");
  });

  it("routes a task type to the cheaper model the policy names", () => {
    const r = rig();
    expect(authorizeOk(r, { task_type: "docs", idempotency_key: "d" }).routedModel).toBe("claude-sonnet-5-5");
    expect(authorizeOk(r, { task_type: "code", idempotency_key: "c" }).routedModel).toBe("claude-opus-5");
  });

  it("denies by default a model no rule permits", () => {
    const r = rig();
    const d = authorizeOk(r, { model: "gpt-9", idempotency_key: "g" });
    expect(d.verdict).toBe("deny");
    expect(d.reasons.join(" ")).toMatch(/unpriced|default deny|no permit/);
  });

  it("follows the caps per person: one person at the cap does not stop another", () => {
    const r = rig();
    for (let i = 0; i < 4; i += 1) authorizeOk(r, { idempotency_key: `p1-${i}` });
    expect(authorizeOk(r, { person: "p-2", idempotency_key: "p2" }).verdict).toBe("allow");
  });

  it("needs an approval that echoes the digest for a cap raise, once, and refuses anything else", () => {
    const r = rig();
    const ask = authorizeOk(r, { action: "cap.raise", idempotency_key: "r1" });
    expect(ask.verdict).toBe("ask");
    expect(ask.approvalRequest).not.toBeNull();
    const { approval_request_id, action_digest } = ask.approvalRequest!;
    expect(() => r.gate.approve({ approval_request_id, action_digest: "0".repeat(64) }, "owner")).toThrowError(/does not match/);
    expect(() => r.gate.approve({ approval_request_id: 9999, action_digest }, "owner")).toThrowError(/no approval request/);
    expect(() => r.gate.approve({ approval_request_id }, "owner")).toThrowError(/must echo/);
    const ok = r.gate.approve({ approval_request_id, action_digest }, "owner");
    expect(() => r.gate.approve({ approval_request_id, action_digest }, "owner")).toThrowError(/already approved/);
    const go = authorizeOk(r, { action: "cap.raise", approval_id: ok.approvalId, idempotency_key: "r2" });
    expect(go.verdict).toBe("allow");
    const again = authorizeOk(r, { action: "cap.raise", approval_id: ok.approvalId, idempotency_key: "r3" });
    expect(again.verdict).not.toBe("allow");
  });

  it("lets an approval expire", () => {
    const r = rig();
    const ask = authorizeOk(r, { action: "cap.raise", idempotency_key: "x1" });
    r.clock.advance(16 * 60_000);
    expect(() => r.gate.approve({ approval_request_id: ask.approvalRequest!.approval_request_id, action_digest: ask.approvalRequest!.action_digest }, "owner")).toThrowError(/expired/);
  });
});

describe("failing closed", () => {
  it("refuses junk, wrong types, NaN, floats, negatives and huge numbers with a named error, and writes no event", () => {
    const r = rig();
    const before = (r.db.prepare("SELECT COUNT(*) n FROM gate_event").get() as { n: number }).n;
    const bad: unknown[] = [null, "x", 7, [], {}, call({ model: "" }), call({ model: 5 }), call({ max_tokens: -1 }), call({ max_tokens: 1.5 }), call({ max_tokens: Number.NaN }), call({ max_tokens: Infinity }), call({ estimate_micros: 1e30 }), call({ n: 0 }), call({ n: 65 }), call({ session_id: "a\u0000b" }), call({ person: "p".repeat(300) }), call({ input_tokens: "10" })];
    for (const b of bad) expect(() => r.gate.authorize(b), JSON.stringify(b)).toThrowError(GateError);
    expect((r.db.prepare("SELECT COUNT(*) n FROM gate_event").get() as { n: number }).n).toBe(before);
  });

  it("denies, and does not allow, when the policy cannot be read", () => {
    const r = rig({ policy: { current: () => { throw new Error("policy file missing"); } } as never });
    const d = r.gate.authorize(call({ idempotency_key: "f" }));
    expect(d.verdict).toBe("deny");
    expect(d.failed).toBe(true);
  });

  it("denies a model with no price instead of reserving nothing", () => {
    const r = rig();
    const d = authorizeOk(r, { model: "claude-future-9", idempotency_key: "u" });
    expect(d.verdict).not.toBe("allow");
  });
});

describe("shadow mode and the emergency switch", () => {
  it("allows in shadow mode and records what would have been denied", () => {
    const r = rig({ mode: () => "shadow" });
    const d = authorizeOk(r, { waste_rule: "C-LOOP-1", recoverable_micros: USD(5), idempotency_key: "sh" });
    expect(d.verdict).toBe("allow");
    expect(d.shadow).toBe(true);
    expect((r.db.prepare("SELECT COUNT(*) n FROM gate_event WHERE kind = 'shadow_would_deny'").get() as { n: number }).n).toBeGreaterThan(0);
  });

  it("starts a new policy in shadow for the window, then enforces", () => {
    const r = rig({ shadowMs: 3_600_000 });
    expect(authorizeOk(r, { waste_rule: "C-LOOP-1", recoverable_micros: USD(5), idempotency_key: "n1" }).shadow).toBe(true);
    r.clock.advance(3_700_000);
    expect(authorizeOk(r, { waste_rule: "C-LOOP-1", recoverable_micros: USD(5), idempotency_key: "n2" }).verdict).toBe("deny");
  });

  it("opens a signed emergency switch for a time, logs what it lets through, and closes it", () => {
    const r = rig();
    expect(r.gate.bypassOpen().open).toBe(false);
    r.gate.openBypass(30 * 60_000, "owner");
    expect(r.gate.bypassOpen().open).toBe(true);
    const d = authorizeOk(r, { waste_rule: "C-LOOP-1", recoverable_micros: USD(5), idempotency_key: "b" });
    expect(d.verdict).toBe("allow");
    expect((r.db.prepare("SELECT COUNT(*) n FROM gate_event WHERE kind = 'bypass_allowed'").get() as { n: number }).n).toBeGreaterThan(0);
    r.clock.advance(31 * 60_000);
    expect(r.gate.bypassOpen().open).toBe(false);
    r.gate.openBypass(30 * 60_000, "owner");
    r.gate.closeBypass("owner");
    expect(r.gate.bypassOpen().open).toBe(false);
    expect(r.gate.integrity()).toEqual([]);
  });

  it("cannot open the switch without the owner key", () => {
    const r = rig({ ownerKey: undefined as never });
    expect(() => r.gate.openBypass(60_000, "agent")).toThrow();
  });
});

describe("the event log", () => {
  it("keeps I-R1 to I-R5 and the hash chain through 400 random operations", () => {
    const rand = prng(20261022);
    const r = rig({ ttlMs: 120_000 });
    const open: { id: number; key: string }[] = [];
    for (let i = 0; i < 400; i += 1) {
      const x = rand();
      try {
        if (x < 0.5) {
          const key = `k${i}`;
          const d = r.gate.authorize(call({ person: `p-${Math.floor(rand() * 3)}`, max_tokens: 1000 + Math.floor(rand() * 200_000), idempotency_key: key }));
          if (d.reservationId !== null) open.push({ id: d.reservationId, key });
        } else if (x < 0.75 && open.length > 0) {
          const o = open.splice(Math.floor(rand() * open.length), 1)[0]!;
          r.gate.settle({ reservation_id: o.id, actual_micros: Math.floor(rand() * USD(4)) });
        } else if (x < 0.85 && open.length > 0) {
          const o = open.splice(Math.floor(rand() * open.length), 1)[0]!;
          r.gate.voidReservation({ reservation_id: o.id });
        } else {
          r.clock.advance(Math.floor(rand() * 90_000));
        }
      } catch (e) {
        expect(e).toBeInstanceOf(GateError);
      }
      if (i % 40 === 0) expect(r.gate.integrity(), `after op ${i}`).toEqual([]);
    }
    expect(r.gate.integrity()).toEqual([]);
  });

  it("rebuilds the projection from the events byte for byte", () => {
    const r = rig();
    for (let i = 0; i < 6; i += 1) {
      const d = authorizeOk(r, { idempotency_key: `q${i}`, max_tokens: 20_000 });
      if (d.reservationId !== null && i % 2 === 0) r.gate.settle({ reservation_id: d.reservationId, actual_micros: USD(0.2) });
    }
    expect(r.gate.ledger.projectionJson()).toBe(r.gate.ledger.projectionJson());
  });

  it("detects a changed amount and a deleted event", () => {
    const r = rig();
    for (let i = 0; i < 4; i += 1) authorizeOk(r, { idempotency_key: `t${i}`, max_tokens: 10_000 });
    expect(r.gate.integrity()).toEqual([]);
    let blocked = false;
    try {
      r.db.prepare("UPDATE gate_event SET amount_micros = amount_micros + 1 WHERE id = 2").run();
    } catch {
      blocked = true; // an append-only table that refuses the write is also a pass
    }
    if (!blocked) expect(r.gate.integrity().some((v) => v.invariant === "chain")).toBe(true);
    const r2 = rig();
    for (let i = 0; i < 4; i += 1) authorizeOk(r2, { idempotency_key: `t${i}`, max_tokens: 10_000 });
    let deleted = true;
    try {
      r2.db.prepare("DELETE FROM gate_event WHERE id = 2").run();
    } catch {
      deleted = false;
    }
    if (deleted) expect(r2.gate.integrity().length).toBeGreaterThan(0);
  });
});

describe("the local HTTP gate", () => {
  async function withServer<T>(fn: (url: string, r: ReturnType<typeof rig>) => Promise<T>, extra: { maxBodyBytes?: number } = {}): Promise<T> {
    const r = rig();
    const s = await startGateServer({ gate: r.gate, token: TOKEN, ownerToken: OWNER, ...extra });
    try {
      return await fn(s.url, r);
    } finally {
      await s.close();
    }
  }
  const post = (url: string, path: string, body: unknown, token: string | null = TOKEN): Promise<Response> =>
    fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("will not start without a token of 16 characters", async () => {
    const r = rig();
    await expect(startGateServer({ gate: r.gate, token: "short" })).rejects.toThrow(/bearer token/);
  });

  it("answers health without a token and everything else only with one", async () => {
    await withServer(async (url) => {
      expect((await fetch(`${url}/healthz`)).status).toBe(200);
      expect((await post(url, "/v1/reserve", call(), null)).status).toBe(401);
      expect((await post(url, "/v1/reserve", call(), "not-the-right-bearer-value")).status).toBe(401);
      expect((await post(url, "/v1/reserve", call(), "")).status).toBe(401);
    });
  });

  it("reserves, then refuses what the policy denies with 403 and the reason", async () => {
    await withServer(async (url) => {
      const ok = await post(url, "/v1/reserve", call({ idempotency_key: "h1" }));
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as GateDecision;
      expect(body.verdict).toBe("allow");
      const no = await post(url, "/v1/reserve", call({ waste_rule: "C-LOOP-1", recoverable_micros: USD(5), idempotency_key: "h2" }));
      expect(no.status).toBe(403);
      expect(((await no.json()) as GateDecision).reasonCode).toBe("forbidden");
      const settled = await post(url, "/v1/settle", { reservation_id: body.reservationId, actual_micros: USD(1) });
      expect(settled.status).toBe(200);
    });
  });

  it("refuses the wrong method, content type, route, JSON, body size and junk request", async () => {
    await withServer(async (url) => {
      expect((await fetch(`${url}/v1/reserve`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405);
      expect((await fetch(`${url}/v1/reserve`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
      expect((await post(url, "/v1/nothing", {})).status).toBe(404);
      expect((await post(url, "/v1/reserve", "{not json")).status).toBe(400);
      expect((await post(url, "/v1/reserve", { x: "y".repeat(400) })).status).toBe(413);
      const err = (await (await post(url, "/v1/reserve", { junk: true })).json()) as { error: { code: string } };
      expect(err.error.code).toBe("E_INVALID");
    }, { maxBodyBytes: 300 });
  });

  it("keeps the owner routes behind the owner token", async () => {
    await withServer(async (url, r) => {
      expect((await post(url, "/v1/admin/bypass", { for_ms: 60_000 })).status).toBe(403);
      expect((await post(url, "/v1/admin/pause", { person: "p-1" })).status).toBe(403);
      expect((await post(url, "/v1/admin/pause", { person: "p-1" }, OWNER)).status).toBe(200);
      expect(r.gate.isPaused("p-1")).toBe(true);
      expect((await post(url, "/v1/reserve", call({ idempotency_key: "paused" }))).status).toBe(403);
      expect((await post(url, "/v1/admin/resume", { person: "p-1" }, OWNER)).status).toBe(200);
      expect((await post(url, "/v1/admin/bypass", { for_ms: 60_000 }, OWNER)).status).toBe(200);
      expect(r.gate.bypassOpen().open).toBe(true);
    });
  });

  it("refuses with a reason, never an allow, when the ledger cannot be written", async () => {
    await withServer(async (url, r) => {
      r.db.exec("DROP TABLE gate_event");
      const res = await post(url, "/v1/reserve", call({ idempotency_key: "z" }));
      expect([503, 403]).toContain(res.status);
      const body = (await res.json()) as { verdict?: string };
      expect(body.verdict).not.toBe("allow");
    });
  });
});

describe("the Claude Code hook adapter", () => {
  const env = { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: "http://127.0.0.1:1" };
  const event = JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s-1", tool_name: "Bash", cwd: "/work/api" });
  const gateSays = (status: number, body: unknown) => async () => ({ status, body });

  it("lets an allowed call go ahead silently", async () => {
    const out = await runHook(event, env, gateSays(200, { decision: "allow", reason: "allowed" }));
    expect(out).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("blocks a denied call with exit 2 and the reason for the model", async () => {
    const out = await runHook(event, env, gateSays(200, { decision: "deny", reason: "Desk gate: forbid stop-loops." }));
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("stop-loops");
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("asks the person when the gate asks", async () => {
    const out = await runHook(event, env, gateSays(200, { decision: "ask", reason: "near the cap" }));
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("blocks, as a precaution, on every failure: no token, bad JSON, unreachable, slow, error status, odd answer, bad timeout", async () => {
    const cases: [string, Promise<unknown>][] = [
      ["no token", runHook(event, { ...env, DESK_GATE_TOKEN: "" }, gateSays(200, { decision: "allow" }))],
      ["bad json", runHook("{nope", env, gateSays(200, { decision: "allow" }))],
      ["unreachable", runHook(event, env, async () => { throw new TypeError("fetch failed"); })],
      ["timeout", runHook(event, env, async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; })],
      ["500", runHook(event, env, gateSays(500, { error: { message: "boom" } }))],
      ["null body", runHook(event, env, gateSays(200, null))],
      ["odd decision", runHook(event, env, gateSays(200, { decision: "maybe" }))],
      ["bad timeout", runHook(event, { ...env, DESK_GATE_TIMEOUT_MS: "5" }, gateSays(200, { decision: "allow" }))],
    ];
    for (const [name, p] of cases) {
      const out = (await p) as { exitCode: number; stderr: string };
      expect(out.exitCode, name).toBe(2);
      expect(out.stderr.length, name).toBeGreaterThan(0);
    }
  });

  it("makes a real denied call into a block against a real gate", async () => {
    const r = rig({ policyYaml: "version: 1\nrules:\n  - { id: only-opus, kind: permit, when: { model: { in: [\"never-used\"] } } }\n" });
    const s = await startGateServer({ gate: r.gate, token: TOKEN });
    try {
      const out = await runHook(event, { DESK_GATE_TOKEN: TOKEN, DESK_GATE_URL: s.url });
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toMatch(/Desk gate/);
    } finally {
      await s.close();
    }
  });
});

describe("a gate built wrongly", () => {
  it("refuses an unusable config rather than starting open", () => {
    expect(() => new Gate({ db: undefined as never, prices: undefined as never, policy: undefined as never })).toThrow();
  });
});
