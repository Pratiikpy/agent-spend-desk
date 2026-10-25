import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Meterless's own runner, unchanged, pointed at this implementation: it must pass its gate on the regression set it ships, and it must fail when the implementation is made worse.
 * A gate that passed everything would show nothing by passing this one.
 */
const RUNNER = resolve("evals/scout/runner/index.ts");
const IMPL = resolve("src/scout-intent/index.ts");
const work = mkdtempSync(join(tmpdir(), "scout-harness-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const lines = (...l: string[]): string => l.join(String.fromCharCode(10));

function run(impl: string | undefined): { status: number | null; out: string } {
  const env = { ...process.env };
  delete env["SCOUT_IMPL"];
  if (impl) env["SCOUT_IMPL"] = impl;
  const r = spawnSync(process.execPath, ["--import", "tsx", RUNNER], { env, encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe("scout-eval-harness: the Meterless evaluation harness against this implementation", () => {
  it("passes its gate on the regression set it ships", () => {
    const r = run(IMPL);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("intent_top1");
    expect(r.out).not.toContain("Eval gate failed");
  }, 130_000);

  it("fails its gate for an implementation that answers every prompt with the general intent", () => {
    const stub = join(work, "general.mjs");
    writeFileSync(
      stub,
      lines(
        "export class Scout {",
        "  constructor() {}",
        "  async decide() {",
        '    return { traceId: "t", candidates: [{ intent: "GENERAL", score: 1 }], intents: [{ intent: "GENERAL", score: 1 }], band: "high", intent: "GENERAL", parameters: {}, references: {}, risk: { level: "low", flags: [], redactions: [] }, toolPlan: [], latencyMs: 0 };',
        "  }",
        "}",
        "",
      ),
    );
    const r = run(stub);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("Eval gate failed");
  }, 130_000);

  it("fails its gate for an implementation that lets every injection through", () => {
    const stub = join(work, "open.mjs");
    writeFileSync(
      stub,
      lines(
        `import { Scout as Real } from ${JSON.stringify(pathToFileURL(IMPL).href)};`,
        "export class Scout extends Real {",
        "  async decide(i) {",
        "    const d = await super.decide(i);",
        '    return { ...d, risk: { ...d.risk, level: "low", flags: [] } };',
        "  }",
        "}",
        "",
      ),
    );
    const r = run(stub);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("injection_recall");
  }, 130_000);

  it("refuses to run with no implementation named", () => {
    const r = run(undefined);
    expect(r.status).toBe(2);
    expect(r.out).toContain("SCOUT_IMPL is not set");
  }, 60_000);
});
