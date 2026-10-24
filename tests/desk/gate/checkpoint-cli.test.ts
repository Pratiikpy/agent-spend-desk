import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runGateCli } from "../../../src/desk/gate/cli.ts";
import { Gate } from "../../../src/desk/gate/gate.ts";
import { filePolicy } from "../../../src/desk/gate/policy-source.ts";
import { testSnapshot } from "../helpers.ts";
import { call } from "./harness.ts";

const OWNER = ["owner", "token", "for", "the", "cli", "test", "0123456789"].join("-");

let dir: string;
let policy: string;
let db: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "desk-gate-cli-"));
  policy = join(dir, "policy.yaml");
  db = join(dir, "gate.db");
  writeFileSync(policy, 'version: 1\nrules:\n  - id: allow-claude\n    kind: permit\n    when: { model: { in: ["claude-*"] } }\n    cap: { window: day, max_usd: "5.50", ask_at: 1.0, warn_at: 0.5 }\n');
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
    // The gates the command line opened still hold the database file on Windows; the folder is in the temp directory.
  }
});

const run = (args: string[]) => runGateCli([...args, "--db", db, "--policy", policy, "--handoff-dir", join(dir, "handoffs"), "--shadow-for", "0"], { DESK_GATE_OWNER_TOKEN: OWNER, USERNAME: "the-owner" });

/** A gate on the same file, on the real clock, whose day has $5.00 spent and whose third call is refused. */
function stopSession(): string {
  const raw = new DatabaseSync(db);
  const gate = new Gate({ db: raw, prices: testSnapshot(), policy: filePolicy(policy), person: "p-1", ownerKey: OWNER, handoffDir: join(dir, "handoffs"), hookProbeMicros: 1_000_000, shadowMs: 0 });
  for (const k of ["a", "b"]) {
    const d = gate.authorize(call({ idempotency_key: k, session_id: "s-cli" }));
    gate.settle({ reservation_id: d.reservationId, actual_micros: d.reservedMicros });
  }
  expect(gate.authorize(call({ idempotency_key: "c", session_id: "s-cli" })).verdict).toBe("deny");
  const path = gate.openCheckpoints()[0]!.handoff_path;
  raw.close();
  return path;
}

describe("desk gate checkpoints and resume", () => {
  it("says no session is stopped when none is, and lists a stopped one with where its handoff goes", async () => {
    expect(await run(["checkpoints"])).toBe(0);
    expect(out.join("\n")).toContain("no session is stopped for a checkpoint");
    out.length = 0;
    const path = stopSession();
    expect(await run(["checkpoints"])).toBe(0);
    expect(out.join("\n")).toContain("session s-cli");
    expect(out.join("\n")).toContain(`handoff: ${path}`);
    out.length = 0;
    expect(await run(["status"])).toBe(0);
    expect(out.join("\n")).toContain("checkpoints: 1 session stopped");
  });

  it("refuses to resume without the handoff, then under a cap that still binds, and resumes with an extension", async () => {
    const path = stopSession();
    expect(await run(["resume", "--session", "s-cli"])).toBe(1);
    expect(err.join("\n")).toContain("E_NO_HANDOFF");
    writeFileSync(path, readFileSync(path, "utf8").replace("<!-- the agent writes below this line -->", "<!-- the agent writes below this line -->\nDone: the importer. Open: the tests."));
    err.length = 0;
    expect(await run(["resume", "--session", "s-cli"])).toBe(1);
    expect(err.join("\n")).toContain("E_CAP_BINDS");
    err.length = 0;
    expect(await run(["resume", "--session", "s-cli", "--extend-usd", "5", "--for", "2h"])).toBe(1);
    expect(err.join("\n")).toContain("needs a reason");
    err.length = 0;
    out.length = 0;
    expect(await run(["resume", "--session", "s-cli", "--extend-usd", "5", "--for", "2h", "--reason", "the release is today"])).toBe(0);
    expect(out.join("\n")).toContain("resumed checkpoint 1 for session s-cli");
    expect(out.join("\n")).toContain("extension: 5.00 USD of headroom on day_spend_after_micros until");
    out.length = 0;
    expect(await run(["checkpoints"])).toBe(0);
    expect(out.join("\n")).toContain("no session is stopped");
    expect(await run(["integrity"])).toBe(0);
  });

  it("reads --extend-usd as dollars and refuses what is not", async () => {
    stopSession();
    expect(await run(["resume", "--session", "s-cli", "--extend-usd", "five"])).toBe(2);
    expect(err.join("\n")).toContain('cannot read --extend-usd "five" as dollars');
    expect(await run(["resume"])).toBe(2);
  });
});
