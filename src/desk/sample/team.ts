import { createPrivateKey, createPublicKey } from "node:crypto";

import { keyIdOf } from "../verify/dsse.ts";
import type { Signer } from "../dossier/keys.ts";
import { sign as cryptoSign } from "node:crypto";
import { addMember, initTeam, mergeReports, setRole } from "../team/command.ts";
import { signReport, type DayOutcome, type TeamDay, type TeamReport } from "../team/report.ts";
import { openTeam, type Role, type TeamDb } from "../team/store.ts";

/**
 * A team of six with their reports planted so that the answers are known before any view is run (DF-059). Each person's keys come from a public seed: they are sample keys, they
 * protect nothing, and they are never used outside the sample.
 *
 * What is planted: `chi` spends the most by a wide margin, so a view that ranked people would put `chi` first and one that does not will not. `haiku` and the `infra-tools` project
 * are each used by two people, fewer than the minimum group of three, so each must be folded. On 3 October only `ana` worked, so that day must be hidden. `fay` is a viewer.
 */
export const TEAM_FROM = "2026-10-01T00:00:00.000Z";
export const TEAM_TO = "2026-10-31T23:59:59.999Z";

export interface SamplePerson {
  id: string;
  display: string;
  role: Role;
  /** A multiplier on a day's spend, so the people differ. */
  weight: number;
  models: { model: string; share: number }[];
  projects: { label: string; share: number }[];
  /** Days of the month, 1 to 31, on which the person worked. */
  workdays: (d: number) => boolean;
}

const weekday = (d: number): boolean => {
  const dow = new Date(Date.UTC(2026, 9, d)).getUTCDay();
  return dow !== 0 && dow !== 6;
};

const OPUS = "claude-opus-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

export const PEOPLE: SamplePerson[] = [
  { id: "ana", display: "Ana Ferreira", role: "owner", weight: 1.0, models: [{ model: OPUS, share: 0.3 }, { model: SONNET, share: 0.7 }], projects: [{ label: "payments-api", share: 0.6 }, { label: "billing", share: 0.4 }], workdays: (d) => weekday(d) || d === 3 },
  { id: "ben", display: "Ben Okafor", role: "lead", weight: 1.4, models: [{ model: OPUS, share: 0.2 }, { model: SONNET, share: 0.6 }, { model: HAIKU, share: 0.2 }], projects: [{ label: "payments-api", share: 0.5 }, { label: "infra-tools", share: 0.5 }], workdays: weekday },
  { id: "chi", display: "Chi Nguyen", role: "member", weight: 3.2, models: [{ model: OPUS, share: 0.6 }, { model: SONNET, share: 0.4 }], projects: [{ label: "payments-api", share: 0.4 }, { label: "web", share: 0.6 }], workdays: weekday },
  { id: "dev", display: "Dev Patel", role: "member", weight: 0.8, models: [{ model: SONNET, share: 0.85 }, { model: HAIKU, share: 0.15 }], projects: [{ label: "billing", share: 0.7 }, { label: "web", share: 0.3 }], workdays: weekday },
  { id: "eli", display: "Eli Rossi", role: "member", weight: 1.1, models: [{ model: SONNET, share: 1 }], projects: [{ label: "web", share: 0.5 }, { label: "docs", share: 0.5 }], workdays: weekday },
  { id: "fay", display: "Fay Lindqvist", role: "viewer", weight: 0.5, models: [{ model: SONNET, share: 1 }], projects: [{ label: "docs", share: 1 }], workdays: (d) => weekday(d) && d % 2 === 0 },
];

/** Dollars of a person-day before the person's weight, in micros, by model. */
const BASE_MICROS: Record<string, number> = { [OPUS]: 6_000_000, [SONNET]: 2_400_000, [HAIKU]: 300_000 };
const CALLS: Record<string, number> = { [OPUS]: 40, [SONNET]: 90, [HAIKU]: 150 };

/** Ed25519 keys from a seed that is public, so that the sample has the same keys in every run. */
export function sampleSigner(name: string): Signer {
  const seed = Buffer.alloc(32);
  Buffer.from(`desk-sample-team-key-${name}`).copy(seed, 0, 0, 32);
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return { keyid: keyIdOf(spki), publicKey: Buffer.from(spki).toString("base64"), sign: (m) => cryptoSign(null, Buffer.from(m), privateKey) };
}

const round = (x: number): number => Math.round(x);

export function reportFor(p: SamplePerson): TeamReport {
  const days: TeamDay[] = [];
  for (let d = 1; d <= 31; d += 1) {
    if (!p.workdays(d)) continue;
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    const models = p.models.map((m) => {
      const micros = round(BASE_MICROS[m.model]! * p.weight * m.share * (0.85 + 0.3 * ((d * 7 + p.id.charCodeAt(0)) % 10) / 10));
      const calls = Math.max(1, round(CALLS[m.model]! * p.weight * m.share));
      return { model: m.model, calls, inputTokens: calls * 40, outputTokens: calls * 900, cacheReadTokens: calls * 30_000, cacheWriteTokens: calls * 1_200, micros };
    });
    const total = models.reduce((s, m) => s + m.micros, 0);
    const calls = models.reduce((s, m) => s + m.calls, 0);
    const projects = p.projects.map((q) => ({ label: q.label, calls: Math.max(1, round(calls * q.share)), micros: round(total * q.share) }));
    const outcomes: DayOutcome = { unlinked: round(total * 0.1), committed: round(total * 0.1), merged: round(total * 0.45), kept: round(total * 0.2), reverted: round(total * 0.05), none: 0 };
    outcomes.none = total - (outcomes.unlinked + outcomes.committed + outcomes.merged + outcomes.kept + outcomes.reverted);
    days.push({ day, models, projects, outcomes });
  }
  return { version: 1, person: p.id, period: { from: TEAM_FROM, to: TEAM_TO }, priceSnapshot: "sample-snapshot", unpricedCalls: 0, days };
}

export interface SampleTeam {
  db: TeamDb;
  signers: Record<string, Signer>;
  /** What the planted reports add up to, from the reports themselves. */
  truth: { totalMicros: number; totalCalls: number; byModel: Record<string, number>; byPerson: Record<string, number>; hiddenDay: string };
}

/** Make the team in a database (a file, or ":memory:"), add everyone, and take in each person's signed report. */
export function buildSampleTeam(path: string = ":memory:", now: () => string = () => "2026-11-01T09:00:00.000Z"): SampleTeam {
  const db = openTeam(path);
  const signers: Record<string, Signer> = Object.fromEntries(PEOPLE.map((p) => [p.id, sampleSigner(p.id)]));
  const owner = PEOPLE[0] as SamplePerson;
  const ownerSigner = signers[owner.id] as Signer;
  const made = initTeam(db, ownerSigner, { name: "payments", person: owner.id, display: owner.display }, now);
  if (!made.ok) throw new Error(made.text);
  for (const p of PEOPLE.slice(1)) {
    const r = addMember(db, ownerSigner, { person: p.id, display: p.display, publicKey: (signers[p.id] as Signer).publicKey, role: "viewer" }, now);
    if (!r.ok) throw new Error(r.text);
    if (p.role !== "viewer") {
      const g = setRole(db, ownerSigner, { person: p.id, role: p.role }, now);
      if (!g.ok) throw new Error(g.text);
    }
  }
  const files = PEOPLE.map((p) => ({ name: `${p.id}.dsse.json`, envelope: signReport(reportFor(p), signers[p.id] as Signer) }));
  const merged = mergeReports(db, ownerSigner, files, now);
  if (!merged.ok) throw new Error(merged.text);
  const truth = { totalMicros: 0, totalCalls: 0, byModel: {} as Record<string, number>, byPerson: {} as Record<string, number>, hiddenDay: "2026-10-03" };
  for (const p of PEOPLE) {
    for (const d of reportFor(p).days) {
      for (const m of d.models) {
        truth.totalMicros += m.micros;
        truth.totalCalls += m.calls;
        truth.byModel[m.model] = (truth.byModel[m.model] ?? 0) + m.micros;
        truth.byPerson[p.id] = (truth.byPerson[p.id] ?? 0) + m.micros;
      }
    }
  }
  return { db, signers, truth };
}
