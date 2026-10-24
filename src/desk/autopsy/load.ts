import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { resolvePrice } from "../pricing/pricebook.ts";
import type { AutopsyCall } from "./engine.ts";

interface CallRow {
  call_id: string;
  source_id: number | null;
  session_id: string;
  ts: string;
  model: string;
  is_sidechain: number;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  class: string | null;
  input_micros: number | null;
  output_micros: number | null;
  cache_read_micros: number | null;
  cache_write_5m_micros: number | null;
  cache_write_1h_micros: number | null;
}

/**
 * Load the calls whose timestamp is in [sinceIso, untilIso] as autopsy inputs. Tool-result sizes are
 * joined to the call whose tools produced them and handed to the next call of the same thread (the
 * call that reads them). Human prompts are looked up per session. Nothing here reads message text.
 */
export function loadAutopsyCalls(db: Ledger, snapshot: PriceSnapshot, sinceIso: string, untilIso: string, only: { sessionId?: string } = {}): AutopsyCall[] {
  // One session's calls only, when asked: a long session's explanation should not read every other session in the same weeks.
  const sid = only.sessionId;
  const sidSql = sid === undefined ? "" : " AND m.session_id = ?";
  const sidArgs = sid === undefined ? [] : [sid];
  const rows = db
    .prepare(
      `SELECT m.call_id, m.source_id, m.session_id, m.ts, m.model, m.is_sidechain, m.stop_reason, m.input_tokens, m.output_tokens, m.reasoning_tokens,
              m.cache_read_tokens, m.cache_write_5m_tokens, m.cache_write_1h_tokens, c.class, c.input_micros, c.output_micros,
              c.cache_read_micros, c.cache_write_5m_micros, c.cache_write_1h_micros
       FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id
       WHERE m.ts >= ? AND m.ts <= ?${sidSql} ORDER BY m.ts`,
    )
    .all(sinceIso, untilIso, ...sidArgs) as unknown as CallRow[];
  if (rows.length === 0) return [];

  const toolsByCall = new Map<string, { name: string; inputHash: string; resultIsError: boolean }[]>();
  const toolRows = db
    .prepare(
      `SELECT t.call_id, t.name, t.input_hash, COALESCE(r.is_error, 0) AS is_error FROM tool_call t
       JOIN model_call m ON m.call_id = t.call_id LEFT JOIN tool_result r ON r.tool_use_id = t.tool_use_id WHERE m.ts >= ? AND m.ts <= ?${sidSql}`,
    )
    .all(sinceIso, untilIso, ...sidArgs) as unknown as { call_id: string; name: string; input_hash: string; is_error: number }[];
  for (const t of toolRows) {
    const list = toolsByCall.get(t.call_id) ?? [];
    list.push({ name: t.name, inputHash: t.input_hash, resultIsError: t.is_error === 1 });
    toolsByCall.set(t.call_id, list);
  }

  const resultCharsByCall = new Map<string, number>();
  const resultRows = db
    .prepare(
      `SELECT t.call_id, SUM(r.result_chars) AS chars FROM tool_call t
       JOIN tool_result r ON r.tool_use_id = t.tool_use_id JOIN model_call m ON m.call_id = t.call_id
       WHERE m.ts >= ? AND m.ts <= ?${sidSql} GROUP BY t.call_id`,
    )
    .all(sinceIso, untilIso, ...sidArgs) as unknown as { call_id: string; chars: number }[];
  for (const r of resultRows) resultCharsByCall.set(r.call_id, r.chars);

  const promptsBySession = new Map<string, number[]>();
  const promptRows = db
    .prepare(`SELECT session_id, ts FROM human_prompt WHERE session_id IN (SELECT DISTINCT m.session_id FROM model_call m WHERE m.ts >= ? AND m.ts <= ?${sidSql}) ORDER BY ts`)
    .all(sinceIso, untilIso, ...sidArgs) as unknown as { session_id: string; ts: string }[];
  for (const p of promptRows) {
    const list = promptsBySession.get(p.session_id) ?? [];
    list.push(Date.parse(p.ts));
    promptsBySession.set(p.session_id, list);
  }

  const lastPromptAtOrBefore = (prompts: number[] | undefined, t: number): number | null => {
    if (!prompts) return null;
    let lo = 0;
    let hi = prompts.length - 1;
    let found: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (prompts[mid]! <= t) {
        found = prompts[mid]!;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };

  const out: AutopsyCall[] = [];
  const prevInThread = new Map<string, { id: string; tsMs: number }>();
  for (const r of rows) {
    const tsMs = Date.parse(r.ts);
    const thread = String(r.source_id ?? r.session_id);
    const prev = prevInThread.get(thread);
    prevInThread.set(thread, { id: r.call_id, tsMs });
    const lastPrompt = lastPromptAtOrBefore(promptsBySession.get(r.session_id), tsMs);
    const humanBefore = prev ? lastPrompt !== null && lastPrompt > prev.tsMs : lastPrompt !== null;
    const resolved = resolvePrice(snapshot, r.model);
    out.push({
      callId: r.call_id,
      threadKey: thread,
      sessionId: r.session_id,
      tsMs,
      model: r.model,
      isSidechain: r.is_sidechain === 1,
      tokens: {
        input: r.input_tokens,
        output: r.output_tokens,
        reasoning: r.reasoning_tokens,
        read: r.cache_read_tokens,
        write5m: r.cache_write_5m_tokens,
        write1h: r.cache_write_1h_tokens,
      },
      readMicrosPerToken: resolved.kind === "priced" ? resolved.row.cacheReadPerMTokMicros / 1_000_000 : undefined,
      micros:
        r.class === "estimated"
          ? {
              input: r.input_micros ?? 0,
              output: r.output_micros ?? 0,
              read: r.cache_read_micros ?? 0,
              write5m: r.cache_write_5m_micros ?? 0,
              write1h: r.cache_write_1h_micros ?? 0,
            }
          : null,
      stopReason: r.stop_reason ?? null,
      tools: toolsByCall.get(r.call_id) ?? [],
      toolResultChars: prev ? (resultCharsByCall.get(prev.id) ?? 0) : 0,
      humanPromptBefore: humanBefore,
      msSinceHumanPrompt: lastPrompt === null ? null : tsMs - lastPrompt,
    });
  }
  return out;
}
