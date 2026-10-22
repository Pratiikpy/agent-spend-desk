import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { approve, issueApproval, type DossierPaths } from "../../../src/desk/dossier/command.ts";
import { buildPolicyChangePack } from "../../../src/desk/dossier/policy-change.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { replayPolicy, type ReplayCall, type ReplaySession } from "../../../src/desk/replay/policy-replay.ts";
import { readBundleDir } from "../../../src/desk/verify/read-dir.ts";
import { verifyBundle } from "../../../src/desk/verify/verify.ts";
import { runComputation, ComputationError } from "../../../src/desk/verify/computations.ts";
import { pinsFor, ephemeralSigner } from "../../../src/desk/dossier/keys.ts";

const usd = (n: number) => Math.round(n * 1_000_000);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const SPLIT = T0 + 30 * DAY;

const CURRENT = parsePolicyYaml("version: 1\nrules:\n  - { id: allow-all, kind: permit, when: {} }\n");
const PROPOSED = parsePolicyYaml(`
version: 2
rules:
  - { id: allow-all, kind: permit, when: {} }
  - { id: stop-loops, kind: forbid, when: { waste_rule: { in: [C-LOOP-1] }, recoverable_usd: { gt: "2.00" } }, action: pause_with_checkpoint }
`);
const WIDER = parsePolicyYaml("version: 3\nrules:\n  - { id: allow-all, kind: permit, when: {} }\n");

function call(min: number, cost: number, over: Partial<ReplayCall> = {}): ReplayCall {
  return { offsetMs: min * 60_000, costMicros: usd(cost), model: "claude-opus-5", wasteRule: "none", recoverableMicros: 0, ...over };
}
function session(id: string, startMs: number, calls: ReplayCall[], landed = false): ReplaySession {
  return { id, person: "p", project: "C:\\work\\repo-a", agent: "main", taskType: "code", startMs, landed, calls };
}
const looping = (id: string, startMs: number, landed = false) => session(id, startMs, [call(0, 1), call(1, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(6) }), call(2, 3, { wasteRule: "C-LOOP-1", recoverableMicros: usd(3) })], landed);

const TRAIN = [looping("t1", T0 + DAY), session("t2", T0 + 2 * DAY, [call(0, 2)], true), looping("t3", T0 + 3 * DAY), session("t4", T0 + 4 * DAY, [call(0, 5), call(3, 1)], true)];
const HELD = [looping("h1", SPLIT + DAY), session("h2", SPLIT + 2 * DAY, [call(0, 2)], true), looping("h3", SPLIT + 3 * DAY, true), session("h4", SPLIT + 4 * DAY, [call(0, 1)])];

const dirs: string[] = [];
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "desk-dossier-"));
  dirs.push(d);
  return d;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function paths(): DossierPaths {
  const root = temp();
  return { dbPath: join(root, "dossier.db"), pendingDir: join(root, "pending"), outDir: join(root, "out"), keyPath: join(root, "keys", "signer.pem") };
}

const pack = () => buildPolicyChangePack({ current: CURRENT, proposed: PROPOSED, trainingSessions: TRAIN, heldOutSessions: HELD, tenant: "t", period: { from: "2026-09-01", to: "2026-10-31" }, createdAt: "2026-10-22T12:00:00.000Z" });

describe("the policy-change pack", () => {
  it("states figures that are exactly what replaying the proposal gives", () => {
    const p = pack();
    const held = replayPolicy(PROPOSED, HELD);
    expect(p.sentences[0]!.text).toContain(`${held.paused.length} sessions`);
    expect(p.sentences[1]!.text).toContain(`${held.landedBlocked.length} of ${held.landedTotal} landed`);
    expect(p.card.replay).toEqual({ paused: held.paused.length, landed_blocked: held.landedBlocked.length, saved_micros: held.savedMicros });
    expect(p.card.claims).toHaveLength(4);
  });

  it("says plainly when held-out work that landed would be blocked", () => {
    const p = pack();
    expect(p.card.claims.join(" ")).toMatch(/1 of 2 landed sessions would have been paused on the held-out period/);
  });

  it("never puts a home directory or a path in the log: folder names only", () => {
    const text = JSON.stringify(pack().log);
    expect(text).not.toMatch(/C:\\\\work|C:\/work/);
    expect(text).toContain("repo-a");
  });

  it("refuses to build without sessions in both periods", () => {
    expect(() => buildPolicyChangePack({ current: CURRENT, proposed: PROPOSED, trainingSessions: [], heldOutSessions: HELD, tenant: "t", period: { from: "a", to: "b" }, createdAt: "x" })).toThrowError(/both/);
    expect(() => buildPolicyChangePack({ current: CURRENT, proposed: PROPOSED, trainingSessions: TRAIN, heldOutSessions: [], tenant: "t", period: { from: "a", to: "b" }, createdAt: "x" })).toThrowError(/both/);
  });

  it("states that a widening proposal does not only narrow", () => {
    const p = buildPolicyChangePack({ current: PROPOSED, proposed: WIDER, trainingSessions: TRAIN, heldOutSessions: HELD, tenant: "t", period: { from: "a", to: "b" }, createdAt: "x" });
    expect(p.card.restrict?.narrows).toBe(false);
    expect(p.sentences[3]!.text).toMatch(/does not only narrow/);
  });
});

describe("approval, then a dossier a stranger can verify", () => {
  it("builds nothing until the owner echoes the digest, then writes a bundle that passes", () => {
    const ps = paths();
    const issued = issueApproval(pack(), ps);
    expect(issued.text).toContain(issued.actionDigest);
    expect(approve(issued.requestId, "sha256:" + "0".repeat(64), ps)).toMatchObject({ ok: false });
    expect(() => readdirSync(ps.outDir)).toThrow();
    const done = approve(issued.requestId, issued.actionDigest, ps);
    expect(done.ok).toBe(true);
    expect(done.text).toContain("RESULT: PASS");
    const files = readBundleDir(done.dir!);
    const pinsFile = join(ps.outDir, `${issued.requestId.slice(0, 8)}.pins.json`);
    const report = verifyBundle(files, { pins: JSON.parse(readFileSync(pinsFile, "utf8")) });
    expect(report.overall).toBe("PASS");
    expect(report.levels.find((l) => l.id === "V6-D")?.status).toBe("PASS");
    expect(report.levels.find((l) => l.id === "VA")?.status).toBe("PASS");
  });

  it("refuses a second approval of the same request, an unknown id and junk ids", () => {
    const ps = paths();
    const issued = issueApproval(pack(), ps);
    expect(approve(issued.requestId, issued.actionDigest, ps).ok).toBe(true);
    expect(approve(issued.requestId, issued.actionDigest, ps).ok).toBe(false);
    expect(approve("00000000-0000-0000-0000-000000000000", issued.actionDigest, ps).ok).toBe(false);
    for (const junk of ["", "../../etc/passwd", "not a uuid", "x".repeat(500)]) expect(approve(junk, issued.actionDigest, ps).ok).toBe(false);
  });

  it("refuses an expired request", () => {
    const ps = paths();
    const issued = issueApproval(pack(), ps, () => new Date("2026-10-01T00:00:00.000Z"));
    expect(approve(issued.requestId, issued.actionDigest, ps, () => new Date("2026-10-05T00:00:00.000Z")).ok).toBe(false);
  });

  it("keeps the signing key outside the repository", () => {
    expect(() => issueApproval(pack(), { ...paths(), keyPath: join(process.cwd(), "signer-test.pem") })).toThrowError(/git work tree/);
  });
});

describe("tampering with a finished bundle", () => {
  const ps = paths();
  const issued = issueApproval(pack(), ps);
  const done = approve(issued.requestId, issued.actionDigest, ps);
  const pins = JSON.parse(readFileSync(join(ps.outDir, `${issued.requestId.slice(0, 8)}.pins.json`), "utf8"));
  const original = readBundleDir(done.dir!);

  function listing(): string[] {
    return [...original.keys()];
  }
  function verifyWith(mutate: (files: Map<string, Uint8Array>) => void): ReturnType<typeof verifyBundle> {
    const files = new Map(original);
    mutate(files);
    return verifyBundle(files, { pins });
  }
  const text = (b: Uint8Array): string => new TextDecoder().decode(b);
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

  it("passes untouched", () => {
    expect(verifyBundle(original, { pins }).overall).toBe("PASS");
  });

  it("fails when any byte of any file is changed", () => {
    for (const name of listing()) {
      const r = verifyWith((f) => {
        const b = new Uint8Array(f.get(name)!);
        const i = Math.floor(b.length / 2);
        b[i] = b[i]! ^ 0x01;
        f.set(name, b);
      });
      expect(r.overall, name).not.toBe("PASS");
    }
  });

  it("fails when a file is removed or an unlisted file is added", () => {
    for (const name of listing()) expect(verifyWith((f) => void f.delete(name)).overall, `delete ${name}`).not.toBe("PASS");
    expect(verifyWith((f) => void f.set("extra.txt", bytes("hello"))).overall).toBe("FAIL");
  });

  it("fails when rows are reordered, repeated or cut short", () => {
    const name = [...original.keys()].find((k) => k.endsWith("replay_heldout.jsonl"))!;
    const lines = text(original.get(name)!).split("\n").filter(Boolean);
    expect(verifyWith((f) => f.set(name, bytes([lines[1], lines[0], ...lines.slice(2)].join("\n") + "\n"))).overall).toBe("FAIL");
    expect(verifyWith((f) => f.set(name, bytes([...lines, lines[0]].join("\n") + "\n"))).overall).toBe("FAIL");
    expect(verifyWith((f) => f.set(name, bytes(lines.slice(0, -1).join("\n") + "\n"))).overall).toBe("FAIL");
    expect(verifyWith((f) => f.set(name, bytes(""))).overall).toBe("FAIL");
  });

  it("fails when a sentence is changed to a number the rows do not give", () => {
    const r = verifyWith((f) => f.set("claims.jsonl", bytes(text(f.get("claims.jsonl")!).replace(/\$\d[\d,]*\.\d\d/, "$9,999.99"))));
    expect(r.overall).toBe("FAIL");
  });

  it("is not established without the issuer's pin, and fails with someone else's key", () => {
    expect(verifyBundle(original, {}).overall).toBe("INDETERMINATE");
    expect(verifyBundle(original, { pins: pinsFor(ephemeralSigner()) }).overall).toBe("FAIL");
  });

  it("fails on junk bundles: empty, a single empty file, huge garbage", () => {
    expect(verifyBundle(new Map(), { pins }).overall).toBe("FAIL");
    expect(verifyBundle(new Map([["manifest.json", bytes("")]]), { pins }).overall).toBe("FAIL");
    expect(verifyBundle(new Map([["manifest.json", bytes("{".repeat(100_000))]]), { pins }).overall).toBe("FAIL");
  });

  it("keeps the bundle small enough to attach", () => {
    const total = [...original.values()].reduce((s, b) => s + b.length, 0);
    expect(total).toBeLessThan(2_000_000);
    expect(statSync(done.dir!).isDirectory()).toBe(true);
  });
});

describe("policy_replay@1, the computation behind the claims", () => {
  const env = (rows: ReturnType<typeof pack>["log"], policy = PROPOSED) => {
    const p = pack();
    const byStream = new Map<string, Map<number, (typeof rows)[number]>>();
    for (const r of rows) (byStream.get(r.stream) ?? byStream.set(r.stream, new Map()).get(r.stream)!).set(r.seq, r);
    return { rows: byStream, snapshots: new Map(), policies: new Map([[p.proposedId.slice(7), policy], [p.currentId.slice(7), CURRENT]]) };
  };
  const spec = (metric: string, stream = "replay_heldout", to = HELD.length - 1, extra: Record<string, unknown> = {}) => ({ fn: "policy_replay@1", args: { policy: pack().proposedId.slice(7), metric, ...extra }, range: { stream, from: 0, to } });

  it("gives the numbers the engine gives, for every metric", () => {
    const p = pack();
    const held = replayPolicy(PROPOSED, HELD);
    const get = (m: string) => runComputation(spec(m), env(p.log) as never).values["value"];
    expect(get("sessions")).toBe(HELD.length);
    expect(get("paused")).toBe(held.paused.length);
    expect(get("landed_total")).toBe(held.landedTotal);
    expect(get("landed_blocked")).toBe(held.landedBlocked.length);
    expect(get("saved_micros")).toBe(held.savedMicros);
    expect(get("total_micros")).toBe(held.totalMicros);
    expect(get("asked_calls")).toBe(held.askedCalls);
  });

  it("refuses an unknown metric, an unknown argument, a missing policy and a bad ask_as", () => {
    const p = pack();
    const run = (s: ReturnType<typeof spec>) => () => runComputation(s, env(p.log) as never);
    expect(run(spec("nonsense"))).toThrowError(ComputationError);
    expect(run(spec("paused", "replay_heldout", 3, { extra: 1 }))).toThrowError(/unknown argument/);
    expect(run({ ...spec("paused"), args: { policy: "f".repeat(64), metric: "paused" } })).toThrowError(/bundled policy/);
    expect(run(spec("paused", "replay_heldout", 3, { ask_as: "maybe" }))).toThrowError(/ask_as/);
  });

  it("refuses a row with a missing field or a wrong type instead of reading it as zero", () => {
    const p = pack();
    const broken = p.log.map((r, i) => (i === 2 ? { ...r, data: { ...(r.data as object), landed: "yes" } } : r));
    expect(() => runComputation(spec("paused", "replay_training", TRAIN.length - 1), env(broken as never) as never)).toThrowError(/landed/);
    const noCalls = p.log.map((r, i) => (i === 0 ? { ...r, data: { ...(r.data as object), calls: [] } } : r));
    expect(() => runComputation(spec("paused", "replay_training", TRAIN.length - 1), env(noCalls as never) as never)).toThrowError(/calls/);
  });

  it("is a different figure under a different policy (the claim names the policy it is about)", () => {
    const p = pack();
    const wider = env(p.log, WIDER);
    expect(runComputation(spec("paused"), wider as never).values["value"]).toBe(0);
  });
});

describe("files written to disk", () => {
  it("never contain the signing key or a private path", () => {
    const ps = paths();
    const issued = issueApproval(pack(), ps);
    approve(issued.requestId, issued.actionDigest, ps);
    const out: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : out.push(join(d, n))));
    walk(ps.outDir);
    for (const f of out) expect(readFileSync(f, "utf8"), f).not.toMatch(/PRIVATE KEY|C:\\\\work/);
    writeFileSync(join(ps.outDir, "marker"), "x");
  });
});
