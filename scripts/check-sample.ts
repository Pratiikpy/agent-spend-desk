// Compare what the Desk finds in a generated sample against what was planted in it.
// Usage: npx tsx scripts/check-sample.ts <sample-dir> <ledger-db>
import { loadAutopsyCalls } from "../src/desk/autopsy/load.ts";
import { analyseThread } from "../src/desk/autopsy/engine.ts";
import { openLedger } from "../src/desk/ledger/db.ts";
import { linkOutcomes } from "../src/desk/outcomes/link.ts";
import { loadSnapshot } from "../src/desk/pricing/pricebook.ts";
import { readTruth, sampleReposDir } from "../src/desk/sample/gen.ts";

const [dir = "data/desk/sample-test", dbPath = "data/desk/sample-test.db"] = process.argv.slice(2);
const truth = readTruth(dir);
const db = openLedger(dbPath);
const calls = loadAutopsyCalls(db, loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"), "0000", "9999");
const byThread = new Map<string, typeof calls>();
for (const c of calls) byThread.set(c.threadKey, [...(byThread.get(c.threadKey) ?? []), c]);
const flagged = { loops: new Map<string, number>(), idle: new Map<string, number>(), subagents: new Map<string, number>(), miss: new Map<string, number>() };
for (const thread of byThread.values()) {
  for (const [id, a] of analyseThread(thread)) {
    const call = thread.find((c) => c.callId === id)!;
    const bump = (m: Map<string, number>) => m.set(call.sessionId, (m.get(call.sessionId) ?? 0) + 1);
    if (a.wholeCall === "loops") bump(flagged.loops);
    if (a.wholeCall === "idle") bump(flagged.idle);
    if (a.wholeCall === "subagents") bump(flagged.subagents);
    if (a.miss) bump(flagged.miss);
  }
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const planted = { loops: 0, expectedLoops: 0, idle: 0, sub: 0, miss: 0, calls: 0 };
let falseLoopSessions = 0;
let falseIdleSessions = 0;
for (const s of truth.sessions) {
  planted.loops += s.loopCalls;
  planted.expectedLoops += Math.max(0, s.loopCalls - 2);
  planted.idle += s.idleCalls;
  planted.sub += s.subagentCalls;
  planted.miss += s.missCalls;
  planted.calls += s.calls;
  if (s.loopCalls === 0 && (flagged.loops.get(s.id) ?? 0) > 0) falseLoopSessions += 1;
  if (s.idleCalls === 0 && (flagged.idle.get(s.id) ?? 0) > 0) falseIdleSessions += 1;
}
console.log(`calls: ledger ${calls.length}, planted ${planted.calls}`);
console.log(`loops: planted ${planted.loops} (detectable ${planted.expectedLoops}), flagged ${sum(flagged.loops)}, sessions flagged with no planted loop ${falseLoopSessions}`);
console.log(`idle: planted ${planted.idle}, flagged ${sum(flagged.idle)}, sessions flagged with none planted ${falseIdleSessions}`);
console.log(`sub-agents: planted ${planted.sub}, flagged ${sum(flagged.subagents)}`);
console.log(`cache misses: planted (expired/switch/prefix) ${planted.miss}, flagged ${sum(flagged.miss)}`);

const r = linkOutcomes(db, [...new Set(truth.sessions.map((s) => s.repo))].map((n) => `${sampleReposDir(dir)}/${n}`), Date.parse("2026-12-01T00:00:00Z"));
console.log("landing states:", JSON.stringify(r.byState));
const state = new Map((db.prepare("SELECT session_id, state, best_confidence c FROM session_outcome").all() as unknown as { session_id: string; state: string; c: string | null }[]).map((x) => [x.session_id, x]));
const table: Record<string, Record<string, number>> = {};
for (const s of truth.sessions) {
  const st = state.get(s.id)?.state ?? "missing";
  table[s.fate] ??= {};
  table[s.fate]![st] = (table[s.fate]![st] ?? 0) + 1;
}
console.log("planted fate -> found state:", JSON.stringify(table));
