import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashModels, parseSnapshot, type PriceRow, type PriceSnapshot } from "../../src/desk/pricing/pricebook.ts";

export const OPUS5: PriceRow = {
  inputPerMTokMicros: 5_000_000,
  outputPerMTokMicros: 25_000_000,
  cacheReadPerMTokMicros: 500_000,
  cacheWrite5mPerMTokMicros: 6_250_000,
  cacheWrite1hPerMTokMicros: 10_000_000,
};

export const SONNET55: PriceRow = {
  inputPerMTokMicros: 2_000_000,
  outputPerMTokMicros: 10_000_000,
  cacheReadPerMTokMicros: 100_000,
  cacheWrite5mPerMTokMicros: 2_500_000,
  cacheWrite1hPerMTokMicros: 4_000_000,
};

export function testSnapshot(): PriceSnapshot {
  const models = { "claude-opus-5": OPUS5, "claude-sonnet-5-5": SONNET55 };
  return parseSnapshot({
    snapshotId: "test-snapshot",
    source: "test",
    sourceUrl: "https://example.invalid/prices.json",
    fetchedAt: "2026-10-22T00:00:00.000Z",
    license: "test",
    upstreamSha256: "0".repeat(64),
    note: "test prices",
    contentHash: hashModels(models),
    models,
  });
}

export interface LineOptions {
  id: string;
  block?: number;
  session?: string;
  ts?: string;
  model?: string;
  input?: number;
  output?: number;
  read?: number;
  write5m?: number;
  write1h?: number;
  thinking?: number;
  tools?: string[];
  sidechain?: boolean;
  omitCacheSplit?: boolean;
}

/** One log line in the structure real Claude Code session logs have (checked on a real log). */
export function assistantLine(o: LineOptions): string {
  const write5m = o.write5m ?? 0;
  const write1h = o.write1h ?? 0;
  const usage: Record<string, unknown> = {
    input_tokens: o.input ?? 0,
    cache_creation_input_tokens: write5m + write1h,
    cache_read_input_tokens: o.read ?? 0,
    output_tokens: o.output ?? 0,
    output_tokens_details: { thinking_tokens: o.thinking ?? 0 },
    service_tier: "standard",
    speed: "standard",
  };
  if (!o.omitCacheSplit) {
    usage["cache_creation"] = { ephemeral_5m_input_tokens: write5m, ephemeral_1h_input_tokens: write1h };
  }
  const content = (o.tools ?? []).map((name) => ({ type: "tool_use", id: `tu_${name}`, name, input: {} }));
  if (content.length === 0) content.push({ type: "text" as "tool_use", id: "", name: "", input: {} });
  return JSON.stringify({
    parentUuid: null,
    isSidechain: o.sidechain ?? false,
    type: "assistant",
    uuid: `${o.id}-${o.block ?? 0}`,
    timestamp: o.ts ?? "2026-10-20T10:00:00.000Z",
    sessionId: o.session ?? "sess-1",
    requestId: `req_${o.id}`,
    apiBlockIndex: o.block ?? 0,
    cwd: "/work/project",
    gitBranch: "main",
    version: "9.9.9",
    message: {
      id: o.id,
      type: "message",
      role: "assistant",
      model: o.model ?? "claude-opus-5",
      stop_reason: "end_turn",
      content,
      usage,
    },
  });
}

export class TempDir {
  readonly path = mkdtempSync(join(tmpdir(), "desk-test-"));
  file(name: string, lines: readonly string[], trailingNewline = true): string {
    const p = join(this.path, name);
    writeFileSync(p, lines.join("\n") + (trailingNewline && lines.length > 0 ? "\n" : ""));
    return p;
  }
  append(path: string, lines: readonly string[], trailingNewline = true): void {
    appendFileSync(path, lines.join("\n") + (trailingNewline ? "\n" : ""));
  }
  dispose(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}
