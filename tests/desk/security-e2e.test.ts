import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCard } from "../../src/desk/card/run.ts";
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
    const o = JSON.parse(assistantLine({ id: `leak-${i}`, session: SESSION, ts: `2026-10-20T10:0${i}:00Z`, output: 4000, tools: ["Edit"], toolInputs: [{ file_path: `/work/app/${PLANTED}.env` }] })) as Record<string, unknown>;
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
