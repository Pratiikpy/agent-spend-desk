import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runGateCli } from "../../../src/desk/gate/cli.ts";
import { Gate } from "../../../src/desk/gate/gate.ts";
import { filePolicy } from "../../../src/desk/gate/policy-source.ts";
import { testSnapshot } from "../helpers.ts";
import { call } from "./harness.ts";

/** The attention governor as the daemon sets it up: on by default with the specification's limits, tunable and switchable off, and reported by `status`. */
let dir: string;
let policy: string;
let db: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "desk-gate-attention-"));
  policy = join(dir, "policy.yaml");
  db = join(dir, "gate.db");
  writeFileSync(policy, 'version: 1\nrules:\n  - id: allow-claude\n    kind: permit\n    when: { model: { in: ["claude-*"] } }\n');
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // The gates the command line opened still hold the file on Windows; the folder is in the temp directory.
  }
});

const run = (args: string[]) => runGateCli([...args, "--db", db, "--policy", policy, "--shadow-for", "0"], { USERNAME: "the-owner" });

/** Start `n` agents on the real clock through a gate built the way the daemon builds it (the CLI's own defaults). */
function startAgents(n: number): string[] {
  const raw = new DatabaseSync(db);
  const gate = new Gate({ db: raw, prices: testSnapshot(), policy: filePolicy(policy), person: "p-1", shadowMs: 0, attention: { maxConcurrent: 4, maxInterruptionsPerHour: 10 } });
  const verdicts = Array.from({ length: n }, (_, i) => gate.authorize(call({ session_id: `s-${i}`, max_tokens: 1000 })).verdict);
  raw.close();
  return verdicts;
}

describe("desk gate status and the attention governor", () => {
  it("reports how many agents a person has working against the limit, and what a new one would take the load to", async () => {
    expect(startAgents(3)).toEqual(["allow", "allow", "allow"]);
    expect(await run(["status", "--person", "p-1"])).toBe(0);
    expect(out.join("\n")).toMatch(/attention \(p-1\): 3 of 4 agents working, 0 of 10 questions in the last hour; a new agent would take the load to 100% \(warn\)/);
  });

  it("takes the limits from --max-agents and --max-questions, and refuses a limit that is not a whole number of at least one", async () => {
    startAgents(1);
    expect(await run(["status", "--person", "p-1", "--max-agents", "8", "--max-questions", "20"])).toBe(0);
    expect(out.join("\n")).toMatch(/1 of 8 agents working, 0 of 20 questions/);
    // Each bad value is refused: by the limit's own check (an error that names the flag) or, for "-3" which reads as a flag and for an empty value, by the argument reader (exit 2).
    for (const bad of ["0", "-3", "two", "2.5", ""]) {
      const r: unknown = await run(["status", "--person", "p-1", "--max-agents", bad]).catch((e: Error) => e);
      expect(r === 2 || (r instanceof Error && /--max-agents is a whole number of at least 1/.test(r.message)), `${JSON.stringify(bad)} gave ${String(r)}`).toBe(true);
    }
  });

  it("says the governor is off with --no-attention", async () => {
    startAgents(1);
    expect(await run(["status", "--person", "p-1", "--no-attention"])).toBe(0);
    expect(out.join("\n")).toContain("attention (p-1): the governor is off (--no-attention)");
  });
});
