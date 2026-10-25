import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openCapture } from "../../src/desk/capture/store.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { accountTrajectories, persistTrajectory, renderAccounting } from "../../src/desk/trajectory/account.ts";
import { normalizeInput, readTrajectory, RESULT_CAP } from "../../src/desk/trajectory/read.ts";
import { REASON_LABEL, replayability } from "../../src/desk/trajectory/replayability.ts";
import { classifyTool, isReadOnlyShell } from "../../src/desk/trajectory/tools.ts";
import { assistantLine, testSnapshot } from "./helpers.ts";

/**
 * Trajectories (DF-040): what a call can do, a session rebuilt from its log, how far it can be replayed, and the accounting that says how much of a month's work that is.
 */
const root = mkdtempSync(join(tmpdir(), "desk-trajectory-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => {
  n += 1;
  const d = join(root, `t${n}`);
  mkdirSync(d, { recursive: true });
  return d;
};

describe("what a call can do", () => {
  const shell = (command: string) => classifyTool("Bash", { command });

  it("puts the reads of the workspace, the edits of a file, the network, other agents and unknown tools in their classes", () => {
    for (const t of ["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite"]) expect(classifyTool(t, {}), t).toMatchObject({ class: "read_only", effect: "workspace_read" });
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(classifyTool(t, {}), t).toMatchObject({ class: "mutating", effect: "file_edit" });
    for (const t of ["WebFetch", "WebSearch"]) expect(classifyTool(t, {}), t).toMatchObject({ class: "read_only", effect: "network_read" });
    for (const t of ["Task", "Agent"]) expect(classifyTool(t, {}), t).toMatchObject({ class: "mutating", effect: "agent" });
    for (const t of ["mcp__server__tool", "SomethingNew", ""]) expect(classifyTool(t, {}), t).toMatchObject({ class: "mutating", effect: "unknown" });
  });

  it("calls a shell line a read only when every command in it is a plain read and nothing redirects, expands or backgrounds", () => {
    for (const c of ["ls -la", "git status", "git log --oneline | head -5", "cat a.txt | grep foo | wc -l", "cd src && ls", "grep -r foo . 2>/dev/null", "git diff 2>&1 | head", "pwd", "git branch", "git branch -a", "git remote -v", "git stash list", "echo \"a > b\"", "find . -name '*.ts'", "ls; pwd\nwhoami"]) {
      expect(isReadOnlyShell(c), c).toBe(true);
      expect(shell(c).class, c).toBe("read_only");
    }
  });

  it("takes every other shell line to change something: a command not known, a redirect, a substitution, a background job, an env prefix, a path, a flag that writes", () => {
    for (const c of [
      "npm test", "node script.js", "echo hi > a.txt", "echo hi >> a.txt", "ls; rm -rf x", "cat $(foo)", "cat `foo`", "sleep 1 &", "FOO=1 ls", "./run.sh", "/bin/ls", "cat <<EOF\nx\nEOF", "git push", "git commit -m x", "git branch -D x",
      "git checkout main", "git diff --output=x", "find . -delete", "find . -exec rm {} \\;", "sort -o out.txt in.txt", "rm x", "curl http://example.com", "ls | xargs rm", "git config user.name x", "echo ${HOME}", "cat 'unclosed", "", "   ",
    ]) {
      expect(isReadOnlyShell(c), JSON.stringify(c)).toBe(false);
    }
    expect(shell("npm test")).toMatchObject({ class: "mutating", effect: "shell" });
  });

  it("lets the owner say what a tool is, and an owner's word wins over the table", () => {
    const own = new Map([["mcp__docs__search", { class: "read_only" as const, effect: "network_read" as const, why: "the owner says it reads" }]]);
    expect(classifyTool("mcp__docs__search", {}, own)).toMatchObject({ class: "read_only", why: "the owner says it reads" });
    expect(classifyTool("mcp__docs__other", {}, own).class).toBe("mutating");
  });
});

/** One log, in the shape of a real Claude Code session log: prompts, assistant messages with tool uses, and the user messages that carry results. */
function logOf(lines: unknown[]): string {
  const dir = fresh();
  const p = join(dir, "s.jsonl");
  writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return p;
}
const prompt = (text: string, ts = "2026-10-02T10:00:00Z") => ({ type: "user", sessionId: "sess-aaaa-1111", cwd: "/work/proj", timestamp: ts, uuid: `u-${text.length}-${ts}`, message: { role: "user", content: text } });
const use = (id: string, name: string, input: unknown, ts = "2026-10-02T10:01:00Z") => ({ type: "assistant", sessionId: "sess-aaaa-1111", cwd: "/work/proj", timestamp: ts, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: unknown, isError = false, ts = "2026-10-02T10:01:05Z") => ({ type: "user", sessionId: "sess-aaaa-1111", timestamp: ts, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

describe("reading a session back from its log", () => {
  it("joins each call to its result, in order, with what each did to the world, and counts the prompts and messages", () => {
    const t = readTrajectory(logOf([prompt("fix the thing"), use("a", "Read", { file_path: "/work/proj/x.ts" }), result("a", "file text"), use("b", "Bash", { command: "npm test" }), result("b", [{ type: "text", text: "3 passed" }]), use("c", "Edit", { file_path: "/work/proj/x.ts", old_string: "a", new_string: "b" }), result("c", "ok", true)]));
    expect(t).toMatchObject({ sessionId: "sess-aaaa-1111", cwd: "/work/proj", prompts: 1, assistantMessages: 3, compactions: 0, malformedLines: 0 });
    expect(t.steps.map((s) => [s.seq, s.tool, s.kind.effect, s.result.present, s.result.isError])).toEqual([[0, "Read", "workspace_read", true, false], [1, "Bash", "shell", true, false], [2, "Edit", "file_edit", true, true]]);
    expect(t.steps[1]!.result.chars).toBe(8);
    expect(t.startedAt).toBe("2026-10-02T10:00:00Z");
  });

  it("gives a call the same key in two sessions run in different folders, and a different key for a different call", () => {
    const a = readTrajectory(logOf([prompt("p"), use("a", "Read", { file_path: "/work/proj/src/x.ts" }), use("b", "Read", { file_path: "/work/proj/src/y.ts" })]));
    const moved = logOf([{ ...prompt("p"), cwd: "/elsewhere/sandbox" }, { ...use("a", "Read", { file_path: "/elsewhere/sandbox/src/x.ts" }), cwd: "/elsewhere/sandbox" }]);
    const b = readTrajectory(moved);
    expect(b.steps[0]!.keySha).toBe(a.steps[0]!.keySha);
    expect(a.steps[0]!.keySha).not.toBe(a.steps[1]!.keySha);
    const w = readTrajectory(logOf([{ ...prompt("p"), cwd: "C:\\work\\proj" }, { ...use("a", "Read", { file_path: "C:\\work\\proj\\src\\x.ts" }), cwd: "C:\\work\\proj" }]));
    expect(w.steps[0]!.keySha).toBe(a.steps[0]!.keySha);
  });

  it("tells two commands apart that differ only in a long, random-looking path, which full redaction would have made the same", () => {
    const path = "/tmp/Xk9fQ2vLm8Zr4Tn7Wb3Yc6Hd1Js5Pq0Ae/sub";
    const t = readTrajectory(logOf([prompt("p"), use("a", "Bash", { command: `rm -rf ${path}/data` }), use("b", "Bash", { command: `rm -rf ${path}/data2` }), use("c", "Bash", { command: `rm -rf ${path}/data` })]), { keepText: true });
    expect(t.steps[0]!.keySha).not.toBe(t.steps[1]!.keySha);
    expect(t.steps[0]!.keySha).toBe(t.steps[2]!.keySha);
    // The text that is kept for a person to read is still redacted.
    expect(t.steps[0]!.input).not.toContain("Xk9fQ2vLm8Zr4Tn7Wb3Yc6Hd1Js5Pq0Ae");
  });

  it("keeps no text unless asked, and redacts what it keeps: a credential, a home path, a long random token", () => {
    const key = ["sk", "a1B2c3D4e5F6g7H8i9J0kLmN"].join("-");
    const lines = [prompt("p"), use("a", "Bash", { command: `curl -H "Authorization: Bearer ${key}" http://x` }), result("a", `token ${key} ok`)];
    const without = readTrajectory(logOf(lines));
    expect(without.steps[0]!.input).toBeNull();
    expect(without.steps[0]!.result.text).toBeNull();
    const kept = readTrajectory(logOf(lines), { keepText: true });
    expect(kept.steps[0]!.input).not.toContain(key);
    expect(kept.steps[0]!.result.text).not.toContain(key);
    expect(kept.steps[0]!.result.text).toContain("ok");
    expect(without.steps[0]!.keySha).toBe(kept.steps[0]!.keySha);
  });

  it("marks a result the tool cut short, a result past the cap, and reads a large output back whole from the file the tool kept it in", () => {
    const dir = fresh();
    const whole = `line one\n${"x".repeat(50_000)}\nthe end`;
    const file = join(dir, "kept.txt");
    writeFileSync(file, whole);
    const lines = [
      prompt("p"),
      use("a", "Bash", { command: "npm run big" }), result("a", `<persisted-output>\nOutput too large (50KB). Full output saved to: ${file}\n\nPreview (first 2KB):\nline one`),
      use("b", "Bash", { command: "npm run gone" }), result("b", `<persisted-output>\nOutput too large (50KB). Full output saved to: ${join(dir, "missing.txt")}\n\nPreview (first 2KB):\nline one`),
      use("c", "WebFetch", { url: "https://example.com" }), result("c", "the page [truncated]"),
      use("d", "Bash", { command: "npm run huge" }), result("d", "y".repeat(RESULT_CAP + 5)),
    ];
    const p = join(dir, "log.jsonl");
    writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const t = readTrajectory(p, { keepText: true });
    expect(t.steps.map((s) => [s.result.truncated, s.result.recovered])).toEqual([[false, true], [true, false], [true, false], [true, false]]);
    expect(t.steps[0]!.result.text).toContain("the end");
    expect(t.steps[0]!.result.chars).toBe(whole.length);
  });

  it("counts a compaction, lines of a delegated agent that it does not follow, and a line that is not JSON", () => {
    const p = logOf([prompt("p"), { type: "system", subtype: "compact_boundary", sessionId: "sess-aaaa-1111", timestamp: "2026-10-02T10:02:00Z", compactMetadata: { preTokens: 5 } }, { ...use("s", "Bash", { command: "ls" }), isSidechain: true }]);
    writeFileSync(p, `${readFileLines(p)}\nnot json at all\n`);
    const t = readTrajectory(p);
    expect(t).toMatchObject({ compactions: 1, sidechainLines: 1, malformedLines: 1 });
    expect(t.steps).toEqual([]);
  });

  it("writes a path under the session's folder as <cwd>, with forward slashes, and leaves other text alone", () => {
    const clean = (s: string): string => s;
    expect(normalizeInput({ file_path: "/work/proj/a/b.ts", pattern: "x\\d+" }, "/work/proj", clean)).toEqual({ file_path: "<cwd>/a/b.ts", pattern: "x\\d+" });
    expect(normalizeInput({ c: "cd C:\\work\\proj\\sub && ls" }, "C:\\work\\proj", clean)).toEqual({ c: "cd <cwd>/sub && ls" });
    expect(normalizeInput({ p: "/work/project-two/x" }, "/work/proj", clean)).toEqual({ p: "/work/project-two/x" });
  });
});

function readFileLines(p: string): string {
  return execFileSync(process.execPath, ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(p)}, "utf8").trimEnd())`], { encoding: "utf8" });
}

describe("how far a session can be replayed", () => {
  const read = (lines: unknown[]) => replayability(readTrajectory(logOf(lines)));

  it("is full when every call has its whole result and the transcript has no gap", () => {
    const r = read([prompt("p"), use("a", "Read", { file_path: "x" }), result("a", "t"), use("b", "Bash", { command: "npm test" }), result("b", "ok"), use("c", "Edit", { file_path: "x" }), result("c", "ok")]);
    expect(r).toMatchObject({ eligible: true, class: "full", reasons: [], codes: [] });
    expect(r.counts).toMatchObject({ toolCalls: 3, readOnly: 1, mutating: 2, resultsPresent: 3, resultsMissing: 0 });
  });

  it("is insufficient when a call that cannot be run again has no result, or only part of one, and not when an edit or a workspace read lacks one", () => {
    const missing = read([prompt("p"), use("a", "Bash", { command: "git push" })]);
    expect(missing).toMatchObject({ class: "insufficient", codes: ["served_missing"] });
    expect(missing.reasons[0]).toMatch(/^1 call that cannot be run again .* has no recorded result$/);
    const cut = read([prompt("p"), use("a", "WebFetch", { url: "u" }), result("a", "text [truncated]")]);
    expect(cut).toMatchObject({ class: "insufficient", codes: ["served_cut"] });
    const bothKinds = read([prompt("p"), use("a", "Bash", { command: "npm i" }), use("b", "mcp__x__y", {}), use("c", "Task", {})]);
    expect(bothKinds.reasons[0]).toMatch(/^3 calls that cannot be run again/);
    const harmless = read([prompt("p"), use("a", "Edit", { file_path: "x" }), use("b", "Read", { file_path: "y" })]);
    expect(harmless).toMatchObject({ class: "tools_only", codes: ["reads_missing"] });
  });

  it("is tools only when the calls are whole and the transcript has a gap", () => {
    const withCompaction = read([prompt("p"), use("a", "Bash", { command: "npm test" }), result("a", "ok"), { type: "system", subtype: "compact_boundary", timestamp: "2026-10-02T10:03:00Z", compactMetadata: { preTokens: 5 } }]);
    expect(withCompaction).toMatchObject({ class: "tools_only", codes: ["compaction"] });
    const readCut = read([prompt("p"), use("a", "Read", { file_path: "x" }), result("a", "<persisted-output> too big")]);
    expect(readCut).toMatchObject({ class: "tools_only", codes: ["reads_cut"] });
  });

  it("is not eligible, and says why, with no tool call or with no prompt", () => {
    expect(read([prompt("p")])).toMatchObject({ eligible: false, class: null, codes: ["no_calls"], reasons: [REASON_LABEL.no_calls] });
    expect(read([use("a", "Read", { file_path: "x" }), result("a", "t")])).toMatchObject({ eligible: false, class: null, codes: ["no_prompt"] });
  });
});

describe("the accounting of a month's work", () => {
  async function ledgerWith(sessions: { id: string; lines: unknown[] }[]) {
    const dir = fresh();
    const db = openLedger(":memory:");
    for (const s of sessions) {
      const path = join(dir, `${s.id}.jsonl`);
      writeFileSync(path, `${s.lines.map((l) => JSON.stringify({ ...(l as object), sessionId: s.id })).join("\n")}\n`);
      await ingestClaudeCode(db, [path], testSnapshot());
    }
    return db;
  }
  const call = (name: string, input: unknown, withResult: boolean, tag: string) => [use(`${tag}`, name, input), ...(withResult ? [result(`${tag}`, "ok")] : [])];
  const span = { sinceIso: "2026-10-01T00:00:00Z", untilIso: "2026-10-31T23:59:59Z" };
  const makeLines = (kind: string, id: string): unknown[] => {
    const base = [assistantLine({ id: `${id}-m`, session: id, ts: "2026-10-02T09:59:00Z", output: 5 }) && JSON.parse(assistantLine({ id: `${id}-m`, session: id, ts: "2026-10-02T09:59:00Z", output: 5 })), prompt("do the work please")];
    if (kind === "full") return [...base, ...call("Bash", { command: "npm test" }, true, `${id}a`)];
    if (kind === "tools") return [...base, ...call("Bash", { command: "npm test" }, true, `${id}a`), { type: "system", subtype: "compact_boundary", timestamp: "2026-10-02T10:05:00Z", compactMetadata: { preTokens: 5 } }];
    if (kind === "insufficient") return [...base, ...call("Bash", { command: "git push" }, false, `${id}a`)];
    if (kind === "nocalls") return base;
    return [...base, ...call("Read", { file_path: "x" }, true, `${id}a`)];
  };

  it("accounts for every session once, and the numbers add up: eligible is replayable plus insufficient", async () => {
    const kinds = ["full", "full", "tools", "insufficient", "insufficient", "insufficient", "nocalls", "full"];
    const db = await ledgerWith(kinds.map((k, i) => ({ id: `session-${k}-${i}`, lines: makeLines(k, `session-${k}-${i}`) })));
    const a = accountTrajectories(db, span);
    expect(a.sessions).toBe(8);
    expect(a).toMatchObject({ logNotFound: 0, nothingToReplay: 1, eligible: 7, full: 3, toolsOnly: 1, insufficient: 3 });
    expect(a.sessions).toBe(a.logNotFound + a.nothingToReplay + a.eligible);
    expect(a.eligible).toBe(a.full + a.toolsOnly + a.insufficient);
    expect(a.whyNot[REASON_LABEL.served_missing]).toBe(3);
    expect(a.whyNot[REASON_LABEL.compaction]).toBe(1);
    expect(a.whyNothing[REASON_LABEL.no_calls]).toBe(1);
    expect(a.sessionList).toHaveLength(8);
    const text = renderAccounting(a, 30);
    expect(text).toContain("replayable (3 + 1 = 4) and insufficient (3) make the 7 eligible.");
  });

  it("counts a session whose log has gone as one that could not be looked at, not as one with nothing to replay", async () => {
    const dir = fresh();
    const db = openLedger(":memory:");
    const path = join(dir, "session-gone-1.jsonl");
    writeFileSync(path, `${makeLines("full", "session-gone-1").map((l) => JSON.stringify({ ...(l as object), sessionId: "session-gone-1" })).join("\n")}\n`);
    await ingestClaudeCode(db, [path], testSnapshot());
    rmSync(path);
    expect(accountTrajectories(db, span)).toMatchObject({ sessions: 1, logNotFound: 1, nothingToReplay: 0, eligible: 0 });
  });

  it("keeps counts only by default, the redacted calls and results when asked, and replaces rather than repeats a session it sees again", async () => {
    const db = await ledgerWith([{ id: "session-keep-1", lines: makeLines("full", "session-keep-1") }]);
    const store = openCapture(":memory:");
    accountTrajectories(db, { ...span, store });
    expect(store.prepare("SELECT COUNT(*) n FROM trajectory").get()).toEqual({ n: 1 });
    expect(store.prepare("SELECT COUNT(*) n FROM trajectory_step").get()).toEqual({ n: 0 });
    accountTrajectories(db, { ...span, store, keep: true });
    expect(store.prepare("SELECT COUNT(*) n FROM trajectory").get()).toEqual({ n: 1 });
    expect(store.prepare("SELECT tool, tool_class, effect, result_present, result_text FROM trajectory_step").all()).toEqual([{ tool: "Bash", tool_class: "mutating", effect: "shell", result_present: 1, result_text: "ok" }]);
    accountTrajectories(db, { ...span, store, keep: true });
    expect(store.prepare("SELECT COUNT(*) n FROM trajectory_step").get()).toEqual({ n: 1 });
    expect(typeof persistTrajectory).toBe("function");
  });

  it("is limited to the period asked for", async () => {
    const db = await ledgerWith([{ id: "session-in-1", lines: makeLines("full", "session-in-1") }]);
    expect(accountTrajectories(db, { sinceIso: "2026-11-01T00:00:00Z", untilIso: "2026-11-30T00:00:00Z" }).sessions).toBe(0);
  });
});

describe("from the command line", () => {
  it("accounts for a ledger it is given, and keeps the calls and results in the capture store when asked", async () => {
    const dir = fresh();
    const ledgerFile = join(dir, "ledger.db");
    const db = openLedger(ledgerFile);
    const id = "session-cli-1";
    const log = join(dir, `${id}.jsonl`);
    const now = new Date();
    const ts = (m: number): string => new Date(now.getTime() - m * 60_000).toISOString();
    const lines = [JSON.parse(assistantLine({ id: "c1", session: id, ts: ts(30), output: 5 })), { type: "user", sessionId: id, cwd: "/work/proj", timestamp: ts(29), uuid: "u-1", message: { role: "user", content: "run the tests for me" } }, { type: "assistant", sessionId: id, cwd: "/work/proj", timestamp: ts(28), message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }, { type: "user", sessionId: id, timestamp: ts(27), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "3 passed" }] } }];
    writeFileSync(log, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    await ingestClaudeCode(db, [log], testSnapshot());
    db.close();
    const store = join(dir, "capture.db");
    const run = (...args: string[]): string => execFileSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "trajectories", ...args, "--db", ledgerFile, "--capture-db", store], { encoding: "utf8", windowsHide: true });
    const out = run("--days", "7");
    expect(out).toMatch(/The last 7 days: 1 session in the ledger\./);
    expect(out).toMatch(/1 could have been replayed/);
    expect(out).toMatch(/1 full: nothing is missing/);
    const kept = run("--days", "7", "--keep");
    expect(kept).toMatch(/kept in .*capture\.db/);
    const check = openCapture(store);
    expect(check.prepare("SELECT replay_class, kept_text FROM trajectory").all()).toEqual([{ replay_class: "full", kept_text: 1 }]);
    check.close();
  }, 120_000);
});
