import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ladder, readResults, recordResults, renderLadder, TOOLS, type SurfaceResult } from "../../src/desk/enforce/ladder.ts";
import { testGatewayDoor, testHookContract } from "../../src/desk/enforce/selftest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-enforce-"));
  dirs.push(d);
  return d;
};

const res = (over: Partial<SurfaceResult> = {}): SurfaceResult => ({ surface: "hook", mode: "contract", tool: null, toolVersion: null, testedAt: "2026-10-25T10:00:00.000Z", passed: true, checks: [], ...over });
const by = (rows: ReturnType<typeof ladder>, tool: string) => rows.find((r) => r.tool === tool)!;

describe("the enforcement ladder", () => {
  it("calls nothing enforced before it has been tested", () => {
    const rows = ladder([]);
    for (const r of rows) expect(r.level).not.toBe("enforced");
    expect(by(rows, "claude_code")).toMatchObject({ level: "advisory" });
    expect(by(rows, "claude_code").reason).toContain("declared, not tested: advisory, not tested");
  });

  it("calls a hook that passed only a contract test advisory, not tested", () => {
    const row = by(ladder([res({ surface: "hook", mode: "contract" })]), "claude_code");
    expect(row.level).toBe("advisory");
    expect(row.reason).toContain("has not been run live against the tool: advisory, not tested");
  });

  it("calls a hook enforced only when the real tool was run and a refused call did not run", () => {
    const live = res({ surface: "hook", mode: "live", tool: "claude_code", toolVersion: "2.1.308" });
    const row = by(ladder([live], { claude_code: "2.1.308" }), "claude_code");
    expect(row.level).toBe("enforced");
    expect(row.reason).toContain("enforced: a PreToolUse hook");
    expect(row.reason).toContain("run live against Claude Code 2.1.308 on 2026-10-25");
    expect(row.surfaces.find((s) => s.surface === "hook")!.level).toBe("enforced");
  });

  it("turns a tool back to advisory when it has changed version since it was tested", () => {
    const live = res({ surface: "hook", mode: "live", tool: "claude_code", toolVersion: "2.1.308" });
    const row = by(ladder([live], { claude_code: "2.2.0" }), "claude_code");
    expect(row.level).toBe("advisory");
    expect(row.reason).toContain("passed live on Claude Code 2.1.308, but this machine runs 2.2.0: advisory until it is run again");
  });

  it("does not take a failed live test for evidence, and says which checks failed", () => {
    const live = res({ surface: "hook", mode: "live", tool: "claude_code", toolVersion: "2.1.308", passed: false, checks: [{ name: "with a policy that refuses, the call is blocked", passed: false, detail: "the command ran" }] });
    const row = by(ladder([live], { claude_code: "2.1.308" }), "claude_code");
    expect(row.level).toBe("advisory");
    expect(row.reason).toContain("FAILED (with a policy that refuses, the call is blocked)");
  });

  it("accepts a live result when the installed version is not known, rather than refusing the evidence", () => {
    const live = res({ surface: "hook", mode: "live", tool: "claude_code", toolVersion: "2.1.308" });
    expect(by(ladder([live], {}), "claude_code").level).toBe("enforced");
  });

  it("keeps a gateway door tested without the tool advisory: the door is not the tool", () => {
    const row = by(ladder([res({ surface: "gateway_anthropic", mode: "contract" })]), "opencode");
    expect(row.level).toBe("advisory");
    expect(row.reason).toContain("the anthropic door refuses over-cap calls (tested 2026-10-25), but OpenCode has not been run through it: advisory, not tested");
  });

  it("calls a tool enforced through a gateway door only when that tool was run through it", () => {
    const run = res({ surface: "gateway_openai", mode: "live", tool: "cline", toolVersion: null });
    expect(by(ladder([run]), "cline").level).toBe("enforced");
    expect(by(ladder([run]), "opencode").level).toBe("advisory"); // another tool, another door
  });

  it("says notify only for a tool with no hook, no gateway path and no MCP, with the reason", () => {
    const cursor = by(ladder([]), "cursor");
    expect(cursor.level).toBe("notify_only");
    expect(cursor.reason).toMatch(/^notify only: a hosted IDE agent/);
    expect(cursor.reason).toContain("Caps on it produce notices and month-end findings only.");
    expect(cursor.surfaces).toEqual([]);
  });

  it("does not claim a gateway for a tool whose traffic the gateway cannot meter", () => {
    const codex = by(ladder([res({ surface: "gateway_openai", mode: "contract" })]), "codex");
    expect(codex.surfaces.map((s) => s.surface)).toEqual(["mcp"]);
    expect(codex.reason).toContain("Responses API");
  });

  it("names every tool once, each with a reason", () => {
    const rows = ladder([]);
    expect(rows.map((r) => r.tool)).toEqual(TOOLS.map((t) => t.tool));
    expect(new Set(rows.map((r) => r.tool)).size).toBe(rows.length);
    for (const r of rows) expect(r.reason.length).toBeGreaterThan(20);
  });

  it("prints a line per tool and says what enforced needs", () => {
    const text = renderLadder(ladder([]));
    expect(text).toContain("Claude Code");
    expect(text).toContain("notify only");
    expect(text).toContain('"Enforced" needs a recorded test');
  });
});

describe("the recorded results", () => {
  it("keeps the newest result of each surface and mode, and survives a missing or damaged file", () => {
    const path = join(tmp(), "e", "enforcement.json");
    expect(readResults(path)).toEqual({ version: 1, results: [] });
    recordResults(path, [res({ testedAt: "2026-10-24T00:00:00.000Z", passed: false })]);
    recordResults(path, [res({ testedAt: "2026-10-25T00:00:00.000Z", passed: true }), res({ surface: "gateway_openai" })]);
    const r = readResults(path);
    expect(r.results).toHaveLength(2);
    expect(r.results.find((x) => x.surface === "hook")).toMatchObject({ passed: true, testedAt: "2026-10-25T00:00:00.000Z" });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
    const damaged = join(tmp(), "bad.json");
    recordResults(damaged, []);
    expect(readResults(damaged).results).toEqual([]);
  });
});

describe("the surface tests", () => {
  const prices = loadSnapshot(PRICES);

  it("pass for the hook and both gateway doors against the Desk's own gate", async () => {
    const hook = await testHookContract(prices);
    expect(hook.checks.filter((c) => !c.passed)).toEqual([]);
    expect(hook).toMatchObject({ surface: "hook", mode: "contract", passed: true });
    for (const door of ["openai", "anthropic"] as const) {
      const r = await testGatewayDoor(prices, door);
      expect(r.checks.filter((c) => !c.passed)).toEqual([]);
      expect(r.surface).toBe(door === "openai" ? "gateway_openai" : "gateway_anthropic");
      expect(r.checks).toHaveLength(3);
    }
  }, 60_000);

  it("fail when the gate does not enforce, so that a pass means something", async () => {
    const permitAll = "version: 1\nrules:\n  - id: allow-all\n    kind: permit\n    when: {}\n";
    const hook = await testHookContract(prices, { policyYaml: permitAll });
    expect(hook.passed).toBe(false);
    expect(hook.checks.find((c) => c.name === "a call over the cap is blocked")!.passed).toBe(false);
    const door = await testGatewayDoor(prices, "openai", { policyYaml: permitAll });
    expect(door.passed).toBe(false);
    expect(door.checks.find((c) => c.name.startsWith("a call over the cap is refused"))!.passed).toBe(false);
  }, 60_000);
});
