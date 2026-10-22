import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findJsonlLogs } from "../../src/desk/ingest/discover.ts";
import { TempDir } from "./helpers.ts";

let dir: TempDir;
beforeEach(() => {
  dir = new TempDir();
});
afterEach(() => dir.dispose());

describe("log discovery", () => {
  it("finds logs at every depth, including nested workflow subagent logs, and ignores other files", () => {
    const deep = join(dir.path, "proj", "sess", "subagents", "workflows", "wf_1");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(dir.path, "proj", "a.jsonl"), "");
    writeFileSync(join(dir.path, "proj", "sess", "subagents", "agent-b.jsonl"), "");
    writeFileSync(join(deep, "agent-c.jsonl"), "");
    writeFileSync(join(dir.path, "proj", "notes.txt"), "");
    const found = findJsonlLogs(dir.path).map((p) => p.slice(dir.path.length + 1).replaceAll("\\", "/"));
    expect(found).toEqual(["proj/a.jsonl", "proj/sess/subagents/agent-b.jsonl", "proj/sess/subagents/workflows/wf_1/agent-c.jsonl"]);
  });

  it("returns an empty list for a missing or empty directory", () => {
    expect(findJsonlLogs(join(dir.path, "nope"))).toEqual([]);
    expect(findJsonlLogs(dir.path)).toEqual([]);
  });

  it("does not follow symbolic links", () => {
    mkdirSync(join(dir.path, "real"));
    writeFileSync(join(dir.path, "real", "x.jsonl"), "");
    try {
      symlinkSync(join(dir.path, "real"), join(dir.path, "link"), "junction");
    } catch {
      return; // creating links needs a privilege on some machines: nothing to assert then
    }
    expect(findJsonlLogs(dir.path).filter((p) => p.endsWith("x.jsonl"))).toHaveLength(1);
  });
});
