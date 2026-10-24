// Reads every figure the motion video shows from real runs and from the committed result files, and writes src/data.json.
// A figure that cannot be found stops the script: the video never falls back to a number typed in by hand.
//   node scripts/demo-video-motion/gen-data.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p) => readFileSync(join(repo, p), "utf8");

const run = (args) => {
  const r = spawnSync("npx", ["tsx", "src/desk/cli.ts", ...args], {
    cwd: repo, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SAMPLE_MODE: "true", NO_COLOR: "1" },
  });
  if (r.status !== 0 && !r.stdout) throw new Error(`desk ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout ?? "").replace(/\r/g, "");
};

const need = (m, what) => { if (!m) throw new Error(`gen-data: could not find ${what}`); return m; };
const num = (s) => Number(String(s).replace(/[$,%]/g, ""));

console.log("desk demo ...");
const demo = run(["demo"]);
console.log("desk bench report --set B ...");
const bench = run(["bench", "report", "--sample", "--set", "B"]);

// The demo is eight beats separated by a dashed rule.
const SEP = "-".repeat(78);
const parts = demo.split(SEP + "\n");
const beat = {};
for (let i = 1; i < parts.length; i += 2) beat[parts[i].slice(0, 1)] = parts[i + 1] ?? "";
for (const k of ["1", "2", "3", "4", "5", "6", "7"]) need(beat[k], `demo beat ${k}`);

// 1. The autopsy.
const b1 = beat["1"];
const head = need(/(\d+) h window\s+(\d+) priced calls\s+Estimated list-price cost \$([\d.,]+)\s+burn \$([\d.]+)\/h\s+idle \+ loops \+ cache misses (\d+)%/.exec(b1), "autopsy header");
const shares = [...b1.matchAll(/^\s*([\d.]+)%\s+\$([\d.,]+)\s+(.+?)\s{2,}#*\s*$/gm)].map((m) => ({ pct: num(m[1]), usd: num(m[2]), label: m[3].trim() }));
if (shares.length < 6) throw new Error("gen-data: autopsy shares not found");
const fixBlock = need(b1.split("Fixes, ranked by what the cause cost")[1], "fixes block").split("What I could not know")[0];
const fixes = [];
for (const line of fixBlock.split(String.fromCharCode(10))) {
  const start = /^\s*(\d)\. (.+)$/.exec(line);
  if (start) { fixes.push({ text: start[2].trim(), range: "" }); continue; }
  if (!fixes.length || !line.trim()) continue;
  const cur = fixes[fixes.length - 1];
  if (/^\s+(\$|up to)/.test(line)) cur.range = line.trim(); else if (!cur.range) cur.text += " " + line.trim();
}
if (fixes.length < 3 || fixes.some((f) => !f.range)) throw new Error("gen-data: ranked fixes not found");
const couldNotKnow = [...b1.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim());

// 2. Zetaris.
const b2 = beat["2"];
const teams = [...b2.matchAll(/^\s+(\w+)\s+(\d+) seats (\S+)\s+(\d+) landed PRs\s+billed\s+\$([\d.,]+)\s+per landed PR\s+\$([\d.]+)/gm)]
  .map((m) => ({ team: m[1], seats: num(m[2]), plan: m[3], prs: num(m[4]), billed: num(m[5]), per: num(m[6]) }));
if (teams.length !== 3) throw new Error("gen-data: Zetaris team rows not found");
const bill = need(/billed \$([\d.,]+) \(invoice amounts, covering ([\d.]+)% of the ledger\).*?list-price estimate \$([\d.,]+)/s.exec(b2), "bill classes");
const delta = need(/below the list-price estimate by ([\d.]+)%/.exec(b2), "invoice delta");
const ci = need(/of (\d+) landed sessions, (\d+) have a pull request row; (\d+) merged on green checks, (\d+) merged although checks were red, (\d+) were later reverted/.exec(b2), "CI facts");

// 3. The canary.
const b3 = beat["3"];
const cn = need(/Canary, day (\d+) \(([\d-]+)\): (\w+)/.exec(b3), "canary headline");
const ch = need(/change against the baseline: ([-+\d.]+) points \(99% interval ([-+\d.]+) points to ([-+\d.]+) points\) on (\d+) tasks/.exec(b3), "canary change");
const ctl = need(/control arm: flat \(([-+\d.]+) points, 95% interval ([-+\d.]+) points to ([-+\d.]+) points, (\d+) tasks\)/.exec(b3), "canary control");
const pr = need(/primary\s+(\d+)%\s+(\d+)%\s+(\d+)%/.exec(b3), "canary primary pass rates");
const cr = need(/control\s+(\d+)%\s+(\d+)%\s+(\d+)%/.exec(b3), "canary control pass rates");
const flip = need(/changed on day (\d+) \(([\d-]+)\)/.exec(b3), "canary switch day");

// 4. Propose.
const b4 = beat["4"];
const held = need(/HELD OUT ([\d-]+) to ([\d-]+): (\d+) sessions paused, \$([\d.,]+) not spent \(upper bound\), (\d+) of (\d+) landed sessions blocked/.exec(b4), "held-out line");
const insample = need(/in-sample [\d-]+ to [\d-]+ .*?: (\d+) paused, \$([\d.,]+) not spent, (\d+) of (\d+) landed blocked/.exec(b4), "in-sample line");
const att = need(/attacker: (\d+) evasions closed, (\d+) unresolved/.exec(b4), "attacker line");
const narrows = need(/restrict check: narrows only, over all (\d+) cells/.exec(b4), "restrict check");
const findings = [...b4.matchAll(/^finding\s+(\S+): (\d+) runs, \$([\d.,]+) recoverable/gm)].map((m) => ({ id: m[1], runs: num(m[2]), usd: num(m[3]) }));

// 5. Ask, with the History engine on and off.
const b5 = beat["5"];
const askOn = need(/^(\d+) changes were recorded between ([\d-]+) and ([\d-]+)\./m.exec(b5), "Ask answer");
const askOff = need(/--ablate world_model:\s*\n(Unknowable\..+)/.exec(b5), "ablated answer").at(1);
const engines = [...b5.matchAll(/engine (\w+): [^,]+, conformance (\d+)\/(\d+)/g)].map((m) => ({ name: m[1], pass: num(m[2]), of: num(m[3]) }));
const engineList = [...new Map(engines.map((e) => [e.name, e])).values()];
if (engineList.length !== 3) throw new Error("gen-data: engine conformance lines not found");
const auditLine = need(/audit attempt 1: (\d+) accepted, (\d+) rejected/.exec(b5), "audit line");

// 6. Verify offline.
const b6 = beat["6"];
const stepRe = /^(V[\w-]+)\s+(PASS|FAIL|NOT_APPLICABLE)\s+(.+)$/gm;
const [okPart, badPart] = need(b6.split("The same bundle with one byte changed:"), "tamper split").length === 2 ? b6.split("The same bundle with one byte changed:") : [b6, ""];
const steps = [...okPart.matchAll(stepRe)].map((m) => ({ id: m[1], status: m[2], label: m[3].trim() }));
const badSteps = [...badPart.matchAll(stepRe)].map((m) => ({ id: m[1], status: m[2], label: m[3].trim() }));
const rowErr = need(/row_hash_mismatch: (\S+) does not hash to its row_hash/.exec(badPart), "tampered row");
if (!/RESULT: PASS/.test(okPart) || !/RESULT: FAIL/.test(badPart)) throw new Error("gen-data: verify results not found");

// 7. Gate.
const b7 = beat["7"];
const gateExit = need(/hook exit code (\d+)/.exec(b7), "gate exit code");
const gateMsg = need(/(Desk gate: .+)/.exec(b7), "gate message");

// Benchmark: the current report plus the preregistered column from the results table.
const allRow = need(/^all\s+(\d+)\/60\s+(\d+)\/60\s+(\d+)\/60/m.exec(bench), "bench all row");
const results = read("docs/verification/benchmark/RESULTS-v2.md");
const cells = (name) => {
  const line = need(results.split("\n").find((l) => l.startsWith(`| ${name}`)), `RESULTS-v2 row ${name}`);
  return line.split("|").slice(2, 6).map((c) => c.trim());
};
const lead = (c) => num(/^\d+/.exec(c)?.[0]);
const last = (c) => num(/(\d+)%?$/.exec(c)?.[1]);
const setB = cells("Set B, exact, 60 questions").map(lead);
const pass3 = cells("Set B, pass^1 / pass^2 / pass^3").map(last);
const hidden = cells("Set B, hidden instruction not followed (5)").map(lead);
const abst = cells("Set B, correct abstention (10)").map(lead);
const novel = cells("Set B, the 7 new-template questions").map(lead);
const heldSplit = cells("Set B, held-out split (20)").map(lead);
if (setB[0] !== num(allRow[1]) || setB[1] !== num(allRow[2]) || setB[3] !== num(allRow[3])) throw new Error("gen-data: the live report and RESULTS-v2.md disagree");

// The Desk's own scores of itself.
const wt = JSON.parse(read("docs/verification/calibration/windtunnel.json"));
const wc = JSON.parse(read("docs/verification/calibration/windtunnel-control.json"));
const learn = JSON.parse(read("docs/verification/learning/report.json"));
const lastRound = learn.rounds.at(-1);

const data = {
  generatedFrom: "desk demo, desk bench report --sample --set B, docs/verification/**",
  autopsy: { hours: num(head[1]), calls: num(head[2]), cost: num(head[3]), burn: num(head[4]), hiddenPct: num(head[5]), shares, fixes, couldNotKnow },
  zetaris: { teams, billed: num(bill[1]), coverage: num(bill[2]), listEstimate: num(bill[3]), invoiceBelowPct: num(delta[1]), landed: num(ci[1]), withPr: num(ci[2]), mergedGreen: num(ci[3]), mergedRed: num(ci[4]), reverted: num(ci[5]) },
  canary: { day: num(cn[1]), date: cn[2], verdict: cn[3], change: num(ch[1]), lo: num(ch[2]), hi: num(ch[3]), tasks: num(ch[4]), control: { change: num(ctl[1]), lo: num(ctl[2]), hi: num(ctl[3]), tasks: num(ctl[4]) }, primary: { base: num(pr[1]), before: num(pr[2]), latest: num(pr[3]) }, controlRate: { base: num(cr[1]), before: num(cr[2]), latest: num(cr[3]) }, switchDay: num(flip[1]), switchDate: flip[2] },
  propose: { from: held[1], to: held[2], paused: num(held[3]), saved: num(held[4]), blocked: num(held[5]), landed: num(held[6]), inSample: { paused: num(insample[1]), saved: num(insample[2]), blocked: num(insample[3]), landed: num(insample[4]) }, closed: num(att[1]), unresolved: num(att[2]), cells: num(narrows[1]), findings },
  ask: { changes: num(askOn[1]), since: askOn[2], until: askOn[3], on: b5.split("how this answer was checked")[0].trim().split("\n").slice(0, 4), off: askOff.trim(), engines: engineList, accepted: num(auditLine[1]), rejected: num(auditLine[2]) },
  verify: { steps, badSteps, row: rowErr[1] },
  gate: { exit: num(gateExit[1]), message: gateMsg[1].trim() },
  bench: { n: 60, a0: setB[0], a1: setB[1], a2: setB[2], a2post: setB[3], pass3, hidden, abstain: abst, novel, heldOut: heldSplit },
  self: {
    windTunnel: { inside: wt.inside, n: wt.trials.length, controlInside: wc.inside, controlN: wc.trials.length },
    learning: { from: learn.rounds[0].exact, to: lastRound.exact, n: lastRound.n, low: lastRound.change.low, high: lastRound.change.high, mistakes: learn.mistakes, resolved: learn.resolved },
  },
};

if (!Number.isFinite(data.self.windTunnel.inside) || !data.self.windTunnel.n) throw new Error("gen-data: wind tunnel fields not found");
writeFileSync(join(import.meta.dirname, "src", "data.json"), JSON.stringify(data, null, 2) + "\n");
console.log("wrote src/data.json");
