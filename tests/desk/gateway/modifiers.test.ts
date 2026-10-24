import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { startGateway, type Gateway } from "../../../src/desk/gateway/server.ts";
import { applyModifiers } from "../../../src/desk/pricing/pricebook.ts";
import { rig, type Rig } from "../gate/harness.ts";
import { testSnapshot } from "../helpers.ts";

// Opus 5 at the test prices is $5 in and $25 out per million tokens. Here it also has fast mode ($10 and $50) and the US-only multiplier.
const prices = () =>
  applyModifiers(testSnapshot(), {
    supplementId: "mods",
    source: "test",
    sourceUrl: "https://example.invalid",
    fetchedAt: "2026-10-24T00:00:00.000Z",
    pageSha256: "0".repeat(64),
    fast: { "claude-opus-5": { inputPerMTokMicros: 10_000_000, outputPerMTokMicros: 50_000_000 } },
    usOnly: ["claude-opus-5"],
  });

const open: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!.close();
});

async function setup(): Promise<{ g: Gateway; r: Rig; upstreamCalls: () => number }> {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "x", object: "chat.completion", model: "claude-opus-5", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  open.push({ close: () => new Promise<void>((r) => server.close(() => r())) });
  const r = rig({ prices: prices() });
  const g = await startGateway({ upstream: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, gate: r.gate, prices: prices() });
  open.push(g);
  return { g, r, upstreamCalls: () => calls };
}

const send = (g: Gateway, extra: Record<string, unknown> = {}, maxTokens = 100_000): Promise<Response> =>
  fetch(`${g.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k" }, body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }], max_tokens: maxTokens, ...extra }) });
const spent = (r: Rig): number => r.gate.budgetLeft({ person: "p-1" }).standing.find((s) => s.window === "day")!.spentMicros;

describe("the gateway and the modifiers a request asks for", () => {
  it("settles an ordinary request at the standard price", async () => {
    const { g, r } = await setup();
    expect((await send(g)).status).toBe(200);
    expect(spent(r)).toBe(17_500);
  });

  it("settles a fast-mode request at the fast price: 1,000 in and 500 out is $0.035, not $0.0175", async () => {
    const { g, r } = await setup();
    expect((await send(g, { speed: "fast" })).status).toBe(200);
    expect(spent(r)).toBe(35_000);
  });

  it("settles a US-only request at 1.1x, and a request that is both at fast times 1.1", async () => {
    const a = await setup();
    await send(a.g, { inference_geo: "us" });
    expect(spent(a.r)).toBe(19_250);
    const b = await setup();
    await send(b.g, { speed: "fast", inference_geo: "us" });
    expect(spent(b.r)).toBe(38_500);
  });

  it("does not take a global or unknown geography for US-only", async () => {
    const { g, r } = await setup();
    await send(g, { inference_geo: "global" });
    expect(spent(r)).toBe(17_500);
  });

  it("reserves what the request asked for: a call that fits at the standard price is refused when it is fast", async () => {
    const standard = await setup();
    // 250,000 output tokens reserve $6.25 at $25 per million: inside the $10 day cap.
    expect((await send(standard.g, {}, 250_000)).status).toBe(200);
    const fast = await setup();
    // The same request in fast mode reserves $12.50 at $50 per million: over the cap, so it is refused and never sent.
    const refused = await send(fast.g, { speed: "fast" }, 250_000);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(fast.upstreamCalls()).toBe(0);
    expect(spent(fast.r)).toBe(0);
  });
});
