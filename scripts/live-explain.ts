// Runs the Explainer against the configured live model on a small claim set and prints the outcome.
// Usage: npx tsx scripts/live-explain.ts   (reads .env; prints no secrets)
import { loadDotenv } from "../src/desk/env.ts";
import { ASK_LIVE, Budget } from "../src/desk/agents/budget.ts";
import { ClaimLedger } from "../src/desk/agents/claims.ts";
import { explain } from "../src/desk/agents/explain.ts";
import { portFromEnv, RecordingPort } from "../src/desk/agents/model.ts";
import { MemoryTrace } from "../src/desk/agents/trace.ts";

loadDotenv(".env");

const ledger = new ClaimLedger([
  { id: "c1", kind: "number", text: "The heaviest 5-hour window cost an estimated $534.87 at list price.", value: 534.87, unit: "usd", class: "estimated", source: "autopsy.window" },
  { id: "c2", kind: "number", text: "Sub-agents made up 84.0% of that window.", value: 84, unit: "pct", class: "computed", source: "autopsy.window" },
  { id: "c3", kind: "number", text: "Cache misses made up 2.6% of that window.", value: 2.6, unit: "pct", class: "computed", source: "autopsy.window" },
]);

const trace = new MemoryTrace();
const port = new RecordingPort(portFromEnv(process.env, "unused"), process.env["CASSETTE_DIR"] ?? "data/desk/cassettes-live");
const r = await explain("Where did my limit go in the heaviest window?", ledger, { port, budget: new Budget(ASK_LIVE), trace });
console.log(JSON.stringify({ attempts: r.attempts, usedFallback: r.usedFallback, sentences: r.sentences, rejections: r.rejections.map((x) => ({ reason: x.reason, detail: x.detail })), note: r.note }, null, 2));
for (const e of trace.events) console.log(e.seq, e.event, JSON.stringify(e.detail));
