import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentAdapter } from "./agents.ts";
import { startProxy, type Proxy, type ProxyEntry } from "./proxy.ts";
import { appendRecord, runOnce, type RunRecord } from "./runner.ts";
import { shuffled } from "./stats.ts";
import { readExpected, type LabTask } from "./task.ts";

export interface BatchOptions {
  name: string;
  tasks: LabTask[];
  repeats: number;
  arm: string;
  agent: AgentAdapter;
  model: string;
  seed: number;
  outDir: string;
  timeoutMs: number;
  concurrency: number;
  /** The model endpoint. Null runs agents that need none (a scripted agent). */
  endpoint: { upstream: string; apiKey: string; maxConcurrent?: number } | null;
  log?: (line: string) => void;
  keepWorkspace?: boolean;
  /** Where workspaces are made. Outside the repository, so an agent cannot reach the hidden tests by walking up. */
  workDir?: string;
  /** Run again the runs recorded as infrastructure failures. */
  retryInfra?: boolean;
}

/** The run records in a file. A run repeated after an infrastructure failure appears twice; only its latest record counts. */
export function readRecords(path: string): RunRecord[] {
  if (!existsSync(path)) return [];
  const out: RunRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as RunRecord);
    } catch {
      /* a half-written last line is ignored */
    }
  }
  const latest = new Map<string, RunRecord>();
  for (const r of out) latest.set(r.runId, r);
  return [...latest.values()];
}

/** A per-run seed, derived so the same batch seed and run id always give the same value. */
export function runSeed(batchSeed: number, runId: string): number {
  return createHash("sha256").update(`${batchSeed}\0${runId}`).digest().readUInt32BE(0);
}

/**
 * Run every task `repeats` times. The order is shuffled from the batch seed, so time of day and quota luck are not
 * tied to particular tasks, and repeats are interleaved, so an interrupted batch still has balanced data. A run already
 * recorded is skipped, which makes a batch resumable; runs recorded as infrastructure failures are repeated on request.
 */
export async function runBatch(opts: BatchOptions): Promise<RunRecord[]> {
  const log = opts.log ?? (() => undefined);
  mkdirSync(opts.outDir, { recursive: true });
  const runsPath = join(opts.outDir, "runs.jsonl");
  const proxyPath = join(opts.outDir, "proxy.jsonl");
  const workDir = opts.workDir ?? join(tmpdir(), "desk-lab", opts.name);
  const artifactsDir = join(opts.outDir, "artifacts");

  const done = new Map(readRecords(runsPath).map((r) => [r.runId, r]));
  const jobs: { task: LabTask; repeat: number; runId: string }[] = [];
  for (let repeat = 1; repeat <= opts.repeats; repeat += 1) {
    for (const task of opts.tasks) {
      const runId = `${opts.name}-${task.id}-${opts.arm}-r${repeat}`;
      const prior = done.get(runId);
      if (prior && !(opts.retryInfra && prior.outcome === "infra")) continue;
      jobs.push({ task, repeat, runId });
    }
  }
  const order = shuffled(jobs, opts.seed);
  log(`${order.length} runs to do (${done.size} already recorded)`);

  const byRun = new Map<string, ProxyEntry[]>();
  let proxy: Proxy | null = null;
  if (opts.endpoint) {
    proxy = await startProxy({
      upstream: opts.endpoint.upstream,
      apiKey: opts.endpoint.apiKey,
      maxConcurrent: opts.endpoint.maxConcurrent ?? Math.max(1, opts.concurrency),
      onEntry: (e) => {
        const list = byRun.get(e.run) ?? [];
        list.push(e);
        byRun.set(e.run, list);
        appendFileSync(proxyPath, `${JSON.stringify(e)}\n`);
      },
    });
  }

  const results: RunRecord[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      const job = order[i];
      if (!job) return;
      const expected = readExpected(job.task);
      if (!expected) throw new Error(`${job.task.id}: no expected.json; run \`desk lab audit --write\` first`);
      byRun.delete(job.runId);
      const record = await runOnce({
        runId: job.runId,
        task: job.task,
        expected,
        arm: opts.arm,
        repeat: job.repeat,
        seed: runSeed(opts.seed, job.runId),
        agent: opts.agent,
        model: opts.model,
        modelUrl: proxy ? proxy.runUrl(job.runId) : "",
        entriesFor: (id) => byRun.get(id) ?? [],
        ...(proxy ? { settle: (id: string) => (proxy as Proxy).settle(id) } : {}),
        workDir,
        artifactsDir,
        timeoutMs: opts.timeoutMs,
        ...(opts.keepWorkspace ? { keepWorkspace: true } : {}),
      });
      appendRecord(runsPath, record);
      results.push(record);
      log(`[${results.length}/${order.length}] ${job.task.id} r${job.repeat}: ${record.outcome} in ${(record.wallMs / 1000).toFixed(0)} s, ${record.accounting.calls} calls${record.outcome === "pass" ? "" : ` (${record.reason})`}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, () => worker()));
  } finally {
    await proxy?.close();
  }
  return results;
}
