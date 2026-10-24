import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CAUSES, buildAutopsy, type AutopsyCall } from "../../src/desk/autopsy/engine.ts";
import { buildCard, type Card, type CardInput } from "../../src/desk/card/build.ts";
import { renderCardAnsi } from "../../src/desk/card/ansi.ts";
import { FIX_CONFIG, percentile, pastWindows, rankFixes } from "../../src/desk/card/fixes.ts";
import { svgToPng } from "../../src/desk/card/png.ts";
import { createRedactor, entropy } from "../../src/desk/card/redact.ts";
import { renderCardSvg, wrap } from "../../src/desk/card/svg.ts";
import { listPriceCost } from "../../src/desk/cost/cost.ts";
import { OPUS5 } from "./helpers.ts";

const HOUR = 3_600_000;
let seq = 0;

// Fake credentials and paths are assembled at run time so that no file in the repository holds a string
// that looks like a real secret or a real person's path. None of these values is real.
const join2 = (...parts: string[]): string => parts.join("");
const FAKE = {
  anthropic: join2("sk-", "ant-api03-", "AAAAAAAAAAAAAAAAAAAAAAAA"),
  bearer: join2("Bear", "er abcdefghijklmnopqrstuvwxyz012345"),
  aws: join2("AK", "IAABCDEFGHIJKLMNOP"),
  pem: join2("-----BEGIN RSA PRIV", "ATE KEY-----"),
  homeUnix: join2("/ho", "me/someone"),
  homeWin: join2("C:", "\\Users\\", "someone"),
  otherUnix: join2("/ho", "me/other"),
  otherWin: join2("D:", "\\clients\\acme\\plan.docx"),
  assignKey: join2("api_", 'key="hunter2hunter2"'),
  assignPw: join2("pass", "word: correcthorse"),
};

interface Spec {
  t: number; // ms from the start
  sidechain?: boolean;
  read?: number;
  write5m?: number;
  input?: number;
  output?: number;
  unpriced?: boolean;
  thread?: string;
}

function call(s: Spec): AutopsyCall {
  const tokens = { input: s.input ?? 10, output: s.output ?? 200, reasoning: 0, read: s.read ?? 0, write5m: s.write5m ?? 0, write1h: 0 };
  const c = listPriceCost(
    { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: tokens.read, cacheWrite5mTokens: tokens.write5m, cacheWrite1hTokens: 0 },
    OPUS5,
  ).components;
  seq += 1;
  return {
    callId: `c${seq}`,
    threadKey: s.thread ?? (s.sidechain ? "sub" : "main"),
    sessionId: "s1",
    tsMs: s.t,
    model: "claude-opus-5",
    isSidechain: s.sidechain ?? false,
    tokens,
    readMicrosPerToken: OPUS5.cacheReadPerMTokMicros / 1_000_000,
    micros: s.unpriced ? null : { input: c.input, output: c.output, read: c.cacheRead, write5m: c.cacheWrite5m, write1h: c.cacheWrite1h },
    tools: [],
    toolResultChars: 0,
    humanPromptBefore: false,
    msSinceHumanPrompt: 60_000,
  };
}

/** `windows` consecutive 5-hour windows, each with ordinary calls and `sub(w)` sub-agent calls. */
function history(windows: number, sub: (w: number) => number): AutopsyCall[] {
  const calls: AutopsyCall[] = [];
  for (let w = 0; w < windows; w += 1) {
    for (let i = 0; i < 12; i += 1) calls.push(call({ t: w * 5 * HOUR + i * 60_000, read: 20_000, write5m: 500 }));
    for (let i = 0; i < sub(w); i += 1) calls.push(call({ t: w * 5 * HOUR + 30 * 60_000 + i * 1_000, sidechain: true, read: 10_000, write5m: 800 }));
  }
  return calls;
}

const INPUT: Omit<CardInput, "calls" | "mode"> = {
  hours: 5,
  days: 14,
  ingest: { malformedLines: 0, truncatedTails: 0, usageConflicts: 0, logFilesFound: 3, searchedPaths: [`${FAKE.homeUnix}/.claude/projects`] },
  landingKnown: true,
  home: FAKE.homeUnix,
};

function card(calls: AutopsyCall[], extra: Partial<Parameters<typeof buildCard>[0]> = {}): Card {
  const built = buildCard({ calls, mode: "own_logs", ...INPUT, ...extra });
  if ("empty" in built) throw new Error("expected a card");
  return built;
}

afterEach(() => vi.restoreAllMocks());

describe("redaction", () => {
  const r = () => createRedactor(FAKE.homeWin);

  it("removes credential shapes and counts them without keeping the value", () => {
    const red = r();
    const out = red.clean(`key ${FAKE.anthropic} and ${FAKE.bearer} and ${FAKE.aws}`);
    expect(out).not.toMatch(/ant-api03|abcdefghijklmnop|ABCDEFGHIJKLMNOP/);
    expect(red.counts().credential).toBe(3);
  });

  it("removes assignments such as api_key=..., password: ... and PEM headers", () => {
    const red = r();
    const out = red.clean(`${FAKE.assignKey} ${FAKE.assignPw} ${FAKE.pem}`);
    expect(out).not.toMatch(/hunter2|correcthorse|BEGIN RSA/);
    expect(red.counts().credential).toBe(3);
  });

  it("shortens paths: inside home to ~, outside home to the last segment", () => {
    const red = r();
    expect(red.clean(`${FAKE.homeWin}\\work\\repo\\a.ts`)).toBe("~/work/repo/a.ts");
    expect(red.clean(`see ${FAKE.otherUnix}/secret-project/file.txt now`)).toBe("see .../file.txt now");
    expect(red.clean(FAKE.otherWin)).toBe(".../plan.docx");
    expect(red.counts().path).toBe(3);
  });

  it("removes long high-entropy tokens but keeps ordinary long words and hashes", () => {
    const red = r();
    const random = "aZ3kQ9xLp2Vb7NcR4tYw8uJh6GfD5sEm";
    expect(entropy(random)).toBeGreaterThanOrEqual(4.5);
    expect(red.clean(`token ${random} end`)).toBe("token (redacted) end");
    const hex = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(red.clean(hex)).toBe(hex);
    expect(red.clean("internationalization-and-localization")).toBe("internationalization-and-localization");
    expect(red.counts().high_entropy).toBe(1);
  });

  it("handles empty, huge and unicode input", () => {
    const red = r();
    expect(red.clean("")).toBe("");
    expect(red.clean("é".repeat(100_000)).length).toBe(100_000);
    expect(red.clean(`日本語のテキスト ${FAKE.homeUnix}/y`)).toContain("日本語のテキスト");
  });
});

describe("cause-ranked fixes", () => {
  it("percentile uses nearest rank and tolerates an empty list", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([7], 0.9)).toBe(7);
  });

  it("gives an 80% interval only with at least three comparable windows", () => {
    const few = card(history(2, () => 30));
    expect(few.fixes.find((f) => f.cause === "subagents")?.interval).toBeNull();
    expect(few.fixes.find((f) => f.cause === "subagents")?.basis).toBe("heuristic_estimate");
    const many = card(history(FIX_CONFIG.minWindowsForInterval + 3, (w) => 20 + (w % 4) * 10));
    const f = many.fixes.find((x) => x.cause === "subagents")!;
    expect(f.basis).toBe("own_history");
    expect(f.interval).not.toBeNull();
    expect(f.interval!.lowMicros).toBeLessThanOrEqual(f.interval!.highMicros);
    expect(f.windowsUsed).toBeGreaterThanOrEqual(FIX_CONFIG.minWindowsForInterval);
  });

  it("calls out no fix for a cause under 5% of the window", () => {
    const c = card(history(4, () => 0));
    expect(c.fixes.find((f) => f.cause === "subagents")).toBeUndefined();
  });

  it("leaves out sparse windows from the history", () => {
    const calls = [...history(3, () => 0), call({ t: 40 * HOUR }), call({ t: 40 * HOUR + 1_000 })];
    expect(pastWindows(calls, 5, 41 * HOUR)).toHaveLength(3);
  });

  it("ranks a measured fix above an upper bound, and lists no fix with nothing to remove", () => {
    const calls = history(8, (w) => (w === 0 ? 120 : 20));
    const a = buildAutopsy(calls, 0, 5 * HOUR - 1);
    const fixes = rankFixes(a, pastWindows(calls, 5, 40 * HOUR));
    expect(fixes[0]?.cause).toBe("subagents");
    expect(fixes[0]?.interval).not.toBeNull();
    const heuristic = fixes.filter((f) => f.interval === null);
    expect(fixes.findIndex((f) => f.interval === null)).toBeGreaterThan(0);
    for (const f of heuristic) expect(f.basis).toBe("heuristic_estimate");
    const flat = history(8, () => 40);
    const none = rankFixes(buildAutopsy(flat, 0, 5 * HOUR - 1), pastWindows(flat, 5, 40 * HOUR));
    expect(none.find((f) => f.cause === "subagents")).toBeUndefined();
  });
});

describe("the card", () => {
  it("assigns every cause a share and the shares sum to one", () => {
    const c = card(history(5, () => 25));
    expect(c.causes.map((x) => x.cause).sort()).toEqual([...CAUSES].sort());
    expect(c.causes.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(c.causes.reduce((s, x) => s + x.micros, 0)).toBe(c.totals.estimatedMicros);
  });

  it("is the same card every time for the same logs (the figures hash does not move)", () => {
    expect(card(history(5, () => 25)).figuresHash).toBe(card(history(5, () => 25)).figuresHash);
    expect(card(history(5, () => 25)).figuresHash).not.toBe(card(history(5, () => 26)).figuresHash);
  });

  it("always carries the disclosure block and never claims an invoice", () => {
    const c = card(history(5, () => 25));
    const all = c.couldNotKnow.join(" ");
    expect(all).toMatch(/not an invoice/);
    expect(all).toMatch(/NOT VERIFIED/);
    expect(renderCardAnsi(c, { color: false })).toContain("What I could not know");
    expect(renderCardSvg(c)).toContain("WHAT I COULD NOT KNOW");
  });

  it("says when no repository was linked and when models have no price", () => {
    const c = card([...history(5, () => 25), call({ t: 1_000, unpriced: true })], { landingKnown: false });
    expect(c.couldNotKnow.join(" ")).toMatch(/No repository was linked/);
    expect(c.couldNotKnow.join(" ")).toMatch(/no price/);
  });

  it("reports skipped log lines", () => {
    const c = card(history(5, () => 25), { ingest: { ...INPUT.ingest, malformedLines: 4, truncatedTails: 1 } });
    expect(c.couldNotKnow.join(" ")).toMatch(/4 log lines could not be read/);
    expect(c.couldNotKnow.join(" ")).toMatch(/1 log ends in an unfinished line/);
  });

  it("uses the singular for one skipped line, one unfinished log and one unpriced log file", () => {
    const one = card(history(5, () => 25), { ingest: { ...INPUT.ingest, malformedLines: 1, truncatedTails: 1 } });
    expect(one.couldNotKnow.join(" ")).toMatch(/1 log line could not be read/);
    expect(one.couldNotKnow.join(" ")).toMatch(/1 log ends in an unfinished line/);
    const built = buildCard({ calls: [call({ t: 0, unpriced: true })], mode: "own_logs", ...INPUT, ingest: { ...INPUT.ingest, logFilesFound: 1 } });
    if ("empty" in built) expect(built.couldNotKnow[0]).toMatch(/^1 log file was read but none/);
    else throw new Error("expected an empty card");
  });

  it("shows the exact searched paths, shortened, when no logs exist", () => {
    const built = buildCard({ calls: [], mode: "own_logs", ...INPUT, ingest: { ...INPUT.ingest, logFilesFound: 0 } });
    expect("empty" in built).toBe(true);
    if ("empty" in built) {
      expect(built.couldNotKnow[0]).toContain("~/.claude/projects");
      expect(built.couldNotKnow.join(" ")).toMatch(/SAMPLE_MODE=true/);
    }
  });

  it("says so when logs exist but nothing is priced", () => {
    const built = buildCard({ calls: [call({ t: 0, unpriced: true })], mode: "own_logs", ...INPUT });
    expect("empty" in built).toBe(true);
    if ("empty" in built) expect(built.couldNotKnow[0]).toMatch(/none contained a priced model call/);
  });

  it("survives a ledger with hundreds of thousands of calls (a spread over that many arguments overflows the stack)", () => {
    const calls: AutopsyCall[] = [];
    for (let i = 0; i < 300_000; i += 1) calls.push(call({ t: i * 1_000, read: 100, write5m: 10, thread: `t${i % 50}` }));
    const c = card(calls, { days: 4 });
    expect(c.totals.pricedCalls).toBeGreaterThan(0);
  });

  it("redacts a secret that reached a string on the card", () => {
    const c = card(history(5, () => 25), { ingest: { ...INPUT.ingest, searchedPaths: [`${FAKE.homeUnix}/${FAKE.anthropic}`] } });
    const asText = JSON.stringify(c);
    expect(asText).not.toContain("ant-api03");
    expect(asText).not.toContain(FAKE.homeUnix);
  });

  it("makes no network call and imports no network module", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network used");
    });
    const c = card(history(5, () => 25));
    renderCardAnsi(c, { color: true });
    svgToPng(renderCardSvg(c));
    expect(fetchSpy).not.toHaveBeenCalled();
    const dir = join(import.meta.dirname, "..", "..", "src", "desk", "card");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from "node:(?:http|https|net|dns|tls|http2)"|\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });
});

describe("rendering", () => {
  const c = card(history(5, () => 25));

  it("writes a real PNG of the card's width at 1x and 2x", () => {
    const png = svgToPng(renderCardSvg(c));
    expect(Buffer.from(png.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(1200);
    const big = svgToPng(renderCardSvg(c), 2);
    expect(new DataView(big.buffer, big.byteOffset).getUint32(16)).toBe(2400);
  });

  it("renders the same PNG bytes twice (no system fonts, no clock)", () => {
    const a = Buffer.from(svgToPng(renderCardSvg(c))).toString("base64");
    const b = Buffer.from(svgToPng(renderCardSvg(c))).toString("base64");
    expect(a).toBe(b);
  });

  it("escapes markup in text so a hostile string cannot break the SVG", () => {
    const hostile = { ...c, couldNotKnow: ['</text><script>alert(1)</script> & "quotes"'] } as Card;
    const svg = renderCardSvg(hostile);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;/text&gt;");
  });

  it("emits no colour codes when colour is off and some when on", () => {
    expect(renderCardAnsi(c, { color: false })).not.toContain("\u001b[");
    expect(renderCardAnsi(c, { color: true })).toContain("\u001b[");
  });

  it("wraps long text and keeps a word longer than the budget whole", () => {
    expect(wrap("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrap("x".repeat(30), 10)).toEqual(["x".repeat(30)]);
    expect(wrap("", 10)).toEqual([]);
  });
});
