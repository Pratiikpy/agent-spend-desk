import { createHash } from "node:crypto";

import { canonicalJson } from "../../runtime/canonical.ts";
import { dateIs, jsonAlignedIs, lastNumberIs, listIs, numbersTailAre, timeIs, wordIs, type CanaryTask } from "../canary/tasks.ts";
import { signEnvelope } from "../dossier/sign.ts";
import type { Signer } from "../dossier/keys.ts";
import { pae, strictBase64, type Envelope } from "../verify/dsse.ts";
import { verify as cryptoVerify, createPublicKey } from "node:crypto";

/**
 * A pack: rules or tasks someone else wrote, in a file (DF-065). What a pack can say is fixed so that importing one cannot run anything: a policy pack is rules in the policy
 * language, which the Desk already parses, checks and replays like any edit the owner writes; a canary template is tasks whose checks are one of a short list of declared kinds,
 * each a few lines of code that read text. No pack holds a program, a command, a URL to fetch or a path to read.
 */
export const PACK_SCHEMA = "desk.pack.v1";
export const PACK_KINDS = ["loop_signature", "budget_policy", "outcome_rule", "canary_template"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export class PackError extends Error {}

export interface PolicyContent {
  rules: unknown[];
}

export interface TemplateTask {
  id: string;
  cluster: CanaryTask["cluster"];
  prompt: string;
  check: { kind: string; args: unknown[] };
}

export interface Pack {
  schema: typeof PACK_SCHEMA;
  kind: PackKind;
  name: string;
  version: string;
  description: string;
  author?: string;
  content: PolicyContent | { tasks: TemplateTask[] };
}

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const KNOWN = new Set(["schema", "kind", "name", "version", "description", "author", "content"]);
const CLUSTERS = new Set<string>(["money", "logic", "records", "code", "units", "calendar", "text", "tables", "probability", "sql", "formats", "algorithms", "reading"]);

/** The declared kinds of check a template may use, by name, each with the arguments it takes. */
const CHECKS: Record<string, (args: unknown[]) => CanaryTask["check"]> = {
  lastNumberIs: (a) => (typeof a[0] === "number" && (a[1] === undefined || typeof a[1] === "number") ? lastNumberIs(a[0], a[1] as number | undefined) : bad("lastNumberIs", "a number and an optional tolerance")),
  wordIs: (a) => (typeof a[0] === "string" ? wordIs(a[0]) : bad("wordIs", "a word")),
  listIs: (a) => (Array.isArray(a[0]) && a[0].every((x) => typeof x === "string") ? listIs(a[0] as string[]) : bad("listIs", "a list of words")),
  dateIs: (a) => (typeof a[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a[0]) ? dateIs(a[0]) : bad("dateIs", "a date as YYYY-MM-DD")),
  timeIs: (a) => (typeof a[0] === "string" && /^\d{2}:\d{2}$/.test(a[0]) ? timeIs(a[0]) : bad("timeIs", "a time as HH:MM")),
  numbersTailAre: (a) => (Array.isArray(a[0]) && a[0].every((x) => typeof x === "number") ? numbersTailAre(a[0] as number[]) : bad("numbersTailAre", "a list of numbers")),
  jsonAlignedIs: (a) => (a.length >= 1 && (a[1] === undefined || (typeof a[1] === "number" && a[1] >= 0 && a[1] <= 1)) ? jsonAlignedIs(a[0], a[1] as number | undefined) : bad("jsonAlignedIs", "a reference value and an optional pass line from 0 to 1")),
};

function bad(kind: string, wants: string): never {
  throw new PackError(`the check ${kind} takes ${wants}`);
}

export const CHECK_KINDS = Object.keys(CHECKS);

export function readPack(text: string): Pack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PackError("a pack is a JSON file, and this is not JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new PackError("a pack is a JSON object");
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KNOWN.has(k)) throw new PackError(`a pack has no field called ${JSON.stringify(k)}`);
  if (o["schema"] !== PACK_SCHEMA) throw new PackError(`the schema is ${JSON.stringify(o["schema"])}, not ${PACK_SCHEMA}`);
  if (!PACK_KINDS.includes(o["kind"] as PackKind)) throw new PackError(`the kind is ${JSON.stringify(o["kind"])}; the kinds are ${PACK_KINDS.join(", ")}`);
  if (typeof o["name"] !== "string" || !NAME.test(o["name"])) throw new PackError("the name is 1 to 41 lowercase letters, digits and dashes");
  if (typeof o["version"] !== "string" || !VERSION.test(o["version"])) throw new PackError("the version is three numbers, such as 1.0.0");
  if (typeof o["description"] !== "string" || o["description"].length > 600) throw new PackError("the description is text of up to 600 characters");
  if (o["author"] !== undefined && (typeof o["author"] !== "string" || o["author"].length > 80)) throw new PackError("the author is text of up to 80 characters");
  const c = o["content"];
  if (typeof c !== "object" || c === null || Array.isArray(c)) throw new PackError("the content is an object");
  const content = c as Record<string, unknown>;
  if (o["kind"] === "canary_template") {
    for (const k of Object.keys(content)) if (k !== "tasks") throw new PackError(`a canary template's content holds tasks and nothing else, not ${JSON.stringify(k)}`);
    const tasks = content["tasks"];
    if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 60) throw new PackError("a canary template holds 1 to 60 tasks");
    const ids = new Set<string>();
    for (const t of tasks as Record<string, unknown>[]) {
      if (typeof t["id"] !== "string" || !NAME.test(t["id"]) || ids.has(t["id"])) throw new PackError(`a task needs its own id of lowercase letters, digits and dashes (${JSON.stringify(t["id"])})`);
      ids.add(t["id"]);
      if (!CLUSTERS.has(t["cluster"] as string)) throw new PackError(`task ${t["id"]}: the cluster is one of ${[...CLUSTERS].join(", ")}`);
      if (typeof t["prompt"] !== "string" || t["prompt"].length < 10 || t["prompt"].length > 4000) throw new PackError(`task ${t["id"]}: the prompt is 10 to 4000 characters`);
      const check = t["check"] as { kind?: unknown; args?: unknown } | undefined;
      if (!check || typeof check.kind !== "string" || !Array.isArray(check.args)) throw new PackError(`task ${t["id"]}: the check is { kind, args }`);
      const make = CHECKS[check.kind];
      if (!make) throw new PackError(`task ${t["id"]}: ${JSON.stringify(check.kind)} is not a kind of check the Desk has; they are ${CHECK_KINDS.join(", ")}`);
      try {
        make(check.args);
      } catch (e) {
        throw new PackError(`task ${t["id"]}: ${(e as Error).message}`);
      }
      for (const k of Object.keys(t)) if (!["id", "cluster", "prompt", "check"].includes(k)) throw new PackError(`task ${t["id"]} has no field called ${JSON.stringify(k)}`);
    }
  } else {
    for (const k of Object.keys(content)) if (k !== "rules") throw new PackError(`a policy pack's content holds rules and nothing else, not ${JSON.stringify(k)}`);
    if (!Array.isArray(content["rules"]) || content["rules"].length === 0 || content["rules"].length > 100) throw new PackError("a policy pack holds 1 to 100 rules");
  }
  return raw as Pack;
}

export function tasksOf(pack: Pack): CanaryTask[] {
  const tasks = (pack.content as { tasks: TemplateTask[] }).tasks;
  return tasks.map((t) => ({ id: t.id, cluster: t.cluster, prompt: t.prompt, check: (CHECKS[t.check.kind] as (a: unknown[]) => CanaryTask["check"])(t.check.args) }));
}

export const packDigest = (pack: Pack): string => createHash("sha256").update(canonicalJson(pack as never)).digest("hex");

const PACK_PAYLOAD_TYPE = "application/vnd.desk.pack+json";

/** A pack signed by its author: the pack's canonical JSON in a DSSE envelope. Unsigned packs are allowed and are said to be unsigned. */
export function signPack(pack: Pack, signer: Signer): Envelope {
  return signEnvelope(PACK_PAYLOAD_TYPE, Buffer.from(canonicalJson(pack as never), "utf8"), signer);
}

export function openSignedPack(env: unknown, pins: { keyid: string; publicKey: string }[]): { pack: Pack; keyid: string } {
  const e = env as Envelope;
  if (!e || typeof e.payload !== "string" || e.payloadType !== PACK_PAYLOAD_TYPE || !Array.isArray(e.signatures) || e.signatures.length !== 1) throw new PackError("this is not a signed pack");
  const payload = strictBase64(e.payload);
  const sig = strictBase64(e.signatures[0]?.sig ?? "");
  if (!payload || !sig) throw new PackError("the signed pack is not base64");
  for (const k of pins) {
    const der = strictBase64(k.publicKey);
    if (!der) continue;
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (cryptoVerify(null, pae(e.payloadType, payload), key, sig)) return { pack: readPack(payload.toString("utf8")), keyid: k.keyid };
  }
  throw new PackError("the signature does not verify against any key you trust");
}
