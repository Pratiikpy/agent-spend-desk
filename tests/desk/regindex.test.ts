import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SAMPLE_RUNS } from "../../src/desk/canary/command.ts";
import { TASKS } from "../../src/desk/canary/tasks.ts";
import { indexCommand } from "../../src/desk/regindex/command.ts";
import { buildPayload, bytesOf, digestOf, publish, readConsent, IndexRefused, INDEX_SCHEMA } from "../../src/desk/regindex/index.ts";
import { runSwap } from "../../src/desk/replay/run.ts";
import { manifestFromEnv } from "../../src/desk/security/net.ts";
import { measured, Scripted, solver } from "./support/toy-swap.ts";

/** The opt-in regression index (DF-064): the payload has aggregates and nothing that names the work, and nothing leaves without a preview that was accepted. */
const root = mkdtempSync(join(tmpdir(), "desk-regindex-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const NOW = () => new Date("2026-10-25T15:00:00Z");

describe("the payload", () => {
  it("is aggregates from the canary: the suite's name, the model the endpoint served, a pass rate, and the verdict, with no task text", () => {
    const p = buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW });
    expect(p).toMatchObject({ schema: INDEX_SCHEMA, tool: { name: "desk" }, generated: "2026-10-25" });
    expect(p.suites).toHaveLength(1);
    expect(p.suites[0]).toMatchObject({ kind: "canary", tasks: TASKS.length, steps: null });
    expect(p.suites[0]!.suite).toMatch(/^v2:sha256:[0-9a-f]{64}$/);
    expect(typeof p.suites[0]!.passRate).toBe("number");
    expect(["steady", "regressed", "inconclusive", "watch"]).toContain(p.suites[0]!.verdict);
    const text = bytesOf(p);
    for (const t of TASKS) {
      expect(text).not.toContain(t.id);
      expect(text).not.toContain(t.prompt.slice(0, 30));
    }
    expect(text).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
  });

  it("holds a swap's pass rate and steps by route, under the name of the suite and not of its tasks", async () => {
    const { store, tasks, gold } = await measured(2);
    await runSwap({ store, tasks, baseline: { name: "strong", model: "route-strong", port: new Scripted(solver(gold)) }, candidate: { name: "lazy", model: "route-lazy", port: new Scripted(() => ({ content: "no" })) }, repeats: 2, resamples: 200 });
    const p = buildPayload({ store, now: NOW });
    expect(p.suites.map((s) => [s.kind, s.model, s.runs, s.passRate, s.steps])).toEqual([["swap", "route-strong", 4, 1, 4], ["swap", "route-lazy", 4, 0, 1]]);
    const text = bytesOf(p);
    for (const t of tasks) {
      expect(text).not.toContain(t.task_id);
      expect(text).not.toContain(t.prompt.slice(0, 20));
    }
    expect(p.suites[0]!.suite).toMatch(/^run-[0-9a-f]{12}$/);
  }, 120_000);

  it("has a digest that changes with any figure, and the bytes that are previewed are the bytes that are hashed", () => {
    const p = buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW });
    const q = { ...p, suites: [{ ...p.suites[0]!, passRate: 0.5 }] };
    expect(digestOf(q)).not.toBe(digestOf(p));
    expect(digestOf(JSON.parse(bytesOf(p)))).toBe(digestOf(p));
  });
});

describe("sending it", () => {
  let server: Server;
  let url = "";
  const bodies: string[] = [];
  let redirect = false;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        bodies.push(Buffer.concat(chunks).toString("utf8"));
        if (redirect) {
          res.statusCode = 302;
          res.setHeader("location", "http://example.invalid/steal");
          res.end();
        } else res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/index`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  const on = (): Record<string, string> => ({ DESK_INDEX: "on", DESK_INDEX_URL: url });
  const consentPath = join(root, "consent.json");

  it("is refused while the index is off, while no address is set, and until a preview was accepted", async () => {
    const p = buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW });
    const before = bodies.length;
    await expect(publish({ payload: p, consent: null, env: {} })).rejects.toThrow(/index is off/);
    await expect(publish({ payload: p, consent: null, env: { DESK_INDEX: "on" } })).rejects.toThrow(/no address is declared/);
    await expect(publish({ payload: p, consent: null, env: on() })).rejects.toThrow(/has not been previewed and accepted/);
    await expect(publish({ payload: p, consent: null, env: on() })).rejects.toBeInstanceOf(IndexRefused);
    expect(bodies.length).toBe(before);
  });

  it("sends the previewed bytes exactly, and refuses a payload that is not the one accepted", async () => {
    const preview = await indexCommand({ sub: "preview", canaryRunsPath: SAMPLE_RUNS, store: null, env: on(), consentPath, now: NOW });
    expect(preview.text).toContain(bytesOf(buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW })).trimEnd());
    expect(preview.text).toMatch(/That is everything that would be sent, 1 suite, \d+ bytes, hash [0-9a-f]{64}\./);
    expect((await indexCommand({ sub: "publish", canaryRunsPath: SAMPLE_RUNS, store: null, env: on(), consentPath, now: NOW })).text).toMatch(/Not sent: the payload has not been previewed and accepted/);
    const accepted = await indexCommand({ sub: "accept", canaryRunsPath: SAMPLE_RUNS, store: null, env: on(), consentPath, now: NOW });
    expect(accepted.text).toMatch(/^Accepted the payload with hash [0-9a-f]{16}\./);
    const sent = await indexCommand({ sub: "publish", canaryRunsPath: SAMPLE_RUNS, store: null, env: on(), consentPath, now: NOW });
    expect(sent).toMatchObject({ code: 0 });
    expect(sent.text).toMatch(/the index answered 200/);
    expect(bodies[bodies.length - 1]).toBe(bytesOf(buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW })));
    // What would be sent has changed since it was accepted: the day.
    const later = await indexCommand({ sub: "publish", canaryRunsPath: SAMPLE_RUNS, store: null, env: on(), consentPath, now: () => new Date("2026-10-26T15:00:00Z") });
    expect(later.code).toBe(1);
    expect(later.text).toMatch(/is not the one that was accepted .* it changed since you looked/);
    expect(bodies.filter((b) => b.includes("2026-10-26"))).toHaveLength(0);
    expect(readConsent(consentPath)?.digest).toBe(digestOf(buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW })));
    expect(JSON.parse(readFileSync(consentPath, "utf8")).acceptedAt).toBe("2026-10-25T15:00:00.000Z");
  });

  it("goes to the declared address and nowhere else, not even when that address redirects", async () => {
    const p = buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: NOW });
    const consent = { digest: digestOf(p), acceptedAt: "2026-10-25T00:00:00Z" };
    redirect = true;
    try {
      await expect(publish({ payload: p, consent, env: on() })).rejects.toThrow(/answered with a redirect \(302\) and it was not followed/);
    } finally {
      redirect = false;
    }
    expect(manifestFromEnv(on()).destinations.some((d) => d.kind === "index" && d.origin === new URL(url).origin)).toBe(true);
    expect(manifestFromEnv({ DESK_INDEX_URL: url }).destinations.some((d) => d.kind === "index")).toBe(false);
    expect(manifestFromEnv({ DESK_INDEX: "on" }).destinations.some((d) => d.kind === "index")).toBe(false);
  });

  it("says plainly whether it is on, and what is set", async () => {
    expect((await indexCommand({ sub: "status", canaryRunsPath: SAMPLE_RUNS, store: null, env: {}, consentPath: join(root, "none.json"), now: NOW })).text).toMatch(/^The regression index is OFF\.\nNothing is sent\./);
    expect((await indexCommand({ sub: "status", canaryRunsPath: SAMPLE_RUNS, store: null, env: on(), consentPath, now: NOW })).text).toMatch(/is ON\.\nIt would send to .*\/index\.\nA payload \([0-9a-f]{12}\) was accepted on 2026-10-25\./);
    expect((await indexCommand({ sub: "nonsense", canaryRunsPath: SAMPLE_RUNS, store: null, env: {}, now: NOW })).text).toMatch(/off by default/);
  });
});
