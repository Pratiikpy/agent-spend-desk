import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { startGateway, type Gateway } from "../../../src/desk/gateway/server.ts";
import { type Rig } from "../gate/harness.ts";
import { testSnapshot } from "../helpers.ts";

export interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
export type Handler = (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;

const open: { close: () => Promise<void> }[] = [];

/** Close every server a test started. Call it from afterEach. */
export async function closeAll(): Promise<void> {
  while (open.length > 0) await open.pop()!.close();
}

/** A stand-in for the model endpoint, recording what it was sent. */
export async function upstream(handler: Handler): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(s);
      handler(req, res, s);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  open.push({ close: () => new Promise<void>((r) => server.close(() => r())) });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

export async function gateway(up: string, r: Rig, over: Record<string, unknown> = {}): Promise<Gateway> {
  const g = await startGateway({ upstream: up, gate: r.gate, prices: testSnapshot(), ...over });
  open.push(g);
  return g;
}

export const dayStanding = (r: Rig) => r.gate.budgetLeft({ person: "p-1" }).standing.find((s) => s.window === "day")!;

export const ONLY_SONNET_POLICY = ["version: 1", "rules:", "  - id: only-sonnet", "    kind: permit", '    when: { model: { in: ["claude-sonnet-5-5"] } }', '    cap: { window: day, max_usd: "10.00", warn_at: 0.5, ask_at: 0.8 }', ""].join("\n");
