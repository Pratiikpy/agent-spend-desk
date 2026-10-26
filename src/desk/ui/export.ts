import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

import { staticMap, type UiServer } from "./server.ts";

/**
 * `desk ui --export DIR`: a copy of the screens that needs no server. The screens are the same files; every answer the running server gives to the requests a visitor
 * can reach by following the screens' own links and selectors is written to a file of its own under `data/`, and the page, told by a `desk-static` meta tag, reads its answer
 * from that file instead of asking a server. A request that was not recorded gets a plain message, not a guess. Only the constructed sample is exported: the copy holds no key, no
 * token and no path of the machine it was made on.
 */
const RANGES = ["7", "14", "30", "90", "all"];
const SORTS = ["cost", "recent", "calls"];
const MAX_SESSIONS = 12;

/** The key the page looks an answer up by: the path and the non-empty parameters, sorted, as the server names its own cache. */
export function keyOf(path: string, params: Record<string, string> = {}): string {
  const pairs = Object.entries(params).filter(([, v]) => v !== "").sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${pairs.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

/** The file an answer is kept in: the first 24 hex characters of the SHA-256 of its key, so that no answer is larger than one file and none shares a name. */
export function fileFor(key: string): string {
  return `${createHash("sha256").update(key).digest("hex").slice(0, 24)}.json`;
}

export interface ExportResult {
  entries: number;
  bytes: number;
  files: number;
  skipped: string[];
}

export async function exportStaticUi(ui: UiServer, outDir: string): Promise<ExportResult> {
  const entries: Record<string, unknown> = {};
  const skipped: string[] = [];
  const get = async (path: string, params: Record<string, string> = {}): Promise<any> => {
    const key = keyOf(path, params);
    if (key in entries) return entries[key];
    if (process.env["DESK_EXPORT_VERBOSE"]) process.stderr.write(`export ${key}
`);
    const res = await ui.answer(path, Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "")));
    if (res.status !== 200) {
      skipped.push(`${key} (${res.status})`);
      return null;
    }
    entries[key] = res.body;
    return res.body;
  };

  const meta = await get("/api/meta");
  if (meta === null || meta.mode !== "sample") throw new Error("Only the constructed sample is exported: run desk ui --sample --export DIR.");

  for (const range of RANGES) {
    await get("/api/bill", { range });
    await get("/api/overhead", { range });
    await get("/api/outcomes", { range });
    const pol = await get("/api/policy", { range });
    if (range === "30" && pol?.selected?.to) await get("/api/policy/tunnel", { policy: String(pol.selected.to), range });
    for (const sort of SORTS) {
      const first = await get("/api/sessions", { range, sort, limit: "50", offset: "0" });
      if (range === "30" && sort === "cost" && first?.rows) {
        for (const r of (first.rows as { id: string }[]).slice(0, MAX_SESSIONS)) await get("/api/session", { id: r.id });
      }
    }
  }
  for (const hours of ["1", "5", "24"]) for (const days of ["7", "14", "30", "90"]) await get("/api/autopsy", { hours, days });
  // Every day the brief can be stepped to, by following its own earlier and later links from the default.
  const first = await get("/api/brief");
  const seen = new Set<string>();
  const walk = async (day: string | null | undefined, field: "earlierDay" | "laterDay"): Promise<void> => {
    while (day && !seen.has(day)) {
      seen.add(day);
      const b = await get("/api/brief", { day });
      day = b?.[field];
    }
  };
  if (first) {
    seen.add(first.day);
    await walk(first.earlierDay, "earlierDay");
    await walk(first.laterDay, "laterDay");
  }
  const week = await get("/api/week");
  for (const id of (week?.weeks ?? []) as string[]) await get("/api/week", { week: id });
  for (const p of ["/api/canary", "/api/silos", "/api/dossiers", "/api/evidence", "/api/sources"]) await get(p);
  const team = await get("/api/team");
  for (const p of (team?.lookAs ?? []) as { id: string }[]) await get("/api/team", { as: p.id });
  const ask = await get("/api/ask", { q: "" });
  const engines = (ask?.engines ?? []) as string[];
  for (const q of ((ask?.suggestions ?? []) as string[]).slice(0, 5)) {
    await get("/api/ask", { q });
    for (const e of engines) await get("/api/ask", { q, ablate: e });
  }

  mkdirSync(join(outDir, "data"), { recursive: true });
  let total = 0;
  for (const [key, body] of Object.entries(entries)) {
    const json = JSON.stringify({ key, body });
    total += Buffer.byteLength(json);
    writeFileSync(join(outDir, "data", fileFor(key)), json);
  }
  let files = Object.keys(entries).length;
  for (const [urlPath, file] of staticMap()) {
    const target = join(outDir, urlPath === "/" ? "index.html" : urlPath.slice(1));
    mkdirSync(dirname(target), { recursive: true });
    let bytes: Buffer | string = readFileSync(file);
    if (urlPath === "/") {
      bytes = String(bytes)
        .replace('<meta name="color-scheme" content="light dark">', '<meta name="color-scheme" content="light dark">\n<meta name="desk-static" content="data/">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; font-src \'self\'; img-src \'self\' data:; connect-src \'self\'; base-uri \'none\'; form-action \'none\'">');
    }
    writeFileSync(target, bytes);
    files++;
  }
  return { entries: Object.keys(entries).length, bytes: total, files, skipped };
}
