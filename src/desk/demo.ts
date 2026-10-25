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
import { compareDemo, ledgerFigures, renderComparison } from "./demo-figures.ts";
import { routeCommand } from "./route/command.ts";
import { openLedger } from "./ledger/db.ts";
import { loadAutopsyCalls } from "./autopsy/load.ts";
import { wasteCommand } from "./waste/command.ts";
import { silosCommand } from "./silo/command.ts";
import { readBundleDir } from "./verify/read-dir.ts";
import { formatReport } from "./verify/report.ts";
import { verifyBundle } from "./verify/verify.ts";
import { buildSample, DEFAULT_SAMPLE } from "./sample/gen.ts";

/**
 * The demo, offline, in the order of the video script (docs/submission/demo-video-script.md). Every beat runs the
 * real command on the constructed sample with recorded model replies and recorded Zetaris answers, so it needs no
 * key, no network and no container, and finishes in well under four minutes. Nothing here is a canned output.
 *
 * The scenes (DF-014 to DF-018, DF-114): an opening that asks the question every user has, scene 0 the month's headline, scene 1 the biggest waste block, scene 2 the canary, scene 3
 * a cheaper route, scene 4 the argument, the check, the approval, the offline verifier and the gate, and a closing that tells the judge how to run it on their own logs. With
 * `mutate` or `compare` the same figures are computed on a changed sample so that every number that depends on the change can be seen to move (DF-019).
 */
export interface DemoOptions {
  sampleDir: string;
  prices: string;
  cassetteDir: string;
  out: (text: string) => void;
  /** Run the scenes' figures on a changed sample (this seed, no planted tool change, a canary in which the model never changed) and print the two side by side. */
  mutate?: number;
  compare?: boolean;
  runsPath?: string;
}

const SEP = "-".repeat(78);

export async function demo(o: DemoOptions): Promise<void> {
  const say = o.out;
  const beat = (n: string, title: string, caption: string): void => say(`\n${SEP}\n${n}  ${title}\n${caption}\n${SEP}`);
  const started = Date.now();
  if (!requireSample(o.sampleDir)) buildSample({ ...DEFAULT_SAMPLE, outDir: o.sampleDir });
  if (o.mutate !== undefined || o.compare) {
    say(renderComparison(await compareDemo({ sampleDir: o.sampleDir, prices: o.prices, runsPath: o.runsPath ?? SAMPLE_RUNS, seed: o.mutate ?? 20261101 })));
    say(`compared in ${((Date.now() - started) / 1000).toFixed(0)} s, offline.`);
    return;
  }

  beat("Opening", "Where did my limit go?", "You pay for a coding agent, work for two hours, and \"limit reached\" appears. A constructed scenario: every figure below is computed from it by the same code that reads your logs.");
  const card = await runCard({ mode: "sample", claudeDir: "", dbPath: "", pricesPath: o.prices, outDir: join(o.sampleDir, "card"), sampleDir: o.sampleDir, days: 14, hours: 5, repos: [], color: false, width: 100 });
  say(card.text);

  beat("Scene 0", "The question", "The month's headline, with the class of every dollar printed beside it. These are estimates from a price list, not an invoice.");
  for (const f of (await ledgerFigures(o.sampleDir, o.prices)).filter((x) => x.scene === "0")) say(`${f.label}: ${f.value}`);

  beat("Scene 1", "The biggest waste block", "The rules that read the log directly, each with its parameters. The block at the top is the one to open.");
  {
    const ledger = openLedger(join(o.sampleDir, "ledger.db"));
    try {
      const snapshot = loadSnapshot(o.prices);
      const times = loadAutopsyCalls(ledger, snapshot, "0000", "9999").map((c) => c.tsMs);
      const from = new Date(Math.min(...times)).toISOString();
      const to = new Date(Math.max(...times) + 1).toISOString();
      say(wasteCommand(ledger, snapshot, from, to).text);
      for (const f of (await ledgerFigures(o.sampleDir, o.prices)).filter((x) => x.id === "waste.biggest")) say(`
${f.label}: ${f.value}. Open that session to see the rule and the calls it flagged.`);
    } finally {
      ledger.close();
    }
  }

  beat("Scene 1b", "The bill, through Zetaris", "Invoices (files), CI (Postgres) and roster (REST) joined by one statement. Recorded from a live run on the local Zetaris instance.");
  say(await silosCommand({ dbPath: join(o.sampleDir, "ledger.db"), cassetteDir: o.cassetteDir, sampleMode: true, record: false, disabled: false, env: {} }));

  beat("Scene 2", "The canary", "Real runs of a task pack, one a day. Constructed: the model behind the primary arm was switched on purpose on day 15, so there is a regression to find.");
  say(canaryCommand({ runsPath: o.runsPath ?? SAMPLE_RUNS, sample: true }).text);

  beat("Scene 3", "A cheaper route", "The same task pack on two models: what the cheaper one gives up, with an interval, and the kinds of task it holds up on.");
  say(routeCommand({ runsPath: o.runsPath ?? SAMPLE_RUNS, tolerance: 0.1 }));

  beat("Scene 4", "The argument: propose, check, attack, then replay on a month the draft never saw", "The policy is drafted from September and replayed on October. If it blocks landed work, that is the headline.");
  const root = mkdtempSync(join(tmpdir(), "desk-demo-"));
  // The demo works in a temporary folder whose path holds the user's home; the screen shows a name instead.
  const scrub = (text: string): string => text.split(root).join("<demo-dir>").split(root.replaceAll("\\", "/")).join("<demo-dir>");
  try {
    const dossier = { dbPath: join(root, "d.db"), pendingDir: join(root, "pending"), outDir: join(root, "out"), keyPath: join(root, "keys", "signer.pem") };
    const proposal = await proposeCommand({ dbPath: join(o.sampleDir, "ledger.db"), pricesPath: o.prices, policyPath: "policies/daily-cap.yaml", minUsd: "2.00", cassetteDir: o.cassetteDir, record: false, sampleMode: true, personFromBranch: true, outDir: join(root, "proposals"), dossier, env: {} });
    say(scrub(proposal));

    beat("Scene 4b", "Ask, with the engines on and off", "The same question, answered from the History engine, then with it switched off.");
    const ask = (ablate?: string) => askCommand({ dbPath: join(o.sampleDir, "ledger.db"), question: "What changed before 2026-10-15?", ablate, noModel: false, record: false, sampleMode: true, cassetteDir: o.cassetteDir, memoryDir: join(root, "memory"), env: {} });
    say(await ask());
    say("\n--ablate world_model:");
    say(await ask("world_model"));

    beat("Scene 4c", "Approve by echoing the digest, then verify offline", "The owner approves; a signed dossier is written; the verifier runs on plain Node with no network.");
    const m = /desk approve (\S+) (\S+)/.exec(proposal);
    if (m) {
      const done = approve(m[1]!, m[2]!, dossier);
      say(scrub(done.text));
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

  beat("Scene 4d", "The gate blocks a call", "The same hook adapter Claude Code runs, against a real local gate with a policy that permits nothing. The run against the real Claude Code is recorded in docs/verification/gate-enforcement.md.");
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

  beat("Closing", "Run it on your own logs", "Run `desk` on your own logs right now: it reads them read-only and writes your own result card in about three minutes. Nothing leaves this machine. To see every number above move, run `desk demo --compare`.");
  say(`demo finished in ${((Date.now() - started) / 1000).toFixed(0)} s, offline.`);
}

function requireSample(dir: string): boolean {
  try {
    return readFileSync(join(dir, "truth.json"), "utf8").length > 0;
  } catch {
    return false;
  }
}
