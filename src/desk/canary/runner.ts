import { BudgetError } from "../agents/budget.ts";
import { completeOwn } from "../agents/own-calls.ts";
import { createHash } from "node:crypto";

import { ModelError, type ModelPort } from "../agents/model.ts";
import { harnessHash, scoreReply, TASKS, type CanaryTask } from "./tasks.ts";

/**
 * One scored attempt of one task on one day by one arm. The primary arm is the model the owner's agents use; the
 * control arm is a model that should not change when the primary does, so a platform-wide event shows up in both.
 * `servedModel` is what the endpoint says it served, which is how a switch behind a stable name is seen.
 */
export interface RunRow {
  day: number;
  /** The calendar date this day stands for. In the sample scenario dates are assigned; see docs/verification/canary-run.md. */
  date: string;
  arm: "primary" | "control";
  taskId: string;
  servedModel: string | null;
  /** 1 or 0, or null when the attempt produced no score (the model or the network failed, or the reply was empty). */
  score: 0 | 1 | null;
  /** Why there is no score, when there is none. */
  error: string | null;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Hash of the reply text, so a stored row can be checked against a replay without keeping the text. */
  replySha: string | null;
  harness: string;
  /** True when the request disabled every cache the endpoint offers (spec 8.4): the call carries a unique nonce. */
  cacheBypass: boolean;
}

export interface RunOptions {
  port: ModelPort;
  arm: RunRow["arm"];
  day: number;
  date: string;
  tasks?: readonly CanaryTask[];
  /** How many times each task is run in the pack: the scores of the repeats are separate rows of the same task and day. Default 1. */
  repeats?: number;
  concurrency?: number;
  /** Per call, in milliseconds. */
  deadlineMs?: number;
  temperature?: number;
  maxTokens?: number;
  /** Attempts per task before it counts as a failed attempt (an endpoint that answers 500 now and then is retried, spec 8.3). */
  attempts?: number;
  /** Pause before a retry, in milliseconds. */
  retryPauseMs?: number;
  /** Test hook: where the clock comes from. */
  now?: () => number;
}

const SYSTEM = "You are taking a short test. Work silently and answer exactly as instructed.";

/**
 * Run the whole pack once. Every attempt carries a unique nonce in the prompt so a cached answer cannot be served
 * (the proof that bypass was requested is stored with the row). Attempts that fail are rows with no score and a
 * reason, never zeros: a failure of the harness must not look like a regression of the model.
 */
export async function runPack(o: RunOptions): Promise<RunRow[]> {
  const base = o.tasks ?? TASKS;
  const repeats = Math.max(1, Math.min(o.repeats ?? 1, 20));
  // Task by task, repeat by repeat: a pack stopped early still holds whole tasks.
  const tasks: readonly CanaryTask[] = base.flatMap((t) => Array.from({ length: repeats }, () => t));
  const harness = harnessHash();
  const now = o.now ?? Date.now;
  const rows: RunRow[] = new Array<RunRow>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      const task = tasks[i]!;
      const started = now();
      const attempts = Math.max(1, o.attempts ?? 3);
      let last: RunRow | null = null;
      for (let a = 1; a <= attempts; a += 1) {
        const nonce = createHash("sha256").update(`${o.arm}|${o.day}|${task.id}|${now()}|${i}|${a}`).digest("hex").slice(0, 12);
        try {
          const r = await completeOwn(
            o.port,
            { role: `canary_${o.arm}`, maxTokens: o.maxTokens ?? 400, temperature: o.temperature ?? 0.7, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `${task.prompt}\n\n(test id ${nonce})` }] },
            o.deadlineMs ?? 90_000,
          );
          const score = scoreReply(task, r.content);
          last = {
            day: o.day, date: o.date, arm: o.arm, taskId: task.id, servedModel: r.servedModel, score, error: score === null ? "empty reply" : null, latencyMs: now() - started,
            tokensIn: r.usage?.inputTokens ?? null, tokensOut: r.usage?.outputTokens ?? null, replySha: createHash("sha256").update(r.content).digest("hex").slice(0, 16), harness, cacheBypass: true,
          };
          if (score !== null) break;
        } catch (e) {
          const why = e instanceof BudgetError ? "own spend limit" : e instanceof ModelError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : "unexpected";
          last = { day: o.day, date: o.date, arm: o.arm, taskId: task.id, servedModel: null, score: null, error: `${why} after ${a} of ${attempts} attempts`, latencyMs: now() - started, tokensIn: null, tokensOut: null, replySha: null, harness, cacheBypass: true };
        }
        // The Desk's own daily limit will not be lifted by asking again.
        if (last !== null && last.error?.startsWith("own spend limit")) break;
        if (a < attempts) await new Promise((r) => setTimeout(r, o.retryPauseMs ?? 3000));
      }
      rows[i] = last as RunRow;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, tasks.length)) }, worker));
  return rows;
}

/**
 * A probe for a cache in front of the endpoint: ask for a code that was invented a moment ago. An answer that does not contain it was
 * not made for this request, so the endpoint, or something in front of it, is replaying answers and a canary run through it would
 * measure the replay. Nothing here proves a cache is absent; an answer that holds the code shows only that this one was fresh.
 */
export async function probeCache(port: ModelPort, now: () => number = Date.now): Promise<{ fresh: boolean; why: string }> {
  const code = createHash("sha256").update(`probe|${now()}|${Math.random()}`).digest("hex").slice(0, 10);
  try {
    const r = await completeOwn(port, { role: "canary_probe", maxTokens: 60, temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Reply with exactly this code and nothing else: ${code}` }] }, 60_000);
    return r.content.includes(code) ? { fresh: true, why: "the probe came back with its own fresh code" } : { fresh: false, why: "the probe asked for a code invented a moment ago and the answer did not contain it, so the endpoint may be replaying answers" };
  } catch (e) {
    return { fresh: false, why: `the probe could not be answered (${e instanceof ModelError ? e.kind : "unexpected"})` };
  }
}
