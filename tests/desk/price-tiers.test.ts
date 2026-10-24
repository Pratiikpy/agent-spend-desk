import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { listPriceCost } from "../../src/desk/cost/cost.ts";
import { applyTiers, hashModels, loadSnapshot, parseSnapshot, promptTokens, type PriceRow } from "../../src/desk/pricing/pricebook.ts";
import { testSnapshot } from "./helpers.ts";

// Anthropic's pricing page for Claude Haiku 5.5, read 2026-10-24: $0.10 in, $0.50 out, $0.125 / $0.20 cache writes (5m / 1h) and
// $0.01 cache reads per million tokens for prompts up to 100,000 tokens, and $0.50, $2.50, $0.625, $1.00, $0.05 above that.
const SHORT = { inputPerMTokMicros: 100_000, outputPerMTokMicros: 500_000, cacheReadPerMTokMicros: 10_000, cacheWrite5mPerMTokMicros: 125_000, cacheWrite1hPerMTokMicros: 200_000 };
const LONG = { inputPerMTokMicros: 500_000, outputPerMTokMicros: 2_500_000, cacheReadPerMTokMicros: 50_000, cacheWrite5mPerMTokMicros: 625_000, cacheWrite1hPerMTokMicros: 1_000_000 };
const HAIKU: PriceRow = { ...SHORT, longPrompt: { overPromptTokens: 100_000, ...LONG } };

const tokens = (o: Partial<Record<"inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWrite5mTokens" | "cacheWrite1hTokens", number>>) => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, ...o });

describe("prompt length", () => {
  it("counts every input token of a request: fresh input, cache reads and both kinds of cache write", () => {
    expect(promptTokens(tokens({ inputTokens: 5, cacheReadTokens: 90_000, cacheWrite5mTokens: 3_000, cacheWrite1hTokens: 2_000, outputTokens: 999_999 }))).toBe(95_005);
  });
});

describe("a model priced by prompt length", () => {
  it("uses the short prices at exactly 100,000 prompt tokens and the long prices above it", () => {
    const at = listPriceCost(tokens({ cacheReadTokens: 100_000, outputTokens: 1_000_000 }), HAIKU);
    expect(at.totalMicros).toBe(100_000 * 10_000 / 1_000_000 + 500_000); // $0.001 read + $0.50 output
    const over = listPriceCost(tokens({ cacheReadTokens: 100_001, outputTokens: 1_000_000 }), HAIKU);
    expect(over.totalMicros).toBe(Math.round((100_001 * 50_000) / 1_000_000) + 2_500_000); // $0.005 read + $2.50 output
  });

  it("includes cache reads and writes in the prompt length, as the pricing page says, so a mostly cached request can still cross the line", () => {
    const small = listPriceCost(tokens({ inputTokens: 50, cacheReadTokens: 99_000, outputTokens: 2_000 }), HAIKU);
    const crossed = listPriceCost(tokens({ inputTokens: 50, cacheReadTokens: 99_000, cacheWrite5mTokens: 1_000, outputTokens: 2_000 }), HAIKU);
    expect(small.totalMicros).toBe(Math.round((50 * 100_000 + 99_000 * 10_000 + 2_000 * 500_000) / 1_000_000));
    expect(crossed.totalMicros).toBe(Math.round((50 * 500_000 + 99_000 * 50_000 + 1_000 * 625_000 + 2_000 * 2_500_000) / 1_000_000));
    expect(crossed.totalMicros).toBeGreaterThan(small.totalMicros * 4);
  });

  it("prices each request on its own: the tier is chosen per call, not per session", () => {
    const calls = [tokens({ cacheReadTokens: 120_000, outputTokens: 1_000 }), tokens({ cacheReadTokens: 10_000, outputTokens: 1_000 })];
    const total = calls.reduce((s, c) => s + listPriceCost(c, HAIKU).totalMicros, 0);
    const flatShort = calls.reduce((s, c) => s + listPriceCost(c, { ...SHORT }).totalMicros, 0);
    expect(total).toBeGreaterThan(flatShort);
    expect(listPriceCost(calls[1]!, HAIKU).totalMicros).toBe(listPriceCost(calls[1]!, { ...SHORT }).totalMicros);
  });

  it("keeps the components summing to the total in the long tier", () => {
    const r = listPriceCost(tokens({ inputTokens: 123, outputTokens: 4_567, cacheReadTokens: 150_000, cacheWrite1hTokens: 2_000 }), HAIKU);
    const c = r.components;
    expect(c.input + c.output + c.cacheRead + c.cacheWrite5m + c.cacheWrite1h).toBe(r.totalMicros);
  });

  it("leaves a model without tiers exactly as it was", () => {
    const flat: PriceRow = { ...SHORT };
    expect(listPriceCost(tokens({ cacheReadTokens: 5_000_000, outputTokens: 1_000_000 }), flat).totalMicros).toBe(Math.round((5_000_000 * 10_000) / 1_000_000) + 500_000);
  });
});

describe("a snapshot with tiers", () => {
  const snap = () => {
    const base = testSnapshot();
    const models = { ...base.models, "claude-haiku-5-5": HAIKU };
    return { ...base, models, contentHash: hashModels(models) };
  };

  it("round-trips through parsing, and the tier is part of the content hash", () => {
    const parsed = parseSnapshot(snap());
    expect(parsed.models["claude-haiku-5-5"]?.longPrompt).toEqual({ overPromptTokens: 100_000, ...LONG });
    const without = { ...snap().models, "claude-haiku-5-5": { ...SHORT } };
    expect(hashModels(without)).not.toBe(hashModels(snap().models));
  });

  it("refuses a tier with a bad threshold or a missing price", () => {
    const bad = (longPrompt: unknown) => {
      const s = snap();
      const models = { ...s.models, "claude-haiku-5-5": { ...SHORT, longPrompt } as PriceRow };
      return () => parseSnapshot({ ...s, models, contentHash: hashModels(models) });
    };
    expect(bad({ overPromptTokens: 0, ...LONG })).toThrow(/overPromptTokens/);
    expect(bad({ overPromptTokens: 1.5, ...LONG })).toThrow(/overPromptTokens/);
    expect(bad({ overPromptTokens: 100_000, ...LONG, outputPerMTokMicros: -1 })).toThrow(/outputPerMTokMicros/);
    expect(bad("long")).toThrow(/longPrompt/);
  });

  it("adds the tiers from a supplement to a snapshot, under a new id and hash, naming where they came from", () => {
    const base = parseSnapshot(testSnapshot());
    const out = applyTiers(base, {
      supplementId: "official-tiers-test",
      source: "Anthropic pricing page, read 2026-10-24",
      sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
      fetchedAt: "2026-10-24T10:00:00.000Z",
      pageSha256: "a".repeat(64),
      tiers: { "claude-opus-5": { overPromptTokens: 200_000, ...LONG } },
    });
    expect(out.snapshotId).toBe(`${base.snapshotId}+official-tiers-test`);
    expect(out.contentHash).not.toBe(base.contentHash);
    expect(out.models["claude-opus-5"]?.longPrompt?.overPromptTokens).toBe(200_000);
    expect(out.note).toMatch(/Anthropic pricing page, read 2026-10-24/);
    expect(out.upstreamSha256).toBe(base.upstreamSha256);
    expect(parseSnapshot(JSON.parse(JSON.stringify(out))).contentHash).toBe(out.contentHash);
  });

  it("refuses a supplement that names a model the snapshot does not price", () => {
    expect(() => applyTiers(parseSnapshot(testSnapshot()), { supplementId: "x", source: "s", sourceUrl: "u", fetchedAt: "t", pageSha256: "b".repeat(64), tiers: { "claude-nonexistent": { overPromptTokens: 1, ...LONG } } })).toThrow(/claude-nonexistent/);
  });
});

describe("the live snapshot", () => {
  it("prices Haiku 5.5 by prompt length and every other model exactly as the dated sample snapshot does", () => {
    const live = loadSnapshot("data/prices/anthropic-2026-10-24.json");
    const old = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");
    expect(live.models["claude-haiku-5-5"]?.longPrompt).toEqual({ overPromptTokens: 100_000, ...LONG });
    for (const [name, row] of Object.entries(old.models)) {
      const { longPrompt, ...flat } = live.models[name] ?? ({} as PriceRow);
      if (name === "claude-haiku-5-5") expect(longPrompt).toBeDefined();
      expect(flat, name).toEqual(row);
    }
    expect(Object.keys(live.models).sort()).toEqual(Object.keys(old.models).sort());
  });

  it("is a file whose content hash holds, and whose provenance is stated", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-tiers-"));
    try {
      const raw = JSON.parse(readFileSync("data/prices/anthropic-2026-10-24.json", "utf8")) as { note: string; source: string };
      expect(raw.note).toMatch(/Prompt-length tiers from Anthropic pricing page/);
      expect(raw.source).toMatch(/pricing page/);
      writeFileSync(join(dir, "edited.json"), JSON.stringify({ ...raw, note: raw.note, models: { ...(raw as unknown as { models: object }).models, "claude-haiku-5-5": SHORT } }));
      expect(() => loadSnapshot(join(dir, "edited.json"))).toThrow(/contentHash/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
