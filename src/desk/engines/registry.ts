import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ENGINE_NAMES, type EngineName } from "./load.ts";

/**
 * What the trace says about each engine: where its code came from and how many conformance checks it
 * passed. The count is read from a recorded run of Meterless's own conformance runners against our copies
 * (`recordConformance`), never typed in; an engine with no recorded run says "not run".
 */
export const SOURCE_COMMIT = "0aa7417";

const LAYOUT: Record<EngineName, { dir: string; env: string; expected: number; impl: string }> = {
  hmem: { dir: "hmem", env: "HMEM_IMPL", expected: 13, impl: `desk/hmem@meterless-${SOURCE_COMMIT}` },
  world_model: { dir: "world-model", env: "WORLD_MODEL_IMPL", expected: 8, impl: `desk/world-model@meterless-${SOURCE_COMMIT}` },
  markovian: { dir: "markovian", env: "MARKOVIAN_IMPL", expected: 8, impl: `desk/markovian@meterless-${SOURCE_COMMIT}` },
};

export const DEFAULT_CONFORMANCE_FILE = "data/sample/engines/conformance.json";

export interface ConformanceRecord {
  engine: EngineName;
  passed: number;
  total: number;
  expected: number;
  exitCode: number | null;
  ranAt: string;
}

export interface EngineInfo {
  engine: EngineName;
  impl: string;
  /** "8/8", or "not run" when no recorded run exists. */
  conformance: string;
}

export function readConformance(file = DEFAULT_CONFORMANCE_FILE): Partial<Record<EngineName, ConformanceRecord>> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { results?: ConformanceRecord[] };
    const out: Partial<Record<EngineName, ConformanceRecord>> = {};
    for (const r of parsed.results ?? []) if (ENGINE_NAMES.includes(r.engine)) out[r.engine] = r;
    return out;
  } catch {
    return {};
  }
}

export function engineInfo(engine: EngineName, file = DEFAULT_CONFORMANCE_FILE): EngineInfo {
  const rec = readConformance(file)[engine];
  const ok = rec !== undefined && rec.exitCode === 0 && rec.passed === rec.total && rec.total === rec.expected;
  return { engine, impl: LAYOUT[engine].impl, conformance: rec === undefined ? "not run" : ok ? `${rec.passed}/${rec.total}` : `FAILED ${rec.passed}/${rec.total}` };
}

/** Run Meterless's three conformance runners against src/engines/ and record the counts. Slow: spawns three processes. */
export function recordConformance(file = DEFAULT_CONFORMANCE_FILE, now: () => string = () => new Date().toISOString()): ConformanceRecord[] {
  const results: ConformanceRecord[] = [];
  for (const engine of ENGINE_NAMES) {
    const l = LAYOUT[engine];
    const impl = resolve("src", "engines", l.dir, "index.ts");
    const runner = resolve("vendor", "meterless", l.dir, "conformance", "runner.ts");
    const r = spawnSync(process.execPath, ["--import", "tsx", runner], { env: { ...process.env, [l.env]: impl }, encoding: "utf8", timeout: 240_000 });
    const m = /(\d+)\/(\d+) checks passed/.exec(r.stdout ?? "");
    results.push({ engine, passed: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0, expected: l.expected, exitCode: r.status, ranAt: now() });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ source: `https://github.com/Meterless/Meterless commit ${SOURCE_COMMIT}`, results }, null, 2));
  return results;
}
