import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "docs/verification/clean-room";
const logs = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".log")) : [];

describe("the clean-room logs the README points to", () => {
  it("has at least one log for each of the two systems it names", () => {
    expect(logs.some((f) => f.includes("windows"))).toBe(true);
    expect(logs.some((f) => f.includes("ubuntu"))).toBe(true);
  });

  for (const f of logs) {
    const text = readFileSync(`${DIR}/${f}`, "utf8");
    it(`${f}: names a commit that exists, typechecked clean, passed the suite and every prove check`, () => {
      const commit = text.match(/^HEAD ([0-9a-f]{7,40})$/m)?.[1];
      expect(commit, "the log's first line is the commit the clone was made at").toBeDefined();
      // A commit in this repository's history. Skipped where the history is shallow.
      let known = true;
      try {
        execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
      } catch {
        known = (execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() === "true");
      }
      expect(known, `commit ${commit} is not in this repository`).toBe(true);
      expect(text).toContain("TSC OK");
      expect(text).toMatch(/^VITEST EXIT 0$/m);
      expect(text).toMatch(/^PROVE EXIT 0$/m);
      expect(text).toMatch(/^\d+ PASS, 0 FAIL, 0 NOT RUN\./m);
      expect(text).toMatch(/Tests\s+\d+ passed/);
      expect(text).not.toMatch(/\u001b\[/); // no colour codes
    });
  }
});
