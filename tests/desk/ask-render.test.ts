import { describe, expect, it } from "vitest";

import { renderAnswer } from "../../src/desk/ask/command.ts";
import type { AskResult } from "../../src/desk/ask/ask.ts";
import { MemoryTrace } from "../../src/desk/agents/trace.ts";

const result = { answerId: "ans-1", question: "q", route: "read", flags: [], status: "answered", planner: "model", explainer: "model", servedModel: "nvidia/m", ablated: [], program: null, steps: [], sentences: [{ text: "Spend was $1.00.", cites: [] }], note: null } as unknown as AskResult;

function modelLine(trace: MemoryTrace, detail: Record<string, unknown>): void {
  trace.emit({ event: "desk.model", why: "computed", role: "planner", detail });
}

describe("how an answer says which route served it", () => {
  it("names Nightshift and lists the receipts of the calls it served", () => {
    const trace = new MemoryTrace();
    modelLine(trace, { served_by: "nightshift", nightshift_receipt: "rcpt_req_a1", nightshift_decision: "req_a1" });
    modelLine(trace, { served_by: "nightshift", nightshift_receipt: "rcpt_req_b2" });
    const text = renderAnswer(result, trace);
    expect(text).toContain("served by Meterless Nightshift: 2 model calls, receipts rcpt_req_a1, rcpt_req_b2");
  });

  it("says nothing about Nightshift when no call carried its receipt", () => {
    const trace = new MemoryTrace();
    modelLine(trace, { served_by: "nvidia" });
    modelLine(trace, { served_by: "other" });
    expect(renderAnswer(result, trace)).not.toMatch(/Nightshift/);
  });

  it("counts only the calls that carry a receipt when the route is mixed", () => {
    const trace = new MemoryTrace();
    modelLine(trace, { served_by: "nightshift", nightshift_receipt: "rcpt_req_c3" });
    modelLine(trace, { served_by: "cassette" });
    const text = renderAnswer(result, trace);
    expect(text).toContain("served by Meterless Nightshift: 1 model call, receipts rcpt_req_c3");
  });
});
