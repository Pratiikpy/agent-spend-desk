import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { evaluateRecall, RECALL_RECORD, recallRecord, renderRecall } from "../engines/recall-eval.ts";
import { recordEmbeddings } from "../scout/command.ts";
import { embedderFromEnv } from "./env.ts";
import { CassetteEmbedder, DEFAULT_EMBED_MODEL } from "./port.ts";

const CASSETTES = "data/sample/cassettes";

/**
 * `desk embed status`: where vectors would come from now, and what is recorded.
 * `desk embed eval`: how the owner's notes are found with and without the recorded vectors.
 * `desk embed record`: call the embedding endpoint for every text the sample needs and record the vectors (needs NVIDIA_API_KEY).
 */
export async function embedCommand(sub: string | undefined, o: { env: Record<string, string | undefined>; sampleMode: boolean; cassetteDir?: string; write?: boolean }): Promise<string> {
  const dir = o.cassetteDir ?? CASSETTES;
  if (sub === "record") return recordEmbeddings(o.env, dir);
  if (sub === "eval") {
    const emb = new CassetteEmbedder(dir, o.env["DESK_EMBED_MODEL"] ?? DEFAULT_EMBED_MODEL);
    const out: string[] = ["How the owner's notes are found, by words alone and with recorded vectors (evals/memory: 14 notes, 28 development and 24 test questions)", ""];
    for (const split of ["dev", "test"] as const) {
      out.push(renderRecall([await evaluateRecall(split, null), await evaluateRecall(split, emb)]), "");
    }
    if (o.write) {
      const record = await recallRecord(emb);
      mkdirSync(dirname(RECALL_RECORD), { recursive: true });
      writeFileSync(RECALL_RECORD, `${JSON.stringify(record, null, 2)}\n`);
      out.push(`wrote ${RECALL_RECORD}`);
    }
    return out.join("\n").trimEnd();
  }
  const choice = embedderFromEnv(o.env, dir, { sampleMode: o.sampleMode });
  const prefix = `embed-${(o.env["DESK_EMBED_MODEL"] ?? DEFAULT_EMBED_MODEL).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-`;
  let files = 0;
  try {
    files = readdirSync(dir).filter((f) => f.startsWith(prefix)).length;
  } catch {
    files = 0;
  }
  return [
    `model: ${o.env["DESK_EMBED_MODEL"] ?? DEFAULT_EMBED_MODEL}`,
    `this run: ${choice.label}`,
    `recorded vectors: ${files === 0 ? "none" : `${files} files in ${dir}`}`,
    "used by: Scout Intent's second stage (how a question is routed) and recall of the owner's notes",
  ].join("\n");
}
