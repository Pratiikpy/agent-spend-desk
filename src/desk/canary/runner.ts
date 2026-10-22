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
  const tasks = o.tasks ?? TASKS;
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
          const r = await o.port.complete(
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
          const why = e instanceof ModelError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : "unexpected";
          last = { day: o.day, date: o.date, arm: o.arm, taskId: task.id, servedModel: null, score: null, error: `${why} after ${a} of ${attempts} attempts`, latencyMs: now() - started, tokensIn: null, tokensOut: null, replySha: null, harness, cacheBypass: true };
        }
        if (a < attempts) await new Promise((r) => setTimeout(r, o.retryPauseMs ?? 3000));
      }
      rows[i] = last as RunRow;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, tasks.length)) }, worker));
  return rows;
}
