import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { writeAskTrace } from "../../src/desk/ask/command.ts";

const dir = mkdtempSync(join(tmpdir(), "desk-ask-trace-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the trace file of an answer", () => {
  it("holds one JSON line per event, with the reason for each, under the answer's id", () => {
    const trace = new MemoryTrace();
    trace.emit({ event: "desk.route", why: "computed", role: "risk_router", detail: { route: "read" } });
    trace.emit({ event: "fallback.used", why: "rule", role: "ask_planner", detail: { reason: "cassette_miss" } });
    const path = writeAskTrace(join(dir, "traces"), "ans-1", trace.events);
    expect(path).toBe(join(dir, "traces", "ask-ans-1.trace.jsonl"));
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { seq: number; event: string; why: string });
    expect(lines.map((l) => [l.seq, l.event, l.why])).toEqual([[1, "desk.route", "computed"], [2, "fallback.used", "rule"]]);
  });

  it("says it could not write the file, and does not throw, when the folder cannot be made", () => {
    const blocker = join(dir, "a-file");
    writeFileSync(blocker, "x");
    expect(writeAskTrace(join(blocker, "inside"), "ans-2", [])).toMatch(/^not written/);
  });
});
