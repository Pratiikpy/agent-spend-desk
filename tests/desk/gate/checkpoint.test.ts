import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkpointWorthy, handoffTemplate, isHandoffWrite, readHandoff } from "../../../src/desk/gate/checkpoint.ts";
import { Gate } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../../src/desk/gate/policy-source.ts";
import { GateError } from "../../../src/desk/gate/types.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { testSnapshot } from "../helpers.ts";
import { call, rig, USD } from "./harness.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const handoffs = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-handoff-"));
  dirs.push(d);
  return d;
};

const POLICY = `
version: 1
rules:
  - id: allow-claude
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "5.50", ask_at: 1.0, warn_at: 0.5 }
  - id: velocity
    kind: permit
    when: {}
    cap: { window: 10m, max_usd: "4.00", ask_at: 1.0, warn_at: 0.5 }
  - id: stop-loops
    kind: forbid
    when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "2.00" } }
    action: pause_with_checkpoint
`;

const hookEvent = (session: string, tool: string, input?: Record<string, unknown>): Record<string, unknown> => ({ hook_event_name: "PreToolUse", session_id: session, tool_name: tool, cwd: "/work/api", ...(input ? { tool_input: input } : {}) });

/** A gate whose day cap of $5.50 has $5.00 spent: two calls of $2.50, settled. A tool call is assumed to spend $1 next, so the cap binds. */
function spent(over: Record<string, unknown> = {}) {
  const dir = handoffs();
  const r = rig({ policyYaml: POLICY, handoffDir: dir, hookProbeMicros: USD(1), ...over });
  for (const k of ["a", "b"]) {
    const d = r.gate.authorize(call({ idempotency_key: k, session_id: "s-1" }));
    r.gate.settle({ reservation_id: d.reservationId, actual_micros: d.reservedMicros });
    r.clock.advance(11 * 60_000); // out of the ten-minute window, so only the day cap is in play
  }
  return { r, dir };
}

describe("what stops a session", () => {
  it("is a loop stop or a cap on a window that does not clear by itself, never a cap on the last minutes", () => {
    expect(checkpointWorthy("forbidden", "pause_with_checkpoint", [])).toBe(true);
    expect(checkpointWorthy("forbidden", "deny", [])).toBe(false);
    expect(checkpointWorthy("forbidden", null, [])).toBe(false);
    expect(checkpointWorthy("capacity", null, ["capacity: day spend"])).toBe(true);
    expect(checkpointWorthy("cap_exceeded", null, ["cap allow-claude: deny"])).toBe(true);
    expect(checkpointWorthy("cap_exceeded", null, ["cap per-session: deny (session)"])).toBe(true);
    expect(checkpointWorthy("cap_exceeded", null, ["cap velocity: deny (last 10 minutes)"])).toBe(false);
    expect(checkpointWorthy("cap_exceeded", null, ["cap velocity: deny (last hour)", "cap allow-claude: deny"])).toBe(true); // a long cap is also past
    expect(checkpointWorthy("no_permit", null, ["no permit matches (default deny)"])).toBe(false);
    expect(checkpointWorthy("allowed", null, [])).toBe(false);
  });
});

describe("a cap that stops the session opens a checkpoint", () => {
  it("writes the handoff file, tells the agent where and what to write, and stops everything else in that session", () => {
    const { r, dir } = spent();
    const d = r.gate.authorize(call({ idempotency_key: "c", session_id: "s-1" }));
    expect(d.verdict).toBe("deny");
    const cp = r.gate.checkpoints!.open("s-1")!;
    expect(cp).toMatchObject({ session_id: "s-1", person: "p-1", status: "open", reason_code: "cap_exceeded" });
    expect(cp.handoff_path.startsWith(dir) || cp.handoff_path.toLowerCase().startsWith(dir.toLowerCase())).toBe(true);
    expect(existsSync(cp.handoff_path)).toBe(true);
    expect(readFileSync(cp.handoff_path, "utf8")).toContain("# Paused: cap allow-claude: deny");
    expect(d.reasons.some((x) => x.includes(`write a short handoff (what is done, what is open, the branch) into ${cp.handoff_path} and stop`))).toBe(true);
    // The next call of that session is refused for the checkpoint, even one that would fit.
    const next = r.gate.authorize(call({ idempotency_key: "d", session_id: "s-1", max_tokens: 1 }));
    expect(next).toMatchObject({ verdict: "deny", reasonCode: "checkpoint" });
    expect(next.reasons[0]).toContain(`paused for checkpoint ${cp.id}`);
    // Another session of another person is not stopped by it.
    expect(r.gate.authorize(call({ idempotency_key: "e", session_id: "s-2", person: "p-2" })).verdict).toBe("allow");
    expect(r.gate.integrity()).toEqual([]);
  });

  it("stops the hook's tool calls, but lets the agent write its handoff, and only that file", () => {
    const { r } = spent();
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Bash")).decision).toBe("deny");
    const cp = r.gate.checkpoints!.open("s-1")!;
    const bash = r.gate.hookPreToolUse(hookEvent("s-1", "Bash"));
    expect(bash.decision).toBe("deny");
    expect(bash.reason).toContain(cp.handoff_path);
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Write", { file_path: cp.handoff_path, content: "x" })).decision).toBe("allow");
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Edit", { file_path: cp.handoff_path, old_string: "a", new_string: "b" })).decision).toBe("allow");
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Write", { file_path: `${cp.handoff_path}.bak`, content: "x" })).decision).toBe("deny");
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Write", { file_path: join(cp.handoff_path, "..", "other.md"), content: "x" })).decision).toBe("deny");
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Read", { file_path: cp.handoff_path })).decision).toBe("deny"); // the agent writes it; it does not browse
    expect(r.gate.hookPreToolUse(hookEvent("s-1", "Bash", { command: `echo hi > ${cp.handoff_path}` })).decision).toBe("deny");
  });

  it("does not stop a session for a cap on the last ten minutes", () => {
    const dir = handoffs();
    const r = rig({ policyYaml: POLICY, handoffDir: dir });
    r.gate.authorize(call({ idempotency_key: "a", session_id: "s-1" })); // $2.50 open
    const d = r.gate.authorize(call({ idempotency_key: "b", session_id: "s-1" })); // $5.00: day cap not passed, but the ten-minute cap of $4 is
    expect(d.verdict).toBe("deny");
    expect(d.reasons).toContain("cap velocity: deny (last 10 minutes)");
    expect(r.gate.checkpoints!.open("s-1")).toBeUndefined();
    r.clock.advance(11 * 60_000);
    expect(r.gate.authorize(call({ idempotency_key: "c", session_id: "s-1" })).verdict).toBe("allow"); // time did what a person would have had to
  });

  it("opens one for a loop stop, and only once for a session", () => {
    const dir = handoffs();
    const r = rig({ policyYaml: POLICY, handoffDir: dir });
    const d = r.gate.authorize(call({ idempotency_key: "loop", session_id: "s-9", waste_rule: "C-LOOP-1", recoverable_micros: USD(3) }));
    expect(d).toMatchObject({ verdict: "deny", reasonCode: "forbidden", action: "pause_with_checkpoint" });
    const cp = r.gate.checkpoints!.open("s-9")!;
    expect(cp.reason).toBe("forbid stop-loops");
    expect(r.gate.checkpoints!.list()).toHaveLength(1);
    r.gate.authorize(call({ idempotency_key: "loop2", session_id: "s-9", waste_rule: "C-LOOP-1", recoverable_micros: USD(3) }));
    expect(r.gate.checkpoints!.list()).toHaveLength(1);
  });

  it("is only a refusal when the gate was started without a handoff directory", () => {
    const r = rig({ policyYaml: POLICY });
    for (const k of ["a", "b"]) {
      const d = r.gate.authorize(call({ idempotency_key: k, session_id: "s-1" }));
      r.gate.settle({ reservation_id: d.reservationId, actual_micros: d.reservedMicros });
      r.clock.advance(11 * 60_000);
    }
    const d = r.gate.authorize(call({ idempotency_key: "c", session_id: "s-1" }));
    expect(d.verdict).toBe("deny");
    expect(r.gate.checkpoints).toBeNull();
    expect(r.gate.authorize(call({ idempotency_key: "d", session_id: "s-1", max_tokens: 1 })).reasonCode).not.toBe("checkpoint");
  });

  it("does not stop anything while the owner's emergency switch is open", () => {
    const { r } = spent();
    r.gate.authorize(call({ idempotency_key: "c", session_id: "s-1" }));
    r.gate.openBypass(60_000, "owner");
    expect(r.gate.authorize(call({ idempotency_key: "d", session_id: "s-1" })).verdict).toBe("allow");
  });

  it("is still open after a restart", () => {
    const { r, dir } = spent();
    r.gate.authorize(call({ idempotency_key: "c", session_id: "s-1" }));
    const again = new Gate({ db: r.db, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY)), now: r.clock.now, person: "p-1", ownerKey: "owner-key-for-tests-0123456789", handoffDir: dir });
    expect(again.authorize(call({ idempotency_key: "d", session_id: "s-1", max_tokens: 1 })).reasonCode).toBe("checkpoint");
    expect(again.openCheckpoints()).toHaveLength(1);
  });
});

describe("what the agent wrote", () => {
  it("is the part of the file below the marker, and an unchanged template is not a handoff", () => {
    const dir = handoffs();
    const path = join(dir, "h.md");
    expect(readHandoff(path)).toEqual({ written: false, text: "", sha256: null });
    writeFileSync(path, handoffTemplate({ id: 1, session: "s", person: "p", project: null, at: "t", reason: "r" }));
    expect(readHandoff(path).written).toBe(false);
    writeFileSync(path, `${readFileSync(path, "utf8").replace("<!-- the agent writes below this line -->", "<!-- the agent writes below this line -->\nDone: the parser. Open: the tests. Branch: fix/parser.")}`);
    const h = readHandoff(path);
    expect(h.written).toBe(true);
    expect(h.text).toBe("Done: the parser. Open: the tests. Branch: fix/parser.");
    expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is recognised as a write to the handoff path and nothing else", () => {
    const p = join(handoffs(), "h.md");
    expect(isHandoffWrite(p, "Write", { file_path: p })).toBe(true);
    expect(isHandoffWrite(p, "MultiEdit", { file_path: p })).toBe(true);
    expect(isHandoffWrite(p, "Bash", { file_path: p })).toBe(false);
    expect(isHandoffWrite(p, "Write", { file_path: `${p}x` })).toBe(false);
    expect(isHandoffWrite(p, "Write", {})).toBe(false);
    expect(isHandoffWrite(p, "Write", null)).toBe(false);
    expect(isHandoffWrite(p, "Write", { file_path: 5 })).toBe(false);
  });
});

function agentWrites(path: string): void {
  writeFileSync(path, readFileSync(path, "utf8").replace("<!-- the agent writes below this line -->", "<!-- the agent writes below this line -->\nDone: the parser. Open: the tests. Branch: fix/parser."));
}

describe("resuming a stopped session", () => {
  function stopped() {
    const s = spent();
    s.r.gate.authorize(call({ idempotency_key: "c", session_id: "s-1" }));
    return { ...s, cp: s.r.gate.checkpoints!.open("s-1")! };
  }

  it("needs the handoff the agent was asked to write, unless the owner says to go without it", () => {
    const { r, cp } = stopped();
    expect(() => r.gate.resumeCheckpoint({ session: "s-1", owner: "owner" })).toThrow(/has not written its handoff/);
    agentWrites(cp.handoff_path);
    // Written, but the day cap still binds.
    expect(() => r.gate.resumeCheckpoint({ session: "s-1", owner: "owner" })).toThrow(GateError);
  });

  it("refuses to resume under a cap that still binds, with no extension, and says which window", () => {
    const { r, cp } = stopped();
    agentWrites(cp.handoff_path);
    let error: GateError | undefined;
    try {
      r.gate.resumeCheckpoint({ session: "s-1", owner: "owner" });
    } catch (e) {
      error = e as GateError;
    }
    expect(error?.code).toBe("E_CAP_BINDS");
    expect(error?.message).toContain("day_spend_after_micros");
    expect(error?.message).toContain("--extend-usd");
    expect(r.gate.checkpoints!.open("s-1")).toBeDefined();
  });

  it("refuses an extension that is too small to let the session through, and grants nothing", () => {
    const { r, cp } = stopped();
    agentWrites(cp.handoff_path);
    expect(() => r.gate.resumeCheckpoint({ session: "s-1", owner: "owner", extendMicros: 1, reason: "a little more" })).toThrow(/does not let the session through/);
    expect(r.gate.checkpoints!.open("s-1")).toBeDefined();
  });

  it("needs the owner key, a reason in words, and a sane amount and length for an extension", () => {
    const { r, cp } = stopped();
    agentWrites(cp.handoff_path);
    const tries: [string, Record<string, unknown>, RegExp][] = [
      ["no reason", { extendMicros: USD(5) }, /needs a reason/],
      ["a blank reason", { extendMicros: USD(5), reason: "  " }, /needs a reason/],
      ["a negative amount", { extendMicros: -5, reason: "because" }, /positive amount/],
      ["a fraction", { extendMicros: 1.5, reason: "because" }, /positive amount/],
      ["too short", { extendMicros: USD(5), reason: "because", extendMs: 1_000 }, /1 minute to 24 hours/],
      ["too long", { extendMicros: USD(5), reason: "because", extendMs: 48 * 3_600_000 }, /1 minute to 24 hours/],
    ];
    for (const [name, extra, message] of tries) expect(() => r.gate.resumeCheckpoint({ session: "s-1", owner: "owner", ...extra }), name).toThrow(message);
    const noKey = rig({ policyYaml: POLICY, handoffDir: handoffs(), ownerKey: undefined as never });
    expect(noKey.gate.checkpoints).not.toBeNull();
  });

  it("resumes with an extension: a signed, limited grant that lets the session spend within it and then ends", () => {
    const { r, cp } = stopped();
    agentWrites(cp.handoff_path);
    const res = r.gate.resumeCheckpoint({ session: "s-1", owner: "owner", extendMicros: USD(5), reason: "the release is today", extendMs: 2 * 3_600_000 });
    expect(res.extension).toMatchObject({ headroomMicros: USD(5), dims: ["day_spend_after_micros"] });
    expect(res.handoff.written).toBe(true);
    expect(r.gate.checkpoints!.open("s-1")).toBeUndefined();
    // The grant is a signed event in the gate's own record.
    const row = r.db.prepare("SELECT kind, reason_code, sig, expires_at, basis FROM gate_event WHERE id = ?").get(res.eventId) as { kind: string; reason_code: string; sig: string | null; expires_at: string; basis: string };
    expect(row).toMatchObject({ kind: "approved", reason_code: "checkpoint_resumed" });
    expect(row.sig).not.toBeNull();
    expect(JSON.parse(row.basis)).toMatchObject({ checkpoint_id: cp.id, by: "owner", reason: "the release is today", handoff: { written: true } });
    // Inside the extension the session can spend again: $5 of headroom on a $5 cap that was full.
    const d = r.gate.authorize(call({ idempotency_key: "after", session_id: "s-1" }));
    expect(d.verdict).toBe("allow");
    const left = r.gate.budgetLeft({ person: "p-1", model: "claude-opus-5" }).standing.find((s) => s.window === "day")!;
    expect(left.limitMicros).toBe(USD(10.5)); // the cap and the headroom
    // Past what it allows, the cap binds again, and that is a new checkpoint.
    r.gate.settle({ reservation_id: d.reservationId, actual_micros: d.reservedMicros }); // $7.50 spent, $2.50 beyond the cap
    r.clock.advance(11 * 60_000);
    const e1 = r.gate.authorize(call({ idempotency_key: "e1", session_id: "s-1" })); // $10.00, $5.00 beyond: still inside the headroom
    expect(e1.verdict).toBe("allow");
    r.gate.settle({ reservation_id: e1.reservationId, actual_micros: e1.reservedMicros });
    r.clock.advance(11 * 60_000);
    expect(r.gate.authorize(call({ idempotency_key: "e2", session_id: "s-1" })).verdict).toBe("deny"); // $12.50: $7.50 beyond
    expect(r.gate.checkpoints!.list().length).toBe(2);
    expect(r.gate.integrity()).toEqual([]);
  });

  it("lets the extension lapse: after its time the cap is the policy's again", () => {
    const { r, cp } = stopped();
    agentWrites(cp.handoff_path);
    r.gate.resumeCheckpoint({ session: "s-1", owner: "owner", extendMicros: USD(5), reason: "an hour of grace", extendMs: 3_600_000 });
    expect(r.gate.authorize(call({ idempotency_key: "inside", session_id: "s-1" })).verdict).toBe("allow");
    r.clock.advance(2 * 3_600_000);
    expect(r.gate.budgetLeft({ person: "p-1", model: "claude-opus-5" }).standing.find((s) => s.window === "day")!.limitMicros).toBe(USD(5.5));
  });

  it("resumes with nothing more when the cap no longer binds: a new day", () => {
    const { r, cp } = stopped();
    agentWrites(cp.handoff_path);
    r.clock.advance(24 * 3_600_000);
    const res = r.gate.resumeCheckpoint({ session: "s-1", owner: "owner" });
    expect(res.extension).toBeNull();
    expect(r.gate.authorize(call({ idempotency_key: "tomorrow", session_id: "s-1" })).verdict).toBe("allow");
  });

  it("resumes without a handoff only when told to, and records that it was told to", () => {
    const { r } = stopped();
    r.clock.advance(24 * 3_600_000);
    const res = r.gate.resumeCheckpoint({ session: "s-1", owner: "owner", withoutHandoff: true });
    expect(res.handoff.written).toBe(false);
    const row = r.db.prepare("SELECT basis FROM gate_event WHERE id = ?").get(res.eventId) as { basis: string };
    expect(JSON.parse(row.basis).handoff).toEqual({ written: false, sha256: null });
  });

  it("says so when there is nothing to resume, or it was resumed already", () => {
    const { r, cp } = stopped();
    expect(() => r.gate.resumeCheckpoint({ session: "nobody", owner: "owner" })).toThrow(/no checkpoint is open/);
    r.clock.advance(24 * 3_600_000);
    r.gate.resumeCheckpoint({ session: "s-1", owner: "owner", withoutHandoff: true });
    expect(() => r.gate.resumeCheckpoint({ id: cp.id, owner: "owner", withoutHandoff: true })).toThrow(/already resumed/);
    expect(() => rig().gate.resumeCheckpoint({ session: "s-1", owner: "owner" })).toThrow(/keeps no checkpoints/);
  });
});
