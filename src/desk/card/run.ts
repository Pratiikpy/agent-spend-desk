import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadAutopsyCalls } from "../autopsy/load.ts";
import { findJsonlLogs } from "../ingest/discover.ts";
import { openLedger, type Ledger } from "../ledger/db.ts";
import { ingestClaudeCode } from "../ledger/ingest.ts";
import { findRepoRoot } from "../outcomes/git.ts";
import { linkOutcomes } from "../outcomes/link.ts";
import { refreshTasks } from "../tasks/assign.ts";
import { defaultMarkerPath } from "../tasks/markers.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { buildSample, DEFAULT_SAMPLE, sampleLogsDir, sampleReposDir } from "../sample/gen.ts";
import { renderCardAnsi } from "./ansi.ts";
import { buildCard, type Card, type CardMode } from "./build.ts";
import { svgToPng } from "./png.ts";
import { renderCardSvg } from "./svg.ts";

export interface RunCardOptions {
  mode: CardMode;
  /** Where Claude Code keeps its logs (own_logs). */
  claudeDir: string;
  dbPath: string;
  pricesPath: string;
  /** Folder for card.json, card.svg and card.png. */
  outDir: string;
  /** Folder the sample is generated into (sample). */
  sampleDir: string;
  days: number;
  hours: number;
  repos: string[];
  color: boolean;
  width?: number;
  /** Told what is being done, so that reading a large history is not silent. Messages carry counts and folder names, never log content. */
  onProgress?: (message: string) => void;
}

export interface RunCardResult {
  text: string;
  card: Card | null;
  files: string[];
}

const CARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS result_card (
  card_id TEXT PRIMARY KEY,
  figures_hash TEXT NOT NULL,
  png_hash TEXT,
  json_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('own_logs', 'sample')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS redaction_event (
  event_id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES result_card (card_id),
  kind TEXT NOT NULL CHECK (kind IN ('credential', 'high_entropy', 'path')),
  count INTEGER NOT NULL CHECK (count >= 0)
);
`;

const sha = (b: string | Uint8Array): string => createHash("sha256").update(b).digest("hex");

function recordCard(db: Ledger, card: Card, json: string, png: Uint8Array): void {
  db.exec(CARD_SCHEMA);
  const id = card.figuresHash.replace("sha256:", "").slice(0, 16);
  db.prepare("INSERT OR REPLACE INTO result_card (card_id, figures_hash, png_hash, json_hash, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, card.figuresHash, sha(png), sha(json), card.mode, new Date().toISOString());
  db.prepare("DELETE FROM redaction_event WHERE card_id = ?").run(id);
  for (const [kind, count] of Object.entries(card.redactions)) db.prepare("INSERT INTO redaction_event (card_id, kind, count) VALUES (?, ?, ?)").run(id, kind, count);
}

/** One command, entirely local: read the logs, price them, explain the heaviest window, write the card three ways. */
export async function runCard(o: RunCardOptions): Promise<RunCardResult> {
  const snapshot = loadSnapshot(o.pricesPath);
  let claudeDir = o.claudeDir;
  let dbPath = o.dbPath;
  let repos = o.repos;
  if (o.mode === "sample") {
    if (!existsSync(sampleLogsDir(o.sampleDir))) buildSample({ ...DEFAULT_SAMPLE, outDir: o.sampleDir });
    claudeDir = sampleLogsDir(o.sampleDir);
    dbPath = join(o.sampleDir, "ledger.db");
    repos = ["payments-api", "web-app", "data-pipeline", "mobile-client", "infra"].map((n) => join(sampleReposDir(o.sampleDir), n));
  }
  const db = openLedger(dbPath);
  try {
    const say = o.onProgress ?? (() => undefined);
    const files = findJsonlLogs(claudeDir);
    say(`Found ${files.length} log file${files.length === 1 ? "" : "s"} in ${claudeDir}. Reading what is new in them; the first read of a long history can take a few minutes, later ones seconds.`);
    await ingestClaudeCode(db, files, snapshot);
    refreshTasks(db, { useLabels: o.mode === "own_logs", markerPath: defaultMarkerPath() });
    // Totals over every ingest run: a later run reads only new lines, so the last run alone would hide earlier skips.
    const skipped = db.prepare("SELECT COALESCE(SUM(malformed_lines), 0) m, COALESCE(SUM(truncated_tails), 0) t, COALESCE(SUM(usage_conflicts), 0) u FROM ingest_run").get() as unknown as { m: number; t: number; u: number };
    if (o.mode === "own_logs" && repos.length === 0) {
      const folders = db.prepare("SELECT DISTINCT project_path FROM session WHERE project_path IS NOT NULL").all() as unknown as { project_path: string }[];
      const roots = new Set<string>();
      for (const f of folders) {
        const root = findRepoRoot(f.project_path);
        if (root) roots.add(root);
      }
      repos = [...roots];
    }
    say(repos.length > 0 ? `Tying sessions to commits in ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}.` : "No repository to tie sessions to.");
    const linked = repos.length > 0 ? linkOutcomes(db, repos, Date.now()) : null;
    say("Building the card.");
    const calls = loadAutopsyCalls(db, snapshot, "0000", "9999");
    const built = buildCard({
      calls,
      mode: o.mode,
      hours: o.hours,
      days: o.days,
      ingest: { malformedLines: skipped.m, truncatedTails: skipped.t, usageConflicts: skipped.u, logFilesFound: files.length, searchedPaths: [claudeDir] },
      landingKnown: linked !== null && linked.links > 0,
    });
    if ("empty" in built) {
      return { text: ["No card yet.", ...built.couldNotKnow.map((l) => `- ${l}`)].join("\n"), card: null, files: [] };
    }
    const json = JSON.stringify(built, null, 2) + "\n";
    const svg = renderCardSvg(built);
    const png = svgToPng(svg);
    mkdirSync(o.outDir, { recursive: true });
    const written = [join(o.outDir, "card.json"), join(o.outDir, "card.svg"), join(o.outDir, "card.png")];
    writeFileSync(written[0]!, json);
    writeFileSync(written[1]!, svg);
    writeFileSync(written[2]!, png);
    recordCard(db, built, json, png);
    return { text: renderCardAnsi(built, { color: o.color, ...(o.width ? { width: o.width } : {}) }), card: built, files: written };
  } finally {
    db.close();
  }
}
