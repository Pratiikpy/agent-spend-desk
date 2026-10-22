import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { ModelPort, ModelRequest, ModelResponse } from "../../src/desk/agents/model.ts";
import { ModelError } from "../../src/desk/agents/model.ts";
import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { dropRedundantRules } from "../../src/desk/policy/simplify.ts";
import { choosePort, proposeCommand } from "../../src/desk/propose/command.ts";
import { findingsFrom, propose, renderProposal } from "../../src/desk/propose/run.ts";
import { personOfBranch } from "../../src/desk/replay/from-ledger.ts";
import type { ReplayCall, ReplaySession } from "../../src/desk/replay/policy-replay.ts";

const usd = (n: number) => Math.round(n * 1_000_000);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

const BASE = parsePolicyYaml(`
version: 1
rules:
  - { id: allow-claude, kind: permit, when: { model: { in: ["claude-*"] } } }
`);

function call(min: number, cost: number, over: Partial<ReplayCall> = {}): ReplayCall {
  return { offsetMs: min * 60_000, costMicros: usd(cost), model: "claude-opus-5", wasteRule: "none", recoverableMicros: 0, ...over };
}
function session(id: string, startMs: number, calls: ReplayCall[], over: Partial<ReplaySession> = {}): ReplaySession {
  return { id, person: "p", project: "repo:a", agent: "main", taskType: "code", startMs, landed: false, calls, ...over };
}
const loop = (id: string, startMs: number, landed = false): ReplaySession =>
  session(id, startMs, [call(0, 1), call(1, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(6) }), call(2, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(3) })], { landed });

const SPLIT = T0 + 30 * DAY;
const SESSIONS: ReplaySession[] = [
  loop("train-loop", T0 + DAY),
  session("train-landed", T0 + 2 * DAY, [call(0, 2)], { landed: true }),
  loop("held-loop", SPLIT + DAY),
  session("held-landed", SPLIT + 2 * DAY, [call(0, 2)], { landed: true }),
];

class Scripted implements ModelPort {
  constructor(private readonly reply: string | Error) {}
  async complete(_r: ModelRequest): Promise<ModelResponse> {
    if (this.reply instanceof Error) throw this.reply;
    return { content: this.reply, toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: null };
  }
}

describe("findings from the training sessions", () => {
  it("counts each waste run once, with the whole run recoverable amount", () => {
    const f = findingsFrom(SESSIONS.slice(0, 2), usd(0.5));
    expect(f).toEqual([{ wasteRule: "C-LOOP-1", recoverableMicros: usd(6), occurrences: 1, targetMinMicros: usd(0.5) }]);
  });

  it("drops a waste rule whose total is under the owner target, and handles no sessions", () => {
    expect(findingsFrom(SESSIONS.slice(0, 2), usd(50))).toEqual([]);
    expect(findingsFrom([], usd(1))).toEqual([]);
  });

  it("starts a new run when a clean call intervenes", () => {
    const s = session("x", T0, [call(0, 1, { wasteRule: "C-LOOP-1", recoverableMicros: usd(2) }), call(1, 1), call(2, 1, { wasteRule: "C-LOOP-1", recoverableMicros: usd(1) })]);
    expect(findingsFrom([s], 0)[0]?.occurrences).toBe(2);
  });
});

describe("propose", () => {
  it("drafts from the training period and reports the held-out period separately", async () => {
    const r = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: usd(0.5), port: null });
    expect(r.trainingSessions).toBe(2);
    expect(r.heldOutSessions).toBe(2);
    expect(r.restrict.narrows).toBe(true);
    expect(r.inSample.paused.map((p) => p.sessionId)).toEqual(["train-loop"]);
    expect(r.heldOut.paused.map((p) => p.sessionId)).toEqual(["held-loop"]);
    expect(r.heldOut.landedBlocked).toEqual([]);
    expect(r.policyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("puts the held-out result first and says so when held-out work that landed is blocked", async () => {
    const bad = [...SESSIONS, loop("held-landed-loop", SPLIT + 3 * DAY, true)];
    const r = await propose({ current: BASE, sessions: bad, splitMs: SPLIT, targetMinMicros: usd(0.5), port: null });
    expect(r.heldOut.landedBlocked).toEqual(["held-landed-loop"]);
    const text = renderProposal(r, { sessions: bad, splitMs: SPLIT });
    expect(text.indexOf("HELD OUT")).toBeLessThan(text.indexOf("in-sample"));
    expect(text).toMatch(/1 of 2 landed sessions blocked/);
    expect(text).toMatch(/held out: not used while drafting/);
  });

  it("is the same proposal every time (the policy hash does not move)", async () => {
    const a = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: usd(0.5), port: null });
    const b = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: usd(0.5), port: null });
    expect(a.policyHash).toBe(b.policyHash);
  });

  it("falls back to the rule brain and says so when the model fails, returns junk or widens", async () => {
    const ports = [new Scripted(new ModelError("transient", "boom")), new Scripted("not json at all"), new Scripted('{"add_rules":[{"id":"x","kind":"permit","when":{}}]}')];
    for (const port of ports) {
      const trace = new MemoryTrace();
      const r = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: usd(0.5), port, trace });
      expect(r.restrict.narrows).toBe(true);
      expect(trace.events.some((e) => e.event === "fallback.used" || e.event === "revision.applied")).toBe(true);
    }
  });

  it("says so when no waste run is large enough to propose a rule", async () => {
    const quiet = [session("a", T0 + DAY, [call(0, 1)], { landed: true }), session("b", SPLIT + DAY, [call(0, 1)], { landed: true })];
    const r = await propose({ current: BASE, sessions: quiet, splitMs: SPLIT, targetMinMicros: usd(0.5), port: null });
    expect(r.findings).toEqual([]);
    expect(renderProposal(r, { sessions: quiet, splitMs: SPLIT })).toMatch(/No waste run in the training period/);
  });
});

describe("dropRedundantRules", () => {
  it("drops a forbid that repeats an earlier one and keeps the first", () => {
    const p = parsePolicyYaml(`
version: 3
rules:
  - { id: allow, kind: permit, when: {} }
  - { id: a, kind: forbid, when: { waste_rule: { in: [C-LOOP-1] }, recoverable_usd: { gte: "2.00" } }, action: pause_with_checkpoint }
  - { id: b, kind: forbid, when: { waste_rule: { in: [C-LOOP-1] }, recoverable_usd: { gte: "2.00" } }, action: pause_with_checkpoint }
  - { id: c, kind: forbid, when: { waste_rule: { in: [C-LOOP-1] }, recoverable_usd: { gte: "3.00" } }, action: pause_with_checkpoint }
`);
    const out = dropRedundantRules(p);
    expect(out.removed).toEqual(["b"]);
    expect(out.policy.rules.map((r) => r.id)).toEqual(["allow", "a", "c"]);
    expect(out.policy.version).toBe(3);
  });

  it("returns the same policy when nothing is redundant, and never drops permits", () => {
    const p = parsePolicyYaml(`
version: 1
rules:
  - { id: p1, kind: permit, when: {} }
  - { id: p2, kind: permit, when: {} }
`);
    const out = dropRedundantRules(p);
    expect(out.removed).toEqual([]);
    expect(out.policy).toBe(p);
  });
});

describe("person from the branch name", () => {
  it("reads name/topic and nothing else", () => {
    expect(personOfBranch("eng07/payments-work")).toBe("eng07");
    expect(personOfBranch("Ada/fix-login")).toBe("ada");
    expect(personOfBranch("main")).toBeNull();
    expect(personOfBranch("")).toBeNull();
    expect(personOfBranch(null)).toBeNull();
    expect(personOfBranch("/leading")).toBeNull();
    expect(personOfBranch("x/")).toBeNull();
  });
});

describe("the command", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-propose-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const policyPath = join(dir, "p.yaml");
  writeFileSync(policyPath, "version: 1\nrules:\n  - { id: allow, kind: permit, when: {} }\n");
  const base = { pricesPath: "data/prices/anthropic-litellm-2026-10-22.json", policyPath, minUsd: "2.00", cassetteDir: join(dir, "cassettes"), record: false, sampleMode: false, personFromBranch: false, outDir: join(dir, "out"), env: {} };

  it("says what to do first when the ledger is empty", async () => {
    const dbPath = join(dir, "empty.db");
    openLedger(dbPath).close();
    expect(await proposeCommand({ ...base, dbPath })).toMatch(/No sessions in the ledger yet/);
  });

  it("chooses cassettes in SAMPLE_MODE, no model when nothing is configured, and the live model when configured", () => {
    expect(choosePort({ sampleMode: true, record: false, cassetteDir: dir, env: {} }).label).toMatch(/SAMPLE_MODE/);
    const none = choosePort({ sampleMode: false, record: false, cassetteDir: dir, env: {} });
    expect(none.port).toBeNull();
    expect(none.label).toMatch(/no model/);
    const live = choosePort({ sampleMode: false, record: true, cassetteDir: dir, env: { MODEL_BASE_URL: "http://127.0.0.1:1/v1", MODEL_API_KEY: "k", NEMOTRON_MODEL: "m" } });
    expect(live.label).toMatch(/recording/);
  });
});
