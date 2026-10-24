import { priceCall } from "../cost/price-call.ts";
import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { BudgetError } from "./budget.ts";
import type { ModelRequest } from "./model.ts";
import type { OwnCall, OwnCallSink } from "./own-calls.ts";

export interface OwnLedgerOptions {
  /** The most the Desk's own calls may cost in one UTC day, in micro-dollars. Unset: no limit, and the bill still shows them. Read at each call, so a setting loaded later counts. */
  dailyCapMicros?: number | null | (() => number | null);
  /** The model the port is configured with, to price a call before it is made. Unknown: the reservation is zero and the call is not refused. */
  configuredModel?: () => string | null;
  now?: () => Date;
}

/** A rough upper bound on a request's prompt, in tokens: three characters to a token, which over-counts ordinary English. */
function worstCaseTokens(request: ModelRequest): { input: number; output: number } {
  const chars = JSON.stringify(request.messages).length + (request.tools ? JSON.stringify(request.tools).length : 0);
  return { input: Math.ceil(chars / 3), output: request.maxTokens ?? 1024 };
}

const dayStart = (d: Date): string => `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;

/** The sink that writes the Desk's own calls to the ledger, priced like any other call. */
export function ledgerSink(db: Ledger, snapshot: PriceSnapshot | null, opts: OwnLedgerOptions = {}): OwnCallSink {
  const now = opts.now ?? (() => new Date());
  const insert = db.prepare(
    `INSERT INTO desk_call (ts, role, served_model, served_by, source, input_tokens, output_tokens, reasoning_tokens, ms, ok, error, class, total_micros, snapshot_id, unpriced_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const spentToday = (): number => {
    const r = db.prepare("SELECT COALESCE(SUM(total_micros), 0) AS m FROM desk_call WHERE ts >= ? AND class = 'estimated'").get(dayStart(now())) as { m: number };
    return Number(r.m);
  };
  return {
    reserve(request: ModelRequest): void {
      const cap = typeof opts.dailyCapMicros === "function" ? opts.dailyCapMicros() : opts.dailyCapMicros;
      if (cap === undefined || cap === null || snapshot === null) return;
      const model = opts.configuredModel?.() ?? null;
      if (model === null) return;
      const w = worstCaseTokens(request);
      const p = priceCall(snapshot, { model, tokens: { inputTokens: w.input, outputTokens: w.output, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, speed: null, inferenceGeo: null });
      // A model with no price is counted and not refused: the Desk's own free-tier calls must not be denied for having no price.
      if (p.kind !== "priced") return;
      const spent = spentToday();
      if (spent + p.totalMicros > cap) {
        throw new BudgetError("own_spend", `today's own model calls cost ${formatUsd(spent)} and this one could cost up to ${formatUsd(p.totalMicros)}, past the limit of ${formatUsd(cap)}`);
      }
    },
    record(c: OwnCall): void {
      // A reply replayed from a recording sent nothing and cost nothing: it is not a call on the bill, and writing it would only fill the ledger.
      if (c.source === "cassette") return;
      let klass = "unpriced";
      let micros: number | null = null;
      let snapshotId: string | null = null;
      let reason: string | null = null;
      if (!c.ok) {
        reason = "the call failed; whether it was billed is unknown";
      } else if (snapshot === null || c.servedModel === null || c.inputTokens === null || c.outputTokens === null) {
        reason = c.inputTokens === null ? "the reply carried no token counts" : "no price list or no served model";
      } else {
        // Reasoning tokens are part of the completion count an OpenAI-compatible endpoint reports, so they are priced inside the output.
        const p = priceCall(snapshot, { model: c.servedModel, tokens: { inputTokens: c.inputTokens, outputTokens: c.outputTokens, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }, speed: null, inferenceGeo: null });
        snapshotId = snapshot.snapshotId;
        if (p.kind === "priced") {
          klass = "estimated";
          micros = p.totalMicros;
        } else reason = `no price for this model (${p.reason})`;
      }
      // The sink's own clock stamps the row when one was given (a test), so that "today" is the same day for the limit and for the rows it counts.
      insert.run(opts.now ? opts.now().toISOString() : c.ts, c.role, c.servedModel, c.servedBy, c.source, c.inputTokens, c.outputTokens, c.reasoningTokens, Math.round(c.ms), c.ok ? 1 : 0, c.error, klass, micros, snapshotId, reason);
    },
  };
}
