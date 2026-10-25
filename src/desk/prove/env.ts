import { existsSync } from "node:fs";
import { join } from "node:path";

import { findJsonlLogs } from "../ingest/discover.ts";
import { openLedger, type Ledger } from "../ledger/db.ts";
import { ingestClaudeCode } from "../ledger/ingest.ts";
import { linkOutcomes } from "../outcomes/link.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { SAMPLE_NOW_MS } from "../sample/clock.ts";
import { buildSample, DEFAULT_SAMPLE, readTruth, sampleLogsDir, sampleReposDir, type Truth } from "../sample/gen.ts";
import { TEAM_OF_REPO } from "../silo/seed.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

export interface Env {
  db: Ledger;
  truth: Truth;
}

/** The constructed sample, built from its seed and read by the real pipeline. `nowMs` is the instant landing is judged at; a published figure pins it. */
export async function sampleEnv(dir: string, nowMs: number = SAMPLE_NOW_MS, sample: Omit<typeof DEFAULT_SAMPLE, "outDir"> = DEFAULT_SAMPLE): Promise<Env> {
  const out = join(dir, "sample");
  if (!existsSync(sampleLogsDir(out))) buildSample({ ...sample, outDir: out });
  const db = openLedger(join(out, "ledger.db"));
  await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot(PRICES));
  linkOutcomes(db, Object.keys(TEAM_OF_REPO).map((n) => join(sampleReposDir(out), n)), nowMs);
  return { db, truth: readTruth(out) };
}
