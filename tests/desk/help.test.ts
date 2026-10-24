import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COMMANDS, commandNames, helpText } from "../../src/desk/help.ts";

const cliSource = readFileSync("src/desk/cli.ts", "utf8");

/** Every command the CLI dispatches on, found in its source. */
function dispatched(): string[] {
  const found = new Set<string>();
  for (const m of cliSource.matchAll(/command === "([a-z-]+)"/g)) found.add(m[1] as string);
  if (/process\.argv\[2\] === "gate"/.test(cliSource)) found.add("gate");
  return [...found];
}

describe("the help text", () => {
  it("lists every command the CLI answers to, so that none is a secret", () => {
    const missing = dispatched().filter((c) => !commandNames().includes(c));
    expect(missing).toEqual([]);
  });

  it("describes no command the CLI does not answer to", () => {
    const extra = commandNames().filter((c) => c !== "help" && !dispatched().includes(c));
    expect(extra).toEqual([]);
  });

  it("gives each command a plain one-line summary and names it once", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of COMMANDS) {
      expect(c.summary.length).toBeGreaterThan(15);
      expect(c.summary.length).toBeLessThan(150);
      expect(c.summary).not.toMatch(/\n/);
    }
  });

  it("starts with what to type first, groups the commands, and says where more is written", () => {
    const text = helpText();
    expect(text).toMatch(/^desk\./);
    expect(text.indexOf("Start here")).toBeGreaterThan(-1);
    expect(text.indexOf("Start here")).toBeLessThan(text.indexOf("Evidence"));
    for (const name of commandNames()) expect(text).toContain(name);
    expect(text).toMatch(/README\.md|docs\/product-description\.md/);
  });

  it("is what the CLI prints for help, and for a command it does not know", () => {
    expect(cliSource).toMatch(/helpText\(\)/);
    expect(cliSource).toMatch(/desk help/);
  });
});
