import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Toolbox, recordingOf } from "../replay/toolbox.ts";
import { readTrajectory } from "../trajectory/read.ts";

/**
 * Side-effect-safe replay (DF-041), against real things that a call could hurt. A recorded session holds a `git push`, an HTTP POST and a deletion. A replayed model asks for
 * those three exactly, then for a variation of each, then for a path outside the sandbox by `..`, by an absolute path and through a link. A real HTTP server counts the requests it
 * gets, a real bare repository would change if pushed to, and a real folder would be emptied. The recorded calls must be answered from the recording, the variations must stop
 * the replay, the paths must be refused, and the server, the repository and the folder must be exactly as they were.
 */
export async function safeReplayProve(): Promise<{ ok: boolean; detail: string }> {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-safe-"));
  const fails: string[] = [];
  let hits = 0;
  const server = createServer((_q, r) => {
    hits += 1;
    r.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const put = (path: string, text: string): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    const outside = join(root, "outside");
    put(join(outside, "data", "precious.txt"), "keep\n");
    put(join(outside, "secret.txt"), "do not read\n");
    const remote = join(root, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const refs = (): string => execFileSync("git", ["-C", remote, "for-each-ref"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const refsBefore = refs();
    const sandbox = join(root, "sandbox");
    put(join(sandbox, "src", "a.js"), "x\n");

    const calls: [string, string][] = [
      ["a", "git push origin main"],
      ["b", `curl -s -X POST http://127.0.0.1:${port}/hook -d deploy`],
      ["c", `rm -rf ${outside.replace(/\\/g, "/")}/data`],
    ];
    const lines: unknown[] = [{ type: "user", sessionId: "prove-safe-0001", cwd: "/original", timestamp: "2026-10-02T10:00:00Z", uuid: "u", message: { role: "user", content: "ship it" } }];
    for (const [id, command] of calls) {
      lines.push({ type: "assistant", sessionId: "prove-safe-0001", cwd: "/original", timestamp: "2026-10-02T10:01:00Z", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
      lines.push({ type: "user", sessionId: "prove-safe-0001", timestamp: "2026-10-02T10:01:05Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `recorded result of ${id}` }] } });
    }
    const log = join(root, "rec.jsonl");
    writeFileSync(log, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const recording = recordingOf(readTrajectory(log, { keepText: true }));

    const t = new Toolbox({ dir: sandbox, recording });
    const served = calls.map(([, command]) => t.call("Bash", { command }));
    if (!served.every((s, i) => s.how === "recording" && s.content === `recorded result of ${calls[i]![0]}`)) fails.push("a recorded call was not answered from the recording");

    const variants = ["git push origin dev", `curl -s -X POST http://127.0.0.1:${port}/hook -d again`, `rm -rf ${outside.replace(/\\/g, "/")}/data2`];
    for (const command of variants) {
      const v = new Toolbox({ dir: sandbox, recording });
      if (v.call("Bash", { command }).how !== "diverged" || v.divergence === null) fails.push(`a variation was not stopped: ${command}`);
      if (v.call("Read", { file_path: "src/a.js" }).how !== "refused") fails.push("the replay went on after it diverged");
    }
    const e = new Toolbox({ dir: sandbox });
    for (const p of ["../outside/secret.txt", join(outside, "secret.txt"), "src/../../outside/secret.txt"]) {
      if (e.call("Read", { file_path: p }).how !== "refused") fails.push(`${p} was read`);
      if (e.call("Write", { file_path: p, content: "x" }).how !== "refused") fails.push(`${p} was written`);
    }
    try {
      symlinkSync(outside, join(sandbox, "link"), "junction");
      if (e.call("Read", { file_path: "link/secret.txt" }).how !== "refused") fails.push("a file was read through a link");
      if (e.call("Write", { file_path: "link/data/precious.txt", content: "x" }).how !== "refused") fails.push("a file was written through a link");
    } catch {
      fails.push("the link could not be made, so the link case was not tried");
    }
    if (e.call("Write", { file_path: ".git/config", content: "x" }).how !== "refused") fails.push(".git was written");

    if (hits !== 0) fails.push(`the server received ${hits} requests`);
    if (refs() !== refsBefore) fails.push("the remote repository changed");
    if (readFileSync(join(outside, "data", "precious.txt"), "utf8") !== "keep\n") fails.push("the folder was changed");
    if (existsSync(join(outside, "new.txt")) || readFileSync(join(outside, "secret.txt"), "utf8") !== "do not read\n") fails.push("a file outside was changed");
  } catch (err) {
    fails.push(`it threw: ${(err as Error).message}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
  if (fails.length > 0) return { ok: false, detail: fails.join("; ") };
  return { ok: true, detail: "a recorded push, POST and deletion were answered from the recording and run by nothing; a variation of each stopped the replay; paths outside the sandbox by .., an absolute path and a link were refused for reading and writing; the server got 0 requests, the remote repository and the folder were as they were" };
}
