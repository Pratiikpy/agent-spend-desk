import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canaryCommand } from "../../src/desk/canary/command.ts";
import type { RunRow } from "../../src/desk/canary/runner.ts";
import { canaryAttribution, changesCommand, loadChangeHistory } from "../../src/desk/changes/command.ts";
import { describeChange } from "../../src/desk/changes/render.ts";
import { collectExtraHistory } from "../../src/desk/changes/sources.ts";
import { OwnerMemory } from "../../src/desk/engines/memory.ts";
import { buildWorldModel, queryChangesBefore } from "../../src/desk/engines/world.ts";
import { ensureGateSchema } from "../../src/desk/gate/schema.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

/**
 * The change history (DF-117): what changed before a date, from the ledger and from everything beside it, with the sessions each change touched, what was looked at and stayed as
 * it was, and what could not be looked at. Each case below plants a known change and checks that it, and only it, is reported.
 */
const snapshot = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");

let work: string;
let db: Ledger;
let gate: string;
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-changes-"));
  db = openLedger(":memory:");
  const lines: string[] = [];
  // Ten days of sessions. Opus until the 14th, then Sonnet; the tool version is 2.1.0 until the 12th and 2.2.0 after.
  for (let d = 1; d <= 20; d += 1) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    const model = d <= 14 ? "claude-opus-5" : "claude-sonnet-5-5";
    const version = d <= 12 ? "2.1.0" : "2.2.0";
    for (let k = 0; k < 2; k += 1) {
      const session = `c-${d}-${k}`;
      const start = Date.parse(`${day}T09:00:00Z`) + k * 3_600_000;
      lines.push(humanPromptLine({ uuid: `p-${session}`, session, ts: new Date(start).toISOString() }));
      for (let c = 0; c < 3; c += 1) lines.push(assistantLine({ id: `${session}-${c}`, session, ts: new Date(start + (c + 1) * 60_000).toISOString(), output: 1000, model, version, cwd: "/work/shop" }));
    }
  }
  writeFileSync(join(work, "c.jsonl"), `${lines.join("\n")}\n`);
  await ingestClaudeCode(db, [join(work, "c.jsonl")], snapshot);
  // The list the ledger was priced with was fetched on the 1st; a second one is seen on the 15th.
  db.prepare("UPDATE price_snapshot SET fetched_at = '2026-10-01T00:00:00Z'").run();
  db.prepare("INSERT INTO price_snapshot (snapshot_id, source, source_url, fetched_at, license, upstream_sha256, content_hash, note) VALUES ('prices-2026-10-15', 'test', 'x', '2026-10-15T08:00:00Z', 'MIT', 'a', 'b', '')").run();
  // The owner approved a policy change on the 16th and promoted a kind of work on the 17th.
  db.prepare("INSERT INTO policy_precedent (precedent_id, memory_id, adopted_at_ms, rule_ids, summary, diff, forecast, policy_yaml, superseded_by) VALUES ('d-16', 'mem-1', ?, '[]', 's', '[]', '{}', 'version: 1', NULL)").run(Date.parse("2026-10-16T10:00:00Z"));
  db.prepare("INSERT INTO autonomy_event (workflow, at, kind, from_tier, to_tier, reason, evidence, evidence_digest) VALUES ('feat', '2026-10-17T10:00:00Z', 'promoted', 'supervised', 'guarded_auto', 'r', '{}', 'd')").run();
  gate = join(work, "gate.db");
  const g = new DatabaseSync(gate);
  ensureGateSchema(g);
  g.prepare("INSERT INTO gate_policy_seen (digest, version, first_seen) VALUES ('a', 1, '2026-10-02T08:00:00Z'), ('b', 2, '2026-10-13T08:00:00Z')").run();
  g.close();
}, 120_000);
afterAll(() => {
  db.close();
  rmSync(work, { recursive: true, force: true });
});

const row = (day: number, date: string, arm: "primary" | "control", served: string): RunRow => ({ day, date, arm, taskId: "t1", servedModel: served, score: 1, error: null, latencyMs: 1, tokensIn: 1, tokensOut: 1, replySha: null, harness: "h", cacheBypass: true });
const canaryRows: RunRow[] = [
  ...[1, 2, 3].map((d) => row(d, `2026-10-0${d}`, "primary", "model-a")),
  ...[13, 14].map((d) => row(d, `2026-10-${d}`, "primary", "model-b")),
  ...[1, 13].map((d) => row(d, d === 1 ? "2026-10-01" : "2026-10-13", "control", "ctl-a")),
];

describe("what is beside the ledger", () => {
  it("reads each source with the date it carries, and lists what it could not read", () => {
    const x = collectExtraHistory({ db, canaryRows, gateDbPath: gate, memoryNotes: [{ id: "mem-3", kind: "note", learnedAt: "2026-10-18", content: "x" }] });
    expect(x.notRead).toEqual([]);
    const byKind = (k: string) => x.changes.filter((c) => c.kind === k).map((c) => `${c.day}`);
    expect(byKind("served_model_changed")).toEqual(["2026-10-13"]);
    expect(byKind("policy_changed")).toEqual(["2026-10-13"]);
    expect(byKind("price_list_changed")).toEqual(["2026-10-15"]);
    expect(byKind("precedent_adopted")).toEqual(["2026-10-16"]);
    expect(byKind("autonomy_changed")).toEqual(["2026-10-17"]);
    expect(byKind("owner_edit")).toEqual(["2026-10-18"]);
    expect(x.read.map((r) => r.label)).toEqual(["the model id the endpoint served", "the policy the gate was running", "the price list", "the owner's notes and definitions", "what any kind of work has earned", "the policy changes you approved"]);
    const none = collectExtraHistory({ db, canaryRows: [], gateDbPath: join(work, "no-such.db"), memoryNotes: null });
    expect(none.notRead.map((n) => n.source)).toEqual(["the canary's served model", "the gate's policy versions", "the owner's notes"]);
    expect(none.read.map((r) => r.label)).not.toContain("the policy the gate was running");
  });
});

describe("the history as a graph", () => {
  it("draws every session with the models and tool version it ran on, and counts the ones that began on a changed thing after the change", async () => {
    const w = (await loadChangeHistory({ db, canaryRunsPath: undefined, gateDbPath: gate, memoryDir: undefined }))!;
    expect(w.drawn).toBe(true);
    expect(w.sessions).toBe(40);
    expect(w.relationships).toBe(160); // each session: the agent that ran it, its task, one model and one tool version
    const q = queryChangesBefore(w, "2026-10-21", 14);
    const sonnet = q.changed.find((c) => c.kind === "model_first_seen" && c.label === "claude-sonnet-5-5")!;
    expect(sonnet.day).toBe("2026-10-15");
    expect(sonnet.affectedSessions).toBe(12); // the 15th to the 20th, two sessions a day
    const version = q.changed.find((c) => c.kind === "tool_version_first_seen")!;
    expect(version).toMatchObject({ day: "2026-10-13", label: "v2.2.0", affectedSessions: 16 }); // the 13th to the 20th, two sessions a day
    expect(q.changed.find((c) => c.kind === "policy_changed")!.affectedSessions).toBeNull(); // nothing ran "on" a policy in the graph
  });

  it("is not drawn for a history without its beside-the-ledger sources, so Ask's answers are the ledger's own", async () => {
    const w = (await buildWorldModel(db))!;
    expect(w.drawn).toBe(false);
    expect(w.sessions).toBe(0);
    const q = queryChangesBefore(w, "2026-10-21", 14);
    expect(q.changed.every((c) => c.affectedSessions === null)).toBe(true);
    expect(q.changed.map((c) => c.kind)).not.toContain("policy_changed");
  });

  it("keeps a change outside the window out, and says a source that showed no change in it stayed as it was, but not one it did not look at", async () => {
    const w = (await loadChangeHistory({ db, gateDbPath: gate }))!;
    const q = queryChangesBefore(w, "2026-10-14", 5); // 9 Oct to 13 Oct
    expect(q.changed.map((c) => `${c.day} ${c.kind}`)).toEqual(["2026-10-13 policy_changed", "2026-10-13 tool_version_first_seen"]);
    expect(q.unchangedSources).toEqual(expect.arrayContaining(["the price list", "the policy changes you approved", "what any kind of work has earned"]));
    expect(q.unchangedSources).not.toContain("the policy the gate was running"); // it changed
    expect(q.unchangedSources).not.toContain("the owner's notes and definitions"); // not read: no memory folder given
    expect(q.notRead.map((n) => n.source)).toEqual(["the canary's served model", "the owner's notes"]);
  });
});

describe("the commands", () => {
  const opts = (extra: Record<string, unknown> = {}) => ({ db, gateDbPath: gate, ...extra });

  it("lists the changes before a date with what each touched, then what stayed, then what was not looked at", async () => {
    const r = await changesCommand([], opts({ before: "2026-10-21", days: 10 }));
    expect(r.ok).toBe(true);
    expect(r.text).toContain("What changed before 2026-10-21, over 10 days (the ledger covers 2026-10-01 to 2026-10-20):");
    expect(r.text).toMatch(/2026-10-15 {2}model claude-sonnet-5-5 first appeared \(\d+ calls so far\); 12 sessions began on it in the window/);
    expect(r.text).toContain("2026-10-13  tool v2.2.0 first appeared");
    expect(r.text).toContain("2026-10-13  the gate began running policy version 2 (it was 1)");
    expect(r.text).toContain("2026-10-15  the price list changed to prices-2026-10-15");
    expect(r.text).toContain("2026-10-16  you approved the policy change d-16");
    expect(r.text).toContain("2026-10-17  work of kind feat was set to guarded_auto");
    expect(r.text).toMatch(/Not looked at: the canary's served model \(no canary run is recorded\); the owner's notes \(the memory was not opened\)\. Nothing is said about these\./);
  });

  it("says plainly when the date is before the ledger or after it, and refuses a bad date or window", async () => {
    expect((await changesCommand([], opts({ before: "2026-09-01" }))).text).toContain("so there is no history before it");
    expect((await changesCommand([], opts({ before: "2026-12-31" }))).text).toContain("changes before it are not known");
    await expect(changesCommand([], opts({ before: "yesterday" }))).rejects.toThrow(/--before is a date/);
    await expect(changesCommand([], opts({ days: 0 }))).rejects.toThrow(/--days is a whole number/);
    await expect(changesCommand(["bogus"], opts())).rejects.toThrow(/Use: desk changes/);
    expect((await changesCommand([], { db: openLedger(":memory:") })).text).toMatch(/holds no call/);
  });

  it("prints the engine's audit trail", async () => {
    const r = await changesCommand(["audit"], opts());
    expect(r.text).toMatch(/^\d+ entries in the model's audit trail \(\d+ events; 40 sessions and 160 relationships drawn\)\. The last 25:/);
    expect(r.text).toContain("relate");
  });

  it("describes each kind of change in words that carry its figures", () => {
    const c = (kind: string, detail: Record<string, string | number>, label = "x") => describeChange({ day: "2026-10-01", kind: kind as never, entityKind: "model", label, detail, affectedSessions: null });
    expect(c("served_model_changed", { arm: "primary", from: "a", to: "b" })).toBe("the model id the endpoint served the primary arm changed from a to b");
    expect(c("model_share_shift", { from: 24, to: 12.7 }, "claude-opus-5")).toBe("model claude-opus-5 went from 24% to 12.7% of calls");
    expect(c("owner_edit", { kind: "outcome_definition" }, "definition of landed mem-2")).toBe("you edited the memory: a definition of what landed (mem-2)");
    expect(c("model_last_seen", { lastDay: "2026-09-30" }, "m")).toBe("model m was last used on 2026-09-30");
  });
});

describe("what the canary says about what changed", () => {
  it("lists the changes from the last baseline day to the verdict's day, and the verdict carries them in place of the one served-model line", async () => {
    const a = await canaryAttribution({ db, canaryRunsPath: undefined, gateDbPath: gate, verdictDate: "2026-10-20", since: "2026-10-13" });
    expect(a.lines[0]).toBe("  consistent with, not caused by (changes from 2026-10-13, the last baseline day, to 2026-10-20):");
    expect(a.lines.join("\n")).toContain("2026-10-13  the gate began running policy version 2");
    expect(a.lines.join("\n")).toContain("2026-10-15  model claude-sonnet-5-5 first appeared");
    expect(a.lines.join("\n")).toContain("Looked at and unchanged:");
  });

  it("is unknowable with the World Model off, and the verdict then has no 'consistent with' line", async () => {
    const off = await canaryAttribution({ db, canaryRunsPath: undefined, gateDbPath: gate, verdictDate: "2026-10-20", since: "2026-10-13", worldOff: true });
    expect(off.lines).toEqual(["  what changed before this: unknowable: no entity history is available, so what changed cannot be listed."]);
    const sample = "data/sample/canary/runs.jsonl";
    const text = canaryCommand({ runsPath: sample, sample: true, attribution: off }).text;
    expect(text).toContain("what changed before this: unknowable");
    expect(text).not.toContain("consistent with, not caused by");
    // Without the attribution the verdict keeps its single served-model line, as before.
    expect(canaryCommand({ runsPath: sample, sample: true }).text).toContain("consistent with, not caused by: the served model id reported by the endpoint changed");
  });

  it("says nothing is consistent with the drop when nothing changed in the span, and still says what was looked at", async () => {
    const a = await canaryAttribution({ db, canaryRunsPath: undefined, gateDbPath: gate, verdictDate: "2026-10-11", since: "2026-10-10" });
    expect(a.lines[0]).toBe("  nothing was recorded as changed between 2026-10-10 and 2026-10-11; nothing here is consistent with this drop");
    expect(a.lines.join("\n")).toContain("Looked at and unchanged:");
  });
});

describe("through the real command line", () => {
  it("lists changes with and without the World Model, from a ledger file", async () => {
    const file = join(work, "cli.db");
    const l = openLedger(file);
    await ingestClaudeCode(l, [join(work, "c.jsonl")], snapshot);
    l.close();
    const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "changes", ...a, "--db", file, "--gate-db", gate, "--memory-dir", join(work, "memory")], { encoding: "utf8" });
    const on = run("--before", "2026-10-21", "--days", "10");
    expect(on.status, on.stderr).toBe(0);
    expect(on.stdout).toContain("2026-10-13  the gate began running policy version 2 (it was 1)");
    const off = run("--before", "2026-10-21", "--ablate", "world_model");
    expect(off.stdout.trim()).toBe("unknowable: no entity history is available, so what changed cannot be listed.");
    void OwnerMemory;
  }, 120_000);
});
