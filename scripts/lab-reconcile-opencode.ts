/**
 * Check the OpenCode reader against the Lab's own accounting. Every Lab run leaves the agent's own database behind (in
 * the run's folder) and the accounting proxy recorded the same calls from outside, so two independent counts of one run
 * can be compared: calls, prompt tokens (input plus cache reads and writes) and completion tokens (output plus reasoning).
 * OpenCode also makes one small call of its own to title each session, and does not store it as a message; the proxy sees it.
 * The table therefore shows the proxy twice: all calls, and without that call (the first call of the run when its prompt is
 * under a tenth of the median prompt of the run's calls).
 * Usage: node scripts/lab-reconcile-opencode.ts <batch folder under data/lab> <work folder holding the runs>
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readOpenCode } from "../src/desk/ingest/opencode.ts";

const [batchDir, workDir] = process.argv.slice(2);
if (!batchDir || !workDir) {
  console.error("Usage: lab-reconcile-opencode.ts <batch folder> <work folder>");
  process.exit(2);
}
interface Row {
  runId: string;
  startedAt: string;
  wallMs: number;
  accounting: { calls: number; promptTokens: number; completionTokens: number };
}
interface ProxyCall {
  run: string;
  ts: string;
  promptTokens: number;
  completionTokens: number;
}
const latest = new Map<string, Row>();
for (const line of readFileSync(join(batchDir, "runs.jsonl"), "utf8").split("\n")) {
  if (line.trim() === "") continue;
  const r = JSON.parse(line) as Row;
  latest.set(r.runId, r);
}

const proxyCalls = new Map<string, ProxyCall[]>();
const proxyLog = join(batchDir, "proxy.jsonl");
if (existsSync(proxyLog)) {
  for (const line of readFileSync(proxyLog, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const c = JSON.parse(line) as ProxyCall & { status: number };
    if (c.status !== 200) continue;
    proxyCalls.set(c.run, [...(proxyCalls.get(c.run) ?? []), c]);
  }
}

const pad = (s: string, n: number): string => s.padEnd(n);
const out: string[] = [`${pad("run", 40)} ${pad("calls db/proxy/without title", 30)} ${pad("prompt tokens db/without title", 32)} ${pad("completion tokens db/without title", 36)} verdict`];
let exact = 0;
let total = 0;
for (const name of readdirSync(workDir).sort()) {
  const run = latest.get(name);
  const db = join(workDir, name, "opencode", "data", "opencode", "opencode.db");
  if (!run || !existsSync(db)) continue;
  const read = readOpenCode(db, new Set());
  const calls = read.calls.length;
  const prompt = read.calls.reduce((s, c) => s + c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens, 0);
  const completion = read.calls.reduce((s, c) => s + c.outputTokens, 0);
  const a = run.accounting;
  // The proxy's log is appended to by every attempt of a run: keep the entries of this record's own attempt.
  const from = Date.parse(run.startedAt);
  const until = from + run.wallMs + 5000;
  const attempt = (proxyCalls.get(name) ?? []).filter((c) => Date.parse(c.ts) >= from && Date.parse(c.ts) <= until);
  // A call the endpoint answered with no usage at all (an empty reply, which the proxy retried) has no tokens to compare and is not a stored message.
  const seen = attempt.filter((c) => typeof c.promptTokens === "number" && typeof c.completionTokens === "number");
  const noUsage = attempt.length - seen.length;
  const sorted = seen.map((c) => c.promptTokens).sort((x, y) => x - y);
  const median = sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] as number);
  const first = seen[0];
  const title = first !== undefined && median > 0 && first.promptTokens < median / 10 ? first : null;
  const without = { calls: seen.length - (title ? 1 : 0), prompt: seen.reduce((s, c) => s + c.promptTokens, 0) - (title?.promptTokens ?? 0), completion: seen.reduce((s, c) => s + c.completionTokens, 0) - (title?.completionTokens ?? 0) };
  const same = calls === without.calls && prompt === without.prompt && completion === without.completion;
  total += 1;
  if (same) exact += 1;
  out.push(`${pad(name, 40)} ${pad(`${calls}/${a.calls}/${without.calls}`, 30)} ${pad(`${prompt}/${without.prompt}`, 32)} ${pad(`${completion}/${without.completion}`, 36)} ${same ? "equal" : "DIFFERENT"}${title ? ` (title call: ${title.promptTokens} prompt, ${title.completionTokens} completion)` : ""}${noUsage > 0 ? ` (${noUsage} call(s) the endpoint answered with no usage)` : ""}`);
}
out.push(`${exact} of ${total} runs agree exactly with the proxy, once OpenCode's title call is set aside.`);
console.log(out.join("\n"));
