import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AutopsyCall } from "../../src/desk/autopsy/engine.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { wasteCommand } from "../../src/desk/waste/command.ts";
import { CONTEXT_PARAMS, contextMeasures, readWindows } from "../../src/desk/waste/context.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

function call(over: Partial<AutopsyCall> & { read?: number; input?: number; write?: number } = {}): AutopsyCall {
  const { read = 20_000, input = 5, write = 100, ...rest } = over;
  return {
    callId: `c${Math.random().toString(36).slice(2, 8)}`, threadKey: "main", sessionId: "s1", tsMs: 0, model: "claude-opus-5", isSidechain: false,
    tokens: { input, output: 100, reasoning: 0, read, write5m: write, write1h: 0 },
    micros: { input: 0, output: 0, read: 2_000_000, write5m: 0, write1h: 0 },
    tools: [], toolResultChars: 0, humanPromptBefore: true, msSinceHumanPrompt: 0, ...rest,
  };
}

describe("a short prompt on a large context", () => {
  it("counts a call right after a prompt that carried a large context and added almost nothing new, and prices only its cache read", () => {
    const m = contextMeasures([call(), call({ sessionId: "s2" })]);
    expect(m.shortPrompt).toEqual({ calls: 2, sessions: 2, contextTokens: 2 * 20_105, readMicros: 4_000_000, unpricedCalls: 0 });
  });

  it("does not count a small context, a context where the new content is the larger part, a call with no prompt before it, or a delegated agent", () => {
    expect(contextMeasures([call({ read: 5_000 })]).shortPrompt.calls).toBe(0);
    expect(contextMeasures([call({ write: 5_000 })]).shortPrompt.calls).toBe(0);
    expect(contextMeasures([call({ humanPromptBefore: false })]).shortPrompt.calls).toBe(0);
    expect(contextMeasures([call({ isSidechain: true })]).shortPrompt.calls).toBe(0);
  });

  it("puts the boundaries where the parameters say: ten thousand tokens in all, and new content under two percent of it", () => {
    expect(contextMeasures([call({ read: CONTEXT_PARAMS.minContext - 105 })]).shortPrompt.calls).toBe(1);
    expect(contextMeasures([call({ read: CONTEXT_PARAMS.minContext - 106 })]).shortPrompt.calls).toBe(0);
    // 200 new in 10_000 is exactly two percent, which is not under it; 199 is.
    expect(contextMeasures([call({ read: 9_800, input: 0, write: 200 })]).shortPrompt.calls).toBe(0);
    expect(contextMeasures([call({ read: 9_801, input: 0, write: 199 })]).shortPrompt.calls).toBe(1);
  });

  it("counts a call on a model with no price as no dollars and says so", () => {
    const m = contextMeasures([call({ micros: null })]);
    expect(m.shortPrompt).toMatchObject({ calls: 1, readMicros: 0, unpricedCalls: 1 });
  });
});

describe("calls near the context window", () => {
  it("is not evaluated without the owner's window sizes, and names every model it could not judge", () => {
    const m = contextMeasures([call(), call({ model: "claude-sonnet-5-5" })]);
    expect(m.nearWindow).toBeNull();
    expect(m.modelsWithoutWindow).toEqual(["claude-opus-5", "claude-sonnet-5-5"]);
  });

  it("counts a call that used at least 85% of the window the owner gave, and lists a model with no window instead of guessing", () => {
    // 84,999 of 100,000 is just under 85%; 85,000 is exactly 85%, which counts.
    const calls = [call({ read: 84_899, write: 100, input: 0 }), call({ read: 85_000, write: 0, input: 0 }), call({ read: 1_000_000, model: "claude-sonnet-5-5" })];
    const m = contextMeasures(calls, { "claude-opus-5": 100_000 });
    expect(m.nearWindow).toEqual({ calls: 1, sessions: 1, models: { "claude-opus-5": 1 } });
    expect(m.modelsWithoutWindow).toEqual(["claude-sonnet-5-5"]);
  });
});

describe("the owner's window file", () => {
  let dir: string;
  beforeAll(() => void (dir = mkdtempSync(join(tmpdir(), "desk-windows-"))));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads whole token counts for models, and nothing from a file that is missing, broken, or full of values that cannot be a window", () => {
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify({ windows: { "claude-opus-5": 200_000, "m2": 1_000_000, "bad1": 12.5, "bad2": 10, "bad3": "200000", "bad4": 10 ** 10, "bad5": null } }));
    expect(readWindows(good)).toEqual({ "claude-opus-5": 200_000, m2: 1_000_000 });
    expect(readWindows(join(dir, "missing.json"))).toEqual({});
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(readWindows(broken)).toEqual({});
  });
});

describe("desk waste, the two measures", () => {
  let work: string;
  let db: Ledger;
  const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "desk-context-cmd-"));
    const lines = [humanPromptLine({ uuid: "p0", session: "sess-c", ts: at(0) }), assistantLine({ id: "a1", session: "sess-c", ts: at(1), output: 200, read: 30_000, write5m: 100, input: 5 })];
    const path = join(work, "c.jsonl");
    writeFileSync(path, `${lines.join("\n")}\n`);
    db = openLedger(":memory:");
    await ingestClaudeCode(db, [path], loadSnapshot(PRICES));
  });
  afterAll(() => {
    db?.close();
    rmSync(work, { recursive: true, force: true });
  });

  it("lists the short prompt on a large context with its reads, says it is not billed, and says the window check needs the owner's sizes", () => {
    const r = wasteCommand(db, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z", {});
    expect(r.text).toMatch(/C-BLOAT {2}context carried for a short prompt: 1 call in 1 session came right after a prompt of yours, carried at least 10,000 tokens of context and added under 2% of it new; 30,105 tokens in all, \$/);
    expect(r.text).toContain('Listed, not billed: a short prompt such as "yes" or "go on" needs the context it follows.');
    expect(r.text).toMatch(/C-BLOAT {2}calls near the context window: not evaluated\. The price list does not carry window sizes/);
    expect(r.events).toEqual([]);
  });

  it("evaluates the window check when the owner gave a window, and names a model it has none for", () => {
    const hit = wasteCommand(db, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z", { "claude-opus-5": 35_000 });
    expect(hit.text).toMatch(/calls near the context window: 1 call in 1 session used at least 85% of their model's window \(claude-opus-5 1\)\. Listed, not billed/);
    const miss = wasteCommand(db, loadSnapshot(PRICES), "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z", { "some-other-model": 35_000 });
    expect(miss.text).toMatch(/calls near the context window: 0 calls in 0 sessions/);
    expect(miss.text).toMatch(/no window given for: claude-opus-5\./);
  });
});
