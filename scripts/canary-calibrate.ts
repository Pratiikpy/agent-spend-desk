// Run the canary pack on several models a few times each and print pass rates, to see which pair separates.
//   npx tsx scripts/canary-calibrate.ts <model-id> [<model-id> ...]   (reads .env; prints no secrets)
import { loadDotenv } from "../src/desk/env.ts";
import { OpenAiPort } from "../src/desk/agents/model.ts";
import { runPack } from "../src/desk/canary/runner.ts";
import { TASKS } from "../src/desk/canary/tasks.ts";

loadDotenv(".env");
const models = process.argv.slice(2);
const repeats = Number(process.env["REPEATS"] ?? "3");
for (const model of models) {
  const port = new OpenAiPort({ baseUrl: process.env["NVIDIA_BASE_URL"]!, apiKey: process.env["NVIDIA_API_KEY"]!, model, backoffMs: [3000, 8000] });
  const per = new Map<string, { n: number; pass: number; err: number }>();
  let served = "";
  const t0 = Date.now();
  for (let r = 0; r < repeats; r += 1) {
    for (const row of await runPack({ port, arm: "primary", day: r + 1, date: "2026-01-01", concurrency: 8, deadlineMs: 60_000 })) {
      const e = per.get(row.taskId) ?? { n: 0, pass: 0, err: 0 };
      if (row.score === null) e.err += 1;
      else {
        e.n += 1;
        e.pass += row.score;
      }
      per.set(row.taskId, e);
      served = row.servedModel ?? served;
    }
  }
  const scored = [...per.values()].reduce((s, e) => s + e.n, 0);
  const passed = [...per.values()].reduce((s, e) => s + e.pass, 0);
  const errs = [...per.values()].reduce((s, e) => s + e.err, 0);
  console.log(`${model} (served ${served}): pass ${passed}/${scored} = ${((passed / Math.max(1, scored)) * 100).toFixed(0)}%, errors ${errs}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log("  " + TASKS.map((t) => `${t.id}:${per.get(t.id)?.pass ?? 0}/${per.get(t.id)?.n ?? 0}`).join(" "));
}
