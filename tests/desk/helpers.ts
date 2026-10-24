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
  /** Input for each tool in `tools`, in the same order (default `{}`). */
  toolInputs?: unknown[];
  sidechain?: boolean;
  omitCacheSplit?: boolean;
  /** The client version the log line carries (default 9.9.9). */
  version?: string;
  stop?: string;
  /** The agent id a delegated agent writes on every line of its own log. */
  agent?: string;
  /** The folder the session ran in (default /work/project). */
  cwd?: string;
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
  const content = (o.tools ?? []).map((name, i) => ({ type: "tool_use", id: `tu_${o.id}_${i}`, name, input: o.toolInputs?.[i] ?? {} }));
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
    ...(o.agent ? { agentId: o.agent } : {}),
    cwd: o.cwd ?? "/work/project",
    gitBranch: "main",
    version: o.version ?? "9.9.9",
    message: {
      id: o.id,
      type: "message",
      role: "assistant",
      model: o.model ?? "claude-opus-5",
      stop_reason: o.stop ?? "end_turn",
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

export function toolResultLine(o: { toolUseId: string; session?: string; ts?: string; isError?: boolean; chars?: number; blocks?: boolean }): string {
  const body = "x".repeat(o.chars ?? 10);
  return JSON.stringify({
    type: "user",
    isSidechain: false,
    uuid: `res-${o.toolUseId}`,
    timestamp: o.ts ?? "2026-10-20T10:00:01.000Z",
    sessionId: o.session ?? "sess-1",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: o.toolUseId, content: o.blocks ? [{ type: "text", text: body }] : body, is_error: o.isError ?? false }] },
  });
}

export function humanPromptLine(o: { uuid: string; session?: string; ts?: string; sidechain?: boolean; meta?: boolean; blocks?: boolean; empty?: boolean }): string {
  const t = o.empty ? "   " : "please do the thing";
  return JSON.stringify({
    type: "user",
    isSidechain: o.sidechain ?? false,
    isMeta: o.meta ?? false,
    uuid: o.uuid,
    timestamp: o.ts ?? "2026-10-20T10:00:00.000Z",
    sessionId: o.session ?? "sess-1",
    message: { role: "user", content: o.blocks ? [{ type: "text", text: t }] : t },
  });
}
