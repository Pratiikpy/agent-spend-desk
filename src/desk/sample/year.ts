import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A twelve-month ledger for questions a month of data cannot ask (DF-118), generated from a seed and with its trends planted so that the truth is known before any engine is run:
 *
 * - `claude-opus-5` is used more every month, by at least a sixth over the month before, so its cost rises in every month.
 * - `claude-sonnet-5-5` goes up and down, and in March a burst of two hundred sessions on one day makes March the dearest month of the year by a wide margin, and sonnet the dearest model.
 * - `claude-haiku-5-5` builds up to June and falls away.
 *
 * Sessions are written as the logs Claude Code writes, so the year goes through the same reader as any other ledger.
 */
export const YEAR_SEED = 20261030;
export const YEAR_FROM = "2025-01-01";
export const YEAR_TO = "2025-12-31";

const OPUS = "claude-opus-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

/** Sessions per month, January to December. */
export const PLANTED = {
  opus: [6, 7, 9, 11, 13, 16, 19, 23, 28, 34, 41, 49],
  sonnet: [30, 26, 31, 25, 32, 24, 30, 27, 29, 25, 31, 26],
  haiku: [4, 8, 12, 16, 20, 24, 18, 14, 10, 8, 6, 4],
  /** The burst: this many extra sonnet sessions on this day. */
  burst: { month: 2, day: 12, sessions: 200 },
} as const;

/** Output tokens a call writes, by model, so that a session's cost is known. */
const OUTPUT = { [OPUS]: 4_000, [SONNET]: 6_000, [HAIKU]: 12_000 } as const;
const CALLS = 4;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

function line(o: { id: string; session: string; ts: string; model: string; output: number }): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    uuid: `${o.id}-0`,
    timestamp: o.ts,
    sessionId: o.session,
    requestId: `req_${o.id}`,
    apiBlockIndex: 0,
    cwd: "/work/ledger-year",
    gitBranch: "main",
    version: "year-1",
    message: {
      id: o.id,
      type: "message",
      role: "assistant",
      model: o.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: "" }],
      usage: { input_tokens: 1_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: o.output, service_tier: "standard", speed: "standard", cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } },
    },
  });
}

/** Write twelve monthly log files into `dir` and return their paths, in order. The same seed gives the same files. */
export function writeYearLogs(dir: string, seed: number = YEAR_SEED): string[] {
  mkdirSync(dir, { recursive: true });
  const rand = rng(seed);
  const files: string[] = [];
  for (let m = 0; m < 12; m += 1) {
    const lines: string[] = [];
    const daysInMonth = new Date(Date.UTC(2025, m + 1, 0)).getUTCDate();
    const plan: [string, number][] = [[OPUS, PLANTED.opus[m] as number], [SONNET, PLANTED.sonnet[m] as number], [HAIKU, PLANTED.haiku[m] as number]];
    let serial = 0;
    const session = (model: string, day: number): void => {
      serial += 1;
      const id = `y${pad(m + 1)}-${model.split("-")[1]}-${serial}`;
      const start = Date.UTC(2025, m, day, 9 + Math.floor(rand() * 8), Math.floor(rand() * 40));
      for (let c = 0; c < CALLS; c += 1) {
        lines.push(line({ id: `${id}-c${c}`, session: id, ts: new Date(start + c * 60_000).toISOString(), model, output: OUTPUT[model as keyof typeof OUTPUT] }));
      }
    };
    for (const [model, n] of plan) for (let i = 0; i < n; i += 1) session(model, 1 + Math.floor(rand() * daysInMonth));
    if (m === PLANTED.burst.month) for (let i = 0; i < PLANTED.burst.sessions; i += 1) session(SONNET, PLANTED.burst.day);
    const file = join(dir, `year-${pad(m + 1)}.jsonl`);
    writeFileSync(file, `${lines.join("\n")}\n`);
    files.push(file);
  }
  return files;
}
