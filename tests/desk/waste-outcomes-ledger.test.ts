import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { wasteCommand } from "../../src/desk/waste/command.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

/**
 * The two outcome rules end to end, through a real ledger: logs ingested, a repository and landing states written the way `desk landing` writes them, and the rules
 * reading them back with `loadOutcomeFacts`. The rule logic has its own tests with stubbed facts; this checks that the ledger answers every question the rule asks.
 */
const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const FOLDER = "/work/shop";
const DAY = 86_400_000;
const T0 = Date.parse("2026-10-10T09:00:00.000Z");
const at = (ms: number): string => new Date(ms).toISOString();

const result = (session: string, id: string, ts: string, text: string, isError: boolean): string =>
  JSON.stringify({ type: "user", isSidechain: false, uuid: `res-${id}`, timestamp: ts, sessionId: session, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] } });

/** Different failures in different words: numbers and identifiers are folded away when errors are compared, so only the words can tell two apart. */
const FAILURES = ["permission denied", "no such file or directory", "connection timed out", "syntax error near unexpected token", "disk quota exceeded", "module not found"];

/** A session of `n` calls, one a minute from `start`, the last `failing` of them calling a tool that failed in a different way each time. */
function session(id: string, start: number, n: number, failing: number, cwd = FOLDER): string[] {
  const lines = [humanPromptLine({ uuid: `p-${id}`, session: id, ts: at(start) })];
  for (let i = 0; i < n; i += 1) {
    const ts = at(start + (i + 1) * 60_000);
    lines.push(assistantLine({ id: `${id}-m${i}`, session: id, ts, output: 1_000_000, tools: ["Bash"], toolInputs: [{ command: `step ${i}` }], cwd }));
    const bad = i >= n - failing;
    lines.push(result(id, `tu_${id}-m${i}_0`, ts, bad ? `Error: ${FAILURES[i % FAILURES.length]}` : "ok", bad));
  }
  return lines;
}

let work: string;
let db: Ledger | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
  if (work) rmSync(work, { recursive: true, force: true });
});

/** The newest call in the ledger decides whether a session is over (quiet for a day), so every ledger here ends with a call days later, in another folder. */
const LATE = session("s-late", T0 + 20 * DAY, 1, 0, "/work/elsewhere");

async function build(files: Record<string, string[]>): Promise<Ledger> {
  work = mkdtempSync(join(tmpdir(), "desk-waste-outcomes-"));
  const paths: string[] = [];
  for (const [name, lines] of Object.entries({ ...files, late: LATE })) {
    const p = join(work, `${name}.jsonl`);
    writeFileSync(p, `${lines.join("\n")}\n`);
    paths.push(p);
  }
  db = openLedger(":memory:");
  await ingestClaudeCode(db, paths, loadSnapshot(PRICES));
  return db;
}

/** What `desk landing` leaves: a scanned repository, its commits, and a landing state for every session. */
function landing(d: Ledger, o: { scannedAt: string; commits?: number[]; states: Record<string, { state: string; confidence?: string | null }> }): void {
  d.prepare("INSERT INTO repo (repo_id, root, default_ref, scanned_at) VALUES (1, ?, 'main', ?)").run(FOLDER, o.scannedAt);
  const commit = d.prepare("INSERT INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted) VALUES (1, ?, ?, 'a', 0, '[]', 0, 0)");
  (o.commits ?? []).forEach((t, i) => commit.run(`c${i}`.padEnd(40, "0"), at(t)));
  const outcome = d.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, ?, 0, ?)");
  for (const [id, s] of Object.entries(o.states)) outcome.run(id, s.state, s.confidence ?? null, o.scannedAt);
}

const waste = (d: Ledger) => wasteCommand(d, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z", {});
const SCANNED = at(T0 + 20 * DAY);

describe("C-ABANDON through the ledger", () => {
  it("finds a long session that ended in failing calls, in a scanned repository that stayed quiet, and bills from where the failures began", async () => {
    const d = await build({ a: session("s-ab", T0, 14, 4) });
    landing(d, { scannedAt: SCANNED, states: { "s-ab": { state: "unlinked" } } });
    const r = waste(d);
    const e = r.events.find((x) => x.rule === "C-ABANDON");
    expect(e).toBeDefined();
    expect(e!.calls).toHaveLength(4);
    expect(e!.sessionId).toBe("s-ab");
    expect(r.text).toMatch(/C-ABANDON {2}a long session that ended failing, with nothing landed: 1 run in 1 session, 4 calls/);
  });

  it("is not abandoned when a commit was made in the repository after the session, however it is tied", async () => {
    const d = await build({ a: session("s-ab", T0, 14, 4) });
    landing(d, { scannedAt: SCANNED, commits: [T0 + 14 * 60_000 + 3_600_000], states: { "s-ab": { state: "unlinked" } } });
    expect(waste(d).events.filter((x) => x.rule === "C-ABANDON")).toEqual([]);
  });

  it("is not abandoned when another session took the folder up within a day, or when the session is too short or ended well", async () => {
    const resumed = await build({ a: session("s-ab", T0, 14, 4), b: session("s-next", T0 + 14 * 60_000 + 3 * 3_600_000, 3, 0) });
    landing(resumed, { scannedAt: SCANNED, states: { "s-ab": { state: "unlinked" }, "s-next": { state: "unlinked" } } });
    expect(waste(resumed).events.filter((x) => x.rule === "C-ABANDON" && x.sessionId === "s-ab")).toEqual([]);
    resumed.close();
    rmSync(work, { recursive: true, force: true });
    const short = await build({ a: session("s-short", T0, 8, 4) });
    landing(short, { scannedAt: SCANNED, states: { "s-short": { state: "unlinked" } } });
    expect(waste(short).events.filter((x) => x.rule === "C-ABANDON")).toEqual([]);
    short.close();
    rmSync(work, { recursive: true, force: true });
    const fine = await build({ a: session("s-fine", T0, 14, 0) });
    landing(fine, { scannedAt: SCANNED, states: { "s-fine": { state: "unlinked" } } });
    expect(waste(fine).events.filter((x) => x.rule === "C-ABANDON")).toEqual([]);
  });

  it("says nothing about a session that ran outside every scanned repository, or in one scanned before the session ended", async () => {
    const outside = await build({ a: session("s-out", T0, 14, 4, "/work/elsewhere") });
    landing(outside, { scannedAt: SCANNED, states: { "s-out": { state: "unlinked" } } });
    expect(waste(outside).events.filter((x) => x.rule === "C-ABANDON")).toEqual([]);
    outside.close();
    rmSync(work, { recursive: true, force: true });
    const early = await build({ a: session("s-early", T0, 14, 4) });
    landing(early, { scannedAt: at(T0 + 5 * 60_000), states: { "s-early": { state: "unlinked" } } });
    expect(waste(early).events.filter((x) => x.rule === "C-ABANDON")).toEqual([]);
  });

  it("is not evaluated, and says so, when no landing state was ever recorded", async () => {
    const d = await build({ a: session("s-ab", T0, 14, 4) });
    const r = waste(d);
    expect(r.events.filter((x) => x.rule === "C-ABANDON")).toEqual([]);
    expect(r.text).toMatch(/C-ABANDON {2}.*: not evaluated: the ledger has no landing states/);
    expect(r.text).toMatch(/C-REVERT {2}.*: not evaluated: the ledger has no landing states/);
    expect(r.text).toMatch(/C-PR {2}.*: not evaluated: no pull request facts in the ledger\. `desk landing --prs`/);
  });
});

describe("C-REVERT through the ledger", () => {
  it("bills every call of a session whose commits were reverted, and not one that landed", async () => {
    const d = await build({ a: session("s-rev", T0, 5, 0), b: session("s-ok", T0 + DAY, 5, 0) });
    landing(d, { scannedAt: SCANNED, states: { "s-rev": { state: "reverted", confidence: "high" }, "s-ok": { state: "merged", confidence: "high" } } });
    const r = waste(d);
    const rev = r.events.filter((x) => x.rule === "C-REVERT");
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ sessionId: "s-rev", confidence: "high" });
    expect(rev[0]!.calls).toHaveLength(5);
    expect(r.text).toMatch(/C-REVERT {2}work that was reverted: 1 run in 1 session, 5 calls/);
  });
});
