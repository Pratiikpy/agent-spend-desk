import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FateTruth } from "../calibrate/attribution.ts";
import { loadOrCreateSigner, pinsFor, type Signer } from "../dossier/keys.ts";
import { signEnvelope } from "../dossier/sign.ts";
import { sampleEnv, type Env } from "../prove/env.ts";
import { checkEnvelope, loadPins } from "../verify/dsse.ts";
import { canonicalJson, type Scorecard, type Section } from "./model.ts";
import { attacksSection, calibrationSection, faithfulnessSection } from "./quality.ts";
import { renderScorecard } from "./render.ts";
import { repeatSection, replaySection, rolesSection } from "./roles.ts";
import { cursorSection, enginesSection, modelSection, zetarisSection } from "./sponsors.ts";

export const SCORECARD_MD = "docs/evaluation/reasoning-scorecard.md";
export const SCORECARD_JSON = "docs/evaluation/reasoning-scorecard.json";
export const SCORECARD_DSSE = "docs/evaluation/reasoning-scorecard.dsse.json";
export const SCORECARD_PINS = "docs/evaluation/scorecard-signer.pins.json";
export const PAYLOAD_TYPE = "application/vnd.desk.scorecard+json";

/** Build every section. The sample ledger is built from its seed in a folder of its own and removed afterwards. */
export async function buildScorecard(log?: (line: string) => void, existing?: Env): Promise<Scorecard> {
  const dir = mkdtempSync(join(tmpdir(), "desk-scorecard-"));
  const env = existing ?? (await sampleEnv(dir));
  try {
    const sections: Section[] = [];
    const step = async (name: string, f: () => Promise<Section> | Section): Promise<void> => {
      log?.(name);
      sections.push(await f());
    };
    await step("roles", rolesSection);
    await step("model", modelSection);
    await step("repeat runs", repeatSection);
    await step("replay from recordings", () => replaySection(env.db));
    await step("engines", () => enginesSection(env.db, env.truth));
    await step("Zetaris", () => zetarisSection(env.db));
    await step("citations and perturbation", () => faithfulnessSection(env.db));
    await step("policy attacks", () => attacksSection(env.db));
    await step("calibration", () => calibrationSection(env.db, env.truth.sessions.map((s): FateTruth => ({ id: s.id, fate: s.fate as FateTruth["fate"] }))));
    await step("Cursor", cursorSection);
    return { version: 1, sections };
  } finally {
    if (!existing) env.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/** The first line at which two texts differ, for a message a person can act on. */
function firstDifference(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return `line ${i + 1}: committed ${JSON.stringify((x[i] ?? "(end)").slice(0, 120))}, recomputed ${JSON.stringify((y[i] ?? "(end)").slice(0, 120))}`;
  }
  return "no difference";
}

export interface ScorecardPaths {
  md: string;
  json: string;
  dsse: string;
  pins: string;
}

const DEFAULT_PATHS: ScorecardPaths = { md: SCORECARD_MD, json: SCORECARD_JSON, dsse: SCORECARD_DSSE, pins: SCORECARD_PINS };

/** Compare the recomputed page with the committed files byte for byte, and verify the signature when the page is signed. */
export function checkScorecard(card: Scorecard, paths: ScorecardPaths = DEFAULT_PATHS): CheckResult {
  const problems: string[] = [];
  const json = canonicalJson(card);
  const md = renderScorecard(card);
  const read = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : null);
  const committedJson = read(paths.json);
  const committedMd = read(paths.md);
  if (committedJson === null) problems.push(`${paths.json} is missing; write it with: npm run desk -- scorecard --write`);
  else if (committedJson !== json) problems.push(`${paths.json} differs from the recomputed scorecard (${firstDifference(committedJson, json)})`);
  if (committedMd === null) problems.push(`${paths.md} is missing; write it with: npm run desk -- scorecard --write`);
  else if (committedMd !== md) problems.push(`${paths.md} differs from the recomputed page (${firstDifference(committedMd, md)})`);
  if (existsSync(paths.dsse)) {
    if (!existsSync(paths.pins)) problems.push(`${paths.dsse} is signed but ${paths.pins} is missing, so the signature cannot be checked`);
    else {
      const pins = loadPins(JSON.parse(readFileSync(paths.pins, "utf8")) as unknown);
      if (!pins.ok) problems.push(`the signer pins are not readable: ${pins.reason}`);
      else {
        const checked = checkEnvelope(JSON.parse(readFileSync(paths.dsse, "utf8")) as unknown, PAYLOAD_TYPE, pins.keys as ReadonlyMap<string, KeyObject>);
        if (!checked.ok) problems.push(`the signature does not verify: ${checked.code}: ${checked.detail}`);
        else if (Buffer.from(checked.payload).toString("utf8") !== json) problems.push("the signed payload is not the recomputed scorecard");
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function writeScorecard(card: Scorecard, paths: Pick<ScorecardPaths, "md" | "json"> = DEFAULT_PATHS): void {
  for (const p of [paths.md, paths.json]) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(paths.json, canonicalJson(card));
  writeFileSync(paths.md, renderScorecard(card));
}

/** Sign the scorecard's JSON with the local signer (a key kept outside the repository) and write the envelope and the pins that verify it. */
export function signScorecard(card: Scorecard, signer: Signer, paths: Pick<ScorecardPaths, "dsse" | "pins"> = DEFAULT_PATHS): void {
  const envelope = signEnvelope(PAYLOAD_TYPE, Buffer.from(canonicalJson(card), "utf8"), signer);
  mkdirSync(dirname(paths.dsse), { recursive: true });
  writeFileSync(paths.dsse, `${JSON.stringify(envelope, null, 2)}\n`);
  writeFileSync(paths.pins, `${JSON.stringify(pinsFor(signer), null, 2)}\n`);
}

export interface ScorecardCommandOptions {
  write: boolean;
  check: boolean;
  sign: boolean;
  json: boolean;
  log?: (line: string) => void;
}

export async function scorecardCommand(o: ScorecardCommandOptions): Promise<{ text: string; exit: number }> {
  const card = await buildScorecard(o.log);
  const measures = card.sections.reduce((n, s) => n + s.metrics.length, 0);
  if (o.check) {
    const r = checkScorecard(card);
    return r.ok ? { text: `The scorecard recomputes byte for byte (${card.sections.length} sections, ${measures} measures).`, exit: 0 } : { text: ["The scorecard does not recompute:", ...r.problems.map((p) => `  ${p}`)].join("\n"), exit: 1 };
  }
  if (o.write) {
    writeScorecard(card);
    const lines = [`wrote ${SCORECARD_MD} and ${SCORECARD_JSON} (${card.sections.length} sections, ${measures} measures)`];
    if (o.sign) {
      const { signer, created } = loadOrCreateSigner();
      signScorecard(card, signer);
      lines.push(`signed with key ${signer.keyid}${created ? " (created)" : ""}: ${SCORECARD_DSSE}, pins ${SCORECARD_PINS}`);
    }
    return { text: lines.join("\n"), exit: 0 };
  }
  return { text: o.json ? canonicalJson(card) : renderScorecard(card), exit: 0 };
}
