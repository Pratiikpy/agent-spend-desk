// Record the induced-regression canary series for the constructed scenario: one real run of the pack per day and arm.
// Day 1 is 2026-09-30, so that day 15 is Wednesday 14 October 2026, the date the sample plants its own change.
// The primary arm serves one model until day 14 and a smaller one from day 15: a switch behind a stable name, as in
// the demo. The control arm serves one other model throughout. Resumable: finished (day, arm) pairs are skipped.
//   npx tsx scripts/canary-record.ts [--days 30] [--out data/desk/canary/runs.jsonl]
import { parseArgs } from "node:util";

import { loadDotenv } from "../src/desk/env.ts";
import { OpenAiPort } from "../src/desk/agents/model.ts";
import { runPack, type RunRow } from "../src/desk/canary/runner.ts";
import { appendRows, readRows } from "../src/desk/canary/store.ts";
import { TASKS } from "../src/desk/canary/tasks.ts";

loadDotenv(".env");
const { values } = parseArgs({ options: { days: { type: "string", default: "30" }, out: { type: "string", default: "data/desk/canary/runs.jsonl" }, "switch-day": { type: "string", default: "15" } } });
const DAYS = Number(values.days);
const SWITCH = Number(values["switch-day"]);
const BEFORE = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const AFTER = "nvidia/nemotron-3.5-lightning-30b-a3b";
const CONTROL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
// The control arm runs every other task: a platform event shows in half the pack, and the model is rate-limited.
const CONTROL_TASKS = TASKS.filter((_, i) => i % 2 === 0);
const FIRST = Date.UTC(2026, 8, 30);
const dateOf = (day: number): string => new Date(FIRST + (day - 1) * 86_400_000).toISOString().slice(0, 10);

const port = (model: string) => new OpenAiPort({ baseUrl: process.env["NVIDIA_BASE_URL"]!, apiKey: process.env["NVIDIA_API_KEY"]!, model, backoffMs: [4000, 12000] });
const done = new Set(readRows(values.out!).rows.map((r) => `${r.day}|${r.arm}`));

const PARALLEL_DAYS = Number(process.env["CANARY_PARALLEL_DAYS"] ?? "1");
const FROM = Number(process.env["CANARY_FROM_DAY"] ?? "1");
const WANT = (process.env["CANARY_ARMS"] ?? "primary,control").split(",");
const days = Array.from({ length: DAYS }, (_, i) => i + 1).filter((d) => d >= FROM && (["primary", "control"] as const).some((a) => WANT.includes(a) && !done.has(`${d}|${a}`)));
let cursor = 0;
const worker = async (): Promise<void> => {
  for (;;) {
    const day = days[cursor];
    cursor += 1;
    if (day === undefined) return;
    const ARMS = (process.env["CANARY_ARMS"] ?? "primary,control").split(",");
    const todo: RunRow["arm"][] = (["primary", "control"] as const).filter((a) => ARMS.includes(a) && !done.has(`${day}|${a}`));
    const t0 = Date.now();
    const results = await Promise.all(
      todo.map((arm) => runPack({ port: port(arm === "control" ? CONTROL : day < SWITCH ? BEFORE : AFTER), arm, day, tasks: arm === "control" ? CONTROL_TASKS : TASKS, date: dateOf(day), concurrency: arm === "control" ? 2 : day < SWITCH ? 6 : Number(process.env["CANARY_CONCURRENCY"] ?? "2"), deadlineMs: 120_000, attempts: Number(process.env["CANARY_ATTEMPTS"] ?? "4"), retryPauseMs: Number(process.env["CANARY_PAUSE_MS"] ?? "9000") })),
    );
    for (const rows of results) appendRows(values.out!, rows);
    const line = results.map((rows) => `${rows[0]!.arm} ${rows.filter((r) => r.score === 1).length}/${rows.filter((r) => r.score !== null).length}${rows.some((r) => r.score === null) ? ` (${rows.filter((r) => r.score === null).length} errors)` : ""}`).join(", ");
    console.log(`day ${day} ${dateOf(day)}: ${line} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
};
await Promise.all(Array.from({ length: PARALLEL_DAYS }, worker));
console.log("done");
