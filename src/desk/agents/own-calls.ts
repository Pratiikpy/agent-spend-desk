import type { ModelPort, ModelRequest, ModelResponse } from "./model.ts";

/**
 * The Desk's own model calls (DF-077). The Desk spends tokens like any agent: it plans an answer, drafts a policy, runs the canary. Each of those calls is
 * written to the ledger it keeps, priced like any other call, and counted against a daily limit if one is set, so that the tool that watches spend shows its
 * own on the bill. This file is the contract; `own-ledger.ts` is the sink that writes it.
 */
export interface OwnCall {
  ts: string;
  role: string;
  servedModel: string | null;
  servedBy: string | null;
  /** `live` was sent to a model; `cassette` was replayed from a recording and cost nothing. */
  source: "live" | "cassette";
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  ms: number;
  ok: boolean;
  /** A short cleaned reason when the call failed. Never the text of a request or a reply. */
  error: string | null;
}

export interface OwnCallSink {
  /** Called before a call is sent. Throws (`E_BUDGET_EXCEEDED`, own_spend) when the call could pass the daily limit. */
  reserve(request: ModelRequest): void;
  record(call: OwnCall): void;
}

let current: OwnCallSink | null = null;

/** The sink every Desk model call is written to. Unset (the default, and in tests) the calls are not recorded. */
export function setOwnCallSink(sink: OwnCallSink | null): void {
  current = sink;
}

export function ownCallSink(): OwnCallSink | null {
  return current;
}

/**
 * One call to a port outside `callModel` (the canary calls its port directly), written to the ledger the same way: reserved first, recorded after,
 * whether it succeeded or failed.
 */
export async function completeOwn(port: ModelPort, request: ModelRequest, deadlineMs: number): Promise<ModelResponse> {
  const sink = current;
  sink?.reserve(request);
  const started = Date.now();
  const write = (r: ModelResponse | null, e: unknown): void => {
    try {
      sink?.record({
        ts: new Date().toISOString(), role: request.role, servedModel: r?.servedModel ?? null, servedBy: r?.servedBy ?? null, source: r?.source ?? "live",
        inputTokens: r?.usage?.inputTokens ?? null, outputTokens: r?.usage?.outputTokens ?? null, reasoningTokens: r?.usage?.reasoningTokens ?? null,
        ms: Date.now() - started, ok: r !== null,
        error: e === null ? null : (e instanceof Error ? `${e.name}: ${e.message}` : "error").replace(/[^A-Za-z0-9._:@/+ -]/g, "_").slice(0, 160),
      });
    } catch {
      /* a ledger that cannot be written must not stop a call */
    }
  };
  try {
    const r = await port.complete(request, deadlineMs);
    write(r, null);
    return r;
  } catch (e) {
    write(null, e);
    throw e;
  }
}
