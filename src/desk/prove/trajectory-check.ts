import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openLedger } from "../ledger/db.ts";
import { accountTrajectories } from "../trajectory/account.ts";
import { readTrajectory } from "../trajectory/read.ts";
import { REASON_LABEL, replayability } from "../trajectory/replayability.ts";
import { classifyTool, isReadOnlyShell } from "../trajectory/tools.ts";

/**
 * Trajectories (DF-040), on session logs written for the purpose: what each call can do, how far each session can be replayed, and that the accounting adds up. Five sessions are
 * made: a whole one, one with a gap in its transcript, two where a call that cannot be run again has no result (one has none at all, one has it cut short), and one that made no
 * call. Each must land in its class, with its reason, and the counts must satisfy eligible = full + tools only + insufficient and sessions = not found + nothing + eligible.
 */
const line = (o: unknown): string => JSON.stringify(o);

export function trajectoryProve(): { ok: boolean; detail: string } {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-traj-"));
  const fails: string[] = [];
  try {
    mkdirSync(root, { recursive: true });
    const ledger = openLedger(":memory:");
    const sessions: { id: string; kind: string; lines: string[] }[] = [];
    const prompt = (id: string): string => line({ type: "user", sessionId: id, cwd: "/work/p", timestamp: "2026-10-02T10:00:00Z", uuid: `u-${id}`, message: { role: "user", content: "do the work please" } });
    const use = (id: string, tag: string, name: string, input: unknown): string => line({ type: "assistant", sessionId: id, cwd: "/work/p", timestamp: "2026-10-02T10:01:00Z", message: { role: "assistant", content: [{ type: "tool_use", id: tag, name, input }] } });
    const res = (id: string, tag: string, text: string): string => line({ type: "user", sessionId: id, timestamp: "2026-10-02T10:01:05Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: tag, content: text }] } });
    sessions.push({ id: "prove-full-0001", kind: "full", lines: [prompt("prove-full-0001"), use("prove-full-0001", "a", "Bash", { command: "npm test" }), res("prove-full-0001", "a", "3 passed")] });
    sessions.push({ id: "prove-tools-0002", kind: "tools_only", lines: [prompt("prove-tools-0002"), use("prove-tools-0002", "a", "Bash", { command: "npm test" }), res("prove-tools-0002", "a", "3 passed"), line({ type: "system", subtype: "compact_boundary", timestamp: "2026-10-02T10:05:00Z" })] });
    sessions.push({ id: "prove-miss-0003", kind: "insufficient", lines: [prompt("prove-miss-0003"), use("prove-miss-0003", "a", "Bash", { command: "git push origin main" })] });
    sessions.push({ id: "prove-cut-0004", kind: "insufficient", lines: [prompt("prove-cut-0004"), use("prove-cut-0004", "a", "WebFetch", { url: "https://example.com" }), res("prove-cut-0004", "a", "the page [truncated]")] });
    sessions.push({ id: "prove-none-0005", kind: "nothing", lines: [prompt("prove-none-0005")] });
    for (const s of sessions) {
      const path = join(root, `${s.id}.jsonl`);
      writeFileSync(path, `${s.lines.join("\n")}\n`);
      ledger.prepare("INSERT INTO session (session_id, tool, started_at) VALUES (?, 'claude_code', '2026-10-02T09:59:00Z')").run(s.id);
      ledger.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('claude_code', ?, 1, 1, '2026-10-02T10:10:00Z')").run(path);
      const r = replayability(readTrajectory(path));
      const got = r.eligible ? r.class : "nothing";
      if (got !== s.kind) fails.push(`${s.id} was ${got}, planted ${s.kind}`);
    }
    const a = accountTrajectories(ledger, { sinceIso: "2026-10-01T00:00:00Z", untilIso: "2026-10-31T00:00:00Z" });
    if (a.sessions !== a.logNotFound + a.nothingToReplay + a.eligible) fails.push("sessions do not add up");
    if (a.eligible !== a.full + a.toolsOnly + a.insufficient) fails.push("eligible is not full + tools only + insufficient");
    if (a.full !== 1 || a.toolsOnly !== 1 || a.insufficient !== 2 || a.nothingToReplay !== 1) fails.push(`counts were ${JSON.stringify({ full: a.full, toolsOnly: a.toolsOnly, insufficient: a.insufficient, nothing: a.nothingToReplay })}`);
    if (a.whyNot[REASON_LABEL.served_missing] !== 1 || a.whyNot[REASON_LABEL.served_cut] !== 1 || a.whyNot[REASON_LABEL.compaction] !== 1) fails.push("the reasons were not tallied under their wording");

    // What a call can do: nothing that could change something is ever taken for a read.
    const reads = ["ls -la", "git status", "git log --oneline | head -5", "cat a | grep b | wc -l", "grep -r x . 2>/dev/null", "cd src && ls"];
    const writes = ["npm test", "echo hi > a", "ls; rm -rf x", "cat $(x)", "sleep 1 &", "git push", "git branch -D x", "find . -delete", "FOO=1 ls", "./run.sh"];
    for (const c of reads) if (!isReadOnlyShell(c)) fails.push(`${c} was not taken for a read`);
    for (const c of writes) if (isReadOnlyShell(c)) fails.push(`${c} was taken for a read`);
    if (classifyTool("SomethingNew", {}).class !== "mutating") fails.push("a tool not known was taken for a read");
  } catch (e) {
    fails.push(`it threw: ${(e as Error).message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  if (fails.length > 0) return { ok: false, detail: fails.join("; ") };
  return { ok: true, detail: "five planted sessions landed in their classes (1 full, 1 tools only, 2 insufficient, 1 with nothing to replay), with their reasons; sessions and eligible add up; 6 shell lines that only read were taken for reads and 10 that could change something never were" };
}
