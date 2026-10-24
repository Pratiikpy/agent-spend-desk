import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCard } from "../../src/desk/card/run.ts";
import { assistantLine } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "desk-card-progress-"));
  const logs = join(dir, "logs", "p");
  mkdirSync(logs, { recursive: true });
  const lines = Array.from({ length: 12 }, (_, i) => assistantLine({ id: `m${i}`, session: "s1", ts: `2026-10-20T10:${String(i).padStart(2, "0")}:00Z`, output: 2000, read: 50_000, model: "claude-opus-5" }));
  writeFileSync(join(logs, "a.jsonl"), `${lines.join("\n")}\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const options = (extra: object = {}) => ({ mode: "own_logs" as const, claudeDir: join(dir, "logs"), dbPath: join(dir, "ledger.db"), pricesPath: PRICES, outDir: join(dir, "card"), sampleDir: join(dir, "sample"), days: 365, hours: 5, repos: [], color: false, ...extra });

describe("the card tells a person what it is doing while it reads a large history", () => {
  it("says how many log files it found, that it is reading them, and when it is building the card, in that order", async () => {
    const said: string[] = [];
    await runCard(options({ onProgress: (m: string) => said.push(m) }));
    expect(said.length).toBeGreaterThanOrEqual(3);
    expect(said[0]).toMatch(/1 log file/);
    expect(said[0]).toContain(join(dir, "logs"));
    expect(said.some((m) => /reading/i.test(m))).toBe(true);
    expect(said[said.length - 1]).toMatch(/building the card/i);
    expect(said.join("\n")).not.toMatch(/\bsk-[A-Za-z0-9]{10,}|api[_-]?key/i);
  });

  it("works the same with no progress function, and names the size that makes the first read slow", async () => {
    const quiet = await runCard(options({ dbPath: join(dir, "ledger2.db"), outDir: join(dir, "card2") }));
    expect(quiet.text.length).toBeGreaterThan(0);
    const said: string[] = [];
    await runCard(options({ dbPath: join(dir, "ledger3.db"), outDir: join(dir, "card3"), onProgress: (m: string) => said.push(m) }));
    expect(said.join(" ")).toMatch(/first read|can take/i);
  });
});
