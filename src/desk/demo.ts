import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { askCommand } from "./ask/command.ts";
import { canaryCommand, SAMPLE_RUNS } from "./canary/command.ts";
import { approve } from "./dossier/command.ts";
import { Gate } from "./gate/gate.ts";
import { startGateServer } from "./gate/http.ts";
import { runHook } from "./gate/hook.ts";
import { fixedPolicy } from "./gate/policy-source.ts";
import { loadSnapshot } from "./pricing/pricebook.ts";
import { parsePolicyYaml } from "./policy/parse.ts";
import { proposeCommand } from "./propose/command.ts";
import { runCard } from "./card/run.ts";
import { silosCommand } from "./silo/command.ts";
import { readBundleDir } from "./verify/read-dir.ts";
import { formatReport } from "./verify/report.ts";
import { verifyBundle } from "./verify/verify.ts";
import { buildSample, DEFAULT_SAMPLE } from "./sample/gen.ts";

/**
 * The demo, offline, in the order of the video script (docs/submission/demo-video-script.md). Every beat runs the
 * real command on the constructed sample with recorded model replies and recorded Zetaris answers, so it needs no
 * key, no network and no container, and finishes in well under four minutes. Nothing here is a canned output.
 */
export interface DemoOptions {
  sampleDir: string;
  prices: string;
  cassetteDir: string;
  out: (text: string) => void;
}

const SEP = "-".repeat(78);

export async function demo(o: DemoOptions): Promise<void> {
  const say = o.out;
  const beat = (n: string, title: string, caption: string): void => say(`\n${SEP}\n${n}  ${title}\n${caption}\n${SEP}`);
  const started = Date.now();
  if (!requireSample(o.sampleDir)) buildSample({ ...DEFAULT_SAMPLE, outDir: o.sampleDir });

  beat("1/8", "Where did my limit go?", "A constructed scenario. Every figure below is computed from it by the same code that reads your logs.");
  const card = await runCard({ mode: "sample", claudeDir: "", dbPath: "", pricesPath: o.prices, outDir: join(o.sampleDir, "card"), sampleDir: o.sampleDir, days: 14, hours: 5, repos: [], color: false, width: 100 });
  say(card.text);

  beat("2/8", "The bill, through Zetaris", "Invoices (files), CI (Postgres) and roster (REST) joined by one statement. Recorded from a live run on the local Zetaris instance.");
  say(await silosCommand({ dbPath: join(o.sampleDir, "ledger.db"), cassetteDir: o.cassetteDir, sampleMode: true, record: false, disabled: false, env: {} }));

  beat("3/8", "The canary", "Real runs of a task pack, one a day. Constructed: the model behind the primary arm was switched on purpose on day 15, so there is a regression to find.");
  say(canaryCommand({ runsPath: SAMPLE_RUNS, sample: true }).text);

  beat("4/8", "Propose, check, attack, then replay on a month the draft never saw", "The policy is drafted from September and replayed on October. If it blocks landed work, that is the headline.");
  const root = mkdtempSync(join(tmpdir(), "desk-demo-"));
  try {
    const dossier = { dbPath: join(root, "d.db"), pendingDir: join(root, "pending"), outDir: join(root, "out"), keyPath: join(root, "keys", "signer.pem") };
    const proposal = await proposeCommand({ dbPath: join(o.sampleDir, "ledger.db"), pricesPath: o.prices, policyPath: "policies/daily-cap.yaml", minUsd: "2.00", cassetteDir: o.cassetteDir, record: false, sampleMode: true, personFromBranch: true, outDir: join(root, "proposals"), dossier, env: {} });
    say(proposal);

    beat("5/8", "Ask, with the engines on and off", "The same question, answered from the History engine, then with it switched off.");
    const ask = (ablate?: string) => askCommand({ dbPath: join(o.sampleDir, "ledger.db"), question: "What changed before 2026-10-15?", ablate, noModel: false, record: false, sampleMode: true, cassetteDir: o.cassetteDir, memoryDir: join(root, "memory"), env: {} });
    say(await ask());
    say("\n--ablate world_model:");
    say(await ask("world_model"));

    beat("6/8", "Approve by echoing the digest, then verify offline", "The owner approves; a signed dossier is written; the verifier runs on plain Node with no network.");
    const m = /desk approve (\S+) (\S+)/.exec(proposal);
    if (m) {
      const done = approve(m[1]!, m[2]!, dossier);
      say(done.text);
      if (done.dir) {
        const files = readBundleDir(done.dir);
        const tampered = new Map(files);
        const name = [...tampered.keys()].find((k) => k.endsWith("replay_heldout.jsonl"))!;
        const bytes = new Uint8Array(tampered.get(name)!);
        bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)]! ^ 1;
        tampered.set(name, bytes);
        const pins = JSON.parse(readFileSync(join(dossier.outDir, `${m[1]!.slice(0, 8)}.pins.json`), "utf8")) as unknown;
        say("\nThe same bundle with one byte changed:");
        say(formatReport(verifyBundle(tampered, { pins }), "tampered copy").split("\n").filter((l) => /FAIL|RESULT|mismatch/.test(l)).join("\n"));
      }
    } else say("No approval request was issued, so nothing was approved.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  beat("7/8", "The gate blocks a call", "The same hook adapter Claude Code runs, against a real local gate with a policy that permits nothing. The run against the real Claude Code is recorded in docs/verification/gate-enforcement.md.");
  const db = new DatabaseSync(":memory:");
  const gate = new Gate({ db, prices: loadSnapshot(o.prices), policy: fixedPolicy(parsePolicyYaml("version: 1\nrules:\n  - { id: only-nothing, kind: permit, when: { model: { in: [never-used] } } }\n")), person: "demo" });
  const token = ["demo", "gate", "bearer", "0123456789"].join("-");
  const server = await startGateServer({ gate, token });
  try {
    const hook = await runHook(JSON.stringify({ hook_event_name: "PreToolUse", session_id: "demo", tool_name: "Bash", cwd: "demo" }), { DESK_GATE_TOKEN: token, DESK_GATE_URL: server.url });
    say(`hook exit code ${hook.exitCode}\n${hook.stderr.trim()}`);
  } finally {
    await server.close();
  }

  beat("8/8", "Run it on your own logs", "desk card   reads your agent logs, read-only, and writes your own limit autopsy. Nothing leaves this machine.");
  say(`demo finished in ${((Date.now() - started) / 1000).toFixed(0)} s, offline.`);
}

function requireSample(dir: string): boolean {
  try {
    return readFileSync(join(dir, "truth.json"), "utf8").length > 0;
  } catch {
    return false;
  }
}
