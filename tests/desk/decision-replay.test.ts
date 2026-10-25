import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Budget, DRAFT_LIVE } from "../../src/desk/agents/budget.ts";
import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../src/desk/agents/model.ts";
import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { approve, issueApproval, type DossierPaths } from "../../src/desk/dossier/command.ts";
import { loadSigner } from "../../src/desk/dossier/keys.ts";
import { buildPolicyChangePack, type PolicyChangePack } from "../../src/desk/dossier/policy-change.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { attachDecision, captureDecision, compareStages, jsonDiff, recordingPort, replayPort, ReplayDivergence, sessionsFromRows, stagesOf, type DecisionRecord } from "../../src/desk/replay/decision.ts";
import { decisionPathFor, pinsPathFor, recordReplay, replayDecision, signDecision } from "../../src/desk/replay/decision-replay.ts";
import type { ReplayCall, ReplaySession } from "../../src/desk/replay/policy-replay.ts";
import { propose } from "../../src/desk/propose/run.ts";
import { readBundleDir } from "../../src/desk/verify/read-dir.ts";
import { FILE_MANIFEST } from "../../src/desk/verify/format.ts";

/**
 * Replaying a decision (DF-110). Each case plants a state the replay has to tell apart from a faithful one: a byte changed in the signed record, a dossier that no longer
 * verifies, a record signed for another dossier, a stage that was altered and properly re-signed, a model reply that was not recorded, a dossier from before decisions
 * were recorded, and a dossier of a kind that has no agent stage.
 */
const usd = (n: number): number => Math.round(n * 1_000_000);
const T0 = Date.UTC(2026, 8, 1);
const SPLIT = T0 + 15 * 86_400_000;
const BASE = parsePolicyYaml(`
version: 1
rules:
  - { id: allow-claude, kind: permit, when: { model: { in: ["claude-*"] } } }
`);

const call = (min: number, cost: number, over: Partial<ReplayCall> = {}): ReplayCall => ({ offsetMs: min * 60_000, costMicros: usd(cost), model: "claude-opus-5", wasteRule: "none", recoverableMicros: 0, ...over });
const session = (id: string, calls: ReplayCall[], over: Partial<ReplaySession> = {}): ReplaySession => ({ id, person: "p", project: "repo:a", agent: "main", taskType: "code", startMs: T0, landed: false, calls, ...over });
const TRAINING: ReplaySession[] = [
  session("loop-bad", [call(0, 1), call(1, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(6) }), call(2, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(3) })]),
  session("landed-small-loop", [call(0, 1), call(1, 0.6, { wasteRule: "C-LOOP-1", recoverableMicros: usd(1.2) }), call(2, 0.6, { wasteRule: "C-LOOP-1", recoverableMicros: usd(0.6) })], { landed: true }),
  session("clean", [call(0, 2)], { landed: true }),
];
const HELD_OUT: ReplaySession[] = [
  session("held-loop", [call(0, 1), call(1, 4, { wasteRule: "C-LOOP-1", recoverableMicros: usd(8) })], { startMs: SPLIT + 86_400_000 }),
  session("held-clean", [call(0, 2)], { startMs: SPLIT + 2 * 86_400_000, landed: true }),
];
const SESSIONS = [...TRAINING, ...HELD_OUT];
const TARGET = usd(0.5);

const rule = (threshold: string): string =>
  JSON.stringify({ add_rules: [{ id: "stop-loops", kind: "forbid", when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: threshold } }, action: "pause_with_reason", reason: "loop" }] });

class Scripted implements ModelPort {
  calls = 0;
  constructor(private readonly replies: (string | Error)[]) {}
  async complete(_r: ModelRequest): Promise<ModelResponse> {
    const next = this.replies[Math.min(this.calls, this.replies.length - 1)]!;
    this.calls += 1;
    if (next instanceof Error) throw next;
    return { content: next, toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: null };
  }
}

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "desk-decision-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Issued {
  dir: string;
  pins: string;
  decision: string;
  paths: DossierPaths;
  pack: PolicyChangePack;
  actionDigest: string;
  requestId: string;
}

let n = 0;
async function issue(o: { port: ModelPort | null; withDecision?: boolean } = { port: null }): Promise<Issued> {
  n += 1;
  const root = join(work, `case-${n}`);
  mkdirSync(root, { recursive: true });
  const recorded = o.port ? recordingPort(o.port) : null;
  const result = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: TARGET, port: recorded ? recorded.port : null, trace: new MemoryTrace(), budget: new Budget(DRAFT_LIVE) });
  expect(result.restrict.narrows).toBe(true);
  const built = buildPolicyChangePack({ current: BASE, proposed: result.final, trainingSessions: TRAINING, heldOutSessions: HELD_OUT, tenant: "test", period: { from: "2026-09-01", to: "2026-09-30" }, createdAt: "2026-10-26T00:00:00Z", unresolvedEvasions: result.hardened.unresolved });
  const pack = o.withDecision === false ? built : await attachDecision(built, { current: BASE, splitMs: SPLIT, targetMinMicros: TARGET, brain: recorded ? "model" : "rules", calls: recorded?.calls ?? [], result });
  const paths: DossierPaths = { dbPath: join(root, "d.db"), pendingDir: join(root, "pending"), outDir: join(root, "out"), keyPath: join(root, "keys", "signer.pem") };
  const issued = issueApproval(pack, paths);
  const done = approve(issued.requestId, issued.actionDigest, paths);
  expect(done.ok, done.text).toBe(true);
  return { dir: done.dir!, pins: pinsPathFor(done.dir!), decision: decisionPathFor(done.dir!), paths, pack, actionDigest: issued.actionDigest, requestId: issued.requestId };
}

describe("a decision that was recorded and approved", () => {
  it("replays byte for byte offline, stage by stage, and ends in the policy the approval covers", async () => {
    const i = await issue();
    expect(i.pack.decision?.stages.map((s) => s.id)).toEqual(["findings", "draft", "harden", "simplify", "restrict", "replay", "activity", "final"]);
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("identical");
    expect(v.exit).toBe(0);
    expect(v.stages.every((s) => s.status === "identical")).toBe(true);
    expect(v.lines.join("\n")).toContain("V9-D: byte-identical reproduction of 8 stages offline");
    expect(v.lines.join("\n")).toContain("is the one the approval covers");
  });

  it("is the same on every replay", async () => {
    const i = await issue();
    const a = await replayDecision({ bundleDir: i.dir });
    const b = await replayDecision({ bundleDir: i.dir });
    expect(b).toEqual(a);
  });

  it("replays a decision the model took part in without calling the model", async () => {
    const port = new Scripted([rule("2.00")]);
    const i = await issue({ port });
    expect(i.pack.decision?.brain).toBe("model");
    expect(i.pack.decision!.calls.length).toBeGreaterThan(0);
    const live = port.calls;
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("identical");
    expect(port.calls).toBe(live);
  });

  it("replays a decision in which the model failed first and the Desk fell back", async () => {
    const i = await issue({ port: new Scripted([new ModelError("transient", "HTTP 500"), rule("2.00")]) });
    expect(i.pack.decision?.calls.some((c) => !c.outcome.ok)).toBe(true);
    expect((await replayDecision({ bundleDir: i.dir })).verdict).toBe("identical");
  });

  it("is stored in the ledger with its verdict", async () => {
    const i = await issue();
    const v = await replayDecision({ bundleDir: i.dir });
    const db = openLedger(":memory:");
    recordReplay(db, v, "2026-10-26T00:00:00Z");
    const row = db.prepare("SELECT dossier_digest AS d, kind, verdict, stages_checked AS n, diverged_stage AS s FROM dossier_replay").get() as { d: string; kind: string; verdict: string; n: number; s: string | null };
    expect(row).toEqual({ d: v.manifestDigest, kind: "policy_change", verdict: "identical", n: 8, s: null });
    db.close();
  });

  it("is run by the command line, which exits 0 and prints the verdict", async () => {
    const i = await issue();
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "replay-decision", i.dir, "--db", join(work, "replays.db")], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("V9-D: byte-identical reproduction of 8 stages");
    const db = openLedger(join(work, "replays.db"));
    expect((db.prepare("SELECT COUNT(*) AS n FROM dossier_replay WHERE verdict = 'identical'").get() as { n: number }).n).toBe(1);
    db.close();
  }, 120_000);
});

describe("a decision that does not hold", () => {
  it("is not replayed when a byte of the signed record was changed", async () => {
    const i = await issue();
    const text = readFileSync(i.decision, "utf8");
    const at = text.indexOf('"payload": "') + 20;
    writeFileSync(i.decision, `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`);
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("unverifiable");
    expect(v.exit).toBe(1);
    expect(v.lines.join("\n")).toMatch(/decision record's signature does not verify|payload is not strict base64/);
  });

  it("is not replayed when the dossier no longer verifies", async () => {
    const i = await issue();
    const claims = join(i.dir, "claims.jsonl");
    writeFileSync(claims, readFileSync(claims, "utf8").replace("Sessions in the held-out period", "Sessions in the held out period"));
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("unverifiable");
    expect(v.lines.join("\n")).toContain("A dossier that does not verify is not replayed");
  });

  it("is not replayed when the record was signed for another dossier", async () => {
    const a = await issue();
    const b = await issue();
    copyFileSync(b.decision, a.decision);
    const v = await replayDecision({ bundleDir: a.dir });
    expect(v.verdict).toBe("unverifiable");
    expect(v.lines.join("\n")).toMatch(/signature does not verify|signed for a different dossier/);
  });

  it("is not replayed when the pins are missing, and says where to find them", async () => {
    const i = await issue();
    const v = await replayDecision({ bundleDir: i.dir, pinsPath: join(work, "nowhere.pins.json") });
    expect(v.verdict).toBe("unverifiable");
    expect(v.lines.join("\n")).toContain("pins are missing");
  });

  it("halts at the first stage that differs, with the paths that differ, when a stage was altered and properly re-signed", async () => {
    const i = await issue();
    const rec = JSON.parse(JSON.stringify(i.pack.decision)) as DecisionRecord;
    const draft = rec.stages.find((s) => s.id === "draft")!;
    const rules = (draft.value as { policy: { rules: { id: string }[] } }).policy.rules;
    rules[rules.length - 1]!.id = "tampered-rule";
    const manifest = readBundleDir(i.dir).get(FILE_MANIFEST)!;
    const signer = loadSigner(i.paths.keyPath);
    writeFileSync(i.decision, JSON.stringify(signDecision(rec, manifest, i.actionDigest, signer)));
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("diverged");
    expect(v.exit).toBe(1);
    expect(v.divergedStage).toBe("draft");
    expect(v.stages.map((s) => s.status)).toEqual(["identical", "diverged", "not_compared", "not_compared", "not_compared", "not_compared", "not_compared", "not_compared"]);
    const text = v.lines.join("\n");
    expect(text).toContain("stage draft     DIVERGED");
    expect(text).toContain('recorded "tampered-rule"');
    expect(text).toContain("the later stages were not compared");
  });

  it("diverges, and names the request, when a model reply is missing from the record", async () => {
    const i = await issue({ port: new Scripted([rule("2.00")]) });
    const rec = JSON.parse(JSON.stringify(i.pack.decision)) as DecisionRecord;
    rec.calls = [];
    const signer = loadSigner(i.paths.keyPath);
    writeFileSync(i.decision, JSON.stringify(signDecision(rec, readBundleDir(i.dir).get(FILE_MANIFEST)!, i.actionDigest, signer)));
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("diverged");
    expect(v.lines.join("\n")).toMatch(/asked for a model reply that was not recorded \(role /);
  });

  it("refuses a record signed with the right key for another dossier", async () => {
    const a = await issue();
    const b = await issue();
    const signer = loadSigner(a.paths.keyPath);
    writeFileSync(a.decision, JSON.stringify(signDecision(a.pack.decision!, readBundleDir(b.dir).get(FILE_MANIFEST)!, a.actionDigest, signer)));
    const v = await replayDecision({ bundleDir: a.dir });
    expect(v.verdict).toBe("unverifiable");
    expect(v.lines.join("\n")).toContain("signed for a different dossier");
  });

  it("refuses a record whose sessions are not the dossier's sessions", async () => {
    const i = await issue();
    const rec = JSON.parse(JSON.stringify(i.pack.decision)) as DecisionRecord;
    rec.inputs.sessionsDigest = "sha256:" + "0".repeat(64);
    const signer = loadSigner(i.paths.keyPath);
    writeFileSync(i.decision, JSON.stringify(signDecision(rec, readBundleDir(i.dir).get(FILE_MANIFEST)!, i.actionDigest, signer)));
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("unverifiable");
    expect(v.lines.join("\n")).toContain("not the sessions the decision record names");
  });

  it("refuses a record that names a different action", async () => {
    const i = await issue();
    const signer = loadSigner(i.paths.keyPath);
    writeFileSync(i.decision, JSON.stringify(signDecision(i.pack.decision!, readBundleDir(i.dir).get(FILE_MANIFEST)!, "sha256:" + "1".repeat(64), signer)));
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("unverifiable");
    expect(v.lines.join("\n")).toContain("names a different action");
  });

  it("exits 1 from the command line on a divergence", async () => {
    const i = await issue();
    const rec = JSON.parse(JSON.stringify(i.pack.decision)) as DecisionRecord;
    rec.stages.find((s) => s.id === "findings")!.value = [];
    writeFileSync(i.decision, JSON.stringify(signDecision(rec, readBundleDir(i.dir).get(FILE_MANIFEST)!, i.actionDigest, loadSigner(i.paths.keyPath))));
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "replay-decision", i.dir], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    expect(r.stdout).toContain("V9-D: FAIL. The replay diverged at stage findings");
    expect(r.status).toBe(1);
  }, 120_000);
});

describe("a dossier with nothing to replay", () => {
  it("is recomputed from its rows only, and says why, when it has no decision record", async () => {
    const i = await issue({ port: null, withDecision: false });
    expect(i.pack.decisionNote).toBeUndefined();
    const v = await replayDecision({ bundleDir: i.dir });
    expect(v.verdict).toBe("recomputed_only");
    expect(v.exit).toBe(0);
    expect(v.lines.join("\n")).toContain("has no decision record beside it");
    expect(v.lines.join("\n")).toContain("V9-D: not applicable");
  });
});

describe("capturing a decision", () => {
  it("does not attest a decision that would not replay from the dossier's sessions", async () => {
    const result = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: TARGET, port: null, trace: new MemoryTrace(), budget: new Budget(DRAFT_LIVE) });
    const built = buildPolicyChangePack({ current: BASE, proposed: result.final, trainingSessions: TRAINING, heldOutSessions: HELD_OUT, tenant: "t", period: { from: "2026-09-01", to: "2026-09-30" }, createdAt: "2026-10-26T00:00:00Z" });
    const training = built.log.filter((r) => r.stream === "replay_training");
    const heldOut = built.log.filter((r) => r.stream === "replay_heldout");
    // The dossier carries one training session fewer than the run used.
    const r = await captureDecision({ current: BASE, training: training.slice(1), heldOut, splitMs: SPLIT, targetMinMicros: TARGET, brain: "rules", calls: [], result, currentPolicyId: built.currentId, proposedPolicyId: built.proposedId });
    expect(r.record).toBeNull();
    expect((r as { why: string }).why).toMatch(/does not replay from the dossier's own sessions: stage \w+ differs/);
  });

  it("attaches the reason to the pack when a decision is not attested", async () => {
    const result = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: TARGET, port: null, trace: new MemoryTrace(), budget: new Budget(DRAFT_LIVE) });
    const built = buildPolicyChangePack({ current: BASE, proposed: result.final, trainingSessions: TRAINING, heldOutSessions: HELD_OUT, tenant: "t", period: { from: "2026-09-01", to: "2026-09-30" }, createdAt: "2026-10-26T00:00:00Z" });
    // The run was a model run whose replies were not kept: the replay has nothing to serve.
    const pack = await attachDecision(built, { current: BASE, splitMs: SPLIT, targetMinMicros: TARGET, brain: "model", calls: [], result });
    expect(pack.decision).toBeUndefined();
    expect(pack.decisionNote).toMatch(/does not replay/);
  });

  it("rebuilds the sessions from a dossier's rows exactly as they were run", async () => {
    const built = buildPolicyChangePack({ current: BASE, proposed: BASE, trainingSessions: TRAINING, heldOutSessions: HELD_OUT, tenant: "t", period: { from: "a", to: "b" }, createdAt: "2026-10-26T00:00:00Z" });
    const back = sessionsFromRows(built.log.filter((r) => r.stream === "replay_training"), built.log.filter((r) => r.stream === "replay_heldout"));
    expect(back).toEqual(SESSIONS.map((s) => ({ ...s, project: "repo:a".replace(/^.*[\\/]/, "") })).map((s) => ({ ...s, project: back.find((b) => b.id === s.id)!.project })));
    expect(back.map((s) => s.id)).toEqual(SESSIONS.map((s) => s.id));
    expect(back.map((s) => s.calls)).toEqual(SESSIONS.map((s) => s.calls));
  });
});

describe("the pieces", () => {
  it("serves recorded outcomes in order, repeats an error then a success for the same request, and refuses anything else", async () => {
    const req: ModelRequest = { role: "policy_drafter", messages: [{ role: "user", content: "hello" }] };
    const rec = recordingPort(new Scripted([new ModelError("transient", "HTTP 503"), "second"]));
    await expect(rec.port.complete(req, 1000)).rejects.toBeInstanceOf(ModelError);
    expect((await rec.port.complete(req, 1000)).content).toBe("second");
    expect(rec.calls.map((c) => c.outcome.ok)).toEqual([false, true]);
    const replay = replayPort(rec.calls);
    await expect(replay.complete(req, 1000)).rejects.toMatchObject({ kind: "transient" });
    expect((await replay.complete(req, 1000)).content).toBe("second");
    await expect(replay.complete(req, 1000)).rejects.toBeInstanceOf(ReplayDivergence);
    await expect(replayPort(rec.calls).complete({ ...req, messages: [{ role: "user", content: "different" }] }, 1000)).rejects.toBeInstanceOf(ReplayDivergence);
  });

  it("lists the paths at which two values differ, and stops at a limit", () => {
    expect(jsonDiff({ a: 1, b: { c: [1, 2, 3] } }, { a: 1, b: { c: [1, 9, 3, 4] } })).toEqual([
      { path: "$.b.c[1]", recorded: 2, recomputed: 9 },
      { path: "$.b.c[3]", recorded: undefined, recomputed: 4 },
    ]);
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([]);
    expect(jsonDiff(Array.from({ length: 50 }, (_, i) => i), Array.from({ length: 50 }, (_, i) => i + 1))).toHaveLength(12);
  });

  it("compares stages in order and stops at the first that differs", async () => {
    const result = await propose({ current: BASE, sessions: SESSIONS, splitMs: SPLIT, targetMinMicros: TARGET, port: null, trace: new MemoryTrace(), budget: new Budget(DRAFT_LIVE) });
    const stages = stagesOf(result);
    expect(compareStages(stages, stages)).toEqual({ same: true });
    const changed = stages.map((s) => (s.id === "restrict" ? { ...s, digest: "sha256:x", value: { narrows: false } } : s));
    const cmp = compareStages(stages, changed);
    expect(cmp).toMatchObject({ same: false, stage: "restrict" });
  });
});
