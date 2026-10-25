import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { isLoopbackHost } from "../../src/desk/security/net.ts";

/**
 * The network monitor test (DF-074). Child processes run with a preload that records every socket the process tries to open and every name it
 * looks up, at the call and before a packet is sent. The product's commands, run offline on the sample, must show only this machine.
 * Two controls show the monitor sees what it should: a connection to a local server is recorded, and an attempt at a documentation address
 * (203.0.113.0/24, reserved, never routed) is recorded as not on this machine and then dropped.
 */
const MONITOR = resolve("tests/desk/support/net-monitor.cjs");
const tmp = mkdtempSync(join(tmpdir(), "desk-net-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Seen {
  kind: string;
  target: string;
}

function run(name: string, args: string[], env: Record<string, string> = {}, timeoutMs = 240_000): Promise<{ code: number | null; out: string; seen: Seen[] }> {
  const log = join(tmp, `${name}.jsonl`);
  writeFileSync(log, "");
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--require", MONITOR, "--import", "tsx", ...args], {
      env: { ...process.env, ...env, DESK_NET_LOG: log, SAMPLE_MODE: "true", NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { out += d.toString(); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const seen = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Seen) : [];
      done({ code, out, seen });
    });
  });
}

const hostOf = (target: string): string => {
  if (target.startsWith("ipc:")) return "localhost";
  const i = target.lastIndexOf(":");
  return i === -1 ? target : target.slice(0, i);
};
const offMachine = (seen: Seen[]): Seen[] => seen.filter((s) => s.kind !== "ipc" && !s.target.startsWith("ipc:") && !isLoopbackHost(hostOf(s.target)));

describe("the monitor sees what it should", () => {
  it("records a connection to a local server as this machine", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const script = join(tmp, "local.cjs");
    writeFileSync(script, `fetch("http://127.0.0.1:${port}/").then((r) => r.text()).then(() => process.exit(0), () => process.exit(1));`);
    const r = await run("control-local", [script]);
    server.closeAllConnections?.();
    await new Promise<void>((res) => server.close(() => res()));
    expect(r.code).toBe(0);
    expect(r.seen.some((s) => s.kind === "connect" && s.target === `127.0.0.1:${port}`)).toBe(true);
    expect(offMachine(r.seen)).toEqual([]);
  }, 60_000);

  it("records an attempt to reach another machine, before any packet would be sent", async () => {
    const script = join(tmp, "remote.cjs");
    writeFileSync(script, `const net = require("node:net"); const s = net.connect({ host: "203.0.113.9", port: 80 }); s.on("error", () => {}); s.destroy(); setTimeout(() => process.exit(0), 200);`);
    const r = await run("control-remote", [script], {}, 30_000);
    expect(offMachine(r.seen).map((s) => s.target)).toContain("203.0.113.9:80");
  }, 60_000);
});

describe("what the product opens, offline, on the sample", () => {
  it("a model endpoint that is not on this machine is refused by the guard before the monitor sees any socket", async () => {
    const script = join(tmp, "guard.mts");
    writeFileSync(
      script,
      [
        `import { OpenAiPort } from ${JSON.stringify(pathToFileURL(resolve("src/desk/agents/model.ts")).href)};`,
        `const key = ["stand", "in", "key", "0123456789"].join("-");`,
        `const port = new OpenAiPort({ baseUrl: "https://models.example.invalid/v1", apiKey: key, model: "m", profile: "local", backoffMs: [] });`,
        `port.complete({ role: "t", messages: [{ role: "user", content: "hi" }] }, 5000).then(() => process.exit(1), (e) => { console.log(String(e.message)); process.exit(0); });`,
      ].join("\n"),
    );
    const r = await run("guard", [script]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("E_EGRESS_UNDECLARED");
    // The loader that runs TypeScript talks to its own process over a local pipe; that is the only socket, and no name is looked up.
    expect(r.seen.filter((s) => s.kind === "dns").map((s) => s.target)).toEqual([]);
    expect(offMachine(r.seen)).toEqual([]);
    expect(r.seen.every((s) => s.target.startsWith("ipc:"))).toBe(true);
  }, 60_000);

  it("the card, the demonstration and an Ask open no connection to another machine", async () => {
    const cli = resolve("src/desk/cli.ts");
    // The card builds the sample if it is not there yet. It goes first and alone: two commands that each build the same folder at once remove each other's files.
    const card = await run("card", [cli, "card", "--sample"]);
    const [demo, askRun] = await Promise.all([
      run("demo", [cli, "demo"]),
      run("ask", [cli, "ask", "What was the most expensive day?", "--sample"]),
    ]);
    for (const [name, r] of [["card", card], ["demo", demo], ["ask", askRun]] as const) {
      expect(r.code, `${name}: ${r.out.slice(-400)}`).toBe(0);
      expect(offMachine(r.seen), name).toEqual([]);
    }
  }, 480_000);
});
