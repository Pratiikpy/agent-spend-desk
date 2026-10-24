import { createHash } from "node:crypto";

import { vendorOf } from "../billing/import.ts";
import type { Ledger } from "../ledger/db.ts";

/**
 * The Desk's own record as OpenTelemetry GenAI spans (DF-022), so that any trace tool can read what the Desk read. One span per session
 * and, beneath it, one span per call. The calls carry the tokens, the model and the cost; the session span carries none of it, because
 * a cost on a parent and on its children would be counted twice by anything that adds spans up.
 *
 * Attributes in the `desk.*` namespace: `desk.cost.estimated_usd`, `desk.cost.class` and `desk.cost.snapshot_id` on a call;
 * `desk.cost.reported_usd` where a source reported a cost; `desk.task.id` and `desk.outcome.state` on the session span and its calls.
 * Two attributes the specification names are NOT emitted, because nothing in the ledger holds them: `desk.budget.reservation_id` (the gate
 * keeps its own record) and `desk.retry_of` (the logs do not say which call retried which).
 */
type Attr = { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number } };
const s = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });
const i = (key: string, v: number): Attr => ({ key, value: { intValue: String(v) } });
const d = (key: string, v: number): Attr => ({ key, value: { doubleValue: v } });

const hex = (text: string, n: number): string => createHash("sha256").update(text).digest("hex").slice(0, n);
const nano = (iso: string): string => String(BigInt(Date.parse(iso)) * 1_000_000n);

export interface OtelExport {
  doc: { resourceSpans: unknown[] };
  sessions: number;
  calls: number;
}

export function exportOtel(db: Ledger, sinceIso: string, untilIso: string): OtelExport {
  const calls = db
    .prepare(
      `SELECT m.call_id id, m.session_id session, m.ts, m.model, m.input_tokens i, m.output_tokens o, m.cache_read_tokens cr, m.cache_write_5m_tokens + m.cache_write_1h_tokens cw,
              c.class cls, c.total_micros micros, c.snapshot_id snap, r.amount_micros reported, ss.tool tool, ss.project_path project, t.task_id task, o.state outcome
       FROM model_call m JOIN session ss ON ss.session_id = m.session_id LEFT JOIN cost_event c ON c.call_id = m.call_id
       LEFT JOIN call_reported_cost r ON r.call_id = m.call_id LEFT JOIN task_session t ON t.session_id = m.session_id LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts <= ? ORDER BY m.session_id, m.ts, m.call_id`,
    )
    .all(sinceIso, untilIso) as unknown as { id: string; session: string; ts: string; model: string; i: number; o: number; cr: number; cw: number; cls: string | null; micros: number | null; snap: string | null; reported: number | null; tool: string; project: string | null; task: string | null; outcome: string | null }[];
  const bySession = new Map<string, typeof calls>();
  for (const c of calls) bySession.set(c.session, [...(bySession.get(c.session) ?? []), c]);
  const spans: unknown[] = [];
  for (const [session, list] of bySession) {
    const first = list[0]!;
    const trace = hex(session, 32);
    const root = hex(`root:${session}`, 16);
    const rootAttrs: Attr[] = [s("gen_ai.operation.name", "invoke_agent"), s("gen_ai.agent.name", first.tool), s("gen_ai.conversation.id", session)];
    if (first.task) rootAttrs.push(s("desk.task.id", first.task));
    if (first.outcome) rootAttrs.push(s("desk.outcome.state", first.outcome));
    spans.push({ traceId: trace, spanId: root, parentSpanId: "", name: "desk.session", kind: 1, startTimeUnixNano: nano(first.ts), endTimeUnixNano: nano(list[list.length - 1]!.ts), flags: 1, attributes: rootAttrs });
    for (const c of list) {
      const provider = vendorOf(c.model, undefined);
      // Anthropic's convention keeps cache tokens out of the input count; everyone else's includes them.
      const apart = provider === "anthropic";
      const attrs: Attr[] = [s("gen_ai.operation.name", "chat"), s("gen_ai.request.model", c.model), s("gen_ai.response.model", c.model), s("gen_ai.conversation.id", session)];
      if (provider) attrs.push(s("gen_ai.provider.name", provider));
      attrs.push(i("gen_ai.usage.input_tokens", apart ? c.i : c.i + c.cr + c.cw), i("gen_ai.usage.output_tokens", c.o));
      if (c.cr > 0) attrs.push(i("gen_ai.usage.cache_read.input_tokens", c.cr));
      if (c.cw > 0) attrs.push(i("gen_ai.usage.cache_creation.input_tokens", c.cw));
      if (c.cls === "estimated" && c.micros !== null) attrs.push(d("desk.cost.estimated_usd", c.micros / 1_000_000), s("desk.cost.class", "estimated"));
      else if (c.cls === "unpriced") attrs.push(s("desk.cost.class", "unpriced"));
      if (c.snap) attrs.push(s("desk.cost.snapshot_id", c.snap));
      if (c.reported !== null) attrs.push(d("desk.cost.reported_usd", c.reported / 1_000_000));
      if (c.task) attrs.push(s("desk.task.id", c.task));
      if (c.outcome) attrs.push(s("desk.outcome.state", c.outcome));
      spans.push({ traceId: trace, spanId: hex(c.id, 16), parentSpanId: root, name: `chat ${c.model}`, kind: 3, startTimeUnixNano: nano(c.ts), endTimeUnixNano: nano(c.ts), flags: 1, attributes: attrs });
    }
  }
  const resource = { attributes: [s("service.name", "desk")] };
  return { doc: { resourceSpans: [{ resource, scopeSpans: [{ scope: { name: "desk.export", version: "1" }, spans }] }] }, sessions: bySession.size, calls: calls.length };
}
