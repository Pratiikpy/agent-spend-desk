import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { Intent, RiskClass } from "./types.ts";

export class RegistryError extends Error {}

/** The safe fallback every registry carries: used when nothing clears the Reject band, and never routed to a tool. */
export const GENERAL: Intent = {
  id: "GENERAL",
  category: "general",
  description: "Safe fallback when no registered intent clears the Reject band. Responds conversationally, never routes to tools, never guesses a high-risk intent.",
  parameters: { type: "object", properties: {} },
  capabilities: [],
  riskClass: "low",
  surfaces: ["*"],
  roles: ["*"],
  examples: [],
  version: 1,
};

const ID = /^(?:GENERAL|[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*)$/;
const RISK: readonly RiskClass[] = ["low", "medium", "high"];

function validate(i: Intent, where: string): void {
  const at = `${where}: intent ${JSON.stringify(i.id)}`;
  if (typeof i.id !== "string" || !ID.test(i.id)) throw new RegistryError(`${at} must be GENERAL or category.name`);
  if (i.id !== "GENERAL" && i.id.split(".")[0] !== i.category) throw new RegistryError(`${at} has category ${JSON.stringify(i.category)}, which is not the first part of its id`);
  if (typeof i.description !== "string" || i.description.trim() === "") throw new RegistryError(`${at} needs a description`);
  if (!RISK.includes(i.riskClass)) throw new RegistryError(`${at} needs riskClass low, medium or high`);
  if (!Array.isArray(i.capabilities) || i.capabilities.some((c) => typeof c !== "string" || c === "")) throw new RegistryError(`${at} needs capabilities as a list of names`);
  if (!Array.isArray(i.surfaces) || i.surfaces.length === 0) throw new RegistryError(`${at} needs at least one surface`);
  if (!Array.isArray(i.roles) || i.roles.length === 0) throw new RegistryError(`${at} needs at least one role`);
  if (!Number.isInteger(i.version) || i.version < 1) throw new RegistryError(`${at} needs an integer version of at least 1`);
  // Examples are mandatory: they are the classifier's seeds and the eval's fixtures. The fallback is the one intent that may have none.
  if (i.id !== "GENERAL" && (!Array.isArray(i.examples) || i.examples.length === 0 || i.examples.some((e) => typeof e !== "string" || e.trim() === ""))) {
    throw new RegistryError(`${at} needs examples: an intent without them cannot be classified or evaluated`);
  }
}

/** The catalog of what the system can act on. If an intent is not here it cannot be acted on. */
export class IntentRegistry {
  readonly intents: readonly Intent[];
  readonly registryVersion: number;
  private readonly index: ReadonlyMap<string, Intent>;

  private constructor(intents: readonly Intent[], registryVersion: number) {
    this.intents = intents;
    this.registryVersion = registryVersion;
    this.index = new Map(intents.map((i) => [i.id, i]));
  }

  static fromObject(raw: { version?: number; intents: Intent[] }, where = "registry"): IntentRegistry {
    if (!raw || !Array.isArray(raw.intents)) throw new RegistryError(`${where} must hold {"intents": [...]}`);
    const seen = new Set<string>();
    const intents: Intent[] = [];
    for (const i of raw.intents) {
      validate(i, where);
      if (seen.has(i.id)) throw new RegistryError(`${where}: intent ${i.id} is declared twice`);
      seen.add(i.id);
      intents.push({ ...i, parameters: i.parameters ?? { type: "object", properties: {} } });
    }
    if (!seen.has("GENERAL")) intents.unshift({ ...GENERAL });
    return new IntentRegistry(intents, Number.isInteger(raw.version) && (raw.version as number) >= 1 ? (raw.version as number) : 1);
  }

  static fromFile(path: string): IntentRegistry {
    if (!existsSync(path)) throw new RegistryError(`${path} does not exist`);
    const text = readFileSync(path, "utf8");
    const raw = (extname(path) === ".json" ? JSON.parse(text) : parseYaml(text)) as { version?: number; intents: Intent[] };
    return IntentRegistry.fromObject(raw, path);
  }

  /** A folder of one intent per file (.json, .yaml or .yml). The registry version is the highest intent version. */
  static fromDirectory(dir: string): IntentRegistry {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new RegistryError(`${dir} is not a folder`);
    const intents: Intent[] = [];
    for (const name of readdirSync(dir).sort()) {
      const ext = extname(name);
      if (![".json", ".yaml", ".yml"].includes(ext)) continue;
      const text = readFileSync(join(dir, name), "utf8");
      intents.push((ext === ".json" ? JSON.parse(text) : parseYaml(text)) as Intent);
    }
    return IntentRegistry.fromObject({ version: Math.max(1, ...intents.map((i) => i.version ?? 1)), intents }, dir);
  }

  /** Several registries as one. An intent declared in more than one is an error, not a silent override. The version is the highest of the parts. */
  static compose(parts: readonly IntentRegistry[]): IntentRegistry {
    const intents: Intent[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      for (const i of p.intents) {
        if (i.id === "GENERAL") {
          if (!seen.has("GENERAL")) {
            seen.add("GENERAL");
            intents.push(i);
          }
          continue;
        }
        if (seen.has(i.id)) throw new RegistryError(`intent ${i.id} is declared in more than one registry`);
        seen.add(i.id);
        intents.push(i);
      }
    }
    return IntentRegistry.fromObject({ version: Math.max(1, ...parts.map((p) => p.registryVersion)), intents }, "composed registry");
  }

  get(id: string): Intent | undefined {
    return this.index.get(id);
  }
  has(id: string): boolean {
    return this.index.has(id);
  }
}
