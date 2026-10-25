import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OwnerMemory } from "../../src/desk/engines/memory.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { authorRulesFrom, parseAuthorRule } from "../../src/desk/outcomes/author-rules.ts";
import { linkOutcomes } from "../../src/desk/outcomes/link.ts";
import { pseudonym } from "../../src/desk/security/secrets.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

/** What the owner says about who made a commit (DF-116): read from the memory, applied when commits are linked to sessions, and off when the memory engine is ablated. */
const snapshot = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");
const NOW = Date.parse("2026-10-30T00:00:00Z");
const BOT = "release-bot@acme.test";

describe("reading a statement about an author", () => {
  it("takes who and what from the ways an owner would say it, and nothing from a sentence that is not one", () => {
    expect(parseAuthorRule("Commits by release-bot@acme.test are human.")).toEqual({ author: BOT, kind: "human" });
    expect(parseAuthorRule("commit by Release-Bot@Acme.test is a human")).toEqual({ author: BOT, kind: "human" });
    expect(parseAuthorRule("Commits from ci@acme.test are agent work.")).toEqual({ author: "ci@acme.test", kind: "agent" });
    expect(parseAuthorRule("Commits by ci@acme.test, are bot")).toEqual({ author: "ci@acme.test", kind: "agent" });
    expect(parseAuthorRule("Commits by release-bot are human.")).toBeNull(); // an address is needed: a name matches nothing the ledger holds
    expect(parseAuthorRule("The nightly import must finish before nine.")).toBeNull();
  });

  it("does not apply two statements that disagree about one author, and lists the author", () => {
    const r = authorRulesFrom([
      { id: "m1", content: `Commits by ${BOT} are human.` },
      { id: "m2", content: `Commits by ${BOT} are agent work.` },
      { id: "m3", content: "Commits by ci@acme.test are agent work." },
      { id: "m4", content: "Commits by ci@acme.test are agent work, I checked." },
    ]);
    expect(r.conflicts).toEqual([BOT]);
    expect([...r.byPseudonym.keys()]).toEqual([pseudonym("ci@acme.test")]);
    expect(r.byPseudonym.get(pseudonym("ci@acme.test"))).toMatchObject({ kind: "agent", memoryId: "m4" });
  });

  it("reads only live notes from the memory, so a replaced statement stops applying and the replacement does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-author-rules-"));
    try {
      const m = await OwnerMemory.open({ persistDir: dir });
      const first = m.remember({ kind: "note", content: `Commits by ${BOT} are agent work.` });
      expect(m.authorRules().byPseudonym.get(pseudonym(BOT))).toMatchObject({ kind: "agent", memoryId: first.id });
      const second = m.remember({ kind: "note", content: `Commits by ${BOT} are human.`, supersedes: first.id });
      const rules = m.authorRules();
      expect(rules.conflicts).toEqual([]);
      expect(rules.byPseudonym.get(pseudonym(BOT))).toMatchObject({ kind: "human", memoryId: second.id });
      expect(m.all().find((x) => x.id === first.id)).toMatchObject({ superseded: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function git(root: string, args: string[], date?: string): string {
  return execFileSync("git", ["-C", root, "-c", "user.name=Bot", "-c", `user.email=${BOT}`, "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim();
}

describe("applied when commits are linked to sessions", () => {
  let dir: string;
  let repo: string;
  let db: Ledger;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "desk-author-link-"));
    repo = join(dir, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "app.ts"), "x");
    git(repo, ["add", "-A"]);
    // The release bot's commit carries a Co-Authored-By trailer naming Claude, which is what the Desk reads as agent work.
    git(repo, ["commit", "-q", "-m", "release\n\nCo-Authored-By: Claude <noreply@anthropic.com>"], "2026-10-20T10:20:00Z");
    db = openLedger(":memory:");
    const log = join(dir, "s.jsonl");
    const lines = [humanPromptLine({ uuid: "p1", session: "s-1", ts: "2026-10-20T10:00:00.000Z" })];
    for (let i = 0; i < 7; i += 1) lines.push(assistantLine({ id: `a${i}`, session: "s-1", ts: `2026-10-20T10:${String(1 + i * 2).padStart(2, "0")}:00.000Z`, output: 1000, tools: i === 0 ? ["Edit"] : [], toolInputs: i === 0 ? [{ file_path: join(repo, "src", "app.ts") }] : [], cwd: repo }));
    writeFileSync(log, `${lines.join("\n")}\n`);
    await ingestClaudeCode(db, [log], snapshot);
  }, 60_000);
  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const links = (): { method: string; confidence: string }[] => db.prepare("SELECT method, confidence FROM session_commit").all() as { method: string; confidence: string }[];

  it("reads the trailer as the trailer says when the owner has said nothing", () => {
    const r = linkOutcomes(db, [repo], NOW);
    expect(r.overridden).toBe(0);
    expect(links()).toEqual([{ method: "trailer_window", confidence: "high" }]);
    expect(db.prepare("SELECT agent_trailer AS a FROM git_commit").get()).toEqual({ a: 1 });
  });

  it("reads the commit as human work when the owner says its author is human, so the trailer no longer vouches for the link, and counts the override", () => {
    const rules = new Map([[pseudonym(BOT), { kind: "human" as const }]]);
    const r = linkOutcomes(db, [repo], NOW, { authorRules: rules });
    expect(r.overridden).toBe(1);
    expect(db.prepare("SELECT agent_trailer AS a FROM git_commit").get()).toEqual({ a: 0 });
    const l = links();
    expect(l).toHaveLength(1);
    expect(l[0]!.method).not.toBe("trailer_window");
    expect(l[0]!.method === "file_overlap" || l[0]!.method === "time_window").toBe(true);
  });

  it("changes nothing for an author the owner said nothing about, or a rule that agrees with the trailer", () => {
    const other = new Map([[pseudonym("someone-else@acme.test"), { kind: "human" as const }]]);
    expect(linkOutcomes(db, [repo], NOW, { authorRules: other }).overridden).toBe(0);
    const agrees = new Map([[pseudonym(BOT), { kind: "agent" as const }]]);
    expect(linkOutcomes(db, [repo], NOW, { authorRules: agrees }).overridden).toBe(0);
    expect(links()).toEqual([{ method: "trailer_window", confidence: "high" }]);
  });

  it("differs with the memory engine on and off from the command line: the ablation shows what the memory changes", async () => {
    const mem = join(dir, "memory");
    const m = await OwnerMemory.open({ persistDir: mem });
    m.remember({ kind: "note", content: `Commits by ${BOT} are human.` });
    const ledger = join(dir, "cli.db");
    const l = openLedger(ledger);
    await ingestClaudeCode(l, [join(dir, "s.jsonl")], snapshot);
    l.close();
    const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "landing", "--repo", repo, "--db", ledger, "--memory-dir", mem, ...a], { encoding: "utf8" });
    const on = run();
    expect(on.status, on.stderr).toBe(0);
    expect(on.stdout).toContain("1 commit read as the memory says about their author, not as the trailer says.");
    const off = run("--ablate", "hmem");
    expect(off.status, off.stderr).toBe(0);
    expect(off.stdout).not.toContain("read as");
  }, 120_000);
});
