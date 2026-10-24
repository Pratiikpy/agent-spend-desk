import { describe, expect, it } from "vitest";

import { CodexParser, parseCodexLog } from "../../src/desk/ingest/codex.ts";
import { codexLines } from "./codex-fixtures.ts";

const { meta, turn, count, other } = codexLines;

describe("reading a Codex session log", () => {
  it("reads the session, one call per growth of the cumulative total, and splits cached input from fresh input", () => {
    const r = parseCodexLog([
      meta({ id: "s1", ts: "2026-10-01T10:00:00.000Z", cwd: "/work/app", branch: "main", version: "0.130.0" }),
      turn("2026-10-01T10:00:01.000Z", "gpt-5.5"),
      count("2026-10-01T10:00:05.000Z", { input: 1000, cached: 600, output: 50, reasoning: 20 }),
      count("2026-10-01T10:00:30.000Z", { input: 2500, cached: 1800, output: 120, reasoning: 40 }),
    ]);
    expect(r.session).toMatchObject({ sessionId: "s1", cwd: "/work/app", gitBranch: "main", cliVersion: "0.130.0", modelProvider: "openai", forkedFromId: null, subagent: false });
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]).toMatchObject({ callId: "codex:s1:1", model: "gpt-5.5", inputTokens: 400, cachedInputTokens: 600, outputTokens: 50, reasoningTokens: 20, mergedRequests: false });
    expect(r.calls[1]).toMatchObject({ callId: "codex:s1:2", inputTokens: 300, cachedInputTokens: 1200, outputTokens: 70, reasoningTokens: 20 });
    expect(r.totalTokens).toBe(2620);
  });

  it("does not count a repeated event with the same total again, nor one with no usage in it", () => {
    const e = count("2026-10-01T10:00:05.000Z", { input: 1000, cached: 0, output: 50, reasoning: 0 });
    const r = parseCodexLog([meta({ id: "s2" }), turn("2026-10-01T10:00:01.000Z", "gpt-5.5"), other("2026-10-01T10:00:02.000Z", "token_count"), e, e, e]);
    expect(r.calls).toHaveLength(1);
  });

  it("sums the tokens of requests whose events were lost, from the cumulative total, and says so", () => {
    const r = parseCodexLog([
      meta({ id: "s3" }),
      turn("2026-10-01T10:00:01.000Z", "gpt-5.5"),
      count("2026-10-01T10:00:05.000Z", { input: 1000, cached: 0, output: 50, reasoning: 0 }),
      // two requests happened between these events: the cumulative total grew by 2,100 but the last request was 1,050
      count("2026-10-01T10:00:30.000Z", { input: 3050, cached: 0, output: 100, reasoning: 0 }, { input: 1000, cached: 0, output: 50, reasoning: 0 }),
    ]);
    expect(r.calls[1]).toMatchObject({ inputTokens: 2050, outputTokens: 50, mergedRequests: true });
    expect(r.totalTokens).toBe(3150);
  });

  it("gives each call the model of the latest turn, and 'unknown' when no turn named one", () => {
    const r = parseCodexLog([
      meta({ id: "s4" }),
      count("2026-10-01T10:00:02.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 }),
      turn("2026-10-01T10:00:03.000Z", "gpt-5.4-mini"),
      count("2026-10-01T10:00:05.000Z", { input: 300, cached: 0, output: 30, reasoning: 0 }),
      turn("2026-10-01T10:01:00.000Z", "gpt-5.5"),
      count("2026-10-01T10:01:05.000Z", { input: 900, cached: 0, output: 60, reasoning: 0 }),
    ]);
    expect(r.calls.map((c) => c.model)).toEqual(["unknown", "gpt-5.4-mini", "gpt-5.5"]);
  });

  it("keeps the plan limit readings, once each time they change, with the window and the reset time", () => {
    const rl = (p: number, s: number) => ({ primary: { used: p, minutes: 300, resetsAt: 1_790_000_000 }, secondary: { used: s, minutes: 10_080, resetsAt: 1_790_400_000 }, plan: "plus" });
    const r = parseCodexLog([
      meta({ id: "s5" }),
      turn("2026-10-01T10:00:01.000Z", "gpt-5.5"),
      count("2026-10-01T10:00:05.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 }, undefined, rl(1, 18)),
      count("2026-10-01T10:00:20.000Z", { input: 200, cached: 0, output: 20, reasoning: 0 }, undefined, rl(1, 18)),
      count("2026-10-01T10:00:40.000Z", { input: 300, cached: 0, output: 30, reasoning: 0 }, undefined, rl(2, 18)),
    ]);
    expect(r.limits.filter((l) => l.kind === "primary").map((l) => l.usedPercent)).toEqual([1, 2]);
    expect(r.limits.filter((l) => l.kind === "secondary").map((l) => l.usedPercent)).toEqual([18]);
    expect(r.limits[0]).toMatchObject({ windowMinutes: expect.any(Number), resetsAt: expect.any(Number), planType: "plus", limitId: "codex" });
  });

  it("reads limit readings even from an event that carries no token usage", () => {
    const r = parseCodexLog([meta({ id: "s6" }), count("2026-10-01T10:00:05.000Z", null, undefined, { primary: { used: 7, minutes: 300, resetsAt: 1_790_000_000 }, plan: "plus" })]);
    expect(r.calls).toHaveLength(0);
    expect(r.limits).toHaveLength(1);
    expect(r.limits[0]?.usedPercent).toBe(7);
  });

  it("counts malformed lines and keeps going, and ignores a truncated last line", () => {
    const r = parseCodexLog(["not json", meta({ id: "s7" }), turn("2026-10-01T10:00:01.000Z", "gpt-5.5"), count("2026-10-01T10:00:05.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 }), '{"timestamp":"2026-10-01T10:00:09.000Z","type":"event_msg","payl']);
    expect(r.malformedLines).toBe(2);
    expect(r.calls).toHaveLength(1);
  });

  it("reads a session with no events as a session with no calls, and a log with no session as nothing", () => {
    expect(parseCodexLog([meta({ id: "s8" })]).calls).toEqual([]);
    expect(parseCodexLog([]).session).toBeNull();
    expect(parseCodexLog(["{}"]).calls).toEqual([]);
  });
});

describe("a forked session", () => {
  const replay = (id: string, forkedFrom: string) => [
    meta({ id, ts: "2026-10-01T10:00:00.000Z", forkedFrom, subagent: true }),
    meta({ id: forkedFrom, ts: "2026-09-30T09:00:00.000Z", at: "2026-10-01T10:00:00.005Z" }),
    turn("2026-10-01T10:00:00.010Z", "gpt-5.5"),
    count("2026-10-01T10:00:00.020Z", { input: 50_000, cached: 40_000, output: 500, reasoning: 0 }),
    count("2026-10-01T10:00:00.030Z", { input: 120_000, cached: 100_000, output: 1_200, reasoning: 0 }),
  ];

  it("does not count the parent's history that the file replays at the moment of the fork", () => {
    const r = parseCodexLog([
      ...replay("child", "parent"),
      turn("2026-10-01T10:00:05.000Z", "gpt-5.5"),
      count("2026-10-01T10:00:09.000Z", { input: 130_000, cached: 100_000, output: 1_700, reasoning: 0 }),
    ]);
    expect(r.session).toMatchObject({ sessionId: "child", forkedFromId: "parent", subagent: true });
    expect(r.replayedCalls).toBe(2);
    expect(r.replayedTokens).toBe(121_200);
    expect(r.calls).toHaveLength(1);
    // the child's own call is the growth since the replayed total, not the whole cumulative figure
    expect(r.calls[0]).toMatchObject({ callId: "codex:child:1", inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 500 });
  });

  it("does not take the parent's limit readings from the replay either", () => {
    const rl = { primary: { used: 40, minutes: 300, resetsAt: 1_790_000_000 }, plan: "plus" };
    const lines = replay("child", "parent");
    lines[3] = count("2026-10-01T10:00:00.020Z", { input: 50_000, cached: 40_000, output: 500, reasoning: 0 }, undefined, rl);
    const r = parseCodexLog([...lines, count("2026-10-01T10:00:09.000Z", { input: 130_000, cached: 100_000, output: 1_700, reasoning: 0 }, undefined, { primary: { used: 41, minutes: 300, resetsAt: 1_790_000_000 }, plan: "plus" })]);
    expect(r.limits.map((l) => l.usedPercent)).toEqual([41]);
  });

  it("is not mistaken for a fork when the session was not forked", () => {
    const r = parseCodexLog([meta({ id: "plain", ts: "2026-10-01T10:00:00.000Z" }), turn("2026-10-01T10:00:00.010Z", "gpt-5.5"), count("2026-10-01T10:00:00.020Z", { input: 1000, cached: 0, output: 10, reasoning: 0 })]);
    expect(r.replayedCalls).toBe(0);
    expect(r.calls).toHaveLength(1);
  });
});

describe("feeding lines one at a time", () => {
  it("gives the same answer as parsing them all at once", () => {
    const lines = [meta({ id: "s9" }), turn("2026-10-01T10:00:01.000Z", "gpt-5.5"), count("2026-10-01T10:00:05.000Z", { input: 100, cached: 10, output: 10, reasoning: 0 }), count("2026-10-01T10:00:15.000Z", { input: 400, cached: 100, output: 40, reasoning: 5 })];
    const p = new CodexParser();
    for (const l of lines) p.feed(l);
    expect(p.result()).toEqual(parseCodexLog(lines));
  });
});

describe("a counter that disagrees with itself", () => {
  const T = (m: number): string => `2026-10-01T10:${String(m).padStart(2, "0")}:00.000Z`;

  it("flags a part of the count that went down while the total went up, clamps it, and says so", () => {
    const r = parseCodexLog([meta({ id: "n1" }), turn(T(0), "gpt-5.5"), count(T(1), { input: 1000, cached: 600, output: 50, reasoning: 20 }), count(T(2), { input: 2500, cached: 400, output: 120, reasoning: 40 })]);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]!.flags).toEqual([]);
    expect(r.calls[1]).toMatchObject({ inputTokens: 1500, cachedInputTokens: 0, outputTokens: 70, flags: ["inconsistent_buckets"] });
  });

  it("flags more cached input than the input grew by, and keeps the fresh input at zero, not below it", () => {
    const r = parseCodexLog([meta({ id: "n2" }), turn(T(0), "gpt-5.5"), count(T(1), { input: 1000, cached: 0, output: 50, reasoning: 0 }), count(T(2), { input: 1100, cached: 900, output: 60, reasoning: 0 })]);
    expect(r.calls[1]).toMatchObject({ inputTokens: 0, cachedInputTokens: 900, flags: ["inconsistent_buckets"] });
  });

  it("flags more tokens in one reading than a request can hold, and keeps the call", () => {
    const r = parseCodexLog([meta({ id: "n3" }), turn(T(0), "gpt-5.5"), count(T(1), { input: 60_000_000, cached: 0, output: 50, reasoning: 0 })]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ inputTokens: 60_000_000, flags: ["implausible_size"] });
  });

  it("starts counting again from a counter that restarted, instead of counting nothing until it catches up", () => {
    const r = parseCodexLog([
      meta({ id: "n4" }),
      turn(T(0), "gpt-5.5"),
      count(T(1), { input: 5000, cached: 0, output: 100, reasoning: 0 }),
      count(T(2), { input: 700, cached: 0, output: 100, reasoning: 0 }), // the counter started again
      count(T(3), { input: 1100, cached: 0, output: 150, reasoning: 0 }),
    ]);
    expect(r.counterResets).toBe(1);
    expect(r.calls).toHaveLength(2); // the first, and the growth after the restart
    expect(r.calls[1]).toMatchObject({ inputTokens: 400, outputTokens: 50, flags: [] });
  });

  it("leaves an ordinary session unflagged", () => {
    const r = parseCodexLog([meta({ id: "n5" }), turn(T(0), "gpt-5.5"), count(T(1), { input: 1000, cached: 600, output: 50, reasoning: 20 }), count(T(2), { input: 2500, cached: 1800, output: 120, reasoning: 40 })]);
    expect(r.calls.every((c) => c.flags.length === 0)).toBe(true);
    expect(r.counterResets).toBe(0);
  });
});
