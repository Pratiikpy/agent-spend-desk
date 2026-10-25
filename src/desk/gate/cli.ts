import { branchTaskType } from "../autonomy/branch.ts";
import { DEFAULT_ATTENTION } from "./attention.ts";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseOrUsage, UsageError } from "../args.ts";

import { loadDotenv } from "../env.ts";
import { estimateFromLedger } from "../estimate/from-ledger.ts";
import { openLedger } from "../ledger/db.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { parseVirtualPrices, withVirtualPrices } from "../pricing/virtual.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { Gate } from "./gate.ts";
import { GateError } from "./types.ts";
import { saveCapture } from "../capture/gateway.ts";
import { openCapture } from "../capture/store.ts";
import { startGateway } from "../gateway/server.ts";
import { installHook } from "./install.ts";
import { HOOK_TOOLS, isHookTool } from "./tools.ts";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { profileOf } from "../security/net.ts";
import { startGateServer } from "./http.ts";
import { serveMcp } from "./mcp.ts";
import { filePolicy } from "./policy-source.ts";

const DEFAULT_DB = "data/desk/gate.db";
const DEFAULT_PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const DEFAULT_PORT = 8765;
const DEFAULT_GATEWAY_PORT = 8766;
const DEFAULT_SHADOW = "7d";
const DEFAULT_HANDOFF_DIR = "data/desk/handoffs";

const USAGE = `Use: gate serve|gateway|mcp|hook|open|close|status|integrity|checkpoints|resume [options]
  serve      --policy FILE [--db FILE] [--prices FILE] [--port N] [--shadow-for 7d|0] [--person NAME] [--transcript-root DIR]... [--max-agents 4] [--max-questions 10] [--no-attention]
             a new agent is refused when its person already has --max-agents working or has been asked --max-questions in the last hour (--no-attention turns that off)
             needs DESK_GATE_TOKEN (at least 16 characters); DESK_GATE_OWNER_TOKEN enables approve, switch, pause on the owner routes
  gateway    --upstream URL --policy FILE [--db FILE] [--prices FILE] [--port N] [--shadow-for 7d|0] [--person NAME] [--reserve MODEL=USD]... [--capture FILE [--keep-text]]
             an OpenAI-compatible and Anthropic-compatible door: point an agent's base URL at it; each chat completion or message is reserved before it is sent and settled after.
             --price MODEL=IN,OUT sets a price (dollars per million tokens) for a model with none, so caps count its tokens; --reserve gives
             such a model a flat reservation per call instead. The caller's own key is passed on; nothing else is stored.
             --capture FILE keeps each session's tool calls and their results in the capture store at FILE as a trajectory, redacted, for desk trajectories and desk swap
             (--keep-text keeps the redacted text of inputs and results, not only their hashes).
  mcp        --policy FILE [--db FILE] [--prices FILE] [--person NAME]   MCP over stdio (advisory tools)
  hook       --tool claude-code|codex|cursor|gemini-cli [--scope user|project] [--config FILE] [--install]
             says whether the tool's own config holds the Desk's blocking hook, and with --install adds it beside what is there. A hook is not enforced until desk enforcement test passes.
  open       --for 30m          owner only: open the emergency switch (signed with DESK_GATE_OWNER_TOKEN)
  close                          close the emergency switch
  status     [--db FILE]         switch, paused people, budgets, integrity
  integrity  [--db FILE]         recompute I-R1 to I-R5 and the hash chain; exits 1 on any violation
  checkpoints [--db FILE]        sessions stopped for a checkpoint, with where each handoff is to be written
  resume     --session ID [--extend-usd N --for 1h --reason "..."] [--no-handoff]
             owner only: resume a stopped session. If its cap still binds, an extension (headroom for a limited time, signed with DESK_GATE_OWNER_TOKEN) is needed.
  Where handoffs go: --handoff-dir DIR (default data/desk/handoffs).`;

/** A whole number of at least one: a limit of nothing would refuse every agent, which is what `--no-attention` is for. */
function wholeAtLeast1(text: string | undefined, flag: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} is a whole number of at least 1, not ${JSON.stringify(text)}`);
  return n;
}

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

const GATE_OPTIONS = {
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
  ledger: { type: "string" },
  session: { type: "string" },
  "extend-usd": { type: "string" },
  reason: { type: "string" },
  "no-handoff": { type: "boolean", default: false },
  "handoff-dir": { type: "string", default: DEFAULT_HANDOFF_DIR },
  "no-attention": { type: "boolean", default: false },
  "max-agents": { type: "string", default: String(DEFAULT_ATTENTION.maxConcurrent) },
  "max-questions": { type: "string", default: String(DEFAULT_ATTENTION.maxInterruptionsPerHour) },
  tool: { type: "string" },
  scope: { type: "string", default: "user" },
  config: { type: "string" },
  install: { type: "boolean", default: false },
  capture: { type: "string" },
  "keep-text": { type: "boolean", default: false },
} as const;

const parseGateArgs = (rest: readonly string[]) => parseOrUsage({ args: [...rest], options: GATE_OPTIONS, allowPositionals: false });

/** Run a `gate` subcommand. Returns the process exit code. */
export async function runGateCli(argv: readonly string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  if (argv.length === 0 || argv[0] === "help") {
    console.error(USAGE);
    return argv.length === 0 ? 2 : 0;
  }
  const [command, ...rest] = argv;
  let values: ReturnType<typeof parseGateArgs>["values"];
  try {
    values = parseGateArgs(rest).values;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`desk gate: ${e.message}. "desk gate help" prints the usage.`);
    return 2;
  }
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
      ...(values["no-attention"] ? {} : { attention: { maxConcurrent: wholeAtLeast1(values["max-agents"], "--max-agents"), maxInterruptionsPerHour: wholeAtLeast1(values["max-questions"], "--max-questions") } }),
      handoffDir: values["handoff-dir"] ?? DEFAULT_HANDOFF_DIR,
      taskTypeOf: branchTaskType,
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
    case "hook": {
      if (values.tool === undefined || !isHookTool(values.tool)) {
        console.error(`--tool is one of ${HOOK_TOOLS.join(", ")}`);
        return 2;
      }
      if (values.scope !== "user" && values.scope !== "project") {
        console.error("--scope is user or project");
        return 2;
      }
      const r = installHook({ tool: values.tool, scope: values.scope, home: homedir(), cwd: process.cwd(), ...(values.config ? { config: values.config } : {}), hookMain: fileURLToPath(new URL("./hook-main.ts", import.meta.url)), write: values.install });
      console.log(r.message);
      console.log(`The hook runs: ${r.command}`);
      return r.state === "unreadable" ? 1 : 0;
    }
    case "gateway": {
      if (values.upstream === undefined) {
        console.error("--upstream URL is required, for example https://api.openai.com/v1");
        return 2;
      }
      const gate = makeGate(true);
      gate.currentPolicy(); // refuse to start on a policy that cannot be read
      const sink = values.capture !== undefined ? openCapture(values.capture) : null;
      const running = await startGateway({
        upstream: values.upstream,
        gate,
        prices: priceBook(),
        port: Number(values.port === String(DEFAULT_PORT) ? DEFAULT_GATEWAY_PORT : values.port),
        profile: profileOf(process.env),
        ...(sink !== null ? { capture: (c) => void saveCapture(sink, c, { keep: values["keep-text"] }) } : {}),
      });
      console.error(`desk gateway listening on ${running.url} (loopback only), forwarding to ${values.upstream}; db ${dbPath}; policy ${values.policy}`);
      console.error(`Point an agent at it, for example: OPENAI_BASE_URL=${running.url}`);
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      const st = running.stats();
      await running.close();
      sink?.close();
      console.error(`gateway stopped: ${st.seen} requests, ${st.controlled} metered (${st.allowed} allowed, ${st.denied} refused, ${st.failedClosed} failed closed), ${st.unmetered} reads passed through, ${st.unmeteredRefused} unmeterable writes refused`);
      return 0;
    }
    case "mcp": {
      const gate = makeGate(true);
      // The usage ledger, when there is one, lets an agent ask what a task like this has cost before.
      const ledgerPath = values.ledger ?? "data/desk/ledger.db";
      const ctx = existsSync(ledgerPath) ? { estimate: estimateFromLedger(openLedger(ledgerPath)) } : {};
      await serveMcp(gate, process.stdin, process.stdout, ctx);
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
      const stopped = gate.openCheckpoints();
      console.log(`checkpoints: ${stopped.length === 0 ? "none open" : `${stopped.length} session${stopped.length === 1 ? "" : "s"} stopped, see: desk gate checkpoints`}`);
      const behind = gate.clockBehindMs();
      if (behind > 0) console.log(`clock: ${Math.round(behind / 1000)} s behind the last recorded event, so the gate holds its own time until the clock catches up`);
      if (values.person !== undefined) {
        const a = gate.supervisionLoad(values.person);
        console.log(a === null ? `attention (${values.person}): the governor is off (--no-attention)` : `attention (${values.person}): ${a.activeSessions.length} of ${a.limits.maxConcurrent} agents working, ${a.interruptions} of ${a.limits.maxInterruptionsPerHour} questions in the last hour; a new agent would take the load to ${Math.round(a.load * 100)}% (${a.level})`);
      }
      console.log(`integrity: ${violations.length === 0 ? "ok" : `${violations.length} violation(s)`}`);
      for (const v of violations.slice(0, 5)) console.log(`  ${v.invariant} event ${String(v.eventId)}: ${v.message}`);
      return violations.length === 0 ? 0 : 1;
    }
    case "checkpoints": {
      const gate = makeGate(false);
      const open = gate.openCheckpoints();
      if (open.length === 0) {
        console.log("no session is stopped for a checkpoint");
        return 0;
      }
      for (const c of open) console.log(`checkpoint ${c.id}  session ${c.session_id}  ${c.person}${c.project ? ` in ${c.project}` : ""}  ${c.created_at}\n  why: ${c.reason}\n  handoff: ${c.handoff_path}`);
      return 0;
    }
    case "resume": {
      if (values.session === undefined) {
        console.error('Use: gate resume --session ID [--extend-usd N --for 1h --reason "..."] [--no-handoff]');
        return 2;
      }
      const gate = makeGate(true);
      const usd = values["extend-usd"];
      let extendMicros: number | undefined;
      if (usd !== undefined) {
        const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usd.trim());
        if (m === null) {
          console.error(`cannot read --extend-usd "${usd}" as dollars; use 25 or 25.50`);
          return 2;
        }
        extendMicros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
      }
      try {
        const r = gate.resumeCheckpoint({
          session: values.session,
          owner: env["USERNAME"] ?? env["USER"] ?? "owner",
          ...(extendMicros !== undefined ? { extendMicros } : {}),
          ...(values.for !== undefined ? { extendMs: parseDuration(values.for) } : {}),
          ...(values.reason !== undefined ? { reason: values.reason } : {}),
          withoutHandoff: values["no-handoff"] === true,
        });
        console.log(`resumed checkpoint ${r.checkpointId} for session ${r.sessionId} (signed event ${r.eventId}); handoff ${r.handoff.written ? `written (${r.handoff.sha256?.slice(0, 12)})` : "not written, resumed without it as asked"}`);
        if (r.extension) console.log(`extension: ${(r.extension.headroomMicros / 1_000_000).toFixed(2)} USD of headroom on ${r.extension.dims.join(", ")} until ${r.extension.expiresAt}`);
        return 0;
      } catch (e) {
        if (e instanceof GateError) {
          console.error(`${e.code}: ${e.message}`);
          return 1;
        }
        throw e;
      }
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
