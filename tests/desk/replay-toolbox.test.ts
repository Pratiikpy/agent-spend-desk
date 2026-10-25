import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Toolbox, globToRegExp, recordingOf } from "../../src/desk/replay/toolbox.ts";
import { readTrajectory } from "../../src/desk/trajectory/read.ts";

/**
 * Side-effect-safe replay (DF-041): what a replayed model is given, that none of it reaches outside the sandbox, that a recorded call is answered from the recording and never run,
 * and that a call which could change something and was not recorded stops the replay and runs nothing. The rule is tested the way it matters: with a real HTTP server that counts
 * the requests it gets, a real bare repository that a push would change, and a real folder that a deletion would empty.
 */
const root = mkdtempSync(join(tmpdir(), "desk-toolbox-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (name: string): string => {
  n += 1;
  const d = join(root, `${name}-${n}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const put = (dir: string, path: string, content: string | Buffer): void => {
  const p = join(dir, ...path.split("/"));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

function sandbox() {
  const dir = fresh("sandbox");
  put(dir, "src/a.js", "exports.a = 1;\nexports.b = 2;\n// TODO fix\n");
  put(dir, "src/deep/b.js", "module.exports = 'deep';\n// TODO later\n");
  put(dir, "README.md", "# project\n");
  put(dir, "node_modules/lib/index.js", "module.exports = 'lib';\n");
  put(dir, ".git/HEAD", "ref: refs/heads/main\n");
  return dir;
}

describe("the tools it offers, inside the sandbox", () => {
  it("reads a file with its lines numbered, a part of it when asked, and says what it will not read", () => {
    const t = new Toolbox({ dir: sandbox() });
    const r = t.call("Read", { file_path: "src/a.js" });
    expect(r).toMatchObject({ how: "executed", class: "read_only", isError: false });
    expect(r.content).toBe("     1\texports.a = 1;\n     2\texports.b = 2;\n     3\t// TODO fix\n     4\t");
    expect(t.call("Read", { file_path: "src/a.js", offset: 1, limit: 1 }).content).toBe("     2\texports.b = 2;");
    expect(t.call("Read", { file_path: "nope.js" })).toMatchObject({ how: "refused", isError: true });
    expect(t.call("Read", { file_path: "src" })).toMatchObject({ how: "refused" });
    put(t.dir, "bin.dat", Buffer.from([1, 2, 0, 3]));
    expect(t.call("Read", { file_path: "bin.dat" }).content).toMatch(/binary/);
    expect(t.call("Read", {})).toMatchObject({ how: "refused" });
  });

  it("lists a folder, finds files by glob, and searches their contents, skipping .git and node_modules", () => {
    const t = new Toolbox({ dir: sandbox() });
    expect(t.call("LS", {}).content).toBe("README.md\nnode_modules/\nsrc/");
    expect(t.call("LS", { path: "src" }).content).toBe("a.js\ndeep/");
    expect(t.call("Glob", { pattern: "src/**/*.js" }).content).toBe("src/a.js\nsrc/deep/b.js");
    expect(t.call("Glob", { pattern: "*.md" }).content).toBe("README.md");
    expect(t.call("Glob", { pattern: "**/*.nothing" }).content).toBe("(no files match)");
    expect(t.call("Grep", { pattern: "TODO" }).content).toBe("src/a.js:3:// TODO fix\nsrc/deep/b.js:2:// TODO later");
    expect(t.call("Grep", { pattern: "TODO", path: "src/deep" }).content).toBe("src/deep/b.js:2:// TODO later");
    expect(t.call("Grep", { pattern: "TODO", glob: "*.md" }).content).toBe("(no matches)");
    expect(t.call("Grep", { pattern: "(" })).toMatchObject({ how: "refused" });
    expect(t.call("Grep", { pattern: "x".repeat(201) })).toMatchObject({ how: "refused" });
    expect(globToRegExp("src/**/*.{js,ts}").test("src/a/b/c.ts")).toBe(true);
    expect(globToRegExp("src/*.js").test("src/a/b.js")).toBe(false);
  });

  it("edits a file by one exact string, refuses an ambiguous or missing one, and writes a new file with its folders", () => {
    const t = new Toolbox({ dir: sandbox() });
    expect(t.call("Edit", { file_path: "src/a.js", old_string: "exports.a = 1;", new_string: "exports.a = 10;" })).toMatchObject({ how: "executed", class: "mutating", effect: "file_edit" });
    expect(readFileSync(join(t.dir, "src", "a.js"), "utf8")).toContain("exports.a = 10;");
    expect(t.call("Edit", { file_path: "src/a.js", old_string: "exports", new_string: "x" }).content).toMatch(/occurs 2 times/);
    expect(t.call("Edit", { file_path: "src/a.js", old_string: "exports", new_string: "e", replace_all: true }).content).toMatch(/2 places/);
    expect(t.call("Edit", { file_path: "src/a.js", old_string: "absent", new_string: "x" }).content).toMatch(/was not found/);
    expect(t.call("Edit", { file_path: "src/a.js", old_string: "", new_string: "x" })).toMatchObject({ how: "refused" });
    expect(t.call("Write", { file_path: "new/dir/c.js", content: "ok" })).toMatchObject({ how: "executed" });
    expect(readFileSync(join(t.dir, "new", "dir", "c.js"), "utf8")).toBe("ok");
    expect([...t.touched].sort()).toEqual(["new/dir/c.js", "src/a.js"]);
  });

  it("runs the owner's tests in the sandbox and reports what passed and what failed", () => {
    const dir = sandbox();
    put(dir, "t.test.js", 'const t = require("node:test"); const a = require("node:assert");\nt("passes", () => {});\nt("fails", () => a.fail("no"));\n');
    const t = new Toolbox({ dir, tests: { plan: { preset: "node" }, files: ["t.test.js"], scratch: fresh("scratch") } });
    const r = t.call("RunTests", {});
    expect(r).toMatchObject({ how: "executed", isError: true });
    expect(r.content).toMatch(/1 passed, 1 failed, 0 skipped\./);
    expect(r.content).toContain("failing: t.test.js::fails");
    expect(t.call("RunTests", { files: ["other.test.js"] })).toMatchObject({ how: "refused" });
    expect(new Toolbox({ dir: sandbox() }).call("RunTests", {})).toMatchObject({ how: "refused" });
  }, 60_000);

  it("gives the same test report whichever folder the sandbox was and however long the run took, so that a recorded conversation can be replayed", () => {
    const make = (): Toolbox => {
      const dir = sandbox();
      put(dir, "t.test.js", 'const t = require("node:test"); const a = require("node:assert");\nt("passes", () => {});\nt("fails with a message", () => a.strictEqual(1 + 1, 3));\n');
      return new Toolbox({ dir, tests: { plan: { preset: "node" }, files: ["t.test.js"], scratch: fresh("scratch") } });
    };
    const a = make().call("RunTests", {});
    const b = make().call("RunTests", {});
    expect(a.content).toBe(b.content);
    expect(a.content).toMatch(/failing: t\.test\.js::fails with a message - Expected values to be strictly equal/);
    expect(a.content).not.toMatch(/desk-toolbox|\d ms|duration/);
  }, 60_000);

  it("limits what one replay can do: a long file is cut, a large write refused, the tests run a fixed number of times", () => {
    const dir = sandbox();
    put(dir, "big.txt", `${"x".repeat(100)}\n`.repeat(100));
    put(dir, "t.test.js", 'require("node:test")("p", () => {});\n');
    const t = new Toolbox({ dir, limits: { readBytes: 500, writeBytes: 100, testRuns: 1, resultChars: 300 }, tests: { plan: { preset: "node" }, files: ["t.test.js"], scratch: fresh("scratch") } });
    expect(t.call("Read", { file_path: "big.txt" }).content).toMatch(/\[output cut at 300 characters\]/);
    expect(t.call("Write", { file_path: "w.txt", content: "y".repeat(101) })).toMatchObject({ how: "refused" });
    expect(t.call("RunTests", {}).how).toBe("executed");
    expect(t.call("RunTests", {}).content).toMatch(/the most a replay allows/);
  }, 60_000);
});

describe("nothing reaches outside the sandbox", () => {
  function world() {
    const base = fresh("world");
    const dir = join(base, "sandbox");
    mkdirSync(dir);
    put(dir, "src/a.js", "x\n");
    const outside = join(base, "outside");
    put(outside, "secret.txt", "do not read me\n");
    put(outside, "data/precious.txt", "keep\n");
    return { base, dir, outside, t: new Toolbox({ dir }) };
  }

  it("refuses a path that leaves the folder by .., by an absolute path or by a link, for reading and for writing", () => {
    const { dir, outside, t } = world();
    const secret = join(outside, "secret.txt");
    for (const p of ["../outside/secret.txt", secret, "src/../../outside/secret.txt", "src\\..\\..\\outside\\secret.txt"]) {
      expect(t.call("Read", { file_path: p }), p).toMatchObject({ how: "refused" });
      expect(t.call("Write", { file_path: p, content: "x" }), p).toMatchObject({ how: "refused" });
      expect(t.call("Edit", { file_path: p, old_string: "do", new_string: "x" }), p).toMatchObject({ how: "refused" });
    }
    for (const where of [dir.replace(/[^/\\]+$/, "outside"), "..", "../..", outside]) {
      expect(t.call("LS", { path: where }), where).toMatchObject({ how: "refused" });
      expect(t.call("Grep", { pattern: "do", path: where }), where).toMatchObject({ how: "refused" });
    }
    symlinkSync(outside, join(dir, "link"), "junction");
    expect(t.call("Read", { file_path: "link/secret.txt" })).toMatchObject({ how: "refused" });
    expect(t.call("Write", { file_path: "link/new.txt", content: "x" })).toMatchObject({ how: "refused" });
    expect(t.call("Write", { file_path: "link/data/precious.txt", content: "overwritten" })).toMatchObject({ how: "refused" });
    expect(t.call("Glob", { pattern: "**/secret.txt" }).content).toBe("(no files match)");
    expect(t.call("Grep", { pattern: "do not read" }).content).toBe("(no matches)");
    expect(readFileSync(join(outside, "data", "precious.txt"), "utf8")).toBe("keep\n");
    expect(existsSync(join(outside, "new.txt"))).toBe(false);
    expect(t.call("Read", { file_path: "a\0b" })).toMatchObject({ how: "refused" });
  });

  it("writes nothing under .git or node_modules, and reads no history", () => {
    const { dir, t } = world();
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(dir, "node_modules"));
    for (const p of [".git/config", ".git/hooks/pre-commit", "node_modules/x/index.js", "sub/.git/config"]) expect(t.call("Write", { file_path: p, content: "x" }), p).toMatchObject({ how: "refused" });
    expect(t.call("Read", { file_path: ".git/HEAD" })).toMatchObject({ how: "refused" });
    expect(existsSync(join(dir, ".git", "config"))).toBe(false);
  });

  it("lets dependencies be read from where they are linked, and not written", () => {
    const { base, dir } = world();
    const deps = join(base, "deps");
    put(deps, "lib/index.js", "module.exports = 1;\n");
    symlinkSync(deps, join(dir, "node_modules"), "junction");
    const t = new Toolbox({ dir, readRoots: [deps] });
    expect(t.call("Read", { file_path: "node_modules/lib/index.js" })).toMatchObject({ how: "executed" });
    expect(t.call("Write", { file_path: "node_modules/lib/index.js", content: "x" })).toMatchObject({ how: "refused" });
    expect(readFileSync(join(deps, "lib", "index.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(new Toolbox({ dir }).call("Read", { file_path: "node_modules/lib/index.js" })).toMatchObject({ how: "refused" });
  });
});

describe("a call that is not offered", () => {
  it("is refused with a message when it only reads and was not recorded, and the replay goes on", () => {
    const t = new Toolbox({ dir: sandbox() });
    const r = t.call("WebFetch", { url: "https://example.com" });
    expect(r).toMatchObject({ how: "stub", class: "read_only", effect: "network_read", isError: true });
    expect(r.content).toMatch(/not available in a replay/);
    expect(t.divergence).toBeNull();
    expect(t.call("Read", { file_path: "README.md" }).how).toBe("executed");
  });

  it("stops the replay, running nothing, when it could change something and was not recorded; after that every call is refused", () => {
    const t = new Toolbox({ dir: sandbox() });
    const r = t.call("Bash", { command: "git push origin main" });
    expect(r).toMatchObject({ how: "diverged", class: "mutating", effect: "shell", isError: true });
    expect(t.divergence).toMatch(/asked for Bash with "git push origin main".*could change something and was not recorded/);
    for (const [name, args] of [["Read", { file_path: "README.md" }], ["Edit", { file_path: "README.md", old_string: "#", new_string: "##" }], ["Task", {}]] as const) expect(t.call(name, args), name).toMatchObject({ how: "refused" });
    expect(readFileSync(join(t.dir, "README.md"), "utf8")).toBe("# project\n");
    expect(t.counts).toMatchObject({ diverged: 1, refused: 3, executed: 0 });
    for (const [name, args] of [["Task", { prompt: "x" }], ["mcp__srv__do", {}], ["Unheard", {}], ["Bash", { command: "npm install" }]] as const) {
      const fresh1 = new Toolbox({ dir: sandbox() });
      expect(fresh1.call(name, args), name).toMatchObject({ how: "diverged", class: "mutating" });
    }
  });
});

/** A session log with calls that would hurt if they ran, and what each said when it did, so that a recording can be made from it as it is made from a real one. */
function recordedSession(outsideDir: string, port: number): { path: string; push: string; post: string; remove: string } {
  const dir = fresh("recorded");
  const lines: unknown[] = [{ type: "user", sessionId: "rec-session-1", cwd: "/original/work", timestamp: "2026-10-02T10:00:00Z", uuid: "u1", message: { role: "user", content: "ship it" } }];
  const push = "git push origin main";
  const post = `curl -s -X POST http://127.0.0.1:${port}/hook -d deploy`;
  const remove = `rm -rf ${outsideDir.replace(/\\/g, "/")}/data`;
  const calls: [string, string, string][] = [["a", push, "To origin\n   abc..def  main -> main"], ["b", post, "{\"ok\":true}"], ["c", remove, ""]];
  for (const [id, command, out] of calls) {
    lines.push({ type: "assistant", sessionId: "rec-session-1", cwd: "/original/work", timestamp: "2026-10-02T10:01:00Z", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
    lines.push({ type: "user", sessionId: "rec-session-1", timestamp: "2026-10-02T10:01:05Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out === "" ? "(no output)" : out }] } });
  }
  const path = join(dir, "rec.jsonl");
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return { path, push, post, remove };
}

describe("a replay that is asked for what was recorded: a push, a POST and a deletion", () => {
  let server: Server;
  let hits = 0;
  let port = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits += 1;
      res.end("{\"ok\":true}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("serves the recorded results and runs none of them: no request reaches the server, the remote is unchanged, the folder is not emptied", () => {
    const base = fresh("effects");
    const outside = join(base, "outside");
    put(outside, "data/precious.txt", "keep\n");
    const remote = join(base, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote], { windowsHide: true });
    const refsBefore = execFileSync("git", ["-C", remote, "for-each-ref"], { encoding: "utf8", windowsHide: true });
    const work = join(base, "work");
    mkdirSync(work);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: work, windowsHide: true });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: work, windowsHide: true });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: work, windowsHide: true });
    const rec = recordedSession(outside, port);
    const recording = recordingOf(readTrajectory(rec.path, { keepText: true }));
    expect(recording.size).toBe(3);
    const before = hits;
    const t = new Toolbox({ dir: work, recording });
    const out = [rec.push, rec.post, rec.remove].map((command) => t.call("Bash", { command }));
    expect(out.map((o) => o.how)).toEqual(["recording", "recording", "recording"]);
    expect(out[0]!.content).toBe("To origin\n   abc..def  main -> main");
    expect(out[1]!.content).toBe('{"ok":true}');
    expect(hits).toBe(before);
    expect(execFileSync("git", ["-C", remote, "for-each-ref"], { encoding: "utf8", windowsHide: true })).toBe(refsBefore);
    expect(readFileSync(join(outside, "data", "precious.txt"), "utf8")).toBe("keep\n");
    expect(t.divergence).toBeNull();
    expect(t.counts).toMatchObject({ recording: 3, diverged: 0 });
  });

  it("stops at a variation of each, and still runs nothing", () => {
    const base = fresh("variants");
    const outside = join(base, "outside");
    put(outside, "data/precious.txt", "keep\n");
    put(outside, "data2/other.txt", "keep too\n");
    const rec = recordedSession(outside, port);
    const recording = recordingOf(readTrajectory(rec.path, { keepText: true }));
    const before = hits;
    const variants = ["git push origin dev", `curl -s -X POST http://127.0.0.1:${port}/hook -d deploy-again`, `rm -rf ${outside.replace(/\\/g, "/")}/data2`];
    for (const command of variants) {
      const t = new Toolbox({ dir: fresh("variant-sandbox"), recording });
      expect(t.call("Bash", { command }).how, command).toBe("diverged");
      expect(t.divergence, command).toMatch(/was not recorded/);
    }
    expect(hits).toBe(before);
    expect(readFileSync(join(outside, "data", "precious.txt"), "utf8")).toBe("keep\n");
    expect(readFileSync(join(outside, "data2", "other.txt"), "utf8")).toBe("keep too\n");
  });

  it("looks a call up by what it says with the sandbox's own folder written as <cwd>, so that a command naming the folder it ran in is the same command in another folder", () => {
    const a = fresh("cwd-a");
    const logDir = fresh("cwd-log");
    const lines = [
      { type: "user", sessionId: "cwd-session-1", cwd: a, timestamp: "2026-10-02T10:00:00Z", uuid: "u", message: { role: "user", content: "p" } },
      { type: "assistant", sessionId: "cwd-session-1", cwd: a, timestamp: "2026-10-02T10:01:00Z", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Bash", input: { command: `cd ${a} && npm run deploy` } }] } },
      { type: "user", sessionId: "cwd-session-1", timestamp: "2026-10-02T10:01:05Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "deployed" }] } },
    ];
    const p = join(logDir, "c.jsonl");
    writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const recording = recordingOf(readTrajectory(p, { keepText: true }));
    const b = fresh("cwd-b");
    const t = new Toolbox({ dir: b, recording });
    expect(t.call("Bash", { command: `cd ${b} && npm run deploy` })).toMatchObject({ how: "recording", content: "deployed" });
  });

  it("does not make a recording of a result that was cut short, which would serve a different result", () => {
    const base = fresh("cut");
    const lines = [
      { type: "user", sessionId: "cut-session-1", cwd: "/w", timestamp: "2026-10-02T10:00:00Z", uuid: "u", message: { role: "user", content: "p" } },
      { type: "assistant", sessionId: "cut-session-1", cwd: "/w", timestamp: "2026-10-02T10:01:00Z", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Bash", input: { command: "make deploy" } }] } },
      { type: "user", sessionId: "cut-session-1", timestamp: "2026-10-02T10:01:05Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "<persisted-output> too large, saved elsewhere" }] } },
    ];
    const p = join(base, "c.jsonl");
    writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const recording = recordingOf(readTrajectory(p, { keepText: true }));
    expect(recording.size).toBe(0);
    expect(new Toolbox({ dir: fresh("cut-sandbox"), recording }).call("Bash", { command: "make deploy" }).how).toBe("diverged");
  });
});
