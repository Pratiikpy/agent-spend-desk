import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OwnerMemory, PRECEDENT_TAG } from "../../src/desk/engines/memory.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { citePrecedents, describePrecedent } from "../../src/desk/precedent/cite.ts";
import { memoryCommand, precedentsCommand } from "../../src/desk/precedent/command.ts";
import { policyDiff } from "../../src/desk/precedent/diff.ts";
import { loadPrecedents, syncPrecedents, trackOutcomes } from "../../src/desk/precedent/store.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { replaySessionsFromLedger } from "../../src/desk/replay/from-ledger.ts";
import { DAY, replayPolicy, type ReplayCall, type ReplaySession } from "../../src/desk/replay/policy-replay.ts";
import { markDecision, openRegret, recordDecision } from "../../src/desk/regret/regret.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

/**
 * Precedent memory (DF-105) and the Desk's use of the memory engine (DF-116): policy changes the owner approved become precedents with outcomes measured 7, 14 and 30 days on,
 * a later proposal is shown the closest ones, an older one that changed the same rule is replaced and kept, and the memory's own mining, feedback and sleep work without
 * deleting the owner's words.
 */
const snapshot = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");
const T0 = Date.UTC(2026, 8, 1);
const usd = (n: number): number => Math.round(n * 1_000_000);
const dayCap = (maxUsd: string, ask = 0.8): ReturnType<typeof parsePolicyYaml> =>
  parsePolicyYaml(`version: 1\nrules:\n  - id: day-cap\n    kind: permit\n    when: {}\n    cap: { window: day, max_usd: "${maxUsd}", warn_at: 0.5, ask_at: ${ask} }\n`);
const loopStop = (threshold: string): ReturnType<typeof parsePolicyYaml> =>
  parsePolicyYaml(`version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n  - id: stop-loops\n    kind: forbid\n    when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "${threshold}" } }\n    action: pause_with_checkpoint\n`);

function history(days: number): ReplaySession[] {
  const out: ReplaySession[] = [];
  for (let d = 0; d < days; d += 1) {
    for (let k = 0; k < 2; k += 1) {
      const calls: ReplayCall[] = [0, 1, 2].map((m) => ({ offsetMs: m * 60_000, costMicros: usd(1), model: "m", wasteRule: "none", recoverableMicros: 0 }));
      out.push({ id: `h${d}-${k}`, person: "p", project: "repo:a", agent: "main", taskType: "code", startMs: T0 + d * DAY + k * 3_600_000, landed: k === 0, calls });
    }
  }
  return out;
}

/** An approved decision in a regret ledger: the policy in force, the proposed one, and what was expected of it. */
function approve(regret: ReturnType<typeof openRegret>, id: string, at: number, before: ReturnType<typeof parsePolicyYaml>, after: ReturnType<typeof parsePolicyYaml>, decision: "approved" | "proposed" | "denied" = "approved", withInForce = true): void {
  recordDecision(regret, {
    decisionId: id, requestId: `req-${id}`, decidedAtMs: at, decision, history: history(40),
    options: [{ option: "chosen", label: "the proposed policy", policy: after }, ...(withInForce ? [{ option: "rejected" as const, label: "the policy already in force", policy: before }] : [])],
  });
  if (decision !== "proposed") markDecision(regret, `req-${id}`, decision);
}

describe("what a policy change changed", () => {
  it("says it rule by rule, with the figures: a cap moved, a threshold moved, a rule added, a rule removed", () => {
    expect(policyDiff(dayCap("10.00"), dayCap("15.00")).map((d) => d.text)).toEqual(["day-cap: day cap $10.00 to $15.00"]);
    expect(policyDiff(dayCap("10.00", 0.8), dayCap("10.00", 0.6)).map((d) => d.text)).toEqual(["day-cap: asks at 60% of the cap (was 80%)"]);
    expect(policyDiff(loopStop("2.00"), loopStop("1.00")).map((d) => d.text)).toEqual(["stop-loops: condition waste_rule in C-LOOP-1, recoverable_usd gt 2.0 to waste_rule in C-LOOP-1, recoverable_usd gt 1.0"]);
    const added = policyDiff(dayCap("10.00"), parsePolicyYaml(`version: 1\nrules:\n  - id: day-cap\n    kind: permit\n    when: {}\n    cap: { window: day, max_usd: "10.00", warn_at: 0.5, ask_at: 0.8 }\n  - id: stop-loops\n    kind: forbid\n    when: { waste_rule: { in: ["C-LOOP-1"] } }\n    action: pause_with_checkpoint\n`));
    expect(added).toEqual([{ ruleId: "stop-loops", kind: "added", text: "added forbid rule stop-loops (pause_with_checkpoint)" }]);
    expect(policyDiff(loopStop("2.00"), dayCap("10.00")).map((d) => `${d.kind}:${d.ruleId}`)).toEqual(["added:day-cap", "removed:allow-all", "removed:stop-loops"]);
    expect(policyDiff(dayCap("10.00"), dayCap("10.00"))).toEqual([]);
  });
});

describe("making precedents of approved changes", () => {
  let db: Ledger;
  let dir: string;
  let regret: ReturnType<typeof openRegret>;
  let memory: OwnerMemory;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "desk-precedent-"));
    db = openLedger(":memory:");
    regret = openRegret(":memory:");
    memory = await OwnerMemory.open({ persistDir: join(dir, "memory"), clock: () => T0 + 100 * DAY });
  });
  afterAll(() => {
    db.close();
    regret.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records an approved decision with its diff, its forecast and a memory, and leaves proposed, denied and incomparable ones out with the reason", () => {
    approve(regret, "d-cap", T0 + 40 * DAY, dayCap("10.00"), dayCap("15.00"));
    approve(regret, "d-proposed", T0 + 41 * DAY, dayCap("15.00"), dayCap("20.00"), "proposed");
    approve(regret, "d-denied", T0 + 42 * DAY, dayCap("15.00"), dayCap("25.00"), "denied");
    approve(regret, "d-noforce", T0 + 43 * DAY, dayCap("15.00"), dayCap("30.00"), "approved", false);
    const r = syncPrecedents(db, regret, memory);
    expect(r.added).toEqual(["d-cap"]);
    expect(r.skipped).toEqual([{ decisionId: "d-noforce", why: "the policy in force was not recorded beside it, so there is nothing to compare" }]);
    const p = loadPrecedents(db);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ precedentId: "d-cap", ruleIds: ["day-cap"], supersededBy: null, outcomes: [] });
    expect(p[0]!.summary).toMatch(/^On 2026-10-11 the owner approved a policy change: day-cap: day cap \$10\.00 to \$15\.00\. It was expected to save between \$/);
    const m = memory.show(p[0]!.memoryId)!;
    expect(m.tags).toEqual([PRECEDENT_TAG, "desk:decision:d-cap", "desk:rule:day-cap"]);
    expect(m.content).toBe("Policy change approved 2026-10-11: day-cap: day cap $10.00 to $15.00");
  });

  it("is idempotent, and a later approval of a change to the same rule replaces the earlier precedent in the memory without deleting it", () => {
    expect(syncPrecedents(db, regret, memory).added).toEqual([]);
    approve(regret, "d-cap2", T0 + 60 * DAY, dayCap("15.00"), dayCap("12.00"));
    const r = syncPrecedents(db, regret, memory);
    expect(r.added).toEqual(["d-cap2"]);
    expect(r.superseded).toEqual([{ older: "d-cap", newer: "d-cap2" }]);
    const [older, newer] = loadPrecedents(db);
    expect(older).toMatchObject({ precedentId: "d-cap", supersededBy: "d-cap2" });
    expect(newer).toMatchObject({ precedentId: "d-cap2", supersededBy: null });
    expect(memory.show(older!.memoryId)).toMatchObject({ superseded: true });
    expect(memory.show(newer!.memoryId)).toMatchObject({ superseded: false, supersedes: older!.memoryId });
    expect(memory.byTag(PRECEDENT_TAG)).toHaveLength(2);
    // A change to a different rule does not replace either.
    approve(regret, "d-loop", T0 + 70 * DAY, loopStop("2.00"), loopStop("1.00"));
    expect(syncPrecedents(db, regret, memory).superseded).toEqual([]);
    expect(loadPrecedents(db).filter((p) => p.supersededBy === null).map((p) => p.precedentId).sort()).toEqual(["d-cap2", "d-loop"]);
  });
});

describe("what a precedent did afterwards", () => {
  let work: string;
  let db: Ledger;
  const regretDb = openRegret(":memory:");
  let memory: OwnerMemory;
  const ADOPTED = Date.parse("2026-10-01T00:00:00Z");

  /** Three sessions a day for 40 days from the adoption: three calls of $2.50 each (100,000 output tokens on opus), the first session of each day landed. */
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "desk-precedent-track-"));
    db = openLedger(":memory:");
    const lines: string[] = [];
    for (let d = 0; d < 40; d += 1) {
      for (let k = 0; k < 3; k += 1) {
        const session = `t-${d}-${k}`;
        const start = ADOPTED + d * DAY + k * 3_600_000 + 9 * 3_600_000;
        lines.push(humanPromptLine({ uuid: `p-${session}`, session, ts: new Date(start).toISOString() }));
        for (let c = 0; c < 3; c += 1) lines.push(assistantLine({ id: `${session}-${c}`, session, ts: new Date(start + (c + 1) * 60_000).toISOString(), output: 100_000, cwd: `/work/shop` }));
      }
    }
    writeFileSync(join(work, "t.jsonl"), `${lines.join("\n")}\n`);
    await ingestClaudeCode(db, [join(work, "t.jsonl")], snapshot);
    memory = await OwnerMemory.open({ persistDir: join(work, "memory"), clock: () => ADOPTED });
    approve(regretDb, "d-1", ADOPTED, dayCap("100.00"), dayCap("5.00", 0.9));
    syncPrecedents(db, regretDb, memory);
  }, 120_000);
  afterAll(() => {
    db.close();
    rmSync(work, { recursive: true, force: true });
  });

  it("waits until a horizon has fully passed in the ledger, and says how long", async () => {
    const young = openLedger(":memory:");
    const lines: string[] = [];
    for (let d = 0; d < 3; d += 1) {
      const session = `y-${d}`;
      const start = ADOPTED + d * DAY + 9 * 3_600_000;
      lines.push(humanPromptLine({ uuid: `p-${session}`, session, ts: new Date(start).toISOString() }), assistantLine({ id: `${session}-0`, session, ts: new Date(start + 60_000).toISOString(), output: 100_000, cwd: "/work/shop" }));
    }
    writeFileSync(join(work, "young.jsonl"), `${lines.join("\n")}\n`);
    await ingestClaudeCode(young, [join(work, "young.jsonl")], snapshot);
    const mem = await OwnerMemory.open({ persistDir: join(work, "memory-young"), clock: () => ADOPTED });
    syncPrecedents(young, regretDb, mem);
    const early = trackOutcomes(young, snapshot, ADOPTED + 1 * DAY);
    expect(early.measured).toEqual([]);
    expect(early.waiting).toEqual([{ precedentId: "d-1", daysLeft: 5 }]); // the ledger ends on day 2; 7 days are due on day 7
    young.close();
  });

  it("measures each of 7, 14 and 30 days once, by replaying the adopted policy on the sessions that followed", () => {
    // The ledger runs to day 40, so every horizon has passed in it whatever the clock says.
    const at7 = trackOutcomes(db, snapshot, ADOPTED + 1 * DAY);
    expect(at7.measured.length).toBe(3);
    const outcomes = loadPrecedents(db)[0]!.outcomes;
    expect(outcomes.map((o) => o.horizonDays)).toEqual([7, 14, 30]);
    for (const o of outcomes) {
      const sessions = replaySessionsFromLedger(db, snapshot, new Date(ADOPTED).toISOString(), new Date(ADOPTED + o.horizonDays * DAY).toISOString());
      const r = replayPolicy(dayCap("5.00", 0.9), sessions);
      expect(o).toMatchObject({ sessions: sessions.length, paused: r.paused.length, askedCalls: r.askedCalls, deniedCalls: r.deniedCalls, landedTotal: r.landedTotal, landedBlocked: r.landedBlocked.length });
      expect(o.savedMicros).toBe(Math.round(r.savedMicros));
    }
    // A $5 day cap with $7.50 sessions pauses most of what ran: the outcome is not zero, and it grows with the horizon.
    expect(outcomes[0]!.paused).toBeGreaterThan(0);
    expect(outcomes[2]!.paused).toBeGreaterThan(outcomes[0]!.paused);
    expect(trackOutcomes(db, snapshot, ADOPTED + 100 * DAY).measured).toEqual([]); // nothing is measured twice
  });

  it("describes a precedent in a sentence that names the date, the change, the horizon and what it did", () => {
    const p = loadPrecedents(db)[0]!;
    const line = describePrecedent(p, ADOPTED + 100 * DAY);
    expect(line).toMatch(/^On 2026-10-01 you approved: day-cap: day cap \$100\.00 to \$5\.00; asks at 90% of the cap \(was 80%\)\. Since then \(30 days, replayed on the \d+ sessions that followed\) it paused \d+ sessions?, would have saved \$[\d,.]+ and (blocked none of the \d+ landed runs|blocked \d+ of \d+ landed runs)\.$/);
    const young = { ...p, outcomes: [] };
    expect(describePrecedent(young, ADOPTED + 3 * DAY)).toContain("It is 3 days old, too recent to have an outcome: the first is measured at 7 days.");
    expect(describePrecedent(young, ADOPTED + 1000)).toContain("It is less than a day old");
  });

  it("is cited to a proposal that touches the same rule, with its outcome, and not to one that does not", () => {
    const c = citePrecedents(db, memory, { before: dayCap("5.00", 0.9), after: dayCap("8.00", 0.9) }, ADOPTED + 100 * DAY);
    expect(c.citations).toHaveLength(1);
    expect(c.citations[0]!.precedentId).toBe("d-1");
    expect(c.citations[0]!.relevance).toBeGreaterThanOrEqual(0.35);
    expect(c.citations[0]!.line).toContain("On 2026-10-01 you approved: day-cap: day cap $100.00 to $5.00");
    expect(c.citations[0]!.line).toContain("Since then (30 days");
    const none = citePrecedents(db, memory, "added forbid rule quarantine-secrets (block)", ADOPTED + 100 * DAY);
    expect(none).toEqual({ citations: [], note: "No historical precedent found." });
  });

  it("says so, and never stops a draft, when the memory is not available or the change touches no rule", () => {
    expect(citePrecedents(db, null, "day-cap: day cap $5.00 to $8.00", ADOPTED)).toEqual({ citations: [], note: "No memory is available, so no earlier precedent was read." });
    expect(citePrecedents(db, memory, { before: dayCap("5.00"), after: dayCap("5.00") }, ADOPTED)).toEqual({ citations: [], note: "The change touches no rule, so there is no precedent to compare it with." });
  });

  it("ranks a precedent lower after the owner calls it wrong, and out of the answer when it falls under the engine's threshold", () => {
    const p = loadPrecedents(db)[0]!;
    const before = citePrecedents(db, memory, "day-cap: day cap $5.00 to $8.00", ADOPTED + 100 * DAY).citations[0]!.relevance;
    memory.feedback(p.memoryId, "wrong");
    const after = citePrecedents(db, memory, "day-cap: day cap $5.00 to $8.00", ADOPTED + 100 * DAY).citations[0]?.relevance ?? 0;
    expect(after).toBeLessThan(before);
    memory.feedback(p.memoryId, "wrong");
    memory.feedback(p.memoryId, "wrong");
    expect(citePrecedents(db, memory, "day-cap: day cap $5.00 to $8.00", ADOPTED + 100 * DAY).citations).toEqual([]);
  });

  it("through the commands: sync from a regret file, list, show with all three horizons, cite", async () => {
    const regretFile = join(work, "regret.db");
    const r = openRegret(regretFile);
    approve(r, "d-cmd", ADOPTED, dayCap("100.00"), dayCap("20.00"));
    r.close();
    const fresh = openLedger(":memory:");
    await ingestClaudeCode(fresh, [join(work, "t.jsonl")], snapshot);
    const o = { db: fresh, snapshot, memoryDir: join(work, "memory-cmd"), regretPath: regretFile, nowMs: ADOPTED + 100 * DAY };
    const synced = await precedentsCommand(["sync"], o);
    expect(synced.text).toContain("Recorded 1 precedent: d-cmd.");
    expect(synced.text).toMatch(/Measured 3 outcomes: d-cmd at 7 days, d-cmd at 14 days, d-cmd at 30 days\./);
    const list = await precedentsCommand(["list"], o);
    expect(list.text).toMatch(/1 precedent:\n {2}d-cmd {2}2026-10-01\n {4}On 2026-10-01 you approved: day-cap: day cap \$100\.00 to \$20\.00/);
    const show = await precedentsCommand(["show", "d-cmd"], o);
    expect(show.text).toContain("What changed:\n    day-cap: day cap $100.00 to $20.00");
    expect(show.text).toMatch(/7 days: \d+ sessions, \d+ paused/);
    expect(show.text).toMatch(/30 days: \d+ sessions/);
    expect(show.text).toMatch(/Memory mem-1, confidence 0\.8; history: create by owner/);
    expect((await precedentsCommand(["show", "nope"], o)).ok).toBe(false);
    expect((await precedentsCommand(["cite", "day-cap: day cap $20.00 to $30.00"], o)).text).toContain("(memory mem-1, relevance");
    expect((await precedentsCommand(["sync"], { ...o, regretPath: join(work, "no-such.db") })).text).toMatch(/No decision has been recorded yet/);
    await expect(precedentsCommand(["bogus"], o)).rejects.toThrow(/Use: desk precedents/);
    await expect(precedentsCommand(["show"], o)).rejects.toThrow(/Use: desk precedents show/);
    fresh.close();
  });
});

describe("the memory the Desk keeps for the owner", () => {
  let dir: string;
  let now: number;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-memory-"));
    now = Date.UTC(2026, 9, 1);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const open = (): Promise<OwnerMemory> => OwnerMemory.open({ persistDir: join(dir, "m"), clock: () => now });

  it("takes durable statements out of what the owner says, keeps them short-term, and ignores the rest", async () => {
    const m = await open();
    const made = await m.mine("Thanks for that. We decided to always route documentation work to the cheaper model because it never needs deep reasoning. The weather is nice.");
    expect(made.map((x) => x.content)).toEqual(["We decided to always route documentation work to the cheaper model because it never needs deep reasoning."]);
    expect(m.show(made[0]!.id)).toMatchObject({ confidence: expect.any(Number), tags: expect.arrayContaining(["event:user_correction", "desk:note"]) });
    expect(await m.mine("Nothing durable here, just chatting about lunch plans for the afternoon.")).toEqual([]);
    await expect(m.mine("   ")).rejects.toThrow(/nothing to mine/);
    await expect(m.mine("x".repeat(8001))).rejects.toThrow(/at most 8000/);
  });

  it("moves a memory's confidence by the engine's fixed steps when the owner says it helped, did not, or was wrong, and says who did it", async () => {
    const m = await open();
    const id = m.remember({ kind: "note", content: "Commits by the release bot are not agent work." }).id;
    const base = m.show(id)!.confidence;
    expect(m.feedback(id, "helpful").after).toBeCloseTo(base + 0.05, 10);
    expect(m.feedback(id, "not_helpful").after).toBeCloseTo(base + 0.02, 10);
    expect(m.feedback(id, "wrong").after).toBeCloseTo(base - 0.18, 10);
    expect(m.show(id)!.history.map((h) => h.action)).toEqual(["create", "feedback", "feedback", "feedback"]);
    expect(() => m.feedback("mem-999", "helpful")).toThrow(/no memory mem-999/);
    const c = await memoryCommand(["feedback", id, "wrong"], { memoryDir: join(dir, "m") });
    expect(c.text).toMatch(/confidence 0\.\d\d to 0\.\d\d\. A wrong memory ranks well below/);
    await expect(memoryCommand(["feedback", id, "great"], { memoryDir: join(dir, "m") })).rejects.toThrow(/Use: desk memory feedback/);
  });

  it("sleeps without deleting the owner's words, a definition or a precedent, however old and unused; it archives only what it mined itself, after a backup that survives the run", async () => {
    const m = await open();
    const note = m.remember({ kind: "note", content: "Exception: the audit team may exceed the day cap in the last week of a quarter." });
    const definition = m.remember({ kind: "outcome_definition", content: "Work counts as landed when it is merged." });
    const prec = m.addPrecedent({ content: "On 2026-09-03 the owner approved a policy change: day-cap: day cap $10.00 to $15.00.", ruleIds: ["day-cap"], decisionId: "d-old" });
    const mined = await m.mine("We must always keep the nightly import under the shared budget because finance reads it.");
    expect(mined).toHaveLength(1);
    now += 40 * DAY; // everything is now old and unused
    const preview = m.sleepPreview();
    // The statement mined in the first test of this group is as old and as unused; everything it would archive is something the engine mined.
    expect(preview.toArchive).toContain(mined[0]!.id);
    for (const id of preview.toArchive) expect(m.show(id)!.tags.some((t) => t.startsWith("event:")), id).toBe(true);
    expect(preview.kept).toBeGreaterThanOrEqual(3);
    expect(preview.toArchive).not.toContain(note.id);
    expect(preview.toArchive).not.toContain(definition.id);
    expect(preview.toArchive).not.toContain(prec.id);
    const text = await memoryCommand(["sleep"], { memoryDir: join(dir, "m") });
    // The command reads the memory with the real clock, under which nothing here is thirty days old yet; it still names its plan and says nothing was changed.
    expect(text.text).toMatch(/^Sleep would: \d+ to consolidate into long-term, \d+ mined statements? to archive \(unused for 30 days\), \d+ groups? of mined statements to fold into one\./);
    expect(text.text).toContain("Nothing was changed; desk memory sleep --apply runs it, after a backup you can restore.");
    const ran = m.sleep();
    expect(ran.archived).toBe(preview.toArchive.length);
    expect(m.show(mined[0]!.id)).toBeNull();
    for (const id of [note.id, definition.id, prec.id]) expect(m.show(id), id).not.toBeNull();
    // A fresh run of the program (a new instance on the same folder) can undo it, which the engine's own in-process backup could not.
    const again = await OwnerMemory.open({ persistDir: join(dir, "m"), clock: () => now });
    expect(again.show(mined[0]!.id)).toBeNull();
    again.restore(ran.backupId);
    expect(again.show(mined[0]!.id)).not.toBeNull();
    expect(existsSync(join(dir, "m", "backups", `${ran.backupId}.json`))).toBe(true);
    expect(() => again.restore("sleep-20000101T000000")).toThrow(/no backup/);
    expect(() => again.restore("../../etc/passwd")).toThrow(/not a backup id/);
  });

  it("folds only mined statements together, never the owner's near-duplicates, and refuses to sleep a memory that is not on disk", async () => {
    const dir2 = join(dir, "m2");
    const m = await OwnerMemory.open({ persistDir: dir2, clock: () => now });
    const a = m.remember({ kind: "note", content: "The finance team reads the nightly import every morning before standup." });
    const b = m.remember({ kind: "note", content: "The finance team reads the nightly import each morning before the standup." });
    const p = m.sleepPreview();
    expect(p.toSynthesize.flat()).not.toContain(a.id);
    expect(p.toSynthesize.flat()).not.toContain(b.id);
    const mem = await OwnerMemory.open({ clock: () => now });
    mem.remember({ kind: "note", content: "Held in memory only." });
    expect(() => mem.sleep()).toThrow(/not kept on disk/);
  });

  it("lists what is remembered, and shows one memory with its history", async () => {
    const dir3 = join(dir, "m3");
    const empty = await memoryCommand(["list"], { memoryDir: dir3 });
    expect(empty.text).toMatch(/^Nothing is remembered yet\./);
    const m = await OwnerMemory.open({ persistDir: dir3, clock: () => now });
    const r = m.remember({ kind: "note", content: "Release bot commits are human reviewed." });
    const list = await memoryCommand(["list"], { memoryDir: dir3 });
    expect(list.text).toContain(`${r.id}  2026-11-10  note`);
    const show = await memoryCommand(["show", r.id], { memoryDir: dir3 });
    expect(show.text).toMatch(/confidence 0\.9\n {2}Release bot commits are human reviewed\.\n {2}tags: desk:note\n {2}history:\n {4}2026-11-10 \d\d:\d\d {2}create by owner/);
    expect((await memoryCommand(["show", "mem-99"], { memoryDir: dir3 })).ok).toBe(false);
    await expect(memoryCommand(["bogus"], { memoryDir: dir3 })).rejects.toThrow(/Use: desk memory list/);
  });
});

describe("through the real command line", () => {
  it("records and lists precedents and works the memory from a shell", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-precedent-cli-"));
    try {
      const db = join(dir, "ledger.db");
      openLedger(db).close();
      const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", ...a, "--db", db, "--memory-dir", join(dir, "memory")], { encoding: "utf8" });
      expect(run("precedents", "list").stdout).toContain("No precedent yet.");
      const mined = run("memory", "mine", "We always want the release job to run on the cheaper model because it is only copying files.");
      expect(mined.status, mined.stderr).toBe(0);
      expect(mined.stdout).toMatch(/Kept 1 statement as short-term memory/);
      const id = /mem-\d+/.exec(mined.stdout)![0];
      const fb = run("memory", "feedback", id, "helpful");
      expect(fb.stdout).toMatch(/confidence 0\.\d\d to 0\.\d\d/);
      expect(run("memory", "sleep").stdout).toMatch(/^Sleep would: 0 to consolidate/);
      expect(readFileSync(join(dir, "memory", "state.json"), "utf8")).toContain("release job");
      expect(run("memory", "show", "mem-404").status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("mining with a generator", () => {
  it("takes the statements the model returns, through the engine's strict reader, as memories of the owner's, and says when it returns none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-memory-miner-"));
    try {
      const prompts: string[] = [];
      const miner = async (prompt: string): Promise<string> => {
        prompts.push(prompt);
        return 'Here you go:\n```json\n["Release jobs run on the cheaper model because they only copy files.", "x"]\n```';
      };
      const r = await memoryCommand(["mine", "We moved the release jobs to the cheap model last week."], { memoryDir: dir, miner });
      expect(r.text).toMatch(/Kept 1 statement as short-term memory/);
      expect(r.text).toContain("Release jobs run on the cheaper model because they only copy files.");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("strict JSON array");
      const none = await memoryCommand(["mine", "Nothing to keep."], { memoryDir: dir, miner: async () => "I could not find anything." });
      expect(none.text).toBe("Nothing durable was found in that. The model returned no statement worth keeping.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
