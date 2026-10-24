import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ADAPTERS, CAPABILITY_KEYS, discoverSources, NO_ADAPTER, renderSources } from "../../src/desk/adapters/registry.ts";

const tmp = mkdtempSync(join(tmpdir(), "desk-adapters-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function home(name: string): string {
  const h = join(tmp, name);
  mkdirSync(h, { recursive: true });
  return h;
}
const put = (path: string, text = "{}\n"): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

describe("every adapter declares what it can and cannot tell", () => {
  it("states each capability once, with a reason, and no adapter leaves one out", () => {
    expect(ADAPTERS.map((a) => a.id)).toEqual(["claude_code", "codex", "opencode", "litellm", "otel_genai", "statusline"]);
    for (const a of ADAPTERS) {
      expect(Object.keys(a.capabilities).sort(), a.id).toEqual([...CAPABILITY_KEYS].sort());
      for (const k of CAPABILITY_KEYS) {
        expect(["yes", "partial", "no"]).toContain(a.capabilities[k].level);
        expect(a.capabilities[k].note.length, `${a.id}.${k}`).toBeGreaterThan(8);
      }
      if (a.how === "import") expect(a.command, a.id).toMatch(/^desk /);
    }
  });

  it("agrees with what the adapters do where that can be checked", () => {
    const by = Object.fromEntries(ADAPTERS.map((a) => [a.id, a]));
    expect(by["codex"]!.capabilities.plan_limits.level).toBe("yes");
    expect(by["codex"]!.capabilities.cache_split.level).toBe("no");
    expect(by["statusline"]!.capabilities.tokens.level).toBe("no");
    expect(by["statusline"]!.capabilities.plan_limits.level).toBe("yes");
    expect(by["litellm"]!.capabilities.reported_cost.level).toBe("yes");
    expect(by["litellm"]!.capabilities.prompts.level).toBe("no");
    expect(by["otel_genai"]!.capabilities.prompts.level).toBe("no");
  });

  it("names the tools it cannot read, each with its reason, and does not pretend about Copilot", () => {
    expect(NO_ADAPTER.map((n) => n.tool)).toEqual(["Gemini CLI", "Cline", "Cursor", "GitHub Copilot CLI"]);
    expect(NO_ADAPTER.find((n) => n.tool === "GitHub Copilot CLI")!.why).toMatch(/holds turns and no token counts/);
  });
});

describe("looking for sources", () => {
  it("finds each tool where it keeps its files, with the count, the size and when the files changed", () => {
    const h = home("full");
    put(join(h, ".claude", "projects", "a", "one.jsonl"), "x".repeat(2048));
    put(join(h, ".claude", "projects", "a", "sub", "two.jsonl"), "y".repeat(1024));
    put(join(h, ".codex", "sessions", "2026", "10", "r.jsonl"));
    put(join(h, ".local", "share", "opencode", "opencode.db"), "db");
    put(join(h, ".desk", "statusline.jsonl"));
    const d = discoverSources({}, h);
    const found = (id: string) => d.sources.find((s) => s.adapter.id === id)!.found;
    expect(found("claude_code")).toHaveLength(1);
    expect(found("claude_code")[0]).toMatchObject({ files: 2, bytes: 3072 });
    expect(found("claude_code")[0]!.changedFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(found("codex")[0]).toMatchObject({ files: 1 });
    expect(found("opencode")[0]).toMatchObject({ files: 1, bytes: 2 });
    expect(found("statusline")[0]).toMatchObject({ files: 1 });
    expect(found("litellm")).toEqual([]); // read on import: there is nothing to find
  });

  it("looks in every place Claude Code may keep its logs, and obeys CLAUDE_CONFIG_DIR with several entries", () => {
    const h = home("config");
    const a = join(tmp, "cfg-a");
    const b = join(tmp, "cfg-b");
    put(join(a, "projects", "p", "x.jsonl"));
    put(join(b, "projects", "p", "y.jsonl"));
    const d = discoverSources({ CLAUDE_CONFIG_DIR: `${a},${b}` }, h);
    const cc = d.sources.find((s) => s.adapter.id === "claude_code")!;
    expect(cc.searched).toEqual([join(a, "projects"), join(b, "projects")]);
    expect(cc.found.map((f) => f.files)).toEqual([1, 1]);
    const plain = discoverSources({}, h).sources.find((s) => s.adapter.id === "claude_code")!;
    expect(plain.searched).toEqual([join(h, ".claude", "projects"), join(h, ".config", "claude", "projects")]);
  });

  it("honours CODEX_HOME and XDG_DATA_HOME", () => {
    const h = home("env");
    const codex = join(tmp, "codex-home");
    const xdg = join(tmp, "xdg");
    put(join(codex, "sessions", "r.jsonl"));
    put(join(xdg, "opencode", "opencode.db"));
    const d = discoverSources({ CODEX_HOME: codex, XDG_DATA_HOME: xdg }, h);
    expect(d.sources.find((s) => s.adapter.id === "codex")!.found[0]!.path).toBe(join(codex, "sessions"));
    expect(d.sources.find((s) => s.adapter.id === "opencode")!.found[0]!.path).toBe(join(xdg, "opencode", "opencode.db"));
  });

  it("lists every path searched when nothing is found, and never fails on an empty machine", () => {
    const h = home("empty");
    const d = discoverSources({}, h);
    for (const s of d.sources.filter((x) => x.adapter.how === "automatic")) {
      expect(s.found).toEqual([]);
      expect(s.searched.length).toBeGreaterThan(0);
    }
    const text = renderSources(d);
    expect(text).toContain(`not found. Looked in: ${join(h, ".claude", "projects")}; ${join(h, ".config", "claude", "projects")}. --claude-dir names another place.`);
    expect(text).toContain("read when you import a file: desk gateway import <file>");
    expect(text).toContain("Tools with no adapter");
    expect(text).not.toContain("Tokens per call: input, output, cache reads"); // no capability list for a source that was not found
  });

  it("does not follow a link to somewhere else, and counts an empty log folder as a folder with no files", () => {
    const h = home("links");
    const elsewhere = join(tmp, "elsewhere");
    put(join(elsewhere, "secret.jsonl"));
    mkdirSync(join(h, ".claude"), { recursive: true });
    try {
      symlinkSync(elsewhere, join(h, ".claude", "projects"), "junction");
    } catch {
      return; // a platform that will not make the link has nothing to test
    }
    const cc = discoverSources({}, h).sources.find((s) => s.adapter.id === "claude_code")!;
    expect(cc.found).toEqual([]);
    mkdirSync(join(h, ".codex", "sessions"), { recursive: true });
    expect(discoverSources({}, h).sources.find((s) => s.adapter.id === "codex")!.found[0]).toMatchObject({ files: 0, changedFrom: null });
  });

  it("says a tool with no adapter is present when its folder is, and still says it has no adapter", () => {
    const h = home("cursor");
    mkdirSync(join(h, ".cursor"), { recursive: true });
    const d = discoverSources({}, h);
    expect(d.noAdapter.find((n) => n.tool === "Cursor")!.present).toBe(true);
    expect(d.noAdapter.find((n) => n.tool === "Cline")!.present).toBe(false);
    expect(renderSources(d)).toContain("Cursor: found on this machine, no adapter: no adapter has been written");
  });

  it("shows the capabilities of a source that was found, one line each", () => {
    const h = home("caps");
    put(join(h, ".codex", "sessions", "r.jsonl"));
    const text = renderSources(discoverSources({}, h));
    expect(text).toMatch(/Codex CLI session logs \(adapter codex\)\n {2}.*sessions: 1 file, 1 KB/);
    expect(text).toContain("yes    Plan-limit readings: the percent of each window used and when it resets");
    expect(text).toContain("no     The tool's own cost: Codex writes no cost");
    expect(text).toContain("partly Tokens per call:");
  });
});
