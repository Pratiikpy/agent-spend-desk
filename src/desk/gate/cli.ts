import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { loadDotenv } from "../env.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { parseVirtualPrices, withVirtualPrices } from "../pricing/virtual.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { Gate } from "./gate.ts";
import { startGateway } from "../gateway/server.ts";
import { startGateServer } from "./http.ts";
import { serveMcp } from "./mcp.ts";
import { filePolicy } from "./policy-source.ts";

const DEFAULT_DB = "data/desk/gate.db";
const DEFAULT_PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const DEFAULT_PORT = 8765;
const DEFAULT_GATEWAY_PORT = 8766;
const DEFAULT_SHADOW = "7d";

const USAGE = `Use: gate serve|gateway|mcp|open|close|status|integrity [options]
  serve      --policy FILE [--db FILE] [--prices FILE] [--port N] [--shadow-for 7d|0] [--person NAME] [--transcript-root DIR]...
             needs DESK_GATE_TOKEN (at least 16 characters); DESK_GATE_OWNER_TOKEN enables approve, switch, pause on the owner routes
  gateway    --upstream URL --policy FILE [--db FILE] [--prices FILE] [--port N] [--shadow-for 7d|0] [--person NAME] [--reserve MODEL=USD]...
             an OpenAI-compatible and Anthropic-compatible door: point an agent's base URL at it; each chat completion or message is reserved before it is sent and settled after.
             --price MODEL=IN,OUT sets a price (dollars per million tokens) for a model with none, so caps count its tokens; --reserve gives
             such a model a flat reservation per call instead. The caller's own key is passed on; nothing else is stored.
  mcp        --policy FILE [--db FILE] [--prices FILE] [--person NAME]   MCP over stdio (advisory tools)
  open       --for 30m          owner only: open the emergency switch (signed with DESK_GATE_OWNER_TOKEN)
  close                          close the emergency switch
  status     [--db FILE]         switch, paused people, budgets, integrity
  integrity  [--db FILE]         recompute I-R1 to I-R5 and the hash chain; exits 1 on any violation`;

/** "30m", "2h", "45s", "7d" or a bare number of milliseconds. */
export function parseDuration(text: string): number {
  const m = /^(\d+)(ms|s|m|h|d)?$/.exec(text.trim());
  if (m === null) throw new Error(`cannot read "${text}" as a duration; use 30s, 30m, 2h or 7d`);
  const n = Number(m[1]);
  const unit = m[2] ?? "ms";
  const mult = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path);
}

/** "model=0.05" pairs: a flat reservation in dollars for a model the price book cannot price. */
function flatReserves(pairs: readonly string[] | undefined): Record<string, number> | undefined {
  if (pairs === undefined || pairs.length === 0) return undefined;
  const out: Record<string, number> = {};
  for (const pair of pairs) {
    const m = /^(.+)=(\d+(?:\.\d{1,6})?)$/.exec(pair);
    if (m === null) throw new Error(`cannot read --reserve "${pair}"; use MODEL=USD, for example nvidia/nemotron=0.05`);
    out[m[1] as string] = Math.round(Number(m[2]) * 1_000_000);
  }
  return out;
}

/** Run a `gate` subcommand. Returns the process exit code. */
export async function runGateCli(argv: readonly string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  if (argv.length === 0 || argv[0] === "help") {
    console.error(USAGE);
    return argv.length === 0 ? 2 : 0;
  }
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: [...rest],
    options: {
      policy: { type: "string" },
      db: { type: "string", default: DEFAULT_DB },
      prices: { type: "string", default: DEFAULT_PRICES },
      port: { type: "string", default: String(DEFAULT_PORT) },
      "shadow-for": { type: "string", default: DEFAULT_SHADOW },
      person: { type: "string" },
      "transcript-root": { type: "string", multiple: true },
      for: { type: "string" },
      upstream: { type: "string" },
      reserve: { type: "string", multiple: true },
      price: { type: "string", multiple: true },
    },
    allowPositionals: false,
  });
  loadDotenv(".env", env);
  const dbPath = values.db ?? DEFAULT_DB;

  const priceBook = () => withVirtualPrices(loadSnapshot(values.prices ?? DEFAULT_PRICES), parseVirtualPrices(values.price));
  const makeGate = (needPolicy: boolean): Gate => {
    if (needPolicy && values.policy === undefined) throw new Error("--policy FILE is required");
    const trace = new MemoryTrace(env["DESK_GATE_TRACE"]);
    return new Gate({
      db: openDb(dbPath),
      prices: priceBook(),
      policy: filePolicy(values.policy ?? "policies/none.yaml"),
      shadowMs: parseDuration(values["shadow-for"] ?? DEFAULT_SHADOW),
      ...(env["DESK_GATE_OWNER_TOKEN"] !== undefined ? { ownerKey: env["DESK_GATE_OWNER_TOKEN"] } : {}),
      ...(values.person !== undefined ? { person: values.person } : {}),
      ...(values["transcript-root"] !== undefined ? { transcriptRoots: values["transcript-root"] } : {}),
      ...(flatReserves(values.reserve) !== undefined ? { unpricedReserveMicros: flatReserves(values.reserve) as Record<string, number> } : {}),
      trace,
    });
  };

  switch (command) {
    case "serve": {
      const token = env["DESK_GATE_TOKEN"];
      if (token === undefined || token.length < 16) {
        console.error("DESK_GATE_TOKEN must be set to at least 16 characters; the gate will not start open.");
        return 2;
      }
      const gate = makeGate(true);
      gate.currentPolicy(); // refuse to start on a policy that cannot be read
      const running = await startGateServer({ gate, token, ...(env["DESK_GATE_OWNER_TOKEN"] !== undefined ? { ownerToken: env["DESK_GATE_OWNER_TOKEN"] } : {}), port: Number(values.port) });
      console.error(`desk gate listening on ${running.url} (loopback only); db ${dbPath}; policy ${values.policy}`);
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      await running.close();
      return 0;
    }
    case "gateway": {
      if (values.upstream === undefined) {
        console.error("--upstream URL is required, for example https://api.openai.com/v1");
        return 2;
      }
      const gate = makeGate(true);
      gate.currentPolicy(); // refuse to start on a policy that cannot be read
      const running = await startGateway({ upstream: values.upstream, gate, prices: priceBook(), port: Number(values.port === String(DEFAULT_PORT) ? DEFAULT_GATEWAY_PORT : values.port) });
      console.error(`desk gateway listening on ${running.url} (loopback only), forwarding to ${values.upstream}; db ${dbPath}; policy ${values.policy}`);
      console.error(`Point an agent at it, for example: OPENAI_BASE_URL=${running.url}`);
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      const st = running.stats();
      await running.close();
      console.error(`gateway stopped: ${st.seen} requests, ${st.controlled} metered (${st.allowed} allowed, ${st.denied} refused, ${st.failedClosed} failed closed), ${st.unmetered} reads passed through, ${st.unmeteredRefused} unmeterable writes refused`);
      return 0;
    }
    case "mcp": {
      const gate = makeGate(true);
      await serveMcp(gate, process.stdin, process.stdout);
      return 0;
    }
    case "open": {
      if (values.for === undefined) {
        console.error("Use: gate open --for 30m");
        return 2;
      }
      const gate = makeGate(false);
      const row = gate.openBypass(parseDuration(values.for), env["USERNAME"] ?? env["USER"] ?? "owner");
      console.log(`emergency switch open until ${row.expires_at} (signed event ${row.id}); every call it lets through is logged as bypass_allowed`);
      return 0;
    }
    case "close": {
      const gate = makeGate(false);
      const row = gate.closeBypass(env["USERNAME"] ?? env["USER"] ?? "owner");
      console.log(`emergency switch closed (event ${row.id})`);
      return 0;
    }
    case "status": {
      const gate = makeGate(false);
      const b = gate.bypassOpen();
      const violations = gate.integrity();
      const state = JSON.parse(gate.ledger.projectionJson()) as { budgets: unknown[]; paused: string[]; eventCount: number; open: unknown[] };
      console.log(`switch: ${b.open ? `OPEN until ${b.expiresAt}` : b.reason}`);
      console.log(`events: ${state.eventCount}, open reservations: ${state.open.length}, paused: ${state.paused.join(", ") || "none"}`);
      const behind = gate.clockBehindMs();
      if (behind > 0) console.log(`clock: ${Math.round(behind / 1000)} s behind the last recorded event, so the gate holds its own time until the clock catches up`);
      console.log(`integrity: ${violations.length === 0 ? "ok" : `${violations.length} violation(s)`}`);
      for (const v of violations.slice(0, 5)) console.log(`  ${v.invariant} event ${String(v.eventId)}: ${v.message}`);
      return violations.length === 0 ? 0 : 1;
    }
    case "integrity": {
      const gate = makeGate(false);
      const violations = gate.integrity();
      if (violations.length === 0) {
        console.log("integrity: ok (I-R1 to I-R5 and the hash chain recomputed from the events)");
        return 0;
      }
      for (const v of violations) console.log(`${v.invariant} event ${String(v.eventId)}: ${v.message}`);
      return 1;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}
