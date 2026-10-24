import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { parseOrUsage, UsageError } from "../../src/desk/args.ts";

const OPTIONS = { port: { type: "string" }, yes: { type: "boolean" } } as const;

describe("argument errors", () => {
  it("name an unknown option in one sentence, without Node's advice about positionals", () => {
    let caught: unknown;
    try {
      parseOrUsage({ args: ["--bogus"], options: OPTIONS, allowPositionals: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toBe("unknown option '--bogus'");
  });

  it("name an option that is missing its value", () => {
    expect(() => parseOrUsage({ args: ["--port"], options: OPTIONS })).toThrowError(new UsageError("option '--port <value>' needs a value"));
  });

  it("pass valid arguments through unchanged, with the types parseArgs gives", () => {
    const { values, positionals } = parseOrUsage({ args: ["card", "--port", "80", "--yes"], options: OPTIONS, allowPositionals: true });
    expect(values.port).toBe("80");
    expect(values.yes).toBe(true);
    expect(positionals).toEqual(["card"]);
  });

  it("do not swallow other errors", () => {
    expect(() => parseOrUsage({ args: [], options: { x: { type: "nonsense" } } as never })).toThrowError();
    expect(() => parseOrUsage({ args: [], options: { x: { type: "nonsense" } } as never })).not.toThrowError(UsageError);
  });
});

describe("the desk command line", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", ...args], { encoding: "utf8", timeout: 60_000 });

  it("answers an unknown option with one line and exit code 2, not a stack trace", () => {
    const r = run("card", "--bogus");
    expect(r.status).toBe(2);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("unknown option '--bogus'");
    expect(r.stderr).toContain("desk help");
    expect(r.stderr).not.toMatch(/node:internal|at .*\(/);
  });

  it("answers an unknown option for a gate command the same way", () => {
    const r = run("gate", "status", "--bogus");
    expect(r.status).toBe(2);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("unknown option '--bogus'");
    expect(r.stderr).not.toMatch(/node:internal|at .*\(/);
  });

  it("does not read the person's own log files when asked for the sample", () => {
    const r = run("retention", "--sample");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nothing to check");
    expect(r.stdout).not.toMatch(/log files on disk/);
  });

  it("prints the guide for help, and exits 0", () => {
    const r = run("help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Start here");
  });
});
