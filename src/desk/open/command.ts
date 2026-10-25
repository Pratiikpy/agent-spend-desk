import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

import { importEventsFile, readEventsFile, storeEvents, type EventsImport, type EventsRefusal } from "../ledger/ingest-events.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { loadAdapters, MANIFEST_FILE, parseManifest, runAdapter, testAdapter, writeMissingGoldens, type AdapterTest } from "./adapter.ts";
import { EVENTS_SCHEMA, jsonSchema, parseEvents } from "./events.ts";
import { exportEvents } from "./export.ts";

const n = (x: number): string => x.toLocaleString("en-US");

export const DEFAULT_ADAPTERS_DIR = "adapters";

export interface OpenCommandOptions {
  snapshot: PriceSnapshot;
  out?: string;
  since?: string;
  until?: string;
  tool?: string;
  withPaths?: boolean;
  adaptersDir?: string;
  id?: string;
  toolName?: string;
  sample?: string;
  kind?: string;
  origin?: string;
  writeGolden?: boolean;
  now?: Date;
}

export interface CommandResult {
  ok: boolean;
  text: string;
}

function problemLines(p: { line: number; field: string | null; message: string }[], more: number): string[] {
  const out = p.slice(0, 10).map((x) => `  line ${x.line}${x.field ? `, ${x.field}` : ""}: ${x.message}`);
  const left = p.length - 10 + more;
  if (left > 0) out.push(`  ... and ${n(left)} more`);
  return out;
}

function importText(r: EventsImport | EventsRefusal): CommandResult {
  if ("kind" in r) return { ok: false, text: [`Refused: ${r.reason}.`, ...problemLines(r.problems, r.moreProblems), "Nothing was written."].join("\n") };
  const lines = [`Read ${n(r.sessions)} session${r.sessions === 1 ? "" : "s"} and ${n(r.calls)} call${r.calls === 1 ? "" : "s"} from ${r.tool}: ${n(r.callsNew)} new, ${n(r.callsAlreadyHeld)} already held. Priced at list price from the tokens.`];
  if (r.withReportedCost > 0) lines.push(`${n(r.withReportedCost)} carry a cost the tool reported; it is kept beside the estimate, never in place of it.`);
  if (r.cacheWriteUnsplit > 0) lines.push(`${n(r.cacheWriteUnsplit)} cache write${r.cacheWriteUnsplit === 1 ? "" : "s"} did not say how long it is kept and are priced as 5-minute writes.`);
  if (r.unpricedCalls > 0) lines.push(`${n(r.unpricedCalls)} call${r.unpricedCalls === 1 ? "" : "s"} on a model with no price (${Object.keys(r.unpricedModels).slice(0, 3).join(", ")}): the tokens are counted and no dollars are invented.`);
  return { ok: true, text: lines.join("\n") };
}

/** `desk events ...`: check, import, export and describe the open ledger format. */
export async function eventsCommand(args: readonly string[], db: Ledger | null, o: OpenCommandOptions): Promise<CommandResult> {
  const [sub, ...rest] = args;
  if (sub === "schema") return { ok: true, text: JSON.stringify(jsonSchema(), null, 2) };
  if (sub === "validate") {
    if (rest.length === 0) throw new Error("Use: desk events validate <file.jsonl>");
    let ok = true;
    const out: string[] = [];
    for (const f of rest) {
      if (!existsSync(f)) {
        out.push(`${f}: no such file.`);
        ok = false;
        continue;
      }
      const p = await readEventsFile(f);
      if (p.problems.length > 0) {
        ok = false;
        out.push(`${f}: not a valid ${EVENTS_SCHEMA} file.`, ...problemLines(p.problems, p.moreProblems));
      } else out.push(`${f}: valid ${EVENTS_SCHEMA}: header from ${p.header?.tool}, ${n(p.sessions.length)} session${p.sessions.length === 1 ? "" : "s"}, ${n(p.calls.length)} call${p.calls.length === 1 ? "" : "s"}.`);
    }
    return { ok, text: out.join("\n") };
  }
  if (sub === "import") {
    if (rest.length === 0) throw new Error("Use: desk events import <file.jsonl> ...");
    if (db === null) throw new Error("events import needs a ledger");
    const parts: CommandResult[] = [];
    for (const f of rest) {
      if (!existsSync(f)) {
        parts.push({ ok: false, text: `${f}: no such file.` });
        continue;
      }
      parts.push(importText(await importEventsFile(db, f, o.snapshot, o.now ? () => o.now as Date : undefined)));
    }
    return { ok: parts.every((p) => p.ok), text: parts.map((p) => p.text).join("\n\n") };
  }
  if (sub === "export") {
    if (db === null) throw new Error("events export needs a ledger");
    if (!o.out) throw new Error("Use: desk events export --output <file.jsonl> [--since DATE] [--until DATE] [--tool NAME] [--with-paths]");
    if (existsSync(o.out)) return { ok: false, text: `${o.out} already exists; the export will not overwrite a file. Name a new one.` };
    const r = exportEvents(db, o.out, { ...(o.since ? { since: o.since } : {}), ...(o.until ? { until: o.until } : {}), ...(o.tool ? { tool: o.tool } : {}), ...(o.withPaths ? { withPaths: true } : {}), ...(o.now ? { now: o.now } : {}) });
    if (typeof r === "string") return { ok: false, text: r };
    const check = await readEventsFile(o.out);
    if (check.problems.length > 0) return { ok: false, text: [`The file was written and does not read back as ${EVENTS_SCHEMA}:`, ...problemLines(check.problems, check.moreProblems)].join("\n") };
    return {
      ok: true,
      text: [
        `Wrote ${n(r.calls)} calls in ${n(r.sessions)} sessions to ${o.out} as ${EVENTS_SCHEMA}, and read it back clean.`,
        r.withPaths ? "Folders and branches are included." : "Folders and branches are left out (add --with-paths to include them).",
        "It holds tokens, times, models and what a source reported as a cost: no estimate, no prompt, no tool result.",
        r.skipped > 0 ? `${n(r.skipped)} call${r.skipped === 1 ? "" : "s"} could not be written as an event (a value over the format's limits) and ${r.skipped === 1 ? "was" : "were"} left out.` : "",
      ].filter((l) => l !== "").join("\n"),
    };
  }
  throw new Error("Use: desk events validate <file> | import <file...> | export --output <file> | schema");
}

function describeTest(t: AdapterTest): string[] {
  const head = t.loaded ? `LOADED   ${t.id}${t.illustrative ? "  (illustrative: tested, will not import)" : ""}` : `REFUSED  ${t.id ?? t.dir}`;
  const lines = [head];
  if (t.refusal) lines.push(`  ${t.refusal}`);
  for (const f of t.fixtures) lines.push(`  ${f.ok ? "ok  " : "FAIL"} ${f.input}: ${f.detail}`);
  for (const x of t.notes) lines.push(`  ${x}`);
  return lines;
}

/** `desk adapters ...`: test and use adapters for tools the Desk does not read itself. */
export async function adaptersCommand(args: readonly string[], db: Ledger | null, o: OpenCommandOptions): Promise<CommandResult> {
  const [sub, ...rest] = args;
  const root = o.adaptersDir ?? DEFAULT_ADAPTERS_DIR;
  if (sub === undefined || sub === "list") {
    const dir = rest[0] ?? root;
    if (!existsSync(dir)) return { ok: true, text: `No adapters folder at ${dir}. An adapter is a folder with an ${MANIFEST_FILE}; desk adapters init <folder> starts one.` };
    const set = loadAdapters(dir);
    if (set.tested.length === 0) return { ok: true, text: `No adapter folders in ${dir}.` };
    return { ok: set.tested.every((t) => t.loaded !== null), text: [...set.tested.flatMap(describeTest), "", `${set.loaded.length} of ${set.tested.length} adapters loaded. An adapter that fails its fixtures is not loaded.`].join("\n") };
  }
  if (sub === "test") {
    if (!rest[0]) throw new Error("Use: desk adapters test <adapter folder> [--write-golden]");
    if (o.writeGolden) {
      const written = writeMissingGoldens(rest[0]);
      if ("error" in written) return { ok: false, text: written.error };
      const t0 = testAdapter(rest[0]);
      return { ok: t0.loaded !== null, text: [...written.lines, ...describeTest(t0)].join("\n") };
    }
    const t = testAdapter(rest[0]);
    return { ok: t.loaded !== null, text: describeTest(t).join("\n") };
  }
  if (sub === "import") {
    if (rest.length < 2) throw new Error("Use: desk adapters import <adapter folder> <file> ...");
    if (db === null) throw new Error("adapters import needs a ledger");
    const t = testAdapter(rest[0] as string);
    if (!t.loaded) return { ok: false, text: ["The adapter is not loaded, so nothing was read.", ...describeTest(t)].join("\n") };
    const parts: CommandResult[] = [];
    for (const f of rest.slice(1)) {
      if (!existsSync(f)) {
        parts.push({ ok: false, text: `${f}: no such file.` });
        continue;
      }
      const ran = runAdapter(t.loaded, f);
      if ("error" in ran) {
        parts.push({ ok: false, text: `${f}: ${ran.error}` });
        continue;
      }
      const parsed = parseEvents(ran.text);
      const r = storeEvents(db, parsed, f, statSync(f).size, createHash("sha256").update(readFileSync(f)).digest("hex"), o.snapshot, o.now ? () => o.now as Date : undefined);
      const base = importText(r);
      parts.push({ ok: base.ok, text: [`${basename(f)} (read by adapter ${t.loaded.manifest.id} ${t.loaded.manifest.version}):`, base.text, ...ran.notes.map((x) => `  adapter note: ${x}`)].join("\n") });
    }
    return { ok: parts.every((p) => p.ok), text: parts.map((p) => p.text).join("\n\n") };
  }
  if (sub === "init") {
    const dir = rest[0];
    if (!dir || !o.id || !o.toolName || !o.sample || !o.origin) throw new Error('Use: desk adapters init <folder> --id <id> --tool "<tool name>" --from <a real file from the tool> --origin "<tool, version, when captured>" [--kind real|constructed]');
    return initAdapter(dir, o);
  }
  throw new Error("Use: desk adapters list [folder] | test <folder> [--write-golden] | import <folder> <file...> | init <folder> ...");
}

function initAdapter(dir: string, o: OpenCommandOptions): CommandResult {
  const target = resolve(dir);
  if (existsSync(join(target, MANIFEST_FILE))) return { ok: false, text: `${target} already holds an adapter.` };
  if (!existsSync(o.sample as string)) return { ok: false, text: `The sample ${o.sample} does not exist. An adapter is started from a real file of the tool it reads.` };
  const kind = o.kind ?? "real";
  if (kind !== "real" && kind !== "constructed") return { ok: false, text: '--kind is "real" or "constructed".' };
  const sampleName = `fixtures/${basename(o.sample as string)}`;
  mkdirSync(join(target, "fixtures"), { recursive: true });
  copyFileSync(o.sample as string, join(target, sampleName));
  const sha = createHash("sha256").update(readFileSync(join(target, sampleName))).digest("hex");
  const manifest = {
    id: o.id, tool: o.toolName, version: "0.1.0", description: `Reads ${o.toolName} files.`, license: "MIT", schema: EVENTS_SCHEMA, entry: "adapter.mjs",
    sample: { file: sampleName, sha256: sha, kind, origin: o.origin, capturedAt: (o.now ?? new Date()).toISOString().slice(0, 10) },
    fixtures: [{ input: sampleName, golden: `fixtures/${basename(o.sample as string)}.golden.jsonl` }],
  };
  const checked = parseManifest(manifest);
  if (!checked.ok) return { ok: false, text: checked.error };
  writeFileSync(join(target, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(target, "adapter.mjs"),
    [
      `// ${o.toolName}: an adapter for the Desk (desk.events/1). Two pure functions; see docs/adapter-sdk.md.`,
      "export default {",
      "  // True when the first bytes of a file look like this tool's. It must say false for anything else.",
      "  detect(head) {",
      "    return false;",
      "  },",
      "  // Turn a whole file into { sessions, calls, notes }. No clock, randomness, network or other file. Say in notes what was skipped; never skip quietly.",
      "  parse(text, ctx) {",
      "    return { sessions: [], calls: [], notes: [] };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  return {
    ok: true,
    text: [
      `Started ${target}: a manifest pinned to the sample (SHA-256 ${sha.slice(0, 12)}), and a stub adapter.mjs that recognises nothing.`,
      `Next: write detect and parse against the sample, write the golden output by hand or with desk adapters test ${dir} --write-golden and read it against the sample, then run desk adapters test ${dir}.`,
    ].join("\n"),
  };
}
