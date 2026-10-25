import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ephemeralSigner } from "../../src/desk/dossier/keys.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { packCommand, type PackFlags } from "../../src/desk/pack/command.ts";
import { openSignedPack, packDigest, readPack, signPack, tasksOf, PackError } from "../../src/desk/pack/pack.ts";
import { parsePolicyYaml } from "../../src/desk/policy/parse.ts";
import { assistantLine, testSnapshot } from "./helpers.ts";

/**
 * Rules and canary templates from someone else (DF-065): what a pack may hold, what is refused and nothing written, what is drafted and started in shadow, and signatures.
 */
const root = mkdtempSync(join(tmpdir(), "desk-pack-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const dir = (): string => {
  n += 1;
  const d = join(root, `p${n}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const CURRENT = "version: 1\nrules:\n  - id: allow-capped\n    kind: permit\n    when: {}\n    cap: { window: day, max_usd: \"150.00\" }\n";
const STOP_LOOPS = { rules: [{ id: "stop-loops", kind: "forbid", when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "2.00" } }, action: "pause_with_checkpoint" }] };
const pack = (over: Record<string, unknown> = {}, content: unknown = STOP_LOOPS): string => JSON.stringify({ schema: "desk.pack.v1", kind: "loop_signature", name: "stop-loops", version: "1.0.0", description: "Pause a session that repeats the same failing call.", content, ...over });

function setup() {
  const d = dir();
  const policy = join(d, "policy.yaml");
  writeFileSync(policy, CURRENT);
  return { d, policy, drafts: join(d, "drafts"), templates: join(d, "templates") };
}

const run = async (s: ReturnType<typeof setup>, sub: string, args: string[], flags: Partial<PackFlags> = {}, ledger = openLedger(":memory:")) =>
  packCommand({ sub, args, flags: { prices: "data/prices/anthropic-litellm-2026-10-22.json", policy: s.policy, draftsDir: s.drafts, templatesDir: s.templates, ...flags }, ledger: () => ledger, env: {}, now: () => new Date("2026-10-25T12:00:00Z") });

describe("what a pack may hold", () => {
  it("reads a policy pack and a canary template, and says what is wrong with any other", () => {
    expect(readPack(pack()).name).toBe("stop-loops");
    const tmpl = pack({ kind: "canary_template", name: "units" }, { tasks: [{ id: "u1", cluster: "units", prompt: "Convert 5 kilometres to metres.", check: { kind: "lastNumberIs", args: [5000] } }] });
    expect(tasksOf(readPack(tmpl))[0]!.check("It is 5,000 m")).toBe(1);
    const bad: [string, RegExp][] = [
      ["not json", /not JSON/],
      [pack({ schema: "other" }), /schema is "other"/],
      [pack({ kind: "script" }), /the kind is "script"/],
      [pack({ name: "Bad Name" }), /the name is 1 to 41/],
      [pack({ version: "1" }), /version is three numbers/],
      [pack({ extra: 1 }), /no field called "extra"/],
      [pack({}, { rules: [{ id: "a", kind: "permit", when: {} }], command: "rm -rf /" }), /holds rules and nothing else, not "command"/],
      [pack({}, { rules: [] }), /1 to 100 rules/],
      [pack({ kind: "canary_template" }, { tasks: [{ id: "t", cluster: "units", prompt: "A prompt long enough.", check: { kind: "exec", args: ["rm -rf /"] } }] }), /not a kind of check the Desk has/],
      [pack({ kind: "canary_template" }, { tasks: [{ id: "t", cluster: "units", prompt: "A prompt long enough.", check: { kind: "lastNumberIs", args: ["five"] } }] }), /takes a number/],
      [pack({ kind: "canary_template" }, { tasks: [{ id: "t", cluster: "units", prompt: "A prompt long enough.", check: { kind: "wordIs", args: ["a"] }, run: "node x.js" }] }), /no field called "run"/],
      [pack({ kind: "canary_template" }, { tasks: [{ id: "t", cluster: "weather", prompt: "A prompt long enough.", check: { kind: "wordIs", args: ["a"] } }] }), /the cluster is one of/],
      [pack({ kind: "canary_template" }, { tasks: [{ id: "t", cluster: "units", prompt: "short", check: { kind: "wordIs", args: ["a"] } }] }), /10 to 4000 characters/],
    ];
    for (const [text, why] of bad) expect(() => readPack(text), text.slice(0, 40)).toThrow(why);
    expect(() => readPack(pack())).not.toThrow(PackError);
  });
});

describe("importing a policy pack", () => {
  it("drafts a pack that only narrows, in shadow for a week, from the policy in force, and leaves that policy alone", async () => {
    const s = setup();
    const file = join(s.d, "stop-loops.pack.json");
    writeFileSync(file, pack());
    const r = await run(s, "import", [file]);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Drafted .*stop-loops-1\.0\.0\.yaml, from .* and the 1 rules of stop-loops 1\.0\.0\./);
    expect(r.text).toMatch(/restrict check: the draft permits nothing the policy in force denies/);
    expect(r.text).toMatch(/starts in SHADOW for 7 days \(until 2026-11-01\)/);
    expect(r.text).toMatch(/--shadow-for 7d/);
    expect(r.text).toMatch(/UNSIGNED: nothing says who wrote this pack/);
    const draft = parsePolicyYaml(readFileSync(join(s.drafts, "stop-loops-1.0.0.yaml"), "utf8"));
    expect(draft.rules.map((x) => x.id)).toEqual(["allow-capped", "stop-loops"]);
    const meta = JSON.parse(readFileSync(join(s.drafts, "stop-loops-1.0.0.meta.json"), "utf8"));
    expect(meta).toMatchObject({ pack: "stop-loops", status: "shadow", shadowUntil: "2026-11-01T12:00:00.000Z", signedBy: null, digest: packDigest(readPack(pack())) });
    expect(readFileSync(s.policy, "utf8")).toBe(CURRENT);
  });

  it("rejects, and writes nothing, a pack that widens, one that reroutes, one that reuses a rule id, and one that is not valid policy", async () => {
    const s = setup();
    // A policy that permits one project only, so that there is something to widen.
    writeFileSync(s.policy, 'version: 1\nrules:\n  - id: allow-capped\n    kind: permit\n    when:\n      project: { in: ["alpha"] }\n');
    const cases: [unknown, RegExp][] = [
      [{ rules: [{ id: "let-beta-in", kind: "permit", when: { project: { in: ["beta"] } } }] }, /would permit something the policy in force denies/],
      [{ rules: [{ id: "cheaper", kind: "route", when: {}, route: { model_map: { "claude-opus-5": "claude-haiku-5-5" } } }] }, /changes which model a request is sent to/],
      [{ rules: [{ id: "allow-capped", kind: "forbid", when: {}, action: "pause_with_checkpoint" }] }, /has the id of a rule already in force/],
      [{ rules: [{ id: "weird", kind: "teleport", when: {} }] }, /not valid policy/],
    ];
    for (const [content, why] of cases) {
      const file = join(s.d, "p.pack.json");
      writeFileSync(file, pack({}, content));
      const r = await run(s, "import", [file]);
      expect(r.code, JSON.stringify(content)).toBe(1);
      expect(r.text).toMatch(/^REJECTED: stop-loops 1\.0\.0 was not imported, and nothing was written\./);
      expect(r.text).toMatch(why);
    }
    expect(existsSync(s.drafts)).toBe(false);
  });

  it("replays a draft over the owner's recent sessions, and says the replay is withheld when there is nothing to replay it on", async () => {
    const s = setup();
    const file = join(s.d, "p.pack.json");
    writeFileSync(file, pack());
    expect((await run(s, "import", [file])).text).toMatch(/replay: withheld, because there are no sessions in the ledger/);
    const db = openLedger(":memory:");
    const logs = join(s.d, "logs");
    mkdirSync(logs);
    const lines = Array.from({ length: 6 }, (_, i) => assistantLine({ id: `m${i}`, ts: `2026-10-2${i % 4}T10:0${i}:00Z`, output: 800, tools: ["Bash"], toolInputs: [{ command: "npm test" }] }));
    writeFileSync(join(logs, "a.jsonl"), `${lines.join("\n")}\n`);
    await ingestClaudeCode(db, [join(logs, "a.jsonl")], testSnapshot());
    const withLedger = await packCommand({ sub: "import", args: [file], flags: { prices: "data/prices/anthropic-litellm-2026-10-22.json", policy: s.policy, draftsDir: join(s.d, "drafts2"), templatesDir: s.templates }, ledger: () => db, env: {}, now: () => new Date("2026-10-26T00:00:00Z") });
    expect(withLedger.code).toBe(0);
    expect(withLedger.text).toMatch(/replay over the last 30 days: 1 sessions?; 0 would have been paused/);
  }, 60_000);

  it("takes in a signed pack only when its signature verifies against a key the owner trusts, and says who signed it", async () => {
    const s = setup();
    const signer = ephemeralSigner();
    const signed = signPack(readPack(pack()), signer);
    const file = join(s.d, "signed.pack.json");
    writeFileSync(file, JSON.stringify(signed));
    const pins = join(s.d, "pins.json");
    writeFileSync(pins, JSON.stringify({ version: 1, keys: [{ keyid: signer.keyid, publicKey: signer.publicKey }] }));
    const noPins = await run(s, "import", [file]);
    expect(noPins).toMatchObject({ code: 1 });
    expect(noPins.text).toMatch(/signed; say which keys you trust/);
    const ok = await run(s, "import", [file], { pins });
    expect(ok.code).toBe(0);
    expect(ok.text).toContain(`Signed by key ${signer.keyid.slice(0, 12)}.`);
    const other = ephemeralSigner();
    const wrong = join(s.d, "wrong-pins.json");
    writeFileSync(wrong, JSON.stringify({ version: 1, keys: [{ keyid: other.keyid, publicKey: other.publicKey }] }));
    expect((await run(s, "import", [file], { pins: wrong })).text).toMatch(/does not verify against any key you trust/);
    const tampered = { ...signed, payload: Buffer.from(Buffer.from(signed.payload, "base64").toString("utf8").replace("1.0.0", "1.0.1")).toString("base64") };
    expect(() => openSignedPack(tampered, [{ keyid: signer.keyid, publicKey: signer.publicKey }])).toThrow(/does not verify/);
    expect(() => openSignedPack({ nope: 1 }, [])).toThrow(/not a signed pack/);
  });

  it("makes a pack from a policy file's rules and shows it, with its digest", async () => {
    const s = setup();
    const src = join(s.d, "stop.yaml");
    writeFileSync(src, "version: 1\nrules:\n  - id: stop-loops\n    kind: forbid\n    when:\n      waste_rule: { in: [\"C-LOOP-1\"] }\n    action: pause_with_checkpoint\n");
    const out = join(s.d, "made.pack.json");
    const made = await run(s, "make", [], { kind: "loop_signature", name: "my-stop", version: "0.1.0", from: src, out, description: "mine" });
    expect(made.text).toMatch(/Wrote .*made\.pack\.json: loop_signature my-stop 0\.1\.0, digest [0-9a-f]{16}, unsigned\./);
    const shown = await run(s, "show", [out]);
    expect(shown.text).toMatch(/loop_signature my-stop 0\.1\.0: 1 rules\nmine\ndigest [0-9a-f]{64}\nUNSIGNED/);
    expect((await run(s, "make", [], { kind: "nope" })).code).toBe(2);
  });
});

describe("importing a canary template", () => {
  const template = pack({ kind: "canary_template", name: "units", version: "1.2.0" }, { tasks: [
    { id: "km", cluster: "units", prompt: "Convert 5 kilometres to metres. Reply with only the number.", check: { kind: "lastNumberIs", args: [5000] } },
    { id: "word", cluster: "text", prompt: "What is the opposite of 'hot'? Reply with one word.", check: { kind: "wordIs", args: ["cold"] } },
  ] });

  it("stores its tasks apart from the pinned pack, which it does not change, and lists them", async () => {
    const s = setup();
    const file = join(s.d, "units.pack.json");
    writeFileSync(file, template);
    const r = await run(s, "import", [file]);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/2 tasks, every check one of the Desk's own kinds/);
    expect(r.text).toMatch(/not added to the Desk's pinned task pack/);
    expect(readdirSync(s.templates)).toEqual(["units-1.2.0.json"]);
    expect((await run(s, "list", [])).text).toContain("canary templates: units-1.2.0.json");
    const bad = join(s.d, "bad.pack.json");
    writeFileSync(bad, pack({ kind: "canary_template", name: "bad" }, { tasks: [{ id: "x", cluster: "units", prompt: "A prompt long enough.", check: { kind: "shell", args: ["ls"] } }] }));
    const rejected = await run(s, "import", [bad]);
    expect(rejected.code).toBe(1);
    expect(rejected.text).toMatch(/not a kind of check the Desk has/);
  });

  it("is run on a model of the owner's choice, one day at a time, into rows of its own", async () => {
    const s = setup();
    const file = join(s.d, "units.pack.json");
    writeFileSync(file, template);
    await run(s, "import", [file]);
    const r = await packCommand({ sub: "run", args: ["units-1.2.0"], flags: { prices: "x", templatesDir: s.templates, model: "strong=m", sample: true }, ledger: () => openLedger(":memory:"), env: { DESK_SWAP_CASSETTES: join(s.d, "none") }, now: () => new Date("2026-10-25T12:00:00Z") });
    expect(r.text).toMatch(/^units 1\.2\.0, day 1, strong: 0 of 0 scored runs right \(2 without a score\)\. Rows are in .*units-1\.2\.0\.runs\.jsonl\.$/);
    expect(readFileSync(join(s.templates, "units-1.2.0.runs.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    expect((await run(s, "run", ["nope"], { model: "a=b" })).code).toBe(2);
    expect((await run(s, "run", ["units-1.2.0"], { model: "bad model" })).code).toBe(2);
  }, 60_000);
});
