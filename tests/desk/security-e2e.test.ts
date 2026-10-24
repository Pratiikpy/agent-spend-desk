import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import type { ModelPort, ModelRequest, ModelResponse } from "../../src/desk/agents/model.ts";
import { ask } from "../../src/desk/ask/ask.ts";
import { billCommand } from "../../src/desk/bill/command.ts";
import { runCard } from "../../src/desk/card/run.ts";
import { closeCommand } from "../../src/desk/close/command.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir } from "../../src/desk/sample/gen.ts";
import { startUiServer, type UiServer } from "../../src/desk/ui/server.ts";
import { assistantLine } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");
// A fake credential, assembled at run time so that no real-looking secret sits in this file.
const PLANTED = ["sk", "proj", "ZzYyXx0123456789AbCdEfGhIjKlMn"].join("-");
const SESSION = "leaky-session-1";

let dir: string;
let server: UiServer;
let cardText = "";
const written: string[] = [];

function walk(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-sec-e2e-"));
  const sample = join(dir, "sample");
  buildSample({ outDir: sample, seed: 3, months: 0.4, engineers: 4 });
  const logs = sampleLogsDir(sample);
  // One more session whose folder, branch and edited file all carry a credential, as a careless setup can.
  const project = join(logs, "leaky-project");
  mkdirSync(project, { recursive: true });
  const lines = Array.from({ length: 6 }, (_, i) => {
    const o = JSON.parse(assistantLine({ id: `leak-${i}`, session: SESSION, ts: `2026-09-20T10:0${i}:00Z`, output: 4000, tools: ["Edit"], toolInputs: [{ file_path: `/work/app/${PLANTED}.env` }] })) as Record<string, unknown>;
    o["cwd"] = `/work/${PLANTED}`;
    o["gitBranch"] = `hotfix-${PLANTED}`;
    return JSON.stringify(o);
  });
  writeFileSync(join(project, "leak.jsonl"), `${lines.join("\n")}\n`);

  const ledgerPath = join(dir, "ledger.db");
  const outDir = join(dir, "card");
  const r = await runCard({ mode: "own_logs", claudeDir: logs, dbPath: ledgerPath, pricesPath: PRICES, outDir, sampleDir: sample, days: 365, hours: 5, repos: [], color: false });
  cardText = r.text;
  written.push(...walk(outDir), ledgerPath);
  for (const suffix of ["-wal", "-shm"]) {
    try {
      statSync(ledgerPath + suffix);
      written.push(ledgerPath + suffix);
    } catch {
      /* no such file */
    }
  }
  server = await startUiServer({ pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, extra: { dossiersDir: join(dir, "none"), pendingDir: join(dir, "none"), memoryDir: join(dir, "memory"), tracesDir: join(dir, "traces") } as never, ledgerPath, mode: "own_logs" });
}, 240_000);

afterAll(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a credential planted in a log appears nowhere the product writes or serves", () => {
  it("is not in the card text, the card files or the ledger file", () => {
    expect(cardText).not.toContain(PLANTED);
    expect(written.length).toBeGreaterThan(2);
    for (const f of written) expect(readFileSync(f).includes(Buffer.from(PLANTED)), f).toBe(false);
    // The run did read the planted session: it is in the ledger, with the credential masked.
    expect(readFileSync(written[written.length - 1] as string).includes(Buffer.from("leaky-session-1"))).toBe(true);
  });

  it("is not in any screen the interface serves, nor in the session that held it", async () => {
    const paths = ["/api/meta", "/api/brief", "/api/bill", "/api/autopsy", "/api/sessions?sort=cost&limit=200", `/api/session?id=${SESSION}`, "/api/outcomes", "/api/sources", "/api/evidence", "/api/silos"];
    let seenSession = false;
    for (const p of paths) {
      const res = await fetch(`${server.origin}${p}`, { headers: { "x-desk-token": TOKEN } });
      const text = await res.text();
      expect(text, p).not.toContain(PLANTED);
      if (p.startsWith("/api/session?") && text.includes(SESSION)) seenSession = true;
    }
    expect(seenSession).toBe(true);
  });
});

describe("and in nothing it exports, signs or traces", () => {
  it("is not in the bill exports, in CSV or in JSON", () => {
    const db = openLedger(join(dir, "ledger.db"));
    try {
      for (const exportAs of ["csv", "json"] as const) {
        const r = billCommand({ db, snapshot: loadSnapshot(PRICES), mode: "own_logs", exportAs, out: join(dir, `bill.${exportAs}`) } as never);
        expect(r.ok, r.text).toBe(true);
        const file = readFileSync(join(dir, `bill.${exportAs}`), "utf8");
        expect(file.length).toBeGreaterThan(100);
        expect(file).not.toContain(PLANTED);
        expect(r.text).not.toContain(PLANTED);
      }
    } finally {
      db.close();
    }
  });

  it("is not in the signed month dossier, which holds the rows its figures come from", async () => {
    const dossierDir = join(dir, "dossiers");
    const r = await closeCommand({
      dbPath: join(dir, "ledger.db"), pricesPath: PRICES, pricesDir: "data/prices", month: "2026-09", now: new Date("2026-10-05T00:00:00Z"), sign: true, askApproval: false,
      canaryRunsPath: join(dir, "no-canary.jsonl"), sample: false, dossierDir, keyPath: join(dir, "key.json"), propose: { sampleMode: true } as never,
    });
    expect(r.text).not.toContain(PLANTED);
    const files = walk(dossierDir);
    expect(files.length, r.text).toBeGreaterThan(0);
    // The closed month is the one that holds the planted session's calls, so the dossier was built from a ledger that carried the credential in its source text.
    const db = openLedger(join(dir, "ledger.db"));
    try {
      const held = db.prepare("SELECT COUNT(*) n FROM model_call WHERE session_id = ? AND ts LIKE '2026-09%'").get(SESSION) as { n: number };
      expect(held.n).toBe(6);
    } finally {
      db.close();
    }
    for (const f of files) expect(readFileSync(f).includes(Buffer.from(PLANTED)), f).toBe(false);
  });

  it("is not in an answer from Ask, in the trace it wrote, or in the other screens", async () => {
    const q = encodeURIComponent("Which project spent the most, and on which branch?");
    for (const path of [`/api/ask?q=${q}`, "/api/overhead", "/api/week", "/api/policy", "/api/canary", "/api/dossiers", "/api/sources"]) {
      const res = await fetch(`${server.origin}${path}`, { headers: { "x-desk-token": TOKEN } });
      const text = await res.text();
      expect(res.status, path).toBeLessThan(500);
      expect(text, path).not.toContain(PLANTED);
    }
  });

  it("is not in the trace of an Ask run, nor in any request that run made to a model", async () => {
    const db = openLedger(join(dir, "ledger.db"));
    try {
      const requests: string[] = [];
      const port: ModelPort = {
        async complete(r: ModelRequest): Promise<ModelResponse> {
          requests.push(JSON.stringify(r));
          return { content: "", toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: null };
        },
      };
      const trace = new MemoryTrace();
      const r = await ask({ db, question: "Which project spent the most, and on which branch?", port, trace, record: false });
      expect(requests.length).toBeGreaterThan(0); // the planner was asked, so the planning request is what was checked
      expect(JSON.stringify(r)).not.toContain(PLANTED);
      expect(JSON.stringify(trace.events)).not.toContain(PLANTED);
      expect(requests.join(" ")).not.toContain(PLANTED);
      expect(trace.events.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
