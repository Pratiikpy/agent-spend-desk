import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { ModelError } from "../agents/model.ts";
import { appendRows, readRows } from "../canary/store.ts";
import { runPack } from "../canary/runner.ts";
import { loadOrCreateSigner, defaultKeyPath } from "../dossier/keys.ts";
import type { Ledger } from "../ledger/db.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { portFor } from "../replay/command.ts";
import { importPolicyPack, SHADOW_DAYS } from "./import.ts";
import { openSignedPack, packDigest, readPack, signPack, tasksOf, PACK_KINDS, PackError, type Pack, type PackKind } from "./pack.ts";

export interface PackFlags {
  kind?: string;
  name?: string;
  version?: string;
  from?: string;
  description?: string;
  author?: string;
  sign?: boolean;
  out?: string;
  policy?: string;
  pins?: string;
  model?: string;
  repeats?: string;
  prices: string;
  sample?: boolean;
  /** Where drafts and imported templates go; the folders under the working directory by default. */
  draftsDir?: string;
  templatesDir?: string;
}

export const DRAFTS_DIR = "policies/drafts";
export const TEMPLATES_DIR = "data/desk/canary-templates";

function load(path: string, pins?: string): { pack: Pack; signedBy: string | null } {
  const text = readFileSync(path, "utf8");
  const parsed = JSON.parse(text) as { payloadType?: string };
  if (parsed.payloadType) {
    if (!pins) throw new PackError("this pack is signed; say which keys you trust with --pins FILE");
    const keys = (JSON.parse(readFileSync(pins, "utf8")) as { keys: { keyid: string; publicKey: string }[] }).keys;
    const r = openSignedPack(parsed, keys);
    return { pack: r.pack, signedBy: r.keyid };
  }
  return { pack: readPack(text), signedBy: null };
}

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

/** `desk pack`: rules and canary templates that someone else wrote, taken in the way any edit is: checked, replayed, and started in shadow. */
export async function packCommand(o: { sub: string | undefined; args: string[]; flags: PackFlags; ledger: () => Ledger; env: Record<string, string | undefined>; now?: () => Date }): Promise<{ text: string; code: number }> {
  const sub = o.sub ?? "help";
  const now = o.now ?? (() => new Date());
  try {
    if (sub === "make") {
      const f = o.flags;
      if (!f.kind || !(PACK_KINDS as readonly string[]).includes(f.kind) || !f.name || !f.version || !f.from) return { text: `Make a pack from a file: desk pack make --kind ${PACK_KINDS.join("|")} --name NAME --version 1.0.0 --from FILE [--description TEXT] [--author NAME] [--sign] [--output FILE]. A policy pack is made from a policy file's rules; a canary template from a JSON file of tasks.`, code: 2 };
      const source = readFileSync(f.from, "utf8");
      const content = f.kind === "canary_template" ? { tasks: (JSON.parse(source) as { tasks?: unknown }).tasks ?? JSON.parse(source) } : { rules: (parseYaml(source) as { rules?: unknown[] }).rules ?? [] };
      const pack = readPack(JSON.stringify({ schema: "desk.pack.v1", kind: f.kind as PackKind, name: f.name, version: f.version, description: f.description ?? "", ...(f.author ? { author: f.author } : {}), content }));
      const out = f.out ?? `${pack.name}-${pack.version}.pack.json`;
      writeFileSync(out, `${JSON.stringify(f.sign ? signPack(pack, loadOrCreateSigner(defaultKeyPath(o.env)).signer) : pack, null, 2)}\n`);
      return { text: `Wrote ${out}: ${pack.kind} ${pack.name} ${pack.version}, digest ${packDigest(pack).slice(0, 16)}${f.sign ? ", signed with your key" : ", unsigned"}.`, code: 0 };
    }
    const file = o.args[0];
    if (sub === "show") {
      if (!file) return { text: "Name a pack file: desk pack show FILE [--pins FILE]", code: 2 };
      const { pack, signedBy } = load(file, o.flags.pins);
      const n = pack.kind === "canary_template" ? `${(pack.content as { tasks: unknown[] }).tasks.length} tasks` : `${(pack.content as { rules: unknown[] }).rules.length} rules`;
      return { text: [`${pack.kind} ${pack.name} ${pack.version}: ${n}`, pack.description, `digest ${packDigest(pack)}`, signedBy ? `signed by key ${signedBy.slice(0, 12)}` : "UNSIGNED: nothing says who wrote it"].filter(Boolean).join("\n"), code: 0 };
    }
    if (sub === "import") {
      if (!file) return { text: "Name a pack file: desk pack import FILE [--policy policies/daily-cap.yaml] [--pins FILE]", code: 2 };
      const { pack, signedBy } = load(file, o.flags.pins);
      if (pack.kind === "canary_template") {
        const tasks = tasksOf(pack);
        const dir = o.flags.templatesDir ?? TEMPLATES_DIR;
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${pack.name}-${pack.version}.json`);
        writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`);
        return { text: [`Imported the canary template ${pack.name} ${pack.version}: ${tasks.length} tasks, every check one of the Desk's own kinds. Written to ${path}.`, "It is its own set of tasks. It is not added to the Desk's pinned task pack, which would change that pack's name and restart its baseline.", `desk pack run ${pack.name}-${pack.version} --model NAME=MODEL runs it.`, signedBy ? `Signed by key ${signedBy.slice(0, 12)}.` : "UNSIGNED: nothing says who wrote it."].join("\n"), code: 0 };
      }
      const policy = o.flags.policy ?? "policies/daily-cap.yaml";
      const r = importPolicyPack(pack, { currentPolicyPath: policy, draftsDir: o.flags.draftsDir ?? DRAFTS_DIR, ledger: o.ledger(), snapshot: loadSnapshot(o.flags.prices), now, signedBy });
      if (r.status === "rejected") return { text: [`REJECTED: ${pack.name} ${pack.version} was not imported, and nothing was written.`, ...r.reasons.map((x) => `  ${x}`)].join("\n"), code: 1 };
      const lines = [`Drafted ${r.draftPath}, from ${policy} and the ${(pack.content as { rules: unknown[] }).rules.length} rules of ${pack.name} ${pack.version}.`];
      lines.push(`restrict check: the draft permits nothing the policy in force denies (${r.restrict?.gridSize.toLocaleString("en-US")} cells checked)${r.restrict?.mergedDims.length ? `; dimensions in no rule: ${r.restrict.mergedDims.join(", ")}` : ""}.`);
      if (r.replay && "withheld" in r.replay) lines.push(`replay: withheld, because ${r.replay.withheld}`);
      else if (r.replay) lines.push(`replay over the last 30 days: ${r.replay.sessions} sessions; ${r.replay.paused} would have been paused, ${usd(r.replay.savedMicros)} not spent at most, ${r.replay.landedBlocked} of ${r.replay.landedTotal} landed sessions blocked; ${r.replay.asked} calls would have asked and ${r.replay.denied} been denied.`);
      lines.push(`It starts in SHADOW for ${SHADOW_DAYS} days (until ${r.shadowUntil?.slice(0, 10)}): run it with desk gate serve --policy ${r.draftPath} --shadow-for ${SHADOW_DAYS}d, and it records what it would have denied and denies nothing.`);
      lines.push(r.unsigned ? "UNSIGNED: nothing says who wrote this pack." : `Signed by key ${signedBy?.slice(0, 12)}.`);
      return { text: lines.join("\n"), code: 0 };
    }
    if (sub === "list") {
      const out: string[] = [];
      const drafts = o.flags.draftsDir ?? DRAFTS_DIR;
      const templates = o.flags.templatesDir ?? TEMPLATES_DIR;
      for (const [dir, label] of [[drafts, "draft policies, in shadow"], [templates, "canary templates"]] as const) {
        if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => (dir === drafts && x.endsWith(".meta.json")) || (dir === templates && x.endsWith(".json") && !x.endsWith(".meta.json")))) out.push(`${label}: ${f}`);
      }
      return { text: out.length > 0 ? out.join("\n") : "No pack has been imported.", code: 0 };
    }
    if (sub === "run") {
      const name = file ?? "";
      const tdir = o.flags.templatesDir ?? TEMPLATES_DIR;
      const path = join(tdir, `${name}.json`);
      if (!existsSync(path)) return { text: `No imported template ${JSON.stringify(name)}. desk pack list shows them.`, code: 2 };
      const m = /^([a-z0-9][a-z0-9-]*)=(.+)$/.exec(o.flags.model ?? "");
      if (!m) return { text: "Say which model: --route-model name=model, such as --route-model strong=nvidia/nemotron-3.5-super-vl-120b-a12b", code: 2 };
      const pack = readPack(readFileSync(path, "utf8"));
      const tasks = tasksOf(pack);
      const repeats = o.flags.repeats ? Number(o.flags.repeats) : 1;
      const runsPath = join(tdir, `${name}.runs.jsonl`);
      const day = (readRows(runsPath).rows.reduce((mx, r) => Math.max(mx, r.day), 0) || 0) + 1;
      const port = portFor(m[2] as string, o.env, o.env["DESK_SWAP_CASSETTES"] ?? "data/desk/replay-cassettes", o.flags.sample === true);
      const rows = await runPack({ port, arm: "primary", day, date: now().toISOString().slice(0, 10), tasks, repeats, concurrency: 2 });
      appendRows(runsPath, rows);
      const scored = rows.filter((r) => r.score !== null);
      const pass = scored.filter((r) => r.score === 1).length;
      return { text: `${pack.name} ${pack.version}, day ${day}, ${m[1]}: ${pass} of ${scored.length} scored runs right (${rows.length - scored.length} without a score). Rows are in ${runsPath}.`, code: 0 };
    }
  } catch (e) {
    return { text: `${e instanceof PackError ? "" : e instanceof ModelError ? "The model could not be reached: " : "Could not " + sub + ": "}${(e as Error).message}`, code: 1 };
  }
  return { text: ["desk pack: rules and canary templates someone else wrote, taken in the way any edit is", "  make --kind K --name N --version V --from FILE [--sign] [--output FILE]", "  show FILE | import FILE [--policy FILE] [--pins FILE] | list | run NAME --route-model name=model [--repeats N]", "  a policy pack is rejected if it widens anything or changes a route; what passes is replayed and starts in shadow"].join("\n"), code: 0 };
}
